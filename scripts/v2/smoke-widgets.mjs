// SPEC-D H2.1/H3.1/H4.2 smoke: widget registry + data routes + layout +
// attention widget/hero data legs. FULLY OFFLINE — temp DB/settings/key, no
// LLM, no network; route modules are imported and called directly (house
// pattern from smoke-attention). Covers:
//   registry endpoint lists all widgets (defs complete, slugs unique);
//   per-widget data routes return live-shaped data from seeded fixtures
//     (activity-feed from seeded activities; agent-status/pipeline-stats
//     shape — those wrap the real read-only fleet/deals sources);
//   the honest {available:false, reason} path for an unconfigured source
//     (no accounts at all; a bogus configured accountId) — never fake data;
//   route contract: unknown slug 404, malformed ?config= 400;
//   layout: DEFAULT_HOME_CELLS validity + resolveHomeCells fallback + a
//     settings.home.cells write/read round trip;
//   attention legs (H4.2): severity grouping, minSeverity/maxItems config,
//     done/dismiss PATCH round trip, muteKinds hides a kind.
// Run: npx tsx scripts/v2/smoke-widgets.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any src imports — never the live DB/settings/key.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-widgets-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-widgets-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may call out
fs.writeFileSync(
  settingsFile,
  JSON.stringify({ tasks: { timezone: "America/Chicago" }, memory: { ingestEnabled: false } }),
);

const { ensureDb } = await import("../../src/lib/v2/db.ts");
const types = await import("../../src/lib/v2/widgets/types.ts");
const registry = await import("../../src/lib/v2/widgets/registry.ts");
const data = await import("../../src/lib/v2/widgets/data.ts");
const attnStore = await import("../../src/lib/v2/attention/store.ts");
const intStore = await import("../../src/lib/v2/integrations/store.ts");
const { readSettings, writeSettings } = await import("../../src/lib/settings.ts");
const widgetsRoute = await import("../../src/app/api/v2/widgets/route.ts");
const dataRoute = await import("../../src/app/api/v2/widgets/[slug]/data/route.ts");
const attentionRoute = await import("../../src/app/api/v2/attention/route.ts");
const { NextRequest } = await import("next/server");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataReq = (slug, config) =>
  dataRoute.GET(
    new NextRequest(
      `http://smoke.local/api/v2/widgets/${slug}/data${config !== undefined ? `?config=${encodeURIComponent(typeof config === "string" ? config : JSON.stringify(config))}` : ""}`,
    ),
    { params: Promise.resolve({ slug }) },
  );

ensureDb();

// ---------------------------------------------------------------------------
// A. registry + /api/v2/widgets
// ---------------------------------------------------------------------------
const EXPECTED_SLUGS = ["attention", "activity-feed", "pipeline-stats", "agent-status"];
{
  const res = await widgetsRoute.GET();
  const j = await res.json();
  check("GET /api/v2/widgets → 200 { widgets }", res.status === 200 && Array.isArray(j.widgets));
  const slugs = (j.widgets ?? []).map((w) => w.slug);
  check("registry lists all chunk-1 widgets", EXPECTED_SLUGS.every((s) => slugs.includes(s)), slugs);
  check("slugs are unique (CONVENTIONS §8 single catalog)", new Set(slugs).size === slugs.length);
  const complete = (j.widgets ?? []).every(
    (w) =>
      typeof w.slug === "string" &&
      typeof w.title === "string" &&
      typeof w.description === "string" &&
      typeof w.icon === "string" &&
      ["S", "M", "L"].includes(w.minSize) &&
      ["S", "M", "L"].includes(w.defaultSize) &&
      ["endpoint", "none"].includes(w.dataKind) &&
      typeof w.sourceModule === "string",
  );
  check("every WidgetDef is complete (slug/title/description/icon/sizes/dataKind/sourceModule)", complete, j.widgets);
  check("getWidget resolves a known slug and nulls an unknown one",
    registry.getWidget("attention")?.slug === "attention" && registry.getWidget("nope") === null);
}

