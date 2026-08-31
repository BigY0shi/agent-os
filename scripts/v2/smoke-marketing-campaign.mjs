// SPEC-F J1.1 smoke — campaign detail route + page shell + stable palette colour.
//
// Run: npx tsx scripts/v2/smoke-marketing-campaign.mjs
//
// Fully offline: MARKETING lives on the filesystem under $HOME/.agentic-os, so
// HOME is redirected at a temp dir BEFORE any src import. No CLI agent is ever
// invoked — nothing here calls plan/draft.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mkt-home-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.OLLAMA_URL = "http://127.0.0.1:1";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
/** Source with comments stripped — assert on CODE, not on prose. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};

const { NextRequest } = await import("next/server.js");
const mkt = await import("../../src/lib/marketing.ts");
const palette = await import("../../src/lib/v2/marketing/palette.ts");
const slugRoute = await import("../../src/app/api/marketing/campaigns/[slug]/route.ts");

const get = (slug) =>
  slugRoute.GET(new NextRequest(`http://127.0.0.1:3737/api/marketing/campaigns/${slug}`), {
    params: Promise.resolve({ slug }),
  });

// ── §A palette ──────────────────────────────────────────────────────────────
console.log("");
console.log("── §A stable palette ──");
check("A1 colorFor is deterministic for a slug", palette.colorFor("q4-launch") === palette.colorFor("q4-launch"));
check("A2 ...and returns a colour from the palette",
  palette.CAMPAIGN_PALETTE.includes(palette.colorFor("q4-launch")), palette.colorFor("q4-launch"));
// Slugs share long prefixes in practice ("q4-", the business names), so the
// hash has to spread on the TAIL or every campaign lands on one colour.
{
  const near = ["q4-launch-a", "q4-launch-b", "q4-launch-c", "q4-launch-d", "q4-launch-e", "q4-launch-f"];
  const distinct = new Set(near.map(palette.colorFor)).size;
  check("A3 near-identical slugs do NOT clump on one colour", distinct >= 3, `${distinct} distinct of ${near.length}`);
}
check("A4 an empty slug still yields a valid colour", palette.CAMPAIGN_PALETTE.includes(palette.colorFor("")));

// ── §B colour is assigned on read AND persisted ─────────────────────────────
console.log("");
console.log("── §B colour assigned on first read, then persisted ──");
const campaignsDir = path.join(tmpHome, ".agentic-os", "marketing", "campaigns");
fs.mkdirSync(campaignsDir, { recursive: true });
const legacy = {
  slug: "legacy-campaign", title: "Legacy Campaign", business: "payloadsco",
  goal: "prove the backfill", channels: ["text-post"], status: "draft",
  items: [], created: new Date().toISOString(),
};
fs.writeFileSync(path.join(campaignsDir, "legacy-campaign.json"), JSON.stringify(legacy, null, 2));
check("B1 the fixture starts with NO colour", !("color" in legacy));

const first = await mkt.readCampaign("legacy-campaign");
check("B2 reading assigns one", !!first?.color && palette.CAMPAIGN_PALETTE.includes(first.color), first?.color);
check("B3 ...matching colorFor(slug)", first?.color === palette.colorFor("legacy-campaign"));

await new Promise((r) => setTimeout(r, 120)); // the write-back is fire-and-forget
const onDisk = JSON.parse(fs.readFileSync(path.join(campaignsDir, "legacy-campaign.json"), "utf8"));
check("B4 the colour was PERSISTED, not just computed", onDisk.color === first?.color, onDisk.color);

const second = await mkt.readCampaign("legacy-campaign");
check("B5 a second read is stable", second?.color === first?.color);
check("B6 listCampaigns backfills too", (await mkt.listCampaigns()).every((c) => !!c.color));

// ── §C the by-slug route ────────────────────────────────────────────────────
console.log("");
console.log("── §C GET /api/marketing/campaigns/[slug] ──");
const ok = await get("legacy-campaign");
const okJson = await ok.json();
check("C1 a real slug returns 200 with the campaign", ok.status === 200 && okJson.campaign?.slug === "legacy-campaign");
check("C2 ...carrying its colour for the UI accent", !!okJson.campaign?.color);

const missing = await get("no-such-campaign");
check("C3 an unknown slug is an honest 404", missing.status === 404, `${missing.status}`);
check("C4 ...with a message, not an empty body", /not found/i.test((await missing.json()).error ?? ""));

// A traversal attempt and a genuine miss must be INDISTINGUISHABLE, or the
// 404-vs-400 split tells an attacker which paths exist.
for (const bad of ["../../../etc/passwd", "..%2f..%2fsecrets", "Legacy-Campaign", "legacy_campaign"]) {
  const res = await get(bad);
  check(`C5 rejected slug "${bad.slice(0, 22)}" → 404, same as a miss`, res.status === 404, `${res.status}`);
}

// ── §D the page shell ───────────────────────────────────────────────────────
console.log("");
console.log("── §D detail page + hub link ──");
const page = code("src/app/marketing/[slug]/page.tsx");
check("D1 the route exists and renders CampaignDetail", /CampaignDetail/.test(page));
check("D2 it awaits params (Next 16 async params)", /await params/.test(page));

const detail = code("src/components/v2/marketing/CampaignDetail.tsx");
check("D3 the detail component is a client component", /"use client"/.test(read("src/components/v2/marketing/CampaignDetail.tsx")));
check("D4 it has the five tabs the later J tasks drop into",
  ["Overview", "Calendar", "Board", "Assets", "Metrics"].every((t) => detail.includes(`"${t}"`)));
check("D5 unbuilt tabs SAY they are unbuilt rather than rendering an empty panel",
  /PENDING/.test(detail) && /J1\.2|J2\.1/.test(read("src/components/v2/marketing/CampaignDetail.tsx")));
check("D6 a 404 from the route renders the not-found panel, not a spinner forever",
  /status === 404/.test(detail) && /notFound/.test(detail));
check("D7 a failed fetch is NOT reported as a missing campaign",
  detail.includes("setNotFound(true)") && /could not load/i.test(detail));
check("D8 the plan renders as text — no HTML parsed from model output",
  !/dangerouslySetInnerHTML/.test(detail));

const hub = code("src/components/MarketingHub.tsx");
check("D9 hub cards link through to the detail page", /href=\{`\/marketing\/\$\{c\.slug\}`\}/.test(hub));
check("D10 ...without breaking the existing click-to-drawer (stopPropagation)",
  /stopPropagation/.test(hub) && /onOpen/.test(hub));

console.log("");
console.log(`${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp home: ${tmpHome})`);
process.exit(failures === 0 ? 0 : 1);
