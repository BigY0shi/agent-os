// /api/activity no longer invents times (2026-09-29, NEXORA diff flag), offline.
//   A. lineTime reads the time a log line carries, and null when there is none
//   B. the route: ts is that time or null; the old "mtime minus 200 ms per line" is gone;
//      ordering uses a hidden key that is never returned
//   C. the widgets show an unknown time as unknown
// Run: npx tsx scripts/v2/smoke-activity-times.mjs
import fs from "node:fs";

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");

const { lineTime } = await import("../../src/lib/logTime.ts");
check("A1 ISO with Z", lineTime("2026-09-29T00:12:03Z gateway up") === Date.parse("2026-09-29T00:12:03Z"));
check("A2 space separator, comma millis (Python logging)", lineTime("2026-09-29 00:12:03,120 INFO ready") === Date.parse("2026-09-29T00:12:03.120"));
check("A3 offset kept", lineTime("[2026-09-29T02:12:03+02:00] x") === Date.parse("2026-09-29T00:12:03Z"));
check("A4 no time in the line -> null", lineTime("agent started, waiting for input") === null);
check("A5 a bare date is not a time", lineTime("report for 2026-09-29 done") === null);

const route = read("src/app/api/activity/route.ts");
check("B1 the invented per-line time is gone", !/\(lines\.length - i\) \* 200/.test(route));
check("B2 ts is the line's own time or null", route.includes("ts: number | null") && route.includes("const ts = lineTime(line);"));
check("B3 the sort key is stripped before it leaves", route.includes("map(({ order: _o, line: _l, ...e }) => e)"));
check("B4 the route exports only handlers and config", (route.match(/^export /gm) || []).length === 3);

const stream = read("src/components/ActivityStream.tsx");
const mini = read("src/components/dashboard/MiniTimeline.tsx");
check("C1 ActivityStream shows an unknown time as unknown", stream.includes('e.ts == null ? "--:--:--"') && stream.includes("this log line carries no time"));
check("C2 MiniTimeline passes unknown through, never a made-up time", mini.includes('ts: e.ts == null ? "" : new Date(e.ts).toISOString()') && mini.includes('if (!iso) return "--:--:--";'));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
