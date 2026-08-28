// HARDENING-2026-08-27 cross-cutting smoke — one leg set per backlog item not
// already covered by an existing smoke:
//   5  webmcp http-lane secret redaction (error + output, persisted log)
//   6  approval snapshot pinning (republish between request and approve → 409)
//   7  activity dedupe unit legs (INSERT OR IGNORE semantics, emit suppression)
//   8  durable ingest retry (attempt counter, cap 5, hourly sweep recovers)
//   9  memory queue leases (atomic claim, stale-PROCESSING recovery, retry cap)
//   10 recurrence BYDAY/COUNT/UNTIL without BYHOUR (+ regression legs)
//   11 webhook inbox (persist-before-200 helpers, header stripping, boot sweep)
//   12 automations durable cursor (replay missed events, no double-fire)
//   13 proxy session tokens (mint/verify/expire/tamper, legacy grace, proxy e2e)
// Items 1/2/3 live in smoke-jarvis-brain; item 4 in smoke-int-oauth; item 7's
// e2e tail-loss leg in smoke-gmail-gcal. Fully OFFLINE.
// Run: npx tsx scripts/v2/smoke-hardening.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import { createHmac } from "node:crypto";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-hardening-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-hardening-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
const webmcpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-hardening-sec-"));
process.env.AGENTIC_OS_WEBMCP_DIR = webmcpDir;
const sessionSecretFile = path.join(settingsDir, "session-secret.json");
process.env.AGENTIC_OS_SESSION_SECRET_FILE = sessionSecretFile;
process.env.AGENTOS_MOCK_LLM = "1";
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — label embeds fail fast
process.env.AGENTOS_PASSWORD = "smoke-password-123";
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    tasks: { timezone: "America/Chicago" },
    memory: { ingestEnabled: false },
  }),
);

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const { emit } = await import("../../src/lib/v2/events.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");
const sync = await import("../../src/lib/v2/integrations/sync.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const schedule = await import("../../src/lib/v2/integrations/schedule.ts");
const webhooks = await import("../../src/lib/v2/integrations/webhooks.ts");
const wstore = await import("../../src/lib/v2/webmcp/store.ts");
const secrets = await import("../../src/lib/v2/webmcp/secrets.ts");
const execute = await import("../../src/lib/v2/webmcp/execute.ts");
const approvals = await import("../../src/lib/v2/webmcp/approvals.ts");
const queue = await import("../../src/lib/v2/memory/queue.ts");
const recurrence = await import("../../src/lib/v2/tasks/recurrence.ts");
const engine = await import("../../src/lib/v2/automations/engine.ts");
const redact = await import("../../src/lib/v2/redact.ts");
const auth = await import("../../src/lib/authSessions.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ensureDb();
const db = getDb();

// ===========================================================================
// 5. WebMCP http-lane secret redaction
// ===========================================================================
console.log("--- item 5: http-lane secret redaction ---");
{
  const SECRET = "sk-super-secret-value-42";
  let mode = "error";
  const echo = http.createServer((req, res) => {
    const authz = req.headers.authorization ?? "";
    if (mode === "error") {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`upstream exploded; your header was: ${authz}`);
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`debug echo: ${authz}`);
    }
  });
  await new Promise((r) => echo.listen(0, "127.0.0.1", r));
  const port = echo.address().port;

  wstore.createPackage({ slug: "redact-pkg", name: "Redact pkg" });
  secrets.setPackageSecret("redact-pkg", "API_KEY", SECRET);
  wstore.addTool("redact-pkg", {
    name: "echo_tool",
    description: "echoes the auth header",
    inputSchema: { type: "object", properties: {} },
    handlerKind: "http",
    handlerConfig: {
      url: `http://127.0.0.1:${port}/x`,
      method: "GET",
      headers: { authorization: "Bearer {{secret:API_KEY}}" },
    },
  });

  const errRes = await execute.executeDraftTool("redact-pkg", "echo_tool", {});
  check("http 500 echoing the secret → error REDACTED", errRes.ok === false && errRes.error.includes("[redacted]") && !errRes.error.includes(SECRET), errRes.error);
  const logRow = db.prepare("SELECT * FROM webmcp_call_logs WHERE package_slug = 'redact-pkg' ORDER BY created_at DESC LIMIT 1").get();
  check("persisted call-log error carries NO secret", !!logRow && !String(logRow.error ?? "").includes(SECRET) && String(logRow.error ?? "").includes("[redacted]"), logRow?.error);

  mode = "ok";
  const okRes = await execute.executeDraftTool("redact-pkg", "echo_tool", {});
  check("http 200 body echoing the secret → output REDACTED", okRes.ok === true && okRes.output.includes("[redacted]") && !okRes.output.includes(SECRET), okRes.output);

  check("redactText unit: multiple occurrences masked", redact.redactText(`a ${SECRET} b ${SECRET}`, [SECRET]) === "a [redacted] b [redacted]");
  check("redactText unit: short secrets skipped (no text shredding)", redact.redactText("abc", ["b"]) === "abc");
  echo.close();
}

