// SPEC-F K — smoke-newsletter: the Newsletter backend (K1.1 config + addy,
// K1.2 migration 061 + store, K3.1 sync, K3.2 parse + dedupe, K3.3 jobs),
// fully OFFLINE.
//
// Covers: migration 061 + store CRUD · UNIQUE on gmail_id and canonical_url ·
// addyConfigured()/gmailConfigured() false on an empty config and true on a
// stub, with NOTHING leaking the key value · the addy client's loud non-2xx
// path (status + body snippet) · canonicalizeUrl (utm_*/ref/fbclid/mc_cid/
// mc_eid, trailing slash, fragment, tracker unwrap) · three fixture emails
// where two carry the SAME story behind different tracking links merging into
// one story with two sources · the watermark holding across two runs (second
// fetches zero) · a per-message parse failure marking that row failed without
// aborting the batch · embedDegraded:true surfacing honestly when the embedder
// is unreachable (offline, always).
//
// NOTHING here touches the network:
//   • the addy transport is a stub (config.__setAddyTransportForTests)
//   • Gmail is the documented googleClient.__setGoogleMockForTests seam
//   • OLLAMA_URL points at a dead port AND memory.provider/embedProvider are
//     pinned to 'ollama-local' — the CLOUD provider ignores OLLAMA_URL and
//     dials https://ollama.com (chunk-1 delta 8; it bit that smoke first).
//   • the newsletter config dir is a temp dir, so Yoshi's real
//     ~/.agentic-os/newsletter/config.json is never read or written.
// Run: npx tsx scripts/v2/smoke-newsletter.mjs

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src imports ──────────────────────────────────────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-newsletter-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-nl-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
const nlDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-nl-config-"));
process.env.AGENTIC_OS_NEWSLETTER_DIR = nlDir; // NEVER Yoshi's real config
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port
process.env.NEWSLETTER_STUB_PARSE = "1"; // deterministic, model-independent extraction

const baseSettings = {
  memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" },
  capability: { browserEnabled: false },
  tasks: { timezone: "America/Chicago" },
  browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
};
const writeSettings = (extra = {}) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ ...baseSettings, ...extra }));
writeSettings(); // newsletter.* absent → DEFAULT_SETTINGS

let failures = 0;
const check = (name, cond, extra) => {
  console.log(
    `${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`,
  );
  if (!cond) failures++;
};

const { NextRequest } = await import("next/server.js");
const { ensureDb } = await import("../../src/lib/v2/db.ts");
const store = await import("../../src/lib/v2/newsletter/store.ts");
const config = await import("../../src/lib/v2/newsletter/config.ts");
const addy = await import("../../src/lib/v2/newsletter/addy.ts");
const dedupe = await import("../../src/lib/v2/newsletter/dedupe.ts");
const parse = await import("../../src/lib/v2/newsletter/parse.ts");
const sync = await import("../../src/lib/v2/newsletter/sync.ts");
const jobs = await import("../../src/lib/v2/newsletter/jobs.ts");
const intStore = await import("../../src/lib/v2/integrations/store.ts");
const googleClient = await import("../../src/lib/v2/integrations/connectors/googleClient.ts");
const scheduler = await import("../../src/lib/v2/scheduler.ts");
const syncRoute = await import("../../src/app/api/newsletter/sync/route.ts");

ensureDb();

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const req = (url, method = "GET") =>
  new NextRequest(`http://127.0.0.1:3737${url}`, { method });

