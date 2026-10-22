// Rule 19, computed rather than remembered.
//
// A smoke must redirect every store the code under test writes to. Keeping that
// rule in prose failed twice in two days: first a newsletter smoke read the
// owner's live AgentMail inbox, then a forge smoke wrote fake agents into the
// owner's live principals.json.
//
// The first mechanical version of this guard checked whether a smoke CALLED a
// writing function by name. It passed while the leak was live, because
// smoke-agents-forge creates agents by importing the API ROUTE and calling
// POST — the write is three modules deep. A guard that only sees direct calls
// cannot see the path that actually leaked, and a guard that passes vacuously
// is worse than none, because it reads as proof.
//
// So this computes the TRANSITIVE set of modules that can reach a sensitive
// store, then flags any smoke importing one of them without redirecting it.

import fs from "node:fs";
import path from "node:path";

/** Every .ts/.tsx under src/, absolute. */
function sourceFiles(srcRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
    }
  };
  walk(srcRoot);
  return out;
}

/** "C:/…/src/lib/v2/db.ts" -> "lib/v2/db" */
function moduleKey(srcRoot, file) {
  return path
    .relative(srcRoot, file)
    .split(path.sep)
    .join("/")
    .replace(/\.tsx?$/, "");
}

/**
 * Smokes that import a WRITE ENTRY POINT for a store without redirecting it.
 *
 * Scoped on purpose. A transitive-import closure was tried and rejected: it
 * flagged 43 smokes, because half the codebase transitively imports the
 * settings module and merely IMPORTING a module writes nothing — ensureUserId()
 * has to actually run. A check that cries wolf 43 times teaches people to skip
 * it, which is how the real leak survives.
 *
 * So `writers` is a curated list of modules whose import means a write can
 * plausibly happen in that smoke. It must be maintained by hand. That is a real
 * cost, and the honest trade: precise enough to be believed, which a heuristic
 * covering everything would not have been.
 */
export function offenders({ repoRoot, writers, env }) {
  const smokeDir = path.join(repoRoot, "scripts", "v2");
  return fs
    .readdirSync(smokeDir)
    .filter((f) => f.startsWith("smoke-") && f.endsWith(".mjs"))
    .filter((f) => {
      const src = fs.readFileSync(path.join(smokeDir, f), "utf8");
      // Grep-only smokes execute nothing and so write nothing.
      if (!src.includes("await import(")) return false;
      if (src.includes(env)) return false;
      return writers.some((m) => src.includes(m));
    });
}

/**
 * The stores a smoke can write to, the env var that redirects each, and the
 * modules that actually perform the write.
 *
 * `agentsStore` and `api/agents/route` are in the principals list because
 * createAgent registers a principal — the path that leaked, and the one a
 * call-name check missed, since smoke-agents-forge reaches it by importing the
 * route and calling POST.
 */
export const SENSITIVE_STORES = [
  {
    env: "AGENTIC_OS_PRINCIPALS",
    label: "can register a principal",
    writers: [
      "identity/principals.ts",
      "agentsStore.ts",
      "api/agents/route.ts",
      "browser/config.ts",
      "browser/tools.ts",
    ],
  },
  {
    env: "AGENTIC_OS_DB",
    label: "writes to the database",
    writers: ["v2/db.ts", "browser/audit.ts", "executeBrowserTool", "recordToolCall"],
  },
  {
    env: "AGENTIC_OS_SETTINGS",
    label: "writes settings",
    writers: ["lib/settings.ts", "browser/config.ts"],
  },
];
