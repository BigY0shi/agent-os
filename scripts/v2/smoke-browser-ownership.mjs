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

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
