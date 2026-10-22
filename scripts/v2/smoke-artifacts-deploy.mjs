// Artifacts deploy smoke, offline (S31, 2026-10-01: Artifacts never deployed on Windows).
//   A. the old failure, as evidence: on Windows a bare spawn("netlify") of an npm .cmd shim
//      is ENOENT; resolveCli turns the shim into node + its entry (or a real exe), and says
//      "not on PATH" when nothing is there
//   B. a fake netlify on a temp PATH that records its argv and exits 0: publish ok, the item
//      is listed, the page is in published/, argv carries deploy --prod --dir <published>
//      --site <id> --no-build, the URL comes from the settings base URL
//   C. the site from settings.artifacts beats ~/.agentic-os/artifacts-site.json; the file is
//      only read when the settings site ID is blank, and is labelled as the source
//   D. no site anywhere: publish and unpublish are refused with a message that names the gear,
//      and netlify is never run
//   E. the fake exits 1: the v2.54.3 rollback holds (nothing listed, the new copy exiled, an
//      updated page restored, a failed unpublish keeps the page and its listing)
//   F. the fake exits 0 for unpublish: the page leaves published/ into an .exile outside it
//   G. netlify missing from PATH: a clear "not found" with the install hint, nothing published
//   H. the SEO deploy route resolves npx/netlify the same way; the tab carries the gear; the
//      GET route reports the site with its source
// No real netlify, no network. HOME / USERPROFILE and every store point at a temp dir (rule 19).
// Run: npx tsx scripts/v2/smoke-artifacts-deploy.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-artifacts-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

const IS_WIN = process.platform === "win32";
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400)}]`}`);
  if (!cond) failures++;
};
const walk = (root) => {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const rec = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); e.isDirectory() ? rec(q) : out.push(path.relative(root, q).split(path.sep).join("/")); } };
  rec(root);
  return out;
};

