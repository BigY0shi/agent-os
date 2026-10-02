// Idea Engine seat routing smoke, offline (owner, 2026-09-30: "It should default to Claude,
// fallback to codex. Add the setting." / "Every parameter needs to be in the settings").
//   A. defaults: sizing + clustering on claude, kill pass on codex, fallback codex
//   B. runSeat: the primary answers; on failure the fallback answers and says so; "none"
//      and same-agent fallbacks fail with the reason; both failing names both; an agent
//      outside the list is refused; an empty answer counts as a failure
//   C. validation + radar route through runSeat with the settings (no hardcoded kimi/codex)
//   D. the gear exposes the four agents
// Agents are stubbed through runSeat's test seams: no real or billed CLI / Ollama call.
// HOME / USERPROFILE and every store point at a temp dir (rule 19).
// Run: npx tsx scripts/v2/smoke-idea-seats.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-idea-seats-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
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
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message || e); } };

const S = await import("../../src/lib/settings.ts");
const I = await import("../../src/lib/ideaSeats.ts");

// ── A ─────────────────────────────────────────────────────────────────────────
const d = S.DEFAULT_SETTINGS.ideaEngine;
check("A1 settings defaults: sizing + clustering claude, kill codex, fallback codex", d.sizingAgent === "claude" && d.clusterAgent === "claude" && d.killAgent === "codex" && d.fallbackAgent === "codex");
const a = I.ideaAgents(undefined);
check("A2 ideaAgents with nothing saved gives the same", a.sizing === "claude" && a.cluster === "claude" && a.kill === "codex" && a.fallback === "codex");
check("A3 a saved choice wins (trimmed, lower-cased)", I.ideaAgents({ sizingAgent: " Kimi " }).sizing === "kimi");

// ── B ─────────────────────────────────────────────────────────────────────────
const asked = [];
const cli = async (agent) => { asked.push(agent); if (agent === "claude") throw new Error("claude returned no output (exit 1)."); if (agent === "pi") return "   "; return `answer from ${agent}`; };
const kimi = async (_seat, _prompt, model) => { asked.push(`kimi:${model}`); return "answer from kimi"; };
const o = { timeoutMs: 1000, kimiModel: "kimi-k2.6:cloud", cli, kimi, resolveKimi: async (m) => m };
let r = await I.runSeat("codex", "claude", "p", o);
check("B1 the primary answers; no fallback recorded", r.text === "answer from codex" && r.used === "codex" && !r.fellBackFrom);
r = await I.runSeat("claude", "codex", "p", o);
check("B2 claude fails -> codex answers, and `used` says so", r.text === "answer from codex" && r.fellBackFrom === "claude" && /^codex \(fallback: claude failed: claude returned no output/.test(r.used), r);
let m = await errOf(() => I.runSeat("claude", "none", "p", o));
check("B3 fallback none: the seat fails with the reason", !!m && /claude failed/.test(m) && /no fallback set/.test(m), m);
m = await errOf(() => I.runSeat("claude", "claude", "p", o));
check("B4 a fallback equal to the primary is no fallback", !!m && /claude failed/.test(m), m);
m = await errOf(() => I.runSeat("claude", "pi", "p", o));
check("B5 an empty answer counts as a failure, naming both", !!m && /claude failed/.test(m) && /fallback pi returned nothing/.test(m), m);
m = await errOf(() => I.runSeat("openrouter", "none", "p", o));
check("B6 an agent outside the list is refused", !!m && /is not an Idea Engine agent/.test(m), m);
r = await I.runSeat("kimi", "codex", "p", o);
check("B7 kimi runs on Ollama Cloud with the settings model", r.used === "kimi:kimi-k2.6:cloud" && r.text === "answer from kimi", r);

// ── C ─────────────────────────────────────────────────────────────────────────
const val = fs.readFileSync("src/lib/ideaValidation.ts", "utf8");
const rad = fs.readFileSync("src/lib/ideaRadar.ts", "utf8");
check("C1 validation's sizing and kill pass route through runSeat with the settings", (val.match(/runSeat\(m\.agents\.(sizing|kill), m\.agents\.fallback/g) || []).length === 2 && !/seatComplete\("kimi"/.test(val) && !/cliComplete\("codex"/.test(val));
check("C2 the radar's clustering routes through runSeat and its chip names who did it", /runSeat\(ag\.cluster, ag\.fallback/.test(rad) && /· by \$\{clusteredBy\}/.test(rad) && !/seatComplete\("kimi"/.test(rad));

// ── D ─────────────────────────────────────────────────────────────────────────
const ui = fs.readFileSync("src/components/IdeaEngineView.tsx", "utf8");
check("D1 the gear has the four agent fields", ["sizingAgent", "clusterAgent", "killAgent", "fallbackAgent"].every((k) => ui.includes(`key: "${k}"`)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
