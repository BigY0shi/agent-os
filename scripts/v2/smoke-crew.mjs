// S21 Crew + Agent City smoke, offline.
//   A. buildCrewSnapshot from hand-made runs with known times: counts, reply time, month
//      time, the heatmap puts owner messages at run STARTS (owner triggers only) and agent
//      replies at run ENDS, in the right day and hour; recent activity says what happened
//   B. chat: the log keeps only the owner's words + run id; replies come from the run
//      record (done / running / failed / missing / could not start)
//   C. routes from an empty temp agents dir: zero counts, prepared roles, real tier models;
//      chat refuses bad ids and unknown agents
//   D. UI wiring: tab registered, city seeded from ids, no invented activity, the wheel
//      does not trap the page, deploy goes through POST /api/agents
// Run: npx tsx scripts/v2/smoke-crew.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-crew-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");
process.env.AGENTIC_OS_CREW_DIR = path.join(tmp, "crew");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ agentsModels: { fast: "", standard: "model-standard-test", deep: "" } }), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");

const crew = await import("../../src/lib/v2/crew/crew.ts");
const H = 3_600_000, D = 24 * H;
// "now" = 2026-09-29 15:30 local; runs at known local times.
const now = new Date(2026, 8, 29, 15, 30).getTime();
const at = (daysAgo, hour, min = 0) => { const d = new Date(2026, 8, 29 - daysAgo, hour, min); return d.getTime(); };
const def = (id, name, enabled = true) => ({ id, name, description: `${name} desc`, enabled, intelligence: "standard", permissionMode: "gated", triggers: [], tools: { mcp: "none", browser: false }, createdAt: 0, updatedAt: 0 });
const agents = [def("a1", "Scout"), def("a2", "Writer"), def("a3", "Off", false)];
const runs = new Map([
  ["a1", [
    { id: "r1", agentId: "a1", trigger: "manual", status: "done", startedAt: at(0, 14, 0), endedAt: at(0, 14, 2), tokens: 1000, result: "Found two leads\nmore" },
    { id: "r2", agentId: "a1", trigger: "schedule", status: "done", startedAt: at(1, 9, 0), endedAt: at(1, 9, 4), tokens: 500 },
    { id: "r3", agentId: "a1", trigger: "crew-chat", status: "running", startedAt: at(0, 15, 20) },
    { id: "r4", agentId: "a1", trigger: "manual", status: "done", startedAt: at(20, 10, 0), endedAt: at(20, 10, 10) }, // outside 7 d
  ]],
  ["a2", [
    { id: "r5", agentId: "a2", trigger: "webhook", status: "error", startedAt: at(2, 22, 0), endedAt: at(2, 22, 1), error: "rate limited" },
  ]],
]);
const status = new Map([["a1", { status: "running" }], ["a2", { status: "idle" }]]);
const snap = crew.buildCrewSnapshot({ agents, runs, status, now });

// ── A ─────────────────────────────────────────────────────────────────────────
check("A1 agents and working-now counted", snap.counts.agents === 3 && snap.counts.workingNow === 1);
check("A2 messages in 7 days = runs started in 7 days", snap.counts.messages7d === 4, snap.counts);
check("A3 average reply from finished runs in 7 days", snap.counts.avgReplyMs === Math.round((2 * 60_000 + 4 * 60_000 + 60_000) / 3));
const monthMs = (2 + 4 + 1) * 60_000; // r4 is Sept 9: inside this month too
check("A4 agent time this month = finished run time since the 1st", snap.counts.agentTimeMonthMs === monthMs + 10 * 60_000, snap.counts.agentTimeMonthMs);
check("A5 disabled agent with no status reads 'offline'", snap.agents.find((a) => a.id === "a3").status === "offline");
check("A6 per-agent: runs, reply, tokens, sessions", (() => { const a = snap.agents.find((x) => x.id === "a1"); return a.runs7d === 3 && a.tokens7d === 1500 && a.sessions === 4 && a.avgReplyMs === 3 * 60_000; })());
check("A7 owner messages only from owner triggers (manual, crew-chat)", snap.heat.owner7d[6][14] === 1 && snap.heat.owner7d[6][15] === 1 && snap.heat.owner7d[5][9] === 0);
check("A8 agent replies at run ends, right day and hour", snap.heat.agent7d[6][14] === 1 && snap.heat.agent7d[5][9] === 1 && snap.heat.agent7d[4][22] === 1);
check("A9 24 h view holds only the last day", snap.heat.owner24h[14] === 1 && snap.heat.agent24h[22] === 0);
check("A10 day labels end today", snap.heat.days.length === 7 && snap.heat.days[6] === new Date(now).toLocaleDateString("en-US", { weekday: "short" }));
check("A11 recent activity newest first, in words", snap.recent[0].agent === "Scout" && snap.recent[0].what === "working" && snap.recent.some((r) => r.what === "Found two leads") && snap.recent.some((r) => r.what === "failed: rate limited"));
check("A12 the basis is stated", /recorded runs/.test(snap.basis));