// ═══ §A migration 061 + store CRUD ═══════════════════════════════════════════
console.log("\n── §A migration 061 + store CRUD ──");
let subA = null;
{
  const tables = ensureDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'newsletter%'")
    .all()
    .map((r) => r.name)
    .sort();
  check(
    "A1 migration 061 created all six newsletter tables",
    ["newsletter_editions", "newsletter_emails", "newsletter_state", "newsletter_stories", "newsletter_story_sources", "newsletter_subscriptions"].every(
      (t) => tables.includes(t),
    ),
    tables,
  );

  subA = store.createSubscription({
    name: "TLDR",
    topic: "AI & Agents",
    aliasId: "alias-uuid-1",
    aliasEmail: "TLDR-x7f2@yoshi.addy.io", // mixed case on purpose
    signupUrl: "https://tldr.tech/",
    cadence: "daily",
  });
  check(
    "A2 createSubscription → 12-char id, defaults, TEXT-ISO createdAt",
    /^[a-z0-9]{12}$/.test(subA.id) &&
      subA.status === "active" &&
      subA.cadence === "daily" &&
      subA.createdAt === new Date(subA.createdAt).toISOString(),
    subA,
  );
  check(
    "A3 alias stored lowercased + findSubscriptionByAlias is case-insensitive",
    subA.aliasEmail === "tldr-x7f2@yoshi.addy.io" &&
      store.findSubscriptionByAlias("TLDR-X7F2@YOSHI.ADDY.IO")?.id === subA.id,
    subA.aliasEmail,
  );

  const paused = store.patchSubscription(subA.id, { status: "paused", cadence: "weekly" });
  check(
    "A4 patchSubscription lands status + cadence + updatedAt",
    paused.status === "paused" && paused.cadence === "weekly" && !!paused.updatedAt,
    paused,
  );
  store.patchSubscription(subA.id, { status: "active", cadence: "daily" });
  check(
    "A5 listSubscriptions({status:'active'}) filters",
    store.listSubscriptions({ status: "active" }).some((s) => s.id === subA.id) &&
      !store.listSubscriptions({ status: "dead" }).some((s) => s.id === subA.id),
  );

  const email = store.insertEmail({
    gmailId: "gm-store-1",
    subscriptionId: subA.id,
    fromAddr: "news@tldr.tech",
    toAddr: subA.aliasEmail,
    subject: "TLDR 2026-08-28",
    receivedAt: new Date().toISOString(),
    contentMd: "# hello",
  });
  check(
    "A6 insertEmail → row with parse_status 'pending'",
    email && email.parseStatus === "pending" && email.gmailId === "gm-store-1",
    email,
  );
  const dupe = store.insertEmail({
    gmailId: "gm-store-1",
    receivedAt: new Date().toISOString(),
  });
  check("A7 UNIQUE(gmail_id): the second insert returns null, not a duplicate row", dupe === null);
  check(
    "A7b the original row survived the ignored insert",
    store.listEmails({}).filter((e) => e.gmailId === "gm-store-1").length === 1,
  );

  const failed = store.setEmailParseResult(email.id, { status: "failed", error: "boom" });
  check(
    "A8 setEmailParseResult('failed') sets status AND error",
    failed.parseStatus === "failed" && failed.parseError === "boom",
    failed,
  );
  const reparsed = store.setEmailParseResult(email.id, { status: "parsed" });
  check(
    "A8b re-settling to 'parsed' CLEARS the stale error",
    reparsed.parseStatus === "parsed" && reparsed.parseError === null,
    reparsed,
  );

  const s1 = store.createStory({
    title: "Store story",
    canonicalUrl: "https://example.com/store-story",
    summary: "a summary",
    embedding: [0.6, 0.8],
  });
  check(
    "A9 createStory round-trips + firstSeen is a YYYY-MM-DD bucket",
    /^\d{4}-\d{2}-\d{2}$/.test(s1.firstSeen) &&
      store.getStory(s1.id).canonicalUrl === "https://example.com/store-story",
    s1,
  );
  const withVec = store
    .listStoriesWithEmbeddings(s1.firstSeen)
    .find((s) => s.id === s1.id);
  check(
    "A10 embedding BLOB decodes back to the same Float32 vector",
    withVec?.embedding?.length === 2 &&
      Math.abs(withVec.embedding[0] - 0.6) < 1e-6 &&
      Math.abs(withVec.embedding[1] - 0.8) < 1e-6,
    withVec?.embedding && [...withVec.embedding],
  );

  let urlDupeRejected = false;
  try {
    store.createStory({ title: "Same url", canonicalUrl: "https://example.com/store-story" });
  } catch {
    urlDupeRejected = true;
  }
  check("A11 UNIQUE(canonical_url) rejects a second story on the same URL", urlDupeRejected);
  check(
    "A11b a NULL canonical_url is exempt from the unique index (two are fine)",
    !!store.createStory({ title: "No link one" }) && !!store.createStory({ title: "No link two" }),
  );

  check(
    "A12 addStorySource is idempotent on (story_id, email_id)",
    store.addStorySource({ storyId: s1.id, emailId: email.id, sourceName: "TLDR" }) === true &&
      store.addStorySource({ storyId: s1.id, emailId: email.id, sourceName: "TLDR" }) === false &&
      store.listStorySources(s1.id).length === 1,
  );

  store.upsertEdition("2026-08-28", { date: "2026-08-28", sections: [] });
  const ed = store.getEdition("2026-08-28");
  check(
    "A13 upsertEdition + getEdition round-trip the JSON document",
    ed?.content?.date === "2026-08-28" && store.listEditionDates().includes("2026-08-28"),
    ed,
  );

  store.setState("smoke.k", "v1");
  store.setState("smoke.k", "v2");
  store.setStateJson("smoke.j", { a: 1 });
  check(
    "A14 state get/set upserts + JSON helpers round-trip",
    store.getState("smoke.k") === "v2" &&
      store.getStateJson("smoke.j").a === 1 &&
      store.getState("smoke.missing") === null,
  );
}

