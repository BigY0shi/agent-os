// SPEC-E E2.1–E2.3 smoke: HMAC tickets + CDP WS bridge + ticket/handoff/launch
// routes. Run: npx tsx scripts/v2/smoke-browser-ws.mjs
//
// HARD RULE (chunk-2 brief): NEVER bind 3738 here — Yoshi's live app may be
// running. The temp settings pin wsPort:0 (ephemeral) and §C asserts the
// bridge did NOT land on 3738.
//
// Legs:
//  §A ticket unit: mint/verify, tamper (payload + sig), wrong session, expiry,
//     +5s skew tolerance, fail-closed without AGENTOS_PASSWORD, salt persisted.
//  §B bridge pure helpers: close-code sanitize, text-frame normalization.
//  §C bridge E2E on the EPHEMERAL port: launch a real session, connect a node
//     ws client with a ticket, send Browser.getVersion id 1 IMMEDIATELY on
//     open (exercises buffer-until-upstream-open) → TEXT JSON response id 1;
//     bad ticket → 4400; valid ticket for a non-running session → 4404;
//     second concurrent client works; attach + Page.startScreencast → ≥1
//     screencastFrame within 5s (the §9 E2E assert), ack'd, close 1000.
//  §D routes (chunk-6 direct-import idiom): launch/handoff gated behind the
//     browser capability (the chunk-2 gating decision), ticket route wsUrl
//     built from the request Host + ACTUAL bridge port, 503 fail-closed
//     without a password, handoff headed→headless with cookie survival
//     (spec §9 step 7 in miniature) + browser_handoff audit rows.
//  §E cleanup: every session closed, bridge stopped (no orphan chromium, no
//     port squat).
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

// ── temp env BEFORE any src imports — live stores never touched ──────────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-ws-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ws-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const profilesRootTmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ws-profiles-"));
process.env.AGENTIC_OS_BROWSER_PROFILES = profilesRootTmp;
process.env.AGENTIC_OS_WS_SECRET = path.join(settingsDir, "ws-secret");
process.env.AGENTOS_PASSWORD = "smoke-ws-password";
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may call out
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    browser: {
      wsPort: 0, // EPHEMERAL — never 3738 in smokes
      wsBind: "local",
      browserType: "default",
      profiles: ["personal", "work", "misc"],
      sessions: [],
    },
    capability: { browserEnabled: true },
    memory: { ingestEnabled: false },
    tasks: { timezone: "America/Chicago" },
  }),
);

const tickets = await import("../../src/lib/v2/browser/tickets.ts");
const bridge = await import("../../src/lib/v2/browser/wsBridge.ts");
const manager = await import("../../src/lib/v2/browser/manager.ts");
const config = await import("../../src/lib/v2/browser/config.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");
const { readSettings, writeSettings } = await import("../../src/lib/settings.ts");
const { WebSocket } = await import("ws");
const { NextRequest } = await import("next/server");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};
const note = (msg) => console.log(`NOTE  ${msg}`);

// local fixture page (stable port for cookie-origin stability across relaunches)
const fixture = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head><title>WS Fixture</title></head><body><h1>ws fixture</h1></body></html>");
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;

// ───────────────────────── §A tickets ─────────────────────────
console.log("\n── §A HMAC tickets ──");
{
  const minted = tickets.mintTicket("sess_a");
  check("A1 mint returns ticket + expiresAt (~5min TTL)",
    "ticket" in minted && minted.expiresAt > Date.now() + 290_000 && minted.expiresAt <= Date.now() + 301_000);
  check("A2 verify OK for the bound session", tickets.verifyTicket(minted.ticket, "sess_a"));
  check("A3 wrong session refused", !tickets.verifyTicket(minted.ticket, "sess_b"));

  // tamper the payload (flip its first char) — signature no longer matches
  const dot = minted.ticket.indexOf(".");
  const flip = (c) => (c === "A" ? "B" : "A");
  const tamperedPayload = flip(minted.ticket[0]) + minted.ticket.slice(1);
  check("A4 tampered payload refused", !tickets.verifyTicket(tamperedPayload, "sess_a"));
  const tamperedSig = minted.ticket.slice(0, dot + 1) + flip(minted.ticket[dot + 1]) + minted.ticket.slice(dot + 2);
  check("A5 tampered signature refused", !tickets.verifyTicket(tamperedSig, "sess_a"));

  const expired = tickets.mintTicket("sess_a", -10_000);
  check("A6 expired ticket refused", "ticket" in expired && !tickets.verifyTicket(expired.ticket, "sess_a"));
  const withinSkew = tickets.mintTicket("sess_a", -3_000); // expired 3s ago — inside the +5s skew
  check("A7 +5s skew tolerated", "ticket" in withinSkew && tickets.verifyTicket(withinSkew.ticket, "sess_a"));

  const savedPw = process.env.AGENTOS_PASSWORD;
  delete process.env.AGENTOS_PASSWORD;
  const closedMint = tickets.mintTicket("sess_a");
  check("A8 fail-closed mint without AGENTOS_PASSWORD", "error" in closedMint && /AGENTOS_PASSWORD/.test(closedMint.error));
  check("A9 fail-closed verify without AGENTOS_PASSWORD", !tickets.verifyTicket(minted.ticket, "sess_a"));
  process.env.AGENTOS_PASSWORD = savedPw;
  check("A10 verify works again after restore", tickets.verifyTicket(minted.ticket, "sess_a"));

  const salt1 = tickets.readOrCreateBootSalt();
  const salt2 = tickets.readOrCreateBootSalt();
  check("A11 boot salt persisted once (64 hex chars, stable)", /^[0-9a-f]{64}$/.test(salt1) && salt1 === salt2);
  check("A12 salt file at the override path", fs.existsSync(process.env.AGENTIC_OS_WS_SECRET));
}

