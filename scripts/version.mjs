// Semver bookkeeping for agent-os.
//
//   node scripts/version.mjs --check    -> fail if package.json is behind the commits
//   node scripts/version.mjs --bump     -> bump per conventional commits since the last tag
//   node scripts/version.mjs --bump patch|minor|major   -> force a level
//   node scripts/version.mjs --release  -> print the tag + release-note skeleton
//
// Why this exists: on 2026-08-31 package.json still said 2.0.0 with SEVEN
// shipped commits behind the v2.0.0 tag. A version that does not move is worse
// than no version, because it actively asserts something false about the build
// you are running. MissionStripe.tsx already had a fabricated BUILD tag ripped
// out for the same reason - the fix is a real number, maintained.
//
// The changelog is the GitHub RELEASE BODY, not CHANGELOG.md. That file is
// inherited from upstream (member-facing notes, "Thanks Ridz") and is not ours
// to rewrite; --release prints notes to paste into `gh release create`.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PKG = path.join(ROOT, "package.json");

const sh = (cmd) => execSync(cmd, { encoding: "utf8", cwd: ROOT }).trim();
const readPkg = () => JSON.parse(fs.readFileSync(PKG, "utf8"));

/**
 * The highest semver tag in the repo - NOT `git describe`.
 *
 * Releases are tagged on `local-main` (v2.0.0 sits on the PR #10 merge commit),
 * while feature work continues on branches that forked before that merge. So
 * the newest tag is routinely NOT an ancestor of HEAD, and `git describe`
 * honestly reports v1.0.0 - which would have this script compare against a
 * release two versions stale. `tag..HEAD` still works when the tag is
 * unreachable: it means "reachable from HEAD, not from the tag", which is
 * exactly the set of commits we have not shipped.
 */
function lastTag() {
  try {
    const tags = sh("git tag --sort=-v:refname --list v*")
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    return tags[0] ?? null;
  } catch {
    return null;
  }
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const out = sh(`git log --format=%s%x00%b%x1e ${range}`);
  if (!out) return [];
  return out
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ""] = entry.split("\x00");
      return { subject: subject.trim(), body: body.trim() };
    });
}

/**
 * Conventional-commit -> semver level.
 *
 * A `!` after the type, or a BREAKING CHANGE footer, forces major. Anything
 * that is not feat/fix/perf/refactor (docs, chore, test, style) still counts as
 * a patch when it ships alongside real changes, but on its own it will not
 * force a bump - see levelFor's caller.
 */
function levelFor(commits) {
  let level = null;
  for (const { subject, body } of commits) {
    const m = subject.match(/^(\w+)(\([^)]*\))?(!)?:/);
    if (!m) continue;
    const [, type, , bang] = m;
    if (bang || /^BREAKING[ -]CHANGE:/m.test(body)) return "major";
    if (type === "feat") level = level === "minor" ? level : "minor";
    else if (level !== "minor" && ["fix", "perf", "refactor", "test", "chore", "docs", "style"].includes(type)) {
      level ??= "patch";
    }
  }
  return level;
}

const bumpVersion = (v, level) => {
  const [maj, min, pat] = v.split(".").map(Number);
  if (level === "major") return `${maj + 1}.0.0`;
  if (level === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
};

const cmp = (a, b) => {
  const A = a.split(".").map(Number), B = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
};

const args = process.argv.slice(2);
const mode = args[0] ?? "--check";
const forced = args[1];

const pkg = readPkg();
const tag = lastTag();
const tagVersion = tag?.replace(/^v/, "") ?? null;
const commits = commitsSince(tag);
const level = forced ?? levelFor(commits);

if (mode === "--check") {
  console.log(`package.json ${pkg.version}   last tag ${tag ?? "(none)"}   commits since ${commits.length}`);
  if (commits.length === 0) {
    console.log("PASS  nothing shipped since the tag");
    process.exit(0);
  }
  if (tagVersion && cmp(pkg.version, tagVersion) <= 0) {
    console.error(
      `\nFAIL  ${commits.length} commit(s) landed since ${tag} but package.json is still ${pkg.version}.` +
      `\n      Run: node scripts/version.mjs --bump   (suggests ${bumpVersion(tagVersion, level ?? "patch")})`,
    );
    for (const c of commits) console.error(`        ${c.subject}`);
    process.exit(1);
  }
  console.log(`PASS  package.json ${pkg.version} is ahead of ${tag}`);
  process.exit(0);
}

if (mode === "--bump") {
  if (!level && !forced) {
    console.log("nothing to bump — no conventional commits since the last tag");
    process.exit(0);
  }
  // Bump from whichever is higher: the tag, or the current package version.
  const base = tagVersion && cmp(tagVersion, pkg.version) > 0 ? tagVersion : pkg.version;
  const next = bumpVersion(base, level);
  pkg.version = next;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");

  // package-lock.json carries the version in TWO places (the root, and the ""
  // entry under `packages`). `npm version` keeps them in step; a hand-rolled
  // bump that touches only package.json leaves the lock disagreeing with the
  // manifest, which is the sort of drift that surfaces as a confusing install.
  const LOCK = path.join(ROOT, "package-lock.json");
  if (fs.existsSync(LOCK)) {
    const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    lock.version = next;
    if (lock.packages?.[""]) lock.packages[""].version = next;
    fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");
    console.log(`  package-lock.json synced to ${next}`);
  }

  console.log(`${base} -> ${next}  (${level}, from ${commits.length} commit(s) since ${tag ?? "the beginning"})`);
  process.exit(0);
}

if (mode === "--release") {
  const v = pkg.version;
  console.log(`# tag + release for v${v}\n`);
  console.log(`git tag -a v${v} -m "v${v}"`);
  console.log(`git push origin v${v}`);
  console.log(`\n# release notes (the changelog lives HERE, not in CHANGELOG.md):\n`);
  const feats = commits.filter((c) => /^feat/.test(c.subject));
  const fixes = commits.filter((c) => /^fix|^perf/.test(c.subject));
  const other = commits.filter((c) => !feats.includes(c) && !fixes.includes(c));
  const fmt = (c) => `- ${c.subject.replace(/^\w+(\([^)]*\))?!?:\s*/, "")}`;
  if (feats.length) console.log(`### Added\n${feats.map(fmt).join("\n")}\n`);
  if (fixes.length) console.log(`### Fixed\n${fixes.map(fmt).join("\n")}\n`);
  if (other.length) console.log(`### Internal\n${other.map(fmt).join("\n")}\n`);
  process.exit(0);
}

console.error(`unknown mode ${mode} — use --check | --bump [level] | --release`);
process.exit(2);