// ---------------------------------------------------------------------------
// B. activity-feed — honest unavailable first, then seeded fixtures
// ---------------------------------------------------------------------------
{
  const before = await data.getWidgetData("activity-feed", {});
  check("activity-feed with ZERO accounts → honest {available:false, reason} (never fake data)",
    before.available === false && typeof before.reason === "string" && before.reason.includes("/integrations"), before);

  const account = intStore.upsertAccount({
    definitionSlug: "_test",
    accountId: "smoke-widgets-acct",
    displayName: "Widget Smoke",
    config: {},
  });
  intStore.insertActivity({ accountId: account.id, text: "first activity", eventType: "TEST_EVENT" });
  await sleep(5);
  intStore.insertActivity({ accountId: account.id, text: "second activity", sourceUrl: "https://example.com/2" });
  await sleep(5);
  intStore.insertActivity({ accountId: account.id, text: "third activity" });

  const res = await dataReq("activity-feed", { maxItems: 2 });
  const j = await res.json();
  check("activity-feed data route → 200 available with seeded activities, maxItems honored",
    res.status === 200 && j.available === true && Array.isArray(j.items) && j.items.length === 2, j);
  check("activity-feed is newest-first", j.items?.[0]?.text === "third activity" && j.items?.[1]?.text === "second activity", j.items);
  const item = j.items?.[1] ?? {};
  check("feed item carries the live shape (id/accountId/connector/account/text/sourceUrl/createdAt)",
    typeof item.id === "string" && item.accountId === account.id && item.connector === "_test" &&
    item.account === "Widget Smoke" && item.sourceUrl === "https://example.com/2" && typeof item.createdAt === "string", item);

  const bogus = await (await dataReq("activity-feed", { accountId: "no-such-account" })).json();
  check("activity-feed with a bogus configured accountId → honest {available:false, reason}",
    bogus.available === false && typeof bogus.reason === "string" && bogus.reason.includes("no-such-account"), bogus);

  const scoped = await (await dataReq("activity-feed", { accountId: account.id, maxItems: 50 })).json();
  check("activity-feed scoped to one account returns only its rows",
    scoped.available === true && scoped.items.length === 3 && scoped.items.every((i) => i.accountId === account.id), scoped);
}

// ---------------------------------------------------------------------------
// C. route contract — unknown slug 404, malformed config 400
// ---------------------------------------------------------------------------
{
  const missing = await dataReq("not-a-widget");
  check("unknown widget slug → 404", missing.status === 404);
  const bad = await dataReq("activity-feed", "{not json");
  check("malformed ?config= JSON → 400", bad.status === 400);
  const notObj = await dataReq("activity-feed", "[1,2]");
  check("non-object ?config= JSON → 400", notObj.status === 400);
}

// ---------------------------------------------------------------------------
// D. agent-status + pipeline-stats — wrap the REAL (read-only) sources; the
// smoke asserts live SHAPE + the honest envelope, not this box's contents.
// ---------------------------------------------------------------------------
{
  const res = await dataReq("agent-status", { maxAgents: 4 });
  const j = await res.json();
  const shapeOk =
    j.available === true &&
    Array.isArray(j.agents) &&
    typeof j.total === "number" &&
    j.agents.length <= 4 &&
    j.agents.every(
      (a) =>
        typeof a.id === "string" &&
        typeof a.name === "string" &&
        ["running", "waiting", "idle", "error", "offline"].includes(a.status) &&
        (a.lastRunAt === null || typeof a.lastRunAt === "number") &&
        typeof a.runs === "number",
    );
  const honestFail = j.available === false && typeof j.reason === "string";
  check("agent-status → StatusBand-ready shape (or the honest unavailable envelope)", res.status === 200 && (shapeOk || honestFail), j);
  check("agent-status never fabricates: envelope always carries 'available'", typeof j.available === "boolean");
}
{
  const j = await (await dataReq("pipeline-stats", { view: "kpi" })).json();
  const ok =
    j.available === true &&
    j.view === "kpi" &&
    typeof j.kpi?.agents?.total === "number" &&
    typeof j.kpi?.agents?.running === "number" &&
    typeof j.kpi?.runs?.d7 === "number" &&
    typeof j.kpi?.spend?.total === "number" &&
    "medianMs" in (j.kpi?.timing ?? {});
  check("pipeline-stats kpi view wraps the fleet-runtime shape", ok, j);

  const deals = await (await dataReq("pipeline-stats", { view: "deals" })).json();
  const dealsOk =
    (deals.available === true && deals.view === "deals" && typeof deals.deals?.total === "number" && typeof deals.deals?.byStatus === "object") ||
    (deals.available === false && typeof deals.reason === "string");
  check("pipeline-stats deals view: real board counts OR the honest unavailable envelope", dealsOk, deals);
}

