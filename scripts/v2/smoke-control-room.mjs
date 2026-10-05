// S15 Control Room smoke (_design/jarvis-v3-plan.md), offline.
//   A. health: checks are plain-words and honest (optional services never fail the
//      board; Windows load average is null, not zero; only loopback URLs are probed)
//   B. settings door: secrets masked on read, a placeholder on write changes nothing,
//      shape and key guards
//   C. Claude Code plugins against a TEMP settings file: backup before write, one key
//      changed, read back; invalid JSON is refused untouched
//   D. insights: counts match a temp run registry; the window is stated
//   E. UI: tab registered; the page reads only the masked door, never /api/settings
// globalThis.fetch is stubbed, so no live service (Kokoro, Parakeet, Ollama) is touched.
// Run: npx tsx scripts/v2/smoke-control-room.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-control-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_WORKFLOWS_DIR = path.join(tmp, "workflows");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.CLAUDE_SETTINGS_PATH = path.join(tmp, "claude", "settings.json");
process.env.AGENTOS_MOCK_LLM = "1";
fs.mkdirSync(path.dirname(process.env.CLAUDE_SETTINGS_PATH), { recursive: true });
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({
  memory: { ingestEnabled: false, openaiCompatUrl: "http://192.168.0.50:1234/v1" },
  mcp: { secret: "amcp_REAL_SECRET_VALUE" },
  leads: { apifyToken: "apify_real", tavilyKey: "" },
  music: { sunoCookie: "cookie_real" },
  jarvis: { hotkey: { key: "F13" } },
}), "utf8");
fs.writeFileSync(process.env.CLAUDE_SETTINGS_PATH, JSON.stringify({ model: "x", enabledPlugins: { "honcho@honcho": true, "tavily@tavily": false } }, null, 2));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");

// fetch stub: Kokoro answers, Parakeet refuses, Ollama answers; everything recorded
const probed = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  probed.push(u);
  if (u.includes(":8880/")) return new Response("ok", { status: 200 });
  if (u.includes(":11434/")) return new Response("{}", { status: 200 });
  if (u.includes(":17493/")) throw new TypeError("fetch failed");
  throw new TypeError("fetch failed");
};

// ── A. health ───────────────────────────────────────────────────────────────────
const hh = await import("../../src/lib/hostHealth.ts");
const cpu = await hh.sampleCpu(120);
check("CPU sample is measured: 0-100 overall, one value per core", cpu.percent >= 0 && cpu.percent <= 100 && cpu.perCore.length === os.cpus().length);
const host = await hh.hostSnapshot();
check("host snapshot has memory and at least one disk", host.memory.totalBytes > 0 && host.disks.length >= 1 && host.disks[0].totalBytes > 0);
check("load average is null on Windows, a triple elsewhere (never a fake zero)", process.platform === "win32" ? host.loadavg === null : Array.isArray(host.loadavg));
const svcs = await hh.serviceHealth();
const byId = Object.fromEntries(svcs.map((s) => [s.id, s]));
check("a service that answers is ok with a measured time", byId.kokoro.state === "ok" && typeof byId.kokoro.ms === "number");
check("a service that refuses is down with a plain reason", byId.parakeet.state === "down" && byId.parakeet.detail === "not listening");
check("a non-loopback URL is reported, never probed", byId.lmstudio.state === "not-configured" && /not a local address/.test(byId.lmstudio.detail) && !probed.some((u) => u.includes("192.168.0.50")));
check("only loopback addresses were ever called", probed.every((u) => /\/\/(127\.0\.0\.1|localhost)/.test(u)), probed);
const checks = hh.checksFrom(host, svcs);
check("optional services never fail the board", !checks.some((c) => c.id === "svc:voicebox" || c.id === "svc:lmstudio"));
check("a down required service is a failing check", checks.find((c) => c.id === "svc:parakeet")?.ok === false);
const fake = { ...host, cpu: { ...host.cpu, percent: 12 }, memory: { ...host.memory, usedPercent: 40, freeBytes: 8e9 }, disks: [{ mount: "C:\\", totalBytes: 1e12, freeBytes: 5e11, usedPercent: 50 }] };
const allOk = hh.checksFrom(fake, [{ id: "kokoro", name: "Kokoro", url: "u", state: "ok", ms: 3, detail: "" }]);
check("healthy inputs give every check clear", allOk.every((c) => c.ok));
const tight = hh.checksFrom({ ...fake, disks: [{ mount: "C:\\", totalBytes: 1e12, freeBytes: 5e10, usedPercent: 95 }] }, []);
check("under 10% disk free fails with the free space named", tight.find((c) => c.id.startsWith("disk:"))?.ok === false && /GB free/.test(tight[0].detail));
const report = await hh.healthReport();
check("report counts match its checks", report.clear === report.checks.filter((c) => c.ok).length && report.total === report.checks.length);
check("status word follows failures (a down Parakeet is not 'optimal')", report.status !== "optimal");

