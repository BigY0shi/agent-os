// SPEC-D G2.3 smoke: OAuth engine vs a mock token server on 127.0.0.1
// (ephemeral port) — start→callback→account upsert, PKCE S256 verified
// server-side (challenge from the authorize URL vs code_verifier at token
// POST), ${...} URL interpolation from the definition config, state ONE-SHOT,
// 15-min TTL purge, provider-error and bad-state redirects, callback ROUTE
// handler redirect. No dev server needed.
// Run: npx tsx scripts/v2/smoke-int-oauth.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-intoauth-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intoauth-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    integrations: { callbackOrigin: "http://localhost:3000" },
    memory: { ingestEnabled: false },
  }),
);

// ---------------------------------------------------------------------------
// Mock token server
// ---------------------------------------------------------------------------
let lastTokenPost = null; // { params, headers }
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/token" && req.method === "POST") {
      const params = Object.fromEntries(new URLSearchParams(body));
      lastTokenPost = { params, headers: req.headers, contentType: req.headers["content-type"] };
      if (params.code !== "good-code") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "at-12345",
          refresh_token: "rt-67890",
          token_type: "bearer",
          account: "mock-user",
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${mock.address().port}`;

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");
const oauth = await import("../../src/lib/v2/integrations/oauth.ts");
const { NextRequest } = await import("next/server");
const callbackRoute = await import("../../src/app/api/v2/integrations/oauth/callback/route.ts");
const startRoute = await import("../../src/app/api/v2/integrations/oauth/start/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

// ---------------------------------------------------------------------------
// A. Unconfigured definition → loud 400
// ---------------------------------------------------------------------------
let unconfigured = null;
try {
  oauth.startOAuth("_test");
} catch (err) {
  unconfigured = err;
}
check("startOAuth without clientId/secret → 400", unconfigured?.status === 400 && String(unconfigured.message).includes("not configured"));

// Configure the definition — authBase/tokenBase drive the ${...} interpolation.
store.patchDefinitionConfig("_test", {
  clientId: "cid-oauth",
  clientSecret: "csec-oauth",
  authBase: base,
  tokenBase: base,
});

// ---------------------------------------------------------------------------
// B. start → authorize URL shape (via the ROUTE handler)
// ---------------------------------------------------------------------------
const startRes = await startRoute.POST(
  new NextRequest("http://localhost/api/v2/integrations/oauth/start", {
    method: "POST",
    body: JSON.stringify({ slug: "_test", returnTo: "/integrations" }),
    headers: { "content-type": "application/json" },
  }),
);
check("start route 200", startRes.status === 200);
const { url } = await startRes.json();
const authorize = new URL(url);
check("authorize URL interpolated from def config", url.startsWith(`${base}/authorize`));
const q = authorize.searchParams;
check("client_id + redirect_uri + response_type present", q.get("client_id") === "cid-oauth" && q.get("redirect_uri") === "http://localhost:3000/api/v2/integrations/oauth/callback" && q.get("response_type") === "code");
check("scopes joined under scope_identifier (incl default_scopes)", q.get("scope") === "read fixture");
const state = q.get("state");
check("state is 24-byte base64url", typeof state === "string" && state.length >= 32);
const challenge = q.get("code_challenge");
check("PKCE S256 challenge present", !!challenge && q.get("code_challenge_method") === "S256");
const sessionRow = getDb().prepare("SELECT * FROM oauth_sessions WHERE state = ?").get(state);
check("state row PERSISTED (restart-resilient)", !!sessionRow && sessionRow.definition_slug === "_test");
check("secret values NOT in the session row", !JSON.stringify(sessionRow).includes("csec-oauth"));

// ---------------------------------------------------------------------------
// C. callback → token exchange → account upsert (lib-level)
// ---------------------------------------------------------------------------
const outcome = await oauth.handleCallback({ state, code: "good-code" });
check("callback redirects ?connected=_test", outcome.redirect === "/integrations?connected=_test");
check("token POST was form-encoded", lastTokenPost?.contentType?.includes("application/x-www-form-urlencoded"));
check("token POST carried code + client creds", lastTokenPost.params.code === "good-code" && lastTokenPost.params.client_id === "cid-oauth" && lastTokenPost.params.client_secret === "csec-oauth");
const verifier = lastTokenPost.params.code_verifier;
const computed = createHash("sha256").update(verifier ?? "").digest("base64url");
check("PKCE verifier matches the S256 challenge", !!verifier && computed === challenge);
const account = outcome.account;
check("account upserted from setup()", account?.accountId === "fixture-oauth-mock-user" && account.isActive);
check("tokens sealed into account config", store.getAccountConfig(account.id).accessToken === "at-12345" && store.getAccountConfig(account.id).refreshToken === "rt-67890");
const rawAcct = getDb().prepare("SELECT config_enc FROM integration_accounts WHERE id = ?").get(account.id);
check("access token NOT plaintext in DB", !rawAcct.config_enc.includes("at-12345"));
const job = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(`integration-sync:${account.id}`);
check("schedule job registered on connect", !!job && job.kind === "integration.sync" && job.rrule === "FREQ=MINUTELY;INTERVAL=15");

// ---------------------------------------------------------------------------
// D. state one-shot + error paths
// ---------------------------------------------------------------------------
const replay = await oauth.handleCallback({ state, code: "good-code" });
check("state is ONE-SHOT (replay → error redirect)", replay.redirect.startsWith("/integrations?error=") && !replay.account);
const noState = await oauth.handleCallback({ code: "good-code" });
check("missing state → error redirect", noState.redirect.startsWith("/integrations?error="));

// provider error param
const { state: st2 } = oauth.startOAuth("_test", "/integrations");
const provErr = await oauth.handleCallback({ state: st2, error: "access_denied", error_description: "user said no" });
check("provider error → error redirect with description", provErr.redirect.includes(encodeURIComponent("user said no")));

// bad code → token endpoint 400 surfaces as error redirect
const { state: st3 } = oauth.startOAuth("_test");
const badCode = await oauth.handleCallback({ state: st3, code: "wrong" });
check("token-exchange failure → error redirect (HTTP 400 named)", badCode.redirect.includes("error=") && decodeURIComponent(badCode.redirect).includes("400"));

// ---------------------------------------------------------------------------
// E. TTL purge + callback ROUTE handler
// ---------------------------------------------------------------------------
const { state: stOld } = oauth.startOAuth("_test");
getDb()
  .prepare("UPDATE oauth_sessions SET created_at = ? WHERE state = ?")
  .run(new Date(Date.now() - 16 * 60 * 1000).toISOString(), stOld);
const expired = await oauth.handleCallback({ state: stOld, code: "good-code" });
check("expired state (15-min TTL) → error redirect", expired.redirect.startsWith("/integrations?error="));

const { state: st4 } = oauth.startOAuth("_test");
const routeRes = await callbackRoute.GET(
  new NextRequest(`http://localhost:3000/api/v2/integrations/oauth/callback?state=${st4}&code=good-code`),
);
check("callback route → 3xx redirect", routeRes.status >= 300 && routeRes.status < 400);
check("callback route Location carries ?connected=_test", (routeRes.headers.get("location") ?? "").includes("connected=_test"));

// ---------------------------------------------------------------------------
// Teardown: ensureV2 booted the full stack — settle its timers before exit or
// libuv aborts on Windows (async handle closing race, known from smoke-jarvis-brain).
try {
  const queue = await import("../../src/lib/v2/memory/queue.ts");
  queue.stopMemoryQueue?.();
} catch {}
try {
  const sched = globalThis.__agentosV2Scheduler;
  if (sched?.timer) clearInterval(sched.timer);
} catch {}
await new Promise((r) => mock.close(r));
await new Promise((r) => setTimeout(r, 250));
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