// ---------------------------------------------------------------------------
// E. layout — defaults const + resolveHomeCells fallback + settings round trip
// ---------------------------------------------------------------------------
{
  const defaults = types.DEFAULT_HOME_CELLS;
  check("DEFAULT_HOME_CELLS is non-empty and every slug exists in the registry",
    defaults.length > 0 && defaults.every((c) => registry.getWidget(c.widgetSlug) !== null), defaults);
  check("default cell ids + orders are unique",
    new Set(defaults.map((c) => c.id)).size === defaults.length &&
    new Set(defaults.map((c) => c.order)).size === defaults.length);

  check("settings.home.cells is unset out of the box (defaults apply at read time)",
    readSettings().home?.cells === undefined);
  check("resolveHomeCells(undefined) falls back to the defaults, order-sorted",
    JSON.stringify(types.resolveHomeCells(undefined)) === JSON.stringify([...defaults].sort((a, b) => a.order - b.order)));
  check("resolveHomeCells rejects malformed rows and falls back",
    JSON.stringify(types.resolveHomeCells([{ bogus: true }, 42])) === JSON.stringify(types.resolveHomeCells(undefined)));

  const custom = [
    { id: "c2", widgetSlug: "agent-status", size: "S", order: 1 },
    { id: "c1", widgetSlug: "attention", size: "L", order: 0, config: { maxItems: "5" } },
  ];
  writeSettings({ home: { cells: custom } });
  const readBack = readSettings().home?.cells;
  check("settings.home.cells write/read round trip", JSON.stringify(readBack) === JSON.stringify(custom), readBack);
  const resolved = types.resolveHomeCells(readBack);
  check("resolveHomeCells honors a persisted layout (order-sorted, config kept)",
    resolved.length === 2 && resolved[0].id === "c1" && resolved[1].id === "c2" && resolved[0].config?.maxItems === "5", resolved);
}

// ---------------------------------------------------------------------------
// F. attention legs (H4.2) — grouping, config filters, PATCH round trip,
// muteKinds
// ---------------------------------------------------------------------------
{
  attnStore.upsertByDedupeKey({ dedupeKey: "w-u1", kind: "widget_test", severity: "urgent", title: "urgent one", route: "/tasks" });
  attnStore.upsertByDedupeKey({ dedupeKey: "w-w1", kind: "widget_test", severity: "warn", title: "warn one" });
  attnStore.upsertByDedupeKey({ dedupeKey: "w-i1", kind: "widget_test", severity: "info", title: "info one" });
  attnStore.upsertByDedupeKey({ dedupeKey: "w-m1", kind: "muted_kind", severity: "warn", title: "muted one" });

  const groups = types.groupBySeverity(attnStore.listItems({ status: "open" }));
  check("groupBySeverity buckets urgent/warn/info with the seeded members",
    groups.urgent.some((i) => i.dedupeKey === "w-u1") &&
    groups.warn.some((i) => i.dedupeKey === "w-w1") &&
    groups.info.some((i) => i.dedupeKey === "w-i1") &&
    !groups.urgent.some((i) => i.severity !== "urgent"));
  check("groupBySeverity routes unknown severities to info (normalize parity)",
    types.groupBySeverity([{ severity: "banana" }]).info.length === 1);

  const all = await (await dataReq("attention", {})).json();
  check("attention widget data: available, severity-sorted items + collector health",
    all.available === true && Array.isArray(all.items) && Array.isArray(all.collectors) &&
    all.items[0]?.severity === "urgent", all.items?.map((i) => i.severity));

  const filtered = await (await dataReq("attention", { minSeverity: "warn", maxItems: 1 })).json();
  check("attention widget config: minSeverity drops info, maxItems caps",
    filtered.available === true && filtered.items.length === 1 && filtered.items[0].severity === "urgent", filtered);

  // muteKinds hides a kind — widget data fn AND the shared /api/v2/attention route
  writeSettings({ attention: { ...(readSettings().attention ?? {}), muteKinds: ["muted_kind"] } });
  const muted = await (await dataReq("attention", {})).json();
  check("muteKinds hides the kind from the attention widget", !muted.items.some((i) => i.kind === "muted_kind"), muted.items);
  const heroRes = await attentionRoute.GET(new NextRequest("http://smoke.local/api/v2/attention"));
  const hero = await heroRes.json();
  check("muteKinds hides the kind from the hero's route too", !hero.items.some((i) => i.kind === "muted_kind"));
  writeSettings({ attention: { ...(readSettings().attention ?? {}), muteKinds: [] } });

  // done/dismiss PATCH round trip through the shared route (what the hero buttons call)
  const target = attnStore.getByDedupeKey("w-w1");
  const patch = (body) =>
    attentionRoute.PATCH(
      new NextRequest("http://smoke.local/api/v2/attention", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const doneRes = await patch({ id: target.id, action: "done" });
  const doneJ = await doneRes.json();
  check("PATCH done round trip: 200, status flips, persists",
    doneRes.status === 200 && doneJ.item?.status === "done" && attnStore.getItem(target.id).status === "done");
  const dismissTarget = attnStore.getByDedupeKey("w-i1");
  const disRes = await patch({ id: dismissTarget.id, action: "dismiss" });
  check("PATCH dismiss round trip: 200 + persists", disRes.status === 200 && attnStore.getItem(dismissTarget.id).status === "dismissed");
  const open = await (await dataReq("attention", {})).json();
  check("resolved items leave the open feed", !open.items.some((i) => i.id === target.id || i.id === dismissTarget.id));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
