// A2.4–A2.8 smoke: THE ingestion-pipeline gate.
//   OFFLINE (always): queue validation, kill-switch, retry accounting,
//     rules seam (getActiveRuleTexts), resolveLabelNames exact+create ladder.
//   ONLINE (needs local Ollama for embeddings + an LLM provider): full
//     end-to-end ingestFromModule → queue → preprocess/ingest/resolution/labels
//     → COMPLETED, then a CONTRADICTION episode → old fact invalidated.
// Run: npx tsx scripts/v2/smoke-ingest.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-ingest-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ingest-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;

// Mirror Next's .env loading for OLLAMA_API_KEY (cloud LLM path)
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), envFile), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const queue = await import("../../src/lib/v2/memory/queue.ts");
const rules = await import("../../src/lib/v2/memory/rules.ts");
const labels = await import("../../src/lib/v2/memory/labels.ts");
const vector = await import("../../src/lib/v2/memory/vector.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};
const writeSettings = (memory) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ memory }, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = () => {
  queue.stopMemoryQueue();
  __closeForTests();
  try {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(tmp + "-wal", { force: true });
    fs.rmSync(tmp + "-shm", { force: true });
    fs.rmSync(settingsDir, { recursive: true, force: true });
  } catch {}
};
const finish = (code) => {
  cleanup();
  console.log(
    failures === 0 ? "\nsmoke-ingest: ALL PASS" : `\nsmoke-ingest: ${failures} FAILURES`,
  );
  process.exit(failures === 0 ? 0 : code);
};

ensureDb();

// ===========================================================================
// OFFLINE checks
// ===========================================================================
console.log("--- offline: queue validation ---");
let threw = false;
try {
  queue.addToQueue({ episodeBody: "too short", source: "smoke", sessionId: "s1" });
} catch {
  threw = true;
}
check("addToQueue rejects episodeBody < 20 chars", threw);

threw = false;
try {
  queue.addToQueue({ episodeBody: "long enough body for the validator to accept", source: "smoke" });
} catch {
  threw = true;
}
check("addToQueue rejects missing sessionId", threw);

console.log("--- offline: rules seam (A2.8) ---");
const ruleA = rules.createRule({ text: "never remember testing chatter", source: "smoke", name: "No Test Noise" });
const ruleB = rules.createRule({ text: "always capture decisions verbatim" });
rules.createRule({ text: "this rule is inactive", isActive: false });
const smokeRules = rules.getActiveRuleTexts("smoke") ?? "";
check("getActiveRuleTexts(source) includes source-scoped rule", smokeRules.includes("never remember testing chatter"));
check("getActiveRuleTexts(source) includes NULL-source rule", smokeRules.includes("always capture decisions verbatim"));
check("getActiveRuleTexts(source) excludes inactive rules", !smokeRules.includes("this rule is inactive"));
check("named rule renders as 'Name: text'", smokeRules.includes("No Test Noise: never remember"));
const otherRules = rules.getActiveRuleTexts("other") ?? "";
check("other source sees only NULL-source rules", otherRules.includes("always capture") && !otherRules.includes("never remember testing chatter"));
check("no rules -> null path (fresh listRules count = 3)", rules.listRules().length === 3);

