// SPEC-E F2.1/F2.2/F6.1 smoke: statusFeed single derivation + agent_status_events
// rows + "agent.status" bus emits + the /api/v2/agents/status SSE route
// (?once=1 poll fallback AND the stream itself) + StatusBand adoption /
// no-re-derivation greps. Run: npx tsx scripts/v2/smoke-agents-status.mjs
//
// Temp-env recipe (smoke-browser-ws pattern): AGENTIC_OS_DB + AGENTIC_OS_SETTINGS
// + AGENTIC_OS_AGENTS_DIR all point at throwaway dirs — the LIVE stores are
// never touched. process.exit at the end because ensureV2 starts timers.
// Fully offline: no Ollama/LLM calls (OLLAMA_URL pinned to a dead port).
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src imports ──────────────────────────────────────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-status-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-status-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-status-agents-"));
process.env.AGENTIC_OS_AGENTS_DIR = agentsDir;
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may call out
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    memory: { ingestEnabled: false },
    capability: { browserEnabled: false },
    tasks: { timezone: "America/Chicago" },
    browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
  }),
);

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};

const store = await import("../../src/lib/agentsStore.ts");
const feed = await import("../../src/lib/v2/agents/statusFeed.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");

// ── fixture agents (written to the TEMP agents dir) ──────────────────────────
const a1 = await store.createAgent({ name: "smoke idle", instructions: "reply ok" });
const a2 = await store.createAgent({ name: "smoke disabled", instructions: "reply ok" });
await store.saveAgent({ ...a2, enabled: false });
const a3 = await store.createAgent({ name: "smoke test-lifecycle", instructions: "reply ok" });
await store.saveAgent({ ...a3, lifecycle: "test" });
const a4 = await store.createAgent({ name: "smoke errored", instructions: "reply ok" });
await store.saveRunMeta({
  id: "run-err-1", agentId: a4.id, trigger: "manual", status: "error",
  startedAt: Date.now() - 60_000, endedAt: Date.now() - 59_000, error: "boom: fixture failure",
});

// ── §A single derivation (CONVENTIONS §6 mapping) ────────────────────────────
console.log("\n── §A statusFeed.getStatusSnapshot derivation ──");
{
  const snap = await feed.getStatusSnapshot();
  const by = new Map(snap.map((s) => [s.agentId, s]));
  check("A1 snapshot covers all 4 agents", snap.length === 4, `got ${snap.length}`);
  check("A2 enabled + no runs → idle", by.get(a1.id)?.status === "idle", by.get(a1.id)?.status);
  check("A3 enabled:false → offline ('disabled')",
    by.get(a2.id)?.status === "offline" && by.get(a2.id)?.detail === "disabled", JSON.stringify(by.get(a2.id)));
  check("A4 lifecycle 'test' → offline (label carries the lifecycle word)",
    by.get(a3.id)?.status === "offline" && by.get(a3.id)?.detail === "test", JSON.stringify(by.get(a3.id)));
  check("A5 last run error → error (detail carries the message)",
    by.get(a4.id)?.status === "error" && /boom/.test(by.get(a4.id)?.detail ?? ""), JSON.stringify(by.get(a4.id)));
  check("A6 absent lifecycle = deployed (a1 was NOT offline)", by.get(a1.id)?.status !== "offline");
}

// ── §B live-registry transitions + event rows + bus emits ────────────────────
console.log("\n── §B transitions: rows in agent_status_events + agent.status emits ──");
{
  const rowsFor = (id) =>
    getDb().prepare("SELECT status FROM agent_status_events WHERE agent_id = ? ORDER BY id").all(id).map((r) => r.status);

  const baseline = rowsFor(a1.id);
  check("B1 first observation logged (idle row exists)", baseline.length === 1 && baseline[0] === "idle", JSON.stringify(baseline));

  // Simulate agentsRuntime's live registry (the structural globalThis contract
  // statusFeed reads — agentsRuntime keeps LiveRun objects in __agentsRuns).
  const g = globalThis;
  g.__agentsRuns ??= new Map();
  const meta = { id: "run-live-1", agentId: a1.id, trigger: "manual", status: "running", startedAt: Date.now() };
  g.__agentsRuns.set(meta.id, { meta, events: [], seq: 0, pending: new Map(), mcpHealth: [] });

  const seen = [];
  const unsub = feed.subscribeStatus((ev) => seen.push(ev));

  let snap = await feed.getStatusSnapshot();
  let s1 = snap.find((s) => s.agentId === a1.id);
  check("B2 live run → running (runId + trigger detail)",
    s1?.status === "running" && s1?.runId === "run-live-1" && /manual/.test(s1?.detail ?? ""), JSON.stringify(s1));
  check("B3 change row inserted (idle → running)", JSON.stringify(rowsFor(a1.id)) === JSON.stringify(["idle", "running"]), JSON.stringify(rowsFor(a1.id)));
  check("B4 agent.status bus emit received via subscribeStatus",
    seen.some((e) => e.agentId === a1.id && e.status === "running"));

  const sinceRunning = s1.since;
  snap = await feed.getStatusSnapshot();
  s1 = snap.find((s) => s.agentId === a1.id);
  check("B5 same status → same `since`, NO new row (dedupe on change only)",
    s1?.since === sinceRunning && rowsFor(a1.id).length === 2);

  meta.status = "waiting";
  snap = await feed.getStatusSnapshot();
  s1 = snap.find((s) => s.agentId === a1.id);
  check("B6 parked run → waiting ('approval pending')",
    s1?.status === "waiting" && /approval/.test(s1?.detail ?? ""), JSON.stringify(s1));
  check("B7 waiting row appended", JSON.stringify(rowsFor(a1.id)) === JSON.stringify(["idle", "running", "waiting"]));

  g.__agentsRuns.delete(meta.id);
  await feed.notifyStatus(a1.id);
  check("B8 run gone → back to idle via notifyStatus (rows idle,running,waiting,idle)",
    JSON.stringify(rowsFor(a1.id)) === JSON.stringify(["idle", "running", "waiting", "idle"]), JSON.stringify(rowsFor(a1.id)));

  check("B9 listStatusEvents({agentId}) returns the rows (TEXT ISO ts)", (() => {
    const evs = feed.listStatusEvents({ agentId: a1.id });
    return evs.length === 4 && evs.every((e) => /^\d{4}-\d{2}-\d{2}T/.test(e.ts));
  })());
  unsub();
}