// ───────────────────────── §B bridge helpers ─────────────────────────
console.log("\n── §B bridge mechanics (pure) ──");
{
  check("B1 sanitize 1005/1006/1015 → 1000",
    bridge.sanitizeCloseCode(1005) === 1000 && bridge.sanitizeCloseCode(1006) === 1000 && bridge.sanitizeCloseCode(1015) === 1000);
  check("B2 sanitize keeps 1000 and 3000-4999",
    bridge.sanitizeCloseCode(1000) === 1000 && bridge.sanitizeCloseCode(3001) === 3001 && bridge.sanitizeCloseCode(4404) === 4404);
  check("B3 sanitize rejects 2999/1011 → 1000", bridge.sanitizeCloseCode(2999) === 1000 && bridge.sanitizeCloseCode(1011) === 1000);
  check("B4 frameToText normalizes Buffer to utf8 string",
    bridge.frameToText(Buffer.from('{"id":1}', "utf8")) === '{"id":1}' && bridge.frameToText('{"id":2}') === '{"id":2}');
}

// ───────────────────────── §C bridge E2E ─────────────────────────
console.log("\n── §C bridge E2E (ephemeral port) ──");

const wsOpen = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    ws.on("close", (code, reason) => resolve({ closedEarly: true, code, reason: reason?.toString() }));
  });

/** Connect and expect the server to close with a specific code. */
const expectClose = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("no close within 5s")), 5000);
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on("error", () => {
      /* close event still fires */
    });
  });

