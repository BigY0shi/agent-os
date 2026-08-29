// SPEC-D G3.1/G3.2/G3.5 smoke: gmail + gcal connectors against a MOCKED Google
// transport — the documented test seam is googleClient.__setGoogleMockForTests
// (fake gmail/calendar client objects; buildOAuth2Client stays REAL so the
// token-refresh persistence leg runs on a real OAuth2Client 'tokens' event).
// Covers: gmail sync fixture → exact activity text + sourceURL + eventType
// payload + +20s watermark + second-run 0 new; error path → sync_run error +
// sync.failed; taint label integration:gmail from the DRIVER (not duplicated);
// token-refresh persistence writes tokens back ENCRYPTED; gmail tool dispatch
// (tz-aware date rewriting observed at the mock); gcal sync (GCAL_EVENT_CREATED
// + GCAL_EVENT_SOON, updated-cursor watermark, second-run 0 new); gcal
// list/create tool round trip. Offline — no network, no LLM.
// Run: npx tsx scripts/v2/smoke-gmail-gcal.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-ggc-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ggc-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — label embed fails fast
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    tasks: { timezone: "America/Chicago" },
    memory: { ingestEnabled: false },
  }),
);

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");
const sync = await import("../../src/lib/v2/integrations/sync.ts");
const googleClient = await import("../../src/lib/v2/integrations/connectors/googleClient.ts");
const { on } = await import("../../src/lib/v2/events.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

const syncFailed = [];
on("sync.failed", (e) => syncFailed.push(e));

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// ---------------------------------------------------------------------------
// Fixtures — 2 inbox messages (one plain, one HTML) + 1 sent, all inside the
// 24h default window.
// ---------------------------------------------------------------------------
const NOW = Date.now();
const T1 = NOW - 3600_000;
const T2 = NOW - 1800_000;
const T3 = NOW - 600_000; // sent, newest → drives the watermark
const M1_BODY = "Quarterly invoice attached. Please review the numbers before Friday.";
const M1_DATE = "Wed, 27 Aug 2026 10:00:00 -0500";

const gmailFixtures = {
  m1: {
    id: "m1",
    threadId: "t-1",
    internalDate: String(T1),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Alice Smith <alice@example.com>" },
        { name: "Subject", value: "Invoice #42" },
        { name: "Date", value: M1_DATE },
        { name: "To", value: "yoshi@example.com" },
      ],
      body: { data: b64(M1_BODY) },
    },
  },
  m2: {
    id: "m2",
    threadId: "t-2",
    internalDate: String(T2),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Bob <bob@example.com>" },
        { name: "Subject", value: "Weekly update" },
        { name: "Date", value: "Wed, 27 Aug 2026 10:30:00 -0500" },
      ],
      parts: [
        {
          mimeType: "text/html",
          body: { data: b64("<p>Hello <b>world</b> here is the weekly status update for the team</p>") },
        },
      ],
    },
  },
  s1: {
    id: "s1",
    threadId: "t-3",
    internalDate: String(T3),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "To", value: "client@example.com" },
        { name: "Subject", value: "Re: proposal" },
        { name: "Date", value: "Wed, 27 Aug 2026 10:50:00 -0500" },
      ],
      body: { data: b64("Sounds good, sending the revised proposal over tomorrow morning.") },
    },
  },
};

const gmailState = { failNext: false, listCalls: [], searchGets: [] };
const mockGmail = {
  users: {
    getProfile: async () => ({ data: { emailAddress: "yoshi@example.com" } }),
    messages: {
      list: async (params) => {
        if (gmailState.failNext) throw new Error("gmail API down (fixture)");
        gmailState.listCalls.push(params);
        if (params.q.includes("in:inbox")) {
          return { data: { messages: (gmailState.inboxIds ?? ["m1", "m2"]).map((id) => ({ id })) } };
        }
        if (params.q.includes("in:sent")) {
          return { data: { messages: [{ id: "s1" }] } };
        }
        return { data: { messages: [], resultSizeEstimate: 0 } };
      },
      get: async ({ id, format }) => {
        if (format === "metadata") gmailState.searchGets.push(id);
        const msg = gmailFixtures[id];
        if (!msg) throw new Error(`fixture has no message ${id}`);
        return { data: msg };
      },
    },
  },
};

