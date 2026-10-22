// S36 Fleet stats smoke, offline (feat-s36-fleet-stats, Nexora C9).
//   A. the pure math on hand-made events at known instants: local-midnight alignment in the
//      owner's timezone, 6/12/24/48 h buckets re-bucket the same events, the weekday x hour
//      heatmap lands in the right cell, an empty fleet is all zeros, the not-tracked path
//      carries no number, bad settings fall back loudly
//   B. the collector on a temp DB + temp dirs with seeded rows (Jarvis, Rabbit, task chats,
//      task sessions, agent runs, module runs, a mission with two hand-offs, an Ultracode
//      run): every count is the seeded count, Hermes reads "not tracked", and changing the
//      bucket setting in settings.json re-buckets on the next read with no rebuild
//   C. wiring: the cockpit mounts the card, the gear offers exactly the stated choices, the
//      route exists, the defaults are 12 h / 14 days, the doc has the controls
// Run: npx tsx scripts/v2/smoke-fleet-stats.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── temp env BEFORE any src import (rule 19: never the live stores) ───────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-fleet-stats-"));
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");
process.env.AGENTIC_OS_PRINCIPALS = path.join(tmp, "principals.json");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_MISSIONS_DIR = path.join(tmp, "missions");
process.env.AGENTIC_OS_ULTRACODE_RUNS = path.join(tmp, "ultracode-runs");
process.env.AGENTIC_OS_CREW_DIR = path.join(tmp, "crew");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port: nothing may call out
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ tasks: { timezone: "America/Chicago" }, fleetStats: { bucketHours: 12, windowDays: 14 } }), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const H = 3_600_000, DAY = 24 * H;

const S = await import("../../src/lib/v2/fleetStats/stats.ts");
const { writeSettings } = await import("../../src/lib/settings.ts");

// ── A. pure math ──────────────────────────────────────────────────────────────
const TZ = "America/Chicago"; // CDT (UTC-5) on these dates
const NOW = Date.parse("2026-09-29T20:30:00Z"); // Tue 2026-09-29 15:30 CDT
const opts = { now: NOW, bucketHours: 12, windowDays: 14, timeZone: TZ };

check("A1 localParts in the zone: Tue 15:30", (() => { const p = S.localParts(NOW, TZ); return p.weekday === 1 && p.hour === 15 && p.minute === 30 && p.day === 29; })(), S.localParts(NOW, TZ));
check("A2 zonedMidnight is local midnight, not UTC midnight", S.zonedMidnight(NOW, TZ) === Date.parse("2026-09-29T05:00:00Z"), new Date(S.zonedMidnight(NOW, TZ)).toISOString());
const win = S.windowOf(opts);
check("A3 window starts at local midnight 14 days back", win.start === Date.parse("2026-09-15T05:00:00Z") && win.end === NOW, new Date(win.start).toISOString());

const ev = (iso, who) => ({ at: Date.parse(iso), who, source: "test" });
const events = [
  ev("2026-09-15T06:00:00Z", "agents"),   // Tue 01:00 CDT, first bucket
  ev("2026-09-16T04:59:00Z", "you"),      // Tue 23:59 CDT, still day 0 PM bucket (index 1)
  ev("2026-09-16T05:00:00Z", "you"),      // Wed 00:00 CDT, day 1 AM bucket (index 2)
  ev("2026-09-29T20:00:00Z", "you"),      // Tue 15:00 CDT today, last bucket
  ev("2026-09-14T00:00:00Z", "agents"),   // before the window: ignored
  ev("2026-09-29T21:00:00Z", "agents"),   // after now: ignored
  { at: NaN, who: "you", source: "test" }, // unreadable timestamp: ignored, never placed
];
const b12 = S.bucketize(events, opts);
check("A4 12 h buckets: 28 full days + the part of today = 30", b12.length === 30, b12.length);
check("A5 first bucket holds the 01:00 agent event", b12[0].agents === 1 && b12[0].you === 0, b12[0]);
check("A6 23:59 local lands in the PM bucket and 00:00 local in the next day's AM bucket (local-midnight alignment)", b12[1].you === 1 && b12[2].you === 1, [b12[1], b12[2]]);
check("A7 today's event is in the last, still-filling bucket", b12[29].you === 1, b12[29]);
const sum = (bs) => bs.reduce((t, b) => ({ you: t.you + b.you, agents: t.agents + b.agents }), { you: 0, agents: 0 });
check("A8 out-of-window and NaN events are not counted", sum(b12).you === 3 && sum(b12).agents === 1, sum(b12));
const lens = Object.fromEntries(S.BUCKET_CHOICES.map((h) => [h, S.bucketize(events, { ...opts, bucketHours: h }).length]));
check("A9 every bucket size re-buckets the same events: 6 h = 59, 12 h = 30, 24 h = 15, 48 h = 8", lens[6] === 59 && lens[12] === 30 && lens[24] === 15 && lens[48] === 8, lens);
check("A10 totals are the same at every bucket size", S.BUCKET_CHOICES.every((h) => { const t = sum(S.bucketize(events, { ...opts, bucketHours: h })); return t.you === 3 && t.agents === 1; }));
const b24 = S.bucketize(events, { ...opts, bucketHours: 24 });
check("A11 at 24 h the two midnight-straddling events split across days 0 and 1", b24[0].you === 1 && b24[1].you === 1 && b24[0].agents === 1, [b24[0], b24[1]]);

