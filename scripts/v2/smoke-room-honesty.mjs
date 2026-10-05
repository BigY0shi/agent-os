// Agent Room honesty smoke, offline (owner, 2026-09-30: "1. Fix").
//   A. no Ollama Cloud key: an Ollama agent fails loudly, never tries a local daemon
//   B. an empty Ollama Cloud reply (twice) is an error naming the agent, not an invented line
//   C. a real reply comes back as sent, from https://ollama.com, never localhost
//   D. no OpenRouter: a config override naming it is ignored; an unknown provider throws
//   E. reachability tells the truth (no key = not reachable)
// fetch is stubbed throughout and nothing leaves the machine. HOME / USERPROFILE, the config
// file and every store point at a temp dir (rule 19).
// Run: npx tsx scripts/v2/smoke-room-honesty.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-room-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_CONFIG = path.join(tmp, "config.json");
fs.writeFileSync(process.env.AGENTIC_OS_CONFIG, JSON.stringify({ roomAgents: { codex: { provider: "openrouter", model: "x/y" } } }), "utf8");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");
delete process.env.OLLAMA_API_KEY;
delete process.env.OLLAMA_CLOUD_KEY;
delete process.env.OLLAMA_CLOUD_MODEL;

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message || e); } };

const calls = [];
let chatReply = "";
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (u.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "kimi-k2.6:cloud" }, { name: "glm-5.2:cloud" }] }), { status: 200 });
  if (u.endsWith("/api/chat")) return new Response(JSON.stringify({ message: { content: chatReply } }), { status: 200 });
  return new Response("not stubbed", { status: 599 });
};

const R = await import("../../src/lib/agentRoom.ts");
const agent = (id) => R.roomAgents().find((a) => a.id === id);
const turns = [{ speaker: "You", text: "What should we name the newsletter?" }];

// ── A ─────────────────────────────────────────────────────────────────────────
let m = await errOf(() => R.roomReply(agent("ollama"), turns, ""));
check("A1 no key: the Ollama agent fails loudly", !!m && /no Ollama Cloud key/i.test(m) && /OLLAMA_API_KEY/.test(m), m);
check("A2 and nothing called a local daemon", !calls.some((u) => /localhost|127\.0\.0\.1/.test(u)), calls);

// ── B ─────────────────────────────────────────────────────────────────────────
process.env.OLLAMA_API_KEY = "smoke-not-a-real-key";
chatReply = "";
m = await errOf(() => R.roomReply(agent("ollama"), turns, ""));
check("B1 an empty reply twice is an error naming the agent", !!m && /Ollama got an empty reply from Ollama Cloud/.test(m) && !/running locally/.test(m), m);

// ── C ─────────────────────────────────────────────────────────────────────────
chatReply = "Call it The Dispatch.";
calls.length = 0;
const out = await R.roomReply(agent("ollama"), turns, "");
check("C1 a real reply comes back as sent", out === "Call it The Dispatch.", out);
check("C2 it went to https://ollama.com, never localhost", calls.length > 0 && calls.every((u) => u.startsWith("https://ollama.com/")), calls);

// ── D ─────────────────────────────────────────────────────────────────────────
check("D1 a config override naming openrouter is ignored (codex stays a CLI agent)", agent("codex").provider === "cli");
m = await errOf(() => R.roomReply({ ...agent("ollama"), provider: "openrouter" }, turns, ""));
check("D2 an unknown provider throws instead of reaching OpenRouter", !!m && /no supported provider/.test(m) && !calls.some((u) => /openrouter/.test(u)), m);
const src = fs.readFileSync("src/lib/agentRoom.ts", "utf8");
check("D3 no OpenRouter endpoint, no invented reply, no hardcoded fallback model left", !/openrouter\.ai/.test(src) && !/running locally and ready/.test(src) && !/qwen3-coder:480b/.test(src) && !/OLLAMA_LOCAL/.test(src));

// ── E ─────────────────────────────────────────────────────────────────────────
check("E1 with a key, Ollama agents are reachable", R.agentReachability(agent("ollama")).ok === true);
delete process.env.OLLAMA_API_KEY;
const r = R.agentReachability(agent("ollama"));
check("E2 with no key, they are not, and it says why", r.ok === false && /no Ollama Cloud key/.test(r.why), r);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