// ===========================================================================
// 6. Approval snapshot pinning
// ===========================================================================
console.log("--- item 6: approval snapshot pinning ---");
{
  wstore.createPackage({ slug: "pin-pkg", name: "Pin pkg" });
  wstore.addTool("pin-pkg", {
    name: "gated_tool",
    description: "requires approval",
    inputSchema: { type: "object", properties: {} },
    handlerKind: "js",
    handlerConfig: { code: "return 'v1 ran';" },
    requiresApproval: true,
  });
  wstore.publishPackage("pin-pkg");

  const res1 = await execute.executeTool("pin-pkg", "gated_tool", {}, { source: "smoke", interactive: true });
  check("interactive gated call → pending approval", !!res1.approval?.id, res1);
  const a1 = approvals.getApproval(res1.approval.id);
  check("approval pinned to the published version (v1)", a1?.pinnedVersion === 1, a1?.pinnedVersion);

  // Republish (v2) BETWEEN request and approve — behavior changed under the user.
  wstore.updateTool("pin-pkg", "gated_tool", { handlerConfig: { code: "return 'v2 DIFFERENT BEHAVIOR';" } });
  wstore.publishPackage("pin-pkg");

  let pinErr = null;
  try {
    await approvals.resolveApproval(res1.approval.id, "approve");
  } catch (err) {
    pinErr = err;
  }
  check("approve after republish → 409 naming the republish", pinErr?.status === 409 && /republished/i.test(pinErr?.message ?? ""), pinErr?.message);
  check("refused approval stays pending (expires naturally)", approvals.getApproval(res1.approval.id)?.status === "pending");

  // Fresh approval against v2 → approve executes v2.
  const res2 = await execute.executeTool("pin-pkg", "gated_tool", {}, { source: "smoke", interactive: true });
  const { result } = await approvals.resolveApproval(res2.approval.id, "approve");
  check("fresh approval on the current version executes", result?.ok === true && result.output.includes("v2 DIFFERENT"), result);
  check("registry-lane approvals stay version-less (pinnedVersion null)", approvals.createApproval({ slug: "registry", tool: "tasks_create", args: {}, requestedBy: "smoke" }).pinnedVersion === null);
}

// ===========================================================================
// 7. Activity dedupe (unit) — e2e tail-loss leg lives in smoke-gmail-gcal
// ===========================================================================
console.log("--- item 7: activity dedupe ---");
const account = await runtime.setupAccount("_test", { fields: { token: "tok-hardening" } });
{
  const r1 = store.insertActivity({ accountId: account.id, text: "hello once", dedupeKey: "k1" });
  const r2 = store.insertActivity({ accountId: account.id, text: "hello once again", dedupeKey: "k1" });
  check("same (account, dedupeKey) → second insert returns null", r1 !== null && r2 === null);
  const r3 = store.insertActivity({ accountId: account.id, text: "no key a" });
  const r4 = store.insertActivity({ accountId: account.id, text: "no key b" });
  check("NULL dedupe keys never collide", r3 !== null && r4 !== null);

  // applySyncResult replay: same batch twice → one emit, one row, one ingest.
  const { on } = await import("../../src/lib/v2/events.ts");
  const emitted = [];
  const off = on("activity.created", (e) => emitted.push(e));
  const batch = { activities: [{ text: "deduped batch item xyz", dedupeKey: "batch-1", eventType: "TEST_EVENT" }] };
  const c1 = await sync.applySyncResult(account, batch);
  const c2 = await sync.applySyncResult(account, batch);
  off();
  check("replayed batch → accepted 1 then 0", c1.accepted === 1 && c2.accepted === 0, { c1, c2 });
  check("replayed batch → exactly ONE activity.created emit", emitted.length === 1, emitted.length);
  const rows = db.prepare("SELECT COUNT(*) AS c FROM activities WHERE dedupe_key = 'batch-1'").get();
  check("exactly one row for the deduped key", rows.c === 1);
}