// ── §C SSE route: ?once=1 fallback + stream (snapshot → event → heartbeat) ───
console.log("\n── §C /api/v2/agents/status route ──");
{
  const { NextRequest } = await import("next/server.js");
  const route = await import("../../src/app/api/v2/agents/status/route.ts");

  const onceRes = await route.GET(new NextRequest("http://127.0.0.1:3737/api/v2/agents/status?once=1"));
  const onceJson = await onceRes.json();
  check("C1 ?once=1 → 200 JSON snapshot with all agents",
    onceRes.status === 200 && Array.isArray(onceJson.agents) && onceJson.agents.length === 4, JSON.stringify(onceJson).slice(0, 200));
  check("C2 ?once=1 sets no-store", /no-store/.test(onceRes.headers.get("cache-control") ?? ""));
  check("C3 snapshot entries carry {agentId,name,status,since}",
    onceJson.agents.every((a) => a.agentId && a.name && a.status && typeof a.since === "number"));

  const ctrl = new AbortController();
  const sseRes = await route.GET(new NextRequest("http://127.0.0.1:3737/api/v2/agents/status", { signal: ctrl.signal }));
  check("C4 SSE content-type text/event-stream", /text\/event-stream/.test(sseRes.headers.get("content-type") ?? ""));

  const reader = sseRes.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const readUntil = async (pred, ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !pred(buf)) {
      const race = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r("timeout"), Math.max(50, deadline - Date.now()))),
      ]);
      if (race === "timeout" || race.done) break;
      buf += dec.decode(race.value);
    }
    return pred(buf);
  };

  check("C5 snapshot event arrives first", await readUntil((b) => b.includes('"type":"snapshot"'), 5000), buf.slice(0, 200));

  // Trigger a live change → an `event` frame must arrive over the stream.
  const g = globalThis;
  const meta2 = { id: "run-live-2", agentId: a1.id, trigger: "manual", status: "running", startedAt: Date.now() };
  g.__agentsRuns.set(meta2.id, { meta: meta2, events: [], seq: 0, pending: new Map(), mcpHealth: [] });
  await feed.notifyStatus(a1.id);
  check("C6 change event streamed", await readUntil((b) => b.includes('"type":"event"') && b.includes('"running"'), 5000), buf.slice(-300));

  ctrl.abort();
  reader.cancel().catch(() => {});
  g.__agentsRuns.delete(meta2.id);
}

// ── §D static: StatusBand adoption + no re-derivation at the consumers ───────
console.log("\n── §D StatusBand + single-derivation greps ──");
{
  const band = read("src/components/v2/StatusBand.tsx");
  const palette = { running: "#34d399", idle: "#60a5fa", waiting: "#fbbf24", error: "#f87171", offline: "#9ca3af" };
  for (const [k, hex] of Object.entries(palette)) {
    check(`D palette ${k} ${hex}`, new RegExp(`${k}:\\s*"${hex}"`).test(band));
  }
  check("D StatusBand exports STATUS_BAND_COLORS", /export const STATUS_BAND_COLORS/.test(band));
  check("D StatusBandKind aliases agentsTypes.BandStatus (no type fork)",
    band.includes('import type { BandStatus } from "@/lib/agentsTypes"') && /export type StatusBandKind = BandStatus/.test(band));

  const types = read("src/lib/agentsTypes.ts");
  check("D agentsTypes exports the F1.1 types (AgentLifecycle/AgentDefV2Fields/AgentPersona/BandStatus)",
    /export type AgentLifecycle/.test(types) && /export interface AgentDefV2Fields/.test(types) &&
    /export interface AgentPersona/.test(types) && /export type BandStatus/.test(types));
  check("D agentsTypes stays client-safe (no node imports)", !/from "node:/.test(types));

  const strip = read("src/app/api/v2/tasks/agents-strip/route.ts");
  check("D agents-strip consumes getStatusSnapshot (single derivation)", strip.includes("getStatusSnapshot"));
  check("D agents-strip no longer re-derives the band locally",
    !strip.includes('band = "idle"') && !strip.includes('band = "running"') && !strip.includes("agentHasActiveRun"));

  const widgets = read("src/lib/v2/widgets/data.ts");
  check("D agent-status widget consumes getStatusSnapshot", widgets.includes("getStatusSnapshot"));
  check("D agent-status widget no longer re-derives ('never ran → offline' special case gone)",
    !widgets.includes('a.lastRunAt == null ? "offline"'));

  const runtime = read("src/lib/agentsRuntime.ts");
  check("D agentsRuntime calls notifyStatus at its transition sites (≥5 call sites)",
    (runtime.match(/notifyStatus\(/g) ?? []).length >= 5);
}

// ── cleanup + verdict ────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp db: ${tmpDb})`);
process.exit(failures === 0 ? 0 : 1); // ensureDb/route imports may hold timers
