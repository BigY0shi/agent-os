// Restart integrity smoke — the three defects behind the 2026-08-29 split-brain
// incident, where two servers held port 3737 at once (one on 0.0.0.0, one on ::)
// and silently corrupted each other's run state.
//
//   §A single-instance lock  — a second process must be refused; a crashed
//                              holder's lock must NOT wedge the next boot
//   §B boot recovery         — runs stranded running/waiting → error, dead
//                              approval cards cleared
//   §C honest decisions      — the client reads { ok, stale } instead of
//                              discarding it; no surface still fire-and-forgets
//
// Run: npx tsx scripts/v2/smoke-restart-integrity.mjs
//
// Temp-env recipe (smoke-agents-status pattern): AGENTIC_OS_DB + _SETTINGS +
// _AGENTS_DIR + _LOCK all point at throwaway paths, so the LIVE stores and the
// live server's lock are never touched. Fully offline.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src imports ──────────────────────────────────────────
const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-restart-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-restart-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-restart-agents-"));
process.env.AGENTIC_OS_AGENTS_DIR = agentsDir;
// createAgent registers a PRINCIPAL (identity + a browser profile it owns),
// so an un-redirected run writes fake agents into the owner's real
// ~/.agentic-os/principals.json. That is what happened before this line
// existed. Rule 19: redirect every store the code under test writes to.
process.env.AGENTIC_OS_PRINCIPALS = path.join(agentsDir, "principals.json");
const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-restart-lock-"));
const lockFile = path.join(lockDir, "agentos.lock");
process.env.AGENTIC_OS_LOCK = lockFile;
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may call out
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    memory: { ingestEnabled: false, provider: "ollama-local" },
    capability: { browserEnabled: false },
    tasks: { timezone: "America/Chicago" },
  }),
);

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
/** Source with comments stripped — assertions must match CODE, not prose. */
const code = (rel) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};

const lock = await import("../../src/lib/v2/singleInstance.ts");
const store = await import("../../src/lib/agentsStore.ts");
const recovery = await import("../../src/lib/agentsRecovery.ts");

// ── §A single-instance lock ──────────────────────────────────────────────────
console.log("\n── §A single-instance lock ──");

check("A1 no lockfile → free to run", lock.liveHolder() === null);

check("A2 checkSingleInstance() claims and returns null", lock.checkSingleInstance() === null);
check("A3 the lockfile now exists", fs.existsSync(lockFile));

const claimed = lock.readLock();
check("A4 lock records OUR pid", claimed?.pid === process.pid, `got ${claimed?.pid}`);
check("A5 lock carries a fresh heartbeat", Date.now() - (claimed?.heartbeat ?? 0) < 5_000);

// Re-entrant boot in the SAME process must not refuse itself.
check("A6 our own lock is not a foreign holder", lock.liveHolder() === null);
check("A7 checkSingleInstance() is idempotent for us", lock.checkSingleInstance() === null);

// A DIFFERENT pid, beating right now = a live second server. Must be refused.
// The foreign holder must be a PID that really exists (the parent process):
// since 2026-09-02 a fresh heartbeat from a NON-existent PID is treated as
// dead, because that is exactly what a just-killed server looks like.
const foreign = { pid: process.ppid, startedAt: Date.now() - 60_000, heartbeat: Date.now() };
fs.writeFileSync(lockFile, JSON.stringify(foreign));
const holder = lock.liveHolder();
check("A8 a live foreign holder is detected", holder?.pid === foreign.pid);
check("A9 checkSingleInstance() refuses (returns the holder)",
  lock.checkSingleInstance()?.pid === foreign.pid);
check("A10 a refused boot does NOT steal the lock",
  lock.readLock()?.pid === foreign.pid, "second instance overwrote the holder's lock");

// A stale heartbeat = the holder crashed. Must NOT wedge the next boot — this is
// the failure mode that would be worse than the bug (a PID-only check would
// refuse to start forever after any hard crash, or on a recycled PID).
fs.writeFileSync(lockFile, JSON.stringify({ ...foreign, heartbeat: Date.now() - 5 * 60_000 }));
check("A11 a stale holder is ignored", lock.liveHolder() === null);
// A fresh heartbeat whose PID is gone = the launcher killed it seconds ago.
fs.writeFileSync(lockFile, JSON.stringify({ ...foreign, pid: 4_000_000, heartbeat: Date.now() }));
check("A11b a fresh heartbeat from a PID that does not exist is ignored", lock.liveHolder() === null);
check("A11c pidExists: ourselves yes, 4000000 no", lock.pidExists(process.pid) === true && lock.pidExists(4_000_000) === false);
fs.writeFileSync(lockFile, JSON.stringify({ ...foreign, heartbeat: Date.now() - 5 * 60_000 }));
check("A12 boot takes over a stale lock", lock.checkSingleInstance() === null);
check("A13 the lock is now ours", lock.readLock()?.pid === process.pid);

// Corrupt/empty file must fail open, never throw at boot.
fs.writeFileSync(lockFile, "{not json");
check("A14 a corrupt lockfile reads as absent", lock.readLock() === null);
check("A15 a corrupt lockfile does not block boot", lock.checkSingleInstance() === null);

const instr = code("src/instrumentation.ts");
check("A16 instrumentation guards BEFORE booting anything else",
  instr.indexOf("checkSingleInstance") < instr.indexOf("ensureScheduler") &&
  instr.indexOf("checkSingleInstance") < instr.indexOf("ensureV2"));
check("A17 a duplicate exits rather than continuing", /process\.exit\(1\)/.test(instr));
check("A18 the refusal names the PID to stop", /Stop-Process -Id \$\{holder\.pid\}/.test(read("src/instrumentation.ts")));

