// SPEC-E X.1 smoke: browser config/manager/tools/allowlist/audit/capability/skill-seed.
// Run: npx tsx scripts/v2/smoke-browser.mjs   (flags: --config-only skips launches)
//
// Offline-first: a local HTTP fixture serves an "Example Domain" page, so every
// leg passes with no network. If https://example.com is reachable it is ALSO
// exercised for the canonical navigate leg (spec §9 step 4); otherwise the
// fixture stands in (noted in output).
//
// AGENTIC_OS_* env BEFORE any import: temp DB, temp settings, temp profile root
// — the live stores are never touched. The one real-home write is the
// browser-driving SKILL.md seed (identical to what boot does; additive,
// idempotent, never overwrites).
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const CONFIG_ONLY = process.argv.includes("--config-only");

const tmpDb = path.join(os.tmpdir(), `agentos-smoke-e-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-e-settings-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
const profilesRootTmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-e-profiles-"));
process.env.AGENTIC_OS_BROWSER_PROFILES = profilesRootTmp;

const config = await import("../../src/lib/v2/browser/config.ts");
const manager = await import("../../src/lib/v2/browser/manager.ts");
const tools = await import("../../src/lib/v2/browser/tools.ts");
const audit = await import("../../src/lib/v2/browser/audit.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");
const { getManifest } = await import("../../src/lib/v2/capability/manifest.ts");
const { browserSlot } = await import("../../src/lib/v2/capability/slots.ts");
const registry = await import("../../src/lib/v2/mcp/registry.ts");
const { handleMcpMessage } = await import("../../src/lib/v2/mcp/server.ts");
const { readSettings, writeSettings } = await import("../../src/lib/settings.ts");
const { seedBrowserDrivingSkill, BROWSER_SKILL_NAME } = await import(
  "../../src/lib/v2/browser/skillSeed.ts"
);
const platformSkills = await import("../../src/lib/platformSkills.ts");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};
const note = (msg) => console.log(`NOTE  ${msg}`);

// ───────────────────────── §A config-only legs ─────────────────────────
console.log("\n── §A profiles/sessions config ──");

{
  const profiles = config.getConfiguredProfiles();
  check("A1 default profiles personal/work/misc", ["personal", "work", "misc"].every((p) => profiles.includes(p)));

  check("A2 create smoke_p ok", config.createProfile("smoke_p").success);
  check("A3 duplicate refused", !config.createProfile("smoke_p").success);
  check("A4 invalid name refused", !config.createProfile("../evil").success);
  check("A5 list contains smoke_p", config.getConfiguredProfiles().includes("smoke_p"));
  check("A6 5th profile ok", config.createProfile("smoke_p2").success);
  check("A7 6th profile refused (max 5)", !config.createProfile("smoke_p3").success);

  // exile: seed a marker file so we can prove the MOVE.
  const dir = config.getProfileDir("smoke_p");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "marker.txt"), "auth-state", "utf8");
  check("A8 session on smoke_p ok", config.createSessionConfig("smoke_bound", "smoke_p").success);
  const ex = config.exileProfile("smoke_p");
  check("A9 exileProfile ok", ex.success && Boolean(ex.exiledTo), ex.error ?? "");
  check("A10 original dir GONE", !fs.existsSync(dir));
  check(
    "A11 exiled dir holds the marker (moved, not deleted)",
    ex.exiledTo && fs.existsSync(path.join(ex.exiledTo, "marker.txt")),
  );
  check("A12 exiled under profilesRoot/.exile", ex.exiledTo?.startsWith(path.join(profilesRootTmp, ".exile")));
  check("A13 profile removed from settings", !config.getConfiguredProfiles().includes("smoke_p"));
  check("A14 bound session removed too", !config.isSessionConfigured("smoke_bound"));

  check("A15 session create smoke_s→misc", config.createSessionConfig("smoke_s", "misc").success);
  check("A16 duplicate session refused", !config.createSessionConfig("smoke_s", "misc").success);
  check("A17 session on unknown profile refused", !config.createSessionConfig("smoke_x", "nope").success);
  check("A18 getSessionConfig round trip", config.getSessionConfig("smoke_s")?.profile === "misc");
  check("A19 delete session config ok", config.deleteSessionConfig("smoke_s").success);
  check("A20 detectAvailableBrowsers has no opera entry", config.detectAvailableBrowsers().every((b) => b.type !== "opera" && !/opera/i.test(b.path)));

  // getProfileDir traversal defense
  let threw = false;
  try {
    config.getProfileDir("../outside");
  } catch {
    threw = true;
  }
  check("A21 getProfileDir rejects traversal names", threw);
}

// ───────────────────────── §B capability gate (disabled first) ─────────────────────────
console.log("\n── §B capability slot gating ──");

{
  check("B1 browserEnabled defaults false", tools.isBrowserCapabilityEnabled() === false);
  const res = await tools.executeBrowserTool("browser_list_sessions", {}, { caller: "smoke" });
  check("B2 tool dispatch refuses CAPABILITY_DISABLED", !res.ok && res.error.code === "CAPABILITY_DISABLED");
  const slotRes = await browserSlot("browser_list_sessions", {});
  check("B3 browserSlot refuses too", !slotRes.ok && /CAPABILITY_DISABLED/.test(slotRes.error ?? ""));

  const entryOff = getManifest().find((e) => e.key === "browser");
  check("B4 manifest browser disabled + zero actions", entryOff && !entryOff.enabled && entryOff.actions.length === 0);

  // MCP path syncs registration to settings per request.
  await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { source: "smoke", strict: true });
  check("B5 disabled ⇒ browser_navigate ABSENT from action registry", registry.getAction("browser_navigate") === undefined);

  // Enable and re-check.
  writeSettings({ capability: { ...(readSettings().capability ?? {}), browserEnabled: true } });
  const entryOn = getManifest().find((e) => e.key === "browser");
  check("B6 enabled ⇒ manifest lists all 18 tools", entryOn?.enabled === true && entryOn.actions.length === 18);
  await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { source: "smoke", strict: true });
  check("B7 enabled ⇒ browser_navigate registered as F4 action", registry.getAction("browser_navigate")?.module === "browser");

  const mcpRes = await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "execute_action", arguments: { key: "browser_list_sessions", args: {} } },
    },
    { source: "smoke", strict: true },
  );
  const mcpText = mcpRes?.result?.content?.[0]?.text ?? "";
  check("B8 MCP execute_action browser_list_sessions ok", !mcpRes?.result?.isError && mcpText.includes("maxSessions"));

  const unknown = await tools.executeBrowserTool("browser_nope", {}, { caller: "smoke" });
  check("B9 unknown tool → TOOL_NOT_FOUND", !unknown.ok && unknown.error.code === "TOOL_NOT_FOUND");
  const notCfg = await tools.executeBrowserTool("browser_snapshot", { session: "ghost_session" }, { caller: "smoke" });
  check("B10 unconfigured session → SESSION_NOT_CONFIGURED", !notCfg.ok && notCfg.error.code === "SESSION_NOT_CONFIGURED");
}

// ───────────────────────── §G E4.1 grep invariant (always runs) ─────────────────────────
console.log("\n── §G E4.1 isolation invariants ──");

{
  const srcRoot = path.resolve(import.meta.dirname, "../../src");
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".exile") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
        const text = fs.readFileSync(full, "utf8");
        let idx = text.indexOf("launchPersistentContext(");
        while (idx !== -1) {
          hits.push(full);
          idx = text.indexOf("launchPersistentContext(", idx + 1);
        }
      }
    }
  };
  walk(srcRoot);
  check(
    "G1 launchPersistentContext called in EXACTLY 1 place (manager.ts)",
    hits.length === 1 && hits[0].endsWith(path.join("browser", "manager.ts")),
    hits.join(", "),
  );
  const managerSrc = fs.readFileSync(path.join(srcRoot, "lib", "v2", "browser", "manager.ts"), "utf8");
  // The invariant is UNCHANGED in substance: the launcher never accepts an
  // arbitrary directory. What changed is that there are now two non-arbitrary
  // candidates, because the persist-credentials answer has to actually decide
  // something — before resolveLaunchDir, a non-persistent agent still launched
  // against the durable dir and kept its cookies, so the setting was cosmetic.
  check(
    "G2 its dir arg comes from resolveLaunchDir(profile), never a caller",
    /const \{ dir: profileDir[^}]*\} = resolveLaunchDir\(sessionConfig\.profile\);[\s\S]*?launchPersistentContext\(profileDir,/.test(managerSrc),
  );
  const cfgSrc = fs.readFileSync(path.join(srcRoot, "lib", "v2", "browser", "config.ts"), "utf8");
  check(
    "G2b resolveLaunchDir returns ONLY getProfileDir or ephemeralProfileDir",
    /persistent \? getProfileDir\(profileName\) : ephemeralProfileDir\(profileName\)/.test(cfgSrc),
  );
  check(
    "G2c both candidates validate the profile name (no traversal either way)",
    (cfgSrc.match(/if \(!NAME_RE\.test\(profileName\)\)/g) ?? []).length >= 2,
  );
  // No Opera PATH/type literals anywhere in the browser lib (comments
  // documenting the ban are fine — executable strings are not).
  const browserLibDir = path.join(srcRoot, "lib", "v2", "browser");
  const libSrc = fs
    .readdirSync(browserLibDir)
    .map((f) => fs.readFileSync(path.join(browserLibDir, f), "utf8"))
    .join("\n");
  check(
    "G3 no opera executable path or browserType literal in browser lib",
    !/["'`][^"'`\n]*opera[^"'`\n]*\.exe["'`]/i.test(libSrc) && !/["']opera["']/.test(libSrc),
  );
}

// ───────────────────────── §H skill seed (always runs) ─────────────────────────
console.log("\n── §H browser-driving skill seed ──");

{
  // Temp-dir seed proves file mechanics + idempotency without touching home.
  const tmpSkills = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-e-skills-"));
  const first = seedBrowserDrivingSkill(tmpSkills);
  check("H1 first seed writes SKILL.md", first.wroteFile && fs.existsSync(path.join(tmpSkills, BROWSER_SKILL_NAME, "SKILL.md")));
  check("H2 first seed registers settings.skills.modules.browser", first.registered && (readSettings().skills?.modules?.browser ?? []).includes(BROWSER_SKILL_NAME));
  const second = seedBrowserDrivingSkill(tmpSkills);
  check("H3 second seed is a no-op (idempotent)", !second.wroteFile && !second.registered);
  const body = fs.readFileSync(path.join(tmpSkills, BROWSER_SKILL_NAME, "SKILL.md"), "utf8");
  check("H4 seed content: snapshot-first + login-wall stop + headed", /browser_snapshot before the first interaction/.test(body) && /STOP and report back/.test(body) && /headed handoff/.test(body));

  // Real-lane injection: seed into the REAL skills dir (exactly what boot
  // does — additive, never overwrites) and assert withSkills injects ONCE.
  seedBrowserDrivingSkill();
  const wrapped = platformSkills.withSkills("do the thing", "browser");
  const headerCount = wrapped.split("Operating skill: browser-driving").length - 1;
  check("H5 withSkills('x','browser') contains the skill once", headerCount === 1, `count=${headerCount}`);
  const doubleWrapped = platformSkills.withSkills(wrapped, "browser");
  check("H6 double-wrap guard: still once", doubleWrapped.split("Operating skill: browser-driving").length - 1 === 1);
}

if (CONFIG_ONLY) {
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"} (config-only run)`);
  process.exit(failures === 0 ? 0 : 1);
}

