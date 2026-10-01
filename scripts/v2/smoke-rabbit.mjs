// smoke-rabbit: the Rabbit R1 bridge (/rabbit + /api/rabbit/*), direct-import,
// fully OFFLINE. Nothing here spawns the claude CLI — every completions call
// is stopped by validation before the spawn line.
//
//   §A static contract: proxy pass-through for /api/rabbit/v1/, sidebar NAV +
//      Workspace set, page, 'use client' components with no process.env,
//      migration 045 (NOT 044 — the live DB already had a 44), settings keys
//   §B openai helpers: parse / model resolve / prompt packing / stream-json / SSE
//   §C key + models route: requireKey OFF → no credential needed; ON → 503 with
//      no stored key, setup mints a short typeable key, 401 bad key, 200 good
//      key (bearer AND x-api-key), owner-set key works, rotate invalidates
//   §D completions route: enabled=false → 503; requireKey ON + no key → 401;
//      bad body → 400; unknown model → 400 (all before any spawn)
//   §E store: create / link-by-echoed-reply / record / list / counts / archive /
//      archiveIdle, plus the live registry
//   §F sessions routes: list (+counts +live), detail, PATCH archive + rename,
//      bad id → 400, unknown → 404
// Env is set BEFORE imports so the DB, settings and key live in temp files.
// Run: npx tsx scripts/v2/smoke-rabbit.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-rabbit-${stamp}.db`);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-rabbit-smoke-"));
const settingsFile = path.join(tmpDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const secretFile = path.join(tmpDir, "rabbit.secret");
process.env.AGENTIC_OS_RABBIT_SECRET = secretFile;
const logFile = path.join(tmpDir, "rabbit.log");
process.env.AGENTIC_OS_RABBIT_LOG = logFile; // never the live ~/.agentic-os/rabbit.log
const promptTmp = path.join(tmpDir, "prompts");
process.env.AGENTIC_OS_RABBIT_TMP = promptTmp; // system-prompt files land here, not the live temp folder
process.env.OLLAMA_URL = "http://127.0.0.1:1";

const writeSettings = (rabbit) =>
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({
      memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" },
      capability: { browserEnabled: false },
      tasks: { timezone: "America/Chicago" },
      browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
      rabbit,
    }),
  );
writeSettings({});

// ── imports AFTER env ───────────────────────────────────────────────────────
const openai = await import("../../src/lib/v2/rabbit/openai.ts");
const secretLib = await import("../../src/lib/v2/rabbit/secret.ts");
const store = await import("../../src/lib/v2/rabbit/store.ts");
const live = await import("../../src/lib/v2/rabbit/live.ts");
const modelsRoute = await import("../../src/app/api/rabbit/v1/models/route.ts");
const chatRoute = await import("../../src/app/api/rabbit/v1/chat/completions/route.ts");
const setupRoute = await import("../../src/app/api/rabbit/setup/route.ts");
const sessionsRoute = await import("../../src/app/api/rabbit/sessions/route.ts");
const sessionRoute = await import("../../src/app/api/rabbit/sessions/[id]/route.ts");
const { NextRequest } = await import("next/server");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const GEN_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/;

const jsonReq = (url, body, headers = {}, method = "POST") =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const chat = (body, headers = {}) => chatRoute.POST(jsonReq("http://127.0.0.1/api/rabbit/v1/chat/completions", body, headers));
const models = (headers = {}) => modelsRoute.GET(new Request("http://127.0.0.1/api/rabbit/v1/models", { headers }));
const setupGet = (headers = {}) => setupRoute.GET(new Request("http://127.0.0.1/api/rabbit/setup", { headers }));
const setupPost = (body) => setupRoute.POST(jsonReq("http://127.0.0.1/api/rabbit/setup", body));

