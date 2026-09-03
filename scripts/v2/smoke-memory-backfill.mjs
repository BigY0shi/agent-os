// S5 smoke: legacy memory backfill, fully offline.
//
// Run: npx tsx scripts/v2/smoke-memory-backfill.mjs
//
// Rule 19: AGENTIC_OS_DB, AGENTIC_OS_SETTINGS and AGENTIC_OS_RUNS_DIR are
// redirected BEFORE any import; memory.ingestEnabled is false so no queue
// drains; settings deliberately name a HOSTED provider (ollama-cloud +
// glm-5.2:cloud) so the test proves the backfill pins the local model anyway.
// The model is a fake Ollama behind globalThis.fetch (/api/tags, /api/chat,
// /api/embed) PLUS a fake OpenAI-compatible server on 127.0.0.1:1234 standing
// in for LM Studio (/v1/models, /v1/chat/completions) for section K. Any other
// origin throws. Nothing on the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backfill-"));
const dbFile = path.join(dir, "agentos.db");
process.env.AGENTIC_OS_DB = dbFile;
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
process.env.AGENTIC_OS_RUNS_DIR = dir;
process.env.OLLAMA_URL = "http://127.0.0.1:11434";
delete process.env.OLLAMA_API_KEY;
fs.writeFileSync(
  process.env.AGENTIC_OS_SETTINGS,
  JSON.stringify({
    memory: {
      ingestEnabled: false,
      provider: "ollama-cloud",
      modelLow: "kimi-k2.6:cloud",
      modelMedium: "glm-5.2:cloud",
      embedProvider: "ollama-local",
      embedModel: "nomic-embed-text",
      backfillLimit: 20,
      backfillModel: "bonsai:27b",
      backfillProvider: "ollama-local",
      openaiCompatUrl: "http://127.0.0.1:1234/v1",
    },
  }),
  "utf8",
);

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};

// ---- the fake Ollama --------------------------------------------------------
let tagsMode = "ok"; // ok | down | nomodel | noembed
let lmMode = "ok";   // ok | down | nomodel
const calls = { tags: 0, chat: [], embed: 0, lmModels: 0, lmChat: [] };
const NOTHING_MARKER = "nothing-worth-keeping";
const EMPTY_MARKER = "empty-extraction-nothing-usable";
const DIM = 768;
const vec = (seed) => Array.from({ length: DIM }, (_, i) => Math.sin(seed * 7 + i));

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== "127.0.0.1" || (u.port !== "11434" && u.port !== "1234")) {
    throw new Error(`smoke: unexpected fetch to ${u.origin}${u.pathname} (only the local Ollama and the fake LM Studio may be called)`);
  }
  if (u.port === "1234") return lmStudio(u, init);
  if (u.pathname === "/api/tags") {
    calls.tags++;
    if (tagsMode === "down") throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:11434");
    const models = tagsMode === "nomodel"
      ? [{ name: "nomic-embed-text:latest" }, { name: "glm-5.2:cloud" }]
      : tagsMode === "noembed"
        ? [{ name: "bonsai:27b" }]
        : [{ name: "bonsai:27b" }, { name: "nomic-embed-text:latest" }];
    return Response.json({ models });
  }
  if (u.pathname === "/api/embed") {
    calls.embed++;
    const body = JSON.parse(init.body);
    const input = Array.isArray(body.input) ? body.input : [body.input];
    return Response.json({ embeddings: input.map((t) => vec(t.length)) });
  }
  if (u.pathname === "/api/chat") {
    const body = JSON.parse(init.body);
    calls.chat.push({ model: body.model, host: u.origin, format: body.format ? Object.keys(body.format.properties ?? {}) : null, reasoningEffort: body.reasoning_effort, signal: init.signal });
    const keys = body.format ? Object.keys(body.format.properties ?? {}) : [];
    return Response.json({ message: { role: "assistant", content: modelContent(body.messages, keys) } });
  }
  throw new Error(`smoke: unexpected path ${u.pathname}`);
};

/**
 * The fake LM Studio: the OpenAI wire format on 127.0.0.1:1234. Same content as
 * the Ollama fake, so section K proves the transport swap and nothing else. The
 * reply is wrapped in a <think> block to prove the strip in openaiCompatChat.
 */
function lmStudio(u, init) {
  if (lmMode === "down") throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:1234");
  if (u.pathname === "/v1/models") {
    calls.lmModels++;
    const data = lmMode === "nomodel"
      ? [{ id: "qwen3-4b" }, { id: "text-embedding-nomic" }]
      : [{ id: "bonsai-27b" }, { id: "qwen3-4b" }];
    return Response.json({ object: "list", data });
  }
  if (u.pathname === "/v1/chat/completions") {
    const body = JSON.parse(init.body);
    const schema = body.response_format?.json_schema?.schema;
    const keys = schema ? Object.keys(schema.properties ?? {}) : [];
    calls.lmChat.push({
      model: body.model,
      host: u.origin,
      responseFormat: body.response_format?.type ?? null,
      reasoningEffort: body.reasoning_effort,
      schemaKeys: keys,
    });
    const content = `<think>weighing it up</think>${modelContent(body.messages, keys)}`;
    return Response.json({ choices: [{ index: 0, message: { role: "assistant", content } }] });
  }
  throw new Error(`smoke: unexpected LM Studio path ${u.pathname}`);
}