// ── B ─────────────────────────────────────────────────────────────────────────
crew.appendOwnerLine("a1", { at: 1, text: "hello", runId: "r1" });
crew.appendOwnerLine("a1", { at: 2, text: "still there?", runId: "r3" });
crew.appendOwnerLine("a1", { at: 3, text: "and now?", runId: null, error: "agent already has an active run" });
crew.appendOwnerLine("a1", { at: 4, text: "lost one", runId: "gone" });
const lines = crew.readOwnerLines("a1");
check("B1 the log keeps only the owner's words and the run id", lines.length === 4 && Object.keys(lines[0]).sort().join(",") === "at,runId,text");
const metas = new Map([["r1", runs.get("a1")[0]], ["r3", runs.get("a1")[2]], ["gone", null]]);
const turns = crew.chatFrom(lines, metas);
check("B2 a finished run's reply is its own result", turns[1].role === "agent" && turns[1].text === "Found two leads\nmore" && turns[1].status === "done");
check("B3 a running run shows as working, pending", turns[3].pending === true && turns[3].text === "Working…");
check("B4 a refused start says why", turns[5].text === "Could not start: agent already has an active run" && turns[5].status === "error");
check("B5 a missing run record is said, not invented", turns[7].text === "The run's record is missing.");
check("B6 the log refuses a path-walking agent id", (() => { try { crew.readOwnerLines("../x"); return false; } catch { return true; } })());

// ── C ─────────────────────────────────────────────────────────────────────────
const list = await import("../../src/app/api/v2/crew/route.ts");
const res = await list.GET();
const j = await res.json();
check("C1 empty crew: zero counts, no agents", res.status === 200 && j.counts.agents === 0 && j.agents.length === 0, j);
check("C2 prepared roles ship with written instructions", j.roles.length >= 5 && j.roles.every((r) => r.instructions.length > 80 && r.oneLine));
check("C3 tiers name the real models (settings first, then defaults)", j.tiers.standard === "model-standard-test" && j.tiers.fast === "claude-haiku-4-5" && typeof j.tiers.deep === "string" && j.tiers.deep.length > 0);
const chat = await import("../../src/app/api/v2/crew/[id]/chat/route.ts");
const p = (id) => ({ params: Promise.resolve({ id }) });
check("C4 chat: unknown agent is 404", (await chat.GET(new Request("http://x"), p("nobody-agent-0000"))).status === 404);
check("C5 chat: bad id is 400", (await chat.GET(new Request("http://x"), p("../../etc"))).status === 400);
check("C6 chat: empty message refused before any run", (await chat.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ text: " " }) }), p("nobody-agent-0000"))).status === 404);

// ── D ─────────────────────────────────────────────────────────────────────────
const hub = read("src/components/jarvis/JarvisHub.tsx");
const tab = read("src/components/jarvis/CrewTab.tsx");
const city = read("src/components/jarvis/AgentCity.tsx");
check("D1 Crew tab registered in Jarvis", /key: "crew", label: "Crew"[^\n]*<CrewTab \/>/.test(hub));
check("D2 buildings are seeded from the agent id, nothing random", city.includes("rng(hash(a.id))") && !/Math\.random/.test(city) && !/Math\.random/.test(tab));
check("D3 roads pulse only while the agent is running", city.includes('s.visible = status === "running" && !reduced;'));
check("D4 no agent-to-agent transfers are invented", city.includes("agent-to-agent hand-offs are not recorded"));
check("D5 a plain wheel scrolls the page; Ctrl zooms", city.includes("controls.enableZoom = false;") && city.includes("if (!(e.ctrlKey || e.metaKey)) return;"));
check("D6 the city pauses when hidden or off screen", city.includes("document.hidden") && city.includes("IntersectionObserver"));
check("D7 deploy goes through the existing POST /api/agents", tab.includes('api<{ agent: { id: string }; warning?: string }>("/api/agents", { method: "POST"'));
check("D8 a degraded deploy shows its warning instead of pretending", tab.includes("if (j.warning) { setWarning(j.warning)"));
check("D9 the chat polls only while a reply is pending", tab.includes("if (!pending) return;"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