const heat = S.heatmap(events, opts);
check("A12 heatmap is 7 x 24 for both lines", heat.you.length === 7 && heat.agents.length === 7 && heat.you.every((r) => r.length === 24) && heat.days[0] === "Mon" && heat.days[6] === "Sun");
check("A13 Tue 15:00 CDT (you) and Tue 01:00 CDT (agents) land in their cells", heat.you[1][15] === 1 && heat.agents[1][1] === 1, { you: heat.you[1], agents: heat.agents[1] });
check("A14 heat totals equal the in-window events (zone, not UTC)", heat.you.flat().reduce((a, b) => a + b, 0) === 3 && heat.agents.flat().reduce((a, b) => a + b, 0) === 1);
check("A15 UTC would put 23:59 CDT on the next day; the zone keeps it on Tuesday", S.heatmap(events, { ...opts, timeZone: "UTC" }).you[2][4] === 1 && heat.you[1][23] === 1);

const empty = S.buildFleetStats({ events: [], handoffs: [], sessions: [], errors: {} }, opts);
check("A16 an empty fleet reads as empty: every bucket 0, heat 0, no hand-offs, sessions 0", empty.buckets.every((b) => b.you === 0 && b.agents === 0) && empty.heat.you.flat().every((v) => v === 0) && empty.handoffs.length === 0 && empty.sessions.total === 0 && empty.sessions.last24h === 0 && empty.totals.you === 0);

const mixed = S.buildFleetStats({
  events: [], errors: {},
  handoffs: Array.from({ length: 20 }, (_, i) => ({ at: NOW - i * H, missionId: "m", mission: "M", step: `s${i}`, from: "Jarvis", to: "claude" })),
  sessions: [
    { id: "a", label: "A", tracked: true, last24h: 1, total: 3 },
    { id: "b", label: "B", tracked: false, reason: "no record" },
  ],
}, opts);
const untracked = mixed.sessions.sources.find((s) => s.id === "b");
check("A17 an untracked source carries no number at all (no 0, no estimate)", untracked && untracked.tracked === false && !("total" in untracked) && !("last24h" in untracked) && untracked.reason === "no record", untracked);
check("A18 totals count only tracked sources and say how many are untracked", mixed.sessions.total === 3 && mixed.sessions.last24h === 1 && mixed.sessions.untracked === 1, mixed.sessions);
check("A19 hand-offs are newest first and capped", mixed.handoffs.length === S.HANDOFF_LIMIT && mixed.handoffs[0].step === "s0" && mixed.handoffs[1].at < mixed.handoffs[0].at);
check("A20 an unknown zone is refused, a known one accepted", !S.isValidTimeZone("Not/AZone") && S.isValidTimeZone("Europe/Berlin"));

writeSettings({ tasks: { timezone: "Not/AZone" }, fleetStats: { bucketHours: 7, windowDays: 13 } });
const bad = S.fleetStatsOptions(NOW);
check("A21 bad settings fall back to the defaults and SAY so (UTC, 12 h, 14 d, three errors)", bad.timeZone === "UTC" && bad.bucketHours === 12 && bad.windowDays === 14 && !!bad.errors.timeZone && !!bad.errors.bucketHours && !!bad.errors.windowDays, bad);
writeSettings({ tasks: { timezone: TZ }, fleetStats: { bucketHours: 12, windowDays: 14 } });
check("A22 defaults are 12 h and 14 days", S.DEFAULT_BUCKET_HOURS === 12 && S.DEFAULT_WINDOW_DAYS === 14 && S.fleetStatsOptions(NOW).bucketHours === 12 && S.fleetStatsOptions(NOW).windowDays === 14);