console.log("--- offline: resolveLabelNames ladder (A2.7) ---");
const ids1 = await labels.resolveLabelNames(["Legacy", "legacy", "Smoke Test"]);
check("NOCASE dedupe: 3 names -> 2 ids", ids1.length === 2);
const ids2 = await labels.resolveLabelNames(["LEGACY", "Smoke Test"]);
check("second resolve reuses existing ids", ids2.every((id) => ids1.includes(id)));
const legacyLabel = labels.getLabelByName("legacy");
check("label created with OKLCH color", !!legacyLabel && /^oklch\(/.test(legacyLabel.color));

console.log("--- offline: kill-switch + retry accounting (A2.4) ---");
writeSettings({ ingestEnabled: false });
const { queueId: killId } = queue.addToQueue({
  episodeBody: "this row exists to test the master kill-switch behavior",
  source: "smoke",
  sessionId: "kill-switch-session",
});
await queue.drainMemoryQueueOnce();
await sleep(100);
const killRow = () => getDb().prepare("SELECT status, retry_count FROM ingestion_queue WHERE id = ?").get(killId);
check("kill-switch leaves row PENDING", killRow().status === "PENDING");

// retry accounting: force the row FAILED, then retry to the cap
getDb().prepare("UPDATE ingestion_queue SET status = 'FAILED' WHERE id = ?").run(killId);
for (let i = 1; i <= 3; i++) {
  const r = queue.retryQueueItem(killId);
  check(`retry ${i} -> PENDING with retry_count ${i}`, killRow().status === "PENDING" && r.retryCount === i);
  getDb().prepare("UPDATE ingestion_queue SET status = 'FAILED' WHERE id = ?").run(killId);
}
threw = false;
try {
  queue.retryQueueItem(killId);
} catch (e) {
  threw = String(e).includes("exhausted");
}
check("4th retry refused (cap 3)", threw);

// Park the offline test rules so they can't veto the online ingest
rules.updateRule(ruleA.id, { isActive: false });
rules.updateRule(ruleB.id, { isActive: false });
check("updateRule deactivates (rules parked for online path)", rules.getActiveRuleTexts("smoke") === null);

// ===========================================================================
// ONLINE path — needs Ollama (embeddings) + an LLM provider
// ===========================================================================
console.log("--- online probe ---");
let ollamaUp = false;
try {
  const probe = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) });
  ollamaUp = probe.ok;
} catch {}

if (!ollamaUp) {
  console.log("SKIP  local Ollama not reachable at 127.0.0.1:11434 — ONLINE pipeline checks skipped.");
  console.log("      Start Ollama (`ollama serve`, `ollama pull nomic-embed-text`) and re-run for the full gate.");
  finish(1);
}

// Pick an LLM provider: cloud when OLLAMA_API_KEY is present, else a local chat model
let provider = null;
let modelLow = "";
let modelMedium = "";
if (process.env.OLLAMA_API_KEY) {
  provider = "ollama-cloud";
  modelLow = process.env.SMOKE_MODEL_LOW || "kimi-k2.6:cloud";
  modelMedium = process.env.SMOKE_MODEL_MEDIUM || "glm-5.2:cloud";
} else {
  try {
    const tags = await (await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) })).json();
    const chat = (tags.models || [])
      .map((m) => m.name)
      .filter((n) => !/embed|bge|minilm/i.test(n));
    const preferred = chat.find((n) => /glm|kimi|qwen|llama|gemma|mistral|deepseek/i.test(n)) || chat[0];
    if (preferred) {
      provider = "ollama-local";
      modelLow = modelMedium = preferred;
    }
  } catch {}
}

if (!provider) {
  console.log("SKIP  no LLM provider available (no OLLAMA_API_KEY, no local chat model) — ONLINE checks skipped.");
  finish(1);
}
console.log(`      provider=${provider} modelLow=${modelLow} modelMedium=${modelMedium}`);

// Embed sanity (also fails fast when nomic-embed-text isn't pulled)
try {
  const { getEmbedding } = await import("../../src/lib/v2/memory/embed.ts");
  writeSettings({ ingestEnabled: true, provider, modelLow, modelMedium, embedProvider: "ollama-local", embedModel: "nomic-embed-text" });
  await getEmbedding("smoke probe");
} catch (e) {
  console.log(`SKIP  embeddings unavailable (${e.message}) — ONLINE checks skipped.`);
  finish(1);
}

const db = getDb();
const waitForQueue = async (queueId, timeoutMs) => {
  const start = Date.now();
  for (;;) {
    const row = db.prepare("SELECT status, stage, error FROM ingestion_queue WHERE id = ?").get(queueId);
    if (row && (row.status === "COMPLETED" || row.status === "FAILED")) return row;
    if (Date.now() - start > timeoutMs) return row ?? { status: "MISSING" };
    await sleep(500);
  }
};

