// S17 Missions runtime: plan -> approve -> run seats -> report -> review/deliver.
//
//   Planning   Jarvis (claude, one-shot) turns the brief into a JSON plan: a rationale,
//              guardrails, and up to maxSteps steps, each with a seat, a SELF-CONTAINED
//              brief, and the earlier steps it depends on. Nothing runs until the owner
//              approves the plan (or sends it back with a note, which re-plans).
//   Running    A step starts when everything it depends on is done. Its seat's CLI runs
//              in the step's own scratch dir, capped at 50 turns where the CLI has a turn
//              flag (claude -p --max-turns, hermes chat --max-turns); codex and agy have
//              none and are bounded by the mission's time limit. Dependencies' answers are
//              copied into ./inputs/. Every hand-off is logged WITH the brief it sent.
//   Limits     The time limit is a real timer: at the deadline, running seats are killed
//              and the mission goes to its report with what finished.
//   Report     Jarvis writes the final report from the steps' answers. Then REVIEW (the
//              owner accepts or sends it back) or DELIVERED, as the owner chose.
//   STOP       kills every running seat (the whole process tree on Windows).
//   Restart    A server restart kills the children. On the next read, a step still
//              marked running with no live process is marked failed and said so; nothing
//              pretends it is still working (AGENTS.md "Never fabricate state").

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  appendEvent, listMissions, loadMission, MAX_TURNS, MISSION_AGENTS, MissionError, newMissionId, readEvents,
  saveMission, seatDir, stepFile, TURN_CAPPED, validateNewMission,
  type Mission, type MissionAgent, type MissionEvent, type NewMissionInput, type Seat, type Step,
} from "./store";

// ── drivers (swapped out by the smoke; never a real CLI in tests) ─────────────

export interface ChildLike {
  pid?: number;
  stdout: { on(ev: "data", fn: (b: Buffer | string) => void): unknown };
  stderr: { on(ev: "data", fn: (b: Buffer | string) => void): unknown };
  on(ev: "close", fn: (code: number | null) => void): unknown;
  on(ev: "error", fn: (err: Error) => void): unknown;
}
export interface MissionDrivers {
  /** One-shot text completion by Jarvis (planning, reporting). */
  complete(prompt: string, opts: { timeoutMs: number }): Promise<string>;
  /** Start a seat's CLI. */
  launch(agent: MissionAgent, args: string[], opts: { cwd: string; input?: string }): ChildLike;
  kill(child: ChildLike): void;
  installed(agent: MissionAgent): boolean;
  defaultModel(agent: MissionAgent): string | undefined;
}

async function realDrivers(): Promise<MissionDrivers> {
  const [{ cliComplete }, runner, config, { claudeModel }] = await Promise.all([import("@/lib/loopEngine"), import("@/lib/runner"), import("@/lib/config"), import("@/lib/claudeModel")]);
  return {
    complete: (prompt, opts) => cliComplete("claude", prompt, { timeoutMs: opts.timeoutMs, incognito: true }),
    launch: (agent, args, opts) => runner.spawnStream(agent, args, { cwd: opts.cwd, input: opts.input }) as ChildProcessWithoutNullStreams,
    kill: (child) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        // The CLI may be a .cmd shim with the real process underneath: kill the tree.
        try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already gone */ }
      } else {
        try { process.kill(child.pid, "SIGTERM"); } catch { /* already gone */ }
      }
    },
    installed: (agent) => config.isAgentInstalled(agent),
    defaultModel: (agent) => (agent === "claude" ? claudeModel() : undefined),
  };
}

