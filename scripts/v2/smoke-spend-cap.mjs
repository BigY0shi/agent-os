// Per-run spend ceiling: dollars, tokens, and the off switch.
//
// Run: npx tsx scripts/v2/smoke-spend-cap.mjs
//
// Rule 19: settings redirected before import, so this never reads or writes the
// owner's real ~/.agentic-os/settings.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-spend-"));
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const S = await import("../../src/lib/v2/agents/spendCap.ts");
const settings = await import("../../src/lib/settings.ts");

const ON = { enabled: true, maxUsd: 5, maxTokens: 1000 };

// ── §A dollars ───────────────────────────────────────────────────────────────
console.log("\n── §A the dollar ceiling ──");
check("A1 under the ceiling continues", S.evaluateSpend({ usd: 4.99, tokens: 0 }, ON).over === false);
check("A2 AT the ceiling stops (>=, not >)", S.evaluateSpend({ usd: 5, tokens: 0 }, ON).over === true);
check("A3 over stops", S.evaluateSpend({ usd: 9, tokens: 0 }, ON).over === true);
const usdV = S.evaluateSpend({ usd: 9, tokens: 0 }, ON);
check("A4 the dimension is reported", usdV.dimension === "usd");
check("A5 the reason states both numbers", /\$9\.00/.test(usdV.reason) && /\$5\.00/.test(usdV.reason), usdV.reason);
check("A6 ...and says how to lift it", /switch off|Agents settings/i.test(usdV.reason));

// ── §B tokens ────────────────────────────────────────────────────────────────
console.log("\n── §B the token ceiling ──");
check("B1 under continues", S.evaluateSpend({ usd: 0, tokens: 999 }, ON).over === false);
check("B2 at stops", S.evaluateSpend({ usd: 0, tokens: 1000 }, ON).over === true);
check("B3 the dimension is reported", S.evaluateSpend({ usd: 0, tokens: 5000 }, ON).dimension === "tokens");
// Cache reads are billed. A cap that ignored them would miss the expensive case.
check("B4 tokens sum input, output AND both cache buckets",
  S.tokensFrom({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 4, cache_creation_input_tokens: 8 }) === 15);
check("B5 a missing field reads as zero, never NaN",
  S.tokensFrom({ input_tokens: 5 }) === 5 && Number.isFinite(S.tokensFrom({})));
// NaN would make every >= comparison false and silently disable the ceiling.
check("B6 junk cannot produce NaN",
  Number.isFinite(S.tokensFrom(null)) && Number.isFinite(S.tokensFrom("x")) &&
  Number.isFinite(S.tokensFrom({ input_tokens: "lots" })));

// ── §C the off switch ────────────────────────────────────────────────────────
console.log("\n── §C switching it off ──");
const OFF = { enabled: false, maxUsd: 1, maxTokens: 1 };
check("C1 disabled lifts BOTH ceilings", S.evaluateSpend({ usd: 1e6, tokens: 1e9 }, OFF).over === false);
check("C2 a zero dollar limit means unbounded, not block-everything",
  S.evaluateSpend({ usd: 1e6, tokens: 0 }, { enabled: true, maxUsd: 0, maxTokens: 0 }).over === false);
check("C3 ...and one dimension can be unbounded while the other holds",
  S.evaluateSpend({ usd: 1e6, tokens: 50 }, { enabled: true, maxUsd: 0, maxTokens: 10 }).over === true);

// ── §D reading it from settings ──────────────────────────────────────────────
console.log("\n── §D settings ──");
check("D1 a fresh install is CAPPED, not uncapped",
  S.limitsFrom(settings.DEFAULT_SETTINGS.agents?.spendCap).enabled === true);
check("D2 defaults carry real numbers",
  S.limitsFrom(settings.DEFAULT_SETTINGS.agents?.spendCap).maxUsd > 0);
// An install that has never opened the gear must still be protected.
check("D3 an ABSENT block reads as enabled", S.limitsFrom(undefined).enabled === true);
check("D4 only an explicit false disables it", S.limitsFrom({ enabled: false }).enabled === false);
check("D5 garbage falls back to the defaults rather than to 0",
  S.limitsFrom({ maxUsd: "free" }).maxUsd === S.DEFAULT_SPEND_LIMITS.maxUsd);
settings.writeSettings({ agents: { ...settings.readSettings().agents, spendCap: { enabled: true, maxUsd: 2, maxTokens: 50 } } });
check("D6 an edited ceiling round-trips",
  S.limitsFrom(settings.readSettings().agents?.spendCap).maxUsd === 2);
check("D7 ...without clobbering sibling agent settings",
  settings.readSettings().agents?.requireTestRun === true);

// ── §E wired into the runtime ────────────────────────────────────────────────
console.log("\n── §E enforcement is actually wired in ──");
const rt = read("src/lib/agentsRuntime.ts");
check("E1 the runtime reads the SDK's usage field", /usage\?: unknown/.test(rt));
check("E2 cost is assigned, not accumulated (the SDK reports cumulative totals)",
  /spentUsd = res\.total_cost_usd/.test(rt) && !/spentUsd \+=/.test(rt));
check("E3 the ceiling is checked at the loop boundary", /evaluateSpend\(/.test(rt));
// The point of checking BEFORE onTurnResult: stop without discarding the work.
check("E4 a tripped ceiling refuses to continue the session",
  /verdict\.over \? false : await onTurnResult/.test(rt));
check("E5 the stop is recorded on the run", /stoppedBy = "spend-cap"/.test(rt));
check("E6 tokens are persisted on the run meta", /r\.meta\.tokens = spentTokens/.test(rt));
const types = read("src/lib/agentsTypes.ts");
check("E7 RunMeta carries tokens + stoppedBy", /tokens\?: number/.test(types) && /stoppedBy\?: "spend-cap"/.test(types));

// ── §F the user can turn it off from the UI (rule 16) ────────────────────────
console.log("\n── §F the gear ──");
const gear = read("src/components/v2/agents/AgentsSettings.tsx");
check("F1 the Agents gear exposes the ceiling", /spendCap/.test(gear));
check("F2 it can be switched off", /spendCap: \{ \.\.\.spendCap, enabled: e\.target\.checked \}/.test(gear));
check("F3 both dimensions are editable", /maxUsd: n/.test(gear) && /maxTokens: n/.test(gear));
check("F4 the inputs disable when the cap is off", /disabled=\{!capOn\}/.test(gear));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