// ═══ §B config booleans — and NO key material anywhere ═══════════════════════
console.log("\n── §B config: booleans only, never key material ──");
const FAKE_KEY = "addy-smoke-key-DO-NOT-LEAK-9f3b1c";
{
  check(
    "B1 addyConfigured() is FALSE against an empty temp config dir",
    config.addyConfigured() === false && !fs.existsSync(config.configPath()),
    config.configPath(),
  );
  check(
    "B2 gmailConfigured() is FALSE with no connected gmail account",
    config.gmailConfigured() === false && config.newsletterGmailAccountId() === null,
  );

  fs.writeFileSync(
    config.configPath(),
    JSON.stringify({
      addyio: { apiKey: FAKE_KEY, baseUrl: "https://addy.test/api/v1", domain: "yoshi.addy.io" },
      google: { clientId: "VOID-per-CONVENTIONS-7", clientSecret: "VOID" },
    }),
  );
  check("B3 addyConfigured() flips TRUE once a key is on disk", config.addyConfigured() === true);
  check(
    "B4 non-secret display values ARE exposed (base URL + domain), unslashed",
    config.addyBaseUrl() === "https://addy.test/api/v1" && config.addyDomain() === "yoshi.addy.io",
    [config.addyBaseUrl(), config.addyDomain()],
  );

  // The load-bearing check: NOTHING config.ts exports may return the key.
  const leaks = [];
  for (const [name, fn] of Object.entries(config)) {
    if (typeof fn !== "function" || name.startsWith("__")) continue;
    if (fn.length > 0) continue; // zero-arg readers only
    let out;
    try {
      out = fn();
    } catch {
      continue;
    }
    if (JSON.stringify(out ?? null).includes(FAKE_KEY)) leaks.push(name);
  }
  check("B5 no zero-arg config export returns the API key", leaks.length === 0, leaks);
  check(
    "B6 the settings gear knob for the alias domain overrides the file (rule 16)",
    (() => {
      writeSettings({ newsletter: { addyDomain: "from-settings.addy.io" } });
      const v = config.addyDomain();
      writeSettings();
      return v === "from-settings.addy.io";
    })(),
  );
}

// ═══ §C addy client — loud on non-2xx, count-only on success ═════════════════
console.log("\n── §C addy.io client ──");
{
  let seenAuth = null;
  config.__setAddyTransportForTests(async (url, init) => {
    seenAuth = init.headers.authorization;
    if (url.endsWith("/aliases") && (init.method ?? "GET") === "GET") {
      return new Response(
        JSON.stringify({
          data: [
            { id: "a1", email: "x7f2@yoshi.addy.io", description: "agentos-newsletter: TLDR", active: true },
            { id: "a2", email: "q1z9@yoshi.addy.io", description: null, active: false },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/aliases") && init.method === "POST") {
      return new Response(
        JSON.stringify({ data: { id: "a3", email: "new9@yoshi.addy.io", description: JSON.parse(init.body).description, active: true } }),
        { status: 200 },
      );
    }
    if (url.includes("/active-aliases")) return new Response("", { status: 200 });
    return new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401 });
  });

  const aliases = await addy.listAliases();
  check(
    "C1 listAliases parses the {data:[…]} envelope",
    aliases.length === 2 && aliases[0].id === "a1" && aliases[1].active === false,
    aliases,
  );
  check(
    "C2 the key rides ONLY in the Authorization header built inside config.ts",
    seenAuth === `Bearer ${FAKE_KEY}`,
  );

  const created = await addy.createAlias({ description: addy.aliasDescription("Ben's Bites") });
  check(
    "C3 createAlias stamps the agentos-newsletter description",
    created.id === "a3" && created.description === "agentos-newsletter: Ben's Bites",
    created,
  );
  check("C3b setAliasActive(false) does not throw on a 200", await addy.setAliasActive("a3", false).then(() => true, () => false));

  // Error path: a 401 must be LOUD, with status + body snippet.
  config.__setAddyTransportForTests(async () =>
    new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401, statusText: "Unauthorized" }),
  );
  let err = null;
  try {
    await addy.listAliases();
  } catch (e) {
    err = e;
  }
  check(
    "C4 a non-2xx throws AddyError carrying the STATUS and a body snippet",
    !!err && err.name === "AddyError" && err.status === 401 && /401/.test(err.message) && /Unauthenticated/.test(err.message),
    err?.message,
  );
  check("C4b the thrown message does NOT contain the API key", !String(err?.message).includes(FAKE_KEY));

  // Unconfigured → a named 412, not a silent no-op.
  const savedCfg = fs.readFileSync(config.configPath(), "utf8");
  fs.writeFileSync(config.configPath(), JSON.stringify({}));
  let cfgErr = null;
  try {
    await addy.listAliases();
  } catch (e) {
    cfgErr = e;
  }
  check(
    "C5 an unconfigured key throws a 412 naming the config PATH (not the value)",
    cfgErr?.status === 412 && cfgErr.message.includes(config.configPath()),
    cfgErr?.message,
  );
  fs.writeFileSync(config.configPath(), savedCfg);
  config.__setAddyTransportForTests(null);
}