// ── §B boot recovery for stranded runs ───────────────────────────────────────
console.log("\n── §B boot recovery ──");

const agent = await store.createAgent({ name: "smoke stranded", instructions: "reply ok" });
const t0 = Date.now() - 120_000;
await store.saveRunMeta({ id: "run-running", agentId: agent.id, trigger: "manual", status: "running", startedAt: t0 });
await store.saveRunMeta({ id: "run-waiting", agentId: agent.id, trigger: "manual", status: "waiting", startedAt: t0 });
await store.saveRunMeta({ id: "run-done", agentId: agent.id, trigger: "manual", status: "done", startedAt: t0, endedAt: t0 + 1000, result: "fine" });
await store.saveRunMeta({ id: "run-error", agentId: agent.id, trigger: "manual", status: "error", startedAt: t0, endedAt: t0 + 1000, error: "already failed" });
await store.appendRunEvent(agent.id, "run-waiting", { seq: 0, ts: t0, kind: "init" });
await store.appendRunEvent(agent.id, "run-waiting", { seq: 1, ts: t0, kind: "approval", toolName: "Write", detail: "waiting" });
await store.writeApprovals([
  { id: "card-1", runId: "run-waiting", agentId: agent.id, agentName: agent.name,
    kind: "approval", toolName: "Write", inputPreview: "x", reason: "gated", createdAt: t0 },
]);

const recovered = await recovery.recoverStrandedRuns();
check("B1 both stranded runs recovered", recovered === 2, `got ${recovered}`);

const mRunning = await store.loadRunMeta(agent.id, "run-running");
const mWaiting = await store.loadRunMeta(agent.id, "run-waiting");
const mDone = await store.loadRunMeta(agent.id, "run-done");
const mError = await store.loadRunMeta(agent.id, "run-error");

check("B2 running → error", mRunning?.status === "error", mRunning?.status);
check("B3 waiting → error", mWaiting?.status === "error", mWaiting?.status);
check("B4 a stranded run gets an endedAt", typeof mRunning?.endedAt === "number" && mRunning.endedAt > 0);
check("B5 the reason names the restart", /restart/i.test(mRunning?.error ?? ""), mRunning?.error);
check("B6 waiting runs say what they were waiting on",
  /approval/i.test(mWaiting?.error ?? ""), mWaiting?.error);
check("B7 done runs are untouched", mDone?.status === "done" && mDone?.result === "fine");
check("B8 already-errored runs keep their own reason", mError?.error === "already failed");

const evs = await store.readRunEvents(agent.id, "run-waiting");
check("B9 an error event is appended to the transcript",
  evs.some((e) => e.kind === "error" && /restart/i.test(e.detail ?? "")));
check("B10 the appended event continues the seq (no collision)",
  new Set(evs.map((e) => e.seq)).size === evs.length, JSON.stringify(evs.map((e) => e.seq)));

check("B11 dead approval cards are cleared", (await store.readApprovals()).length === 0);

// Idempotent: a second boot has nothing left to do.
check("B12 recovery is idempotent", (await recovery.recoverStrandedRuns()) === 0);

check("B13 recovery runs before the trigger scheduler can start a run",
  instr.indexOf("recoverStrandedRuns") < instr.indexOf("ensureScheduler"));
check("B14 recovery is awaited (not fire-and-forget)",
  /await recoverStrandedRuns\(\)/.test(instr));

// ── §C honest approval decisions ─────────────────────────────────────────────
console.log("\n── §C the UI stops discarding the server's answer ──");

const client = code("src/lib/agentsApprovalsClient.ts");
check("C1 the client reads j.stale", /stale/.test(client));
check("C2 a transport failure is NOT reported as stale",
  /error: "could not reach the server"/.test(client) &&
  /stale: false, error/.test(client));
check("C3 decisionNotice returns null only on success",
  /if \(o\.ok\) return null;/.test(client));

const SURFACES = [
  "src/components/v2/agents/AgentsPageV2.tsx",
  "src/components/v2/agents/ForgeWizard.tsx",
  "src/components/v2/agents/tabs/ApprovalsTab.tsx",
  "src/components/AgentsView.tsx",
];
for (const rel of SURFACES) {
  const src = code(rel);
  const name = rel.split("/").pop();
  check(`C4 ${name} routes decisions through the shared client`,
    /agentsApprovalsClient/.test(src));
  check(`C5 ${name} no longer POSTs approvals fire-and-forget`,
    !/fetch\("\/api\/agents\/approvals",\s*\{\s*method: "POST"/.test(src),
    "still has a hand-rolled decision POST");
  check(`C6 ${name} surfaces the outcome`, /decisionNotice/.test(src));
}

// ── §D the restart script verifies its own kill ──────────────────────────────
console.log("\n── §D restart script ──");

const ps1 = read("agentos-restart.ps1");
check("D1 the kill is verified, not assumed", /\$survivors = @\(Get-DashboardPids\)/.test(ps1));
check("D2 a surviving server aborts the launch",
  /if \(\$survivors\.Count -gt 0\)/.test(ps1) && /exit 1/.test(ps1));
check("D3 the abort comes BEFORE Start-Process",
  ps1.indexOf("$survivors.Count -gt 0") < ps1.indexOf("Start-Process"));
check("D4 Stop-Process failures are reported, not swallowed",
  /-ErrorAction Stop/.test(ps1) && /COULD NOT kill PID/.test(ps1));
check("D5 Kokoro cannot abort a dashboard restart",
  /Get-KokoroPids/.test(ps1) && !/\$survivors = @\(Get-KokoroPids\)/.test(ps1));

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
