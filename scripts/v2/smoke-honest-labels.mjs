// Honest labels smoke, offline: pages say only what they can know (AGENTS.md "Never
// fabricate state"). Found by the Guide writers, 2026-09-29.
//   A. chat logging (UnifiedChat: Claude, Hermes, OpenClaw, Antigravity): "Logged" only
//      after /api/memory/log really succeeded; the route accepts Antigravity and writes to
//      the vault; a bad agent is 400; no vault is a 503, not a silent miss
//   B. Thumbnails names the backend really used, has no timer-driven bar, and says where
//      (or whether) the route saved
//   C. Agent Kanban has no timed "Reviewing" pause
//   D. Pi and OpenClaw headers claim no model / live status they never read
// HOME / USERPROFILE, the config file (vault) and every store point at a temp dir (rule 19).
// Run: npx tsx scripts/v2/smoke-honest-labels.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-labels-"));
const vault = path.join(tmp, "vault");
fs.mkdirSync(vault, { recursive: true });
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_CONFIG = path.join(tmp, "config.json");
fs.writeFileSync(process.env.AGENTIC_OS_CONFIG, JSON.stringify({ vaultRoot: vault }), "utf8");
process.env.AGENTIC_OS_VAULT = vault;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const read = (p) => fs.readFileSync(p, "utf8");

// ── A ─────────────────────────────────────────────────────────────────────────
const VW = await import("../../src/lib/vaultWriter.ts");
check("A0 the vault resolves inside the temp dir", VW.VAULT_AVAILABLE && path.resolve(VW.VAULT_ROOT).startsWith(path.resolve(tmp)), VW.VAULT_ROOT);
const log = await import("../../src/app/api/memory/log/route.ts");
const post = (body) => log.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
let res = await post({ agent: "antigravity", kind: "chat", user: "hi", reply: "hello from agy" });
let j = await res.json();
const memDir = path.join(VW.AGENTIC_DIR, "Memories");
const written = fs.existsSync(memDir) ? fs.readdirSync(memDir).map((f) => read(path.join(memDir, f))).join("\n") : "";
check("A1 the log route accepts Antigravity and really writes the exchange", res.status === 200 && j.ok === true && /antigravity/.test(written) && /hello from agy/.test(written), { status: res.status, j });
res = await post({ agent: "mallory", kind: "chat", reply: "x" });
check("A2 an unknown agent is a 400", res.status === 400);
const logSrc = read("src/app/api/memory/log/route.ts");
check("A3 no vault is a loud 503, and a failed write is a 500", /if \(!VAULT_AVAILABLE\)[\s\S]*status: 503/.test(logSrc) && /status: res\.ok \? 200 : 500/.test(logSrc));
const uc = read("src/components/UnifiedChat.tsx");
check("A4 the chat awaits the log result before saying Logged", /const failed = await logToVault\(/.test(uc) && /if \(failed\) \{ setLogError\(failed\); setLastLogged\(null\); \}/.test(uc) && !/\.catch\(\(\) => \{\}\);\s*\n\}/.test(uc.slice(uc.indexOf("function logToVault"), uc.indexOf("interface Props"))));
check("A5 a failed log is shown, not hidden", /Not logged to Obsidian/.test(uc));

// ── B ─────────────────────────────────────────────────────────────────────────
const th = read("src/components/ThumbnailStudio.tsx");
check("B1 the wait screen names the backend really used", /with \{runLabel\}/.test(th) && !/with gpt-image-2…/.test(th));
check("B2 no timer-driven progress bar", !/elapsed \/ 150/.test(th));
check("B3 the done line reports the route's savedTo, or says it was not saved", /savedTo \? `saved to your vault \(\$\{savedTo\}\)` : "not saved to your vault"/.test(th) && !/saving to your Obsidian Thumbnails folder/.test(th));
for (const r of ["src/app/api/thumbnails/generate/route.ts", "src/app/api/thumbnails/labs/generate/route.ts"]) {
  check(`B4 ${r.replace("src/app/api/", "")} reports savedTo`, /savedTo:/.test(read(r)));
}