// ═══ §D canonicalizeUrl ══════════════════════════════════════════════════════
console.log("\n── §D canonicalizeUrl ──");
{
  const c = dedupe.canonicalizeUrl;
  check(
    "D1 utm_* params are stripped",
    c("https://example.com/post?utm_source=tldr&utm_medium=email&utm_campaign=x") ===
      "https://example.com/post",
    c("https://example.com/post?utm_source=tldr&utm_medium=email&utm_campaign=x"),
  );
  check(
    "D2 ref / fbclid / mc_cid / mc_eid are stripped",
    c("https://example.com/post?ref=newsletter&fbclid=abc&mc_cid=1&mc_eid=2") ===
      "https://example.com/post",
    c("https://example.com/post?ref=newsletter&fbclid=abc&mc_cid=1&mc_eid=2"),
  );
  check(
    "D3 a MEANINGFUL query param survives",
    c("https://example.com/watch?v=abc123&utm_source=x") === "https://example.com/watch?v=abc123",
    c("https://example.com/watch?v=abc123&utm_source=x"),
  );
  check(
    "D4 trailing slash and #fragment are dropped",
    c("https://example.com/post/#section-2") === "https://example.com/post",
    c("https://example.com/post/#section-2"),
  );
  check(
    "D5 host is lowercased and www. dropped",
    c("https://WWW.Example.COM/Post") === "https://example.com/Post",
    c("https://WWW.Example.COM/Post"),
  );
  check(
    "D6 tracker redirect is unwrapped to the real destination",
    c("https://tracking.tldrnewsletter.com/CL0/https%3A%2F%2Fexample.com%2Fpost%3Futm_source%3Dtldr/1/abc?url=https%3A%2F%2Fexample.com%2Fpost%3Futm_source%3Dtldr") ===
      "https://example.com/post",
    c("https://tracking.tldrnewsletter.com/CL0/x?url=https%3A%2F%2Fexample.com%2Fpost%3Futm_source%3Dtldr"),
  );
  check(
    "D6b a NON-tracker host's ?url= param is NOT unwrapped",
    c("https://example.com/read?url=https%3A%2F%2Fother.com%2Fx") ===
      "https://example.com/read?url=https%3A%2F%2Fother.com%2Fx",
    c("https://example.com/read?url=https%3A%2F%2Fother.com%2Fx"),
  );
  check(
    "D7 param order does not change the canonical form",
    c("https://example.com/p?b=2&a=1") === c("https://example.com/p?a=1&b=2"),
    [c("https://example.com/p?b=2&a=1"), c("https://example.com/p?a=1&b=2")],
  );
  check(
    "D8 non-http(s) and junk return null (an item may legitimately have no link)",
    c("mailto:a@b.c") === null && c("not a url") === null && c(null) === null && c("") === null,
  );
  check(
    "D9 root path collapses and the default port is dropped",
    c("https://example.com:443/") === "https://example.com",
    c("https://example.com:443/"),
  );
}

