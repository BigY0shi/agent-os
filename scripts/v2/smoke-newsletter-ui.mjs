// SPEC-F chunk 4 — smoke-newsletter-ui: the Newsletter edition builder (K4.1),
// the subscription routes + manager UI (K2.1), the /newsletter page (K4.2) and
// the gear + widget (K4.3).
//
// §A-§F are STATIC contract checks (house *-ui pattern, smoke-anynotes-ui.mjs):
// files + 'use client'; sidebar NAV *and* the Workspace section Set; the gear's
// settings keys; reuse-not-fork greps over the shared atoms; components
// consuming the REAL backend types instead of redeclaring them; no secret or
// env references anywhere in client code.
//
// §G is DYNAMIC and fully OFFLINE — the chunk-1/3 env recipe (temp db, temp
// settings, temp newsletter config dir, a dead OLLAMA_URL and BOTH
// memory.provider and embedProvider pinned to 'ollama-local', because the
// default 'ollama-cloud' provider IGNORES OLLAMA_URL and dials
// https://ollama.com). No model runs: the section classifier goes through its
// documented test seam, and addy through its stub transport.
// Run: npx tsx scripts/v2/smoke-newsletter-ui.mjs

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src import ──────────────────────────────────────────
const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-newsletter-ui-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-nl-ui-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
const nlDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-nl-ui-config-"));
process.env.AGENTIC_OS_NEWSLETTER_DIR = nlDir; // NEVER Yoshi's real config
// Isolation for the SECOND transport (migration 063). Without this,
// agentmailConfigured() reads the REAL ~/.agentic-os/agentmail/config.json
// and the sync route falls back to a LIVE inbox with a real key.
process.env.AGENTIC_OS_AGENTMAIL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-am-iso-"));
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may call out
process.env.NEWSLETTER_STUB_PARSE = "1";

const SECTIONS = ["AI & Agents", "Dev & Tools", "Business", "Security", "Everything Else"];
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" },
    capability: { browserEnabled: false },
    tasks: { timezone: "America/Chicago" },
    browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
    newsletter: { sections: SECTIONS, editionTime: "06:30" },
  }),
);