// gcal fixtures — main window (today+7d) + soon window (≤15 min)
const EV_UPDATED = new Date(NOW - 120_000).toISOString();
const gcalState = { listCalls: [], inserted: [] };
const gcalMainItems = [
  {
    id: "ev-1",
    status: "confirmed",
    summary: "Design review",
    created: EV_UPDATED,
    updated: EV_UPDATED, // created === updated → "created"
    start: { dateTime: new Date(NOW + 86400_000).toISOString() },
    end: { dateTime: new Date(NOW + 90000_000).toISOString() },
    location: "Zoom",
    htmlLink: "https://calendar.google.com/event?eid=ev-1",
  },
  {
    id: "ev-2",
    status: "confirmed",
    summary: "Sprint planning",
    created: new Date(NOW - 86400_000).toISOString(),
    updated: EV_UPDATED, // created < updated → "updated"
    start: { dateTime: new Date(NOW + 172800_000).toISOString() },
    end: { dateTime: new Date(NOW + 176400_000).toISOString() },
    htmlLink: "https://calendar.google.com/event?eid=ev-2",
  },
  {
    id: "ev-cancelled",
    status: "cancelled",
    summary: "Ghost meeting",
    updated: EV_UPDATED,
  },
];
const gcalSoonItems = [
  {
    id: "ev-soon",
    status: "confirmed",
    summary: "Standup",
    start: { dateTime: new Date(NOW + 600_000).toISOString() }, // in 10 min
    end: { dateTime: new Date(NOW + 1500_000).toISOString() },
    htmlLink: "https://calendar.google.com/event?eid=ev-soon",
  },
  {
    id: "ev-allday",
    status: "confirmed",
    summary: "Company holiday",
    start: { date: "2026-08-27" }, // all-day → skipped for SOON
  },
];
const mockCalendar = {
  events: {
    list: async (params) => {
      gcalState.listCalls.push(params);
      const windowMs = new Date(params.timeMax).getTime() - new Date(params.timeMin).getTime();
      if (windowMs <= 16 * 60 * 1000) return { data: { items: gcalSoonItems } };
      return { data: { items: gcalMainItems } };
    },
    insert: async (params) => {
      gcalState.inserted.push(params);
      return {
        data: {
          id: "new-ev-1",
          summary: params.requestBody.summary,
          start: params.requestBody.start,
          end: params.requestBody.end,
          htmlLink: "https://calendar.google.com/event?eid=new-ev-1",
        },
      };
    },
  },
};

googleClient.__setGoogleMockForTests({
  gmail: () => mockGmail,
  calendar: () => mockCalendar,
  userinfo: async () => ({ email: "yoshi@example.com", id: "uid-1" }),
});

// ---------------------------------------------------------------------------
// A. Seed definitions + accounts (bypassing the browser OAuth leg — that is
//    Yoshi's manual checkpoint; setup() itself is exercised below via the
//    mocked userinfo).
// ---------------------------------------------------------------------------
store.patchDefinitionConfig("gmail", { clientId: "cid-1", clientSecret: "csec-1" });
store.patchDefinitionConfig("gcal", { clientId: "cid-1", clientSecret: "csec-1" });

const gmailAccount = await runtime.setupAccount("gmail", {
  oauthResponse: {
    access_token: "AT-GMAIL-1",
    refresh_token: "RT-GMAIL-1",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "gmail",
  },
  oauthParams: { redirect_uri: "http://localhost:3000/api/v2/integrations/oauth/callback" },
});
check("gmail setup → accountId from mocked userinfo email", gmailAccount.accountId === "yoshi@example.com");
check("gmail displayName carries identity, not tokens", gmailAccount.displayName === "Gmail (yoshi@example.com)");
const gmailCfg = store.getAccountConfig(gmailAccount.id);
check("gmail config stores tokens + computed expiry_date", gmailCfg.access_token === "AT-GMAIL-1" && gmailCfg.refresh_token === "RT-GMAIL-1" && Number(gmailCfg.expiry_date) > Date.now());

const gcalAccount = await runtime.setupAccount("gcal", {
  oauthResponse: { access_token: "AT-GCAL-1", refresh_token: "RT-GCAL-1", expires_in: 3600 },
});
check("gcal setup → same external identity, separate account row", gcalAccount.accountId === "yoshi@example.com" && gcalAccount.id !== gmailAccount.id);

// ---------------------------------------------------------------------------
// B. Gmail sync — exact text format, sourceURL, event payload, watermark
// ---------------------------------------------------------------------------
const run1 = await sync.runAccountSync(gmailAccount.id, "manual");
check("gmail sync ok with 3 activities (2 inbox + 1 sent)", run1.ok === true && run1.activitiesCount === 3, run1);

