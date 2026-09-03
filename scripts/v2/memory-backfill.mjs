// S5 — legacy memory backfill from the CLI (same routine the Memory gear runs).
//
//   npx tsx scripts/v2/memory-backfill.mjs --limit 20 --model bonsai:27b [--dry-run] [--json]
//
// Reads the undrived legacy episodes (imported raw by A9, so they carry no
// aspect), derives them in place through the full ingest pipeline on the LOCAL
// Ollama chat model named by --model (default settings.memory.backfillModel),
// embeddings on settings.memory.embedModel. Ollama down or the model not pulled
// exits 1 with the reason; nothing is ever routed to a hosted model.
//
// --dry-run lists what a run would touch and writes nothing (no Ollama call).
// --json prints the BackfillResult instead of the table (the smoke uses this).
// Exit codes: 0 done (or dry run), 1 error / every episode failed, 2 bad flags.
import { ensureDb, __closeForTests } from "../../src/lib/v2/db.ts";
import { readSettings } from "../../src/lib/settings.ts";
import { backfillEpisodes } from "../../src/lib/v2/memory/backfill.ts";

function parseArgs(argv) {
  const out = { limit: null, model: null, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--limit" || a === "--model") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      if (a === "--limit") {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1) throw new Error(`--limit must be a positive integer, got '${v}'`);
        out.limit = n;
      } else out.model = v;
    } else if (a.startsWith("--limit=")) out.limit = parseInt(a.slice(8), 10);
    else if (a.startsWith("--model=")) out.model = a.slice(8);
    else if (a === "-h" || a === "--help") {
      console.log("usage: npx tsx scripts/v2/memory-backfill.mjs --limit 20 --model bonsai:27b [--dry-run] [--json]");
      process.exit(0);
    } else throw new Error(`unknown flag '${a}'`);
  }
  return out;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`memory-backfill: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
}

ensureDb();
const mem = readSettings().memory ?? {};
const limit = args.limit ?? mem.backfillLimit ?? 20;
const model = args.model ?? mem.backfillModel ?? "bonsai:27b";

const log = args.json ? () => {} : (t) => console.log(`  ${t}`);
const progress = args.json
  ? () => {}
  : (n, total) => { if (n < total) console.log(`  [${n + 1}/${total}]`); };

try {
  const r = await backfillEpisodes({ limit, model, dryRun: args.dryRun, log, progress });
  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.dryRun) {
    console.log(`\nDRY RUN: ${r.candidates.length} of ${r.remaining} undrived legacy episodes would be derived with ${r.model} (embeddings: ${r.embedModel}); nothing written.`);
    for (const c of r.candidates) {
      console.log(`  ${c.uuid.slice(0, 8)}  ${c.validAt.slice(0, 10)}  ${c.source.padEnd(20)}  ${String(c.chars).padStart(6)} ch  ${c.preview.slice(0, 80)}`);
    }
  } else {
    console.log(`\nrun ${r.runId}: ${r.derived} derived, ${r.nothing} nothing to remember, ${r.failed} failed in ${(r.ms / 1000).toFixed(1)} s; ${r.remaining - r.derived - r.nothing} still undrived`);
    for (const e of r.results) {
      const head = `  ${e.uuid.slice(0, 8)}  ${e.validAt.slice(0, 10)}  ${e.outcome.padEnd(8)}`;
      if (e.outcome === "failed") { console.log(`${head}  ${e.error}`); continue; }
      const sa = Object.entries(e.statementAspects).map(([k, v]) => `${k} ${v}`).join(", ") || "-";
      const va = Object.entries(e.voiceAspectKinds).map(([k, v]) => `${k} ${v}`).join(", ") || "-";
      console.log(`${head}  facts: ${sa}  voice: ${va}  (${(e.ms / 1000).toFixed(1)} s)`);
      for (const f of e.sampleFacts) console.log(`            ${f}`);
    }
  }
  __closeForTests();
  process.exit(0);
} catch (err) {
  console.error(`memory-backfill: ${err instanceof Error ? err.message : err}`);
  __closeForTests();
  process.exit(1);
}
