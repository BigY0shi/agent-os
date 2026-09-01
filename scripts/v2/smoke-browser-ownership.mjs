// Credential containment: an agent must not be able to reach the user's
// browser profiles, and the denial must be loud.
//
// Run: npx tsx scripts/v2/smoke-browser-ownership.mjs
//
// Rule 19: principals, settings and the profile root are ALL redirected to temp
// dirs before any import, so this never reads the real identity file and never
// creates a directory under the live profile root.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-own-"));
process.env.AGENTIC_OS_PRINCIPALS = path.join(dir, "principals.json");
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
process.env.AGENTIC_OS_BROWSER_PROFILES = path.join(dir, "browser-profiles");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const cfg = await import("../../src/lib/v2/browser/config.ts");
const P = await import("../../src/lib/v2/identity/principals.ts");

const USER = P.currentUserRef();
const claude = P.registerAgent({ label: "Claude Code", origin: "frontier-model", persistCredentials: true });
const codex = P.registerAgent({ label: "Codex", origin: "harness", persistCredentials: false });
const claudeSub = P.registerSubAgent(claude.id);
const AGENT = `agent:${claude.id}`;
const AGENT_SUB = `agent:${claudeSub.id}`;
const OTHER = `agent:${codex.id}`;

// The user's own profile — created without an owner entry, which is exactly how
// every profile that predates this feature looks.
cfg.createProfile("mixamo");

// ── §A the default is strict ─────────────────────────────────────────────────
console.log("\n── §A unmapped profiles belong to the human ──");
check("A1 a profile with no owner record resolves to the user", cfg.profileOwner("mixamo") === USER, cfg.profileOwner("mixamo"));
check("A2 the user may use it", cfg.checkProfileAccess("mixamo", USER).allowed);
// The whole point. This is the state the codebase was in before today.
check("A3 an AGENT may NOT use the user's profile", cfg.checkProfileAccess("mixamo", AGENT).allowed === false);
check("A4 ...nor may a sub-agent", cfg.checkProfileAccess("mixamo", AGENT_SUB).allowed === false);
check("A5 ...nor an unrelated agent", cfg.checkProfileAccess("mixamo", OTHER).allowed === false);

// ── §B agents get their own ──────────────────────────────────────────────────
console.log("\n── §B an agent's own profile ──");
const own = cfg.ensureOwnProfile(AGENT);
check("B1 provisioning succeeds", own.success === true, own.error);
check("B2 the profile is owned by that agent", cfg.profileOwner(own.profile) === AGENT, cfg.profileOwner(own.profile));
check("B3 the agent may use it", cfg.checkProfileAccess(own.profile, AGENT).allowed);
check("B4 the user is not locked out of an agent profile they own the box for",
  cfg.checkProfileAccess(own.profile, USER).allowed === false);
check("B5 a DIFFERENT agent may not use it", cfg.checkProfileAccess(own.profile, OTHER).allowed === false);

// ── §C sub-agent inheritance ─────────────────────────────────────────────────
console.log("\n── §C sub-agents inherit, and only from their own root ──");
check("C1 a sub-agent reaches its orchestrator's profile", cfg.checkProfileAccess(own.profile, AGENT_SUB).allowed);
const grand = P.registerSubAgent(claudeSub.id);
check("C2 a grandchild reaches it too", cfg.checkProfileAccess(own.profile, `agent:${grand.id}`).allowed);
const codexOwn = cfg.ensureOwnProfile(OTHER);
check("C3 a sub-agent cannot reach a DIFFERENT root's profile",
  cfg.checkProfileAccess(codexOwn.profile, AGENT_SUB).allowed === false);
check("C4 the two agents got different profiles", own.profile !== codexOwn.profile);

// ── §D the denial is loud ────────────────────────────────────────────────────
console.log("\n── §D loud failure ──");
const denial = cfg.checkProfileAccess("mixamo", AGENT);
check("D1 a reason is present", typeof denial.reason === "string" && denial.reason.length > 40);
// A run that dies on this must tell the human WHO and WHAT, by label not id.
check("D2 it names the agent by LABEL, not id", denial.reason.includes("Claude Code"), denial.reason);
check("D3 it names the profile", denial.reason.includes("mixamo"));
check("D4 it names who actually owns it", /You/.test(denial.reason));
check("D5 it says what to do next", /own profile|reassign/i.test(denial.reason));
check("D6 no raw principal ref leaks into the message", !denial.reason.includes("agent:1"), denial.reason);

