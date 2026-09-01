// Principal identity: ids, lineage, gated folders, credential inheritance.
//
// Run: npx tsx scripts/v2/smoke-identity.mjs
//
// Rule 19: AGENTIC_OS_PRINCIPALS is redirected to a temp dir BEFORE the module
// is imported, so this never reads or writes the real ~/.agentic-os identity.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-identity-"));
process.env.AGENTIC_OS_PRINCIPALS = path.join(dir, "principals.json");
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
process.env.AGENTIC_OS_BROWSER_PROFILES = path.join(dir, "browser-profiles");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(dir, "agents");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};

const ids = await import("../../src/lib/v2/identity/ids.ts");
const P = await import("../../src/lib/v2/identity/principals.ts");

// ── §A id shape ──────────────────────────────────────────────────────────────
console.log("\n── §A id shape ──");
check("A1 a top-level agent id is a bare number", ids.isValidAgentId("43"));
check("A2 a sub-agent appends a letter", ids.isValidAgentId("43A"));
check("A3 depth nests", ids.isValidAgentId("43AB"));
check("A4 overflow past Z is still valid", ids.isValidAgentId("43A2"));
check("A5 junk is rejected", !ids.isValidAgentId("43-A") && !ids.isValidAgentId("../etc") && !ids.isValidAgentId(""));
check("A6 refs round-trip", ids.parsePrincipal("agent:43A")?.id === "43A" && ids.parsePrincipal("user:U1")?.kind === "user");
check("A7 a malformed ref parses to null (never a partial principal)",
  ids.parsePrincipal("agent:../x") === null && ids.parsePrincipal("43A") === null);

// ── §B lineage ───────────────────────────────────────────────────────────────
console.log("\n── §B lineage ──");
check("B1 root of a sub-agent is its top-level agent", ids.rootAgentOf("43AB") === "43");
check("B2 root of a top-level agent is itself", ids.rootAgentOf("43") === "43");
check("B3 generation depth", ids.generationOf("43") === 0 && ids.generationOf("43A") === 1 && ids.generationOf("43AB") === 2);
check("B4 descendant detection", ids.isDescendantOf("43AB", "43") && ids.isDescendantOf("43AB", "43A"));
check("B5 not reflexive", !ids.isDescendantOf("43", "43"));
check("B6 siblings are not descendants of each other", !ids.isDescendantOf("43B", "43A"));
// The trap this guards: string-prefix matching would call 431 a child of 43.
check("B7 a different agent that shares a numeric prefix is NOT a descendant",
  !ids.isDescendantOf("431", "43") && !ids.isDescendantOf("431A", "43"));

// ── §C allocation ────────────────────────────────────────────────────────────
console.log("\n── §C allocation ──");
check("C1 first agent is 1", ids.nextAgentId([]) === "1");
check("C2 numbers are never reused", ids.nextAgentId(["1", "2", "3"]) === "4");
check("C3 sub-agents go A, B, C as described",
  ids.nextSubAgentId("43", []) === "43A" &&
  ids.nextSubAgentId("43", ["43A"]) === "43B" &&
  ids.nextSubAgentId("43", ["43A", "43B"]) === "43C");
check("C4 grandchildren nest under their own parent", ids.nextSubAgentId("43A", ["43A"]) === "43AA");
// Passing the whole roster must not confuse siblings for children.
check("C5 unrelated ids in the roster are ignored",
  ids.nextSubAgentId("43", ["1", "44A", "43AB", "43A"]) === "43B",
  ids.nextSubAgentId("43", ["1", "44A", "43AB", "43A"]));
const twentySix = Array.from({ length: 26 }, (_, i) => `43${String.fromCharCode(65 + i)}`);
check("C6 the 27th sibling does not collide", ids.nextSubAgentId("43", twentySix) === "43A2");

