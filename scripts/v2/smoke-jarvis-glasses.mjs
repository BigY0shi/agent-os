// Smoke: the Even Realities G2 glasses lane (/api/glasses → Jarvis V2).
// Offline: temp DB/settings/token, Jarvis on the cli engine with an injected
// deterministic answer function — no network, no dev server, no live CLI.
//   A. token: absent → 503; rotate persists a HASH only (plaintext never on disk);
//      bad/missing token → 401; Bearer and bare forms accepted
//   B. lane switched off → 403 even with a valid token
//   C. the captured Even request (model "openclaw", one user message) → a
//      chat.completion whose content is the Jarvis answer, read back from the DB
//   D. path variants (bare, /v1, /v1/chat/completions) accepted; unknown → 404;
//      GET /v1/models lists the lane's model
//   E. conversation continuity: a second request inside idleMinutes threads the
//      same origin='glasses' conversation (the prompt carries the prior turn);
//      after the idle window a fresh conversation starts
//   F. reply shaping: <reply_surface> reaches the prompt; markdown stripped;
//      word cap enforced with a visible "…"
//   G. failures are loud: stream:true → 400, brain error → 502, no canned answer
//   H. proxy exemption present and scoped; settings side stays cookie-gated;
//      tripwire: no fetch ever leaves loopback
// Run: npx tsx scripts/v2/smoke-jarvis-glasses.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any imports — never touch the live DB/settings/token ────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-glasses-"));
process.env.AGENTIC_OS_DB = path.join(tmp, "agentos.db");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_GLASSES_TOKEN = path.join(tmp, "jarvis-glasses.token");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_JARVIS_DIR = path.join(tmp, "jarvis"); // S16: brain reads Jarvis's MCP servers
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTOS_MOCK_LLM = "1";
// Memory recall/ingest default to Ollama Cloud. Keep them local and point the
// local daemon at a closed port so every memory call fails fast (the Jarvis
// lane continues without memory, loudly) — and drop any cloud key the shell has.
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.OLLAMA_API_KEY;
delete process.env.OLLAMA_CLOUD_KEY;

// Tripwire: record every outbound fetch that is not loopback. Must stay empty.
const offHost = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) offHost.push(url);
  return realFetch(input, init);
};

const writeSettings = (glasses) =>
  fs.writeFileSync(
    process.env.AGENTIC_OS_SETTINGS,
    JSON.stringify(
      {
        jarvis: { engine: "cli", cliAgent: "claude", glasses },
        memory: {
          provider: "ollama-local",
          embedProvider: "ollama-local",
          ingestEnabled: false,
          compactionEnabled: false,
          personaAutoUpdate: false,
        },
      },
      null,
      2,
    ),
  );
writeSettings({ enabled: true, maxWords: 60, idleMinutes: 10, timeoutSeconds: 20 });

const route = await import("../../src/app/api/glasses/[[...path]]/route.ts");
const cfgRoute = await import("../../src/app/api/v2/jarvis/glasses/route.ts");
const glasses = await import("../../src/lib/v2/jarvis/glasses.ts");
const brain = await import("../../src/lib/v2/jarvis/brain.ts");
const conv = await import("../../src/lib/v2/jarvis/conversations.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 400)}` : ""}`);
  if (!cond) failures++;
};