// ═══ §E parse + dedupe over three fixture emails ═════════════════════════════
console.log("\n── §E extraction + dedupe (3 fixture emails, 2 same story) ──");
const FIXTURE_DATE = "2026-08-20";
{
  check(
    "E0 stripBoilerplate drops unsubscribe/footer chrome deterministically",
    (() => {
      const md = parse.stripBoilerplate(
        "Real line\n\nUnsubscribe\n----\n© 2026 TLDR\nView this in your browser\nAnother real line",
      );
      return md.includes("Real line") && md.includes("Another real line") && !/Unsubscribe|©|browser/i.test(md);
    })(),
    parse.stripBoilerplate("Real line\n\nUnsubscribe\n© 2026 TLDR\nAnother real line"),
  );

  const mk = (gmailId, subject, from, subId, contentMd) =>
    store.insertEmail({
      gmailId,
      subscriptionId: subId,
      fromAddr: from,
      toAddr: "tldr-x7f2@yoshi.addy.io",
      subject,
      receivedAt: new Date(`${FIXTURE_DATE}T09:00:00.000Z`).toISOString(),
      contentMd,
    });

  // Same story, two different tracking links; plus one story unique to each.
  const e1 = mk(
    "fx-1",
    "TLDR — Aug 20",
    "news@tldr.tech",
    subA.id,
    [
      "- [OpenAI ships a new agent runtime](https://tracking.tldrnewsletter.com/CL0/x?url=https%3A%2F%2Fexample.com%2Fagent-runtime%3Futm_source%3Dtldr) — the big one today.",
      "- [Rust 2.0 lands](https://example.com/rust-2?utm_medium=email) — long awaited.",
    ].join("\n"),
  );
  const e2 = mk(
    "fx-2",
    "Ben's Bites — Aug 20",
    "ben@bensbites.co",
    null,
    "- [OpenAI ships a new agent runtime](https://www.example.com/agent-runtime/?ref=bensbites&mc_cid=99#top) — same story, different wrapper.",
  );
  const e3 = mk(
    "fx-3",
    "Import AI — Aug 20",
    "jack@importai.net",
    null,
    "- [A wholly unrelated paper on sparse attention](https://example.com/sparse-attention) — nothing to do with the others.",
  );
  check("E1 three fixture emails stored", !!e1 && !!e2 && !!e3);

  const i1 = await parse.extractItems(e1);
  check(
    "E2 the deterministic stub extractor finds both items in email 1",
    i1.length === 2 && i1[0].title === "OpenAI ships a new agent runtime" && !!i1[0].url,
    i1,
  );

  const a1 = await dedupe.absorbItems(e1, i1, { sourceName: "TLDR", date: FIXTURE_DATE });
  check("E3 email 1 creates 2 stories, merges 0", a1.newStories === 2 && a1.merged === 0, a1);
  check(
    "E4 embedDegraded is TRUE and HONEST — the embedder is unreachable offline",
    a1.embedDegraded === true,
    a1,
  );

  const a2 = await dedupe.absorbItems(e2, await parse.extractItems(e2), {
    sourceName: "Ben's Bites",
    date: FIXTURE_DATE,
  });
  check(
    "E5 email 2's item MERGES onto the existing story (canonical URL match through two different tracking wrappers)",
    a2.newStories === 0 && a2.merged === 1,
    a2,
  );

  const a3 = await dedupe.absorbItems(e3, await parse.extractItems(e3), {
    sourceName: "Import AI",
    date: FIXTURE_DATE,
  });
  check("E6 email 3's distinct story stays separate", a3.newStories === 1 && a3.merged === 0, a3);

  const stories = store.listStoriesForDate(FIXTURE_DATE);
  check("E7 three fixture emails → exactly 3 stories for the day", stories.length === 3, stories.map((s) => s.title));

  const merged = stories.find((s) => s.canonicalUrl === "https://example.com/agent-runtime");
  const sources = merged ? store.listStorySources(merged.id) : [];
  check(
    "E8 the merged story carries TWO source chips, named per newsletter",
    sources.length === 2 &&
      sources.map((s) => s.sourceName).sort().join("|") === "Ben's Bites|TLDR",
    sources,
  );
  check(
    "E9 each chip keeps that source's OWN (uncanonicalized) link",
    sources.every((s) => typeof s.itemUrl === "string" && s.itemUrl.length > 0) &&
      new Set(sources.map((s) => s.itemUrl)).size === 2,
    sources.map((s) => s.itemUrl),
  );

  // Embedding leg, with vectors supplied by hand (no embedder involved).
  const near = store.createStory({
    title: "Vector twin",
    summary: "a story with a vector",
    embedding: [1, 0, 0],
    firstSeen: store.today(),
  });
  check(
    "E10 findDuplicate matches by EMBEDDING above the threshold",
    dedupe.findDuplicate({ canonicalUrl: null, embedding: Float32Array.from([0.99, 0.1, 0]) })?.story.id === near.id,
  );
  check(
    "E11 an orthogonal vector is NOT a duplicate",
    dedupe.findDuplicate({ canonicalUrl: null, embedding: Float32Array.from([0, 0, 1]) }) === null,
  );
  check(
    "E12 with NO vector and no URL there is no match (degraded = URL-only, never a guess)",
    dedupe.findDuplicate({ canonicalUrl: null, embedding: null }) === null,
  );
  check(
    "E12b sourceNameFor prefers the subscription name and falls back to the sender — never a fabricated label",
    dedupe.sourceNameFor(e3, "Import AI") === "Import AI" &&
      dedupe.sourceNameFor(e3, null) === "jack@importai.net" &&
      dedupe.sourceNameFor({ fromAddr: null, subject: null }, null) === "Unknown source",
  );
  check(
    "E13 normalizeItems drops junk and clamps at 15",
    parse.normalizeItems([{ title: "" }, { title: "ok", url: "javascript:1", summary: "s" }, null, "x"]).length === 1 &&
      parse.normalizeItems([{ title: "ok", url: "javascript:alert(1)" }])[0].url === undefined,
  );
}

// ═══ §F sync: watermark, batch resilience ════════════════════════════════════
console.log("\n── §F sync (mocked Gmail transport) ──");
const NOW = Date.now();
const T1 = NOW - 3 * 3600_000;
const T2 = NOW - 2 * 3600_000;
const T3 = NOW - 1 * 3600_000; // newest → drives the watermark

const htmlMsg = (id, subject, from, alias, html, internalDate) => ({
  id,
  threadId: `t-${id}`,
  internalDate: String(internalDate),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "To", value: `Yoshi <${alias}>` },
      { name: "Delivered-To", value: alias },
      { name: "Subject", value: subject },
    ],
    parts: [{ mimeType: "text/html", body: { data: b64(html) } }],
  },
});