// ── B. the collector on seeded stores ─────────────────────────────────────────
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const { getDb } = await import("../../src/lib/v2/db.ts");
const db = getDb();
db.exec("BEGIN");
db.prepare("INSERT INTO jarvis_conversations(id, title, channel, created_at, updated_at) VALUES (?,?,?,?,?)").run("jc1", "t", "overlay", iso(now - H), iso(now - H));
db.prepare("INSERT INTO jarvis_conversations(id, title, channel, created_at, updated_at) VALUES (?,?,?,?,?)").run("jc2", "t", "page", iso(now - 3 * DAY), iso(now - 3 * DAY));
const jm = db.prepare("INSERT INTO jarvis_messages(id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)");
jm.run("jm1", "jc1", "user", "hi", iso(now - H));
jm.run("jm2", "jc1", "assistant", "hello", iso(now - H + 1000));
jm.run("jm3", "jc2", "user", "old", iso(now - 30 * DAY)); // outside the 14-day window
db.prepare("INSERT INTO rabbit_sessions(id, title, model, client, created_at, updated_at) VALUES (?,?,?,?,?,?)").run("rs1", "t", "m", "c", iso(now - 2 * H), iso(now - 2 * H));
const rm = db.prepare("INSERT INTO rabbit_messages(id, session_id, role, content, created_at) VALUES (?,?,?,?,?)");
rm.run("rm1", "rs1", "user", "q", iso(now - 2 * H));
rm.run("rm2", "rs1", "assistant", "a", iso(now - 2 * H + 1000));
db.prepare("INSERT INTO v2_tasks(id, display_id, title, created_at, updated_at) VALUES (?,?,?,?,?)").run("t1", "T-1", "task", iso(now - DAY), iso(now - DAY));
db.prepare("INSERT INTO v2_conversations(id, source, task_id, created_at, updated_at) VALUES (?,?,?,?,?)").run("c1", "task", "t1", iso(now - 3 * H), iso(now - 3 * H));
const vm = db.prepare("INSERT INTO v2_messages(id, conversation_id, role, user_type, ephemeral, content, created_at) VALUES (?,?,?,?,?,?,?)");
vm.run("vm1", "c1", "user", "human", 0, "do it", iso(now - 3 * H));
vm.run("vm2", "c1", "user", "system", 1, "trigger", iso(now - 3 * H)); // system trigger: not the owner
vm.run("vm3", "c1", "assistant", "human", 0, "done", iso(now - 3 * H + 1000));
db.prepare("INSERT INTO v2_task_sessions(id, task_id, kind, created_at, updated_at) VALUES (?,?,?,?,?)").run("ts1", "t1", "coding", iso(now - 3 * H), iso(now - 3 * H));
db.exec("COMMIT");

