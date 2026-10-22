// smoke-name-guard: the name/slug guard regex shared by ~36 call sites.
//
// The guard used to be /^(?!.+$)[A-Za-z0-9_.-]+$/ — the lookahead rejects EVERY
// non-empty string, so every guarded helper returned null and every guarded
// route answered 400. Fixed 2026-09-14 to /^(?!\.)[A-Za-z0-9_.-]+$/ (no leading
// dot, safe charset). This smoke imports three of the fixed helpers and asserts
// the artifact (the directory) rather than the return value alone:
//
//   §A a plain name is accepted and its project dir is created
//   §B a leading-dot name is rejected and no dir appears
//   §C an empty string is rejected
//   §D path-ish names ("a/b", "..") are rejected (containment relies on this)
//
// Fully OFFLINE. Scratch roots are redirected to a temp dir BEFORE import so
// nothing touches ~/claude-scratch, ~/kimi-scratch or ~/codex-scratch.
// Run: npx tsx scripts/v2/smoke-name-guard.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-name-guard-"));
process.env.AGENTIC_OS_CLAUDE_SCRATCH = path.join(tmp, "claude");
process.env.AGENTIC_OS_KIMI_SCRATCH = path.join(tmp, "kimi");
process.env.AGENTIC_OS_CODEX_SCRATCH = path.join(tmp, "codex");

const claude = await import("../../src/lib/claudeWorkspace.ts");
const kimi = await import("../../src/lib/kimiWorkspace.ts");
const codex = await import("../../src/lib/codexWorkspace.ts");

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const helpers = [
  ["claudeWorkspace.ensureProject", claude.ensureProject, process.env.AGENTIC_OS_CLAUDE_SCRATCH],
  ["kimiWorkspace.ensureProject", kimi.ensureProject, process.env.AGENTIC_OS_KIMI_SCRATCH],
  ["codexWorkspace.ensureProject", codex.ensureProject, process.env.AGENTIC_OS_CODEX_SCRATCH],
];

for (const [name, ensure, root] of helpers) {
  // §A plain name accepted, dir created under the redirected root
  const dir = await ensure("rabbit");
  check(`${name}: "rabbit" accepted`, typeof dir === "string", String(dir));
  check(`${name}: dir is under the temp root`, !!dir && dir.startsWith(root), dir ?? "");
  check(`${name}: dir exists on disk`, !!dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory());
  const dotted = await ensure("uc-1782503473309-aefesb.v2");
  check(`${name}: interior dots/dashes accepted`, typeof dotted === "string", String(dotted));

  // §B leading dot rejected, nothing created
  const hidden = await ensure(".hidden");
  check(`${name}: ".hidden" rejected`, hidden === null, String(hidden));
  check(`${name}: no ".hidden" dir created`, !fs.existsSync(path.join(root, ".hidden")));

  // §C empty string rejected
  const empty = await ensure("");
  check(`${name}: "" rejected`, empty === null, String(empty));

  // §D path-ish names rejected (the containment checks downstream rely on this)
  for (const bad of ["a/b", "..", "a\b", "with space", "..evil"]) {
    const r = await ensure(bad);
    check(`${name}: ${JSON.stringify(bad)} rejected`, r === null, String(r));
  }
}

// The regex itself, as written at every call site — a typo'd replacement
// ("(?!.)" with the backslash eaten) would reject everything again.
const RE = /^(?!\.)[A-Za-z0-9_.-]+$/;
check('regex literal: "rabbit"', RE.test("rabbit"));
check('regex literal: ".x" rejected', !RE.test(".x"));
check('regex literal: "" rejected', !RE.test(""));

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
