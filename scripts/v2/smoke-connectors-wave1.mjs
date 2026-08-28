// SPEC-D G3.3/G3.4/G3.6/G3.7 smoke (chunk 3): notion / github / slack / buzz
// against MOCKED transports — the documented per-connector seams
// (__setNotionMockForTests / __setGithubMockForTests / __setSlackMockForTests /
// __setBuzzBridgeForTests). NO live network, NO real Nostr relay, no LLM.
// Legs:
//   notion — api-key setup probes /users/me; notion_search + notion_get_page
//     round trip (XML page rendering asserted); Notion-Version header on
//     EVERY captured request; API failure → soft `Error: <notion message>`.
//   github — setup probe /user → accountId=login; sync: notifications +
//     assigned-issues → activities + watermarks; second run replays
//     If-Modified-Since → 304 → EMPTY OK run (no error, cursors unchanged).
//   slack — auth.test probe → accountId=team_id; /api/hooks/slack: BAD
//     signature → 401, stale timestamp → 401, signed url_verification →
//     challenge echoed inline, signed app_mention → activity row with the
//     §3.3 mapping; generic x-hook-secret does NOT open the slack hook.
//   buzz — post/read round trip through the stub bridge; sync: inbound-only
//     activities (self excluded), per-channel since watermark, second run 0.
// Run: npx tsx scripts/v2/smoke-connectors-wave1.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createHmac } from "node:crypto";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-wave1-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-wave1-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — label embed fails fast
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    tasks: { timezone: "America/Chicago" },
    memory: { ingestEnabled: false },
    integrations: { callbackOrigin: "http://localhost:3000" },
  }),
);

const { ensureDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");
const syncDriver = await import("../../src/lib/v2/integrations/sync.ts");
const notionClient = await import("../../src/lib/v2/integrations/connectors/notion/client.ts");
const githubClient = await import("../../src/lib/v2/integrations/connectors/github/client.ts");
const slackClient = await import("../../src/lib/v2/integrations/connectors/slack/client.ts");
const buzzBridgeSeam = await import("../../src/lib/v2/integrations/connectors/buzz/bridge.ts");
const { NextRequest } = await import("next/server");
const hooksRoute = await import("../../src/app/api/hooks/[slug]/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

// ---------------------------------------------------------------------------
// §A NOTION — mocked transport, header + round-trip + soft-error legs
// ---------------------------------------------------------------------------
console.log("\n── §A notion ──");
{
  const captured = [];
  notionClient.__setNotionMockForTests(async (req) => {
    captured.push(req);
    const u = new URL(req.url);
    if (req.method === "GET" && u.pathname === "/v1/users/me") {
      return { status: 200, data: { id: "bot-123", name: "Yoshi Workspace", type: "bot", bot: { workspace_name: "Yoshi Workspace" } } };
    }
    if (req.method === "POST" && u.pathname === "/v1/search") {
      return {
        status: 200,
        data: {
          results: [
            {
              object: "page",
              id: "p1",
              url: "https://www.notion.so/p1",
              created_time: "2026-08-01T00:00:00Z",
              last_edited_time: "2026-08-02T00:00:00Z",
              properties: { title: { type: "title", title: [{ plain_text: "Deal Notes" }] } },
            },
          ],
          has_more: false,
          next_cursor: null,
        },
      };
    }
    if (req.method === "GET" && u.pathname === "/v1/pages/p1") {
      return {
        status: 200,
        data: {
          id: "p1",
          url: "https://www.notion.so/p1",
          icon: { type: "emoji", emoji: "📄" },
          properties: { Name: { type: "title", title: [{ plain_text: "Deal Notes" }] } },
        },
      };
    }
    if (req.method === "GET" && u.pathname === "/v1/blocks/p1/children") {
      return {
        status: 200,
        data: {
          results: [
            { id: "b1", type: "heading_1", has_children: false, heading_1: { rich_text: [{ plain_text: "Hello" }] } },
            { id: "b2", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "World" }] } },
            { id: "b3", type: "to_do", has_children: false, to_do: { checked: true, rich_text: [{ plain_text: "ship it" }] } },
          ],
          has_more: false,
        },
      };
    }
    if (u.pathname === "/v1/pages/missing") {
      return { status: 404, data: { object: "error", status: 404, code: "object_not_found", message: "Could not find page" } };
    }
    return { status: 404, data: { message: `unmocked ${req.method} ${u.pathname}` } };
  });

  // api-key setup probes /users/me → account (accountId = bot id).
  const account = await runtime.setupAccount("notion", { fields: { token: "ntn-test-secret" } });
  check("notion api-key setup: accountId = bot id, displayName = workspace", account.accountId === "bot-123" && account.displayName === "Yoshi Workspace");

  // notion_search round trip.
  const search = await runtime.callTool(account.id, "notion_search", { query: "deal" });
  check("notion_search returns the page", !search.isError && search.text.includes("Deal Notes") && search.text.includes("p1"), search);

  // notion_get_page round trip — XML rendering (blocks → <h1>/<todo> …).
  const page = await runtime.callTool(account.id, "notion_get_page", { page_id: "p1" });
  check("notion_get_page ok", !page.isError, page);
  let pageJson = null;
  try { pageJson = JSON.parse(page.text); } catch {}
  check("get_page result is the upstream JSON envelope {metadata,title,url,text}", pageJson?.metadata?.type === "page" && pageJson?.title === "Deal Notes" && pageJson?.url === "https://www.notion.so/p1");
  check(
    "get_page text renders the XML page shape",
    typeof pageJson?.text === "string" &&
      pageJson.text.includes('<page url="{{https://www.notion.so/p1}}"') &&
      pageJson.text.includes("<h1>Hello</h1>") &&
      pageJson.text.includes("World") &&
      pageJson.text.includes('<todo checked="true">[x] ship it</todo>'),
    pageJson?.text,
  );

  // Notion-Version header on EVERY request (the chunk brief's hard assert).
  check(
    `Notion-Version header on all ${captured.length} captured requests`,
    captured.length >= 4 && captured.every((r) => r.headers["notion-version"] === "2022-06-28"),
    captured.map((r) => r.headers["notion-version"]),
  );
  check("notion auth header carries the token", captured.every((r) => r.headers.authorization === "Bearer ntn-test-secret"));

  // Soft error path — upstream swallow shape `Error: <notion message>`.
  const err = await runtime.callTool(account.id, "notion_get_page", { page_id: "missing" });
  check("notion API failure → soft {isError} with the Notion message", err.isError === true && err.text === "Error: Could not find page", err);

  notionClient.__setNotionMockForTests(null);
}