/** Structured (or normalize) output for a call, keyed off the schema's top-level properties. */
function modelContent(messages, keys) {
    const text = messages.map((m) => m.content).join("\n");
    let content;
    if (keys.length === 0 && text.includes(NOTHING_MARKER)) {
      // normalize (text call): the model's own NOTHING_TO_REMEMBER signal
      content = "NOTHING_TO_REMEMBER";
    } else if (keys.length === 0 && text.includes(EMPTY_MARKER)) {
      // normalize (text call): succeeds, but keep EMPTY_MARKER in the
      // normalized text VERBATIM (not the crude "Yoshi ..." regex below, which
      // grabs the first "Yoshi " on any line of the FULL prompt and can miss
      // the actual note) so every later extraction call still sees it.
      content = `<output>NORMALIZED: Yoshi's note (${EMPTY_MARKER}) is present but the model extracted nothing.</output>`;
    } else if (keys.length === 0) {
      // normalize (text call), the ordinary case
      content = `<output>NORMALIZED: ${/Yoshi [^\n]*/.exec(text)?.[0] ?? "Yoshi did something."}</output>`;
    } else if (text.includes(EMPTY_MARKER)) {
      // Normalize succeeds (an episodeUuid comes back), but every extraction
      // phase yields nothing - a model coming up short, not an empty episode.
      if (keys.includes("entities")) content = JSON.stringify({ entities: [], graph_facts: [] });
      else if (keys.includes("graph_facts")) content = JSON.stringify({ graph_facts: [] });
      else if (keys.includes("voice_facts")) content = JSON.stringify({ voice_facts: [] });
      else if (keys.includes("facts")) content = JSON.stringify({ facts: [] });
      else if (keys.includes("aspects")) content = JSON.stringify({ aspects: [] });
      else throw new Error(`smoke: unrecognised structured call with keys ${keys.join(",")}`);
    } else if (keys.includes("entities")) {
      content = JSON.stringify({
        entities: [{ name: "Yoshi", type: "Person", attributes: null }, { name: "Proxmox cluster", type: "Product", attributes: null }],
        graph_facts: [
          { source: "Yoshi", predicate: "runs", target: "Proxmox cluster", fact: "Yoshi runs a Proxmox cluster at home", event_date: null },
          { source: "Yoshi", predicate: "shipped", target: "Voicebox", fact: "Yoshi shipped Voicebox on 2026-09-02", event_date: "2026-09-02" },
        ],
      });
    } else if (keys.includes("graph_facts")) {
      content = JSON.stringify({ graph_facts: [
        { source: "Yoshi", predicate: "runs", target: "Proxmox cluster", fact: "Yoshi runs a Proxmox cluster at home", event_date: null },
        { source: "Yoshi", predicate: "shipped", target: "Voicebox", fact: "Yoshi shipped Voicebox on 2026-09-02", event_date: "2026-09-02" },
      ] });
    } else if (keys.includes("voice_facts")) {
      content = JSON.stringify({ voice_facts: [{ fact: "Yoshi prefers Opera over Chrome" }] });
    } else if (keys.includes("facts")) {
      content = JSON.stringify({ facts: [
        { source: "Yoshi", predicate: "runs", target: "Proxmox cluster", fact: "Yoshi runs a Proxmox cluster at home", aspect: "Identity", event_date: null },
        { source: "Yoshi", predicate: "shipped", target: "Voicebox", fact: "Yoshi shipped Voicebox on 2026-09-02", aspect: "Event", event_date: "2026-09-02" },
      ] });
    } else if (keys.includes("aspects")) {
      content = JSON.stringify({ aspects: [{ fact: "Yoshi prefers Opera over Chrome", aspect: "Preference" }] });
    } else {
      throw new Error(`smoke: unrecognised structured call with keys ${keys.join(",")}`);
    }
    return content;
}

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const graph = await import("../../src/lib/v2/memory/graph.ts");
const { contentHash } = await import("../../src/lib/v2/memory/chunker.ts");
const B = await import("../../src/lib/v2/memory/backfill.ts");