const agentDir = path.join(process.env.AGENTIC_OS_AGENTS_DIR, "a1");
fs.mkdirSync(path.join(agentDir, "runs"), { recursive: true });
fs.writeFileSync(path.join(agentDir, "agent.json"), JSON.stringify({ id: "a1", name: "Scout", description: "", enabled: true, intelligence: "standard", permissionMode: "gated", triggers: [], tools: { mcp: "none", browser: false }, createdAt: 0, updatedAt: 0 }));
fs.writeFileSync(path.join(agentDir, "runs", "r1.meta.json"), JSON.stringify({ id: "r1", agentId: "a1", trigger: "manual", status: "done", startedAt: now - 2 * H, endedAt: now - 2 * H + 60_000 }));
fs.writeFileSync(path.join(agentDir, "runs", "r2.meta.json"), JSON.stringify({ id: "r2", agentId: "a1", trigger: "schedule", status: "done", startedAt: now - 26 * H, endedAt: now - 26 * H + 60_000 }));
fs.writeFileSync(path.join(agentDir, "runs", "torn.meta.json"), "{not json");
fs.mkdirSync(process.env.AGENTIC_OS_RUNS_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.AGENTIC_OS_RUNS_DIR, "module-runs.json"), JSON.stringify({ runs: [{ id: "mr1", module: "deal-desk", label: "scan", status: "done", startedAt: now - 3 * H, endedAt: now - 3 * H + 5000, events: [] }] }));
const mdir = path.join(process.env.AGENTIC_OS_MISSIONS_DIR, "m_fleetstats0001");
fs.mkdirSync(mdir, { recursive: true });
fs.writeFileSync(path.join(mdir, "mission.json"), JSON.stringify({
  id: "m_fleetstats0001", name: "Ship the thing", objective: "o", successLooksLike: "s", priority: "normal", teamMode: "jarvis",
  seats: [{ id: "s1", agent: "claude", role: "Researcher" }, { id: "s2", agent: "codex", role: "Builder" }],
  limits: { timeLimitMin: 30, maxSteps: 4, reportLength: "brief" }, endAction: "review", stage: "review", planApproved: true, createdAt: now - 6 * H,
  plan: { rationale: "r", guardrails: [], plannedAt: now - 6 * H, steps: [
    { id: "st1", title: "Research", seatId: "s1", brief: "b", dependsOn: [], status: "done", startedAt: now - 5 * H, finishedAt: now - 4 * H },
    { id: "st2", title: "Build", seatId: "s2", brief: "b", dependsOn: ["st1"], status: "done", startedAt: now - 4 * H, finishedAt: now - 3 * H },
  ] },
}));
fs.writeFileSync(path.join(mdir, "events.jsonl"), [
  JSON.stringify({ at: now - 6 * H, kind: "created", text: "created" }),
  JSON.stringify({ at: now - 5 * H, kind: "handoff", stepId: "st1", seatId: "s1", text: "Jarvis handed Research to claude" }),
  JSON.stringify({ at: now - 4 * H, kind: "handoff", stepId: "st2", seatId: "s2", text: "Jarvis handed Build to codex" }),
].join("\n") + "\n");
fs.mkdirSync(process.env.AGENTIC_OS_ULTRACODE_RUNS, { recursive: true });
fs.writeFileSync(path.join(process.env.AGENTIC_OS_ULTRACODE_RUNS, "u1.json"), JSON.stringify({ id: "u1", prompt: "p", model: "m", ultracode: true, turns: [], startedAt: now - H, status: "completed", subagents: [], verdicts: [] }));

const live = await S.readFleetStats(now);
const bySrc = Object.fromEntries(live.sessions.sources.map((s) => [s.id, s]));
check("B1 settings applied: 12 h buckets over 14 days in the Tasks timezone", live.bucketHours === 12 && live.windowDays === 14 && live.timeZone === TZ && live.buckets.length >= 28 && live.buckets.length <= 30, [live.bucketHours, live.windowDays, live.timeZone, live.buckets.length]);
check("B2 you = 5 (Jarvis, Rabbit, task chat, manual run, mission created); the old Jarvis message and the system trigger do not count", live.totals.you === 5, live.totals);
check("B3 agents = 9 (3 replies, 2 agent runs, 1 module run, 2 mission steps, 1 Ultracode run)", live.totals.agents === 9, live.totals);
check("B4 Jarvis sessions: 2 total, 1 in 24 h", bySrc.jarvis?.tracked && bySrc.jarvis.total === 2 && bySrc.jarvis.last24h === 1, bySrc.jarvis);
check("B5 Rabbit, task chats, task sessions: 1 / 1 each", ["rabbit", "task-chats", "task-sessions"].every((k) => bySrc[k]?.tracked && bySrc[k].total === 1 && bySrc[k].last24h === 1), [bySrc.rabbit, bySrc["task-chats"], bySrc["task-sessions"]]);
check("B6 agent runs: 2 total, 1 in 24 h; the torn record is skipped, not invented", bySrc["agent-runs"]?.tracked && bySrc["agent-runs"].total === 2 && bySrc["agent-runs"].last24h === 1, bySrc["agent-runs"]);
check("B7 module runs, missions, Ultracode: 1 / 1 each", ["module-runs", "missions", "ultracode"].every((k) => bySrc[k]?.tracked && bySrc[k].total === 1 && bySrc[k].last24h === 1), [bySrc["module-runs"], bySrc.missions, bySrc.ultracode]);
check("B8 Hermes reads not tracked with its reason, and is the only untracked source", bySrc.hermes?.tracked === false && /state\.db/.test(bySrc.hermes.reason) && live.sessions.untracked === 1 && Object.keys(live.errors).length === 0, [bySrc.hermes, live.errors]);
check("B9 session totals: 8 in 24 h, 10 total, Hermes left out", live.sessions.last24h === 8 && live.sessions.total === 10, live.sessions);
check("B10 two hand-offs, newest first: claude (Researcher) -> codex (Builder), then Jarvis -> claude (Researcher)", live.handoffs.length === 2 && live.handoffs[0].from === "claude (Researcher)" && live.handoffs[0].to === "codex (Builder)" && live.handoffs[0].step === "Build" && live.handoffs[1].from === "Jarvis" && live.handoffs[1].to === "claude (Researcher)" && live.handoffs[0].mission === "Ship the thing", live.handoffs);
check("B11 the buckets add up to the totals and the heat adds up too", sum(live.buckets).you === 5 && sum(live.buckets).agents === 9 && live.heat.you.flat().reduce((a, b) => a + b, 0) === 5 && live.heat.agents.flat().reduce((a, b) => a + b, 0) === 9);
check("B12 the basis of each line is stated", /Jarvis/.test(live.basis.you) && /runs/.test(live.basis.agents));