// ---------------------------------------------------------------------------
// §B GITHUB — setup probe, notifications/issues sync, 304 empty path
// ---------------------------------------------------------------------------
console.log("\n── §B github ──");
{
  const NOW = Date.now();
  const T1 = new Date(NOW - 3600_000).toISOString();
  const T2 = new Date(NOW - 1800_000).toISOString();
  const LAST_MODIFIED = "Thu, 27 Aug 2026 12:00:00 GMT";
  const captured = [];
  let notifMode = "fresh"; // fresh → 304
  githubClient.__setGithubMockForTests(async (req) => {
    captured.push(req);
    const u = new URL(req.url);
    if (u.pathname === "/user") {
      return { status: 200, headers: {}, data: { login: "BigY0shi", id: 42 } };
    }
    if (u.pathname === "/notifications") {
      if (notifMode === "304") {
        return { status: 304, headers: {}, data: null };
      }
      return {
        status: 200,
        headers: { "last-modified": LAST_MODIFIED },
        data: [
          {
            id: "n1",
            reason: "mention",
            updated_at: T1,
            unread: true,
            subject: { title: "Fix the build", type: "Issue" },
            repository: { full_name: "BigY0shi/agent-os", html_url: "https://github.com/BigY0shi/agent-os" },
          },
          {
            id: "n2",
            reason: "review_requested",
            updated_at: T2,
            unread: true,
            subject: { title: "V2 phase 5", type: "PullRequest" },
            repository: { full_name: "BigY0shi/agent-os", html_url: "https://github.com/BigY0shi/agent-os" },
          },
        ],
      };
    }
    if (u.pathname === "/issues") {
      if (notifMode === "304") return { status: 200, headers: {}, data: [] };
      return {
        status: 200,
        headers: {},
        data: [
          {
            number: 7,
            title: "Wire the buzz connector",
            state: "open",
            updated_at: T2,
            html_url: "https://github.com/BigY0shi/agent-os/issues/7",
            repository: { full_name: "BigY0shi/agent-os" },
          },
          {
            number: 8,
            title: "A PR pretending to be an issue",
            state: "open",
            updated_at: T2,
            pull_request: { url: "x" }, // must be filtered out
            html_url: "https://github.com/BigY0shi/agent-os/pull/8",
            repository: { full_name: "BigY0shi/agent-os" },
          },
        ],
      };
    }
    return { status: 404, headers: {}, data: { message: `unmocked ${u.pathname}` } };
  });

  const account = await runtime.setupAccount("github", { fields: { token: "ghp-test-secret" } });
  check("github setup probes /user → accountId = login", account.accountId === "BigY0shi" && account.displayName === "GitHub (BigY0shi)");

  const run1 = await syncDriver.runAccountSync(account.id, "manual");
  check("github sync run 1: 2 notifications + 1 assigned issue (PR filtered)", run1.ok === true && run1.activitiesCount === 3, run1);
  const acts = store.listActivities(account.id);
  check("GITHUB_NOTIFICATION activities carry repo + reason payload", acts.filter((a) => a.eventType === "GITHUB_NOTIFICATION").length === 2 && acts.some((a) => a.payload?.reason === "mention" && a.payload?.repo === "BigY0shi/agent-os"));
  const issueAct = acts.find((a) => a.eventType === "GITHUB_ISSUE_ASSIGNED");
  check("GITHUB_ISSUE_ASSIGNED activity + sourceURL = issue html_url", issueAct?.payload?.number === 7 && issueAct?.sourceUrl === "https://github.com/BigY0shi/agent-os/issues/7");
  check("PR rows from /issues are NOT captured", !acts.some((a) => a.text.includes("pretending")));
  const state1 = store.getAccountState(account.id);
  check("watermarks: notifLastModified + notifCursor + issueCursor persisted", state1.notifLastModified === LAST_MODIFIED && state1.notifCursor === T2 && state1.issueCursor === T2, state1);

  // Second run → If-Modified-Since replayed → 304 → EMPTY OK run.
  notifMode = "304";
  captured.length = 0;
  const run2 = await syncDriver.runAccountSync(account.id, "manual");
  const notifReq = captured.find((r) => new URL(r.url).pathname === "/notifications");
  check("run 2 sends If-Modified-Since with the stored Last-Modified", notifReq?.headers["if-modified-since"] === LAST_MODIFIED, notifReq?.headers);
  check("304 path → ok EMPTY run, no error", run2.ok === true && run2.activitiesCount === 0 && !run2.error, run2);
  const lastRun = store.listSyncRuns(account.id)[0];
  check("304 run row recorded ok (not an error)", lastRun.ok === true && lastRun.activitiesCount === 0);
  const state2 = store.getAccountState(account.id);
  check("304 run leaves the watermarks unchanged", state2.notifCursor === T2 && state2.issueCursor === T2 && state2.notifLastModified === LAST_MODIFIED);
  check("issues poll replays the cursor as ?since=", captured.some((r) => { const u = new URL(r.url); return u.pathname === "/issues" && u.searchParams.get("since") === T2; }));

  githubClient.__setGithubMockForTests(null);
}