// ── C ─────────────────────────────────────────────────────────────────────────
const ak = read("src/components/AgentKanban.tsx");
check("C1 Agent Kanban has no timed pause and no separate Review stage set", !/sleep\(/.test(ak) && !/stage: "reviewing"/.test(ak));
check("C2 build and check are one column (old saved 'reviewing' cards still render)", /label: "Build \+ check".*stages: \["building", "reviewing"\]/.test(ak));

// ── D ─────────────────────────────────────────────────────────────────────────
const pi = read("src/components/PiView.tsx");
check("D1 Pi's header names no model it never read", !/Ollama glm-5\.2:cloud/.test(pi));
const oc = read("src/components/OpenClawStudio.tsx");
check("D2 OpenClaw claims no model version and no live status it never checks", !/Grok 4\.3/.test(oc) && !/xAI · live/.test(oc));

// ── E. stale copy ─────────────────────────────────────────────────────────────
const seo = read("src/components/SEOView.tsx");
check("E1 SEO counts the configured sites, not a fixed five", !/all 5 sites|Generate 5 |of 5 articles/.test(seo) && /siteCount = sites\.length/.test(seo));
const eng = read("src/components/LocalHermesEngine.tsx") + read("src/lib/pageMeta.ts") + read("src/app/api/local-hermes/run/route.ts");
check("E2 Local Engine names no model it never reads", !/Gemma-4 12B Coder|llama3\.1:8b/.test(eng));
const sk = read("src/components/v2/skills/SkillsView.tsx");
check("E3 the Skills gear points at where file skills really are", !/operating skills below/.test(sk) && /Control Room/.test(sk));

// ── F. Hermes Talk speech-to-text ─────────────────────────────────────────────
const stt = read("src/app/api/openclaw/studio/stt/route.ts");
check("F1 Talk STT no longer switches to OpenRouter Whisper", !/transcribeWith\(\s*"openrouter/.test(stt) && !/provider: "openrouter"/.test(stt) && /grok-stt returned no transcript/.test(stt));
const mva = read("src/components/MiniMaxVoiceAgent.tsx");
check("F2 Talk's header says who really transcribes", !/MiniMax transcribes/.test(mva) && /OpenClaw \(grok-stt\) transcribes/.test(mva));

// ── G. Video ──────────────────────────────────────────────────────────────────
const vd = read("src/components/VideoDirector.tsx");
check("G1 a failed Grok b-roll clip is shown as failed, not quietly redone on MiniMax", !/genBroll\(i, prompt, "minimax"\)/.test(vd));
const vs = read("src/components/VideoStudio.tsx");
check("G2 Workspace fetches HTML source, so Source can load", /k === "text" \|\| k === "json" \|\| k === "html"/.test(vs));

// ── H. Codex session file preview on Windows ──────────────────────────────────
const CV = await import("../../src/components/CodexView.tsx");
const B = String.fromCharCode(92);
const winHome = ["C:", "Users", "Yoshi"].join(B);
check("H1 a Windows path under home becomes a preview URL", CV.sessionFileUrl(["C:", "Users", "Yoshi", "Documents", "shot one.png"].join(B), winHome) === "/api/codex/session-file/Documents/shot%20one.png");
check("H2 drive-letter case and forward slashes are tolerated", CV.sessionFileUrl("c:/users/yoshi/a/b.html", winHome) === "/api/codex/session-file/a/b.html");
check("H3 a path outside home is refused", CV.sessionFileUrl(["D:", "stuff", "x.png"].join(B), winHome) === null && CV.sessionFileUrl(["C:", "Users", "Yoshi2", "x.png"].join(B), winHome) === null);
check("H4 POSIX paths still work", CV.sessionFileUrl("/Users/sam/Desktop/a.png", "/Users/sam") === "/api/codex/session-file/Desktop/a.png" && CV.sessionFileUrl("/Users/samuel/a.png", "/Users/sam") === null);
check("H5 the session route reports the server's home", /home: os\.homedir\(\)/.test(read("src/app/api/codex/session/route.ts")) && /typeof j\.home === "string"/.test(read("src/components/CodexView.tsx")));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