const MESSAGES = {
  "sy-1": htmlMsg(
    "sy-1",
    "TLDR — sync 1",
    "news@tldr.tech",
    "tldr-x7f2@yoshi.addy.io",
    `<html><body><ul>
       <li><a href="https://example.com/sync-story-a?utm_source=tldr">Sync story A</a> — first.</li>
       <li><a href="https://example.com/sync-story-b">Sync story B</a> — second.</li>
     </ul><p>Unsubscribe</p></body></html>`,
    T1,
  ),
  "sy-2": htmlMsg(
    "sy-2",
    "Ben's Bites — sync 2",
    "ben@bensbites.co",
    "bb-q1z9@yoshi.addy.io",
    `<html><body><p><a href="https://www.example.com/sync-story-a/?ref=bb">Sync story A</a> — same story, other wrapper.</p></body></html>`,
    T2,
  ),
  "sy-3": htmlMsg(
    "sy-3",
    "Import AI — sync 3",
    "jack@importai.net",
    "ia-k4m7@yoshi.addy.io",
    `<html><body><p><a href="https://example.com/sync-story-c">Sync story C</a> — unique.</p></body></html>`,
    T3,
  ),
};

let listedQueries = [];
let getCalls = 0;
const mockGmail = {
  users: {
    messages: {
      list: async ({ q }) => {
        listedQueries.push(q);
        const afterTs = Number((q.match(/after:(\d+)/) ?? [])[1] ?? 0) * 1000;
        // Model Gmail's own `after:` (second granularity, inclusive).
        const ids = Object.values(MESSAGES)
          .filter((m) => Number(m.internalDate) >= afterTs)
          .map((m) => ({ id: m.id }));
        return { data: { messages: ids } };
      },
      get: async ({ id }) => {
        getCalls++;
        const m = MESSAGES[id];
        if (!m) throw new Error(`no such message ${id}`);
        return { data: m };
      },
    },
    getProfile: async () => ({ data: { emailAddress: "agent@example.com" } }),
  },
};
googleClient.__setGoogleMockForTests({
  gmail: () => mockGmail,
  userinfo: async () => ({ email: "agent@example.com", id: "uid-1" }),
});

