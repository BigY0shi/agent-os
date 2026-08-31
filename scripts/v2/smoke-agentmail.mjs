// AgentMail client + the newsletter's SECOND delivery transport (migration 063).
//
// Run: npx tsx scripts/v2/smoke-agentmail.mjs
//
// Fully offline: AGENTIC_OS_AGENTMAIL_DIR points at a temp dir holding a FAKE
// key, and the HTTP transport is stubbed via __setAgentMailTransportForTests.
// Yoshi's real ~/.agentic-os/agentmail/config.json is never read, and no
// request leaves the machine.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-am-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-am-settings-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
const amDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-am-conf-"));
process.env.AGENTIC_OS_AGENTMAIL_DIR = amDir;
process.env.OLLAMA_URL = "http://127.0.0.1:1";
process.env.NEWSLETTER_STUB_PARSE = "1";
fs.writeFileSync(
  process.env.AGENTIC_OS_SETTINGS,
  JSON.stringify({ memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" } }),
);

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const cfg = await import("../../src/lib/v2/agentmail/config.ts");
const client = await import("../../src/lib/v2/agentmail/client.ts");
const amSync = await import("../../src/lib/v2/newsletter/agentmailSync.ts");
const store = await import("../../src/lib/v2/newsletter/store.ts");
const { ensureDb } = await import("../../src/lib/v2/db.ts");

// ── §A the credential firewall ───────────────────────────────────────────────
console.log("");
console.log("── §A credential firewall ──");
check("A1 with no config file, configured() is false", cfg.agentmailConfigured() === false);

// A BOM is written by PowerShell's `Set-Content -Encoding utf8` — the exact
// thing that broke this config on 2026-08-31.
fs.writeFileSync(
  cfg.configPath(),
  "﻿" + JSON.stringify({ api_key: "fake-key-do-not-use", inbox_id: "smoke@agentmail.to", organization_id: "org-1" }),
  "utf8",
);
check("A2 a BOM-prefixed config still parses", cfg.agentmailConfigured() === true);
check("A3 the inbox address is readable (it is not a secret)", cfg.agentmailInbox() === "smoke@agentmail.to");

const src = read("src/lib/v2/agentmail/config.ts");
check("A4 NO getter returns the api key", !/export\s+(function|const)\s+\w*[aA]piKey/.test(src));
check("A5 the key is read in exactly ONE place", (src.match(/\.api_key/g) || []).length <= 2, String((src.match(/\.api_key/g) || []).length));

// The host guard must be CODE, not a comment: skill.md asks for it in prose.
let sentTo = [];
cfg.__setAgentMailTransportForTests(async (url, init) => {
  // Header keys are a plain object here, so casing is significant — the client
  // sets "Authorization".
  sentTo.push({ url, auth: init.headers.Authorization ?? init.headers.authorization });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
});
let threw = null;
try {
  await cfg.agentmailFetch("https://evil.example.com/v0/steal");
} catch (e) { threw = e; }
check("A6 a call to another host THROWS before any header is built", !!threw && /refusing to send credentials/.test(threw.message));
check("A7 ...and nothing was transmitted", sentTo.length === 0, JSON.stringify(sentTo));

await cfg.agentmailFetch("/organizations");
check("A8 a legitimate call carries the bearer token to api.agentmail.to",
  sentTo.length === 1 && sentTo[0].url.startsWith("https://api.agentmail.to/v0/") && /^Bearer /.test(sentTo[0].auth));

// ── §B client shape ──────────────────────────────────────────────────────────
console.log("");
console.log("── §B client ──");
cfg.__setAgentMailTransportForTests(async (url, init) => {
  if (url.endsWith("/organizations")) {
    return new Response(JSON.stringify({
      organization_id: "org-1", agent_verified: true, daily_send_limit: 100, inbox_limit: 3, billing_plan_id: "free",
    }), { status: 200 });
  }
  if (url.includes("/messages/send")) {
    return new Response(JSON.stringify({ message_id: "m-sent-1" }), { status: 200 });
  }
  if (url.includes("/agent/verify")) {
    const body = JSON.parse(init.body);
    // The API regex-checks ^\d{6}$ on otp_code; a wrong FIELD name reads as a
    // bad code rather than a bad request, which is what cost time live.
    if (!/^\d{6}$/.test(body.otp_code ?? "")) {
      return new Response(JSON.stringify({ code: "validation_error", path: ["otp_code"] }), { status: 400 });
    }
    return new Response(JSON.stringify({ verified: true }), { status: 200 });
  }
  if (url.includes("/messages")) {
    return new Response(JSON.stringify({ messages: [
      { message_id: "m1", thread_id: "t1", from: "Stratechery <news@stratechery.com>", to: "ai-sector@yoshi.addy.io",
        subject: "Weekly", text: "A story about chips. https://example.com/chips", timestamp: "2026-08-31T10:00:00.000Z" },
      { message_id: "m2", from: "smoke@agentmail.to", to: "someone@else.com",
        subject: "our own outbound", text: "hi", timestamp: "2026-08-31T09:00:00.000Z" },
      { message_id: "m3", from: "TLDR <daily@tldr.tech>", to: "ai-sector@yoshi.addy.io",
        subject: "Daily", text: "Also about chips. https://example.com/chips", timestamp: "2026-08-31T11:00:00.000Z" },
    ] }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
});

const org = await client.getOrganization();
check("B1 getOrganization maps the claim state", org?.verified === true && org.dailySendLimit === 100 && org.plan === "free", JSON.stringify(org));
check("B2 sendMessage returns the message id", (await client.sendMessage({ to: "a@b.c", subject: "s", text: "t" })).messageId === "m-sent-1");
check("B3 verifyAgent sends otp_code (not otp)", (await client.verifyAgent("519780")).verified === true);
let vErr = null;
try { await client.verifyAgent("abc"); } catch (e) { vErr = e; }
check("B4 a malformed code fails LOUDLY with the status", !!vErr && /400/.test(vErr.message));
const msgs = await client.listMessages();
check("B5 listMessages unwraps and maps", msgs.length === 3 && msgs[0].messageId === "m1");

// ── §C address parsing ───────────────────────────────────────────────────────
console.log("");
console.log("── §C sender parsing (feeds the source chip) ──");
check("C1 display name extracted", amSync.displayNameOf("Stratechery <news@stratechery.com>") === "Stratechery");
check("C2 a bare address yields NO name (never a chip identical to the address)", amSync.displayNameOf("news@stratechery.com") === "");
check("C3 address extracted + lowercased", amSync.addressOf("Stratechery <NEWS@Stratechery.com>") === "news@stratechery.com");

// ── §D the sync transport ────────────────────────────────────────────────────
console.log("");
console.log("── §D newsletter sync via agentmail ──");
ensureDb();
const emailCols = ensureDb().prepare("PRAGMA table_info(newsletter_emails)").all().map((c) => c.name);
check("D1 migration 063 added newsletter_emails.source", emailCols.includes("source"), emailCols.join(","));

store.createSubscription({ name: "AI sector", aliasId: "al-1", aliasEmail: "ai-sector@yoshi.addy.io" });
const r1 = await amSync.syncAgentMail();
check("D2 both inbound messages ingested", r1.fetched === 2, JSON.stringify({ fetched: r1.fetched, skipped: r1.skipped, errors: r1.errors }));
check("D3 the agent's OWN outbound is skipped, not ingested", r1.skipped >= 1);

const stored = store.listEmails({});
check("D4 rows are tagged source='agentmail'", stored.length === 2 && stored.every((e) => e.source === "agentmail"), stored.map((e) => e.source).join(","));
check("D5 the sender display name is kept for the chip", stored.some((e) => e.fromName === "Stratechery") && stored.some((e) => e.fromName === "TLDR"));
check("D6 both attach to the shared alias's subscription", stored.every((e) => !!e.subscriptionId));

// Re-running must be a no-op: gmail_id is the provider message id and INSERT
// OR IGNORE is the idempotency key — that is why this lane needs no watermark.
const r2 = await amSync.syncAgentMail();
check("D7 a second run ingests NOTHING (idempotent on message id)", r2.fetched === 0, JSON.stringify(r2));
check("D8 ...and does not error", r2.errors.length === 0, r2.errors.join(" | "));

// ── §E the route's fallback rule ─────────────────────────────────────────────
console.log("");
console.log("── §E sync route transport selection ──");
const route = read("src/app/api/newsletter/sync/route.ts");
check("E1 agentmail is used only when gmail is NOT connected", /!gmailConfigured\(\) && agentmailConfigured\(\)/.test(route));
check("E2 the response says WHICH transport ran", /transport: "agentmail"/.test(route) && /transport: "gmail"/.test(route));
check("E3 GET reports agentmail status for the UI", /agentmailConfigured: agentmailConfigured\(\)/.test(route));
check("E4 with NEITHER configured the loud config error still surfaces",
  /NewsletterConfigError/.test(route) && /412/.test(route));

// ── §F test isolation (this one bit for real) ────────────────────────────────
console.log("");
console.log("── §F no smoke may reach the LIVE agentmail inbox ──");
// On 2026-08-31 the sync fallback made smoke-newsletter read the real
// ~/.agentic-os/agentmail/config.json and list Yoshi's actual inbox with his
// actual key — a test making a live third-party call. Isolation is now
// asserted rather than remembered.
{
  const dir = path.join(root, "scripts", "v2");
  const offenders = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("smoke-") && f.endsWith(".mjs"))
    .filter((f) => {
      const s = fs.readFileSync(path.join(dir, f), "utf8");
      const touchesNewsletter =
        s.includes("AGENTIC_OS_NEWSLETTER_DIR") ||
        s.includes("newsletter/sync") ||
        s.includes("agentmail/config");
      return touchesNewsletter && !s.includes("AGENTIC_OS_AGENTMAIL_DIR");
    });
  check("F1 every newsletter/agentmail smoke isolates AGENTIC_OS_AGENTMAIL_DIR",
    offenders.length === 0, offenders.join(", "));
}
check("F2 this smoke's own config dir is a temp dir, not the real one",
  cfg.configPath().startsWith(os.tmpdir()), cfg.configPath());

console.log("");
console.log(`${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp conf: ${amDir})`);
process.exit(failures === 0 ? 0 : 1);