try {
  // ── §A static contract ───────────────────────────────────────────────────
  {
    const proxy = read("src/proxy.ts");
    check("proxy passes /api/rabbit/v1/ through unconditionally", proxy.includes('if (pathname.startsWith("/api/rabbit/v1/")) {'));
    check("proxy does NOT exempt /api/rabbit/setup or /sessions", !/startsWith\("\/api\/rabbit\/(setup|sessions)/.test(proxy) && !/=== "\/api\/rabbit\/(setup|sessions)/.test(proxy));
    const sidebar = read("src/components/Sidebar.tsx");
    check("sidebar NAV has /rabbit", sidebar.includes('href: "/rabbit"'));
    check("sidebar WORKSPACE_ROUTES has /rabbit", /WORKSPACE_ROUTES = new Set\(\[[^\]]*"\/rabbit"/.test(sidebar));
    check("page exists", fs.existsSync(path.join(root, "src/app/rabbit/page.tsx")));
    for (const f of ["RabbitView.tsx", "RabbitSettings.tsx"]) {
      const src = read(`src/components/v2/rabbit/${f}`);
      check(`${f} is 'use client'`, src.startsWith('"use client"'));
      check(`${f} has no process.env`, !src.includes("process.env"));
    }
    const schema = read("src/lib/v2/dbSchema.ts");
    check("migration 045 rabbit_bridge registered (not 044)", schema.includes("version: 45") && schema.includes('name: "rabbit_bridge"') && schema.includes("CREATE TABLE IF NOT EXISTS rabbit_sessions") && !/version: 44,\s*\n\s*name: "rabbit_bridge"/.test(schema));
    const settings = read("src/lib/settings.ts");
    check("settings.rabbit typed + defaulted, requireKey defaults OFF", settings.includes("rabbit?: {") && settings.includes("requireKey?: boolean") && settings.includes("requireKey: false"));
  }

  // ── §B openai helpers ────────────────────────────────────────────────────
  {
    check("parse rejects non-object", openai.parseChatRequest("x").ok === false);
    check("parse rejects empty messages", openai.parseChatRequest({ messages: [] }).ok === false);
    check("parse rejects bad role", openai.parseChatRequest({ messages: [{ role: "banana", content: "x" }] }).ok === false);
    check("parse rejects assistant-only", openai.parseChatRequest({ messages: [{ role: "assistant", content: "x" }] }).ok === false);
    const parts = openai.parseChatRequest({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "x" } }] }] });
    check("parse accepts OpenAI parts form", parts.ok && parts.req.messages[0].content === "hi" && parts.req.model === openai.DEFAULT_MODEL_ID && parts.req.stream === false, parts);
    check("resolve default → CLAUDE_MODEL", openai.resolveModel(openai.DEFAULT_MODEL_ID, "claude-x").claude === "claude-x");
    check("resolve known id passes through", openai.resolveModel("claude-fable-5-1", "d").claude === "claude-fable-5-1");
    check("resolve alias passes through", openai.resolveModel("sonnet", "d").claude === "sonnet");
    check("resolve unknown → error", openai.resolveModel("gpt-4o", "d").ok === false);

    const single = openai.buildPrompt([{ role: "user", content: "  What time is it?  " }]);
    check("buildPrompt single turn = the question", single.prompt === "What time is it?" && single.systemPrompt.startsWith(openai.RABBIT_PERSONA));
    const withSys = openai.buildPrompt([{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }], { persona: "Custom persona." });
    check("buildPrompt custom persona + client system message", withSys.systemPrompt === "Custom persona.\n\nBe brief.");
    const convo = [
      { role: "user", content: "one" }, { role: "assistant", content: "1" },
      { role: "user", content: "two" }, { role: "assistant", content: "2" },
      { role: "user", content: "three" },
    ];
    const hist = openai.buildPrompt(convo);
    check("buildPrompt packs history", hist.prompt.includes("--- prior conversation ---") && hist.prompt.includes("User: one") && hist.prompt.endsWith("User: three\nAssistant:"));
    const trimmed = openai.buildPrompt(convo, { maxTurns: 1 });
    check("buildPrompt maxTurns (pairs) keeps the newest turn", !trimmed.prompt.includes("User: one") && trimmed.prompt.includes("User: two") && trimmed.prompt.includes("Assistant: 2"));
    const split = openai.splitTurns([{ role: "user", content: "a" }, { role: "assistant", content: "A" }, { role: "user", content: "b" }]);
    check("splitTurns", split.current === "b" && split.priorAssistant === "A" && split.firstUser === "a", split);
    check("splitTurns first turn has no prior", openai.splitTurns([{ role: "user", content: "a" }]).priorAssistant === null);

    check("stream line: text_delta", openai.parseStreamLine(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } }))?.delta === "Hi");
    const res = openai.parseStreamLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hello.", usage: { input_tokens: 10, output_tokens: 3 } }));
    check("stream line: result + usage", res?.result?.text === "Hello." && res.result.isError === false && res.result.inputTokens === 10 && res.result.outputTokens === 3, res);
    check("stream line: error subtype", openai.parseStreamLine(JSON.stringify({ type: "result", subtype: "error_during_execution", result: "" }))?.result?.isError === true);
    check("stream line: garbage → null", openai.parseStreamLine("not json") === null && openai.parseStreamLine("") === null);
    const chunk = openai.sseChunk({ id: "c1", model: "m", delta: "x" });
    check("sseChunk framing", chunk.startsWith("data: {") && chunk.endsWith("\n\n") && JSON.parse(chunk.slice(6)).choices[0].delta.content === "x");
    check("completionJson omits unknown usage", !("usage" in openai.completionJson({ id: "c", model: "m", text: "t" })));
    check("completionJson includes known usage", openai.completionJson({ id: "c", model: "m", text: "t", inputTokens: 1, outputTokens: 2 }).usage.total_tokens === 3);

    // Function calling — the rabbitOS 3 probe shape (tools:[ping] + "Call the ping function.").
    const PING = { type: "function", function: { name: "ping", description: "Ping.", parameters: { type: "object", properties: {} } } };
    const tr = openai.parseChatRequest({
      tools: [PING],
      messages: [
        { role: "developer", content: "sys" },
        { role: "user", content: "Call the ping function." },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "ping", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", name: "ping", content: "pong" },
      ],
    });
    check("parse: developer→system, tool role, echoed tool_calls, tools list", tr.ok && tr.req.messages[0].role === "system" && tr.req.messages[2].toolCalls?.[0]?.name === "ping" && tr.req.messages[3].role === "tool" && tr.req.tools.length === 1 && tr.req.tools[0].name === "ping", tr);
    check("parse: tool_choice none drops tools", openai.parseChatRequest({ messages: [{ role: "user", content: "x" }], tools: [PING], tool_choice: "none" }).req.tools.length === 0);
    check("parse: legacy functions[] accepted", openai.parseChatRequest({ messages: [{ role: "user", content: "x" }], functions: [{ name: "ping" }] }).req.tools[0].name === "ping");
    const probe = openai.buildPrompt([{ role: "user", content: "Call the ping function." }], { tools: tr.req.tools });
    check("buildPrompt: tool instructions + schema in the system prompt", probe.systemPrompt.includes('"tool_call"') && probe.systemPrompt.includes("- ping — Ping.") && probe.prompt === "Call the ping function.");
    const after = openai.buildPrompt(tr.req.messages, { tools: tr.req.tools });
    check("buildPrompt: echoed call + tool result rendered, ends Assistant:", after.prompt.includes('Assistant: {"tool_call":{"name":"ping","arguments":{}}}') && after.prompt.includes("Tool result (ping): pong") && after.prompt.endsWith("Assistant:") && after.prompt.includes("use the tool result"), after.prompt);
    const st = openai.splitTurns(tr.req.messages);
    check("splitTurns: prior assistant = canonical tool call text; current = tool result", st.priorAssistant === openai.toolCallText("ping", "{}") && st.current === "[ping] pong", st);
    const T = tr.req.tools;
    check("parseToolCall: plain", JSON.stringify(openai.parseToolCall('{"tool_call":{"name":"ping","arguments":{}}}', T)) === '{"name":"ping","arguments":"{}"}');
    check("parseToolCall: fenced", openai.parseToolCall('```json\n{"tool_call":{"name":"ping","arguments":{"a":1}}}\n```', T)?.arguments === '{"a":1}');
    check("parseToolCall: name/arguments-string form", openai.parseToolCall('{"name":"ping","arguments":"{\\"a\\":1}"}', T)?.arguments === '{"a":1}');
    check("parseToolCall: JSON then trailing prose", openai.parseToolCall('{"tool_call":{"name":"ping","arguments":{}}} Let me know!', T)?.name === "ping");
    check("parseToolCall: prose → null", openai.parseToolCall("PONG", T) === null);
    // The 2026-09-14 render_ui reply: valid up to the end, then one closing brace short.
    const short = '{"tool_call":{"name":"ping","arguments":{"card":{"root":["t"],"elements":{"t":{"type":"choice","props":{"options":[{"label":"a"}]}}}}}}';
    check("parseToolCall: one missing closing brace → repaired", openai.parseToolCall(short, T)?.name === "ping" && JSON.parse(openai.parseToolCall(short, T).arguments).card.root[0] === "t", openai.parseToolCall(short, T));
    check("parseToolCall: cut off mid-string → repaired", openai.parseToolCall('{"tool_call":{"name":"ping","arguments":{"q":"hel', T)?.name === "ping");
    check("repairJson: balanced input unchanged", openai.repairJson('{"a":[1,2]}') === '{"a":[1,2]}');
    check("repairJson: trailing comma + open array/object", openai.repairJson('{"a":[1,2,') === '{"a":[1,2]}');
    check("parseToolCall: unlisted function → null", openai.parseToolCall('{"tool_call":{"name":"reboot","arguments":{}}}', T) === null);
    const cj = openai.completionJson({ id: "c", model: "m", text: "", toolCalls: [{ id: "call_x", name: "ping", arguments: "{}" }] });
    check("completionJson tool call shape", cj.choices[0].finish_reason === "tool_calls" && cj.choices[0].message.content === null && cj.choices[0].message.tool_calls[0].function.name === "ping" && cj.choices[0].message.tool_calls[0].type === "function", cj);
    const tcChunk = JSON.parse(openai.sseChunk({ id: "c", model: "m", toolCalls: [{ id: "call_x", name: "ping", arguments: "{}" }] }).slice(6));
    check("sseChunk tool call delta", tcChunk.choices[0].delta.tool_calls[0].index === 0 && tcChunk.choices[0].delta.tool_calls[0].function.arguments === "{}", tcChunk);
    check("newCallId shape", /^call_[a-z0-9]{8,}$/.test(openai.newCallId()));
    check("explicitCallRequest: the R1 probe phrase", openai.explicitCallRequest("Call the ping function.", T) === true);
    check("explicitCallRequest: short plain tool name alone does NOT trigger (too common a word)", openai.explicitCallRequest("please run ping now", T) === false);
    check("explicitCallRequest: ordinary question → false", openai.explicitCallRequest("What is the capital of France?", T) === false && openai.explicitCallRequest("Set a timer for ten minutes", T) === false);
    const R1_TOOLS = ["wait", "web_search", "render_ui", "schedule_add"].map((name) => ({ name, description: "", parameters: {} }));
    check("explicitCallRequest: common-word tool name 'wait' does NOT trigger", openai.explicitCallRequest("wait, can you run that by me again?", R1_TOOLS) === false);
    check("explicitCallRequest: snake_case tool name as a whole word triggers", openai.explicitCallRequest("use web_search for the weather", R1_TOOLS) === true && openai.explicitCallRequest("use my web_searches", R1_TOOLS) === false);
    check("CALL_REMINDER mentions the JSON object", openai.CALL_REMINDER.includes("JSON tool_call object"));

    // Big-conversation guards: the R1's real turn is ~60k+ chars of content.
    const big = "x".repeat(150_000);
    const bigReq = openai.parseChatRequest({ messages: [{ role: "system", content: big }, { role: "user", content: "hi" }] });
    check("parse: 150k-char system prompt accepted (old 60k guard is gone)", bigReq.ok === true);
    const tooBig = openai.parseChatRequest({ messages: [{ role: "system", content: "x".repeat(openai.MAX_REQUEST_CHARS + 1) }, { role: "user", content: "hi" }] });
    check("parse: over MAX_REQUEST_CHARS → 413 naming the sizes", tooBig.ok === false && tooBig.status === 413 && /\d+ chars/.test(tooBig.error), tooBig);
    const bigPrompt = openai.buildPrompt(bigReq.req.messages);
    check("buildPrompt: system prompt kept whole up to MAX_SYSTEM_CHARS", bigPrompt.systemPrompt.length <= openai.MAX_SYSTEM_CHARS && bigPrompt.systemPrompt.length > 100_000);
    const cc = await import("../../src/lib/v2/rabbit/claudeChat.ts");
    const f1 = cc.systemPromptFile("hello system");
    const f2 = cc.systemPromptFile("hello system");
    check("systemPromptFile: content-hashed, reused, in the TEMP dir", f1 === f2 && f1.startsWith(promptTmp) && fs.readFileSync(f1, "utf8") === "hello system", f1);
    check("systemPromptFile: different prompt → different file", cc.systemPromptFile("other") !== f1);
    // Lean turn (2026-10-01): the owner's plugins/agents/hooks added ~9s and ~75k tokens to
    // every reply. `=` forms because runner.safeArg drops an empty-string argument.
    const ccSrc = read("src/lib/v2/rabbit/claudeChat.ts");
    check("claude turn is lean: --tools= and --setting-sources= (no empty-string args)",
      ccSrc.includes('"--tools=",') && ccSrc.includes('"--setting-sources=",') && !/"--tools",\s*""/.test(ccSrc) && !/"--setting-sources",\s*""/.test(ccSrc));

    // Mastermind adapter — pure helpers only (runMastermindTurn talks to real agents).
    const mm = await import("../../src/lib/v2/rabbit/mastermind.ts");
    check("MODELS lists agentos-mastermind", openai.MODELS.some((m) => m.id === mm.MASTERMIND_MODEL_ID) && openai.resolveModel(mm.MASTERMIND_MODEL_ID, "d").ok);
    check("settings.rabbit has mastermindAgents + mastermindSequential", read("src/lib/settings.ts").includes("mastermindAgents?: string[]") && read("src/lib/settings.ts").includes("mastermindSequential: true"));
    const trn = mm.buildTranscript([{ role: "system", content: "dev" }, { role: "user", content: "hi" }, { role: "assistant", content: "Claude: hello" }, { role: "user", content: "what next?" }], "Yoshi");
    check("buildTranscript: system dropped, speakers mapped", trn.length === 3 && trn[0].speaker === "Yoshi" && trn[1].speaker === mm.PANEL_SPEAKER && trn[2].text === "what next?", trn);
    const roster = [{ id: "claude", name: "Claude", color: "#1" }, { id: "codex", name: "Codex", color: "#2" }, { id: "hermes", name: "Hermes", color: "#3" }, { id: "pi", name: "Pi", color: "#4" }];
    check("pickRepliers: default panel when none configured (hermes absent from this roster → dropped)", mm.pickRepliers("hello", [], roster).map((a) => a.id).join() === "claude,codex");
    check("DEFAULT_MASTERMIND_AGENTS = claude, codex, cursor", mm.DEFAULT_MASTERMIND_AGENTS.join() === "claude,codex,cursor" && read("src/lib/settings.ts").includes('mastermindAgents: ["claude", "codex", "cursor"]'));
    check("pickRepliers: configured panel, unknown ids dropped", mm.pickRepliers("hello", ["pi", "nope"], roster).map((a) => a.id).join() === "pi");
    check("pickRepliers: @mention narrows within the panel", mm.pickRepliers("@codex what do you think?", ["claude", "codex"], roster).map((a) => a.id).join() === "codex");
    check("formatPanel: one spoken block per agent", mm.formatPanel([{ id: "a", name: "Claude", color: "", text: "one", ms: 1 }, { id: "b", name: "Codex", color: "", text: "two", ms: 1 }]) === "Claude: one\n\nCodex: two");
    const c1 = mm.mergeConvo(null, "r1-x", "R1 · hi", "hi", [{ id: "claude", name: "Claude", color: "#1", text: "hello", ms: 1 }]);
    check("mergeConvo: new convo → you + agent rows", c1.msgs.length === 2 && c1.msgs[0].who === "you" && c1.msgs[1].who === "claude" && c1.msgs[1].key === 2, c1);
    const c2 = mm.mergeConvo(c1, "r1-x", "ignored", "again", []);
    check("mergeConvo: appends with increasing keys, keeps the first title", c2.msgs.length === 3 && c2.msgs[2].key === 3 && c2.title === "R1 · hi");
    check("convoIdFor sanitises", mm.convoIdFor("ab-12 !!x") === "r1-ab-12x");
  }

  // ── §C key + models route ────────────────────────────────────────────────
  let key;
  {
    check("no key stored before setup", secretLib.readRabbitSecret() === null);
    // requireKey OFF (default): the R1's "no key" option — nothing needed.
    let r = await models({});
    check("requireKey OFF: models without any credential → 200", r.status === 200, r.status);
    check("secret helpers: generated key is 12 typeable chars", GEN_RE.test(secretLib.generateSecret()));
    check("secretProblem: short / spaces / non-ascii / ok", secretLib.secretProblem("abc") !== null && secretLib.secretProblem("a b c d") !== null && secretLib.secretProblem("héllo") !== null && secretLib.secretProblem("mypassword") === null);

    writeSettings({ requireKey: true });
    r = await models({ authorization: "Bearer deadbeef" });
    check("requireKey ON, no key stored → 503", r.status === 503, r.status);
    const s1 = await (await setupGet({ host: "192.168.0.50:3737" })).json();
    check("setup mints a short generated key", GEN_RE.test(s1.secret ?? ""), s1.secret);
    check("setup reports requireKey", s1.requireKey === true, s1);
    check("setup baseUrl from host header", s1.baseUrl === "http://192.168.0.50:3737/api/rabbit/v1", s1.baseUrl);
    check("key persisted at temp path", fs.existsSync(secretFile) && fs.readFileSync(secretFile, "utf8").trim() === s1.secret);
    const s2 = await (await setupGet()).json();
    check("setup is idempotent", s2.secret === s1.secret);
    key = s1.secret;
    r = await models({ authorization: "Bearer nope" });
    check("models bad bearer → 401", r.status === 401, r.status);
    r = await models({});
    check("models no credential → 401", r.status === 401, r.status);
    r = await models({ authorization: `Bearer ${key}` });
    const list = await r.json();
    check("models good bearer → 200 list", r.status === 200 && list.object === "list" && list.data.some((m) => m.id === openai.DEFAULT_MODEL_ID), list);
    r = await models({ "x-api-key": key });
    check("models x-api-key → 200", r.status === 200, r.status);

    // Owner-chosen key.
    r = await setupPost({ action: "set", secret: "abc" });
    check("set too-short key → 400", r.status === 400, r.status);
    const own = await (await setupPost({ action: "set", secret: "  mypassword  " })).json();
    check("set own key (trimmed)", own.secret === "mypassword" && fs.readFileSync(secretFile, "utf8").trim() === "mypassword", own);
    r = await models({ authorization: "Bearer mypassword" });
    check("own key accepted", r.status === 200, r.status);
    r = await models({ authorization: `Bearer ${key}` });
    check("previous generated key refused after set", r.status === 401, r.status);

    const rot = await (await setupPost({ action: "rotate" })).json();
    check("rotate mints a different generated key", GEN_RE.test(rot.secret ?? "") && rot.secret !== key);
    r = await models({ authorization: "Bearer mypassword" });
    check("own key refused after rotate", r.status === 401, r.status);
    key = rot.secret;
    r = await setupPost({ action: "nuke" });
    check("setup unknown action → 400", r.status === 400, r.status);

    // R1 Creation device routes: key REQUIRED even though requireKey is OFF in settings here.
    writeSettings({});
    const devSessions = await import("../../src/app/api/rabbit/v1/agentos/sessions/route.ts");
    const devSession = await import("../../src/app/api/rabbit/v1/agentos/sessions/[id]/route.ts");
    const devStt = await import("../../src/app/api/rabbit/v1/stt/route.ts");
    const devTts = await import("../../src/app/api/rabbit/v1/tts/route.ts");
    r = await devSessions.GET(new NextRequest("http://127.0.0.1/api/rabbit/v1/agentos/sessions"));
    check("creation: sessions without key → 401 (key mandatory regardless of requireKey)", r.status === 401, r.status);
    r = await devSessions.GET(new NextRequest("http://127.0.0.1/api/rabbit/v1/agentos/sessions?status=all", { headers: { "x-api-key": key } }));
    const dj = await r.json();
    check("creation: sessions with key → list + counts + live", r.status === 200 && Array.isArray(dj.sessions) && dj.counts && Array.isArray(dj.live), dj);
    r = await devSession.GET(new NextRequest("http://127.0.0.1/api/rabbit/v1/agentos/sessions/bad!", { headers: { "x-api-key": key } }), { params: Promise.resolve({ id: "bad!" }) });
    check("creation: bad session id → 400", r.status === 400, r.status);
    r = await devStt.POST(new Request("http://127.0.0.1/api/rabbit/v1/stt", { method: "POST" }));
    check("creation: stt without key → 401", r.status === 401, r.status);
    r = await devStt.POST(new Request("http://127.0.0.1/api/rabbit/v1/stt", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: "{}" }));
    check("creation: stt without audio → 400 (never reaches Parakeet)", r.status === 400, r.status);
    r = await devTts.POST(new Request("http://127.0.0.1/api/rabbit/v1/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) }));
    check("creation: tts without key → 401", r.status === 401, r.status);
    r = await devTts.POST(new Request("http://127.0.0.1/api/rabbit/v1/tts", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: "{}" }));
    check("creation: tts without text → 400 (never reaches Kokoro)", r.status === 400, r.status);
    const html = read("public/rabbit-creation/index.html");
    check("creation page: 240x282, wheel + PTT listeners, same-origin API, secure key storage", html.includes("width=240, height=282") && html.includes('"scrollUp"') && html.includes('"longPressStart"') && html.includes("/api/rabbit/v1") && html.includes('"secure", "agentos_key"') && !html.includes("process.env"));
    check("proxy lets /rabbit-creation/ through without a cookie", read("src/proxy.ts").includes('pathname.startsWith("/rabbit-creation/")'));
    check("proxy logs creation static hits", read("src/proxy.ts").includes("(creation static)"));
    const icon = fs.readFileSync(path.join(root, "public/rabbit-creation/icon.png"));
    check("creation icon is a real PNG", icon.length > 100 && icon.subarray(1, 4).toString() === "PNG");
    const gear = read("src/components/v2/rabbit/RabbitSettings.tsx");
    check("install QR carries a real iconUrl (rabbit's generator never sends an empty one)", gear.includes("/rabbit-creation/icon.png") && !gear.includes('iconUrl: ""'));
    check("settings.rabbit.publicBaseUrl exists", read("src/lib/settings.ts").includes("publicBaseUrl?: string"));
    check("qrcode dependency present", !!JSON.parse(read("package.json")).dependencies.qrcode);

    // Catch-all: an OpenAI path this bridge lacks is a logged, OpenAI-shaped 404.
    const catchAll = await import("../../src/app/api/rabbit/v1/[...path]/route.ts");
    r = await catchAll.POST(new NextRequest("http://127.0.0.1/api/rabbit/v1/responses", { method: "POST" }), { params: Promise.resolve({ path: ["responses"] }) });
    const ca = await r.json();
    check("catch-all → 404 naming the path + served endpoints", r.status === 404 && ca.error.code === "unsupported_endpoint" && ca.error.message.includes("/v1/responses") && ca.error.message.includes("chat/completions"), ca);
    check("request log lands in the TEMP rabbit.log", fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").includes("404 unsupported POST /v1/responses"));
  }

  // ── §D completions route (never reaches the spawn) ───────────────────────
  {
    writeSettings({ enabled: false });
    let r = await chat({ messages: [{ role: "user", content: "hi" }] });
    check("disabled bridge → 503", r.status === 503, r.status);
    writeSettings({ requireKey: true });
    r = await chat({ messages: [{ role: "user", content: "hi" }] });
    check("requireKey ON: completions without key → 401", r.status === 401, r.status);
    writeSettings({});
    r = await chat({ messages: [] });
    check("requireKey OFF: empty messages → 400 (no credential needed)", r.status === 400, r.status);
    r = await chatRoute.POST(new Request("http://127.0.0.1/api/rabbit/v1/chat/completions", { method: "POST", body: "{" }));
    check("completions bad JSON → 400", r.status === 400, r.status);
    r = await chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    const j = await r.json();
    check("completions unknown model → 400 with list", r.status === 400 && String(j.error?.message).includes(openai.DEFAULT_MODEL_ID), j);
    writeSettings({ defaultModel: "gpt-4o" });
    r = await chat({ messages: [{ role: "user", content: "hi" }] });
    check("invalid settings.defaultModel → 500 loud", r.status === 500, r.status);
    writeSettings({});
  }

  // ── §E store + live ──────────────────────────────────────────────────────
  let sessId;
  let otherId;
  {
    const first = store.linkSession({ priorAssistant: null, firstUser: "What is the capital of France?", model: "agentos-claude", client: "r1", gapMinutes: 120 });
    check("first turn creates a session", first.resumed === false && first.session.title === "What is the capital of France?" && first.session.messageCount === 0);
    sessId = first.session.id;
    store.recordTurn({ sessionId: sessId, user: "What is the capital of France?", assistant: "Paris.", model: "agentos-claude", inputTokens: 12, outputTokens: 2, durationMs: 900 });
    const again = store.linkSession({ priorAssistant: "Paris.", firstUser: "What is the capital of France?", model: "agentos-claude", gapMinutes: 120 });
    check("echoed reply re-links the same session", again.resumed === true && again.session.id === sessId, again);
    const other = store.linkSession({ priorAssistant: "Something else", firstUser: "x", model: "agentos-claude", gapMinutes: 120 });
    check("unknown echoed reply starts a new session", other.resumed === false && other.session.id !== sessId);
    const msgs = store.listMessages(sessId);
    check("messages recorded in order", msgs.length === 2 && msgs[0].role === "user" && msgs[1].role === "assistant" && msgs[1].content === "Paris." && msgs[1].inputTokens === 12);
    const s = store.getSession(sessId);
    check("session counters rolled", s.messageCount === 2 && s.inputTokens === 12 && s.outputTokens === 2, s);
    check("listSessions active", store.listSessions({ status: "active" }).length === 2);
    check("listSessions q matches transcript", store.listSessions({ q: "Paris" }).length === 1);
    check("counts", JSON.stringify(store.countSessions()) === JSON.stringify({ active: 2, archived: 0 }), store.countSessions());
    otherId = other.session.id;
    store.recordTurn({ sessionId: otherId, user: "x", assistant: "Something else", model: "agentos-claude" });
    store.setArchived(otherId, true);
    check("archive flips counts", store.countSessions().archived === 1 && store.listSessions({ status: "archived" })[0].id === otherId);
    check("archived session is not re-linkable", store.findSessionByLastReply("Paris.", 120)?.id === sessId && store.findSessionByLastReply("Something else", 120) === null);
    store.setArchived(otherId, false);
    check("restore makes it re-linkable again", store.countSessions().archived === 0 && store.findSessionByLastReply("Something else", 120)?.id === otherId);
    check("rename", store.renameSession(sessId, "  France  ").title === "France");
    check("archiveIdle(1 day) archives nothing fresh", store.archiveIdle(1) === 0);
    check("archiveIdle(0) archives everything idle", store.archiveIdle(0) === 2 && store.countSessions().active === 0);
    store.setArchived(sessId, false);

    live.liveStart({ id: "t1", sessionId: sessId, model: "m", preview: "hi", client: "r1" });
    check("live registry start", live.liveTurns().length === 1 && live.liveTurns()[0].sessionId === sessId);
    live.liveEnd("t1");
    check("live registry end", live.liveTurns().length === 0);
  }

  // ── §F sessions routes ───────────────────────────────────────────────────
  {
    let r = await sessionsRoute.GET(new NextRequest("http://127.0.0.1/api/rabbit/sessions?status=all"));
    let j = await r.json();
    check("sessions list → sessions + counts + live", r.status === 200 && j.sessions.length === 2 && j.counts.active === 1 && Array.isArray(j.live), j);
    r = await sessionRoute.GET(new NextRequest(`http://127.0.0.1/api/rabbit/sessions/${sessId}`), { params: Promise.resolve({ id: sessId }) });
    j = await r.json();
    check("session detail → transcript", r.status === 200 && j.session.id === sessId && j.messages.length === 2, j);
    r = await sessionRoute.GET(new NextRequest("http://127.0.0.1/api/rabbit/sessions/bad!"), { params: Promise.resolve({ id: "bad!" }) });
    check("bad id → 400", r.status === 400, r.status);
    r = await sessionRoute.GET(new NextRequest("http://127.0.0.1/api/rabbit/sessions/00000000-0000-0000-0000-000000000000"), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    check("unknown id → 404", r.status === 404, r.status);
    r = await sessionRoute.PATCH(new NextRequest(`http://127.0.0.1/api/rabbit/sessions/${sessId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true, title: "Renamed" }) }), { params: Promise.resolve({ id: sessId }) });
    j = await r.json();
    check("PATCH archive + rename", r.status === 200 && j.session.archivedAt && j.session.title === "Renamed", j);
    store.setArchived(otherId, false); // exactly one active, idle session for the bulk action
    r = await sessionsRoute.POST(new NextRequest("http://127.0.0.1/api/rabbit/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archiveIdle", days: 0 }) }));
    j = await r.json();
    check("POST archiveIdle", r.status === 200 && j.archived === 1, j);
    r = await sessionsRoute.POST(new NextRequest("http://127.0.0.1/api/rabbit/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "drop" }) }));
    check("POST unknown action → 400", r.status === 400, r.status);
  }
} catch (e) {
  failures++;
  console.log("FAIL  smoke threw —", e instanceof Error ? e.stack : e);
}

console.log(failures ? `\n${failures} failure(s)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