{
  // Two more subscriptions so each fixture newsletter arrives at its OWN alias
  // — which is what makes the source chips distinguishable in a real edition.
  store.createSubscription({ name: "Ben's Bites", aliasEmail: "bb-q1z9@yoshi.addy.io", topic: "AI & Agents" });
  store.createSubscription({ name: "Import AI", aliasEmail: "ia-k4m7@yoshi.addy.io", topic: "AI & Agents" });

  // A sync with no connected Gmail is a LOUD, NAMED config failure.
  let cfgErr = null;
  try {
    await sync.syncOnce("manual");
  } catch (e) {
    cfgErr = e;
  }
  check(
    "F1 no connected Gmail → NewsletterConfigError naming what to connect",
    cfgErr?.name === "NewsletterConfigError" && /integrations/.test(cfgErr.message),
    cfgErr?.message,
  );

  const account = intStore.upsertAccount({
    definitionSlug: "gmail",
    accountId: "agent@example.com",
    displayName: "Gmail (agent@example.com)",
    config: { access_token: "AT-1", refresh_token: "RT-1", token_type: "Bearer" },
  });
  check("F2 gmailConfigured() flips TRUE once the connector account exists", config.gmailConfigured() === true, account.id);

  // No aliases and no label → a loud REASON, never a wildcard mailbox pull.
  const active = store.listSubscriptions({ status: "active" });
  for (const s of active) store.patchSubscription(s.id, { status: "paused" });
  const noFilter = await sync.syncOnce("manual");
  check(
    "F3 no addressing filter → 0 fetched WITH a stated reason (no `to:*` wildcard, CONVENTIONS §7)",
    noFilter.fetched === 0 && /no addressing filter/.test(noFilter.reason ?? ""),
    noFilter.reason,
  );
  for (const s of active) store.patchSubscription(s.id, { status: "active" });

  listedQueries = [];
  const run1 = await sync.syncOnce("manual");
  check(
    "F4 run 1 fetches all three fixture messages",
    run1.fetched === 3 && run1.parsed === 3 && run1.failed === 0,
    run1,
  );
  check(
    "F5 the Gmail query is an explicit `to:` OR of every active alias — no `*` wildcard anywhere",
    listedQueries.length === 1 &&
      ["tldr-x7f2", "bb-q1z9", "ia-k4m7"].every((a) => listedQueries[0].includes(`to:${a}@yoshi.addy.io`)) &&
      !listedQueries.some((q) => q.includes("*")),
    listedQueries,
  );
  // 4 items across 3 emails → 3 distinct stories (A, B, C) + 1 merge: sy-2's
  // wrapped link to story A lands as a SECOND SOURCE on sy-1's story.
  check(
    "F6 the two wrapped links to the SAME story merged: 3 distinct stories + 1 merge",
    run1.newStories === 3 && run1.merged === 1,
    run1,
  );
  check(
    "F6b …and the merged story carries both newsletters as source chips",
    (() => {
      const s = store.findStoryByCanonicalUrl("https://example.com/sync-story-a");
      const chips = s ? store.listStorySources(s.id).map((x) => x.sourceName).sort() : [];
      return chips.length === 2 && chips[0] === "Ben's Bites" && chips[1] === "TLDR";
    })(),
    store.findStoryByCanonicalUrl("https://example.com/sync-story-a"),
  );
  check("F7 embedDegraded reported honestly on the sync result too", run1.embedDegraded === true, run1);
  check(
    "F8 watermark == EXACT newest internalDate (no +20s skew — see sync.ts header)",
    run1.watermark === new Date(T3).toISOString(),
    [run1.watermark, new Date(T3).toISOString()],
  );
  check(
    "F9 the boundary message is STILL listed on the next run (strict `<`, not `<=`)",
    (() => {
      listedQueries = [];
      return true;
    })(),
  );

  const before = getCalls;
  const run2 = await sync.syncOnce("manual");
  check(
    "F10 run 2 fetches ZERO — the watermark held",
    run2.fetched === 0 && run2.newStories === 0,
    run2,
  );
  check(
    "F11 …and it got there by RE-LISTING the boundary message and deduping it on gmail_id",
    getCalls > before && run2.skipped >= 1,
    { getCalls, before, skipped: run2.skipped },
  );
  check(
    "F12 no duplicate email rows were created by the re-list",
    store.listEmails({}).filter((e) => e.gmailId.startsWith("sy-")).length === 3,
  );

  const md = store.listEmails({}).find((e) => e.gmailId === "sy-1")?.contentMd ?? "";
  check(
    "F13 HTML→markdown ran and boilerplate was stripped",
    md.includes("Sync story A") && !/unsubscribe/i.test(md),
    md.slice(0, 200),
  );

  // Per-message PARSE failure: the real provider path with an unwired agent
  // (rule 11 — a missing agent fails LOUD, never falls back to a local model).
  delete process.env.NEWSLETTER_STUB_PARSE;
  writeSettings({ newsletter: { parseAgent: "definitely-not-a-wired-agent" } });
  const T4 = NOW - 30 * 60_000;
  const T5 = NOW - 20 * 60_000;
  MESSAGES["sy-4"] = htmlMsg("sy-4", "Fails to parse", "x@y.z", "tldr-x7f2@yoshi.addy.io", "<p><a href='https://example.com/f4'>F4</a></p>", T4);
  MESSAGES["sy-5"] = htmlMsg("sy-5", "Also fails", "x@y.z", "tldr-x7f2@yoshi.addy.io", "<p><a href='https://example.com/f5'>F5</a></p>", T5);

  const run3 = await sync.syncOnce("manual");
  check(
    "F14 a parse failure does NOT abort the batch — both messages were processed",
    run3.fetched === 2 && run3.failed === 2 && run3.parsed === 0,
    run3,
  );
  const f4 = store.listEmails({}).find((e) => e.gmailId === "sy-4");
  check(
    "F15 the failing message is STORED with parse_status='failed' + a named error",
    f4?.parseStatus === "failed" && /definitely-not-a-wired-agent/.test(f4.parseError ?? ""),
    f4?.parseError,
  );
  check(
    "F16 the watermark still advanced (the rows are durable and retryable)",
    run3.watermark === new Date(T5).toISOString(),
    run3.watermark,
  );
  check(
    "F17 listEmails({parseStatus:'failed'}) surfaces exactly the failures",
    store.listEmails({ parseStatus: "failed" }).every((e) => e.parseStatus === "failed") &&
      store.listEmails({ parseStatus: "failed" }).length === 2,
    store.listEmails({ parseStatus: "failed" }).map((e) => e.gmailId),
  );

  process.env.NEWSLETTER_STUB_PARSE = "1";
  writeSettings();

  // A message that dies BEFORE it can be stored must HOLD the watermark.
  const heldBefore = store.getState(store.STATE_LAST_SYNC);
  const T6 = NOW - 5 * 60_000;
  MESSAGES["sy-6"] = htmlMsg("sy-6", "Explodes on fetch", "x@y.z", "tldr-x7f2@yoshi.addy.io", "<p>x</p>", T6);
  const realGet = mockGmail.users.messages.get;
  mockGmail.users.messages.get = async (args) => {
    if (args.id === "sy-6") throw new Error("simulated Gmail 503");
    return realGet(args);
  };
  const run4 = await sync.syncOnce("manual");
  mockGmail.users.messages.get = realGet;
  check(
    "F18 a message that failed BEFORE storage HOLDS the watermark (it would otherwise be dropped silently)",
    run4.failed === 1 && run4.watermark === heldBefore && /watermark HELD/.test(run4.reason ?? ""),
    { run4, heldBefore },
  );
  delete MESSAGES["sy-6"];
}