// ── §D the user id ───────────────────────────────────────────────────────────
console.log("\n── §D the human ──");
const u = P.ensureUserId();
check("D1 a user id is minted on first run", u === "U1");
check("D2 it is stable across calls", P.ensureUserId() === u);
check("D3 it is written to disk", fs.existsSync(process.env.AGENTIC_OS_PRINCIPALS));
check("D4 currentUserRef is the canonical form", P.currentUserRef() === "user:U1");
// A second id would orphan every folder the real user owns.
fs.writeFileSync(process.env.AGENTIC_OS_PRINCIPALS, "{ this is not json");
let threw = null;
try { P.ensureUserId(); } catch (e) { threw = e; }
check("D5 an unreadable file THROWS rather than minting a second user", !!threw, String(threw));
fs.writeFileSync(process.env.AGENTIC_OS_PRINCIPALS, JSON.stringify({ userId: "U1" }));
check("D6 ...and recovers once the file is valid again", P.ensureUserId() === "U1");

// ── §E registration ──────────────────────────────────────────────────────────
console.log("\n── §E registration ──");
const claude = P.registerAgent({ label: "Claude Code", origin: "frontier-model", persistCredentials: true });
const codex = P.registerAgent({ label: "Codex", origin: "harness", persistCredentials: false });
check("E1 agents get sequential ids", claude.id === "1" && codex.id === "2", `${claude.id},${codex.id}`);
const sub = P.registerSubAgent(claude.id, "");
const sub2 = P.registerSubAgent(claude.id);
check("E2 sub-agents follow the A/B taxonomy", sub.id === "1A" && sub2.id === "1B", `${sub.id},${sub2.id}`);
const grand = P.registerSubAgent(sub.id);
check("E3 grandchildren nest", grand.id === "1AA", grand.id);
let subThrew = null;
try { P.registerSubAgent("999"); } catch (e) { subThrew = e; }
check("E4 an unregistered parent is refused", !!subThrew);

// ── §F credential inheritance (the security model) ───────────────────────────
console.log("\n── §F credential inheritance ──");
check("F1 a sub-agent's credential owner is its ROOT agent",
  P.credentialOwnerOf("agent:1AA") === "agent:1", P.credentialOwnerOf("agent:1AA"));
check("F2 a top-level agent owns itself", P.credentialOwnerOf("agent:2") === "agent:2");
check("F3 the user owns their own", P.credentialOwnerOf("user:U1") === "user:U1");
check("F4 sub-agents share the root's FOLDER, by construction",
  P.principalHome("agent:1AA") === P.principalHome("agent:1"));
check("F5 different agents get different folders",
  P.principalHome("agent:1") !== P.principalHome("agent:2"));
check("F6 the user's folder is not any agent's folder",
  P.principalHome("user:U1") !== P.principalHome("agent:1"));
// This is what the checkbox warning is about.
check("F7 persistence is inherited from the root, not asked per sub-agent",
  P.persistsFor("agent:1AA") === true && P.persistsFor("agent:2") === false);
check("F8 the user always persists", P.persistsFor("user:U1") === true);
check("F9 a folder path cannot escape the root",
  P.principalHome("agent:1").startsWith(P.principalsRoot()));
let homeThrew = null;
try { P.principalHome("agent:../../etc"); } catch (e) { homeThrew = e; }
check("F10 a malformed ref cannot produce a path at all", !!homeThrew);

// ── §G what the human sees ───────────────────────────────────────────────────
console.log("\n── §G display ──");
check("G1 an agent shows its LABEL, not its id", P.displayFor("agent:1") === "Claude Code", P.displayFor("agent:1"));
check("G2 a sub-agent inherits the label", P.displayFor("agent:1A").startsWith("Claude Code"), P.displayFor("agent:1A"));
check("G3 ...and is still distinguishable", P.displayFor("agent:1A") !== P.displayFor("agent:1"));
check("G4 the user reads as a person, not an id", P.displayFor("user:U1") === "You");
check("G5 no raw id leaks into a registered agent's display", !/\b1A\b/.test(P.displayFor("agent:1")));
check("G6 the directory carries display names for pickers",
  P.agentDirectory().some((a) => a.display === "Claude Code" && a.id === "1"));

