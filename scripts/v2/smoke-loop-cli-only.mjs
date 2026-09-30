// Loop CLI-only smoke, offline (owner, 2026-09-29: "Loop CLI Only").
//   A. the shared menus offer CLI agents only (plus the local Ollama judge), defaults are CLI
//   B. the engine refuses OpenRouter / Nous Portal / MiniMax ids for builder and judge
//   C. the run route refuses them before a round runs, and defaults the builder to a CLI agent
//   D. no OpenRouter, Nous or MiniMax call path is left in the Loop code or UI
//   E. nothing in this smoke reached the network (fetch is stubbed and must stay uncalled)
// No CLI agent is ever started: every request here is refused before a round runs.
// HOME / USERPROFILE and every store point at a temp dir (rule 19).
// Run: npx tsx scripts/v2/smoke-loop-cli-only.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-loop-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const fetched = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { fetched.push(String(url)); throw new Error("network is off in this smoke"); };

const NOT_CLI = ["nex-agi/nex-n2-pro:free", "z-ai/glm-5.2", "openrouter/fusion", "nous:Hermes-4-405B", "minimax:MiniMax-M3", "cli:antigravity", "cli:rm"];

// ── A ─────────────────────────────────────────────────────────────────────────
const M = await import("../../src/lib/loopModels.ts");
check("A1 every builder on the menu is a CLI agent", M.WORKERS.length >= 4 && M.WORKERS.every((w) => w.id.startsWith("cli:") && M.isLoopBuilder(w.id)), M.WORKERS.map((w) => w.id));
check("A2 every judge is a CLI agent or the local Ollama judge", M.JUDGES.every((j) => M.isLoopJudge(j.id)) && M.JUDGES.filter((j) => !j.id.startsWith("cli:")).map((j) => j.id).join() === "local", M.JUDGES.map((j) => j.id));
check("A3 no OpenRouter / Nous / MiniMax entries left", ![...M.WORKERS, ...M.JUDGES].some((m) => /openrouter|nex-|glm|nous|minimax|:free/i.test(m.id + m.label)));
check("A4 defaults are the Claude CLI", M.DEFAULT_WORKER === "cli:claude" && M.DEFAULT_JUDGE === "cli:claude");
check("A5 the guards refuse every non-CLI id", NOT_CLI.every((id) => !M.isLoopBuilder(id) && !M.isLoopJudge(id)) && !M.isLoopBuilder("local"));

// ── B ─────────────────────────────────────────────────────────────────────────
const E = await import("../../src/lib/loopEngine.ts");
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message || e); } };
let bad = [];
for (const id of NOT_CLI) {
  const m = await refusal(() => E.workerAct("a page", "", [], id));
  if (!m || !/CLI agents only/.test(m)) bad.push([id, m]);
}
check("B1 workerAct refuses every non-CLI builder, loudly", bad.length === 0, bad);
bad = [];
for (const id of NOT_CLI) {
  const m = await refusal(() => E.verdict("a page", "<html></html>", id));
  if (!m || !/CLI agents \(or the local Ollama judge\) only/.test(m)) bad.push([id, m]);
}
check("B2 verdict refuses every non-CLI judge, loudly (no quiet local fallback for them)", bad.length === 0, bad);
check("B3 the OpenRouter / Nous helpers are gone from the engine", ["orKey", "orComplete", "nousToken", "nousModels", "fusionVerdict"].every((k) => !(k in E)));

// ── C ─────────────────────────────────────────────────────────────────────────
const route = await import("../../src/app/api/loop/run/route.ts");
const events = async (body) => (await (await route.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }))).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
let ev = await events({ goal: "a calculator", worker: "minimax:MiniMax-M3", judge: "cli:claude" });
check("C1 a MiniMax builder is refused before a round runs", ev[0]?.t === "error" && /CLI agents only/.test(ev[0].m) && ev.at(-1).t === "done" && !ev.some((e) => e.t === "start" || e.t === "iter"), ev);
ev = await events({ goal: "a calculator", worker: "cli:claude", judge: "openrouter/fusion" });
check("C2 an OpenRouter judge is refused before a round runs", ev[0]?.t === "error" && /local Ollama judge\) only/.test(ev[0].m) && !ev.some((e) => e.t === "start"), ev);
ev = await events({ goal: "a calculator", judge: "nous:Hermes-4-405B" });
check("C3 with no builder given, the default is not refused (it is a CLI agent)", ev[0]?.t === "error" && !/builder/.test(ev[0].m) && /judge/.test(ev[0].m), ev);
const routeSrc = fs.readFileSync("src/app/api/loop/run/route.ts", "utf8");
check("C4 the route's default builder is DEFAULT_WORKER, not MiniMax", /body\.worker \|\| DEFAULT_WORKER/.test(routeSrc) && !/minimax|orKey|nousToken/i.test(routeSrc));

// ── D ─────────────────────────────────────────────────────────────────────────
const engineSrc = fs.readFileSync("src/lib/loopEngine.ts", "utf8");
const ui = fs.readFileSync("src/components/LoopView.tsx", "utf8");
check("D1 the engine has no OpenRouter or Nous endpoint", !/openrouter\.ai|nousresearch|OPENROUTER_API_KEY|NOUS_API_KEY/.test(engineSrc));
check("D2 MiniMax's URL is only kept as a constant for v2 memory, never called by the Loop", !/minimaxComplete|fetch\(MINIMAX_CHAT/.test(engineSrc));
check("D3 the Nous Portal model route is gone", !fs.existsSync("src/app/api/loop/nous-models/route.ts"));
check("D4 the UI offers no Nous / N2 / Fusion options and claims no Fusion step", !/nous|N2|Fusion|Free \+ paid/i.test(ui) && /"verify"/.test(ui));
check("D5 the page subtitle and the Guide doc say CLI", !/Fusion verifies/.test(fs.readFileSync("src/lib/pageMeta.ts", "utf8")) && /CLI agents only/.test(fs.readFileSync("docs/modules/loop.md", "utf8")) && !/OPENROUTER_API_KEY|Nous Portal models/.test(fs.readFileSync("docs/modules/loop.md", "utf8")));

// ── E ─────────────────────────────────────────────────────────────────────────
check("E1 nothing reached the network", fetched.length === 0, fetched);
globalThis.fetch = realFetch;

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
