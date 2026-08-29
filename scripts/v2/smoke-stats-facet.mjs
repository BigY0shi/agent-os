// smoke-stats-facet.mjs — verifies the A8 additive ?facet=aspects param on
// /api/v2/memory/stats (AspectExplorer's data source). Direct-import pattern
// (chunk-6 convention), temp DB via AGENTIC_OS_DB — never the live DB.
import { NextRequest } from "next/server";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "agentos-facet-"));
process.env.AGENTIC_OS_DB = path.join(dir, "facet.db");
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");

const { GET } = await import("../../src/app/api/v2/memory/stats/route.ts");

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed++; };

const base = await (await GET()).json();
check("base GET() shape unchanged", ["episodes","statements","entities","voiceAspects","labels","invalidated","queueDepth"].every((k) => typeof base[k] === "number"));

const counts = await (await GET(new NextRequest("http://x/api/v2/memory/stats?facet=aspects"))).json();
check("?facet=aspects returns graph[] + voice[] separately", Array.isArray(counts.graph) && Array.isArray(counts.voice));

const facts = await (await GET(new NextRequest("http://x/api/v2/memory/stats?facet=aspects&aspect=Identity&store=graph"))).json();
check("aspect+store returns facts[]", Array.isArray(facts.facts));

const voiceFacts = await (await GET(new NextRequest("http://x/api/v2/memory/stats?facet=aspects&aspect=Preference&store=voice"))).json();
check("voice store queried separately", Array.isArray(voiceFacts.facts));

const bad = await GET(new NextRequest("http://x/api/v2/memory/stats?facet=aspects&aspect=Nope&store=graph"));
check("unknown aspect → 400", bad.status === 400);

if (failed) { console.log(`${failed} FAILURES`); process.exit(1); }
console.log("ALL PASS");