console.log("--- online: end-to-end ingest ---");
const { queueId: q1 } = await queue.ingestFromModule({
  episodeBody: "Yoshi decided to use SQLite for the V2 store. He prefers pnpm over npm.",
  source: "smoke",
  sourceURL: "https://example.local/smoke",
  labelNames: ["Smoke Test"],
});
void queue.drainMemoryQueueOnce();
const row1 = await waitForQueue(q1, 300_000);
check("ingest #1 COMPLETED", row1.status === "COMPLETED", `status=${row1.status} stage=${row1.stage} error=${row1.error}`);

const episodes1 = db.prepare("SELECT * FROM episodes WHERE queue_id = ?").all(q1);
check("episode row exists", episodes1.length >= 1);
check(
  "original_content preserved verbatim",
  episodes1.some((e) => e.original_content === "Yoshi decided to use SQLite for the V2 store. He prefers pnpm over npm."),
);
const entityCount = db.prepare("SELECT COUNT(*) c FROM entities").get().c;
const statementCount = db.prepare("SELECT COUNT(*) c FROM statements").get().c;
const voiceCount = db.prepare("SELECT COUNT(*) c FROM voice_aspects").get().c;
const edgeCount = db.prepare("SELECT COUNT(*) c FROM edges").get().c;
check(`entities extracted (${entityCount})`, entityCount >= 1);
check(`statements or voice aspects extracted (st=${statementCount} va=${voiceCount})`, statementCount >= 1 || voiceCount >= 1);
check(`edges present (${edgeCount})`, edgeCount >= 1);
check("episode embedding stored", vector.count("episode") >= 1);
check(
  `statement/voice embeddings stored (st=${vector.count("statement")} va=${vector.count("voice_aspect")})`,
  vector.count("statement") + vector.count("voice_aspect") >= 1,
);
const labelJoins = db
  .prepare(
    "SELECT COUNT(*) c FROM episode_labels el JOIN episodes e ON e.uuid = el.episode_uuid WHERE e.queue_id = ?",
  )
  .get(q1).c;
check("labels resolved onto episode (episode_labels)", labelJoins >= 1);
const ingestedEvent = db
  .prepare("SELECT payload FROM events WHERE type = 'memory.ingested' ORDER BY id DESC LIMIT 5")
  .all()
  .some((r) => r.payload.includes(q1));
check("'memory.ingested' event emitted", ingestedEvent);

console.log("--- online: contradiction -> temporal chain (A3 seam) ---");
const { queueId: q2 } = await queue.ingestFromModule({
  episodeBody: "Correction: Yoshi now prefers npm over pnpm. He no longer prefers pnpm.",
  source: "smoke",
  labelNames: ["Smoke Test"],
});
void queue.drainMemoryQueueOnce();
const row2 = await waitForQueue(q2, 300_000);
check("ingest #2 COMPLETED", row2.status === "COMPLETED", `status=${row2.status} stage=${row2.stage} error=${row2.error}`);

const invalidatedFacts = db
  .prepare(
    `SELECT fact, valid_at, invalid_at, 'statement' AS kind FROM statements WHERE invalid_at IS NOT NULL AND fact LIKE '%pnpm%'
     UNION ALL
     SELECT fact, valid_at, invalid_at, 'voice' AS kind FROM voice_aspects WHERE invalid_at IS NOT NULL AND fact LIKE '%pnpm%'`,
  )
  .all();
const currentFacts = db
  .prepare(
    `SELECT fact, valid_at, 'statement' AS kind FROM statements WHERE invalid_at IS NULL AND (fact LIKE '%npm%' OR fact LIKE '%pnpm%')
     UNION ALL
     SELECT fact, valid_at, 'voice' AS kind FROM voice_aspects WHERE invalid_at IS NULL AND (fact LIKE '%npm%' OR fact LIKE '%pnpm%')`,
  )
  .all();
console.log("      invalidated:", invalidatedFacts.map((f) => `[${f.kind}] "${f.fact}" (invalid_at ${f.invalid_at})`).join(" | ") || "(none)");
console.log("      current   :", currentFacts.map((f) => `[${f.kind}] "${f.fact}"`).join(" | ") || "(none)");
check("old pnpm preference invalidated (invalid_at set)", invalidatedFacts.length >= 1);
check("new preference current (invalid_at NULL)", currentFacts.length >= 1);

finish(1);