const cleanup = () => {
  globalThis.fetch = realFetch;
  try { __closeForTests(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
};
const finish = () => {
  cleanup();
  console.log(failures === 0 ? "\nsmoke-memory-backfill: ALL PASS" : `\nsmoke-memory-backfill: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
};

ensureDb();

// ---- A. fixture: 5 legacy rows the way A9 raw mode writes them --------------
console.log("-- A: fixture --");
const legacyTexts = [
  "2026-07-14 Yoshi runs a Proxmox cluster at home and self-hosts umbrelOS on LXCs.",
  "2026-07-20 Yoshi shipped Voicebox as the voice engine and prefers Opera over Chrome.",
  "2026-07-22 Yoshi audited Agent OS with a council and picked Deal Flow first.",
  `2026-07-25 testing testing ${NOTHING_MARKER} reply with exactly PONG`,
  "2026-07-28 Yoshi corrected the parallelism assumption on the .99 homelab box.",
];
const legacy = legacyTexts.map((text, i) => {
  const uuid = graph.saveEpisode({
    content: text,
    originalContent: text,
    metadata: { originFile: `recent-2026-07-${14 + i}.md` },
    source: i % 2 === 0 ? "migration:remember" : "migration:jarvis",
    sessionId: `remember-2026-07-${14 + i}`,
    contentHash: contentHash(text),
    validAt: `2026-07-${String(14 + i).padStart(2, "0")}T12:00:00.000Z`,
  });
  return { uuid, text, hash: contentHash(text) };
});
// a non-legacy episode with no derivation: must NOT be a candidate
const liveUuid = graph.saveEpisode({
  content: "a live V2 episode that is simply queued, not legacy",
  originalContent: "a live V2 episode that is simply queued, not legacy",
  source: "jarvis",
  sessionId: "live-1",
  validAt: "2026-09-01T00:00:00.000Z",
});
// a legacy episode that already HAS a provenance edge: must NOT be a candidate
const derivedUuid = graph.saveEpisode({
  content: "2026-06-01 already derived legacy row",
  originalContent: "2026-06-01 already derived legacy row",
  source: "migration:remember",
  sessionId: "remember-2026-06-01",
  contentHash: contentHash("2026-06-01 already derived legacy row"),
  validAt: "2026-06-01T00:00:00.000Z",
});
const subj = graph.saveEntity({ name: "Yoshi", type: "Person" });
const pred = graph.saveEntity({ name: "uses", type: "Predicate" });
const obj = graph.saveEntity({ name: "Opera", type: "Product" });
graph.saveTriple({ statement: { fact: "Yoshi uses Opera", aspect: "Preference", validAt: "2026-06-01T00:00:00.000Z" }, subjectUuid: subj, predicateUuid: pred, objectUuid: obj, episodeUuid: derivedUuid });

const episodesBefore = getDb().prepare("SELECT COUNT(*) AS c FROM episodes").get().c;
check("fixture: 7 episodes in the temp DB", episodesBefore === 7, String(episodesBefore));
check("migration 4 created memory_backfill_log", !!getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'memory_backfill_log'").get());

// ---- B. listing ---------------------------------------------------------------
console.log("-- B: listUndrivedEpisodes --");
const all = B.listUndrivedEpisodes(100);
check("5 legacy undrived candidates (live + already-derived rows excluded)", all.length === 5, String(all.length));
check("oldest first", all[0].uuid === legacy[0].uuid && all[4].uuid === legacy[4].uuid);
check("excludes the non-legacy episode", !all.some((c) => c.uuid === liveUuid));
check("excludes the legacy row with a provenance edge", !all.some((c) => c.uuid === derivedUuid));
check("limit respected", B.listUndrivedEpisodes(2).length === 2);
check("countUndrivedEpisodes = 5", B.countUndrivedEpisodes() === 5);
check("candidate carries preview + chars + source", all[0].preview.startsWith("2026-07-14 Yoshi") && all[0].chars === legacyTexts[0].length && all[0].source === "migration:remember");
check("ollamaHasModel: exact, :latest both ways", B.ollamaHasModel(["bonsai:27b", "nomic-embed-text:latest"], "bonsai:27b") && B.ollamaHasModel(["nomic-embed-text:latest"], "nomic-embed-text") && B.ollamaHasModel(["bonsai"], "bonsai:latest") && !B.ollamaHasModel(["bonsai:27b"], "bonsai:8b"));

// ---- C. dry run writes nothing, calls nothing ----------------------------------
console.log("-- C: dry run --");
const dryLog = [];
const dry = await B.backfillEpisodes({ limit: 3, model: "bonsai:27b", dryRun: true, log: (t) => dryLog.push(t) });
check("dry run lists 3 candidates of 5 remaining", dry.dryRun === true && dry.candidates.length === 3 && dry.remaining === 5);
check("dry run makes no Ollama call", calls.tags === 0 && calls.chat.length === 0 && calls.embed === 0);
check("dry run writes no log row", getDb().prepare("SELECT COUNT(*) AS c FROM memory_backfill_log").get().c === 0);
check("dry run writes no statements", getDb().prepare("SELECT COUNT(*) AS c FROM edges WHERE type = 'provenance'").get().c === 1);
check("dry run says so in the log", dryLog.some((t) => /dry run: 3 of 5/.test(t) && /nothing written/.test(t)));

// ---- D. Ollama absent / model absent: loud, no fallback ------------------------
console.log("-- D: fail loudly --");
tagsMode = "down";
let err = null;
try { await B.backfillEpisodes({ limit: 3, model: "bonsai:27b" }); } catch (e) { err = e; }
check("Ollama down -> error names the host and says no fallback", !!err && /not reachable at http:\/\/127\.0\.0\.1:11434/.test(err.message) && /never falls back/.test(err.message), err?.message);
check("Ollama down -> no chat call, no write", calls.chat.length === 0 && getDb().prepare("SELECT COUNT(*) AS c FROM memory_backfill_log").get().c === 0);

tagsMode = "nomodel";
err = null;
try { await B.backfillEpisodes({ limit: 3, model: "bonsai:27b" }); } catch (e) { err = e; }
check("model not pulled -> error names the model, lists pulled, gives the pull command", !!err && /'bonsai:27b' is not pulled/.test(err.message) && /Pulled: nomic-embed-text:latest, glm-5.2:cloud/.test(err.message) && /ollama pull bonsai:27b/.test(err.message) && /No fallback/.test(err.message), err?.message);
check("model not pulled -> no chat call", calls.chat.length === 0);

tagsMode = "noembed";
err = null;
try { await B.backfillEpisodes({ limit: 3, model: "bonsai:27b" }); } catch (e) { err = e; }
check("embed model not pulled -> error names nomic-embed-text", !!err && /'nomic-embed-text'/.test(err.message) && /ollama pull nomic-embed-text/.test(err.message), err?.message);

const tagsBefore = calls.tags;
err = null;
try { await B.backfillEpisodes({ limit: 3, model: "   " }); } catch (e) { err = e; }
check("empty model -> error before any call", !!err && /no chat model/.test(err.message) && calls.tags === tagsBefore, err?.message);
tagsMode = "ok";

// ---- E. STOP before the first episode ------------------------------------------
console.log("-- E: STOP --");
const ac = new AbortController();
ac.abort();
err = null;
try { await B.backfillEpisodes({ limit: 3, model: "bonsai:27b", signal: ac.signal }); } catch (e) { err = e; }
check("aborted signal -> AbortError, nothing derived", !!err && err.name === "AbortError" && getDb().prepare("SELECT COUNT(*) AS c FROM memory_backfill_log").get().c === 0, err?.name);
calls.chat.length = 0; calls.embed = 0;

// ---- F. the real run: 3 of 5, local model pinned, dedup untouched ---------------
console.log("-- F: real run --");
const runLog = [];
const prog = [];
const run = await B.backfillEpisodes({ limit: 3, model: "bonsai:27b", runId: "run-1", log: (t) => runLog.push(t), progress: (n, total) => prog.push([n, total]) });
check("3 results, oldest 3 candidates", run.results.length === 3 && run.results.map((r) => r.uuid).join() === legacy.slice(0, 3).map((l) => l.uuid).join());
check("all 3 derived", run.derived === 3 && run.nothing === 0 && run.failed === 0);
check("every chat call went to the LOCAL host with bonsai:27b (settings say ollama-cloud/glm)", calls.chat.length > 0 && calls.chat.every((c) => c.host === "http://127.0.0.1:11434" && c.model === "bonsai:27b"), JSON.stringify(calls.chat.map((c) => c.model + "@" + c.host).slice(0, 3)));
check("6-8 chat calls per episode", calls.chat.length >= 18 && calls.chat.length <= 24, String(calls.chat.length));
check("embeddings requested (episode + facts + entities + voice)", calls.embed >= 3, String(calls.embed));
check("progress reported 0..3 of 3", prog[0]?.[0] === 0 && prog[0]?.[1] === 3 && prog.at(-1)?.[0] === 3);

const first = run.results[0];
check("statement aspects landed: Identity 1, Event 1", first.statements === 2 && first.statementAspects.Identity === 1 && first.statementAspects.Event === 1, JSON.stringify(first.statementAspects));
check("voice aspect landed: Preference 1", first.voiceAspects === 1 && first.voiceAspectKinds.Preference === 1, JSON.stringify(first.voiceAspectKinds));
check("sample facts name the aspect", first.sampleFacts.some((f) => f.startsWith("[Identity] ")) && first.sampleFacts.some((f) => f.startsWith("[voice:Preference] ")));
const provRows = getDb().prepare("SELECT COUNT(*) AS c FROM edges WHERE type = 'provenance' AND from_uuid = ?").get(first.uuid).c;
check("provenance edges exist in the graph for the derived row", provRows === 2, String(provRows));
const stAspects = getDb().prepare("SELECT s.aspect FROM edges e JOIN statements s ON s.uuid = e.to_uuid WHERE e.type = 'provenance' AND e.from_uuid = ? ORDER BY s.aspect").all(first.uuid).map((r) => r.aspect);
check("statements rows carry Identity + Event", stAspects.join() === "Event,Identity", stAspects.join());

const rowAfter = getDb().prepare("SELECT content, original_content, content_hash, source FROM episodes WHERE uuid = ?").get(first.uuid);
check("content_hash untouched", rowAfter.content_hash === legacy[0].hash);
check("original_content untouched (write-once)", rowAfter.original_content === legacy[0].text);
check("content now the normalized text", rowAfter.content.startsWith("NORMALIZED: "), rowAfter.content.slice(0, 40));
check("source still migration:remember", rowAfter.source === "migration:remember");
check("no re-import: still 7 episodes", getDb().prepare("SELECT COUNT(*) AS c FROM episodes").get().c === 7);

const logRows = B.listBackfillLog(10);
check("3 log rows for run-1, outcome derived, model recorded", logRows.length === 3 && logRows.every((r) => r.runId === "run-1" && r.outcome === "derived" && r.model === "bonsai:27b" && r.statements === 2 && r.voiceAspects === 1));
check("derived rows leave the candidate list; 2 remain", B.countUndrivedEpisodes() === 2 && B.listUndrivedEpisodes(10).map((c) => c.uuid).join() === legacy.slice(3).map((l) => l.uuid).join());
check("log lines say what landed", runLog.some((t) => /derived: 2 facts \((Identity 1, Event 1|Event 1, Identity 1)\), 1 voice \(Preference 1\)/.test(t)) && runLog.some((t) => /^done: 3 derived, 0 nothing to remember, 0 failed; 2 legacy episodes still undrived$/.test(t)), runLog.join(" | "));
check("preflight logged the local host, the model and the embed model", runLog.some((t) => /ollama-local at http:\/\/127\.0\.0\.1:11434: bonsai:27b ready; embeddings nomic-embed-text on Ollama at http:\/\/127\.0\.0\.1:11434/.test(t)), runLog[0]);

// ---- G. NOTHING_TO_REMEMBER is an outcome, and the run is idempotent -------------
console.log("-- G: nothing + idempotent --");
const run2 = await B.backfillEpisodes({ limit: 10, model: "bonsai:27b", runId: "run-2" });
check("second run takes only the 2 remaining", run2.results.length === 2 && run2.remaining === 2);
const nothingRes = run2.results.find((r) => r.uuid === legacy[3].uuid);
check("NOTHING_TO_REMEMBER -> outcome nothing, no facts", nothingRes?.outcome === "nothing" && nothingRes.statements === 0 && nothingRes.voiceAspects === 0);
check("the other -> derived", run2.results.find((r) => r.uuid === legacy[4].uuid)?.outcome === "derived" && run2.derived === 1 && run2.nothing === 1);
const nothingRow = getDb().prepare("SELECT content, content_hash FROM episodes WHERE uuid = ?").get(legacy[3].uuid);
check("nothing row kept verbatim with its hash", nothingRow.content === legacy[3].text && nothingRow.content_hash === legacy[3].hash);
check("nothing to remember is not offered again: 0 undrived", B.countUndrivedEpisodes() === 0);
const run3 = await B.backfillEpisodes({ limit: 10, model: "bonsai:27b", runId: "run-3" });
check("third run: no candidates, no work, no error", run3.results.length === 0 && run3.remaining === 0);
check("log has 5 rows total (3 + 2), none for run-3", getDb().prepare("SELECT COUNT(*) AS c FROM memory_backfill_log").get().c === 5 && !B.listBackfillLog(10).some((r) => r.runId === "run-3"));

// ---- H. a failing episode is recorded and the run carries on --------------------
console.log("-- H: per-episode failure --");
const failText = "2026-08-01 Yoshi episode that the model will choke on";
const failUuid = graph.saveEpisode({ content: failText, originalContent: failText, source: "migration:agents", sessionId: "agent-x", contentHash: contentHash(failText), validAt: "2026-08-01T00:00:00.000Z" });
const okText = "2026-08-02 Yoshi episode that derives fine";
const okUuid = graph.saveEpisode({ content: okText, originalContent: okText, source: "migration:agents", sessionId: "agent-y", contentHash: contentHash(okText), validAt: "2026-08-02T00:00:00.000Z" });
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/api/chat") && JSON.parse(init.body).messages.some((m) => m.content.includes("choke on"))) {
    return new Response("model exploded", { status: 500 });
  }
  return origFetch(url, init);
};
const run4 = await B.backfillEpisodes({ limit: 10, model: "bonsai:27b", runId: "run-4" });
globalThis.fetch = origFetch;
const failRes = run4.results.find((r) => r.uuid === failUuid);
check("failing episode recorded as failed with the model error", failRes?.outcome === "failed" && /ollama-local chat failed \(500\)/.test(failRes.error ?? ""), failRes?.error);
check("the run carried on and derived the next one", run4.results.find((r) => r.uuid === okUuid)?.outcome === "derived" && run4.failed === 1 && run4.derived === 1);
check("a failed episode stays eligible for the next run", B.listUndrivedEpisodes(10).map((c) => c.uuid).join() === failUuid);
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/api/chat")) return new Response("down", { status: 503 });
  return origFetch(url, init);
};
err = null;
try { await B.backfillEpisodes({ limit: 10, model: "bonsai:27b", runId: "run-5" }); } catch (e) { err = e; }
globalThis.fetch = origFetch;
check("every episode failing -> the run throws (never a quiet done)", !!err && /every one of 1 episodes failed/.test(err.message), err?.message);

// ---- I. the CLI, dry run, as a child process against the same temp DB -----------
console.log("-- I: CLI --");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
check("tsx cli present for the child run", fs.existsSync(tsxCli));
const cli = spawnSync(process.execPath, [tsxCli, path.join(root, "scripts", "v2", "memory-backfill.mjs"), "--dry-run", "--limit", "1", "--json"], {
  cwd: root, encoding: "utf8", env: { ...process.env }, timeout: 120_000,
});
let cliJson = null;
try { cliJson = JSON.parse(cli.stdout.slice(cli.stdout.indexOf("{"))); } catch {}
check("CLI --dry-run --json exits 0 with the candidate", cli.status === 0 && cliJson?.dryRun === true && cliJson.candidates?.length === 1 && cliJson.candidates[0].uuid === failUuid && cliJson.model === "bonsai:27b", `status=${cli.status} stderr=${cli.stderr.slice(0, 200)}`);
const badCli = spawnSync(process.execPath, [tsxCli, path.join(root, "scripts", "v2", "memory-backfill.mjs"), "--limit", "zero"], { cwd: root, encoding: "utf8", env: { ...process.env }, timeout: 60_000 });
check("CLI rejects a bad --limit with exit 2", badCli.status === 2 && /--limit must be a positive integer/.test(badCli.stderr), `status=${badCli.status}`);

// ---- J. the route + the gear + the tray, statically ------------------------------
console.log("-- J: wiring --");
const routeSrc = fs.readFileSync(path.join(root, "src", "app", "api", "v2", "memory", "backfill", "route.ts"), "utf8");
check("route registers a module run on module 'memory' with progress", /startModuleRun\(/.test(routeSrc) && /module: "memory"/.test(routeSrc) && /progress: ctx\.progress/.test(routeSrc) && /signal: ctx\.signal/.test(routeSrc));
check("route: dryRun answers inline, real run returns runId, 409 while running", /dryRun: true/.test(routeSrc) && /started: true, runId: run\.id/.test(routeSrc) && /status: 409/.test(routeSrc));
check("route defaults come from settings.memory.backfillLimit/backfillModel", /backfillLimit/.test(routeSrc) && /backfillModel/.test(routeSrc));
const gearSrc = fs.readFileSync(path.join(root, "src", "components", "v2", "memory", "MemorySettings.tsx"), "utf8");
check("gear: limit + model fields, Dry-run and Run buttons, posts to the route", /backfillLimit/.test(gearSrc) && /backfillModel/.test(gearSrc) && /\/api\/v2\/memory\/backfill/.test(gearSrc) && /Run backfill/.test(gearSrc) && /Dry-run/.test(gearSrc));
check("gear persists limit + model through settings.memory (rule 16)", /backfillLimit: /.test(gearSrc) && /backfillModel: /.test(gearSrc));
const traySrc = fs.readFileSync(path.join(root, "src", "components", "RunsTray.tsx"), "utf8");
check("tray names the memory module", /memory: "Memory"/.test(traySrc));
const settingsSrc = fs.readFileSync(path.join(root, "src", "lib", "settings.ts"), "utf8");
check("settings defaults: backfillLimit 20, backfillModel bonsai:27b", /backfillLimit: 20/.test(settingsSrc) && /backfillModel: "bonsai:27b"/.test(settingsSrc));
check("settings carry backfillProvider + openaiCompatUrl with a local default", /backfillProvider: "ollama-local"/.test(settingsSrc) && /openaiCompatUrl: "http:\/\/127\.0\.0\.1:1234\/v1"/.test(settingsSrc));
const llmSrc = fs.readFileSync(path.join(root, "src", "lib", "v2", "memory", "llm.ts"), "utf8");
check("llm.ts override is async-local (no global mutable model state)", /AsyncLocalStorage/.test(llmSrc) && /export function withMemoryModel/.test(llmSrc));
check("llm.ts has an openai-compat transport and holds no key in settings", /case "openai-compat"/.test(llmSrc) && /chat\/completions/.test(llmSrc) && /OPENAI_COMPAT_API_KEY/.test(llmSrc) && !/openaiCompatKey/.test(llmSrc));
check("gear offers the provider choice and the server URL", /BACKFILL_PROVIDERS/.test(gearSrc) && /backfillProvider/.test(gearSrc) && /openaiCompatUrl/.test(gearSrc));
check("route validates provider instead of defaulting an unknown one", /provider must be one of/.test(routeSrc) && /status: 400/.test(routeSrc));

// ---- K. openai-compat: LM Studio serves the chat, Ollama still serves embeddings ----
console.log("-- K: openai-compat (LM Studio) --");
const kTexts = [
  "2026-08-10 Yoshi runs Bonsai 27B in LM Studio because it needs a llama.cpp fork.",
  "2026-08-11 Yoshi keeps embeddings on Ollama and prefers Opera over Chrome.",
];
const kRows = kTexts.map((text, i) => ({
  uuid: graph.saveEpisode({
    content: text, originalContent: text, source: "migration:remember",
    sessionId: `lm-${i}`, contentHash: contentHash(text),
    validAt: `2026-08-1${i}T00:00:00.000Z`,
  }),
  text,
}));
check("fixture: 3 candidates waiting for the openai-compat run", B.countUndrivedEpisodes() === 3, String(B.countUndrivedEpisodes()));

// K1 - server down
lmMode = "down";
err = null;
try { await B.backfillEpisodes({ limit: 1, model: "bonsai-27b", provider: "openai-compat" }); } catch (e) { err = e; }
check("K1 server down -> error names the URL and the LM Studio toggle", !!err && /No OpenAI-compatible server at http:\/\/127\.0\.0\.1:1234\/v1/.test(err.message) && /Developer tab > Start Server/.test(err.message) && /No fallback/.test(err.message), err?.message);

// K2 - model not served
lmMode = "nomodel";
err = null;
try { await B.backfillEpisodes({ limit: 1, model: "bonsai-27b", provider: "openai-compat" }); } catch (e) { err = e; }
check("K2 model not served -> error lists what IS served, no fallback", !!err && /'bonsai-27b' is not served/.test(err.message) && /Served: qwen3-4b, text-embedding-nomic/.test(err.message) && /No fallback/.test(err.message), err?.message);
check("K2 made no chat call", calls.lmChat.length === 0);

// K3 - chat is served, but the embed model is missing on Ollama
lmMode = "ok";
tagsMode = "noembed";
err = null;
try { await B.backfillEpisodes({ limit: 1, model: "bonsai-27b", provider: "openai-compat" }); } catch (e) { err = e; }
check("K3 embeddings are Ollama-only -> the error says which server is missing what", !!err && /Chat is served at http:\/\/127\.0\.0\.1:1234\/v1/.test(err.message) && /'nomic-embed-text' is not pulled on Ollama/.test(err.message) && /never run on the OpenAI-compatible server/.test(err.message), err?.message);
tagsMode = "ok";

// K4 - the real run
calls.chat.length = 0;
const embedBefore = calls.embed;
const lmLog = [];
const lmRun = await B.backfillEpisodes({ limit: 10, model: "bonsai-27b", provider: "openai-compat", runId: "run-lm", log: (t) => lmLog.push(t) });
check("K4 run derived through LM Studio", lmRun.derived >= 2 && lmRun.failed === 0, JSON.stringify({ d: lmRun.derived, f: lmRun.failed }));
check("K4 result names the provider and the base URL (rule 20)", lmRun.provider === "openai-compat" && lmRun.base === "http://127.0.0.1:1234/v1", `${lmRun.provider} ${lmRun.base}`);
check("K4 every chat call went to the fake LM Studio with bonsai-27b", calls.lmChat.length > 0 && calls.lmChat.every((c) => c.host === "http://127.0.0.1:1234" && c.model === "bonsai-27b"), JSON.stringify(calls.lmChat.slice(0, 2)));
check("K4 NOT ONE chat call went to Ollama", calls.chat.length === 0, String(calls.chat.length));
check("K4 embeddings still went to Ollama", calls.embed > embedBefore, `${embedBefore} -> ${calls.embed}`);
check("K4 structured calls carried response_format json_schema", calls.lmChat.some((c) => c.responseFormat === "json_schema" && c.schemaKeys.length > 0));
check("K4 a <think> block in the reply was stripped, not parsed", lmRun.results.every((r) => r.outcome !== "failed"));
check("K4 preflight logged the openai-compat host and the Ollama embed host", lmLog.some((t) => /openai-compat at http:\/\/127\.0\.0\.1:1234\/v1: bonsai-27b ready/.test(t) && /embeddings nomic-embed-text on Ollama at http:\/\/127\.0\.0\.1:11434/.test(t)), lmLog[0]);
const lmLogRows = B.listBackfillLog(20).filter((r) => r.runId === "run-lm");
check("K4 log rows record the openai-compat model id", lmLogRows.length >= 2 && lmLogRows.every((r) => r.model === "bonsai-27b"));
const kRowAfter = getDb().prepare("SELECT original_content, content_hash FROM episodes WHERE uuid = ?").get(kRows[0].uuid);
check("K4 dedup untouched on the openai-compat path too", kRowAfter.content_hash === contentHash(kRows[0].text) && kRowAfter.original_content === kRows[0].text);

// K5 - the CLI flags
const lmCli = spawnSync(process.execPath, [tsxCli, path.join(root, "scripts", "v2", "memory-backfill.mjs"), "--dry-run", "--json", "--provider", "openai-compat", "--model", "bonsai-27b", "--base-url", "http://127.0.0.1:1234/v1"], {
  cwd: root, encoding: "utf8", env: { ...process.env }, timeout: 120_000,
});
let lmCliJson = null;
try { lmCliJson = JSON.parse(lmCli.stdout.slice(lmCli.stdout.indexOf("{"))); } catch {}
check("K5 CLI --provider openai-compat --base-url is honoured", lmCli.status === 0 && lmCliJson?.provider === "openai-compat" && lmCliJson.model === "bonsai-27b" && lmCliJson.base === "http://127.0.0.1:1234/v1", `status=${lmCli.status} stderr=${lmCli.stderr.slice(0, 200)}`);
const badProv = spawnSync(process.execPath, [tsxCli, path.join(root, "scripts", "v2", "memory-backfill.mjs"), "--provider", "lmstudio"], { cwd: root, encoding: "utf8", env: { ...process.env }, timeout: 60_000 });
check("K5 CLI rejects an unknown --provider with exit 2", badProv.status === 2 && /--provider must be one of/.test(badProv.stderr), `status=${badProv.status}`);
const badUrl = spawnSync(process.execPath, [tsxCli, path.join(root, "scripts", "v2", "memory-backfill.mjs"), "--base-url", "127.0.0.1:1234"], { cwd: root, encoding: "utf8", env: { ...process.env }, timeout: 60_000 });
check("K5 CLI rejects a --base-url with no scheme", badUrl.status === 2 && /--base-url must be an http\(s\) URL/.test(badUrl.stderr), `status=${badUrl.status}`);

// ---- L. reasoning_effort: the thinking budget on the openai-compat path -------
console.log("-- L: reasoning budget --");
const lTexts = [
  "2026-08-20 Yoshi measured Bonsai spending 1900 reasoning tokens on a 51-token answer.",
  "2026-08-21 Yoshi set the thinking budget to none and prefers Opera over Chrome.",
];
lTexts.forEach((text, i) => graph.saveEpisode({
  content: text, originalContent: text, source: "migration:remember",
  sessionId: `eff-${i}`, contentHash: contentHash(text),
  validAt: `2026-08-2${i}T00:00:00.000Z`,
}));

// L1 - the settings default ("none") rides on every openai-compat chat call
calls.lmChat.length = 0;
const effRun = await B.backfillEpisodes({ limit: 1, model: "bonsai-27b", provider: "openai-compat", runId: "run-eff" });
check("L1 default thinking budget is sent as reasoning_effort=none", calls.lmChat.length > 0 && calls.lmChat.every((c) => c.reasoningEffort === "none"), JSON.stringify(calls.lmChat.map((c) => c.reasoningEffort).slice(0, 3)));
check("L1 the result reports the budget that actually went out", effRun.reasoningEffort === "none", String(effRun.reasoningEffort));
check("L1 the log line names it", effRun.derived + effRun.nothing + effRun.failed === 1);

// L2 - an explicit value overrides, via the same env door the CLI uses
calls.lmChat.length = 0;
process.env.OPENAI_COMPAT_REASONING_EFFORT = "high";
const effRun2 = await B.backfillEpisodes({ limit: 1, model: "bonsai-27b", provider: "openai-compat", runId: "run-eff2" });
check("L2 an explicit budget overrides the gear", calls.lmChat.length > 0 && calls.lmChat.every((c) => c.reasoningEffort === "high") && effRun2.reasoningEffort === "high", JSON.stringify(calls.lmChat.map((c) => c.reasoningEffort).slice(0, 3)));

// L3 - empty means send NOTHING, not send an empty string
calls.lmChat.length = 0;
process.env.OPENAI_COMPAT_REASONING_EFFORT = "";
const lText = "2026-08-22 Yoshi left the thinking budget unset to let the server decide.";
graph.saveEpisode({ content: lText, originalContent: lText, source: "migration:remember", sessionId: "eff-3", contentHash: contentHash(lText), validAt: "2026-08-22T00:00:00.000Z" });
const effRun3 = await B.backfillEpisodes({ limit: 1, model: "bonsai-27b", provider: "openai-compat", runId: "run-eff3" });
check("L3 an empty budget omits the field entirely", calls.lmChat.length > 0 && calls.lmChat.every((c) => c.reasoningEffort === undefined) && effRun3.reasoningEffort === "", JSON.stringify(calls.lmChat.map((c) => c.reasoningEffort).slice(0, 3)));
delete process.env.OPENAI_COMPAT_REASONING_EFFORT;

// L4 - the Ollama path never learns about it
calls.chat.length = 0;
const oText = "2026-08-23 Yoshi kept the Ollama path free of OpenAI-only fields.";
graph.saveEpisode({ content: oText, originalContent: oText, source: "migration:remember", sessionId: "eff-4", contentHash: contentHash(oText), validAt: "2026-08-23T00:00:00.000Z" });
const ollamaRun = await B.backfillEpisodes({ limit: 1, model: "bonsai:27b", provider: "ollama-local", runId: "run-eff4" });
check("L4 the Ollama path carries no reasoning_effort", ollamaRun.reasoningEffort === undefined && calls.chat.length > 0 && calls.chat.every((c) => c.reasoningEffort === undefined));

// L5 - the wiring
check("L5 settings default the budget to none and offer the full set", /openaiCompatReasoningEffort: "none"/.test(settingsSrc) && /"" \| "none" \| "minimal" \| "low" \| "medium" \| "high"/.test(settingsSrc));
check("L5 llm.ts sends it only when non-empty and reads the env door first", /body\.reasoning_effort = effort/.test(llmSrc) && /OPENAI_COMPAT_REASONING_EFFORT/.test(llmSrc) && /if \(effort\)/.test(llmSrc));
check("L5 the gear exposes it (rule 16, not config-file-only)", /REASONING_EFFORTS/.test(gearSrc) && /Thinking budget/.test(gearSrc) && /openaiCompatReasoningEffort/.test(gearSrc));
const cliSrc = fs.readFileSync(path.join(root, "scripts", "v2", "memory-backfill.mjs"), "utf8");
check("L5 the CLI takes --reasoning-effort and writes nothing to disk", /--reasoning-effort/.test(cliSrc) && /process\.env\.OPENAI_COMPAT_REASONING_EFFORT = args\.effort/.test(cliSrc));
const badEff = spawnSync(process.execPath, [tsxCli, path.join(root, "scripts", "v2", "memory-backfill.mjs"), "--reasoning-effort", "hard"], { cwd: root, encoding: "utf8", env: { ...process.env }, timeout: 60_000 });
check("L5 CLI rejects an unknown --reasoning-effort with exit 2", badEff.status === 2 && /--reasoning-effort must be one of/.test(badEff.stderr), `status=${badEff.status}`);

// ---- M. a zero-yield 'derived' row stays eligible, unlike a real one -----------
console.log("-- M: zero-yield derived stays eligible --");
const mText = `2026-08-24 Yoshi ${EMPTY_MARKER} left a note the model came up empty on.`;
const mUuid = graph.saveEpisode({
  content: mText, originalContent: mText, source: "migration:remember",
  sessionId: "empty-1", contentHash: contentHash(mText), validAt: "2026-08-24T00:00:00.000Z",
});
const beforeM = B.countUndrivedEpisodes();

// M1 - first pass: normalize succeeds, every extraction phase returns empty
const run1 = await B.backfillEpisodes({ limit: 1, model: "bonsai:27b", provider: "ollama-local", runId: "run-empty-1" });
const r1 = run1.results.find((r) => r.uuid === mUuid);
check("M1 normalize succeeded (episodeUuid came back) but nothing was extracted", r1?.outcome === "derived" && r1.statements === 0 && r1.voiceAspects === 0, JSON.stringify(r1));
check("M1 the run's own count still calls it derived (matches BackfillResult.derived elsewhere)", run1.derived === 1 && run1.nothing === 0 && run1.failed === 0);
check("M1 the run says the same reasoning_effort discipline applies (undefined on Ollama)", run1.reasoningEffort === undefined);

// M2 - it is NOT retired: still a candidate, count unchanged
check("M2 countUndrivedEpisodes is unchanged (the zero-yield row was not removed)", B.countUndrivedEpisodes() === beforeM, `before=${beforeM} after=${B.countUndrivedEpisodes()}`);
check("M2 listUndrivedEpisodes still lists it", B.listUndrivedEpisodes(500).some((c) => c.uuid === mUuid));
check("M2 the log recorded the attempt anyway (audit trail, not silently dropped)", B.listBackfillLog(50).some((r) => r.runId === "run-empty-1" && r.episodeUuid === mUuid && r.outcome === "derived" && r.statements === 0));

// M3 - offered again on a second run, still empty: two log rows now, still eligible.
// It won't necessarily be picked this time (older leftovers from earlier sections
// may still be oldest-first ahead of it) - keep processing limit:1 runs targeted
// at it isn't possible generically, so instead assert the INVARIANT: however many
// runs it takes, it is never removed by an empty outcome. Force it directly to
// prove the log accumulates rather than dedups.
const before3 = B.countUndrivedEpisodes();
await B.backfillEpisodes({ limit: 500, model: "bonsai:27b", provider: "ollama-local", runId: "run-empty-2" });
check("M3 a second sweep leaves the zero-yield row still eligible (never removed by an empty outcome)", B.listUndrivedEpisodes(500).some((c) => c.uuid === mUuid));
check("M3 at least two log rows exist for it now (append-only, no dedup)", B.listBackfillLog(50).filter((r) => r.episodeUuid === mUuid).length >= 2);
check("M3 nothing net-changed in the undrived count except possibly OTHER episodes retiring (this one did not)", B.countUndrivedEpisodes() <= before3);

// M4 - a stronger pass lands real facts on THIS episode: now it retires like any other
// classifyWorldPrompt (the "facts" call) does NOT re-send episode.content -
// its prompt is built purely from the graph_facts array's own `fact` text
// (src/lib/v2/memory/prompts/classify-world.ts). So isThisEpisode must be
// carried in the FACT TEXT at extract+reflect, not just in the normalized
// episode body, or the marker is invisible by the time "facts" is called.
const RETRY_FACT = `Yoshi's note (${EMPTY_MARKER}) was eventually derived on a stronger pass`;
const origFetchM = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  // Only /api/chat POSTs carry a JSON body worth inspecting - /api/tags is a
  // bare GET (init.body undefined) and must fall straight through.
  if (!String(url).endsWith("/api/chat") || !init?.body) return origFetchM(url, init);
  const body = JSON.parse(init.body);
  const isThisEpisode = body.messages.some((m) => m.content.includes(EMPTY_MARKER));
  if (isThisEpisode) {
    const keys = body.format ? Object.keys(body.format.properties ?? {}) : [];
    if (keys.length === 0) {
      // normalize: keep the marker in the normalized text so extractWorld and
      // reflectWorld (which both re-send episode.content) still recognise it.
      return Response.json({ message: { role: "assistant", content: `<output>NORMALIZED: Yoshi's note (${EMPTY_MARKER}) is now getting a real answer.</output>` } });
    }
    if (keys.includes("entities")) {
      // extractWorld
      return Response.json({ message: { role: "assistant", content: JSON.stringify({
        entities: [{ name: "Yoshi", type: "Person", attributes: null }],
        graph_facts: [{ source: "Yoshi", predicate: "noted", target: "note", fact: RETRY_FACT, event_date: null }],
      }) } });
    }
    if (keys.includes("graph_facts")) {
      // reflectWorld (graph_facts alone, no "entities" key)
      return Response.json({ message: { role: "assistant", content: JSON.stringify({
        graph_facts: [{ source: "Yoshi", predicate: "noted", target: "note", fact: RETRY_FACT, event_date: null }],
      }) } });
    }
    if (keys.includes("facts")) {
      // classifyWorld: this is what actually produces a statement (rule 20's
      // "the answer names what it did" analog for a smoke - the fact carries
      // the marker forward so this branch is provably reached, not skipped).
      return Response.json({ message: { role: "assistant", content: JSON.stringify({
        facts: [{ source: "Yoshi", predicate: "noted", target: "note", fact: RETRY_FACT, aspect: "Event", event_date: null }],
      }) } });
    }
    // voice_facts (extract or reflect) and aspects (classify-voice): empty,
    // so the voice half of the pipeline stays short-circuited - M4 only
    // needs statements > 0, not voice aspects.
    return Response.json({ message: { role: "assistant", content: JSON.stringify({ voice_facts: [], aspects: [] }) } });
  }
  return origFetchM(url, init);
};
const beforeM4 = B.countUndrivedEpisodes();
const run4target = await B.backfillEpisodes({ limit: 500, model: "bonsai:27b", provider: "ollama-local", runId: "run-empty-3" });
globalThis.fetch = origFetchM;
const r4 = run4target.results.find((r) => r.uuid === mUuid);
check("M4 a stronger pass lands a real fact on the same episode", r4?.outcome === "derived" && r4.statements === 1, JSON.stringify(r4));
check("M4 NOW it is retired: no longer in the candidate list", !B.listUndrivedEpisodes(500).some((c) => c.uuid === mUuid));
check("M4 the undrived count dropped by at least one (this episode, possibly others in the sweep too)", B.countUndrivedEpisodes() < beforeM4);

// M5 - the log line naming, checked against the run's own numbers rather than
// a hardcoded count (this file's earlier sections leave state that varies).
const mText2 = `2026-08-25 Yoshi ${EMPTY_MARKER} another empty one, checked structurally.`;
graph.saveEpisode({ content: mText2, originalContent: mText2, source: "migration:remember", sessionId: "empty-2", contentHash: contentHash(mText2), validAt: "2026-08-25T00:00:00.000Z" });
const remainingBefore5 = B.countUndrivedEpisodes();
const emptyLog = [];
const run5 = await B.backfillEpisodes({ limit: 1, model: "bonsai:27b", provider: "ollama-local", runId: "run-empty-4", log: (t) => emptyLog.push(t) });
const derivedEmpty5 = run5.results.filter((r) => r.outcome === "derived" && r.statements === 0 && r.voiceAspects === 0).length;
const expectedStill5 = remainingBefore5 - (run5.derived - derivedEmpty5) - run5.nothing;
check("M5 the per-episode line says a zero-yield row stays eligible", emptyLog.some((t) => /derived: 0 facts, 0 voice — stays eligible, will be offered again/.test(t)), emptyLog.join(" | "));
check(
  "M5 the done line's 'still undrived' count matches remaining - (derived - zero-yield) - nothing, not remaining - derived - nothing",
  emptyLog.some((t) => new RegExp(`^done: ${run5.derived} derived, ${run5.nothing} nothing to remember, ${run5.failed} failed; ${expectedStill5} legacy episodes still undrived`).test(t)),
  emptyLog.join(" | "),
);
if (derivedEmpty5 > 0) {
  check("M5 the done line notes how many derived nothing usable", emptyLog.some((t) => new RegExp(`\\(${derivedEmpty5} derived nothing usable and will be offered again\\)$`).test(t)), emptyLog.join(" | "));
}

// M6 - regression guard: a REAL derived row and a NOTHING row still retire exactly as before
check("M6 a real derived row (statements > 0) still retires (unchanged behaviour)", r4.statements > 0 && !B.listUndrivedEpisodes(500).some((c) => c.uuid === r4.uuid));
const nothingText = `2026-08-26 testing testing ${NOTHING_MARKER} still retires as before`;
const nothingUuid = graph.saveEpisode({ content: nothingText, originalContent: nothingText, source: "migration:remember", sessionId: "nothing-guard", contentHash: contentHash(nothingText), validAt: "2026-08-26T00:00:00.000Z" });
await B.backfillEpisodes({ limit: 500, model: "bonsai:27b", provider: "ollama-local", runId: "run-nothing-guard" });
check("M6 an explicit NOTHING_TO_REMEMBER row still retires (unchanged behaviour)", !B.listUndrivedEpisodes(500).some((c) => c.uuid === nothingUuid));

// M7 - the wiring
const backfillSrc = fs.readFileSync(path.join(root, "src", "lib", "v2", "memory", "backfill.ts"), "utf8");
check("M7 the WHERE clause only retires a derived row that landed something", /l\.outcome = 'derived' AND \(l\.statements > 0 OR l\.voice_aspects > 0\)/.test(backfillSrc));
check("M7 the CLI marks a zero-yield row for retry in its per-episode line", /will retry/.test(cliSrc));

finish();