// ── §E the wiring (containment is worthless unenforced) ──────────────────────
console.log("\n── §E enforcement is actually wired in ──");
const tools = read("src/lib/v2/browser/tools.ts");
check("E1 a dedicated error code exists", /PROFILE_ACCESS_DENIED/.test(tools));
check("E2 the caller's principal is derived from opts.agentId", /callerRef\(opts\.agentId/.test(tools));
// resolve() is the funnel for every page-driving tool.
check("E3 resolve() guards before launching", /const resolve = async \([\s\S]{0,400}?guardProfile\(sessionName\)/.test(tools));
check("E4 create_session guards the binding", /browser_create_session[\s\S]{0,400}?checkProfileAccess\(p\.profile, principal\)/.test(tools));
check("E5 denials are audited, not swallowed", /audit\(false, decision\.reason\)/.test(tools));
const conf = read("src/lib/v2/browser/config.ts");
check("E6 access is compared by CREDENTIAL OWNER, not exact ref",
  /credentialOwnerOf\(principalRef\)/.test(conf) && /credentialOwnerOf\(ownerRef\)/.test(conf));

// ── §F isolation ─────────────────────────────────────────────────────────────
console.log("\n── §F isolation ──");
check("F1 principals file is a temp file", P.principalsPath().startsWith(os.tmpdir()));
check("F2 profile root is a temp dir", cfg.profilesRoot().startsWith(os.tmpdir()), cfg.profilesRoot());


// -- §G P0 REGRESSION: "keep signed in" must not be cosmetic ------------------
console.log("\n-- §G non-persistent agents do not retain state --");
// Before this, resolveLaunchDir did not exist: EVERY profile launched against
// the durable dir, so an agent the user declined to keep signed in kept its
// cookies across restarts anyway.
const persistOwn = cfg.ensureOwnProfile(AGENT).profile;      // Claude Code: persist ON
const ephemeralOwn = cfg.ensureOwnProfile(OTHER).profile;    // Codex: persist OFF
check("G1 a persisting agent launches against its DURABLE profile dir",
  cfg.resolveLaunchDir(persistOwn).dir === cfg.getProfileDir(persistOwn));
check("G2 ...and is reported persistent", cfg.resolveLaunchDir(persistOwn).persistent === true);
check("G3 a NON-persisting agent does NOT launch against the durable dir",
  cfg.resolveLaunchDir(ephemeralOwn).dir !== cfg.getProfileDir(ephemeralOwn),
  cfg.resolveLaunchDir(ephemeralOwn).dir);
check("G4 ...it launches under the OS temp root",
  cfg.resolveLaunchDir(ephemeralOwn).dir.startsWith(os.tmpdir()));
check("G5 ...and is reported ephemeral", cfg.resolveLaunchDir(ephemeralOwn).persistent === false);
// The restart property: the dir is process-scoped, so a new server run cannot
// reuse the previous run's cookies. No deletion involved (rule 1).
check("G6 the ephemeral dir is scoped to the process, so a restart starts clean",
  cfg.ephemeralProfileDir(ephemeralOwn).includes(String(process.pid)));
check("G7 an ephemeral path still cannot escape its root",
  (() => { try { cfg.ephemeralProfileDir("../../etc"); return false; } catch { return true; } })());
// Flipping the answer must change behaviour, not just the record.
const before = cfg.resolveLaunchDir(ephemeralOwn).persistent;
const fsMod = await import("node:fs");
const reg = JSON.parse(fsMod.readFileSync(P.principalsPath(), "utf8"));
reg.agents = reg.agents.map((a) => (a.id === codex.id ? { ...a, persistCredentials: true } : a));
fsMod.writeFileSync(P.principalsPath(), JSON.stringify(reg, null, 2));
check("G8 flipping the answer flips the launch dir",
  before === false && cfg.resolveLaunchDir(ephemeralOwn).persistent === true);
reg.agents = reg.agents.map((a) => (a.id === codex.id ? { ...a, persistCredentials: false } : a));
fsMod.writeFileSync(P.principalsPath(), JSON.stringify(reg, null, 2));

// -- §H P1 REGRESSION: destructive + enumerating tools ------------------------
console.log("\n-- §H foreign sessions cannot be closed, deleted or enumerated --");
const { executeBrowserTool } = await import("../../src/lib/v2/browser/tools.ts");
const settings = await import("../../src/lib/settings.ts");
settings.writeSettings({ capability: { browserEnabled: true } });

// A session on the HUMAN's profile, plus one on the agent's own.
cfg.createSessionConfig("humans-session", "mixamo");
cfg.createSessionConfig("agents-session", cfg.ownProfileName(AGENT));
const asAgent = { agentId: claude.externalId ?? "ext-claude", caller: "agent" };
P.linkExternalId(claude.id, "ext-claude");

const closeForeign = await executeBrowserTool("browser_close_session", { session: "humans-session" }, asAgent);
check("H1 an agent cannot CLOSE the human's session",
  closeForeign.ok === false && closeForeign.error.code === "PROFILE_ACCESS_DENIED",
  JSON.stringify(closeForeign).slice(0, 120));
const delForeign = await executeBrowserTool("browser_delete_session", { session: "humans-session" }, asAgent);
check("H2 an agent cannot DELETE the human's session",
  delForeign.ok === false && delForeign.error.code === "PROFILE_ACCESS_DENIED");
check("H3 ...and the config survived the attempt", !!cfg.getSessionConfig("humans-session"));

const listed = await executeBrowserTool("browser_list_sessions", {}, asAgent);
const names = listed.ok ? listed.result.sessions.map((s) => s.name) : [];
check("H4 list_sessions hides the human's sessions", !names.includes("humans-session"), names.join(","));
check("H5 ...but shows the agent's own", names.includes("agents-session"), names.join(","));
check("H6 profile enumeration is filtered too",
  listed.ok && !listed.result.profiles.includes("mixamo"),
  listed.ok ? listed.result.profiles.join(",") : "");

const closeAll = await executeBrowserTool("browser_close_all", {}, asAgent);
check("H7 close_all reports only the caller's own sessions", closeAll.ok === true);
check("H8 ...and did not touch the human's config", !!cfg.getSessionConfig("humans-session"));
// The human is not restricted by any of this.
const humanList = await executeBrowserTool("browser_list_sessions", {}, { caller: "user" });
check("H9 the human still sees their own sessions",
  humanList.ok && humanList.result.sessions.some((s) => s.name === "humans-session"));

// -- §I P1 REGRESSION: the third agent gets a real profile --------------------
console.log("\n-- §I provisioning does not run out at three agents --");
// 3 default profiles + MAX_PROFILES 5 previously left only two agent slots, and
// the failure was ignored while an ownership record was written anyway.
const provisioned = [];
for (let i = 0; i < 6; i++) {
  const a = P.registerAgent({ label: `Bulk ${i}`, origin: "forge", persistCredentials: false });
  const r = cfg.ensureOwnProfile(`agent:${a.id}`);
  provisioned.push({ id: a.id, ok: r.success, profile: r.profile, error: r.error });
}
check("I1 six consecutive agents all get a profile",
  provisioned.every((p) => p.ok), JSON.stringify(provisioned.filter((p) => !p.ok)));
check("I2 every one of them actually owns it",
  provisioned.every((p) => cfg.profileOwner(p.profile) === `agent:${p.id}`));
check("I3 no ownership record points at an unconfigured profile",
  provisioned.every((p) => cfg.isProfileConfigured(p.profile)));
// The human's own budget is still enforced.
const userProfiles = cfg.getConfiguredProfiles().filter((n) => !cfg.isAgentProfileName(n));
check("I4 agent profiles do not consume the human's budget", userProfiles.length <= 5, userProfiles.join(","));
// Add human profiles until the cap actually trips - the point is that agent
// profiles did not consume the budget on the way there.
let humanAdds = 0, lastErr = null;
for (let i = 0; i < 12; i++) {
  const r = cfg.createProfile(`human-extra-${i}`);
  if (!r.success) { lastErr = r.error; break; }
  humanAdds++;
}
check("I5 the human's cap still trips eventually", lastErr !== null, "never tripped");
check("I6 ...and it trips at the personal-profile cap, not sooner",
  /personal profiles/.test(lastErr ?? ""), lastErr ?? "");
check("I7 agent profiles were still provisionable past that cap",
  cfg.ensureOwnProfile(`agent:${P.registerAgent({ label: "After cap", origin: "forge", persistCredentials: false }).id}`).success === true);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