{
  check("C1 session config created", config.createSessionConfig("smoke_ws", "misc").success);
  const { session, error } = await manager.getOrLaunchSession("smoke_ws", false, { caller: "smoke" });
  check("C2 headless launch ok", Boolean(session) && !error, error ?? "");
  check("C3 CDP endpoint captured", manager.getSessionCdpInfo("smoke_ws") !== null);
  await session.page.goto(fixtureUrl);

  const state = await bridge.ensureBrowserWs();
  check("C4 bridge listening on an ephemeral port", state !== null && state.port > 0);
  check("C5 bridge did NOT bind 3738 (smoke hard rule)", state?.port !== 3738);
  const again = await bridge.ensureBrowserWs();
  check("C6 ensureBrowserWs idempotent (same server object)", again?.wss === state?.wss && again?.port === state?.port);
  const base = `ws://127.0.0.1:${state.port}`;

  // bad ticket → 4400
  const badCode = await expectClose(`${base}/cdp/smoke_ws?ticket=garbage`);
  check("C7 bad ticket closes 4400", badCode === 4400);
  // no ticket at all → 4400
  const noneCode = await expectClose(`${base}/cdp/smoke_ws`);
  check("C8 missing ticket closes 4400", noneCode === 4400);
  // valid ticket for a session that is not running → 4404
  const ghost = tickets.mintTicket("ghost_sess");
  const ghostCode = await expectClose(`${base}/cdp/ghost_sess?ticket=${encodeURIComponent(ghost.ticket)}`);
  check("C9 valid ticket, session not running → 4404", ghostCode === 4404);

  // good ticket: send Browser.getVersion id 1 IMMEDIATELY on open — the
  // upstream socket is still dialing, so this frame MUST be buffered and
  // flushed (mandatory mechanic 2).
  const mintA = tickets.mintTicket("smoke_ws");
  const urlA = `${base}/cdp/smoke_ws?ticket=${encodeURIComponent(mintA.ticket)}`;
  const versionLeg = await new Promise((resolve, reject) => {
    const ws = new WebSocket(urlA);
    const timer = setTimeout(() => reject(new Error("no getVersion response within 5s")), 5000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
    });
    ws.on("message", (data, isBinary) => {
      clearTimeout(timer);
      resolve({ ws, isBinary, text: bridge.frameToText(data) });
    });
    ws.on("error", reject);
    ws.on("close", (code) => reject(new Error(`closed early: ${code}`)));
  }).catch((e) => ({ error: String(e) }));
  check("C10 immediate Browser.getVersion answered (buffer-until-open)", !versionLeg.error, versionLeg.error ?? "");
  if (!versionLeg.error) {
    check("C11 response is a TEXT frame", versionLeg.isBinary === false);
    let parsed = null;
    try {
      parsed = JSON.parse(versionLeg.text);
    } catch {
      /* fail below */
    }
    check("C12 JSON response id 1 with a product", parsed?.id === 1 && typeof parsed?.result?.product === "string");
  }
  const clientA = versionLeg.ws;

  // second concurrent client (browser-level CDP is multi-client)
  const mintB = tickets.mintTicket("smoke_ws");
  const secondLeg = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/cdp/smoke_ws?ticket=${encodeURIComponent(mintB.ticket)}`);
    const timer = setTimeout(() => reject(new Error("no response within 5s")), 5000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Browser.getVersion" })));
    ws.on("message", (data) => {
      clearTimeout(timer);
      resolve({ ws, text: bridge.frameToText(data) });
    });
    ws.on("error", reject);
    ws.on("close", (code) => reject(new Error(`closed early: ${code}`)));
  }).catch((e) => ({ error: String(e) }));
  check("C13 second concurrent client works", !secondLeg.error && JSON.parse(secondLeg.text)?.id === 1, secondLeg.error ?? "");
  if (secondLeg.ws) secondLeg.ws.close(1000);

  // §9 E2E assert: attach + startScreencast → ≥1 screencastFrame ≤5s, ack it.
  if (clientA) {
    const screencastLeg = await new Promise((resolve, reject) => {
      const ws = clientA;
      let nextId = 10;
      const pending = new Map();
      let pageSession = "";
      const timer = setTimeout(() => reject(new Error("no screencastFrame within 5s")), 5000);
      const send = (method, params = {}, sessionId) =>
        new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params, sessionId }));
        });
      ws.on("message", (data) => {
        let msg;
        try {
          msg = JSON.parse(bridge.frameToText(data));
        } catch {
          return;
        }
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
          return;
        }
        if (msg.method === "Page.screencastFrame" && msg.sessionId === pageSession) {
          clearTimeout(timer);
          // ack with the FRAME's own sessionId (mandatory mechanic — §8 risk 3)
          void send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }, pageSession);
          resolve({ frameBytes: msg.params.data?.length ?? 0 });
        }
      });
      (async () => {
        await send("Target.setDiscoverTargets", { discover: true });
        const { targetInfos } = await send("Target.getTargets");
        const page = targetInfos.find((t) => t.type === "page");
        if (!page) throw new Error("no page target");
        const { sessionId } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
        pageSession = sessionId;
        await send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 1280, everyNthFrame: 1 }, sessionId);
      })().catch(reject);
    }).catch((e) => ({ error: String(e) }));
    check("C14 ≥1 screencastFrame within 5s (acked)", !screencastLeg.error && screencastLeg.frameBytes > 0, screencastLeg.error ?? "");
    clientA.close(1000);
  } else {
    check("C14 ≥1 screencastFrame within 5s (acked)", false, "no client from C10");
  }
}

// ───────────────────────── §D routes (direct-import idiom) ─────────────────────────
console.log("\n── §D ticket/handoff/launch routes ──");
{
  const ticketRoute = await import("../../src/app/api/v2/browser/ticket/route.ts");
  const handoffRoute = await import("../../src/app/api/v2/browser/handoff/route.ts");
  const launchRoute = await import("../../src/app/api/v2/browser/launch/route.ts");

  const post = (handler, url, body, headers = {}) =>
    handler(
      new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  // Chunk-2 gating decision: launch + handoff refuse when the capability is off.
  writeSettings({ capability: { ...(readSettings().capability ?? {}), browserEnabled: false } });
  const gatedLaunch = await post(launchRoute.POST, "http://smoke.local/api/v2/browser/launch", { session: "smoke_ws" });
  const gatedLaunchJson = await gatedLaunch.json();
  check("D1 /launch gated → 403 CAPABILITY_DISABLED", gatedLaunch.status === 403 && gatedLaunchJson.code === "CAPABILITY_DISABLED");
  const gatedHandoff = await post(handoffRoute.POST, "http://smoke.local/api/v2/browser/handoff", { session: "smoke_ws", headed: true });
  const gatedHandoffJson = await gatedHandoff.json();
  check("D2 /handoff gated → 403 CAPABILITY_DISABLED", gatedHandoff.status === 403 && gatedHandoffJson.code === "CAPABILITY_DISABLED");
  writeSettings({ capability: { ...(readSettings().capability ?? {}), browserEnabled: true } });

  // ticket route: wsUrl from the request Host + the ACTUAL bridge port.
  const tRes = await post(ticketRoute.POST, "http://smoke.local/api/v2/browser/ticket", { session: "smoke_ws" }, { host: "smoke.local:3737" });
  const tJson = await tRes.json();
  const bridgeInfo = bridge.getBrowserWsInfo();
  check("D3 ticket route 200 with wsUrl + expiresAt", tRes.status === 200 && typeof tJson.wsUrl === "string" && tJson.expiresAt > Date.now());
  check(
    "D4 wsUrl = ws://<reqHost>:<actual wsPort>/cdp/<session>?ticket=",
    tJson.wsUrl?.startsWith(`ws://smoke.local:${bridgeInfo?.port}/cdp/smoke_ws?ticket=`),
    tJson.wsUrl ?? "",
  );
  {
    // the minted ticket actually opens a bridge connection
    const t = new URL(tJson.wsUrl.replace("ws://smoke.local:", "ws://127.0.0.1:"));
    const ok = await new Promise((resolve) => {
      const ws = new WebSocket(t.toString());
      const timer = setTimeout(() => resolve(false), 5000);
      ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Browser.getVersion" })));
      ws.on("message", () => {
        clearTimeout(timer);
        ws.close(1000);
        resolve(true);
      });
      ws.on("error", () => resolve(false));
    });
    check("D5 route-minted ticket accepted by the bridge", ok);
  }
  const t404 = await post(ticketRoute.POST, "http://smoke.local/api/v2/browser/ticket", { session: "nope" });
  check("D6 unknown session → 404", t404.status === 404);

  const savedPw = process.env.AGENTOS_PASSWORD;
  delete process.env.AGENTOS_PASSWORD;
  const t503 = await post(ticketRoute.POST, "http://smoke.local/api/v2/browser/ticket", { session: "smoke_ws" });
  check("D7 no AGENTOS_PASSWORD → 503 fail-closed", t503.status === 503);
  process.env.AGENTOS_PASSWORD = savedPw;

  // handoff headed → headless with cookie survival (§9 step 7 in miniature)
  const liveBefore = manager.getLiveSession("smoke_ws");
  await liveBefore.page.goto(fixtureUrl);
  await liveBefore.page.evaluate(
    () => (document.cookie = "smoke_cookie=1; expires=Tue, 01 Jan 2036 00:00:00 GMT; path=/"),
  );
  const createdBefore = liveBefore.createdAt;

  const headedRes = await post(handoffRoute.POST, "http://smoke.local/api/v2/browser/handoff", { session: "smoke_ws", headed: true });
  const headedJson = await headedRes.json();
  check("D8 handoff headed:true relaunches visible", headedRes.status === 200 && headedJson.session?.headed === true);
  const liveHeaded = manager.getLiveSession("smoke_ws");
  check("D9 relaunch is a NEW instance (createdAt advanced)", liveHeaded && liveHeaded.createdAt > createdBefore);
  note("a Chromium window flashed on the desktop just now — that IS the headed handoff");

  const headlessRes = await post(handoffRoute.POST, "http://smoke.local/api/v2/browser/handoff", { session: "smoke_ws", headed: false });
  const headlessJson = await headlessRes.json();
  check("D10 handoff headed:false returns headless", headlessRes.status === 200 && headlessJson.session?.headed === false);

  const liveAfter = manager.getLiveSession("smoke_ws");
  await liveAfter.page.goto(fixtureUrl);
  const cookie = await liveAfter.page.evaluate(() => document.cookie);
  check("D11 cookie SURVIVED both relaunches (profile keeps auth state)", /smoke_cookie=1/.test(cookie), cookie);

  const handoffRows = getDb()
    .prepare(`SELECT * FROM browser_tool_audit WHERE tool = 'browser_handoff' ORDER BY id`)
    .all();
  // (the gated refusal returns before launchSession, so exactly the 2 live
  //  handoffs are audited — refusals are audited on the /tool path, not here)
  check("D12 browser_handoff audit rows recorded for both relaunches",
    handoffRows.length >= 2 && handoffRows.every((r) => r.session_name === "smoke_ws"));
}

// ───────────────────────── §E cleanup ─────────────────────────
console.log("\n── §E cleanup ──");
{
  await manager.closeAllSessions();
  check("E1 all sessions closed", manager.getLiveSessions().length === 0);
  bridge.stopBrowserWs();
  check("E2 bridge stopped (no port squat)", bridge.getBrowserWsInfo() === null);
  fixture.close();
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
