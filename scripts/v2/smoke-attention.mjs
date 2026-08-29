// SPEC-D H4.1 smoke: attention store + collectors + attention.flag bridge +
// §5.8 route contract. FULLY OFFLINE — temp DB/settings/key, no LLM, no
// network; the agents-dir collector runs through the injectable test seam
// (the real ~/.agentic-os/agents is never read). Covers:
//   upsert-by-dedupe (no dupes, refresh, reopen-on-done, reopen-after-auto-
//     resolve, dismissed NEVER resurrects);
//   markDone/dismiss persist; autoResolve stamps auto_resolved_at;
//   attention.flag bus bridge captures an emitted flag (and the approvals
//     emitter lands rows for free);
//   sync-failure collector creates + autoResolves on next success;
//   approvals collector round trip (pending → item, deny → autoResolved);
//   agents collector (seam): pending approval + error run → items, cleared →
//     autoResolved; per-collector health;
//   route GET (?status default open, severity-sorted, muteKinds hidden,
//     collectors array) + PATCH done/dismiss contract (400/404).
// Run: npx tsx scripts/v2/smoke-attention.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any src imports — never the live DB/settings/key.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-attn-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-attn-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — embeds fail fast
fs.writeFileSync(
  settingsFile,
  JSON.stringify({ tasks: { timezone: "America/Chicago" }, memory: { ingestEnabled: false } }),
);

const { ensureDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const attnStore = await import("../../src/lib/v2/attention/store.ts");
const attn = await import("../../src/lib/v2/attention/index.ts");
const collectors = await import("../../src/lib/v2/attention/collectors.ts");
const events = await import("../../src/lib/v2/events.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const intStore = await import("../../src/lib/v2/integrations/store.ts");
const { runAccountSync } = await import("../../src/lib/v2/integrations/sync.ts");
const approvals = await import("../../src/lib/v2/webmcp/approvals.ts");
const { readSettings, writeSettings } = await import("../../src/lib/settings.ts");
const route = await import("../../src/app/api/v2/attention/route.ts");
const { NextRequest } = await import("next/server");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();
attn.ensureAttention(); // bridge + tick (tick is unref'd; we drive collectors manually)

// ---------------------------------------------------------------------------
// A. upsertByDedupeKey — refresh / reopen / dismissed-stays-dismissed
// ---------------------------------------------------------------------------
const first = attnStore.upsertByDedupeKey({
  dedupeKey: "k1",
  kind: "test",
  severity: "info",
  title: "first title",
  route: "/somewhere",
  payload: { n: 1 },
});
check("insert creates an open item", first.status === "open" && first.severity === "info");

const refreshed = attnStore.upsertByDedupeKey({
  dedupeKey: "k1",
  kind: "test",
  severity: "urgent",
  title: "refreshed title",
  payload: { n: 2 },
});
check("re-flag refreshes in place (same id, new title/severity/payload, no dupe)",
  refreshed.id === first.id && refreshed.title === "refreshed title" && refreshed.severity === "urgent" && refreshed.payload.n === 2 &&
  attnStore.listItems({ kind: "test" }).length === 1);

attnStore.markDone(first.id);
check("markDone persists (auto_resolved_at stays null — a human did it)",
  attnStore.getItem(first.id).status === "done" && attnStore.getItem(first.id).autoResolvedAt === null);
const reopened = attnStore.upsertByDedupeKey({ dedupeKey: "k1", kind: "test", title: "back again" });
check("re-flag on a user-done item REOPENS it (new occurrence)", reopened.id === first.id && reopened.status === "open");

// autoResolve → reopen path
attnStore.upsertByDedupeKey({ dedupeKey: "k2", kind: "test", title: "auto item" });
check("autoResolve marks the open row done + stamps auto_resolved_at",
  attnStore.autoResolve("k2") === true &&
  attnStore.getByDedupeKey("k2").status === "done" &&
  typeof attnStore.getByDedupeKey("k2").autoResolvedAt === "string");
check("autoResolve on an already-resolved key is a no-op", attnStore.autoResolve("k2") === false);
const back = attnStore.upsertByDedupeKey({ dedupeKey: "k2", kind: "test", title: "auto item back" });
check("re-flag after auto-resolve REOPENS (auto_resolved_at cleared)", back.status === "open" && back.autoResolvedAt === null);

// dismissed never resurrects
const d = attnStore.upsertByDedupeKey({ dedupeKey: "k3", kind: "test", title: "noisy" });
attnStore.dismissItem(d.id);
const still = attnStore.upsertByDedupeKey({ dedupeKey: "k3", kind: "test", title: "noisy refreshed" });
check("dismissed row is NEVER resurrected by a re-flag (payload still refreshes)",
  still.status === "dismissed" && still.title === "noisy refreshed");

// ---------------------------------------------------------------------------
// B. attention.flag bus bridge (CONVENTIONS §5 payload)
// ---------------------------------------------------------------------------
events.emit("attention.flag", {
  kind: "bridge_test",
  severity: "warn",
  title: "Bridged flag",
  route: "/tasks",
  dedupeKey: "bridge:1",
}, "smoke");
const bridged = attnStore.getByDedupeKey("bridge:1");
check("attention.flag emit lands as an item via the generic bridge",
  bridged?.status === "open" && bridged.kind === "bridge_test" && bridged.severity === "warn" && bridged.route === "/tasks" && bridged.source === "smoke");

const countBeforeMalformed = attnStore.listItems({ limit: 500 }).length;
events.emit("attention.flag", { severity: "warn", title: "no key" }, "smoke");
check("malformed flag (no dedupeKey/kind) is ignored, not thrown",
  attnStore.listItems({ limit: 500 }).length === countBeforeMalformed);

// ---------------------------------------------------------------------------
// C. sync-failure collector — create + autoResolve on next success
// ---------------------------------------------------------------------------
const failAcct = await runtime.setupAccount("_test", { fields: { token: "sync-fail" } });
const failedSync = await runAccountSync(failAcct.id, "manual");
check("fixture sync fails (setup for the collector)", failedSync.ok === false && /exploded/.test(failedSync.error ?? ""));

await collectors.runCollectorsOnce();
const syncItem = attnStore.getByDedupeKey(`sync-fail:${failAcct.id}`);
check("sync-failure collector creates the sync_failed item",
  syncItem?.status === "open" && syncItem.kind === "sync_failed" && /exploded/.test(syncItem.body ?? "") && syncItem.route === "/integrations");

intStore.setAccountConfig(failAcct.id, { token: "ok-now" });
const okSync = await runAccountSync(failAcct.id, "manual");
check("fixture sync recovers", okSync.ok === true && okSync.activitiesCount === 3);
await collectors.runCollectorsOnce();
const resolvedSync = attnStore.getByDedupeKey(`sync-fail:${failAcct.id}`);
check("next success autoResolves the sync_failed item",
  resolvedSync.status === "done" && typeof resolvedSync.autoResolvedAt === "string");

// ---------------------------------------------------------------------------
// D. approvals collector round trip (emitter bridge + collector autoResolve)
// ---------------------------------------------------------------------------
const approval = approvals.createApproval({
  slug: "registry",
  tool: "execute_integration_action",
  args: { accountId: failAcct.id, action: "_test_echo", parameters: {} },
  requestedBy: "smoke",
});
const apprItem = attnStore.getByDedupeKey(approval.id);
check("createApproval's attention.flag lands via the bridge (dedupeKey = approval id)",
  apprItem?.status === "open" && apprItem.kind === "webmcp.approval");
await collectors.runCollectorsOnce();
check("pending-approvals collector keeps the pending item open (one row, not two)",
  attnStore.getByDedupeKey(approval.id).status === "open" &&
  attnStore.listItems({ kind: "webmcp.approval" }).length === 1);

await approvals.resolveApproval(approval.id, "deny");
await collectors.runCollectorsOnce();
check("resolving the approval autoResolves its attention item",
  attnStore.getByDedupeKey(approval.id).status === "done" &&
  typeof attnStore.getByDedupeKey(approval.id).autoResolvedAt === "string");

// ---------------------------------------------------------------------------
// E. agents collector — through the injectable seam (real dirs never read)
// ---------------------------------------------------------------------------
let agentApprovals = [
  { id: "ap-1", runId: "run-1", agentId: "agent-1", agentName: "Test Agent", toolName: "Bash", inputPreview: "rm -rf /", reason: "constitution" },
];
const nowMs = Date.now();
collectors.__setAgentsSourceForTests({
  readApprovals: async () => agentApprovals,
  listAgents: async () => [{ id: "agent-1", name: "Test Agent", updatedAt: nowMs }],
  listRuns: async () => [
    { id: "run-err", agentId: "agent-1", trigger: "manual", status: "error", startedAt: nowMs - 1000, endedAt: nowMs - 500, error: "boom" },
    { id: "run-old", agentId: "agent-1", trigger: "manual", status: "error", startedAt: nowMs - 48 * 3600e3, endedAt: nowMs - 48 * 3600e3, error: "ancient" },
    { id: "run-ok", agentId: "agent-1", trigger: "manual", status: "done", startedAt: nowMs - 900, endedAt: nowMs - 100 },
  ],
});
await collectors.runCollectorsOnce();
check("agents collector: pending agent approval → item",
  attnStore.getByDedupeKey("agent-approval:ap-1")?.status === "open" &&
  attnStore.getByDedupeKey("agent-approval:ap-1").kind === "agent_approval");
check("agents collector: fresh error run → item, 24h-aged error run skipped",
  attnStore.getByDedupeKey("agent-run-fail:agent-1:run-err")?.status === "open" &&
  attnStore.getByDedupeKey("agent-run-fail:agent-1:run-old") === null);

agentApprovals = [];
await collectors.runCollectorsOnce();
check("cleared agent approval queue → item autoResolved",
  attnStore.getByDedupeKey("agent-approval:ap-1").status === "done");

const healthNow = collectors.getCollectorHealth();
check("per-collector health recorded (all three ok)",
  healthNow.length === 3 && healthNow.every((h) => h.ok === true && typeof h.lastRunAt === "string"), healthNow);

collectors.__setAgentsSourceForTests({
  readApprovals: async () => { throw new Error("agents dir unreadable (deliberate)"); },
  listAgents: async () => [],
  listRuns: async () => [],
});
await collectors.runCollectorsOnce();
check("broken collector reports unavailable (honest metrics), others stay ok",
  collectors.getCollectorHealth().find((h) => h.name === "agents")?.ok === false &&
  /unreadable/.test(collectors.getCollectorHealth().find((h) => h.name === "agents")?.unavailableReason ?? "") &&
  collectors.getCollectorHealth().find((h) => h.name === "sync-failures")?.ok === true);
collectors.__setAgentsSourceForTests({ readApprovals: async () => [], listAgents: async () => [], listRuns: async () => [] });

// ---------------------------------------------------------------------------
// F. §5.8 route contract — GET (sorted, muteKinds) + PATCH done/dismiss
// ---------------------------------------------------------------------------
attnStore.upsertByDedupeKey({ dedupeKey: "sev-info", kind: "sevtest", severity: "info", title: "info item" });
attnStore.upsertByDedupeKey({ dedupeKey: "sev-urgent", kind: "sevtest", severity: "urgent", title: "urgent item" });

const getRes = await route.GET(new NextRequest("http://localhost/api/v2/attention"));
const getJson = await getRes.json();
check("GET defaults to open items + carries collector health",
  getRes.status === 200 && Array.isArray(getJson.items) && Array.isArray(getJson.collectors) &&
  getJson.items.every((i) => i.status === "open") && getJson.collectors.length === 3);
{
  const sevRows = getJson.items.filter((i) => i.kind === "sevtest");
  check("GET items are severity-sorted (urgent before info)",
    sevRows.length === 2 && sevRows[0].severity === "urgent" && sevRows[1].severity === "info", sevRows.map((i) => i.severity));
  check("GET responses never carry raw config/secret fields",
    !JSON.stringify(getJson).includes("config_enc") && !JSON.stringify(getJson).includes("ok-now"));
}

writeSettings({ attention: { ...(readSettings().attention ?? {}), muteKinds: ["sevtest"] } });
const mutedJson = await (await route.GET(new NextRequest("http://localhost/api/v2/attention"))).json();
check("settings.attention.muteKinds hides the kind from the API",
  mutedJson.items.every((i) => i.kind !== "sevtest"));
writeSettings({ attention: { ...(readSettings().attention ?? {}), muteKinds: [] } });

const patchReq = (body) =>
  new NextRequest("http://localhost/api/v2/attention", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const target = attnStore.getByDedupeKey("sev-info");
const doneRes = await route.PATCH(patchReq({ id: target.id, action: "done" }));
check("PATCH done persists", doneRes.status === 200 && attnStore.getItem(target.id).status === "done");
const target2 = attnStore.getByDedupeKey("sev-urgent");
const disRes = await route.PATCH(patchReq({ id: target2.id, action: "dismiss" }));
check("PATCH dismiss persists", disRes.status === 200 && attnStore.getItem(target2.id).status === "dismissed");
check("PATCH invalid action → 400", (await route.PATCH(patchReq({ id: target.id, action: "nope" }))).status === 400);
check("PATCH unknown id → 404", (await route.PATCH(patchReq({ id: "no-such-id", action: "done" }))).status === 404);
check("GET ?status=all includes resolved rows",
  (await (await route.GET(new NextRequest("http://localhost/api/v2/attention?status=all"))).json()).items.some((i) => i.status === "dismissed"));

// ---------------------------------------------------------------------------
attn.stopAttentionForTests();
try {
  const queue = await import("../../src/lib/v2/memory/queue.ts");
  queue.stopMemoryQueue?.();
} catch {}
try {
  const sched = globalThis.__agentosV2Scheduler;
  if (sched?.timer) clearInterval(sched.timer);
} catch {}
await new Promise((r) => setTimeout(r, 250));
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}
try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? "\nsmoke-attention: ALL PASS" : `\nsmoke-attention: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