// The exact body captured from the Even app on 2026-09-22.
const evenBody = (content) => ({ model: "openclaw", messages: [{ role: "user", content }] });
const post = (sub, { auth, body } = {}) =>
  route.POST(
    new Request(`http://127.0.0.1/api/glasses${sub}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "EvenCore/1.0",
        "x-openclaw-agent-id": "main",
        ...(auth ? { authorization: auth } : {}),
      },
      body: JSON.stringify(body ?? evenBody("ping")),
    }),
  );

// Deterministic brain: records every prompt, answers from a queue.
const prompts = [];
let nextAnswer = "Default answer.";
brain.setJarvisCliForTests(async (prompt) => {
  prompts.push(prompt);
  return nextAnswer;
});

try {
  // ── A. token lifecycle ────────────────────────────────────────────────────
  console.log("--- A. token ---");
  {
    const r = await post("/v1", { auth: "Bearer whatever" });
    check("A1 no token minted → 503", r.status === 503, r.status);
    const st = await (await cfgRoute.GET()).json();
    check("A2 status: configured false, no key material", st.configured === false && !("token" in st), st);
  }
  const minted = await (await cfgRoute.POST(new Request("http://x/api/v2/jarvis/glasses", {
    method: "POST", body: JSON.stringify({ action: "rotate" }),
  }))).json();
  const token = minted.token;
  check("A3 rotate returns a token once", typeof token === "string" && token.startsWith("aog_") && token.length > 20, minted);
  {
    const onDisk = fs.readFileSync(process.env.AGENTIC_OS_GLASSES_TOKEN, "utf8").trim();
    check("A4 token file holds a sha256 hash, not the plaintext", /^[0-9a-f]{64}$/.test(onDisk) && !onDisk.includes(token.slice(4)), onDisk);
    const st = await (await cfgRoute.GET()).json();
    check("A5 status GET never returns the token", st.configured === true && !JSON.stringify(st).includes(token), st);
  }
  {
    const r1 = await post("/v1");
    check("A6 missing Authorization → 401", r1.status === 401, r1.status);
    const r2 = await post("/v1", { auth: "Bearer aog_wrong" });
    const j2 = await r2.json();
    check("A7 wrong token → 401 in OpenAI error shape", r2.status === 401 && j2?.error?.type === "authentication_error", j2);
    const bad = await cfgRoute.POST(new Request("http://x", { method: "POST", body: "{}" }));
    check("A8 settings POST without action → 400", bad.status === 400, bad.status);
  }

  // ── B. lane switched off ──────────────────────────────────────────────────
  console.log("--- B. switched off ---");
  writeSettings({ enabled: false });
  {
    const r = await post("/v1", { auth: `Bearer ${token}` });
    check("B1 lane off → 403 even with a valid token", r.status === 403, r.status);
    check("B2 no Jarvis turn ran", prompts.length === 0, prompts.length);
  }
  writeSettings({ enabled: true, maxWords: 60, idleMinutes: 10, timeoutSeconds: 20 });

  // ── C. the captured request end to end ────────────────────────────────────
  console.log("--- C. captured request ---");
  let firstConvId = null;
  {
    nextAnswer = "A woodchuck would chuck about seven hundred pounds.";
    const r = await post("", { auth: `Bearer ${token}`, body: evenBody("How much wood could a woodchuck chuck?") });
    const j = await r.json();
    check("C1 200 chat.completion", r.status === 200 && j.object === "chat.completion", { status: r.status, j });
    check("C2 content is the Jarvis answer", j.choices?.[0]?.message?.content === nextAnswer, j.choices);
    check("C3 role assistant, finish_reason stop", j.choices?.[0]?.message?.role === "assistant" && j.choices?.[0]?.finish_reason === "stop");
    check("C4 model echoed back", j.model === "openclaw", j.model);
    const latest = conv.latestConversationByOrigin("glasses");
    firstConvId = latest?.id ?? null;
    const msgs = firstConvId ? conv.listMessages(firstConvId) : [];
    check("C5 conversation persisted with origin 'glasses'", latest?.origin === "glasses", latest);
    check("C6 DB holds the user text + the same assistant answer (artifact, not report)",
      msgs.length === 2 && msgs[0].content === "How much wood could a woodchuck chuck?" && msgs[1].content === nextAnswer,
      msgs.map((m) => [m.role, m.content]));
    const col = getDb().prepare("SELECT origin FROM jarvis_conversations WHERE id = ?").get(firstConvId);
    check("C7 migration 035 column present and stamped", col?.origin === "glasses", col);
  }

  // ── D. paths ──────────────────────────────────────────────────────────────
  console.log("--- D. paths ---");
  for (const sub of ["/v1", "/v1/chat/completions", "/chat/completions"]) {
    nextAnswer = "Path ok.";
    const r = await post(sub, { auth: `Bearer ${token}`, body: evenBody(`path ${sub}`) });
    check(`D1 POST ${sub || "/"} → 200`, r.status === 200, r.status);
  }
  {
    const r = await post("/v2/other", { auth: `Bearer ${token}` });
    check("D2 unknown subpath → 404", r.status === 404, r.status);
    const bare = await post("/v1", { auth: token, body: evenBody("bare token") });
    check("D3 bare (non-Bearer) token accepted", bare.status === 200, bare.status);
    const models = await route.GET(new Request("http://127.0.0.1/api/glasses/v1/models", { headers: { authorization: `Bearer ${token}` } }));
    const mj = await models.json();
    check("D4 GET /v1/models lists the lane model", models.status === 200 && mj.data?.[0]?.id === glasses.GLASSES_MODEL_ID, mj);
    const unauth = await route.GET(new Request("http://127.0.0.1/api/glasses/v1/models"));
    check("D5 GET /v1/models without token → 401", unauth.status === 401, unauth.status);
  }

  // ── E. continuity ─────────────────────────────────────────────────────────
  console.log("--- E. continuity ---");
  {
    const convId = conv.latestConversationByOrigin("glasses")?.id;
    prompts.length = 0;
    nextAnswer = "Follow-up answer.";
    const r = await post("/v1", { auth: `Bearer ${token}`, body: evenBody("And what about a beaver?") });
    check("E1 follow-up → 200", r.status === 200, r.status);
    check("E2 follow-up threads the same conversation", conv.latestConversationByOrigin("glasses")?.id === convId);
    check("E3 prompt carries the earlier turn (Even sends none)", prompts[0]?.includes("bare token"), prompts[0]?.slice(-800));
    // Age the conversation past the idle window.
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    getDb().prepare("UPDATE jarvis_conversations SET updated_at = ? WHERE id = ?").run(old, convId);
    check("E4 idle conversation is not continued", glasses.glassesConversationId(10) === undefined);
    await post("/v1", { auth: `Bearer ${token}`, body: evenBody("New topic after a break.") });
    const fresh = conv.latestConversationByOrigin("glasses");
    check("E5 a fresh glasses conversation starts after idleMinutes", !!fresh && fresh.id !== convId, fresh?.id);
    const dashboardConv = conv.createConversation({ title: "dashboard", channel: "overlay" });
    check("E6 dashboard conversations carry no origin and are never picked up",
      dashboardConv.origin === null && conv.latestConversationByOrigin("glasses")?.id === fresh?.id);
  }

  // ── F. reply shaping ──────────────────────────────────────────────────────
  console.log("--- F. shaping ---");
  {
    prompts.length = 0;
    nextAnswer = "## Heading\n- **Bold** item with `code` and a [link](http://x).";
    const j = await (await post("/v1", { auth: `Bearer ${token}`, body: evenBody("format test") })).json();
    check("F1 <reply_surface> with the word cap reaches the prompt",
      /<reply_surface name="Even Realities G2 glasses">/.test(prompts[0] ?? "") && (prompts[0] ?? "").includes("at most 60 words"));
    const text = j.choices?.[0]?.message?.content ?? "";
    check("F2 markdown stripped for the lens", text === "Heading Bold item with code and a link.", text);
    writeSettings({ enabled: true, maxWords: 12, idleMinutes: 10, timeoutSeconds: 20 });
    nextAnswer = "One two three four five. Six seven eight nine ten eleven twelve thirteen fourteen fifteen.";
    const capped = (await (await post("/v1", { auth: `Bearer ${token}`, body: evenBody("long") })).json()).choices?.[0]?.message?.content ?? "";
    check("F3 word cap enforced with a visible ellipsis", capped.endsWith("…") && capped.split(/\s+/).length <= 13, capped);
    // Artifact check: the DB keeps the FULL answer; only the lens copy is capped.
    const latest = conv.latestConversationByOrigin("glasses");
    const lastMsg = conv.listMessages(latest.id).at(-1);
    check("F4 stored answer is the full, uncapped text", lastMsg?.content === nextAnswer, lastMsg?.content);
    writeSettings({ enabled: true, maxWords: 60, idleMinutes: 10, timeoutSeconds: 20 });
  }

  // ── G. loud failures ──────────────────────────────────────────────────────
  console.log("--- G. failures ---");
  {
    const s = await post("/v1", { auth: `Bearer ${token}`, body: { ...evenBody("stream please"), stream: true } });
    check("G1 stream:true → 400", s.status === 400, s.status);
    const e = await post("/v1", { auth: `Bearer ${token}`, body: { model: "openclaw", messages: [] } });
    check("G2 empty messages → 400", e.status === 400, e.status);
    brain.setJarvisCliForTests(() => Promise.reject(new Error("smoke-injected brain failure")));
    const f = await post("/v1", { auth: `Bearer ${token}`, body: evenBody("this will fail") });
    const fj = await f.json();
    check("G3 brain failure → 502 with the real message, no canned answer",
      f.status === 502 && /smoke-injected brain failure/.test(fj?.error?.message ?? "") && !fj.choices, fj);
    const st = await (await cfgRoute.GET()).json();
    check("G4 settings status records the last error", /smoke-injected/.test(st.lastError ?? ""), st);
  }

  // ── H. static: proxy exemption + UI ───────────────────────────────────────
  console.log("--- H. static ---");
  {
    const proxy = fs.readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
    check("H1 proxy exempts /api/glasses only when Authorization is present",
      /pathname === "\/api\/glasses" \|\| pathname\.startsWith\("\/api\/glasses\/"\)\) &&\s*request\.headers\.has\("authorization"\)/.test(proxy));
    check("H2 exemption does not cover the settings route (/api/v2/jarvis/glasses)", !/startsWith\("\/api\/v2\/jarvis\/glasses/.test(proxy));
    const ui = fs.readFileSync(path.join(process.cwd(), "src/components/v2/jarvis/GlassesSettings.tsx"), "utf8")
      + fs.readFileSync(path.join(process.cwd(), "src/components/v2/jarvis/JarvisSettings.tsx"), "utf8");
    check("H3 Jarvis gear surfaces every glasses knob (rule 16)",
      ["enabled", "maxWords", "idleMinutes", "timeoutSeconds", "/api/v2/jarvis/glasses"].every((k) => ui.includes(k)));
  }
  // Revoke closes the lane again.
  await cfgRoute.DELETE();
  const after = await post("/v1", { auth: `Bearer ${token}` });
  check("H4 revoke → lane answers 503 again", after.status === 503, after.status);
  // Let fire-and-forget memory work settle, then assert nothing left the box.
  await new Promise((r) => setTimeout(r, 1500));
  check("H5 no outbound request left loopback (offline smoke)", offHost.length === 0, offHost);
} finally {
  brain.setJarvisCliForTests(null);
}

console.log("");
console.log(`${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp: ${tmp})`);
process.exit(failures === 0 ? 0 : 1);