const activities = store.listActivities(gmailAccount.id).reverse(); // oldest-insert first
const a1 = activities.find((a) => a.text.includes("message_id: m1"));
const expectedM1 = `Received email from Alice Smith (from: Alice Smith <alice@example.com>, subject: "Invoice #42", message_id: m1, thread_id: t-1) at ${M1_DATE}. Snippet: "${M1_BODY}"`;
check("EXACT activity text format (received, plain text)", a1?.text === expectedM1, a1?.text);
check("received sourceURL is the #inbox deep link", a1?.sourceUrl === "https://mail.google.com/mail/u/0/#inbox/m1");
check("received eventType GMAIL_MESSAGE_RECEIVED", a1?.eventType === "GMAIL_MESSAGE_RECEIVED");
check(
  "event payload {from, subject, messageId, threadId}",
  a1?.payload?.from === "Alice Smith <alice@example.com>" &&
    a1?.payload?.subject === "Invoice #42" &&
    a1?.payload?.messageId === "m1" &&
    a1?.payload?.threadId === "t-1",
  a1?.payload,
);

const a2 = activities.find((a) => a.text.includes("message_id: m2"));
check("HTML body went through Turndown to markdown", a2?.text.includes("Hello **world**"), a2?.text);

const aSent = activities.find((a) => a.text.startsWith("Sent email"));
check(
  "sent activity text format + emailAddress from profile",
  aSent?.text.startsWith(`Sent email to client@example.com (from: yoshi@example.com, subject: "Re: proposal", message_id: s1, thread_id: t-3)`),
  aSent?.text,
);
check("sent sourceURL is the #sent deep link", aSent?.sourceUrl === "https://mail.google.com/mail/u/0/#sent/s1");
check("sent activity emits NO trigger event", aSent?.eventType === null);

// Watermark (HARDENING-2026-08-27 item 7): EXACT newest internalDate (sent
// s1) — the old +20s skew dropped mail landing inside the 20s window.
const gmailStateRow = store.getAccountState(gmailAccount.id);
check("watermark = EXACT newest internalDate (no +20s skew)", gmailStateRow.lastSyncTime === new Date(T3).toISOString(), gmailStateRow);
check("lastUserEventTime mirrors lastSyncTime", gmailStateRow.lastUserEventTime === gmailStateRow.lastSyncTime);
check("emailAddress persisted in state", gmailStateRow.emailAddress === "yoshi@example.com");
check("first inbox query used the 24h default window", /^in:inbox is:important after:\d+$/.test(gmailState.listCalls[0]?.q ?? ""), gmailState.listCalls[0]);
check("inbox + sent queries capped at 50", gmailState.listCalls.slice(0, 2).every((c) => c.maxResults === 50));

// Second run: m1/m2 fall before the watermark; s1 sits ON it and is
// re-processed, but its dedupe_key (item 7) makes the insert a no-op.
const run2 = await sync.runAccountSync(gmailAccount.id, "manual");
check("second gmail sync → 0 new (watermark + dedupe respected)", run2.ok === true && run2.activitiesCount === 0, run2);
check("no duplicate activity rows", store.listActivities(gmailAccount.id).length === 3);
check("watermark unchanged on no-progress run", store.getAccountState(gmailAccount.id).lastSyncTime === gmailStateRow.lastSyncTime);
check(
  "activities carry gmail dedupe keys",
  store.listActivities(gmailAccount.id).every((a) => /^gmail-(received|sent):/.test(a.dedupeKey ?? "")),
  store.listActivities(gmailAccount.id).map((a) => a.dedupeKey),
);

// Item-7 tail-loss leg: a message landing INSIDE what used to be the +20s
// window (internalDate = newest + 5s) was previously filtered as
// before-watermark on the next run — LOST mail. Now it must be captured.
gmailFixtures.m3 = {
  id: "m3",
  threadId: "t-4",
  internalDate: String(T3 + 5000),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Carol <carol@example.com>" },
      { name: "Subject", value: "Landed in the skew window" },
      { name: "Date", value: "Wed, 27 Aug 2026 10:55:00 -0500" },
    ],
    body: { data: b64("This message arrived 5 seconds after the previous newest one.") },
  },
};
gmailState.inboxIds = ["m1", "m2", "m3"];
const runTail = await sync.runAccountSync(gmailAccount.id, "manual");
check("tail-window message captured (was LOST under +20s skew)", runTail.ok === true && runTail.activitiesCount === 1, runTail);
check("no duplicates from the boundary re-list", store.listActivities(gmailAccount.id).length === 4);
check(
  "watermark advanced to the tail message",
  store.getAccountState(gmailAccount.id).lastSyncTime === new Date(T3 + 5000).toISOString(),
  store.getAccountState(gmailAccount.id),
);