// ───────────────────────── fixture server ─────────────────────────
const fixture = http.createServer((req, res) => {
  if (req.url?.startsWith("/blocked")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head><title>Blocked Target</title></head><body>should never render</body></html>");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<html><head><title>Example Domain</title></head><body>
    <h1>Example Domain</h1>
    <p>This domain is for use in illustrative examples in documents.</p>
    <a id="frag-link" href="#more">ClickMe</a>
    <input id="name-box" placeholder="name" />
    <a id="blocked-link" href="__BLOCKED__">Go blocked</a>
  </body></html>`.replace("__BLOCKED__", `http://localhost:${fixturePort}/blocked`));
});
let fixturePort = 0;
await new Promise((resolve) => fixture.listen(0, () => resolve(null)));
fixturePort = fixture.address().port;
const fixtureUrl = `http://127.0.0.1:${fixturePort}/`;
note(`fixture server on ${fixtureUrl} (blocked-host alias: localhost:${fixturePort})`);

// example.com reachability probe (3s) — spec §9 step 4 canonical target.
let exampleReachable = false;
try {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  const r = await fetch("https://example.com", { signal: ctl.signal });
  exampleReachable = r.ok;
  clearTimeout(t);
} catch {
  exampleReachable = false;
}
note(exampleReachable ? "example.com reachable — using it for the canonical navigate leg" : "example.com UNREACHABLE — local fixture stands in (spec §9 fallback)");
const primaryUrl = exampleReachable ? "https://example.com" : fixtureUrl;

// ───────────────────────── §C launch leg ─────────────────────────
console.log("\n── §C launch / relaunch ──");

{
  check("C0 session smoke_s→misc", config.createSessionConfig("smoke_s", "misc").success);
  const t0 = Date.now();
  const { session, error } = await manager.getOrLaunchSession("smoke_s", false, { caller: "smoke" });
  const elapsed = Date.now() - t0;
  check("C1 launch ok", Boolean(session) && !error, error ?? "");
  const cdp = manager.getSessionCdpInfo("smoke_s");
  check(`C2 cdpReady within 8s (took ${elapsed}ms)`, Boolean(cdp) && elapsed < 8000);
  if (cdp) {
    const v = await fetch(`${cdp.httpEndpoint}/json/version`).then((r) => r.json()).catch(() => null);
    check("C3 /json/version reachable + ws url", Boolean(v?.webSocketDebuggerUrl));
  } else {
    check("C3 /json/version reachable + ws url", false, "no cdp info");
  }
  const cdpHttp = cdp?.httpEndpoint;

  const closed = await manager.closeSession("smoke_s");
  check("C4 close ok", closed.success);
  check("C5 live map empty after close", manager.getLiveSessions().length === 0);
  if (cdpHttp) {
    const dead = await fetch(`${cdpHttp}/json/version`).then(() => true).catch(() => false);
    check("C6 chromium actually gone (CDP port dead — no orphan)", dead === false);
  }

  const relaunch = await manager.launchSession("smoke_s", false, { caller: "smoke" });
  check("C7 relaunch ok", Boolean(relaunch.session), relaunch.error ?? "");
  check("C8 cdp captured again", Boolean(manager.getSessionCdpInfo("smoke_s")));

  // §8 risk 5: second live session on the SAME profile refuses, naming holder.
  check("C9 second session config on misc", config.createSessionConfig("smoke_s2", "misc").success);
  const clash = await manager.getOrLaunchSession("smoke_s2", false, { caller: "smoke" });
  check("C10 same-profile second launch refused naming holder", !clash.session && /smoke_s/.test(clash.error ?? ""), clash.error ?? "");
}

// ───────────────────────── §D tool legs ─────────────────────────
console.log("\n── §D tools over the live session ──");

const call = (tool, args) => tools.executeBrowserTool(tool, args, { caller: "smoke" });

{
  const nav = await call("browser_navigate", { url: primaryUrl, session: "smoke_s" });
  check("D1 navigate primary ok", nav.ok && /Example Domain/.test(nav.result?.title ?? ""), JSON.stringify(nav));

  const snap = await call("browser_snapshot", { session: "smoke_s" });
  check("D2 snapshot contains 'Example Domain'", snap.ok && /Example Domain/.test(snap.result?.snapshot ?? ""));

  const evalRes = await call("browser_evaluate", { script: "document.title", session: "smoke_s" });
  check("D3 evaluate document.title", evalRes.ok && evalRes.result?.value === "Example Domain");

  const shot = await call("browser_screenshot", { session: "smoke_s" });
  const b64 = shot.ok ? shot.result?.screenshot ?? "" : "";
  const sig = Buffer.from(b64, "base64").subarray(0, 8);
  check("D4 screenshot decodes as PNG", shot.ok && sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));

  // Fixture-page interaction legs (deterministic DOM).
  const nav2 = await call("browser_navigate", { url: fixtureUrl, session: "smoke_s" });
  check("D5 navigate fixture ok", nav2.ok);
  await call("browser_wait_for", { state: "domcontentloaded", session: "smoke_s" });
  const click = await call("browser_click", { element: "ClickMe", session: "smoke_s" });
  check("D6 click by text ok", click.ok, JSON.stringify(click));
  const fill = await call("browser_fill", { element: "name box", ref: "#name-box", value: "s3cret-value-xyz", session: "smoke_s" });
  check("D7 fill by ref ok", fill.ok, JSON.stringify(fill));
  const typed = await call("browser_type", { element: "name box", ref: "#name-box", text: "-typed", session: "smoke_s" });
  check("D8 type by ref ok", typed.ok);
  const key = await call("browser_press_key", { key: "Tab", session: "smoke_s" });
  check("D9 press_key ok", key.ok);
  const scroll = await call("browser_scroll", { deltaY: 100, session: "smoke_s" });
  check("D10 scroll ok", scroll.ok);
  const back = await call("browser_go_back", { session: "smoke_s" });
  check("D11 go_back ok", back.ok);
  const fwd = await call("browser_go_forward", { session: "smoke_s" });
  check("D12 go_forward ok", fwd.ok);

  const list = await call("browser_list_sessions", {});
  const row = list.ok ? (list.result?.sessions ?? []).find((s) => s.name === "smoke_s") : null;
  check("D13 list_sessions shows smoke_s live:true", Boolean(row?.live));

  // create/delete session via tools (also writes a browser_sessions history row)
  const created = await call("browser_create_session", { session: "smoke_tool_made", profile: "work" });
  check("D14 create_session tool ok", created.ok);
  const deleted = await call("browser_delete_session", { session: "smoke_tool_made" });
  check("D15 delete_session tool ok (config only)", deleted.ok && !config.isSessionConfigured("smoke_tool_made"));
}