/** The fake addy key. It must NEVER appear in a route payload or an error. */
const FIXTURE_KEY = "addy-fixture-key-NEVER-LEAK-9f3c";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(
    `${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 260)}` : ""}`,
  );
  if (!cond) failures++;
};

// ── §A files + 'use client' ─────────────────────────────────────────────────
console.log("\n§A files");
const clientComponents = [
  "src/components/v2/newsletter/NewsletterView.tsx",
  "src/components/v2/newsletter/EditionReader.tsx",
  "src/components/v2/newsletter/SubscriptionManager.tsx",
  "src/components/v2/newsletter/NewsletterSettings.tsx",
];
for (const f of clientComponents) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
check(
  "shared.ts exists and is client-safe (no node imports, no server module import)",
  exists("src/components/v2/newsletter/shared.ts") &&
    !/from "node:/.test(read("src/components/v2/newsletter/shared.ts")) &&
    !/newsletter\/(store|sync|parse|config|addy|edition|jobs)/.test(
      read("src/components/v2/newsletter/shared.ts"),
    ),
);
check("edition builder exists (K4.1)", exists("src/lib/v2/newsletter/edition.ts"));
check("subscriptions routes exist (K2.1)",
  exists("src/app/api/newsletter/subscriptions/route.ts") &&
    exists("src/app/api/newsletter/subscriptions/[id]/route.ts"));
check("edition route exists (K4.1)", exists("src/app/api/newsletter/edition/route.ts"));

// ── §B page wiring ──────────────────────────────────────────────────────────
console.log("\n§B page wiring");
{
  check("src/app/newsletter/page.tsx exists", exists("src/app/newsletter/page.tsx"));
  const page = read("src/app/newsletter/page.tsx");
  check("/newsletter renders NewsletterView", page.includes("NewsletterView"));
  check("/newsletter wraps the view in Suspense (useSearchParams CSR bailout)", page.includes("Suspense"));
  check("page.tsx is a SERVER component (no 'use client')", !/^"use client";/.test(page));
}

// ── §C sidebar: NAV *and* the Workspace Set ─────────────────────────────────
console.log("\n§C sidebar");
{
  const sidebar = read("src/components/Sidebar.tsx");
  check('Sidebar NAV carries href "/newsletter"', /href: "\/newsletter"/.test(sidebar));
  const ws = sidebar.match(/const WORKSPACE_ROUTES = new Set\(\[([^\]]*)\]\)/);
  check("WORKSPACE_ROUTES contains /newsletter (else it silently lands in 'Self')",
    !!ws && ws[1].includes('"/newsletter"'), ws?.[1]);
  check("/newsletter is NOT in any other section Set",
    !new RegExp('const (ORCHESTRATION|AGENT)_ROUTES = new Set\\(\\[[^\\]]*"/newsletter"').test(sidebar));
  check("/anynotes is still in WORKSPACE_ROUTES (chunk 2 not regressed)",
    !!ws && ws[1].includes('"/anynotes"'));
}

// ── §D the view: tabs, polling, params, actions, status strip ───────────────
console.log("\n§D NewsletterView (K4.2)");
{
  const v = read("src/components/v2/newsletter/NewsletterView.tsx");
  check("three tabs: today / archive / subscriptions",
    /\["today", "archive", "subscriptions"\]/.test(v));
  check("polls with usePollWhileVisible", v.includes("usePollWhileVisible") && /usePollWhileVisible\(refresh, \d+/.test(v));
  check("owns ?tab= and ?date= (the archive deep link)",
    v.includes('params.get("tab")') && v.includes('params.get("date")'));
  check("reads all three newsletter endpoints",
    v.includes("/api/newsletter/edition") && v.includes("/api/newsletter/subscriptions") &&
      v.includes("/api/newsletter/sync"));
  check("status strip renders the CONFIGURED BOOLEANS, plus the config PATH as a hint",
    v.includes("addyConfigured") && v.includes("gmailConfigured") && v.includes("configPath"));
  check("un-connected Gmail points at /integrations (CONVENTIONS §7 — one Gmail stack)",
    v.includes("/integrations") && !/newsletter\/gmail\/(auth|callback)/.test(v));
  check("Build (idempotent) and Force rebuild are SEPARATE actions",
    /rebuild\(false\)/.test(v) && /rebuild\(true\)/.test(v) && v.includes("force"));
  check("a sync/build failure is surfaced verbatim, never a silent no-op",
    v.includes("j.error ??") && v.includes("setNotice"));
  check("embedDegraded is reported honestly in the sync notice", v.includes("embedDegraded"));
  check("carries the rule-16 gear (ConfigMenu + NewsletterSettings)",
    v.includes("ConfigMenu") && v.includes("NewsletterSettings"));
  check("registers Jarvis page context (C5 convention)", v.includes("useJarvisPageContext"));
}

// ── §E reader + manager: chips, nullable urls, honest blanks ────────────────
console.log("\n§E EditionReader + SubscriptionManager");
{
  const r = read("src/components/v2/newsletter/EditionReader.tsx");
  check("masthead carries the date, built-at and the stats line", r.includes("The Agent OS Daily") &&
    r.includes("edition.date") && r.includes("builtAt") && r.includes("duplicatesMerged"));
  check("sections render as newspaper columns (2-col ≥ lg)", /lg:columns-2/.test(r));
  check("a story with NO url renders as text, not a dead anchor",
    /story\.url \?/.test(r) && r.includes("</span>"));
  check("each source is a CHIP linking to that source's OWN url",
    r.includes("story.sources.map") && r.includes("source.url") && r.includes("source.name"));
  check("a FALLBACK-sectioned edition says so, loudly, in the reader",
    r.includes('classification === "fallback"') && r.includes("#f87171"));

  const m = read("src/components/v2/newsletter/SubscriptionManager.tsx");
  check("subscribe flow: create alias → show it → copy → open signup",
    m.includes("/api/newsletter/subscriptions") && m.includes("clipboard.writeText") &&
      m.includes("signupUrl"));
  check("an addy failure is rendered VERBATIM (a missing alias is a black hole)",
    m.includes("j.error ??"));
  check("'last seen' is '—' when no mail has arrived (never fabricated)",
    m.includes("lastEmailAt[s.id] ?") && m.includes('"—"'));
  check("status toggle PATCHes status (which also toggles the addy alias server-side)",
    /patch\(s\.id, \{ status:/.test(m));
  check("no alias VALUE is ever composed client-side — it comes off the row",
    m.includes("s.aliasEmail") && !/addy\.io\/api/.test(m));
}

// ── §F reuse-not-fork, gear keys, widget, hygiene ───────────────────────────
console.log("\n§F reuse, gear, widget, hygiene");
{
  const all = clientComponents.map((f) => [f, read(f)]);
  const dirFiles = fs
    .readdirSync(path.join(root, "src/components/v2/newsletter"))
    .map((f) => `src/components/v2/newsletter/${f}`);
  const forked = dirFiles.filter((f) =>
    /export (function|const) (SlideOver|EmptyState|StatusChip|fmtAgo|fmtDate|inputStyle|panelStyle)\b/.test(read(f)),
  );
  check("no forked copy of the shared atoms under v2/newsletter", forked.length === 0, forked);
  check("view reuses the shared integrations atoms (EmptyState/StatusChip/fmtAgo/panelStyle)",
    read("src/components/v2/newsletter/NewsletterView.tsx").includes('from "../integrations/shared"'));
  check("gear reuses ConfigMenu primitives + AgentPicker (no bespoke picker)",
    read("src/components/v2/newsletter/NewsletterSettings.tsx").includes('from "@/components/ConfigMenu"') &&
      read("src/components/v2/newsletter/NewsletterSettings.tsx").includes('from "@/components/AgentPicker"'));

  const redeclared = all.filter(([, src]) =>
    /^\s*(export\s+)?(interface|type)\s+(Subscription|Story|EditionDoc|SyncStatus)\s*[={]/m.test(src),
  );
  check("no component redeclares the backend shapes (types.ts is the contract)",
    redeclared.length === 0, redeclared.map(([f]) => f));
  check("view imports its types from the client-safe types module",
    read("src/components/v2/newsletter/NewsletterView.tsx").includes('from "@/lib/v2/newsletter/types"'));
  const serverImporters = all
    .concat([["src/components/v2/newsletter/shared.ts", read("src/components/v2/newsletter/shared.ts")]])
    .filter(([, src]) => /@\/lib\/v2\/newsletter\/(store|sync|parse|config|addy|edition|jobs)/.test(src));
  check("no client component imports a server-only newsletter module",
    serverImporters.length === 0, serverImporters.map(([f]) => f));

  // Rule 16 — EVERY settings.newsletter key has a gear surface.
  const gear = read("src/components/v2/newsletter/NewsletterSettings.tsx");
  const KEYS = [
    "syncEnabled", "syncRrule", "editionEnabled", "editionTime", "sections",
    "dedupeThreshold", "dedupeWindowDays", "trackerHosts", "parseAgent",
    "lookbackDays", "addyDomain", "gmailAccountId", "gmailLabel",
  ];
  for (const key of KEYS) check(`gear exposes settings.newsletter.${key}`, gear.includes(key));
  const st = read("src/lib/settings.ts");
  const declared = KEYS.filter((k) => new RegExp(`\\b${k}\\?:`).test(st));
  check("settings.ts declares every key the gear edits", declared.length === KEYS.length,
    KEYS.filter((k) => !declared.includes(k)));
  check("settings.ts ships newsletter defaults incl. the new editionEnabled",
    st.includes("editionEnabled: true") && st.includes('editionTime: "06:30"'));

  // Credentials render as configured-or-not, NEVER as a value.
  check("gear renders addy/Gmail as configured ✓ / not configured with a path hint",
    gear.includes("configured ✓") && gear.includes("not configured") && gear.includes("configPath"));
  check("gear has NO input for the addy key and no key getter anywhere",
    !/apiKey/.test(gear) && !/addyKey|api_key/i.test(gear));
  const cfg = read("src/lib/v2/newsletter/config.ts");
  check("config.ts still exports no key getter (structural, not disciplinary)",
    !/export function addyKey|export function apiKey|export const addyKey/.test(cfg));

  // Widget — the registry slug stays SINGLE (CONVENTIONS §8).
  const registry = read("src/lib/v2/widgets/registry.ts");
  const slugHits = registry.match(/slug: "newsletter-edition"/g) ?? [];
  check("newsletter-edition registered exactly ONCE (CONVENTIONS §8)", slugHits.length === 1, slugHits.length);
  check("registry description no longer says 'Not built yet'",
    !/newsletter-edition[\s\S]{0,400}Not built yet/.test(registry));
  const wdata = read("src/lib/v2/widgets/data.ts");
  check("newsletter-edition data fn reads the real edition store (placeholder filled)",
    wdata.includes("newsletterEditionData") && wdata.includes("listEditionDates") &&
      !/newsletterEditionData[\s\S]{0,300}workstream not built/.test(wdata));
  const wtypes = read("src/lib/v2/widgets/types.ts");
  check("NewsletterEditionPayload url is NULLABLE (a real story can have no link)",
    /url: string \| null/.test(wtypes.slice(wtypes.indexOf("NewsletterEditionPayload"))));
  const wcomp = read("src/components/v2/home/widgetComponents.tsx");
  check("widget keys stories on id, not on the nullable url",
    wcomp.includes("key={story.id}") && !/key=\{story\.url\}/.test(wcomp));
  check("smoke-widgets §H stub check was updated in the same move (chunk-2 delta 3 precedent)",
    !/workstream not built[\s\S]{0,120}SPEC-F K fills it/.test(read("scripts/v2/smoke-widgets.mjs")));

  // Secrets / env in client code.
  const offenders = all.filter(([, src]) =>
    /OLLAMA_API_KEY|AGENTOS_PASSWORD|secrets\.json|apiKey|process\.env\.\w*(KEY|TOKEN|SECRET|PASSWORD)/.test(src),
  );
  check("no secret/env references in client components", offenders.length === 0, offenders.map(([f]) => f));
}

// ── §G dynamic, offline: builder, routes, widget ────────────────────────────
console.log("\n§G edition builder + routes + widget (offline)");

const { NextRequest } = await import("next/server.js");
const { ensureDb } = await import("../../src/lib/v2/db.ts");
const store = await import("../../src/lib/v2/newsletter/store.ts");
const config = await import("../../src/lib/v2/newsletter/config.ts");
const dedupe = await import("../../src/lib/v2/newsletter/dedupe.ts");
const edition = await import("../../src/lib/v2/newsletter/edition.ts");
const jobs = await import("../../src/lib/v2/newsletter/jobs.ts");
const scheduler = await import("../../src/lib/v2/scheduler.ts");
const events = await import("../../src/lib/v2/events.ts");
const { getWidgetData } = await import("../../src/lib/v2/widgets/data.ts");
const subsRoute = await import("../../src/app/api/newsletter/subscriptions/route.ts");
const subIdRoute = await import("../../src/app/api/newsletter/subscriptions/[id]/route.ts");
const editionRoute = await import("../../src/app/api/newsletter/edition/route.ts");

ensureDb();

const req = (url, method = "GET", body) =>
  new NextRequest(`http://127.0.0.1:3737${url}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const TODAY = store.today();

