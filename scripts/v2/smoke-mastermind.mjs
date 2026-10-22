// S25 Mastermind smoke, offline. HOME, the config file and the vault all point at temp
// dirs, so the owner's real vault conversations are never read or written.
//   A. the working counter counts, releases, and never goes negative
//   B. /api/room/status: one status word per specialist from real signals, in order
//      working now > unreachable > active today > ready; counts in the header
//   C. the room route releases "working" in a finally, so a failed reply cannot leave
//      an agent stuck as working
//   D. one-on-one threads: stored as dm-<agent> in the same vault store, kept out of the
//      group chat's own list; the whole room is the unchanged group chat
// CLI presence is a real, read-only fact of this machine, so expectations are derived
// from agentReachability() rather than hard-coded.
// Run: npx tsx scripts/v2/smoke-mastermind.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mastermind-"));
const vault = path.join(tmp, "vault");
fs.mkdirSync(vault, { recursive: true });
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_CONFIG = path.join(tmp, "config.json");
fs.writeFileSync(process.env.AGENTIC_OS_CONFIG, JSON.stringify({ vaultRoot: vault }), "utf8");
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
const read = (f) => fs.readFileSync(f, "utf8");

const R = await import("../../src/lib/agentRoom.ts");

// ── A ─────────────────────────────────────────────────────────────────────────
R.markWorking("claude", 1); R.markWorking("claude", 1);
check("A1 two replies in flight -> working", R.isWorking("claude"));
R.markWorking("claude", -1);
check("A2 one released, one still in flight", R.isWorking("claude"));
R.markWorking("claude", -1); R.markWorking("claude", -1);
check("A3 all released -> not working, and never negative", !R.isWorking("claude") && (R.markWorking("claude", 1), R.isWorking("claude")) && (R.markWorking("claude", -1), !R.isWorking("claude")));

// ── B ─────────────────────────────────────────────────────────────────────────
const agents = R.roomAgents();
const reach = Object.fromEntries(agents.map((a) => [a.id, R.agentReachability(a)]));
const reachable = agents.filter((a) => reach[a.id].ok).map((a) => a.id);
const talker = reachable.find((id) => id !== reachable[0]) ?? reachable[0];
await R.saveConversation({ id: "room-today", title: "Today", ts: Date.now(), msgs: [{ key: 1, who: "you", text: "hi" }, { key: 2, who: talker, name: talker, text: "hello" }] });
await R.saveConversation({ id: "room-old", title: "Old", ts: Date.now() - 3 * 86_400_000, msgs: [{ key: 1, who: agents.at(-1).id, text: "old reply" }] });
check("B0 the conversations landed in the TEMP vault", fs.existsSync(path.join(vault, "Agentic OS", "Agent Room", "conversations", "room-today.json")));
const worker = reachable[0];
R.markWorking(worker, 1);
const route = await import("../../src/app/api/room/status/route.ts");
const j = await (await route.GET()).json();
R.markWorking(worker, -1);
const st = Object.fromEntries(j.specialists.map((s) => [s.id, s.status]));
const expected = (id) => (id === worker ? "working now" : !reach[id].ok ? "unreachable" : id === talker && talker !== worker ? "active today" : "ready");
check("B1 every specialist has exactly the status its signals give", agents.every((a) => st[a.id] === expected(a.id)), { st, worker, talker });
check("B2 a reply in flight wins over everything", st[worker] === "working now");
check("B3 speaking in an old conversation is not 'active today'", agents.at(-1).id === talker || st[agents.at(-1).id] !== "active today");
check("B4 unreachable says why", j.specialists.filter((s) => s.status === "unreachable").every((s) => /not installed|not set|no /.test(s.why)));
check("B5 header counts", j.counts.specialists === agents.length && j.counts.workingNow === 1 && j.counts.unreachable === agents.filter((a) => !reach[a.id].ok).length);

// ── C ─────────────────────────────────────────────────────────────────────────
const roomRoute = read("src/app/api/room/route.ts");
check("C1 the room route marks working and releases it in finally", /markWorking\(agent\.id, 1\);\s*\n\s*try \{ raw = await roomReply/.test(roomRoute) && roomRoute.includes("finally { markWorking(agent.id, -1); }"));

// ── D ─────────────────────────────────────────────────────────────────────────
const mm = read("src/components/MastermindView.tsx");
const gc = read("src/components/GroupChatView.tsx");
check("D1 one-on-one threads are dm-<agent> in the same store", mm.includes("const id = `dm-${s.id}`;") && mm.includes('fetch("/api/room/history", { method: "POST"'));
check("D2 a one-on-one message goes to that specialist only", mm.includes("agents: [s.id]"));
check("D3 the group chat's own list leaves dm- threads out", gc.includes('!String(c.id).startsWith("dm-")'));
check("D4 'The whole room' is the unchanged group chat", mm.includes(": <GroupChatView />") && read("src/app/room/page.tsx").includes("<MastermindView />"));
check("D5 the rail shows counts and a status word per specialist", mm.includes("specialists, ${counts.workingNow} working now") && mm.includes("{s.status}"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