// ---------------------------------------------------------------------------
// §C SLACK — auth.test probe + signed webhook legs through the REAL route
// ---------------------------------------------------------------------------
console.log("\n── §C slack ──");
{
  const SIGNING_SECRET = "slack-signing-secret-xyz";
  slackClient.__setSlackMockForTests(async (method) => {
    if (method === "auth.test") {
      return { ok: true, team: "Launchworks", team_id: "T0LW", user_id: "UBOT", user: "agent_os" };
    }
    return { ok: false, error: `unmocked ${method}` };
  });

  const account = await runtime.setupAccount("slack", {
    fields: { token: "xoxb-test-secret", defaultChannel: "C42" },
  });
  check("slack setup probes auth.test → accountId = team_id", account.accountId === "T0LW" && account.displayName === "Slack (Launchworks)");

  // Signing secret lives in the definition's webhookSecret.
  store.patchDefinitionConfig("slack", { webhookSecret: SIGNING_SECRET });

  const sign = (body, ts = Math.floor(Date.now() / 1000)) => ({
    ts: String(ts),
    sig: `v0=${createHmac("sha256", SIGNING_SECRET).update(`v0:${ts}:${body}`).digest("hex")}`,
  });
  const hookPost = async (body, headers) =>
    hooksRoute.POST(
      new NextRequest("http://localhost/api/hooks/slack", {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...headers },
      }),
      { params: Promise.resolve({ slug: "slack" }) },
    );

  const mentionBody = JSON.stringify({
    type: "event_callback",
    team_id: "T0LW",
    event: { type: "app_mention", channel: "C42", user: "U777", text: "<@UBOT> ship chunk 3", ts: "1724770000.000100" },
  });

  // BAD signature → 401.
  let res = await hookPost(mentionBody, { "x-slack-request-timestamp": sign(mentionBody).ts, "x-slack-signature": "v0=deadbeef" });
  check("BAD signature → 401", res.status === 401);
  // Stale timestamp (replay) → 401.
  const stale = sign(mentionBody, Math.floor(Date.now() / 1000) - 3600);
  res = await hookPost(mentionBody, { "x-slack-request-timestamp": stale.ts, "x-slack-signature": stale.sig });
  check("stale (1h old) timestamp → 401 even with a valid HMAC", res.status === 401);
  // The generic x-hook-secret header must NOT open the slack hook (HMAC replaces it).
  res = await hookPost(mentionBody, { "x-hook-secret": SIGNING_SECRET });
  check("x-hook-secret does NOT bypass the slack HMAC", res.status === 401);

  // Signed url_verification → challenge echoed INLINE.
  const challengeBody = JSON.stringify({ type: "url_verification", challenge: "chal-123", token: "ignored" });
  const cSig = sign(challengeBody);
  res = await hookPost(challengeBody, { "x-slack-request-timestamp": cSig.ts, "x-slack-signature": cSig.sig });
  const challengeJson = await res.json();
  check("signed url_verification → challenge echoed", res.status === 200 && challengeJson.challenge === "chal-123", challengeJson);
  await new Promise((r) => setTimeout(r, 300));
  check("url_verification did NOT create an activity", store.listActivities(account.id).length === 0);

  // Signed app_mention → activity row (fire-and-forget → poll).
  const mSig = sign(mentionBody);
  res = await hookPost(mentionBody, { "x-slack-request-timestamp": mSig.ts, "x-slack-signature": mSig.sig });
  check("signed event → 200 immediately", res.status === 200 && (await res.json()).ok === true);
  let mentionAct = null;
  for (let i = 0; i < 40 && !mentionAct; i++) {
    await new Promise((r) => setTimeout(r, 100));
    mentionAct = store.listActivities(account.id).find((a) => a.eventType === "SLACK_MESSAGE_RECEIVED");
  }
  check("app_mention mapped → SLACK_MESSAGE_RECEIVED activity", !!mentionAct, store.listActivities(account.id));
  check(
    "mention mapping: text/channel/user/ts payload + client sourceURL",
    mentionAct?.text.includes("ship chunk 3") &&
      mentionAct?.payload?.kind === "app_mention" &&
      mentionAct?.payload?.channel === "C42" &&
      mentionAct?.payload?.user === "U777" &&
      mentionAct?.payload?.ts === "1724770000.000100" &&
      mentionAct?.sourceUrl === "https://app.slack.com/client/T0LW/C42",
    mentionAct,
  );
  const webhookRun = store.listSyncRuns(account.id).find((r) => r.trigger === "webhook");
  check("webhook sync_run row recorded", webhookRun?.ok === true && webhookRun.activitiesCount === 1);

  slackClient.__setSlackMockForTests(null);
}