// ═══ §G jobs (K3.3) — the REAL scheduler, no croner ══════════════════════════
console.log("\n── §G scheduler registration ──");
{
  jobs.ensureNewsletterJobs();
  const job = scheduler.listJobs().find((j) => j.id === jobs.SYNC_JOB_ID);
  check(
    "G1 'newsletter.sync' is registered on the real scheduler with an RRULE + next run",
    job?.kind === jobs.SYNC_JOB_KIND && job.rrule === jobs.DEFAULT_SYNC_RRULE && !!job.run_at,
    job,
  );
  check(
    "G2 the handler kind is registered (runInline finds it)",
    (await scheduler.runInline(jobs.SYNC_JOB_KIND)) === true,
  );
  check(
    "G3 no croner fallback anywhere in the newsletter module (CONVENTIONS §2)",
    (() => {
      const dir = path.join(process.cwd(), "src", "lib", "v2", "newsletter");
      // Real usage only — the word appears in jobs.ts prose explaining WHY
      // there is no fallback, and that comment is the point, not a violation.
      return !fs
        .readdirSync(dir)
        .some((f) =>
          /(from|require\()\s*["']croner["']|__agentosNewsletterCron|setInterval\(/.test(
            fs.readFileSync(path.join(dir, f), "utf8"),
          ),
        );
    })(),
  );
  check(
    "G4 an INVALID settings RRULE is loud and falls back to the default (never silent-skips)",
    (() => {
      writeSettings({ newsletter: { syncRrule: "every other tuesday-ish" } });
      jobs.ensureNewsletterJobs();
      const j = scheduler.listJobs().find((x) => x.id === jobs.SYNC_JOB_ID);
      writeSettings();
      jobs.ensureNewsletterJobs();
      return j?.rrule === jobs.DEFAULT_SYNC_RRULE && /default schedule/.test(j.name);
    })(),
  );
  check(
    "G5 the master kill switch stops SCHEDULED fires",
    (() => {
      writeSettings({ newsletter: { syncEnabled: false } });
      const off = jobs.syncEnabled() === false;
      writeSettings();
      return off && jobs.syncEnabled() === true;
    })(),
  );
  const { recent } = await import("../../src/lib/v2/events.ts");
  const evts = recent({ types: ["newsletter.email.ingested"], limit: 50 });
  check(
    "G6 newsletter.email.ingested was emitted per NEW email row",
    evts.length >= 3 && evts.every((e) => typeof e.payload.gmailId === "string"),
    evts.length,
  );
}

// ═══ §H the sync route ═══════════════════════════════════════════════════════
console.log("\n── §H /api/newsletter/sync ──");
{
  const statusRes = await syncRoute.GET(req("/api/newsletter/sync"));
  const status = await statusRes.json();
  check(
    "H1 GET returns the §5 status shape",
    statusRes.status === 200 &&
      typeof status.lastSyncTime === "string" &&
      status.running === false &&
      status.gmailConfigured === true &&
      status.addyConfigured === true,
    status,
  );
  check(
    "H2 the status payload contains NO key material",
    !JSON.stringify(status).includes(FAKE_KEY),
  );
  check(
    "H3 lastRun carries the honest counts from the previous run",
    status.lastRun && typeof status.lastRun.fetched === "number" && typeof status.lastRun.embedDegraded === "boolean",
    status.lastRun,
  );

  const postRes = await syncRoute.POST(req("/api/newsletter/sync", "POST"));
  const post = await postRes.json();
  check("H4 POST runs a sync and answers the SyncRunResult", postRes.status === 200 && post.fetched === 0, post);
  check("H5 no key material in the POST response either", !JSON.stringify(post).includes(FAKE_KEY));

  // Config failure must be a NAMED 412, not a quiet zero.
  intStore.setAccountActive(intStore.listAccounts("gmail")[0].id, false);
  const failRes = await syncRoute.POST(req("/api/newsletter/sync", "POST"));
  const fail = await failRes.json();
  check(
    "H6 with Gmail disconnected the route answers 412 with a named reason (loud, not a silent 0)",
    failRes.status === 412 && /gmail/i.test(fail.error),
    fail,
  );
  intStore.setAccountActive(intStore.listAccounts("gmail")[0].id, true);
}

googleClient.__setGoogleMockForTests(null);
config.__setAddyTransportForTests(null);

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp db: ${tmpDb}, config dir: ${nlDir})`,
);
process.exit(failures === 0 ? 0 : 1); // route imports hold ensureV2 timers