interface Registry {
  drivers: MissionDrivers | null;
  children: Map<string, ChildLike>; // `${missionId}:${stepId}`
  timers: Map<string, ReturnType<typeof setTimeout>>;
  recovered: boolean;
}
const g = globalThis as unknown as { __agentosMissions?: Registry };
function reg(): Registry {
  if (!g.__agentosMissions) g.__agentosMissions = { drivers: null, children: new Map(), timers: new Map(), recovered: false };
  return g.__agentosMissions;
}
async function drivers(): Promise<MissionDrivers> {
  const r = reg();
  if (!r.drivers) r.drivers = await realDrivers();
  return r.drivers;
}
/** Smoke hook: replace the drivers and forget every live child and timer. */
export function __setMissionDriversForTests(d: MissionDrivers): void {
  const r = reg();
  r.timers.forEach((t) => clearTimeout(t));
  r.drivers = d; r.children.clear(); r.timers.clear(); r.recovered = false;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const log = (id: string, ev: Omit<MissionEvent, "at">) => appendEvent(id, ev);
function mutate(id: string, fn: (m: Mission) => void): Mission {
  const m = loadMission(id);
  if (!m) throw new MissionError(`no mission ${id}`, 404);
  fn(m);
  saveMission(m);
  return m;
}
const seatOf = (m: Mission, s: Step) => m.seats.find((x) => x.id === s.seatId);
const seatName = (seat?: Seat) => (seat ? `${seat.agent}${seat.model ? ` (${seat.model})` : ""}` : "an unknown seat");

// ── create + plan ────────────────────────────────────────────────────────────

export async function createMission(input: NewMissionInput): Promise<Mission> {
  const v = validateNewMission(input);
  const d = await drivers();
  let seats = v.seats;
  if (v.teamMode === "jarvis") {
    seats = MISSION_AGENTS.filter((a) => d.installed(a)).map((agent, i) => ({ id: `c${i + 1}`, agent, role: "generalist" }));
    if (!seats.length) throw new MissionError("no crew CLI is installed (claude, hermes, codex or agy)", 503);
  } else {
    const missing = seats.filter((s) => !d.installed(s.agent)).map((s) => s.agent);
    if (missing.length) throw new MissionError(`not installed: ${[...new Set(missing)].join(", ")}`, 503);
  }
  const m: Mission = { ...v, seats, id: newMissionId(), stage: "briefing", planApproved: false, createdAt: Date.now() };
  saveMission(m);
  log(m.id, { kind: "created", text: `Mission created: ${m.name}. Team: ${m.teamMode === "jarvis" ? "Jarvis picks" : "chosen by you"}.` });
  void planMission(m.id);
  return m;
}

function plannerPrompt(m: Mission): string {
  const crew = m.seats.map((s) => `- ${s.id}: ${s.agent}${s.model ? ` (model ${s.model})` : ""}, role: ${s.role}${TURN_CAPPED[s.agent] ? "" : " (no turn cap; bounded by the time limit)"}`).join("\n");
  return [
    "You are Jarvis, planning a mission for your crew of CLI agents. Reply with ONLY one JSON object: no prose, no code fence.",
    '{"rationale": "why this crew and this order, 2-4 sentences", "guardrails": ["short rules the crew works under"], "steps": [{"title": "short", "seat": "<crew id>", "brief": "<the COMPLETE instructions for that agent>", "dependsOn": [<0-based indexes of EARLIER steps whose answers it needs>]}]}',
    `Rules: at most ${m.limits.maxSteps} steps; use fewer when fewer will do. Each brief is self-contained: the agent sees nothing but its brief and the answers of the steps it depends on (as files in ./inputs/). Each agent works only in its own scratch folder and ends with its complete answer as its final message. Steps with no dependency run in parallel. The whole mission has ${m.limits.timeLimitMin} minutes.`,
    `Crew:\n${crew}`,
    m.teamMode === "jarvis" ? "You pick the team: use only the crew members the work needs; say why in the rationale." : "The owner chose this crew: use it.",
    `Mission: ${m.name}\nObjective: ${m.objective}\nWhat success looks like: ${m.successLooksLike}\nPriority: ${m.priority}${m.targetDate ? `\nTarget date: ${m.targetDate}` : ""}`,
    m.note ? `The owner sent the last version back with this note, which the new plan must address:\n${m.note}` : "",
    m.result ? `The previous run's report, for reference:\n${m.result.slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Strict: a plan that cannot be read is an error, never a guessed plan. */
export function parsePlan(text: string, m: Mission): { rationale: string; guardrails: string[]; steps: Step[] } {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new MissionError("the plan was not JSON");
  let j: { rationale?: unknown; guardrails?: unknown; steps?: unknown };
  try { j = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new MissionError(`the plan was not valid JSON: ${(e as Error).message}`); }
  if (!Array.isArray(j.steps) || j.steps.length === 0) throw new MissionError("the plan has no steps");
  if (j.steps.length > m.limits.maxSteps) throw new MissionError(`the plan has ${j.steps.length} steps; the limit is ${m.limits.maxSteps}`);
  const steps: Step[] = j.steps.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const seat = m.seats.find((s) => s.id === r.seat);
    if (!seat) throw new MissionError(`step ${i + 1} names crew "${String(r.seat)}", which is not on the crew`);
    const brief = typeof r.brief === "string" ? r.brief.trim() : "";
    if (!brief) throw new MissionError(`step ${i + 1} has no brief`);
    const deps = Array.isArray(r.dependsOn) ? r.dependsOn : [];
    for (const d of deps) if (!Number.isInteger(d) || (d as number) < 0 || (d as number) >= i) throw new MissionError(`step ${i + 1} depends on step ${Number(d) + 1}, which is not an earlier step`);
    return {
      id: `s${i + 1}`, title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 120) : `Step ${i + 1}`,
      seatId: seat.id, brief: brief.slice(0, 12_000), dependsOn: [...new Set(deps as number[])].map((d) => `s${d + 1}`), status: "waiting",
    };
  });
  const rationale = typeof j.rationale === "string" ? j.rationale.slice(0, 2000) : "";
  const guardrails = Array.isArray(j.guardrails) ? j.guardrails.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 10) : [];
  return { rationale, guardrails, steps };
}

export async function planMission(id: string): Promise<void> {
  const m0 = mutate(id, (m) => { m.working = "planning"; m.error = undefined; });
  log(id, { kind: "planning", text: m0.note ? "Jarvis is re-planning with your note." : "Jarvis is planning the steps and the crew." });
  try {
    const text = await (await drivers()).complete(plannerPrompt(m0), { timeoutMs: 300_000 });
    const m = loadMission(id);
    if (!m || m.stage !== "briefing") return; // stopped while planning
    const p = parsePlan(text, m);
    const used = new Set(p.steps.map((s) => s.seatId));
    // Our own guardrails, always, whatever the plan says.
    const ours = [
      `Each seat works only in its own scratch folder under ${path.join(".agentic-os", "missions", id, "seats")}.`,
      "claude seats may read, write and search the web; they have no shell.",
      `claude and hermes stop at ${MAX_TURNS} turns; codex and agy have no turn flag and stop at the time limit.`,
      `The whole mission stops at ${m.limits.timeLimitMin} minutes.`,
    ];
    mutate(id, (x) => {
      x.working = null;
      if (x.teamMode === "jarvis") x.seats = x.seats.filter((s) => used.has(s.id));
      x.plan = { rationale: p.rationale, guardrails: [...p.guardrails, ...ours], steps: p.steps, plannedAt: Date.now() };
    });
    log(id, { kind: "plan-ready", text: `Plan ready: ${p.steps.length} step${p.steps.length === 1 ? "" : "s"}. Waiting for your approval.` });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    mutate(id, (x) => { x.working = null; x.error = `Planning failed: ${msg}`; });
    log(id, { kind: "plan-failed", text: `Planning failed: ${msg}` });
  }
}

// ── running ──────────────────────────────────────────────────────────────────

function seatPrompt(m: Mission, s: Step, hasInputs: boolean): string {
  return [
    `You are one seat on a mission crew run by Jarvis (Agent OS). Mission: ${m.name}.`,
    `Mission objective: ${m.objective}`,
    `What success looks like: ${m.successLooksLike}`,
    `Your step: ${s.title}`,
    s.brief,
    hasInputs ? "Answers from the steps you depend on are in ./inputs/ as markdown files. Read them first." : "",
    "Work only inside this folder. End with your complete result as your final message; it is handed on as your answer.",
  ].filter(Boolean).join("\n\n");
}

function argsFor(seat: Seat, prompt: string, cwd: string, d: MissionDrivers): { args: string[]; input?: string } {
  const model = seat.model || d.defaultModel(seat.agent);
  switch (seat.agent) {
    case "claude":
      return {
        args: ["-p", ...(model ? ["--model", model] : []), "--max-turns", String(MAX_TURNS), "--output-format", "text",
          "--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch", "--no-session-persistence"],
        input: prompt,
      };
    case "hermes":
      return { args: ["chat", "-q", prompt, "-Q", "--yolo", "--accept-hooks", "--max-turns", String(MAX_TURNS), ...(model ? ["-m", model] : [])] };
    case "codex":
      return { args: ["exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", cwd, ...(model ? ["-m", model] : []), "-"], input: prompt };
    case "antigravity":
      return { args: ["-p", prompt, ...(model ? ["--model", model] : [])] };
  }
}

async function startStep(id: string, stepId: string): Promise<void> {
  const d = await drivers();
  const m = loadMission(id);
  const s = m?.plan?.steps.find((x) => x.id === stepId);
  if (!m || !s || s.status !== "waiting") return;
  const seat = seatOf(m, s);
  if (!seat) { failStep(id, stepId, "its seat is not on the crew"); return; }
  const cwd = seatDir(id, stepId);
  mkdirSync(path.join(cwd, "inputs"), { recursive: true });
  for (const dep of s.dependsOn) {
    const out = stepFile(id, dep, "md");
    if (existsSync(out)) writeFileSync(path.join(cwd, "inputs", `${dep}.md`), readFileSync(out, "utf8"), "utf8");
  }
  const prompt = seatPrompt(m, s, s.dependsOn.length > 0);
  const { args, input } = argsFor(seat, prompt, cwd, d);
  mkdirSync(path.dirname(stepFile(id, stepId, "log")), { recursive: true });
  const logStream = createWriteStream(stepFile(id, stepId, "log"), { flags: "a" });
  let stdout = "";
  let child: ChildLike;
  try {
    child = d.launch(seat.agent, args, { cwd, input });
  } catch (e) {
    logStream.end();
    failStep(id, stepId, `could not start ${seat.agent}: ${String((e as Error)?.message ?? e)}`);
    return;
  }
  reg().children.set(`${id}:${stepId}`, child);
  const now = Date.now();
  mutate(id, (x) => { const st = x.plan!.steps.find((y) => y.id === stepId)!; st.status = "running"; st.startedAt = now; });
  log(id, { kind: "handoff", stepId, seatId: seat.id, text: `Jarvis handed "${s.title}" to ${seatName(seat)}${TURN_CAPPED[seat.agent] ? ` (max ${MAX_TURNS} turns)` : " (no turn cap; bounded by the time limit)"}.`, brief: prompt });
  log(id, { kind: "picked-up", stepId, seatId: seat.id, text: `${seatName(seat)} picked up "${s.title}".` });

  let lastSave = 0;
  const heard = (chunk: string) => {
    const line = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
    const t = Date.now();
    if (t - lastSave < 2000) return; // throttle record writes; the log file has every byte
    lastSave = t;
    try { mutate(id, (x) => { const st = x.plan?.steps.find((y) => y.id === stepId); if (st && st.status === "running") { st.lastHeardAt = t; if (line) st.lastLine = line.slice(0, 200); } }); } catch { /* record busy or gone */ }
  };
  child.stdout.on("data", (b) => { const c = String(b); stdout += c; logStream.write(c); heard(c); });
  child.stderr.on("data", (b) => { const c = String(b); logStream.write(`[stderr] ${c}`); heard(c); });
  child.on("error", (err) => { logStream.write(`\n[spawn error] ${err.message}\n`); });
  child.on("close", (code) => {
    logStream.end();
    reg().children.delete(`${id}:${stepId}`);
    const cur = loadMission(id)?.plan?.steps.find((y) => y.id === stepId);
    if (!cur || cur.status !== "running") { void advance(id); return; } // stopped or timed out: already recorded
    if (code === 0 && stdout.trim()) {
      writeFileSync(stepFile(id, stepId, "md"), stdout.trim() + "\n", "utf8");
      mutate(id, (x) => { const st = x.plan!.steps.find((y) => y.id === stepId)!; st.status = "done"; st.finishedAt = Date.now(); st.exitCode = code; });
      log(id, { kind: "step-done", stepId, seatId: seat.id, text: `${seatName(seat)} finished "${s.title}".` });
    } else {
      failStep(id, stepId, code === 0 ? "it exited without an answer" : `it exited with code ${code}`, code);
    }
    void advance(id);
  });
}

function failStep(id: string, stepId: string, why: string, code: number | null = null): void {
  const m = mutate(id, (x) => { const st = x.plan!.steps.find((y) => y.id === stepId)!; st.status = "failed"; st.finishedAt = Date.now(); st.error = why; st.exitCode = code; });
  const s = m.plan!.steps.find((y) => y.id === stepId)!;
  log(id, { kind: "step-failed", stepId, seatId: s.seatId, text: `"${s.title}" failed: ${why}.` });
}

/** Start what is ready; when nothing is left to run, move on to the report. */
export async function advance(id: string): Promise<void> {
  const m = loadMission(id);
  if (!m || m.stage !== "in-progress" || !m.plan) return;
  const steps = m.plan.steps;
  const status = new Map(steps.map((s) => [s.id, s.status]));
  for (const s of steps) {
    if (s.status !== "waiting") continue;
    const deps = s.dependsOn.map((d) => status.get(d));
    if (deps.some((x) => x === "failed" || x === "stopped")) {
      mutate(id, (x) => { const st = x.plan!.steps.find((y) => y.id === s.id)!; st.status = "stopped"; st.error = "a step it depends on did not finish"; });
      log(id, { kind: "step-failed", stepId: s.id, seatId: s.seatId, text: `"${s.title}" was not started: a step it depends on did not finish.` });
      status.set(s.id, "stopped");
      continue;
    }
    if (deps.every((x) => x === "done")) { status.set(s.id, "running"); await startStep(id, s.id); }
  }
  const after = loadMission(id);
  if (!after || after.stage !== "in-progress") return;
  const left = after.plan!.steps.filter((s) => s.status === "waiting" || s.status === "running");
  // Log a dependency wait once, when a step first has to wait.
  const events = readEvents(id);
  for (const s of after.plan!.steps.filter((x) => x.status === "waiting")) {
    if (events.some((e) => e.kind === "waiting" && e.stepId === s.id)) continue;
    const on = s.dependsOn.filter((dep) => after.plan!.steps.find((y) => y.id === dep)?.status !== "done")
      .map((dep) => `"${after.plan!.steps.find((y) => y.id === dep)?.title ?? dep}"`);
    if (on.length) log(id, { kind: "waiting", stepId: s.id, seatId: s.seatId, text: `"${s.title}" waits for ${on.join(" and ")}.` });
  }
  if (left.length === 0) await finish(id);
}

export async function approvePlan(id: string): Promise<Mission> {
  const m = loadMission(id);
  if (!m) throw new MissionError(`no mission ${id}`, 404);
  if (m.stage !== "briefing" || !m.plan || m.working) throw new MissionError("there is no plan waiting for approval", 409);
  const now = Date.now();
  const deadlineAt = now + m.limits.timeLimitMin * 60_000;
  mutate(id, (x) => { x.planApproved = true; x.stage = "in-progress"; x.launchedAt = now; x.deadlineAt = deadlineAt; x.note = undefined; });
  log(id, { kind: "approved", text: `You approved the plan. Launched with a ${m.limits.timeLimitMin}-minute limit.` });
  armDeadline(id, deadlineAt);
  await advance(id);
  return loadMission(id)!;
}

function armDeadline(id: string, at: number) {
  const r = reg();
  const old = r.timers.get(id);
  if (old) clearTimeout(old);
  r.timers.set(id, setTimeout(() => { void timeUp(id); }, Math.max(0, at - Date.now())));
}

async function timeUp(id: string): Promise<void> {
  reg().timers.delete(id);
  const m = loadMission(id);
  if (!m || m.stage !== "in-progress") return;
  log(id, { kind: "timeout", text: `The ${m.limits.timeLimitMin}-minute limit was reached. Running seats were stopped.` });
  await killRunning(id, "stopped at the time limit");
  mutate(id, (x) => { for (const s of x.plan!.steps) if (s.status === "waiting") { s.status = "stopped"; s.error = "not started before the time limit"; } });
  await finish(id);
}

async function killRunning(id: string, why: string): Promise<void> {
  const d = await drivers();
  const r = reg();
  const m = loadMission(id);
  for (const s of m?.plan?.steps ?? []) {
    if (s.status !== "running") continue;
    const child = r.children.get(`${id}:${s.id}`);
    mutate(id, (x) => { const st = x.plan!.steps.find((y) => y.id === s.id)!; st.status = "stopped"; st.finishedAt = Date.now(); st.error = why; });
    if (child) { d.kill(child); r.children.delete(`${id}:${s.id}`); }
  }
}

// ── report ───────────────────────────────────────────────────────────────────

const WORDS = { brief: 150, standard: 400, detailed: 900 } as const;

async function finish(id: string): Promise<void> {
  const r = reg();
  const t = r.timers.get(id);
  if (t) { clearTimeout(t); r.timers.delete(id); }
  const m = loadMission(id);
  if (!m || m.stage !== "in-progress") return;
  const done = m.plan!.steps.filter((s) => s.status === "done");
  if (done.length === 0) {
    mutate(id, (x) => { x.stage = "failed"; x.finishedAt = Date.now(); x.error = "no step finished"; });
    log(id, { kind: "report-failed", text: "No step finished, so there is nothing to report. The mission failed." });
    return;
  }
  mutate(id, (x) => { x.working = "reporting"; });
  log(id, { kind: "reporting", text: "Every seat is finished. Jarvis is writing the report." });
  const answers = done.map((s) => `### ${s.title} (${seatName(seatOf(m, s))})\n${readFileSync(stepFile(id, s.id, "md"), "utf8").slice(0, 12_000)}`).join("\n\n");
  const missing = m.plan!.steps.filter((s) => s.status !== "done").map((s) => `- ${s.title}: ${s.error ?? s.status}`).join("\n");
  const prompt = [
    `You are Jarvis, reporting to the owner on a finished mission. Write about ${WORDS[m.limits.reportLength]} words of plain markdown: what was delivered, how it meets "what success looks like", open issues, and what to do next. Do not invent results the answers below do not contain.`,
    `Mission: ${m.name}\nObjective: ${m.objective}\nWhat success looks like: ${m.successLooksLike}`,
    missing ? `Steps that did not finish:\n${missing}` : "",
    `The crew's answers:\n\n${answers}`,
  ].filter(Boolean).join("\n\n");
  let report = "";
  try {
    report = (await (await drivers()).complete(prompt, { timeoutMs: 300_000 })).trim();
    if (!report) throw new Error("the report came back empty");
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    mutate(id, (x) => { x.working = null; x.error = `Report failed: ${msg}. The steps' answers are below.`; x.stage = "review"; x.finishedAt = Date.now(); });
    log(id, { kind: "report-failed", text: `The report failed (${msg}). The mission is waiting for your review with the steps' own answers.` });
    return;
  }
  const deliver = m.endAction === "deliver";
  mutate(id, (x) => {
    x.working = null; x.result = report; x.finishedAt = Date.now();
    x.stage = deliver ? "delivered" : "review";
    if (deliver) x.deliveredAt = Date.now();
  });
  log(id, { kind: "report-ready", text: "Report ready." });
  log(id, deliver ? { kind: "delivered", text: "Delivered, as you asked, without a review stop." } : { kind: "review", text: "Waiting for you: accept the result or send it back with a note." });
}

// ── owner actions ────────────────────────────────────────────────────────────

export async function missionAction(id: string, action: string, note?: string): Promise<Mission> {
  const m = loadMission(id);
  if (!m) throw new MissionError(`no mission ${id}`, 404);
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  switch (action) {
    case "approve":
      return approvePlan(id);
    case "send-back": {
      if (!cleanNote) throw new MissionError("say what should change: a note is required to send it back");
      if (m.stage === "briefing" && m.plan && !m.working) {
        mutate(id, (x) => { x.note = cleanNote; x.plan = undefined; x.planApproved = false; });
        log(id, { kind: "sent-back", text: `You sent the plan back: ${cleanNote}` });
      } else if (m.stage === "review") {
        mutate(id, (x) => { x.note = cleanNote; x.plan = undefined; x.planApproved = false; x.stage = "briefing"; x.finishedAt = undefined; x.deadlineAt = undefined; });
        log(id, { kind: "sent-back", text: `You sent the result back: ${cleanNote}` });
      } else throw new MissionError("nothing to send back right now", 409);
      void planMission(id);
      return loadMission(id)!;
    }
    case "replan": {
      if (m.stage !== "briefing" || m.working) throw new MissionError("only a mission in briefing can be planned again", 409);
      void planMission(id);
      return loadMission(id)!;
    }
    case "accept": {
      if (m.stage !== "review") throw new MissionError("there is no result waiting for you", 409);
      mutate(id, (x) => { x.stage = "delivered"; x.deliveredAt = Date.now(); });
      log(id, { kind: "accepted", text: "You accepted the result. Delivered." });
      return loadMission(id)!;
    }
    case "stop": {
      if (m.stage !== "in-progress" && m.stage !== "briefing") throw new MissionError("the mission is not running", 409);
      const t = reg().timers.get(id);
      if (t) { clearTimeout(t); reg().timers.delete(id); }
      await killRunning(id, "stopped by you");
      mutate(id, (x) => {
        x.stage = "stopped"; x.working = null; x.finishedAt = Date.now();
        for (const s of x.plan?.steps ?? []) if (s.status === "waiting") { s.status = "stopped"; s.error = "stopped by you"; }
      });
      log(id, { kind: "stopped", text: "You stopped the mission. Running seats were killed." });
      return loadMission(id)!;
    }
    default:
      throw new MissionError(`unknown action "${action}"`);
  }
}

// ── reading ──────────────────────────────────────────────────────────────────

/** A server restart kills every child; say so instead of showing ghosts as running. */
export function recoverAfterRestart(): void {
  const r = reg();
  if (r.recovered) return;
  r.recovered = true;
  for (const m of listMissions()) {
    let touched = false;
    if (m.working) {
      touched = true;
      const what = m.working;
      mutate(m.id, (x) => { x.working = null; x.error = `The server restarted while Jarvis was ${what}. ${what === "planning" ? "Plan again." : "The steps' answers are kept."}`; if (what === "reporting") { x.stage = "review"; x.finishedAt = Date.now(); } });
      log(m.id, { kind: "recovered", text: `The server restarted while Jarvis was ${what}.` });
    }
    if (m.stage === "in-progress") {
      for (const s of m.plan?.steps ?? []) {
        if (s.status === "running" && !r.children.has(`${m.id}:${s.id}`)) {
          touched = true;
          mutate(m.id, (x) => { const st = x.plan!.steps.find((y) => y.id === s.id)!; st.status = "failed"; st.finishedAt = Date.now(); st.error = "the server restarted while it ran"; });
          log(m.id, { kind: "recovered", stepId: s.id, seatId: s.seatId, text: `"${s.title}" was lost: the server restarted while it ran.` });
        }
      }
      if (m.deadlineAt && m.deadlineAt > Date.now()) armDeadline(m.id, m.deadlineAt);
      if (touched || (m.deadlineAt ?? 0) <= Date.now()) void (m.deadlineAt && m.deadlineAt <= Date.now() ? timeUp(m.id) : advance(m.id));
    }
  }
}

export interface MissionStats {
  waitingOnYou: number;
  cycleTimeMin: number | null;
  onTimePct: number | null;
  onTimeOf: number;
  agentsAtWork: number;
  counts: Record<"briefing" | "in-progress" | "review" | "delivered" | "stopped" | "failed", number>;
}

export function missionStats(missions: Mission[]): MissionStats {
  const counts = { briefing: 0, "in-progress": 0, review: 0, delivered: 0, stopped: 0, failed: 0 };
  for (const m of missions) counts[m.stage]++;
  const waitingOnYou = missions.filter((m) => (m.stage === "briefing" && m.plan && !m.working) || m.stage === "review").length;
  const cycles = missions.filter((m) => m.stage === "delivered" && m.deliveredAt).map((m) => (m.deliveredAt! - m.createdAt) / 60_000).sort((a, b) => a - b);
  const cycleTimeMin = cycles.length ? Math.round(cycles.length % 2 ? cycles[(cycles.length - 1) / 2] : (cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2) : null;
  const dated = missions.filter((m) => m.stage === "delivered" && m.deliveredAt && m.targetDate);
  const onTime = dated.filter((m) => m.deliveredAt! <= new Date(`${m.targetDate}T23:59:59`).getTime()).length;
  const agentsAtWork = missions.reduce((n, m) => n + (m.plan?.steps.filter((s) => s.status === "running").length ?? 0), 0);
  return { waitingOnYou, cycleTimeMin, onTimePct: dated.length ? Math.round((onTime / dated.length) * 100) : null, onTimeOf: dated.length, agentsAtWork, counts };
}

export async function crewAvailability(): Promise<{ agent: MissionAgent; installed: boolean; turnCapped: boolean; defaultModel?: string }[]> {
  const d = await drivers();
  return MISSION_AGENTS.map((agent) => ({ agent, installed: d.installed(agent), turnCapped: TURN_CAPPED[agent], defaultModel: d.defaultModel(agent) }));
}

export { listMissions, loadMission, readEvents, newMissionId };

/** Smoke hook: fire a mission's time limit now instead of waiting 15+ minutes. */
export const __timeUpForTests = timeUp;