// G0 — the widget BEFORE any edition exists.
{
  const data = await getWidgetData("newsletter-edition", {});
  check("widget with no edition row → honest {available:false} naming the fix",
    data.available === false && /no edition built yet/i.test(data.reason) && data.reason.includes("/newsletter"),
    data);
}

// G1 — subscriptions GET with an EMPTY config dir.
{
  const res = await subsRoute.GET();
  const j = await res.json();
  check("GET subscriptions → addyConfigured:false on an empty config dir",
    j.addyConfigured === false && Array.isArray(j.subscriptions) && j.subscriptions.length === 0, j);
  check("GET subscriptions exposes the config PATH (a hint), never a value",
    typeof j.configPath === "string" && j.configPath.endsWith("config.json") &&
      !JSON.stringify(j).includes(FIXTURE_KEY), j.configPath);
}

// G2 — addy stub transport; POST creates the alias THEN the row.
const addyCalls = [];
let addyResponder = null;
config.__setAddyTransportForTests(async (url, init) => {
  addyCalls.push({
    url,
    method: init.method,
    body: init.body ? JSON.parse(init.body) : null,
    // Proof the key rides the header config.ts builds, and only there.
    auth: init.headers?.authorization ?? "",
  });
  return addyResponder(url, init);
});
fs.writeFileSync(
  path.join(nlDir, "config.json"),
  JSON.stringify({ addyio: { apiKey: FIXTURE_KEY, domain: "smoke.addy.io" } }),
);