// ── B. settings door ───────────────────────────────────────────────────────────
const red = await import("../../src/lib/settingsRedact.ts");
check("secret names are caught in any case", ["mcp.secret", "leads.apifyToken", "music.sunoCookie", "leads.tavilyKey", "pipeline.minimaxKey"].every(red.isSecretPath));
check("a hotkey's key name is not a secret", !red.isSecretPath("jarvis.hotkey.key") && !red.isSecretPath("memory.openaiCompatUrl"));
const setRoute = await import("../../src/app/api/control/settings/route.ts");
let r = await setRoute.GET();
let j = await r.json();
check("GET masks set secrets (first 5 characters of a long one)", j.settings.mcp.secret === "amcp_" + red.SECRET_PLACEHOLDER &&j.settings.leads.apifyToken === red.SECRET_PLACEHOLDER && j.settings.music.sunoCookie === red.SECRET_PLACEHOLDER);
check("GET shows an unset secret as empty, not as set", j.settings.leads.tavilyKey === "");
check("no key material anywhere in the response", !JSON.stringify(j).includes("REAL_SECRET") && !JSON.stringify(j).includes("apify_real") && !JSON.stringify(j).includes("cookie_real"));
check("non-secret values pass through", j.settings.jarvis.hotkey.key === "F13");
const patch = (body) => setRoute.PATCH(new Request("http://x/api/control/settings", { method: "PATCH", body: JSON.stringify(body) }));
r = await patch({ key: "leads", value: { apifyToken: red.SECRET_PLACEHOLDER, tavilyKey: "" } });
j = await r.json();
const stored = JSON.parse(read(process.env.AGENTIC_OS_SETTINGS));
check("saving with the placeholder leaves the real secret untouched", r.status === 200 && stored.leads.apifyToken === "apify_real");
check("the save reply is masked too", j.settings.leads.apifyToken === red.SECRET_PLACEHOLDER);
r = await patch({ key: "leads", value: { apifyToken: "apify_new" } });
check("typing a new value replaces the secret", r.status === 200 && JSON.parse(read(process.env.AGENTIC_OS_SETTINGS)).leads.apifyToken === "apify_new");
check("a block cannot change shape", (await patch({ key: "leads", value: "oops" })).status === 400);
check("an unknown block is 404", (await patch({ key: "nosuch", value: {} })).status === 404);
check("a malformed key is 400", (await patch({ key: "../x", value: {} })).status === 400);

// ── C. Claude Code plugins (temp file) ─────────────────────────────────────────
const plug = await import("../../src/lib/claudePlugins.ts");
check("plugin list reads enabledPlugins", JSON.stringify(plug.listClaudePlugins().map((p) => [p.id, p.enabled])) === JSON.stringify([["honcho@honcho", true], ["tavily@tavily", false]]));
const res = plug.setClaudePlugin("honcho@honcho", false);
check("toggle writes and reads back", res.plugin.enabled === false && JSON.parse(read(process.env.CLAUDE_SETTINGS_PATH)).enabledPlugins["honcho@honcho"] === false);
check("a backup of the previous file is kept beside it", fs.existsSync(res.backup) && JSON.parse(read(res.backup)).enabledPlugins["honcho@honcho"] === true && res.backup.includes(".exile"));
check("the rest of the file is preserved", JSON.parse(read(process.env.CLAUDE_SETTINGS_PATH)).model === "x");
const bad = (fn) => { try { fn(); return null; } catch (e) { return e; } };
check("an unknown plugin is a 404", bad(() => plug.setClaudePlugin("nope@nowhere", true))?.status === 404);
check("a malformed id is a 400", bad(() => plug.setClaudePlugin("../evil", true))?.status === 400);
const good = read(process.env.CLAUDE_SETTINGS_PATH);
fs.writeFileSync(process.env.CLAUDE_SETTINGS_PATH, "{ broken");
check("invalid Claude settings are refused (500) and left as they were", bad(() => plug.setClaudePlugin("tavily@tavily", true))?.status === 500 && read(process.env.CLAUDE_SETTINGS_PATH) === "{ broken");
fs.writeFileSync(process.env.CLAUDE_SETTINGS_PATH, good);

// ── D. insights ────────────────────────────────────────────────────────────────
const runs = await import("../../src/lib/moduleRuns.ts");
const a = runs.startModuleRun({ module: "deals", label: "t1" }, async () => "ok");
await a.promise;
const b = runs.startModuleRun({ module: "deals", label: "t2" }, async () => { throw new Error("boom"); });
await b.promise.catch(() => {});
const ins = await import("../../src/app/api/control/insights/route.ts");
j = await (await ins.GET()).json();
const deals = j.runs.byModule.find((m) => m.module === "deals");
check("insights count real runs: 1 done, 1 failed for deals", deals && deals.done === 1 && deals.error === 1 && deals.last24h === 2, deals);
check("insights state their window (last 50 finished)", /last 50 finished/.test(j.window.note));
check("average time is measured, not invented", typeof deals.avgMs === "number" && deals.avgMs >= 0);
check("skills coverage is reported as wired / total", j.skills.totalModules > j.skills.wiredModules && j.skills.wiredModules > 0);

// ── E. UI ──────────────────────────────────────────────────────────────────────
const hub = read("src/components/jarvis/JarvisHub.tsx");
const ui = read("src/components/jarvis/ControlRoomTab.tsx");
check("Control Room tab registered", /key: "control"[^\n]*<ControlRoomTab \/>/.test(hub));
check("the page reads settings only through the masked door", ui.includes("/api/control/settings") && !/fetch\(["'`]\/api\/settings/.test(ui));
check("the matrix switches through the same door as the pop-up", ui.includes('"/api/modules/kit"'));
check("the page says plugins are global and take effect next session", /apply to every Claude Code session, not to one module/.test(ui) && /next session/.test(ui));
check("load average is labelled unavailable on Windows, not shown as zero", ui.includes("not available on Windows"));
check("no invented numbers in the page", !/Math\.random/.test(ui));

console.log(failures ? `smoke-control-room: ${failures} FAILURES` : "smoke-control-room: all checks passed");
process.exit(failures ? 1 : 0);