// ===========================================================================
// 8. Durable ingest retry
// ===========================================================================
console.log("--- item 8: durable ingest retry ---");
{
  const { ingestActivity, INGEST_MAX_ATTEMPTS } = await import("../../src/lib/v2/integrations/ingest.ts");
  // Short text (<20 chars) fails the ingest schema → 'failed' + attempts++.
  const bad = store.insertActivity({ accountId: account.id, text: "too short", dedupeKey: "short-1" });
  await ingestActivity(bad, account);
  let row = store.getActivity(bad.id);
  check("failed enqueue → status 'failed', attempts 1", row.ingestStatus === "failed" && row.ingestAttempts === 1, row);

  // Sweep re-attempts until the cap, then leaves the row alone.
  for (let i = 0; i < INGEST_MAX_ATTEMPTS + 2; i++) await schedule.retryFailedIngests();
  row = store.getActivity(bad.id);
  check(`attempts capped at ${INGEST_MAX_ATTEMPTS}`, row.ingestStatus === "failed" && row.ingestAttempts === INGEST_MAX_ATTEMPTS, row.ingestAttempts);
  check("capped row no longer listed as retryable", !store.listRetryableIngestFailures(INGEST_MAX_ATTEMPTS).some((a) => a.id === bad.id));

  // Recoverable failure: long text marked failed → sweep flips it to 'ingested'.
  const good = store.insertActivity({ accountId: account.id, text: "this activity text is long enough to ingest fine", dedupeKey: "long-1" });
  store.markActivityIngestFailed(good.id);
  await schedule.retryFailedIngests();
  check("retry sweep recovers a transient failure → 'ingested'", store.getActivity(good.id).ingestStatus === "ingested", store.getActivity(good.id));
  schedule.ensureIntegrationSync();
  check("ensureIntegrationSync schedules 'integration:ingest-retry' (FREQ=HOURLY)", db.prepare("SELECT rrule FROM jobs WHERE id = 'integration:ingest-retry'").get()?.rrule === "FREQ=HOURLY");
}

