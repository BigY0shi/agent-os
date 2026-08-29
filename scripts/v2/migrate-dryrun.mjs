// A9 utility: dry-run the legacy importers against the REAL stores from the
// CLI (read-only — parses files, never touches the DB or the stores).
//   npx tsx scripts/v2/migrate-dryrun.mjs [source ...]
// Sources: memsearch jarvis agents remember (default: all four).
import { collectItems, MIGRATION_SOURCES } from "../../src/lib/v2/memory/migrate.ts";

const args = process.argv.slice(2).filter((a) => MIGRATION_SOURCES.includes(a));
const sources = args.length > 0 ? args : [...MIGRATION_SOURCES];

for (const source of sources) {
  const r = collectItems(source);
  const bytes = r.items.reduce((s, it) => s + Buffer.byteLength(it.episodeBody, "utf8"), 0);
  console.log(`${source}: found=${r.items.length} skipped=${r.skipped} files=${r.filesScanned} (${(bytes / 1024).toFixed(1)} KB)`);
  for (const it of r.items.slice(0, 3)) {
    console.log(`   sample ${it.referenceTime}  ${String(it.metadata.originFile)}  (${it.episodeBody.length} ch)`);
  }
}