// Taint label comes from the DRIVER (ingest seam) — verify, don't duplicate.
const gmailLabel = getDb().prepare("SELECT id FROM labels WHERE name = 'integration:gmail'").get();
check("label 'integration:gmail' created by the ingest seam", !!gmailLabel);
const qRows = getDb().prepare("SELECT * FROM ingestion_queue WHERE source = 'integration:gmail'").all();
check("4 queue rows, source integration:gmail, pending offline", qRows.length === 4 && qRows.every((r) => r.status === "PENDING")); // 3 + the item-7 tail-window message
check(
  "queue metadata carries mail sourceURL + untrusted marker",
  qRows.every((r) => {
    const d = JSON.parse(r.data);
    return d.metadata?.untrusted === true && String(d.metadata?.sourceURL ?? "").startsWith("https://mail.google.com/");
  }),
);

// Error path: transport throws → soft outcome + sync_run error + sync.failed.
gmailState.failNext = true;
const run3 = await sync.runAccountSync(gmailAccount.id, "manual");
gmailState.failNext = false;
check("gmail API error → soft {ok:false, 0 activities}", run3.ok === false && run3.activitiesCount === 0 && run3.error.includes("gmail API down"), run3);
const errRun = store.latestSyncRun(gmailAccount.id);
check("sync_run row records the error", errRun.ok === false && errRun.error.includes("gmail API down"));
check("sync.failed emitted for the gmail account", syncFailed.some((e) => e.payload.accountId === gmailAccount.id && e.payload.slug === "gmail"));
check("failed run added no activities", store.listActivities(gmailAccount.id).length === 4);

// ---------------------------------------------------------------------------
// C. Gmail tool dispatch — tz-aware date rewriting observed at the mock
// ---------------------------------------------------------------------------
const searchResult = await runtime.callTool(
  gmailAccount.id,
  "gmail_search_emails",
  { query: "from:bob@example.com after:2026/01/15" },
  { source: "smoke" },
);
check("gmail_search_emails dispatched (empty fixture result)", searchResult.isError !== true && searchResult.text.includes("Next Page Token: (none"));
const searchCall = gmailState.listCalls.find((c) => c.q?.startsWith("from:bob@example.com"));
check("after:YYYY/MM/DD rewritten to a unix timestamp (tz-aware)", !!searchCall && /after:\d{9,}/.test(searchCall.q) && !searchCall.q.includes("2026/01/15"), searchCall?.q);
const callLog = store.listCallLogs(gmailAccount.id).find((l) => l.toolName === "gmail_search_emails");
check("tool call logged with redacted args intact", callLog?.ok === true && callLog.args.query?.includes("from:bob@example.com"));

let loud = null;
try {
  await runtime.callTool(gmailAccount.id, "gmail_no_such_tool", {}, { source: "smoke" });
} catch (err) {
  loud = err;
}
check("unknown gmail tool → LOUD ConnectorConfigError", loud?.name === "ConnectorConfigError");

// ---------------------------------------------------------------------------
// D. Token-refresh persistence — real OAuth2Client 'tokens' event → store
// ---------------------------------------------------------------------------
const refreshCtx = {
  config: store.getAccountConfig(gmailAccount.id),
  defConfig: { clientId: "cid-1", clientSecret: "csec-1" },
  timezone: "America/Chicago",
  accountId: gmailAccount.id,
};
const oauthClient = googleClient.buildOAuth2Client(refreshCtx);
oauthClient.emit("tokens", { access_token: "AT-REFRESHED-XYZ", expiry_date: 1893456000000 });
const refreshed = store.getAccountConfig(gmailAccount.id);
check("refreshed access_token persisted", refreshed.access_token === "AT-REFRESHED-XYZ");
check("refreshed expiry_date persisted", refreshed.expiry_date === "1893456000000");
check("refresh_token NOT clobbered by a refresh without one", refreshed.refresh_token === "RT-GMAIL-1");
const rawBlob = getDb().prepare("SELECT config_enc FROM integration_accounts WHERE id = ?").get(gmailAccount.id).config_enc;
check("persisted tokens are ENCRYPTED at rest (sealed v1 blob, no plaintext)", rawBlob.startsWith("v1:") && !rawBlob.includes("AT-REFRESHED-XYZ"));

// No accountId → no persistence listener (hand-built ctx stays inert).
const inertClient = googleClient.buildOAuth2Client({ ...refreshCtx, accountId: undefined });
inertClient.emit("tokens", { access_token: "AT-SHOULD-NOT-LAND" });
check("no accountId in ctx → refresh not persisted", store.getAccountConfig(gmailAccount.id).access_token === "AT-REFRESHED-XYZ");