// ===========================================================================
// 9. Memory queue leases
// ===========================================================================
console.log("--- item 9: memory queue leases ---");
{
  // Earlier sections enqueued their own rows (item 8's recovered ingest) —
  // settle them so the oldest PENDING row is OURS.
  db.prepare("UPDATE ingestion_queue SET status = 'COMPLETED' WHERE status = 'PENDING'").run();
  // ingestEnabled=false keeps the drain away — we drive claims by hand.
  const { queueId } = await queue.ingestFromModule({
    episodeBody: "a lease-test episode body long enough to pass validation",
    source: "smoke",
  });
  const claimed = queue.claimNextPending();
  check("atomic claim returns the pending row + flips it", claimed?.id === queueId, claimed?.id);
  const st = db.prepare("SELECT status, processing_started_at FROM ingestion_queue WHERE id = ?").get(queueId);
  check("claimed row PROCESSING with a lease stamp", st.status === "PROCESSING" && !!st.processing_started_at, st);
  check("second claim finds nothing (no double-claim)", queue.claimNextPending() === undefined);

  // Fresh lease → recovery leaves it alone.
  check("fresh PROCESSING not recovered", queue.recoverStaleProcessing() === 0);
  // Expire the lease → back to PENDING with retry_count+1.
  db.prepare("UPDATE ingestion_queue SET processing_started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), queueId);
  check("stale PROCESSING recovered", queue.recoverStaleProcessing() === 1);
  const rec = db.prepare("SELECT status, retry_count FROM ingestion_queue WHERE id = ?").get(queueId);
  check("recovered row PENDING, retry_count bumped", rec.status === "PENDING" && rec.retry_count === 1, rec);

  // At the retry cap a stale row FAILS loudly instead of ping-ponging.
  db.prepare("UPDATE ingestion_queue SET status = 'PROCESSING', retry_count = 3, processing_started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), queueId);
  queue.recoverStaleProcessing();
  const capped = db.prepare("SELECT status, error FROM ingestion_queue WHERE id = ?").get(queueId);
  check("stale row at retry cap → FAILED with a loud error", capped.status === "FAILED" && /crash/.test(capped.error ?? ""), capped);
  // NULL lease (pre-migration row shape) counts as stale.
  db.prepare("UPDATE ingestion_queue SET status = 'PROCESSING', retry_count = 0, processing_started_at = NULL WHERE id = ?").run(queueId);
  queue.recoverStaleProcessing();
  check("NULL-lease PROCESSING treated as stale", db.prepare("SELECT status FROM ingestion_queue WHERE id = ?").get(queueId).status === "PENDING");
}

// ===========================================================================
// 10. Recurrence — BYDAY/COUNT/UNTIL without BYHOUR
// ===========================================================================
console.log("--- item 10: recurrence gaps ---");
{
  const tz = "America/Chicago";
  const wallDay = (d) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const after = new Date("2026-08-26T18:00:00.000Z"); // Wed Aug 26 2026, 1pm Chicago

  // BYDAY without BYHOUR: previously fired as a bare 7-day interval from `after`.
  const mon = recurrence.computeNextRun("FREQ=WEEKLY;BYDAY=MO", tz, after, after);
  check("BYDAY=MO without BYHOUR lands on a Monday", mon !== null && wallDay(mon) === "Mon", mon?.toISOString());
  check("BYDAY=MO is the NEXT Monday, not after+7d", mon !== null && mon.getTime() - after.getTime() < 6 * 86400_000, mon?.toISOString());

  // COUNT: anchored at a persisted DTSTART, exhausts.
  const anchor = new Date("2026-08-20T15:00:00.000Z");
  const c1 = recurrence.computeNextRun("FREQ=DAILY;COUNT=3", tz, new Date(anchor.getTime() + 36 * 3600_000), anchor);
  check("COUNT=3: 3rd occurrence still returned", c1 !== null, c1?.toISOString());
  const c2 = recurrence.computeNextRun("FREQ=DAILY;COUNT=3", tz, new Date(anchor.getTime() + 10 * 86400_000), anchor);
  check("COUNT=3: exhausted after 3 occurrences → null (deactivates)", c2 === null, c2?.toISOString());
  check("COUNT without any anchor → null + loud (never silent misfire)", recurrence.computeNextRun("FREQ=DAILY;COUNT=3", tz, after, null) === null);

  // UNTIL
  check("UNTIL in the past → null", recurrence.computeNextRun("FREQ=DAILY;UNTIL=20200101T000000Z", tz, after, after) === null);
  const u = recurrence.computeNextRun("FREQ=DAILY;UNTIL=20301231T000000Z", tz, after, after);
  check("UNTIL in the future → next occurrence returned", u !== null && u.getTime() > after.getTime());

  // Regressions: plain relative intervals + the BYHOUR path are untouched.
  const rel = recurrence.computeNextRun("FREQ=DAILY", tz, after);
  check("plain FREQ=DAILY still = after + 1 calendar day", rel !== null && Math.abs(rel.getTime() - (after.getTime() + 86400_000)) < 2 * 3600_000, rel?.toISOString());
  const by = recurrence.computeNextRun("FREQ=DAILY;BYHOUR=8;BYMINUTE=0", tz, after);
  const byWallHour = by === null ? -1 : parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(by), 10) % 24;
  check("BYHOUR path unchanged (next 8am wall clock)", by !== null && byWallHour === 8, by?.toISOString());
}

// ===========================================================================
// 11. Webhook inbox
// ===========================================================================
console.log("--- item 11: webhook inbox ---");
{
  const id = store.insertWebhookInbox(
    "slack",
    { "x-hook-secret": "sssh", authorization: "Bearer tok", "x-slack-signature": "v0=sig", "content-type": "application/json" },
    JSON.stringify({ type: "event_callback" }),
  );
  const row = db.prepare("SELECT * FROM webhook_inbox WHERE id = ?").get(id);
  const headers = JSON.parse(row.headers_json);
  check("inbox row persisted 'pending' BEFORE dispatch settles", row.status === "pending");
  check("secret headers STRIPPED from the persisted row", !headers["x-hook-secret"] && !headers.authorization && !headers["x-slack-signature"] && headers["content-type"] === "application/json", headers);

  check("fresh pending row NOT in the stale sweep window", store.listStaleWebhookInbox(60_000).length === 0);
  db.prepare("UPDATE webhook_inbox SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 2 * 60_000).toISOString(), id);
  check("backdated pending row IS in the sweep window", store.listStaleWebhookInbox(60_000).some((r) => r.id === id));

  const swept = await webhooks.sweepWebhookInbox();
  check("boot sweep re-processes and settles the row", swept === 1 && db.prepare("SELECT status FROM webhook_inbox WHERE id = ?").get(id).status === "done");
  check("done rows never re-swept", (await webhooks.sweepWebhookInbox()) === 0);

  store.markWebhookInbox(id, "error", "boom");
  const errRow = db.prepare("SELECT status, error FROM webhook_inbox WHERE id = ?").get(id);
  check("markWebhookInbox records error state", errRow.status === "error" && errRow.error === "boom");
}

// ===========================================================================
// 12. Automations durable cursor
// ===========================================================================
console.log("--- item 12: automations durable cursor ---");
{
  engine.stopAutomationsForTests();
  // First boot: cursor initializes to MAX(events.id) — history never replays.
  engine.ensureAutomations();
  await engine.automationsIdle();
  const cursor0 = Number(db.prepare("SELECT value FROM meta WHERE key = 'automations_event_cursor'").get()?.value);
  const maxId0 = db.prepare("SELECT COALESCE(MAX(id),0) AS m FROM events").get().m;
  check("first boot initializes cursor to MAX(events.id), no replay", cursor0 >= maxId0 - 1, { cursor0, maxId0 });

  const rule = engine.createRule({
    name: "hardening replay rule",
    triggerEvent: "hardening.test",
    actions: [{ kind: "notify", messageTemplate: "fired for {{payload.n}}" }],
  });

  // Live event fires normally and advances the cursor.
  emit("hardening.test", { n: 1 }, "smoke");
  await engine.automationsIdle();
  let runs = engine.listRuns({ ruleId: rule.id });
  check("live event fires the rule with its event id", runs.length === 1 && typeof runs[0].eventId === "number", runs);
  const cursor1 = Number(db.prepare("SELECT value FROM meta WHERE key = 'automations_event_cursor'").get()?.value);
  check("cursor advanced past the live event", cursor1 >= runs[0].eventId);

  // Engine DOWN: the event persists but nothing dispatches (the old loss).
  engine.stopAutomationsForTests();
  const missed = emit("hardening.test", { n: 2 }, "smoke");
  check("event persisted while engine down", typeof missed.id === "number");
  check("no dispatch while down", engine.listRuns({ ruleId: rule.id }).length === 1);

  // Boot replay picks it up exactly once.
  engine.ensureAutomations();
  await engine.automationsIdle();
  runs = engine.listRuns({ ruleId: rule.id });
  check("boot replay fires the missed event", runs.length === 2 && runs.some((r) => r.eventId === missed.id), runs.map((r) => r.eventId));

  // Re-boot: UNIQUE(rule_id,event_id) + cursor → no double-fire.
  engine.stopAutomationsForTests();
  db.prepare("UPDATE meta SET value = ? WHERE key = 'automations_event_cursor'").run(String(missed.id - 1)); // force a re-replay window
  engine.ensureAutomations();
  await engine.automationsIdle();
  check("forced re-replay does NOT double-fire (run guard)", engine.listRuns({ ruleId: rule.id }).length === 2, engine.listRuns({ ruleId: rule.id }).length);
  engine.stopAutomationsForTests();
}

// ===========================================================================
// 13. Proxy session tokens
// ===========================================================================
console.log("--- item 13: proxy session tokens ---");
{
  const file = auth.ensureSessionSecret();
  check("session secret file created (32-byte hex + grace deadline)", !!file && /^[0-9a-f]{64}$/.test(file.secret) && Date.parse(file.legacyAcceptUntil) > Date.now());
  check("secret persisted to the override path", fs.existsSync(sessionSecretFile));

  const token = auth.mintSessionToken(file.secret);
  check("minted token has the v2.<id>.<exp>.<sig> shape", /^v2\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+$/.test(token), token);
  check("token contains nothing derived from the password", !token.includes(auth.legacyToken(process.env.AGENTOS_PASSWORD)));
  const v = auth.verifySessionToken(token, file.secret);
  check("fresh token verifies, no refresh needed yet", v.valid === true && v.shouldRefresh === false);

  const [, id, exp] = token.split(".");
  const forge = (i, e, secret) => `v2.${i}.${e}.${createHmac("sha256", secret).update(`${i}.${e}`).digest("base64url")}`;
  check("tampered signature rejected", auth.verifySessionToken(`v2.${id}.${exp}.AAAA`, file.secret).valid === false);
  check("token signed with the WRONG secret rejected", auth.verifySessionToken(forge(id, exp, "not-the-secret"), file.secret).valid === false);
  const past = Math.floor(Date.now() / 1000) - 10;
  check("expired token rejected", auth.verifySessionToken(forge(id, String(past), file.secret), file.secret).valid === false);
  const soon = Math.floor(Date.now() / 1000) + 24 * 3600; // 1 day left of 30
  check("near-expiry token flags shouldRefresh (sliding)", auth.verifySessionToken(forge(id, String(soon), file.secret), file.secret).shouldRefresh === true);

  // Legacy grace lane.
  const legacy = auth.legacyToken(process.env.AGENTOS_PASSWORD);
  check("legacy hash cookie accepted INSIDE the grace window", auth.legacyCookieAccepted(legacy, process.env.AGENTOS_PASSWORD, file) === true);
  const expiredFile = { ...file, legacyAcceptUntil: new Date(Date.now() - 1000).toISOString() };
  check("legacy hash cookie REJECTED after the grace window", auth.legacyCookieAccepted(legacy, process.env.AGENTOS_PASSWORD, expiredFile) === false);
  check("wrong legacy cookie rejected", auth.legacyCookieAccepted("nope", process.env.AGENTOS_PASSWORD, file) === false);

  // Proxy e2e (direct import — Node runtime, same as the real deployment).
  const { proxy } = await import("../../src/proxy.ts");
  const { NextRequest } = await import("next/server");
  const req = (cookie) => {
    const r = new NextRequest("http://localhost:3000/api/v2/tasks", { headers: cookie ? { cookie: `agentos_session=${cookie}` } : {} });
    return r;
  };
  check("proxy: valid signed token → pass-through", proxy(req(token)).status === 200);
  check("proxy: no cookie → 401 on API paths", proxy(req(null)).status === 401);
  check("proxy: tampered token → 401", proxy(req(`v2.${id}.${exp}.AAAA`)).status === 401);
  const legacyRes = proxy(req(legacy));
  check("proxy: legacy cookie (grace) → pass-through", legacyRes.status === 200);
  const upgraded = legacyRes.headers.get("set-cookie") ?? "";
  check("proxy: legacy cookie UPGRADED to a signed token", upgraded.includes("agentos_session=v2."), upgraded.slice(0, 80));
  // NOTE: the login ROUTE uses next/headers cookies() and cannot be
  // direct-imported outside a Next request scope — its minting path is the
  // same mintSessionToken/ensureSessionSecret pair unit-tested above, and the
  // proxy legs prove the full validate/refresh/upgrade loop.
}

// ===========================================================================
// finish
// ===========================================================================
queue.stopMemoryQueue();
engine.stopAutomationsForTests();
try { __closeForTests(); } catch {}
for (const suf of ["", "-wal", "-shm"]) { try { fs.rmSync(tmpDb + suf, { force: true }); } catch {} }
try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
try { fs.rmSync(webmcpDir, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? "\nsmoke-hardening: ALL PASS" : `\nsmoke-hardening: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
