// S5 — legacy memory backfill from the CLI (same routine the Memory gear runs).
//
//   npx tsx scripts/v2/memory-backfill.mjs --limit 20 --model bonsai:27b [--dry-run] [--json]
//   npx tsx scripts/v2/memory-backfill.mjs --limit 20 --provider openai-compat --model bonsai-27b
//
// Reads the undrived legacy episodes (imported raw by A9, so they carry no
// aspect) and derives them in place through the full ingest pipeline, on a
// LOCAL chat model named by --model (default settings.memory.backfillModel).
//
// --provider picks which local server serves that model:
//   ollama-local   Ollama on :11434, model named by its tag (bonsai:27b)
// --reasoning-effort caps how hard a thinking model may deliberate before it
// answers (openai-compat only; default "none" from the gear). Measured on
// bonsai-27b: left alone it spends ~1900 reasoning tokens / 26 s per call to
// produce a 51-token answer, and "none" returns the same facts in 1.2 s.
//
//   openai-compat  any OpenAI-wire server (LM Studio, llama.cpp, vLLM) at
//                  --base-url / settings.memory.openaiCompatUrl, model named by
//                  the server's API identifier (bonsai-27b). Use this for models
//                  Ollama cannot serve, such as Bonsai 27B on a llama.cpp fork.
// Embeddings are Ollama-only either way (settings.memory.embedModel), so an
// openai-compat run still needs Ollama up. A server down or a model absent
// exits 1 naming which one; nothing is ever routed to a hosted model.
//
// --dry-run lists what a run would touch and writes nothing (no model call).
// --json prints the BackfillResult instead of the table (the smoke uses this).
// Exit codes: 0 done (or dry run), 1 error / every episode failed, 2 bad flags.
import { ensureDb, __closeForTests } from "../../src/lib/v2/db.ts";
import { readSettings } from "../../src/lib/settings.ts";
import { backfillEpisodes } from "../../src/lib/v2/memory/backfill.ts";

const PROVIDERS = ["ollama-local", "openai-compat"];
const EFFORTS = ["", "none", "minimal", "low", "medium", "high"];

function parseArgs(argv) {
  const out = { limit: null, model: null, provider: null, baseUrl: null, effort: null, dryRun: false, json: false };
  const setValue = (flag, v) => {
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    if (flag === "--limit") {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1) throw new Error(`--limit must be a positive integer, got '${v}'`);
      out.limit = n;
    } else if (flag === "--model") out.model = v;
    else if (flag === "--provider") {
      if (!PROVIDERS.includes(v)) throw new Error(`--provider must be one of ${PROVIDERS.join(" | ")}, got '${v}'`);
      out.provider = v;
    } else if (flag === "--reasoning-effort") {
      if (!EFFORTS.includes(v)) throw new Error(`--reasoning-effort must be one of ${EFFORTS.filter(Boolean).join(" | ")} (or "" to send nothing), got '${v}'`);
      out.effort = v;
    } else if (flag === "--base-url") {
      if (!/^https?:\/\//i.test(v)) throw new Error(`--base-url must be an http(s) URL, got '${v}'`);
      out.baseUrl = v;
    }
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--limit" || a === "--model" || a === "--provider" || a === "--base-url" || a === "--reasoning-effort") setValue(a, argv[++i]);
    else if (a.startsWith("--limit=")) setValue("--limit", a.slice(8));
    else if (a.startsWith("--model=")) setValue("--model", a.slice(8));
    else if (a.startsWith("--provider=")) setValue("--provider", a.slice(11));
    else if (a.startsWith("--base-url=")) setValue("--base-url", a.slice(11));
    else if (a.startsWith("--reasoning-effort=")) setValue("--reasoning-effort", a.slice(19));
    else if (a === "-h" || a === "--help") {
      console.log("usage: npx tsx scripts/v2/memory-backfill.mjs --limit 20 --model bonsai:27b [--provider ollama-local|openai-compat] [--base-url http://127.0.0.1:1234/v1] [--reasoning-effort none|minimal|low|medium|high] [--dry-run] [--json]");
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

// --base-url is read by openaiCompatBase() through the environment, so the flag
// overrides settings for this process only and writes nothing to disk.
// Both flags override the gear for THIS PROCESS ONLY and write nothing to disk:
// openaiCompatBase() and openaiCompatReasoningEffort() each check the env first.
if (args.baseUrl) process.env.OPENAI_COMPAT_URL = args.baseUrl;
if (args.effort !== null) process.env.OPENAI_COMPAT_REASONING_EFFORT = args.effort;

ensureDb();
const mem = readSettings().memory ?? {};
const limit = args.limit ?? mem.backfillLimit ?? 20;
const model = args.model ?? mem.backfillModel ?? "bonsai:27b";
const provider = args.provider ?? mem.backfillProvider ?? "ollama-local";

const log = args.json ? () => {} : (t) => console.log(`  ${t}`);
const progress = args.json
  ? () => {}
  : (n, total) => { if (n < total) console.log(`  [${n + 1}/${total}]`); };

try {
  const r = await backfillEpisodes({ limit, model, provider, dryRun: args.dryRun, log, progress });
  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.dryRun) {
    console.log(`\nDRY RUN: ${r.candidates.length} of ${r.remaining} undrived legacy episodes would be derived with ${r.model} on ${r.provider} at ${r.base} (embeddings: ${r.embedModel} on Ollama); nothing written.`);
    for (const c of r.candidates) {
      console.log(`  ${c.uuid.slice(0, 8)}  ${c.validAt.slice(0, 10)}  ${c.source.padEnd(20)}  ${String(c.chars).padStart(6)} ch  ${c.preview.slice(0, 80)}`);
    }
  } else {
    // A zero-yield 'derived' row (0 statements, 0 voice) is not actually
    // retired (backfill.ts UNDRIVED_WHERE) and will be offered again.
    const derivedEmpty = r.results.filter((e) => e.outcome === "derived" && e.statements === 0 && e.voiceAspects === 0).length;
    const stillUndrived = r.remaining - (r.derived - derivedEmpty) - r.nothing;
    console.log(`\nrun ${r.runId} (${r.model} on ${r.provider} at ${r.base}): ${r.derived} derived, ${r.nothing} nothing to remember, ${r.failed} failed in ${(r.ms / 1000).toFixed(1)} s; ${stillUndrived} still undrived` + (derivedEmpty ? ` (${derivedEmpty} derived nothing usable, will be offered again)` : ""));
    for (const e of r.results) {
      const head = `  ${e.uuid.slice(0, 8)}  ${e.validAt.slice(0, 10)}  ${e.outcome.padEnd(8)}`;
      if (e.outcome === "failed") { console.log(`${head}  ${e.error}`); continue; }
      const sa = Object.entries(e.statementAspects).map(([k, v]) => `${k} ${v}`).join(", ") || "-";
      const va = Object.entries(e.voiceAspectKinds).map(([k, v]) => `${k} ${v}`).join(", ") || "-";
      const empty = e.outcome === "derived" && e.statements === 0 && e.voiceAspects === 0 ? "  (will retry)" : "";
      console.log(`${head}  facts: ${sa}  voice: ${va}  (${(e.ms / 1000).toFixed(1)} s)${empty}`);
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