// ── §H the warning copy ──────────────────────────────────────────────────────
console.log("\n── §H the persist warning ──");
const w = P.PERSIST_CREDENTIALS_WARNING;
check("H1 it names the inheritance explicitly", /sub-agent/i.test(w) && /inherit/i.test(w));
check("H2 it gives the concrete taxonomy example", /43A/.test(w));
check("H3 it states the consequence, not just the mechanism", /every sub-agent/i.test(w));

// ── §I isolation ─────────────────────────────────────────────────────────────
console.log("\n── §I isolation ──");
check("I1 this smoke never touched the real identity file",
  P.principalsPath().startsWith(os.tmpdir()), P.principalsPath());


// -- §J creation wiring ------------------------------------------------------
console.log("\n-- §J an agent gets its principal at birth --");
const store = await import("../../src/lib/agentsStore.ts");
const cfg = await import("../../src/lib/v2/browser/config.ts");
const readSrc = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const built = await store.createAgent({
  name: "Scraper", instructions: "scrape things", persistCredentials: true, origin: "forge",
});
const linked = P.listAgents().find((a) => a.externalId === built.id);
check("J1 creating an agent registers a principal", !!linked, built.id);
check("J2 the label is the agent name, not its uuid", linked?.label === "Scraper", linked?.label);
check("J3 the persist answer is recorded", linked?.persistCredentials === true);
check("J4 origin is carried through", linked?.origin === "forge", linked?.origin);
// Without the external-id link the browser layer would provision a SECOND
// principal on first call, silently losing the persist answer.
check("J5 callerRef resolves to the SAME principal, not a new one",
  P.callerRef(built.id) === "agent:" + linked?.id, P.callerRef(built.id));
const before = P.listAgents().length;
P.callerRef(built.id);
check("J6 repeat calls do not mint duplicates", P.listAgents().length === before);
check("J7 the agent owns a browser profile from birth",
  cfg.profileOwner("agent-" + linked?.id) === "agent:" + linked?.id, cfg.profileOwner("agent-" + linked?.id));
check("J8 it cannot reach a profile it does not own",
  cfg.checkProfileAccess("someone-elses", "agent:" + linked?.id).allowed === false);
const noPersist = await store.createAgent({ name: "Throwaway", instructions: "x" });
const np = P.listAgents().find((a) => a.externalId === noPersist.id);
check("J9 persistence defaults to OFF when nobody was asked", np?.persistCredentials === false);
check("J10 a sub-agent of a persisting root inherits rather than re-asking",
  P.persistsFor("agent:" + P.registerSubAgent(linked.id).id) === true);

// -- §K the choice is actually offered ---------------------------------------
console.log("\n-- §K the checkbox is wired, not just written --");
const copy = readSrc("src/lib/v2/identity/copy.ts");
check("K1 the copy module imports nothing (client-safe)", !/^import /m.test(copy));
const comp = readSrc("src/components/v2/identity/PersistCredentials.tsx");
check("K2 the component takes its copy from the shared module", comp.includes('@/lib/v2/identity/copy'));
check("K3 it shows the warning when TICKED", comp.includes("PERSIST_CREDENTIALS_WARNING"));
const wiz = readSrc("src/components/v2/agents/ForgeWizard.tsx");
check("K4 the Forge renders it", wiz.includes("<PersistCredentials"));
check("K5 the Forge SENDS the answer", /JSON\.stringify\(\{ name[^}]*persistCredentials/.test(wiz));
const route = readSrc("src/app/api/agents/route.ts");
check("K6 the create route forwards it", route.includes("persistCredentials: body.persistCredentials === true"));
const idRoute = readSrc("src/app/api/v2/identity/route.ts");
check("K7 sub-agents are refused a persistence toggle of their own", idRoute.includes('origin === "subagent"'));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
