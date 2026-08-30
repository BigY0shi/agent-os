// TopBar route metadata smoke — every module must show its OWN name.
//
// The bug this exists to prevent (found 2026-08-29): the lookup was
// `TITLES[pathname] ?? TITLES["/"]`, so any route missing from the table
// silently rendered as "Mission Control". Every module added after the table
// was first written was affected — all of V2, plus several of Yoshi's own.
// Nothing errored; the page just claimed to be a different page.
//
// Run: npx tsx scripts/v2/smoke-topbar.mjs
//
// No temp env needed: pageMeta.ts is plain data with no React, no db, no fs.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};

const { TITLES, metaFor } = await import("../../src/lib/pageMeta.ts");

// Every real route in the app, derived from the filesystem rather than a list
// someone has to remember to update — the whole failure mode here was a list
// falling behind the app.
function routes(dir = path.join(root, "src", "app"), prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("(") || e.name === "api") continue; // groups + API routes render no page
    const seg = `${prefix}/${e.name}`;
    if (fs.existsSync(path.join(dir, e.name, "page.tsx"))) out.push(seg);
    out.push(...routes(path.join(dir, e.name), seg));
  }
  return out;
}
const ALL = ["/", ...routes()].sort();
console.log(`\n── §A ${ALL.length} routes discovered on disk ──`);
check("A1 the walker found the app (sanity)", ALL.length > 30, `${ALL.length}`);
check("A2 it found the V2 modules", ["/agents", "/tasks", "/anynotes", "/newsletter"].every((r) => ALL.includes(r)));

// ── §B no route may impersonate another page ────────────────────────────────
console.log("\n── §B no route claims to be Mission Control ──");
const MC = TITLES["/"].title;
const liars = ALL.filter((r) => r !== "/" && metaFor(r).title === MC);
check("B1 only \"/\" resolves to Mission Control", liars.length === 0, liars.join(", "));

const blank = ALL.filter((r) => !metaFor(r).title.trim());
check("B2 every route resolves to a non-empty title", blank.length === 0, blank.join(", "));

// A route's title should relate to its path — the failure mode was a title that
// looked fine but belonged to a different module.
//
// Three titles are deliberately editorial and do NOT echo their path (confirmed
// by Yoshi, 2026-08-29). They are pinned rather than merely logged: a printed
// note blends into a passing run, so a FOURTH mismatch would have slipped by
// unread — which is how the original bug survived in the first place.
const EDITORIAL = new Set(["/guide", "/pipeline", "/room"]);
const unrelated = ALL.filter((r) => {
  if (r === "/") return false;
  const slug = r.split("/").filter(Boolean)[0].replace(/[[\]]/g, "");
  const title = metaFor(r).title.toLowerCase().replace(/[^a-z]/g, "");
  const s = slug.toLowerCase().replace(/[^a-z]/g, "");
  return !title.includes(s.slice(0, 4)) && !s.includes(title.slice(0, 4));
});
const unexpected = unrelated.filter((r) => !EDITORIAL.has(r));
check("B3 no NEW route title has drifted from its path", unexpected.length === 0,
  unexpected.map((r) => `${r} -> "${metaFor(r).title}"`).join(", "));

const goneEditorial = [...EDITORIAL].filter((r) => ALL.includes(r) && !unrelated.includes(r));
check("B4 the pinned editorial titles are still editorial", goneEditorial.length === 0,
  `now derive from their path: ${goneEditorial.join(", ")}`);

// ── §C the three resolution steps ───────────────────────────────────────────
console.log("\n── §C metaFor resolution order ──");
check("C1 exact match wins", metaFor("/agents").title === TITLES["/agents"].title);
check("C2 a nested route inherits its parent", metaFor("/agents/abc-123").title === TITLES["/agents"].title,
  metaFor("/agents/abc-123").title);
check("C3 a dynamic segment inherits too", metaFor("/agents/[id]").title === TITLES["/agents"].title);
check("C4 an UNLISTED route names itself, it does not borrow one",
  metaFor("/some-new-module").title === "Some New Module", metaFor("/some-new-module").title);
check("C5 ...and carries no numeral or standfirst it did not earn",
  metaFor("/some-new-module").numeral === "" && metaFor("/some-new-module").sub === "");
check("C6 the root still resolves to Mission Control", metaFor("/").title === MC);

// ── §D the table itself ─────────────────────────────────────────────────────
console.log("\n── §D table integrity ──");
const entries = Object.entries(TITLES);
check("D1 every entry has a title and a label",
  entries.every(([, m]) => m.title?.trim() && m.label?.trim()),
  entries.filter(([, m]) => !m.title?.trim() || !m.label?.trim()).map(([k]) => k).join(", "));
check("D2 every key is a rooted path", entries.every(([k]) => k.startsWith("/")));
const dead = entries.map(([k]) => k).filter((k) => !ALL.includes(k));
check("D3 no entry points at a route that no longer exists", dead.length === 0, dead.join(", "));
const dupTitles = Object.entries(
  entries.reduce((a, [, m]) => ((a[m.title] = (a[m.title] ?? 0) + 1), a), {}),
).filter(([, n]) => n > 1);
check("D4 no two routes share a title", dupTitles.length === 0, dupTitles.map(([t]) => t).join(", "));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