// ---------------------------------------------------------------------------
// E. gcal sync — GCAL_EVENT_CREATED + GCAL_EVENT_SOON + updated-cursor
// ---------------------------------------------------------------------------
const gcalRun1 = await sync.runAccountSync(gcalAccount.id, "manual");
check("gcal sync ok with 3 activities (2 created/updated + 1 soon)", gcalRun1.ok === true && gcalRun1.activitiesCount === 3, gcalRun1);

const gcalActivities = store.listActivities(gcalAccount.id);
const evCreated = gcalActivities.find((a) => a.payload?.eventId === "ev-1");
check("new event → GCAL_EVENT_CREATED with 'created' wording", evCreated?.eventType === "GCAL_EVENT_CREATED" && evCreated.text.startsWith('Calendar event created: "Design review"'), evCreated?.text);
check("event payload {eventId, summary, start, end}", evCreated?.payload?.summary === "Design review" && !!evCreated?.payload?.start && !!evCreated?.payload?.end);
check("event sourceURL = htmlLink", evCreated?.sourceUrl === "https://calendar.google.com/event?eid=ev-1");
const evUpdated = gcalActivities.find((a) => a.payload?.eventId === "ev-2");
check("changed event → 'updated' wording", evUpdated?.text.startsWith('Calendar event updated: "Sprint planning"'), evUpdated?.text);
const evSoon = gcalActivities.find((a) => a.eventType === "GCAL_EVENT_SOON");
check("GCAL_EVENT_SOON emitted for the ≤15-min event only", evSoon?.payload?.eventId === "ev-soon" && gcalActivities.filter((a) => a.eventType === "GCAL_EVENT_SOON").length === 1);
check("cancelled + all-day events skipped", !gcalActivities.some((a) => a.text.includes("Ghost meeting") || a.text.includes("Company holiday")));

const gcalStateRow = store.getAccountState(gcalAccount.id);
check("updated-cursor watermark persisted", gcalStateRow.updatedCursor === EV_UPDATED, gcalStateRow);
check("soonNotified tracks the announced event", (gcalStateRow.soonNotified ?? "").split(",").includes("ev-soon"));

const gcalRun2 = await sync.runAccountSync(gcalAccount.id, "manual");
check("second gcal sync → 0 new (cursor + soonNotified respected)", gcalRun2.ok === true && gcalRun2.activitiesCount === 0, gcalRun2);
check("no duplicate gcal activity rows", store.listActivities(gcalAccount.id).length === 3);
const gcalLabel = getDb().prepare("SELECT id FROM labels WHERE name = 'integration:gcal'").get();
check("label 'integration:gcal' created by the ingest seam", !!gcalLabel);
check("second run used updatedMin from the cursor", gcalState.listCalls.some((c) => c.updatedMin === EV_UPDATED));

// ---------------------------------------------------------------------------
// F. gcal tool dispatch round trip against the mock
// ---------------------------------------------------------------------------
const listResult = await runtime.callTool(
  gcalAccount.id,
  "gcal_list_events",
  { timeMin: new Date(NOW).toISOString(), timeMax: new Date(NOW + 7 * 86400_000).toISOString() },
  { source: "smoke" },
);
check("gcal_list_events returns the fixture events", listResult.isError !== true && listResult.text.includes("Design review") && listResult.text.includes("ID: ev-1"), listResult.text);

const createResult = await runtime.callTool(
  gcalAccount.id,
  "gcal_create_event",
  {
    summary: "Smoke-created event",
    startDateTime: "2026-08-28T10:00:00",
    endDateTime: "2026-08-28T11:00:00",
    timeZone: "America/Chicago",
  },
  { source: "smoke" },
);
check("gcal_create_event round trip (mock insert hit)", createResult.isError !== true && createResult.text.includes("Event created successfully!") && createResult.text.includes("new-ev-1"), createResult.text);
const inserted = gcalState.inserted[0];
check("insert requestBody carries summary + times + default Meet", inserted?.requestBody?.summary === "Smoke-created event" && inserted.requestBody.start.dateTime === "2026-08-28T10:00:00" && !!inserted.requestBody.conferenceData && inserted.conferenceDataVersion === 1, inserted);
const gcalCallLogs = store.listCallLogs(gcalAccount.id);
check("gcal tool calls logged", ["gcal_list_events", "gcal_create_event"].every((n) => gcalCallLogs.some((l) => l.toolName === n && l.ok === true)));

// ---------------------------------------------------------------------------
googleClient.__setGoogleMockForTests(null);
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
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
