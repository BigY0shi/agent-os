// SPEC-D G2.1 smoke: migration 040 DDL, crypto round-trip (incl. key-file
// creation via the AGENTIC_OS_KEY override), definition config patch,
// UNIQUE(definition_slug, account_id) account upsert semantics, config_enc
// opacity, activities/call-logs/sync-runs CRUD, oauth_sessions one-shot pop +
// 15-min TTL purge. No server, no network.
// Run: npx tsx scripts/v2/smoke-int-store.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any imports — never touch the live DB/settings/key.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-intstore-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intstore-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
const keyFile = path.join(settingsDir, "agentos.key");
process.env.AGENTIC_OS_KEY = keyFile;

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const crypto = await import("../../src/lib/v2/integrations/crypto.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

// ---------------------------------------------------------------------------
// A. Migration 040 DDL
// ---------------------------------------------------------------------------
const tables = getDb()
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((r) => r.name);
for (const t of [
  "integration_definitions",
  "integration_accounts",
  "activities",
  "integration_call_logs",
  "integration_sync_runs",
  "oauth_sessions",
]) {
  check(`migration 040 created ${t}`, tables.includes(t));
}
const mig = getDb().prepare("SELECT name FROM migrations WHERE version = 40").get();
check("migration row 40 'integrations_core' recorded", mig?.name === "integrations_core");

// ---------------------------------------------------------------------------
// B. Crypto: key-file creation + round trip + opacity
// ---------------------------------------------------------------------------
check("key file absent before first use", !fs.existsSync(keyFile));
const sealed = crypto.sealSecret("hunter2-token");
check("key file created on first seal", fs.existsSync(keyFile));
check("key file is 32 bytes", fs.readFileSync(keyFile).length === 32);
check("sealed blob is versioned + opaque", sealed.startsWith("v1:") && !sealed.includes("hunter2"));
check("openSecret round-trips", crypto.openSecret(sealed) === "hunter2-token");
const sealed2 = crypto.sealSecret("hunter2-token");
check("fresh IV per seal (same plaintext, different blob)", sealed2 !== sealed);
let tampered = false;
try {
  crypto.openSecret(sealed.slice(0, -4) + "AAAA");
} catch {
  tampered = true;
}
check("tampered blob throws", tampered);
const js = crypto.sealJson({ token: "abc", n: 5 });
const back = crypto.openJson(js);
check("sealJson/openJson round-trips (values stringified)", back.token === "abc" && back.n === "5");
check("openJson(null) → {}", Object.keys(crypto.openJson(null)).length === 0);

// ---------------------------------------------------------------------------
// C. Definition config
// ---------------------------------------------------------------------------
store.patchDefinitionConfig("_test", { clientId: "cid-1", clientSecret: "csec-1" });
let cfg = store.getDefinitionConfig("_test");
check("definition config patch persists", cfg.clientId === "cid-1" && cfg.clientSecret === "csec-1");
store.patchDefinitionConfig("_test", { webhookSecret: "whs-1" });
cfg = store.getDefinitionConfig("_test");
check("patch MERGES (clientId survived)", cfg.clientId === "cid-1" && cfg.webhookSecret === "whs-1");
store.patchDefinitionConfig("_test", { clientSecret: "" });
check("empty string clears a key", !("clientSecret" in store.getDefinitionConfig("_test")));
const booleans = store.definitionConfiguredKeys("_test");
check("configured keys are booleans only", booleans.clientId === true && booleans.clientSecret === false && booleans.webhookSecret === true);
const rawDef = getDb().prepare("SELECT config_enc FROM integration_definitions WHERE slug='_test'").get();
check("definition config_enc opaque on disk", rawDef.config_enc.startsWith("v1:") && !rawDef.config_enc.includes("cid-1") && !rawDef.config_enc.includes("whs-1"));

// ---------------------------------------------------------------------------
// D. Account upsert (UNIQUE definition_slug + account_id)
// ---------------------------------------------------------------------------
const a1 = store.upsertAccount({
  definitionSlug: "_test",
  accountId: "ext-1",
  displayName: "First",
  config: { token: "tok-original" },
  settings: { autoActivityRead: true },
});
check("account created active", a1.isActive && a1.accountId === "ext-1");
store.patchAccountSettings(a1.id, { triggersEnabled: false, state: { cursor: "9" } });
store.setAccountActive(a1.id, false);
const a2 = store.upsertAccount({
  definitionSlug: "_test",
  accountId: "ext-1",
  displayName: "Reconnected",
  config: { token: "tok-new" },
});
check("upsert reuses the SAME row id", a2.id === a1.id);
check("upsert refreshed displayName + reactivated", a2.displayName === "Reconnected" && a2.isActive);
check("upsert preserved settings (state watermark survived)", a2.settings.state?.cursor === "9" && a2.settings.triggersEnabled === false);
check("upsert re-sealed config", store.getAccountConfig(a1.id).token === "tok-new");
const a3 = store.upsertAccount({ definitionSlug: "_test", accountId: "ext-2", config: { token: "t2" } });
check("different accountId → different row", a3.id !== a1.id);
check("listAccounts sees both", store.listAccounts("_test").length === 2);
const rawAcct = getDb().prepare("SELECT config_enc FROM integration_accounts WHERE id = ?").get(a1.id);
check("account config_enc opaque on disk", rawAcct.config_enc.startsWith("v1:") && !rawAcct.config_enc.includes("tok-new"));

// state merge: only given keys
store.mergeAccountState(a1.id, { other: "kept" });
const st = store.getAccountState(a1.id);
check("mergeAccountState merges by key", st.cursor === "9" && st.other === "kept");

// ---------------------------------------------------------------------------
// E. Activities + call logs + sync runs
// ---------------------------------------------------------------------------
const act = store.insertActivity({ accountId: a1.id, text: "hello world", sourceUrl: "https://x/1", eventType: "TEST_EVENT", payload: { n: 1 } });
check("activity inserted pending", act.ingestStatus === "pending" && act.payload.n === 1);
const rej = store.insertActivity({ accountId: a1.id, text: "junk", rejectionReason: "rule 'r' matched" });
check("rejected activity carries reason + status", rej.ingestStatus === "rejected" && rej.rejectionReason.includes("rule"));
store.setActivityIngestStatus(act.id, "ingested");
check("ingest status update", store.getActivity(act.id).ingestStatus === "ingested");
check("listActivities newest-first", store.listActivities(a1.id)[0].id === rej.id);

store.insertCallLog({ accountId: a1.id, toolName: "_test_echo", source: "smoke", args: { text: "hi", apiToken: "SECRET-A" }, secretValues: ["val-b"], ok: true, durationMs: 5 });
const log = store.listCallLogs(a1.id)[0];
check("call log row written", log.toolName === "_test_echo" && log.ok === true);
check("call log args REDACTED by key", log.args.apiToken === "[redacted]" && log.args.text === "hi");

const runId = store.startSyncRun(a1.id, "manual");
store.finishSyncRun(runId, { ok: true, activitiesCount: 2 });
const latest = store.latestSyncRun(a1.id);
check("sync run round-trip", latest.id === runId && latest.ok === true && latest.activitiesCount === 2);
const sum = store.toAccountSummary(store.getAccount(a1.id));
check("AccountSummary carries lastSync, no config", sum.lastSync?.activitiesCount === 2 && !("config" in sum) && !JSON.stringify(sum).includes("tok-new"));

// ---------------------------------------------------------------------------
// F. OAuth sessions: one-shot + TTL
// ---------------------------------------------------------------------------
store.putOauthSession({ state: "st-1", definitionSlug: "_test", codeVerifier: "ver-1", redirectUrl: "/integrations" });
const popped = store.popOauthSession("st-1");
check("popOauthSession returns the row", popped?.codeVerifier === "ver-1");
check("pop is ONE-SHOT", store.popOauthSession("st-1") === null);
getDb()
  .prepare("INSERT INTO oauth_sessions(state, definition_slug, redirect_url, created_at) VALUES ('st-old','_test','/x',?)")
  .run(new Date(Date.now() - 16 * 60 * 1000).toISOString());
check("expired session purged on read", store.popOauthSession("st-old") === null);
check("purge removed the row", getDb().prepare("SELECT COUNT(*) c FROM oauth_sessions").get().c === 0);

// ---------------------------------------------------------------------------
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