// ── the fake netlify: an npm-style .cmd shim + the Node entry it launches ─────────────────
const bin = path.join(tmp, "bin");
const entryDir = path.join(bin, "node_modules", "netlify-cli", "bin");
fs.mkdirSync(entryDir, { recursive: true });
const argvLog = path.join(tmp, "netlify-argv.log");
process.env.FAKE_NETLIFY_LOG = argvLog;
process.env.FAKE_NETLIFY_EXIT = "0";
const recorder = [
  '#!/usr/bin/env node',
  'const fs = require("node:fs");',
  'fs.appendFileSync(process.env.FAKE_NETLIFY_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");',
  'console.log("Website URL: https://smoke.invalid");',
  'process.exit(Number(process.env.FAKE_NETLIFY_EXIT || 0));',
  "",
].join("\n");
fs.writeFileSync(path.join(entryDir, "run.js"), recorder, "utf8");
// Exactly the shape npm writes into %APPDATA%\npm\netlify.cmd (a bash shim beside it, as npm does).
const shim = [
  "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0",
  'SET "_prog=node"',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\netlify-cli\\bin\\run.js" %*',
  "",
].join("\r\n");
fs.writeFileSync(path.join(bin, "netlify.cmd"), shim, "utf8");
fs.writeFileSync(path.join(bin, "netlify"), IS_WIN ? "#!/bin/sh\nexec node \"$(dirname \"$0\")/node_modules/netlify-cli/bin/run.js\" \"$@\"\n" : recorder, { encoding: "utf8", mode: 0o755 });
const emptyBin = path.join(tmp, "empty-bin");
fs.mkdirSync(emptyBin, { recursive: true });
const argvLines = () => fs.existsSync(argvLog) ? fs.readFileSync(argvLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// ── A. the old spawn vs the resolver ───────────────────────────────────────────────────────
{
  const { resolveCli, whichAll } = await import("../../src/lib/platform.ts");
  const old = spawnSync("netlify", ["--version"], { env: { ...process.env, PATH: bin }, encoding: "utf8" });
  check("A1 evidence: a bare spawn of the npm .cmd shim is ENOENT on Windows (the old deploy())", IS_WIN ? old.error?.code === "ENOENT" : old.status === 0, { error: old.error?.code, status: old.status });
  const r = resolveCli("netlify", bin);
  check("A2 resolveCli runs the shim's Node entry with node (no shell), or the script itself elsewhere",
    !("error" in r) && (IS_WIN ? (r.cmd === process.execPath && /run\.js$/.test(r.pre[0]) && /netlify\.cmd$/i.test(r.found)) : (r.pre.length === 0 && /netlify$/.test(r.cmd))), r);
  const probe = "error" in r ? null : spawnSync(r.cmd, [...r.pre, "--version"], { env: { ...process.env, PATH: bin }, encoding: "utf8" });
  check("A3 the resolved command actually runs and the fake records its argv", probe?.status === 0 && argvLines().at(-1)?.[0] === "--version", probe?.stderr);
  check("A4 whichAll on an empty PATH finds nothing; resolveCli says not on PATH", whichAll("netlify", emptyBin).length === 0 && /not on PATH/.test(resolveCli("netlify", emptyBin).error || ""));
  if (IS_WIN) {
    const npx = resolveCli("npx");
    check("A5 the machine's own npx.cmd resolves to node + npx-cli.js (never npm-prefix.js)", !("error" in npx) && /npx-cli\.js$/i.test(npx.pre[0] || ""), npx);
  }
  fs.writeFileSync(argvLog, "", "utf8");
}

// ── B. publish through the fake ─────────────────────────────────────────────────────────────
process.env.PATH = bin;   // the fake is the only netlify a deploy can find from here on
const S = await import("../../src/lib/settings.ts");
S.writeSettings({ artifacts: { siteId: "site-from-settings", name: "Smoke site", baseUrl: "https://smoke.invalid/" } });
const ag = path.join(tmp, ".agentic-os");
fs.mkdirSync(path.join(ag, "loop-builds"), { recursive: true });
fs.writeFileSync(path.join(ag, "loop-builds", "calc.html"), "<html><head><title>Calc</title></head><body>v1</body></html>", "utf8");
fs.writeFileSync(path.join(ag, "loop-builds", "other.html"), "<html><head><title>Other</title></head><body>o</body></html>", "utf8");
const AR = await import("../../src/lib/claudeArtifacts.ts");
check("B0 the published folder is inside the temp home", AR.PUBLISHED_DIR.startsWith(tmp));
{
  const site = AR.artifactSite();
  check("B1 the site comes from settings, base URL without its trailing slash", site?.source === "settings" && site.siteId === "site-from-settings" && site.baseUrl === "https://smoke.invalid" && site.name === "Smoke site", site);
  const pub = await AR.publish("loop:calc.html");
  const listed = await AR.listPublished();
  check("B2 publish ok: item returned with the settings URL, listed, page written", pub.ok === true && pub.item?.url === "https://smoke.invalid/calc/" && listed.some((i) => i.slug === "calc") && fs.readFileSync(path.join(AR.PUBLISHED_DIR, "calc", "index.html"), "utf8").includes("v1"), pub);
  const argv = argvLines().at(-1) || [];
  const after = (flag) => argv[argv.indexOf(flag) + 1];
  check("B3 netlify argv: deploy --prod --dir <published> --site <settings id> --no-build", argv[0] === "deploy" && argv.includes("--prod") && after("--dir") === AR.PUBLISHED_DIR && after("--site") === "site-from-settings" && argv.includes("--no-build"), argv);
  check("B4 the gallery lists the page", fs.readFileSync(path.join(AR.PUBLISHED_DIR, "index.html"), "utf8").includes('href="/calc/"'));
}

// ── C. settings beat the legacy file ───────────────────────────────────────────────────────
{
  fs.writeFileSync(AR.LEGACY_SITE_FILE, JSON.stringify({ siteId: "site-from-file", name: "Old file", baseUrl: "https://old.invalid" }), "utf8");
  check("C1 with both present the settings site wins", AR.artifactSite()?.siteId === "site-from-settings");
  await AR.publish("loop:calc.html");
  check("C2 ...and the deploy targets the settings site", argvLines().at(-1)?.[argvLines().at(-1).indexOf("--site") + 1] === "site-from-settings");
  S.writeSettings({ artifacts: { siteId: "" } });
  const site = AR.artifactSite();
  check("C3 a blank settings site ID falls back to the file, labelled as such", site?.source === "file" && site.siteId === "site-from-file" && site.baseUrl === "https://old.invalid", site);
  check("C4 the legacy path is exported and named for what it is", /artifacts-site\.json$/.test(AR.LEGACY_SITE_FILE) && /BACK-COMPAT FALLBACK ONLY/.test(fs.readFileSync("src/lib/claudeArtifacts.ts", "utf8")));
}

// ── D. no site anywhere ────────────────────────────────────────────────────────────────────
{
  fs.renameSync(AR.LEGACY_SITE_FILE, AR.LEGACY_SITE_FILE + ".parked");
  check("D1 no settings site and no file: artifactSite() is null", AR.artifactSite() === null);
  const before = argvLines().length;
  const pub = await AR.publish("loop:other.html");
  check("D2 publish is refused with a message that names the gear on the Artifacts tab", pub.ok === false && pub.error === AR.SITE_MISSING && /gear/.test(pub.error) && /Artifacts tab/.test(pub.error), pub);
  const un = await AR.unpublish("calc");
  check("D3 unpublish is refused the same way; the page stays listed", un.ok === false && un.error === AR.SITE_MISSING && (await AR.listPublished()).some((i) => i.slug === "calc"), un);
  check("D4 netlify was never run for either", argvLines().length === before);
  S.writeSettings({ artifacts: { siteId: "site-from-settings", name: "Smoke site", baseUrl: "https://smoke.invalid" } });
  const noUrl = S.writeSettings({ artifacts: { baseUrl: "" } });
  const pub2 = await AR.publish("loop:other.html");
  check("D5 a site without a base URL is refused, naming the gear", pub2.ok === false && pub2.error === AR.SITE_URL_MISSING && noUrl.artifacts.baseUrl === "", pub2);
  S.writeSettings({ artifacts: { baseUrl: "https://smoke.invalid" } });
}

// ── E. the fake fails: the v2.54.3 rollback holds ──────────────────────────────────────────
{
  process.env.FAKE_NETLIFY_EXIT = "1";
  const pub = await AR.publish("loop:other.html");
  const exiled = walk(path.join(ag, ".exile"));
  check("E1 a failed first publish: error says nothing was published, not listed, copy exiled outside published/",
    pub.ok === false && /nothing was published/.test(pub.error || "") && !(await AR.listPublished()).some((i) => i.slug === "other") &&
    !fs.existsSync(path.join(AR.PUBLISHED_DIR, "other")) && exiled.some((f) => /published\/other\/index\.html$/.test(f)), { pub, exiled });
  fs.writeFileSync(path.join(ag, "loop-builds", "calc.html"), "<html><head><title>Calc</title></head><body>v2</body></html>", "utf8");
  const upd = await AR.publish("loop:calc.html");
  check("E2 a failed update restores the previous page and keeps it listed", upd.ok === false && fs.readFileSync(path.join(AR.PUBLISHED_DIR, "calc", "index.html"), "utf8").includes("v1") && (await AR.listPublished()).some((i) => i.slug === "calc"), upd);
  const un = await AR.unpublish("calc");
  check("E3 a failed unpublish keeps the page where it was and listed (it is still live)", un.ok === false && /still live/.test(un.error || "") && fs.existsSync(path.join(AR.PUBLISHED_DIR, "calc", "index.html")) && (await AR.listPublished()).some((i) => i.slug === "calc"), un);
  check("E4 no .exile inside published/ (it would be deployed)", !fs.existsSync(path.join(AR.PUBLISHED_DIR, ".exile")));
  process.env.FAKE_NETLIFY_EXIT = "0";
}

// ── F. unpublish through the fake ──────────────────────────────────────────────────────────
{
  const un = await AR.unpublish("calc");
  const exiled = walk(path.join(ag, ".exile"));
  check("F1 unpublish ok: unlisted, gone from published/, exiled outside it", un.ok === true && !(await AR.listPublished()).some((i) => i.slug === "calc") && !fs.existsSync(path.join(AR.PUBLISHED_DIR, "calc")) && exiled.some((f) => /published\/calc\/index\.html$/.test(f)), { un, exiled });
  const argv = argvLines().at(-1) || [];
  check("F2 the unpublish deploy carried the same flags", argv[0] === "deploy" && argv.includes("--prod") && argv[argv.indexOf("--site") + 1] === "site-from-settings", argv);
}

// ── G. netlify missing from PATH ───────────────────────────────────────────────────────────
{
  process.env.PATH = emptyBin;   // the deploy PATH is read per call, so this takes effect now
  const before = argvLines().length;
  const pub = await AR.publish("loop:other.html");
  check("G1 with no netlify on PATH: the error names the CLI and the install hint; nothing published",
    pub.ok === false && /netlify CLI not found/.test(pub.error || "") && /npm install -g netlify-cli/.test(pub.error || "") && !(await AR.listPublished()).some((i) => i.slug === "other"), pub);
  check("G2 nothing was run", argvLines().length === before);
  process.env.PATH = bin;
}

// ── H. the route, the SEO route and the tab ────────────────────────────────────────────────
{
  const lib = fs.readFileSync("src/lib/claudeArtifacts.ts", "utf8");
  check("H1 claudeArtifacts no longer spawns a bare netlify; it resolves it", !/spawn\("netlify"/.test(lib) && /resolveCli\("netlify"/.test(lib) && /spawn\(cli\.cmd, args/.test(lib));
  const seo = fs.readFileSync("src/app/api/seo/deploy/route.ts", "utf8");
  check("H2 the SEO deploy route resolves npx/netlify the same way and never spawns a bare command", /resolveCli\(cmd, DEPLOY_PATH\)/.test(seo) && /spawn\(cli\.cmd, \[\.\.\.cli\.pre, \.\.\.args\]/.test(seo) && !/spawn\(cmd, args/.test(seo));
  const tab = fs.readFileSync("src/components/ClaudeArtifacts.tsx", "utf8");
  const gear = fs.readFileSync("src/components/ArtifactsSettings.tsx", "utf8");
  check("H3 the Artifacts tab mounts the gear (handed the live site) and says when no site or no base URL is set",
    /<ArtifactsSettings site=\{site\} onSaved=\{load\} \/>/.test(tab) && /No site configured yet: open Configure \(the gear\)/.test(tab) && /has no base URL: open Configure \(the gear\)/.test(tab));
  check("H3b the gear prefills from the legacy file only while settings are blank", /site\?\.source === "file"/.test(gear) && /!a\.siteId &&/.test(gear));
  check("H4 the gear saves settings.artifacts { siteId, name, baseUrl } through ConfigMenu", /<ConfigMenu title="Artifacts settings"/.test(gear) && /save\(\{ artifacts: \{ siteId: siteId\.trim\(\), name: name\.trim\(\), baseUrl:/.test(gear) && /useSettings\(\)/.test(gear));
  const settings = fs.readFileSync("src/lib/settings.ts", "utf8");
  check("H5 settings.ts declares and defaults artifacts", /artifacts: \{ siteId\?: string; name\?: string; baseUrl\?: string \};/.test(settings) && /artifacts: \{ siteId: "", name: "", baseUrl: "" \},/.test(settings));
  const route = await import("../../src/app/api/claude/artifacts/route.ts");
  const j = await (await route.GET()).json();
  check("H6 GET /api/claude/artifacts reports the site with its source", j.site?.siteId === "site-from-settings" && j.site.source === "settings" && Array.isArray(j.published), j.site);
  const docs = fs.readFileSync("docs/modules/claude-cli.md", "utf8");
  check("H7 the module doc describes the gear, not only the file", /Configure/.test(docs) && /settings/.test(docs) && !/needs the `netlify` CLI and a site file at/.test(docs));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