// ---------------------------------------------------------------------------
// §D BUZZ — stubbed bridge: post/read round trip + watermarked sync
// ---------------------------------------------------------------------------
console.log("\n── §D buzz ──");
{
  const SELF = "selfpub00000000";
  const T1 = Math.floor(Date.now() / 1000) - 600;
  const T2 = T1 + 60;
  const messages = [
    { id: "m1", pubkey: "agentpub0000001", content: "idea: storm-permit mailers", created_at: T1 },
    { id: "m2", pubkey: SELF, content: "bridge's own post (must be excluded)", created_at: T1 + 10 },
    { id: "m3", pubkey: "agentpub0000001", content: "second idea: AI CSR outreach", created_at: T2 },
  ];
  const sent = [];
  buzzBridgeSeam.__setBuzzBridgeForTests({
    buzzAvailable: () => true,
    bridgePubkey: () => SELF,
    listChannels: async () => [{ channel_id: "ch-1", name: "marketing-ideas" }],
    resolveChannel: async (nameOrId) => {
      if (!nameOrId || nameOrId === "marketing-ideas" || nameOrId === "ch-1") return "ch-1";
      throw new Error(`Buzz channel "${nameOrId}" not found`);
    },
    sendMessage: async (channel, content) => {
      const msg = { id: `sent-${sent.length + 1}`, pubkey: SELF, content, created_at: Math.floor(Date.now() / 1000) };
      sent.push({ channel, content });
      messages.push(msg);
      return { eventId: msg.id };
    },
    getMessages: async (_channel, opts = {}) =>
      messages.filter((m) => (opts.since ? m.created_at >= opts.since : true)).slice(0, opts.limit ?? 50),
    displayNames: async () => new Map([["agentpub0000001", "Marketing Agent"]]),
  });

  const account = await runtime.setupAccount("buzz", { fields: {} });
  check("buzz local setup: accountId = bridge pubkey, NO secret in config", account.accountId === SELF);
  {
    const raw = (await import("../../src/lib/v2/db.ts")).getDb()
      .prepare("SELECT config_enc FROM integration_accounts WHERE id = ?").get(account.id);
    check("buzz sealed config exists but holds no key material (empty object)", typeof raw.config_enc === "string" && raw.config_enc.length > 0);
  }

  // Tool round trip: post → read it back through the stub.
  const post = await runtime.callTool(account.id, "buzz_post_message", { content: "hello from chunk 3" });
  check("buzz_post_message posts via the bridge", !post.isError && sent.length === 1 && sent[0].channel === "ch-1" && sent[0].content === "hello from chunk 3", post);
  const read = await runtime.callTool(account.id, "buzz_read_channel", { channel: "marketing-ideas" });
  check("buzz_read_channel reads it back (names resolved)", !read.isError && read.text.includes("hello from chunk 3") && read.text.includes("Marketing Agent"), read);
  const channels = await runtime.callTool(account.id, "buzz_list_channels", {});
  check("buzz_list_channels lists the stub channel", channels.text.includes("marketing-ideas") && channels.text.includes("ch-1"));

  // Sync: inbound only (self excluded), watermark = last event ts per channel.
  const run1 = await syncDriver.runAccountSync(account.id, "manual");
  const buzzActs = store.listActivities(account.id).filter((a) => a.eventType === "BUZZ_MESSAGE_RECEIVED");
  check("buzz sync captures inbound messages only (self excluded)", run1.ok === true && buzzActs.length === 2 && !buzzActs.some((a) => a.text.includes("must be excluded")) && !buzzActs.some((a) => a.text.includes("hello from chunk 3")), { run1, buzzActs: buzzActs.map((a) => a.text) });
  check("buzz activity carries channel + sender payload", buzzActs.some((a) => a.payload?.channelName === "marketing-ideas" && a.payload?.from === "Marketing Agent"));
  const state1 = store.getAccountState(account.id);
  const maxTs = Math.max(...messages.map((m) => m.created_at));
  check("watermark since:ch-1 = last event timestamp", state1["since:ch-1"] === String(maxTs), state1);

  const run2 = await syncDriver.runAccountSync(account.id, "manual");
  check("second buzz sync → 0 new (watermark respected)", run2.ok === true && run2.activitiesCount === 0, run2);

  buzzBridgeSeam.__setBuzzBridgeForTests(null);
}

// ---------------------------------------------------------------------------
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
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