// Changing the bucket in settings.json (what the gear writes) re-buckets on the next read.
writeSettings({ fleetStats: { bucketHours: 24 } });
const re = await S.readFleetStats(now);
check("B13 bucket 24 h from settings re-buckets on the next read: half the buckets, same totals, no rebuild", re.bucketHours === 24 && re.buckets.length < live.buckets.length && re.buckets.length >= 14 && re.totals.you === 5 && re.totals.agents === 9, [re.bucketHours, re.buckets.length]);
writeSettings({ fleetStats: { bucketHours: 12, windowDays: 7 } });
const re7 = await S.readFleetStats(now);
check("B14 window 7 days from settings: the 26 h-old run still counts, the window is shorter", re7.windowDays === 7 && re7.buckets.length <= 16 && re7.totals.agents === 9, [re7.windowDays, re7.buckets.length, re7.totals]);

// ── C. wiring ─────────────────────────────────────────────────────────────────
const overview = read("src/components/Overview.tsx");
check("C1 the cockpit view mounts FleetStats under the telemetry band", /import FleetStats from "\.\/v2\/home\/FleetStats"/.test(overview) && /<CockpitBand \/>[\s\S]*<FleetStats \/>/.test(overview));
const ui = read("src/components/v2/home/FleetStats.tsx");
check("C2 the card reads the route and never estimates: 'not tracked' is rendered as words", /\/api\/v2\/home\/fleet-stats/.test(ui) && /not tracked/.test(ui));
check("C3 the gear offers 6/12/24/48 h buckets and 7/14/30/60 day windows, saved through useSettings", /BUCKET_CHOICES = \[6, 12, 24, 48\]/.test(ui) && /WINDOW_CHOICES = \[7, 14, 30, 60\]/.test(ui) && /save\(\{ fleetStats:/.test(ui) && /useSettings\(\)/.test(ui));
check("C4 an empty window says so; the heatmap names the zone; hand-offs have an empty state", /Nothing recorded in this window/.test(ui) && /stats\.timeZone/.test(ui) && /No hand-offs recorded/.test(ui));
check("C5 the route exists and is dynamic", fs.existsSync(path.join(root, "src/app/api/v2/home/fleet-stats/route.ts")) && /force-dynamic/.test(read("src/app/api/v2/home/fleet-stats/route.ts")));
const settingsSrc = read("src/lib/settings.ts");
check("C6 settings carry fleetStats with defaults 12 h / 14 days", /fleetStats\?: \{/.test(settingsSrc) && /fleetStats: \{ bucketHours: 12, windowDays: 14 \}/.test(settingsSrc));
const doc = read("docs/modules/mission-control.md");
check("C7 the Mission Control doc lists the Fleet stats cards and the gear's two settings", /Fleet stats/.test(doc) && /\*\*Bucket\*\*/.test(doc) && /\*\*Window\*\*/.test(doc) && /not tracked/.test(doc) && /fleet-stats/.test(doc));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}  (temp ${tmp})`);
process.exit(failures ? 1 : 0);