let aliasSeq = 0;
const okAlias = () => {
  aliasSeq++;
  return new Response(
    JSON.stringify({
      data: {
        id: `alias-${aliasSeq}`,
        email: `abc${aliasSeq}@smoke.addy.io`,
        description: `agentos-newsletter: seq${aliasSeq}`,
        active: true,
        domain: "smoke.addy.io",
        created_at: "2026-08-28T00:00:00.000Z",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

addyResponder = () => okAlias();
let subA;
let subB;
{
  const res = await subsRoute.POST(
    req("/api/newsletter/subscriptions", "POST", { name: "The Bugle", topic: "Security", cadence: "daily" }),
  );
  const j = await res.json();
  subA = j.subscription;
  check("POST subscriptions → 200 with a persisted row carrying the created alias",
    res.status === 200 && !!subA?.id && subA.aliasEmail === "abc1@smoke.addy.io" && subA.aliasId === "alias-1",
    j);
  check("the alias was created with the agentos-newsletter description",
    addyCalls[0]?.method === "POST" && addyCalls[0]?.url.endsWith("/aliases") &&
      addyCalls[0]?.body?.description === "agentos-newsletter: The Bugle", addyCalls[0]);
  check("the key rides ONLY the Authorization header config.ts builds",
    addyCalls[0]?.auth === `Bearer ${FIXTURE_KEY}` && !JSON.stringify(j).includes(FIXTURE_KEY));

  const res2 = await subsRoute.POST(
    req("/api/newsletter/subscriptions", "POST", { name: "The Wire", topic: "Gardening" }),
  );
  subB = (await res2.json()).subscription;
  check("a second subscription gets its own alias", subB?.aliasEmail === "abc2@smoke.addy.io", subB);
}
{
  const before = store.listSubscriptions().length;
  addyResponder = () =>
    new Response('{"message":"Unauthenticated."}', { status: 401, headers: { "content-type": "application/json" } });
  const res = await subsRoute.POST(req("/api/newsletter/subscriptions", "POST", { name: "Dead Letter" }));
  const j = await res.json();
  check("an addy failure is a LOUD 502 carrying the status + body snippet",
    res.status === 502 && /addy\.io: 401/.test(j.error ?? "") && /Unauthenticated/.test(j.error ?? ""), j);
  check("the error never echoes the key", !JSON.stringify(j).includes(FIXTURE_KEY));
  check("NO row is persisted when the alias could not be created",
    store.listSubscriptions().length === before, store.listSubscriptions().length);
  addyResponder = () => okAlias();
}
{
  const res = await subsRoute.POST(req("/api/newsletter/subscriptions", "POST", { name: "  " }));
  check("POST without a name → 400", res.status === 400);
  const bad = await subsRoute.POST(
    req("/api/newsletter/subscriptions", "POST", { name: "X", signupUrl: "javascript:alert(1)" }),
  );
  check("POST with a non-http signupUrl → 400", bad.status === 400);
}

// G3 — seed the story graph through the REAL absorb path (URL dedupe, offline).
let emails;
{
  const mk = (gmailId, subscriptionId, from, subject) =>
    store.insertEmail({
      gmailId,
      subscriptionId,
      fromAddr: from,
      toAddr: subscriptionId === subA.id ? subA.aliasEmail : subB?.aliasEmail ?? null,
      subject,
      receivedAt: new Date().toISOString(),
      contentMd: "seeded",
    });
  const e1 = mk("g-1", subA.id, "hi@bugle.test", "Bugle #1");
  const e2 = mk("g-2", subB.id, "hi@wire.test", "Wire #1");
  const e3 = mk("g-3", null, "digest@nowhere.test", "Orphan digest");
  const e4 = mk("g-4", subB.id, "hi@wire.test", "Wire #2");
  emails = [e1, e2, e3, e4];

  const a1 = await dedupe.absorbItems(
    e1,
    [
      { title: "Kernel flaw patched", url: "https://ex.test/kernel?utm_source=bugle", summary: "A big one." },
      { title: "A story with no link at all", summary: "Some newsletters just do this." },
    ],
    { sourceName: "The Bugle", date: TODAY },
  );
  const a2 = await dedupe.absorbItems(
    e2,
    [{ title: "That kernel flaw, rewritten", url: "https://www.ex.test/kernel/?utm_medium=wire#top", summary: "Same story." }],
    { sourceName: "The Wire", date: TODAY },
  );
  const a3 = await dedupe.absorbItems(
    e3,
    [{ title: "Orphan story", url: "https://other.test/x", summary: "From an unmatched sender." }],
    { sourceName: "digest@nowhere.test", date: TODAY },
  );
  const a4 = await dedupe.absorbItems(
    e4,
    [{ title: "Tomatoes are up", url: "https://garden.test/tomatoes", summary: "Off topic on purpose." }],
    { sourceName: "The Wire", date: TODAY },
  );

  check("offline embedder → embedDegraded reported honestly, dedupe still ran on URLs",
    a1.embedDegraded === true && a2.embedDegraded === true);
  check("the second newsletter's rewritten headline MERGED on the canonical url",
    a2.newStories === 0 && a2.merged === 1, a2);
  check("four emails produced 4 stories (1 merge)",
    a1.newStories + a2.newStories + a3.newStories + a4.newStories === 4 &&
      store.listStoriesForDate(TODAY).length === 4,
    store.listStoriesForDate(TODAY).length);
}

// G4 — build with the classifier seam (no model spawn).
const bySection = (doc, topic) => doc.sections.find((s) => s.topic === topic);
const findStory = (doc, needle) => {
  for (const s of doc.sections) {
    const hit = s.stories.find((st) => st.title.includes(needle));
    if (hit) return { section: s.topic, story: hit };
  }
  return null;
};

let firstBuiltAt;
{
  const built = [];
  const off = events.on("newsletter.edition.built", (e) => built.push(e.payload));
  edition.__setSectionClassifierForTests(async ({ stories, sections }) => {
    check("the classifier is handed the configured sections verbatim",
      JSON.stringify(sections) === JSON.stringify(SECTIONS), sections);
    const map = {};
    for (const s of stories) {
      map[s.id] = /kernel/i.test(s.title) ? "Security" : "Dev & Tools";
    }
    return map;
  });
  const res = await edition.buildEdition(TODAY);
  off();
  firstBuiltAt = res.edition.builtAt;

  check("classification === 'model' when the agent answered", res.classification === "model" && res.reused === false, res.classification);
  check("stories land in the sections the model named",
    !!bySection(res.edition, "Security") && !!bySection(res.edition, "Dev & Tools"), res.edition.sections.map((s) => s.topic));
  check("empty sections are omitted, and the order follows settings",
    res.edition.sections.map((s) => s.topic).join("|") === "Dev & Tools|Security",
    res.edition.sections.map((s) => s.topic));
  check("stats are COUNTED, never estimated (4 stories, 4 emails, 1 merged)",
    res.edition.stats.stories === 4 && res.edition.stats.emails === 4 &&
      res.edition.stats.duplicatesMerged === 1, res.edition.stats);
  check("newsletter.edition.built emitted with {date, stories}",
    built.length === 1 && built[0].date === TODAY && built[0].stories === 4, built);
  check("lastEditionDate state advanced", store.getState("lastEditionDate") === TODAY);
}

// G5 — the merged story renders TWO source chips, each keeping its own link.
{
  const doc = store.getEdition(TODAY).content;
  const hit = findStory(doc, "Kernel flaw patched");
  check("the merged story appears ONCE", hit !== null &&
    doc.sections.reduce((n, s) => n + s.stories.filter((st) => /kernel/i.test(st.title)).length, 0) === 1);
  check("it carries TWO source chips, named for their subscriptions",
    hit?.story.sources.length === 2 &&
      hit.story.sources.map((s) => s.name).sort().join("|") === "The Bugle|The Wire",
    hit?.story.sources);
  check("each chip keeps its OWN (uncanonicalized) link",
    hit?.story.sources.every((s) => typeof s.url === "string" && s.url.includes("utm_")) &&
      new Set(hit.story.sources.map((s) => s.url)).size === 2,
    hit?.story.sources.map((s) => s.url));
  const noLink = findStory(doc, "no link at all");
  check("a story with no link has NO url field (never an invented one)",
    !!noLink && noLink.story.url === undefined, noLink?.story);
}

// G6 — idempotency: a second build without force returns the STORED document.
{
  let classifierCalls = 0;
  edition.__setSectionClassifierForTests(async () => {
    classifierCalls++;
    return {};
  });
  const again = await edition.buildEdition(TODAY);
  check("second build without force → reused:true with the SAME builtAt",
    again.reused === true && again.classification === "reused" && again.edition.builtAt === firstBuiltAt,
    { reused: again.reused, builtAt: again.edition.builtAt, firstBuiltAt });
  check("the idempotency guard short-circuits BEFORE the model call", classifierCalls === 0, classifierCalls);
}

// G7 — force rebuild, and the LOUD fallback ladder when the model call fails.
{
  const errs = [];
  const realError = console.error;
  console.error = (...args) => errs.push(args.map(String).join(" "));
  edition.__setSectionClassifierForTests(async () => {
    throw new Error("agent 'claude' is not wired in this environment");
  });
  const res = await edition.buildEdition(TODAY, { force: true });
  console.error = realError;

  check("force rebuild produces a NEW builtAt", res.reused === false && res.edition.builtAt !== firstBuiltAt);
  check("a failed classification is classification:'fallback' with the reason attached",
    res.classification === "fallback" && /not wired/.test(res.classificationError ?? ""), res.classificationError);
  check("the failure is LOUD (console.error names the fallback and the reason)",
    errs.some((e) => /classification FAILED/i.test(e) && /Everything Else/.test(e) && /not wired/.test(e)),
    errs.slice(0, 2));

  // Rung 2: the subscription's own topic, when it matches a configured section.
  const kernel = findStory(res.edition, "Kernel flaw patched");
  check("fallback rung 2: a story falls back to its subscription's topic ('Security')",
    kernel?.section === "Security", kernel?.section);
  // Rung 3: a topic that is NOT a configured section, and an unmatched sender.
  const tomatoes = findStory(res.edition, "Tomatoes");
  const orphan = findStory(res.edition, "Orphan story");
  check("fallback rung 3: an unknown topic ('Gardening') lands in Everything Else",
    tomatoes?.section === "Everything Else", tomatoes?.section);
  check("fallback rung 3: a story from an unmatched sender lands in Everything Else",
    orphan?.section === "Everything Else", orphan?.section);
  check("a fallback edition still publishes every story — degraded, never lossy",
    res.edition.stats.stories === 4 &&
      res.edition.sections.reduce((n, s) => n + s.stories.length, 0) === 4, res.edition.stats);
  check("Everything Else is LAST in the section order",
    res.edition.sections.at(-1)?.topic === "Everything Else",
    res.edition.sections.map((s) => s.topic));
}

// G8 — the edition routes.
{
  const res = await editionRoute.GET(req("/api/newsletter/edition"));
  const j = await res.json();
  check("GET edition (no ?date) serves the LATEST edition + the archive index",
    j.edition?.date === TODAY && Array.isArray(j.dates) && j.dates[0] === TODAY, j.dates);
  const bad = await editionRoute.GET(req("/api/newsletter/edition?date=not-a-date"));
  check("GET edition with a malformed date → 400 (never a query)", bad.status === 400);
  const missing = await (await editionRoute.GET(req("/api/newsletter/edition?date=1999-01-01"))).json();
  check("GET edition for a date with none → edition:null, not a fabricated one", missing.edition === null);

  edition.__setSectionClassifierForTests(async () => ({}));
  const post = await editionRoute.POST(req("/api/newsletter/edition", "POST", {}));
  const pj = await post.json();
  check("POST edition WITHOUT force returns the existing edition (reused:true)",
    post.status === 200 && pj.reused === true && pj.edition.date === TODAY, {
      reused: pj.reused,
    });
  const badPost = await editionRoute.POST(req("/api/newsletter/edition", "POST", { date: "2026-13-99x" }));
  check("POST edition with a malformed date → 400", badPost.status === 400);
}

// G9 — the widget, against the real seeded edition.
{
  const data = await getWidgetData("newsletter-edition", { maxStories: 3 });
  check("widget available:true off the stored EditionDoc",
    data.available === true && data.edition.date === TODAY && typeof data.edition.builtAt === "string", data.available);
  check("widget honours maxStories (3 headlines across the sections)",
    data.available === true && data.edition.sections.reduce((n, s) => n + s.stories.length, 0) === 3,
    data.available === true ? data.edition.sections.map((s) => s.stories.length) : data);
  check("widget stats come straight off the document (never recomputed)",
    data.available === true && data.stats.stories === 4 && data.stats.duplicatesMerged === 1, data.stats);
  const flat = data.available === true ? data.edition.sections.flatMap((s) => s.stories) : [];
  check("every widget story has an id and a nullable url (the corrected contract)",
    flat.length > 0 && flat.every((s) => typeof s.id === "string" && (s.url === null || typeof s.url === "string")),
    flat[0]);
  const full = await getWidgetData("newsletter-edition", { maxStories: 25 });
  const allStories = full.available === true ? full.edition.sections.flatMap((s) => s.stories) : [];
  check("the link-less story surfaces with url === null, not dropped",
    allStories.some((s) => s.title.includes("no link at all") && s.url === null),
    allStories.map((s) => [s.title, s.url]));
  check("the merged story's source NAMES ride along for the chip count",
    allStories.some((s) => /kernel/i.test(s.title) && s.sources.length === 2));
  check("no key material anywhere in the widget payload", !JSON.stringify(full).includes(FIXTURE_KEY));
}

// G10 — subscriptions PATCH/DELETE toggle the addy alias, and hold on failure.
{
  addyCalls.length = 0;
  addyResponder = () => new Response(null, { status: 204 });
  const res = await subIdRoute.PATCH(
    req(`/api/newsletter/subscriptions/${subA.id}`, "PATCH", { status: "paused" }),
    ctx(subA.id),
  );
  const j = await res.json();
  check("pausing a subscription DEACTIVATES its addy alias",
    res.status === 200 && j.subscription.status === "paused" &&
      addyCalls.some((c) => c.method === "DELETE" && c.url.includes("/active-aliases/alias-1")),
    addyCalls.map((c) => `${c.method} ${c.url}`));

  addyCalls.length = 0;
  addyResponder = () => new Response('{"message":"boom"}', { status: 500 });
  const failed = await subIdRoute.PATCH(
    req(`/api/newsletter/subscriptions/${subA.id}`, "PATCH", { status: "active" }),
    ctx(subA.id),
  );
  const fj = await failed.json();
  check("when addy refuses, the STATUS IS NOT FLIPPED and the error says so",
    failed.status === 502 && /alias not toggled/.test(fj.error ?? "") &&
      store.getSubscription(subA.id).status === "paused",
    { status: failed.status, error: fj.error, row: store.getSubscription(subA.id).status });
  check("that error carries no key either", !JSON.stringify(fj).includes(FIXTURE_KEY));

  addyResponder = () => new Response(null, { status: 204 });
  const del = await subIdRoute.DELETE(req(`/api/newsletter/subscriptions/${subB.id}`, "DELETE"), ctx(subB.id));
  const dj = await del.json();
  check("DELETE is a PAUSE + alias off — the row is never destroyed",
    del.status === 200 && dj.subscription.status === "paused" && !!store.getSubscription(subB.id), dj);

  const bad = await subIdRoute.PATCH(req("/api/newsletter/subscriptions/../etc", "PATCH", {}), ctx("../etc"));
  check("a traversal-shaped id → 400, never a query", bad.status === 400);
  const missing = await subIdRoute.PATCH(req("/api/newsletter/subscriptions/zzzzzzzzzzzz", "PATCH", {}), ctx("zzzzzzzzzzzz"));
  check("an unknown id → 404", missing.status === 404);
  const badCadence = await subIdRoute.PATCH(
    req(`/api/newsletter/subscriptions/${subA.id}`, "PATCH", { cadence: "hourly" }),
    ctx(subA.id),
  );
  check("an out-of-enum cadence → 400", badCadence.status === 400);
}

// G11 — lastEmailAt is derived, and "—" when there is nothing.
{
  addyResponder = () => okAlias();
  const fresh = (await (await subsRoute.POST(req("/api/newsletter/subscriptions", "POST", { name: "Silent" }))).json())
    .subscription;
  const j = await (await subsRoute.GET()).json();
  check("lastEmailAt carries a real timestamp for a subscription with mail",
    typeof j.lastEmailAt[subA.id] === "string" && j.lastEmailAt[subA.id] === store.latestEmailAt(subA.id),
    j.lastEmailAt[subA.id]);
  check("lastEmailAt is NULL (the table's '—') for one with none",
    j.lastEmailAt[fresh.id] === null, j.lastEmailAt[fresh.id]);
  check("GET subscriptions still leaks no key with a real key on disk",
    j.addyConfigured === true && !JSON.stringify(j).includes(FIXTURE_KEY));
}

// G12 — the newsletter.edition JOB (chunk 3 deliberately left it unregistered).
{
  jobs.ensureNewsletterJobs();
  const rows = scheduler.listJobs();
  const editionJob = rows.find((r) => r.id === jobs.EDITION_JOB_ID);
  const syncJob = rows.find((r) => r.id === jobs.SYNC_JOB_ID);
  check("both newsletter jobs are on the REAL scheduler with a next run",
    !!syncJob && !!editionJob && editionJob.kind === "newsletter.edition" && !!editionJob.run_at,
    { edition: editionJob?.run_at, sync: syncJob?.run_at });
  check("the edition job's RRULE follows settings.newsletter.editionTime",
    editionJob?.rrule === "FREQ=DAILY;BYHOUR=6;BYMINUTE=30", editionJob?.rrule);
  check("jobs.ts registers no croner/setInterval schedule of its own (CONVENTIONS §2)",
    !/from "croner"|require\("croner"\)|setInterval\(/.test(read("src/lib/v2/newsletter/jobs.ts")));

  // The handler kind RESOLVES — chunk 3's reason for not registering it.
  edition.__setSectionClassifierForTests(async () => ({}));
  const ran = await scheduler.runInline("newsletter.edition", { date: TODAY });
  check("the newsletter.edition handler kind resolves and runs (no job.failed)", ran === true);

  // A malformed editionTime is LOUD and falls back — never a silent skip.
  const errs = [];
  const realError = console.error;
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({
      memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" },
      tasks: { timezone: "America/Chicago" },
      browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
      newsletter: { sections: SECTIONS, editionTime: "half past six" },
    }),
  );
  console.error = (...args) => errs.push(args.map(String).join(" "));
  const rrule = jobs.editionRrule();
  console.error = realError;
  check("a malformed editionTime SHOUTS and falls back to the default",
    rrule === "FREQ=DAILY;BYHOUR=6;BYMINUTE=30" && errs.some((e) => /half past six/.test(e)), { rrule, errs });

  // The kill switch gates the SCHEDULED build only.
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({
      memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" },
      tasks: { timezone: "America/Chicago" },
      browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
      newsletter: { sections: SECTIONS, editionEnabled: false },
    }),
  );
  check("settings.newsletter.editionEnabled=false disables the SCHEDULED build",
    jobs.editionEnabled() === false);
  const manual = await edition.buildEdition("2026-01-02", { force: true });
  check("…but a MANUAL build still runs (the kill switch gates the job, not the builder)",
    manual.edition.date === "2026-01-02" && manual.reused === false);
}

edition.__setSectionClassifierForTests(null);
config.__setAddyTransportForTests(null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