// ───────────────────────── §E allowlist legs ─────────────────────────
console.log("\n── §E allowlist (E3.3/E4) ──");

{
  await manager.closeSession("smoke_s"); // free a slot; keep launches minimal
  check("E0 locked session config (allow 127.0.0.1 only)", config.createSessionConfig("smoke_locked", "work", ["127.0.0.1"]).success);

  const okNav = await call("browser_navigate", { url: fixtureUrl, session: "smoke_locked" });
  check("E1 allowed host navigates", okNav.ok, JSON.stringify(okNav));

  const blocked = await call("browser_navigate", { url: `http://localhost:${fixturePort}/blocked`, session: "smoke_locked" });
  check("E2 blocked host → DOMAIN_BLOCKED", !blocked.ok && blocked.error.code === "DOMAIN_BLOCKED");
  check("E3 DOMAIN_BLOCKED message names host + settings", !blocked.ok && /localhost/.test(blocked.error.message) && /Browser settings/.test(blocked.error.message));

  // Route-guard defense-in-depth: a PAGE link-click to the blocked host is
  // aborted by the context.route document guard (bypasses browser_navigate).
  await call("browser_wait_for", { state: "domcontentloaded", session: "smoke_locked" });
  await call("browser_click", { element: "Go blocked", ref: "#blocked-link", session: "smoke_locked" });
  await new Promise((r) => setTimeout(r, 800)); // give an (aborted) nav time
  // The abort commits a chrome-error page (host 'chromewebdata') — the point
  // is the BLOCKED DOCUMENT never rendered: never on host 'localhost', never
  // titled 'Blocked Target'.
  const after = await call("browser_evaluate", {
    script: "({ host: location.hostname, title: document.title, body: document.body ? document.body.innerText.slice(0,100) : '' })",
    session: "smoke_locked",
  });
  const av = after.ok ? after.result?.value ?? {} : {};
  check(
    "E4 link-click to blocked host aborted (blocked document never rendered)",
    after.ok && av.host !== "localhost" && av.title !== "Blocked Target" && !/should never render/.test(av.body ?? ""),
    JSON.stringify(after),
  );

  await manager.closeSession("smoke_locked");
}

