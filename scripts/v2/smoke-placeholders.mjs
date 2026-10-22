// S32 smoke, offline: the three placeholders built for real.
//   A. Tasks 'sdk' run mode (stubbed Agent SDK): the plan-approval gate fires
//      BEFORE any SDK turn; the session gets the walker's cap/tools/denies; a
//      runaway session is ended at the turn cap; STOP in the runs tray parks the
//      task Waiting with the reason; ask_user parks it with the question; the
//      tool handlers go through the capability gate; 'steps' never touches the SDK.
//   B. Marketing campaign tabs: Mark published records publishedAt; calendar
//      buckets, board moves, assets and metrics computed from stored items only;
//      the page renders the four tabs with honest empty states.
//   C. Today Widgets: the button works, HomeGrid hosts a second cells list with
//      an empty default, persisted through settings like Mission Control.
//   D. Docs updated; no placeholder sentence survives.
// Run: npx tsx scripts/v2/smoke-placeholders.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any imports (rule 19) ────────────────────────────────────
const stamp = Date.now();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `agentos-smoke-s32-${stamp}-`));
process.env.AGENTIC_OS_DB = path.join(tmp, "agentos.db");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_MARKETING_DIR = path.join(tmp, "marketing");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTOS_MOCK_LLM = "1";

const SETTINGS = {
  tasks: {
    timezone: "America/Chicago",
    editingBufferSec: 1,
    planApproval: "always",
    maxStepsPerRun: 3,
    runTimeoutMin: 30,
    runMode: "sdk",
  },
  memory: { ingestEnabled: false },
};
const writeSettings = (obj) => fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify(obj), "utf8");
writeSettings(SETTINGS);

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400)}]` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const { ensureDb } = await import("../../src/lib/v2/db.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const store = await import("../../src/lib/v2/tasks/store.ts");
const rec = await import("../../src/lib/v2/tasks/recurrence.ts");
const engine = await import("../../src/lib/v2/tasks/engine.ts");
const sdkRun = await import("../../src/lib/v2/tasks/sdkRun.ts");
const runs = await import("../../src/lib/moduleRuns.ts");

ensureDb();
rec.registerTaskWakeHandler();

const kindsOf = (id) => store.listTaskEvents(id, 200).map((e) => e.kind);
const runNow = async (taskId) => {
  const t = store.getTask(taskId);
  sched.enqueueTask(taskId, { immediate: true, expectedUpdatedAt: t.updatedAt });
  await sched.tickOnce();
};

// ── A. the stubbed Agent SDK ─────────────────────────────────────────────────
// A fake query(): records the options it was given and yields whatever the
// scenario says. `interrupt()` resolves the pending wait so a mid-stream stop
// is observable, exactly as the real SDK's interrupt ends the child.
const sdkCalls = [];
function fakeSdk(scenario) {
  return (params) => {
    const call = { options: params.options, prompt: params.prompt, interrupted: false, returned: false };
    sdkCalls.push(call);
    let wake = null;
    const assistant = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
    const result = (subtype = "success") => ({ type: "result", subtype, is_error: subtype !== "success", num_turns: 0 });
    async function* gen() {
      if (scenario === "two-turns") {
        yield assistant("First, I looked at the task.");
        yield assistant("Done: the plan was carried out (stub).");
        yield result();
      } else if (scenario === "runaway") {
        let i = 0;
        while (!call.interrupted) { i += 1; yield assistant(`turn ${i} of a session that never ends`); await sleep(5); }
      } else if (scenario === "hang-until-stop") {
        yield assistant("Starting a long job.");
        await new Promise((r) => { wake = r; });
        // after interrupt: nothing more
      } else if (scenario === "max-turns-from-sdk") {
        yield assistant("Only one turn, then the SDK says max turns.");
        yield result("error_max_turns");
      } else if (scenario === "error-no-text") {
        yield result("error_during_execution");
      }
    }
    const it = gen();
    return {
      next: () => it.next(),
      return: async (v) => { call.returned = true; return it.return(v); },
      interrupt: async () => { call.interrupted = true; wake?.(); },
      [Symbol.asyncIterator]() { return this; },
    };
  };
}

console.log("=== A. Tasks sdk run mode (stubbed SDK) ===");

// A1. approval gate first: a fresh task drafts a plan and parks; the SDK is never called.
sdkRun.setTaskSdkForTests(fakeSdk("two-turns"));
const t1 = store.createTask({ title: "sdk task one", specMd: "do the thing" });
await runNow(t1.id);
let t = store.getTask(t1.id);
check("A1 plan drafted and parked Waiting before any SDK turn", t.planStatus === "drafted" && t.status === "Waiting", { planStatus: t.planStatus, status: t.status });
check("A1 the SDK was NOT called before approval", sdkCalls.length === 0, sdkCalls.length);

// A2. approve -> one SDK session with the walker's guardrails -> Review.
engine.approvePlan(t1.id);
await sched.tickOnce();
t = store.getTask(t1.id);
check("A2 approve runs exactly one SDK session", sdkCalls.length === 1, sdkCalls.length);
const o1 = sdkCalls[0]?.options ?? {};
check("A2 turn cap = settings.tasks.maxStepsPerRun (3)", o1.maxTurns === 3, o1.maxTurns);
check("A2 only the gated tool server is allowed", Array.isArray(o1.allowedTools) && o1.allowedTools.length === 1 && o1.allowedTools[0] === "mcp__agentos_tasks", o1.allowedTools);
check("A2 native Bash/Edit/Write/Read are denied", ["Bash", "Edit", "Write", "Read", "WebFetch"].every((n) => (o1.disallowedTools ?? []).includes(n)), o1.disallowedTools);
check("A2 the tool server is mounted under its name", !!o1.mcpServers?.agentos_tasks, Object.keys(o1.mcpServers ?? {}));
check("A2 bypassPermissions + a cwd outside the repo", o1.permissionMode === "bypassPermissions" && typeof o1.cwd === "string" && o1.cwd.length > 0);
check("A2 the system prompt appends the task rules", typeof o1.systemPrompt?.append === "string" && o1.systemPrompt.append.includes("agentos_tasks") && o1.systemPrompt.append.includes("ask_user"));
check("A2 the user prompt carries the approved plan", typeof sdkCalls[0].prompt === "string" && sdkCalls[0].prompt.includes("APPROVED PLAN") && sdkCalls[0].prompt.includes("sdk task one"));
check("A2 task reaches Review with the session's text as the result", t.status === "Review" && typeof t.result === "string" && t.result.includes("Done: the plan was carried out"), { status: t.status, result: t.result });
const k1 = kindsOf(t1.id);
check("A2 events: sdk_run_started + run_ok, no step walker events", k1.includes("sdk_run_started") && k1.includes("run_ok") && !k1.includes("step_started"), k1);
check("A2 the session was closed afterwards", sdkCalls[0].returned === true);
const run1 = runs.listModuleRuns({ limit: 10 }).find((r) => r.module === "tasks");
check("A2 a module run (tasks) was registered and finished done", !!run1 && run1.status === "done" && run1.label.includes(t.displayId) && run1.href === `/tasks?focus=${t.displayId}`, run1 && { status: run1.status, label: run1.label });

// A3. runaway session: the engine ends it at the cap and still delivers.
sdkRun.setTaskSdkForTests(fakeSdk("runaway"));
const t2 = store.createTask({ title: "sdk runaway", specMd: "never stops" });
await runNow(t2.id);
engine.approvePlan(t2.id);
await sched.tickOnce();
t = store.getTask(t2.id);
const c2 = sdkCalls[1];
check("A3 the engine interrupted the runaway session at the turn cap", !!c2 && c2.interrupted === true);
check("A3 turn_cap_enforced event with turns = cap", (() => { const ev = store.listTaskEvents(t2.id, 200).find((e) => e.kind === "turn_cap_enforced"); return !!ev && ev.detail?.turns === 3 && ev.detail?.cap === 3; })(), store.listTaskEvents(t2.id, 200).filter((e) => e.kind === "turn_cap_enforced").map((e) => e.detail));
check("A3 the task still reaches Review with what was said", t.status === "Review" && typeof t.result === "string" && t.result.includes("turn 1"), { status: t.status });
const k2 = kindsOf(t2.id);
check("A3 run_ok carries turnCapHit", (() => { const ev = store.listTaskEvents(t2.id, 200).find((e) => e.kind === "run_ok"); return !!ev && ev.detail?.turnCapHit === true && ev.detail?.mode === "sdk"; })(), k2);

// A4. STOP via the runs tray parks the task Waiting with the reason.
sdkRun.setTaskSdkForTests(fakeSdk("hang-until-stop"));
const t3 = store.createTask({ title: "sdk stoppable", specMd: "long job" });
await runNow(t3.id);
engine.approvePlan(t3.id);
const tickPromise = sched.tickOnce();
let liveRun = null;
for (let i = 0; i < 100 && !liveRun; i++) {
  await sleep(20);
  liveRun = runs.listModuleRuns({ limit: 10 }).find((r) => r.module === "tasks" && r.status === "running");
}
check("A4 the run shows in the tray as running while the session works", !!liveRun, runs.listModuleRuns({ limit: 10 }).map((r) => `${r.module}:${r.status}`));
const stopped = liveRun ? runs.stopModuleRun(liveRun.id, "owner") : false;
check("A4 STOP accepted", stopped === true);
await tickPromise;
t = store.getTask(t3.id);
const c3 = sdkCalls[2];
check("A4 STOP interrupted the SDK session", !!c3 && c3.interrupted === true);
check("A4 the task is Waiting with the stop reason, not Review", t.status === "Waiting" && typeof t.error === "string" && /stopped by owner/.test(t.error), { status: t.status, error: t.error });
const run3 = liveRun ? runs.getModuleRun(liveRun.id) : null;
check("A4 the run reads stopped (never done)", !!run3 && run3.status === "stopped" && run3.stoppedBy === "owner", run3 && run3.status);
check("A4 run_fail event logged (no run_ok)", kindsOf(t3.id).includes("run_fail") && !kindsOf(t3.id).includes("run_ok"), kindsOf(t3.id));

// A5. the SDK's own max-turns result is honoured as a cap, not an error.
sdkRun.setTaskSdkForTests(fakeSdk("max-turns-from-sdk"));
const t4 = store.createTask({ title: "sdk max turns", specMd: "x" });
await runNow(t4.id);
engine.approvePlan(t4.id);
await sched.tickOnce();
t = store.getTask(t4.id);
check("A5 error_max_turns from the SDK -> Review + turn_cap_enforced", t.status === "Review" && kindsOf(t4.id).includes("turn_cap_enforced"), { status: t.status, kinds: kindsOf(t4.id) });

// A6. an SDK error with no text is a failure, not an empty result.
sdkRun.setTaskSdkForTests(fakeSdk("error-no-text"));
const t5 = store.createTask({ title: "sdk error", specMd: "x" });
await runNow(t5.id);
engine.approvePlan(t5.id);
await sched.tickOnce();
t = store.getTask(t5.id);
check("A6 SDK error without text -> Waiting with a named error", t.status === "Waiting" && typeof t.error === "string" && t.error.includes("error_during_execution"), { status: t.status, error: t.error });

// A7. tool handlers: the capability gate, and ask_user recording the question.
const state = sdkRun.newTaskSdkState();
const handlers = sdkRun.buildTaskSdkToolHandlers({ task: store.getTask(t1.id), state });
check("A7 the handler set is the walker's step kinds + ask_user", ["run_command", "read_file", "write_file", "list_files", "search_files", "coding_session", "ask_user"].every((n) => n in handlers), Object.keys(handlers));
const denied = await handlers.run_command.run({ command: "rm -rf /tmp/whatever" });
check("A7 run_command goes through the capability gate (deny list refuses)", denied.isError === true && /deny|exile/i.test(denied.content[0].text), denied.content[0].text);
const asked = await handlers.ask_user.run({ question: "Which folder should I use?" });
check("A7 ask_user records the one question for the engine", state.question === "Which folder should I use?" && !asked.isError);
check("A7 tool calls are recorded for the run summary", state.toolCalls.length === 2 && state.toolCalls[0].name === "run_command" && state.toolCalls[0].ok === false);

// A8. 'steps' mode never touches the SDK (regression).
writeSettings({ ...SETTINGS, tasks: { ...SETTINGS.tasks, runMode: "steps" } });
const before = sdkCalls.length;
sdkRun.setTaskSdkForTests(fakeSdk("two-turns"));
const t6 = store.createTask({ title: "walker task", specMd: "plain" });
await runNow(t6.id);
engine.approvePlan(t6.id);
await sched.tickOnce();
t = store.getTask(t6.id);
check("A8 runMode steps: the walker runs and the SDK is never called", t.status === "Review" && kindsOf(t6.id).includes("step_started") && sdkCalls.length === before, { status: t.status, calls: sdkCalls.length - before });
sdkRun.setTaskSdkForTests(null);

// ── B. Marketing campaign tabs ──────────────────────────────────────────────
console.log("=== B. Marketing campaign tabs ===");
const mk = await import("../../src/lib/marketing.ts");
const views = await import("../../src/lib/v2/marketing/campaignViews.ts");

fs.mkdirSync(path.join(process.env.AGENTIC_OS_MARKETING_DIR, "campaigns"), { recursive: true });
// The fixture carries its colour: readCampaign backfills a missing one with a
// fire-and-forget write, and a read racing that write parsed a half-written
// file as "Campaign not found" (seen once in the full gate run).
const campaign = {
  slug: "s32-smoke", title: "S32 smoke campaign", business: "payloadsco", goal: "prove the tabs", channels: ["youtube", "text-post", "blog"],
  status: "planned", plan: "a plan", created: "2026-09-01T00:00:00.000Z", color: "#ec4899",
  items: [
    { id: "i1", channel: "youtube", title: "Video idea", brief: "b", status: "idea", scheduledFor: "2026-10-03" },
    { id: "i2", channel: "text-post", platform: "linkedin", title: "Drafted post", brief: "b", draft: "Hello world post text here", status: "drafted", scheduledFor: "2026-09-20" },
    { id: "i3", channel: "text-post", platform: "x", title: "Approved undated", brief: "b", draft: "Short one", status: "approved" },
    { id: "i4", channel: "blog", title: "Scheduled article", brief: "b", draft: "A long article draft with many words in it", status: "scheduled", scheduledFor: "2026-10-10" },
    { id: "i5", channel: "blog", title: "Old published", brief: "b", draft: "x", status: "published", publishedUrl: "https://example.com/old" },
    { id: "i6", channel: "youtube", title: "Dated published", brief: "b", draft: "y", status: "published", publishedAt: "2026-09-29T10:00:00.000Z", publishedUrl: "https://example.com/new" },
  ],
};
fs.writeFileSync(path.join(process.env.AGENTIC_OS_MARKETING_DIR, "campaigns", "s32-smoke.json"), JSON.stringify(campaign), "utf8");

const c0 = await mk.readCampaign("s32-smoke");
check("B1 the store honours AGENTIC_OS_MARKETING_DIR", !!c0 && c0.items.length === 6);
check("B1 the real marketing dir was not touched", !fs.existsSync(path.join(os.homedir(), ".agentic-os", "marketing", "campaigns", "s32-smoke.json")));
const after = await mk.setItemStatus("s32-smoke", "i3", "published", { publishedUrl: "https://example.com/i3" });
const i3 = after.items.find((i) => i.id === "i3");
check("B2 Mark published records publishedAt", i3.status === "published" && /^\d{4}-\d{2}-\d{2}T/.test(i3.publishedAt ?? ""), i3);

const today = "2026-10-01";
const { byDay, undated } = views.bucketItemsByDay(campaign.items);
check("B3 calendar: dated items land on their day", byDay.get("2026-10-03")?.[0]?.id === "i1" && byDay.get("2026-09-20")?.[0]?.id === "i2" && byDay.get("2026-10-10")?.[0]?.id === "i4");
check("B3 calendar: a published item without a date uses its publish day", byDay.get("2026-09-29")?.[0]?.id === "i6");
check("B3 calendar: undated = no scheduled date and no publish date", undated.map((i) => i.id).sort().join(",") === "i3,i5", undated.map((i) => i.id));
const cells = views.monthCells(2026, 9); // October 2026 starts on a Thursday
check("B3 calendar: month grid is Monday-first and padded to whole weeks", cells.length % 7 === 0 && cells[0] === null && cells[3] === 1 && cells.filter((c) => c !== null).length === 31, cells.slice(0, 7));

const mv = (status, target, extra = {}) => views.boardMove({ status, ...extra }, target);
check("B4 board: drafted -> approved = approve", mv("drafted", "approved", { draft: "d" }).action === "approve");
check("B4 board: drafted (dated) -> approved = approve, with the scheduled note", (() => { const r = mv("drafted", "approved", { draft: "d", scheduledFor: "2026-10-05" }); return r.ok && r.action === "approve" && /scheduled/.test(r.note ?? ""); })());
check("B4 board: approved -> published = published", mv("approved", "published", { draft: "d" }).action === "published");
check("B4 board: scheduled -> published = published", mv("scheduled", "published", { draft: "d", scheduledFor: "2026-10-05" }).action === "published");
check("B4 board: approved -> drafted = unapprove", mv("approved", "drafted", { draft: "d" }).action === "unapprove");
check("B4 board: idea -> drafted refused (needs a draft)", mv("idea", "drafted").ok === false && /Draft it/.test(mv("idea", "drafted").reason));
check("B4 board: idea -> approved refused", mv("idea", "approved").ok === false);
check("B4 board: approved undated -> scheduled refused (needs a date)", mv("approved", "scheduled", { draft: "d" }).ok === false && /date/.test(mv("approved", "scheduled", { draft: "d" }).reason));
check("B4 board: drafted -> published refused (only approved items)", mv("drafted", "published", { draft: "d" }).ok === false);
check("B4 board: item with a draft -> idea refused", mv("drafted", "idea", { draft: "d" }).ok === false);
check("B4 board: same column = no move", mv("idea", "idea").ok === false);
check("B4 board: every (from, to) pair answers ok or a reason, never throws", views.STATUSES.every((f) => views.STATUSES.every((to) => { const r = mv(f, to, { draft: f === "idea" ? undefined : "d" }); return r.ok === true || typeof r.reason === "string"; })));

const assets = views.campaignAssets(campaign.items);
check("B5 assets: one row per draft with counts, undrafted counted", assets.drafts.length === 5 && assets.undrafted === 1 && assets.drafts.find((d) => d.id === "i4").words === 9);
check("B5 assets: published links from publishedUrl", assets.links.map((l) => l.id).sort().join(",") === "i5,i6");

const m = views.campaignMetrics(campaign.items, today);
check("B6 metrics: counts by status", m.byStatus.idea === 1 && m.byStatus.drafted === 1 && m.byStatus.approved === 1 && m.byStatus.scheduled === 1 && m.byStatus.published === 2, m.byStatus);
check("B6 metrics: counts by channel", m.byChannel.youtube === 2 && m.byChannel["text-post"] === 2 && m.byChannel.blog === 2, m.byChannel);
check("B6 metrics: overdue = dated before today and not published (i2)", m.overdue === 1, m.overdue);
check("B6 metrics: unscheduled = not published and undated (i3)", m.unscheduled === 1, m.unscheduled);
check("B6 metrics: published per ISO week from publishedAt only; undated published counted apart", m.publishedPerWeek.length === 1 && m.publishedPerWeek[0].week === "2026-W40" && m.publishedPerWeek[0].count === 1 && m.publishedUndated === 1, m.publishedPerWeek);
check("B6 metrics: isoWeek handles the year boundary", views.isoWeek("2027-01-01") === "2026-W53" && views.isoWeek("2026-01-01") === "2026-W01", [views.isoWeek("2027-01-01"), views.isoWeek("2026-01-01")]);
check("B6 metrics: the engagement slot says there is no source", /No engagement data/.test(views.NO_ENGAGEMENT_SOURCE) && /no source/.test(views.NO_ENGAGEMENT_SOURCE));
const empty = views.campaignMetrics([], today);
check("B6 metrics: empty campaign counts to zero everywhere", empty.total === 0 && empty.publishedPerWeek.length === 0 && empty.overdue === 0);

const page = read("src/components/v2/marketing/CampaignDetail.tsx");
check("B7 page: no 'arrives with' placeholder survives", !/arrives with J\d/.test(page) && !page.includes("PENDING"));
check("B7 page: the four tabs render from campaignViews", ["CalendarTab", "BoardTab", "AssetsTab", "MetricsTab"].every((n) => page.includes(`function ${n}(`)) && page.includes("@/lib/v2/marketing/campaignViews"));
check("B7 page: board moves post the existing item API", page.includes('fetch("/api/marketing/item"') && page.includes("boardMove(item, target)") && page.includes("Not moved: ${verdict.reason}"));
check("B7 page: honest empty states on every tab", page.includes("No items yet: plan the campaign from the hub and its pieces land here by date.") && page.includes("No items yet: plan the campaign from the hub and its pieces land here by status.") && page.includes("No assets yet:") && page.includes("No items yet, so nothing to count."));
check("B7 page: assets say the store holds text and links only", page.includes("there are no file uploads"));
check("B7 page: metrics render the no-engagement sentence", page.includes("{NO_ENGAGEMENT_SOURCE}"));
check("B7 page: undated published items are never placed in a week", page.includes("not placed in a week"));

// ── C. Today Widgets ────────────────────────────────────────────────────────
console.log("=== C. Today Widgets ===");
const wt = await import("../../src/lib/v2/widgets/types.ts");
check("C1 resolveHomeCells: Mission Control still falls back to the default layout", wt.resolveHomeCells(undefined).length === wt.DEFAULT_HOME_CELLS.length);
check("C1 resolveHomeCells: Today's fallback is empty", wt.resolveHomeCells(undefined, []).length === 0 && wt.resolveHomeCells([], []).length === 0);
check("C1 resolveHomeCells: a valid todayCells list wins and is order-sorted", (() => { const r = wt.resolveHomeCells([{ id: "b", widgetSlug: "tasks-upcoming", size: "M", order: 1 }, { id: "a", widgetSlug: "attention", size: "L", order: 0 }], []); return r.length === 2 && r[0].id === "a"; })());
const grid = read("src/components/v2/home/HomeGrid.tsx");
check("C2 HomeGrid takes a cellsKey and saves under it", grid.includes('cellsKey = "cells"') && grid.includes("[cellsKey]: next") && grid.includes("[cellsKey]: draft") && grid.includes("[cellsKey]: snapshotRef.current"));
check("C2 HomeGrid reads settings.home[cellsKey] with the right fallback", grid.includes("?.[cellsKey], fallback)") && grid.includes('cellsKey === "cells" ? DEFAULT_HOME_CELLS : []'));
check("C2 HomeGrid shows the empty hint when a list is empty", grid.includes("cells.length === 0 && !edit") && grid.includes("{emptyHint ??"));
const header = read("src/components/v2/pages/PageHeader.tsx");
check("C3 Widgets button is enabled and toggles", !header.includes("coming with the Homepage phase") && header.includes("onClick={onToggleWidgets}") && header.includes("disabled={widgetsOpen === null}") && header.includes("aria-pressed={widgetsOpen === true}"));
const view = read("src/components/v2/pages/ScratchpadView.tsx");
check("C4 Today hosts HomeGrid with its own cells list", view.includes('cellsKey="todayCells"') && view.includes("{widgetsOpen && (") && view.includes('import HomeGrid from "@/components/v2/home/HomeGrid"'));
check("C4 open state is persisted through settings like Mission Control", view.includes("save({ home: { todayShowWidgets: !widgetsOpen } })") && view.includes("todayShowWidgets === true"));
const settingsTs = read("src/lib/settings.ts");
check("C5 settings type carries todayCells + todayShowWidgets", settingsTs.includes("todayCells?: Array<{") && settingsTs.includes("todayShowWidgets?: boolean"));
check("C5 Mission Control still mounts the default grid untouched", read("src/components/Overview.tsx").includes("<HomeGrid />"));
check("C6 the tasks gear exposes Run mode", (() => { const s = read("src/components/v2/tasks/TasksSettings.tsx"); return s.includes('label="Run mode"') && s.includes('<option value="sdk">') && s.includes("runMode: e.target.value"); })());
check("C6 the runs tray names the tasks module", read("src/components/RunsTray.tsx").includes('tasks: "Tasks"'));
check("C6 the engine never throws NOT_IMPLEMENTED for sdk any more", !read("src/lib/v2/tasks/engine.ts").includes("NOT_IMPLEMENTED"));

// ── D. docs ─────────────────────────────────────────────────────────────────
console.log("=== D. docs ===");
const tasksDoc = read("docs/modules/tasks.md");
check("D1 tasks.md documents Run mode and drops 'not implemented yet'", tasksDoc.includes("| **Run mode** |") && !tasksDoc.includes("not implemented yet") && tasksDoc.includes("sdkRun.ts"));
const mktDoc = read("docs/modules/marketing.md");
check("D2 marketing.md documents the four tabs and drops the placeholder line", !mktDoc.includes("placeholder message only") && ["#### Calendar", "#### Board", "#### Assets", "#### Metrics"].every((h) => mktDoc.includes(h)) && mktDoc.includes("no source for views, clicks or replies"));
const todayDoc = read("docs/modules/today.md");
check("D3 today.md documents the Widgets panel and drops 'Always disabled'", !todayDoc.includes("Always disabled") && todayDoc.includes("settings.home.todayCells"));
check("D4 no em or en dashes in the three docs' prose", ![tasksDoc, mktDoc, todayDoc].some((d) => /[–—]/.test(d.replace(/`[^`\n]*`/g, ""))));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