// ───────────────────────── §F audit legs ─────────────────────────
console.log("\n── §F audit rows (E1.4/E4.1c) ──");

{
  await tools.executeBrowserTool("browser_close_all", {}, { caller: "smoke" });

  const db = getDb();
  const auditRows = db.prepare("SELECT tool, caller, ok, error, args_preview FROM browser_tool_audit").all();
  const toolsSeen = new Set(auditRows.map((r) => r.tool));
  const expectTools = [
    "browser_navigate", "browser_snapshot", "browser_evaluate", "browser_screenshot",
    "browser_click", "browser_fill", "browser_type", "browser_press_key", "browser_scroll",
    "browser_go_back", "browser_go_forward", "browser_wait_for", "browser_list_sessions",
    "browser_create_session", "browser_delete_session", "browser_close_all",
  ];
  check("F1 audit rows for every tool exercised", expectTools.every((t) => toolsSeen.has(t)), [...expectTools.filter((t) => !toolsSeen.has(t))].join(","));
  // 'mcp:smoke' = the B8 execute_action leg (MCP callers stamp mcp:<source>).
  check("F2 every row carries its caller", auditRows.every((r) => ["smoke", "user", "mcp:smoke"].includes(r.caller)));

  const blockedRow = auditRows.find((r) => /DOMAIN_BLOCKED/.test(r.error ?? ""));
  check("F3 DOMAIN_BLOCKED denial audited (ok=0)", Boolean(blockedRow) && blockedRow.ok === 0);
  const disabledRow = auditRows.find((r) => /capability disabled/.test(r.error ?? ""));
  check("F4 CAPABILITY_DISABLED denial audited", Boolean(disabledRow) && disabledRow.ok === 0);

  const fillRow = auditRows.find((r) => r.tool === "browser_fill");
  check("F5 fill value WITHHELD from args_preview", Boolean(fillRow) && !fillRow.args_preview.includes("s3cret-value-xyz") && fillRow.args_preview.includes("name-box"));
  const typeRow = auditRows.find((r) => r.tool === "browser_type");
  check("F6 type text withheld too", Boolean(typeRow) && !typeRow.args_preview.includes("-typed"));
  check("F7 args_preview ≤ 2048", auditRows.every((r) => (r.args_preview ?? "").length <= 2048));

  const sessRows = db.prepare("SELECT session_name, profile_name, created_by, closed_at FROM browser_sessions").all();
  check("F8 browser_sessions rows exist for launches", sessRows.filter((r) => r.session_name === "smoke_s").length >= 2);
  check("F9 create_session tool wrote a history row", sessRows.some((r) => r.session_name === "smoke_tool_made" && r.profile_name === "work"));
  const openLaunchRows = sessRows.filter((r) => ["smoke_s", "smoke_locked"].includes(r.session_name) && r.created_by === "smoke");
  check("F10 all launch rows have closed_at after close_all", openLaunchRows.length > 0 && openLaunchRows.every((r) => r.closed_at !== null));

  check("F11 no live sessions remain", manager.getLiveSessions().length === 0);
  const cdpGone = manager.getSessionCdpInfo("smoke_s") === null && manager.getSessionCdpInfo("smoke_locked") === null;
  check("F12 no cdp endpoints held (no orphan chromium)", cdpGone);

  // listAuditRows API shape (audit route consumes it)
  const listed = audit.listAuditRows({ limit: 10, session: "smoke_s" });
  check("F13 listAuditRows session filter", listed.length > 0 && listed.every((r) => r.session_name === "smoke_s"));
}

// ───────────────────────── cleanup ─────────────────────────
config.deleteSessionConfig("smoke_s");
config.deleteSessionConfig("smoke_s2");
config.deleteSessionConfig("smoke_locked");
fixture.close();

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
