// SPEC-B B7 smoke: skills-as-policies (migration 022 v2_skills). FULLY OFFLINE
// — temp DB/settings, no LLM (the engine leg uses a capturing EngineLlm via
// setEngineLlmForTests), no network. Covers:
//   store CRUD + position ordering + active filter + soft-archive (row kept);
//   renderSkillPolicyBlock: active-only, position order, cap/trim marker;
//   withSkills: prepend + double-wrap guard + passthrough when empty;
//   jarvis C4 assembly (buildSystemPrompt / buildStableSystemPrompt) includes
//     an active skill's policy text at the skills slot and DROPS it when the
//     skill is deactivated;
//   task engine (B2) PLAN + STEP system prompts carry the block (captured via
//     the EngineLlm test seam through a REAL runTask walk);
//   route contract: GET/POST /api/v2/skills + GET/PATCH/DELETE /skills/[id]
//     incl. DELETE = soft-archive (never row destruction).
// Run: npx tsx scripts/v2/smoke-skills.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ---- env BEFORE imports (temp DB + temp settings) ----
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-skills-${stamp}.db`);
const tmpSettings = path.join(os.tmpdir(), `agentos-smoke-skills-settings-${stamp}.json`);
process.env.AGENTIC_OS_DB = tmpDb;
process.env.AGENTIC_OS_SETTINGS = tmpSettings;
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may call out
fs.writeFileSync(
  tmpSettings,
  JSON.stringify({
    tasks: { timezone: "America/Chicago", editingBufferSec: 1, planApproval: "always" },
    memory: { ingestEnabled: false },
  }),
);

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const skills = await import("../../src/lib/v2/skills/store.ts");
const ctx = await import("../../src/lib/v2/jarvis/context.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const taskStore = await import("../../src/lib/v2/tasks/store.ts");
const engine = await import("../../src/lib/v2/tasks/engine.ts");
const rec = await import("../../src/lib/v2/tasks/recurrence.ts");
const listRoute = await import("../../src/app/api/v2/skills/route.ts");
const idRoute = await import("../../src/app/api/v2/skills/[id]/route.ts");
const { NextRequest } = await import("next/server");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();
rec.registerTaskWakeHandler(); // 'task.wake' job → dispatch → engine.runTask
const db = getDb();

// ---------------------------------------------------------------------------
// A. store CRUD + ordering + active filter + soft-archive
// ---------------------------------------------------------------------------
console.log("--- A. store CRUD ---");

const seeded = skills.getSkill("skill-example");
check("A1 migration seeds ONE disabled example skill", !!seeded && seeded.isActive === false);

const s1 = skills.createSkill({ title: "Voice rules", policyMd: "POLICY-ONE never use em dashes." });
const s2 = skills.createSkill({ title: "Consent rules", policyMd: "POLICY-TWO outreach needs approval." });
const s3 = skills.createSkill({ title: "Inactive one", policyMd: "POLICY-THREE hidden.", isActive: false });
check("A2 create assigns ascending positions", s1.position < s2.position && s2.position < s3.position);
check("A3 listSkills position order (seed pos 0 first)",
  skills.listSkills().map((s) => s.id).join(",") === [seeded.id, s1.id, s2.id, s3.id].join(","));
check("A4 listActiveSkills = active only, ordered",
  skills.listActiveSkills().map((s) => s.id).join(",") === [s1.id, s2.id].join(","));

const upd = skills.updateSkill(s1.id, { description: "desc here", policyMd: "POLICY-ONE updated body." });
check("A5 updateSkill patches fields", upd.description === "desc here" && upd.policyMd.includes("updated body"));
let threw = false;
try { skills.updateSkill(s1.id, { title: "  " }); } catch (e) { threw = e instanceof skills.SkillError && e.status === 400; }
check("A6 empty title rejected (SkillError 400)", threw);
threw = false;
try { skills.updateSkill("nope", { title: "x" }); } catch (e) { threw = e instanceof skills.SkillError && e.status === 404; }
check("A7 unknown id → SkillError 404", threw);

// reorder: move s2 ahead of s1 by swapping positions
skills.updateSkill(s2.id, { position: s1.position });
skills.updateSkill(s1.id, { position: s2.position + 1 });
check("A8 position PATCH reorders the active set",
  skills.listActiveSkills().map((s) => s.id).join(",") === [s2.id, s1.id].join(","));
// restore original order for later legs
skills.updateSkill(s1.id, { position: 1 });
skills.updateSkill(s2.id, { position: 2 });

const archived = skills.archiveSkill(s3.id);
check("A9 archiveSkill stamps archived_at + deactivates", !!archived.archivedAt && archived.isActive === false);
check("A10 archived row hidden from listSkills, shown with includeArchived",
  !skills.listSkills().some((s) => s.id === s3.id) &&
  skills.listSkills({ includeArchived: true }).some((s) => s.id === s3.id));
check("A11 soft-archive keeps the row (never destroyed)",
  db.prepare("SELECT COUNT(*) AS c FROM v2_skills WHERE id = ?").get(s3.id).c === 1);

// ---------------------------------------------------------------------------
// B. renderSkillPolicyBlock — active-only, order, cap
// ---------------------------------------------------------------------------
console.log("--- B. policy block ---");

let block = skills.renderSkillPolicyBlock();
check("B1 block renders active skills only",
  block.includes("POLICY-ONE") && block.includes("POLICY-TWO") &&
  !block.includes("POLICY-THREE") && !block.includes("Lead with the answer"));
check("B2 block is tagged <skill_policies> with titles",
  block.startsWith("<skill_policies>") && block.trimEnd().endsWith("</skill_policies>") &&
  block.includes("### Voice rules") && block.includes("### Consent rules"));
check("B3 position order inside the block", block.indexOf("POLICY-ONE") < block.indexOf("POLICY-TWO"));

const big = skills.createSkill({ title: "Big policy", policyMd: "Z".repeat(20000) });
const capped = skills.renderSkillPolicyBlock();
check("B4 cap: block ≤ SKILL_POLICY_MAX_CHARS with trim marker",
  capped.length <= skills.SKILL_POLICY_MAX_CHARS + "</skill_policies>".length + 2 &&
  capped.includes("[skill policies trimmed to fit]"), capped.length);
skills.archiveSkill(big.id);

// empty case
const savedActive = skills.listActiveSkills().map((s) => s.id);
for (const id of savedActive) skills.updateSkill(id, { isActive: false });
check("B5 no active skills → empty block", skills.renderSkillPolicyBlock() === "");
check("B6 withSkills passthrough when empty", skills.withSkills("BASE PROMPT") === "BASE PROMPT");
for (const id of savedActive) skills.updateSkill(id, { isActive: true });

const wrapped = skills.withSkills("BASE PROMPT");
check("B7 withSkills prepends the block", wrapped.startsWith("<skill_policies>") && wrapped.endsWith("BASE PROMPT"));
check("B8 withSkills double-wrap guard", skills.withSkills(wrapped) === wrapped);

// ---------------------------------------------------------------------------
// C. jarvis C4 assembly — policy text in, dropped on deactivate
// ---------------------------------------------------------------------------
console.log("--- C. jarvis assembly ---");

const full = ctx.buildSystemPrompt({ personaDocContent: null, pageContext: null, skillNames: ["NAME-NOTE-MARKER"] });
check("C1 buildSystemPrompt includes the active policy text", full.includes("POLICY-ONE") && full.includes("POLICY-TWO"));
check("C2 policy block sits at the skills slot (before <current_datetime>)",
  full.indexOf("<skill_policies>") !== -1 && full.indexOf("<skill_policies>") < full.indexOf("<current_datetime>"));
check("C3 file-skill names note still renders beside the policies",
  full.includes("NAME-NOTE-MARKER") && full.indexOf("<skill_policies>") < full.indexOf("NAME-NOTE-MARKER"));

const stable = ctx.buildStableSystemPrompt({ personaDocContent: null, skillNames: [] });
check("C4 buildStableSystemPrompt (sdk seed) carries the block too", stable.includes("POLICY-ONE"));

skills.updateSkill(s1.id, { isActive: false });
const afterOff = ctx.buildSystemPrompt({ personaDocContent: null, pageContext: null, skillNames: [] });
check("C5 deactivated skill drops out of the assembly", !afterOff.includes("POLICY-ONE") && afterOff.includes("POLICY-TWO"));
skills.updateSkill(s1.id, { isActive: true });

const overridden = ctx.buildSystemPrompt({ personaDocContent: null, pageContext: null, skillNames: [], skillPolicies: "" });
check("C6 skillPolicies test override suppresses the store read", !overridden.includes("<skill_policies>"));

// ---------------------------------------------------------------------------
// D. task engine (B2) — PLAN + STEP system prompts carry the block
// ---------------------------------------------------------------------------
console.log("--- D. task engine injection ---");

const captured = { plan: [], step: [], text: [] };
const reasonStep = (title) => ({
  title, kind: "reason", instruction: "do it", command: null, cwd: null, path: null, filesOp: null, pattern: null,
});
engine.setEngineLlmForTests({
  async plan(messages) {
    captured.plan.push(messages);
    return { planMd: "1. Do the thing", steps: [reasonStep("Do the thing")] };
  },
  async step(messages) {
    captured.step.push(messages);
    return { status: "ok", output: "done", question: null };
  },
  async text(messages) {
    captured.text.push(messages);
    return "summary";
  },
  async recall() { return null; },
});

const runNow = async (taskId) => {
  const t = taskStore.getTask(taskId);
  sched.enqueueTask(taskId, { immediate: true, expectedUpdatedAt: t.updatedAt });
  await sched.tickOnce();
};

const task = taskStore.createTask({ title: "skills smoke task", specMd: "walk one reason step" });
await runNow(task.id);
const planSys = captured.plan[0]?.find((m) => m.role === "system")?.content ?? "";
check("D1 PLAN system prompt carries <skill_policies> + policy text",
  planSys.startsWith("<skill_policies>") && planSys.includes("POLICY-ONE") && planSys.includes("You are Jarvis, the Agent OS task planner"));

engine.approvePlan(task.id);
await runNow(task.id);
const stepSys = captured.step[0]?.find((m) => m.role === "system")?.content ?? "";
check("D2 STEP system prompt carries the block", stepSys.startsWith("<skill_policies>") && stepSys.includes("POLICY-TWO"));
check("D3 run completed through the injected prompts (Review)", taskStore.getTask(task.id).status === "Review");
const sumSys = captured.text.find((msgs) => msgs.some((m) => m.role === "system" && m.content.includes("summarizing a finished task run")));
check("D4 SUMMARY prompt stays bare (post-hoc reporting, no policies)",
  !!sumSys && !sumSys.find((m) => m.role === "system").content.includes("<skill_policies>"));

// no-active-skills → bare prompts
for (const id of skills.listActiveSkills().map((s) => s.id)) skills.updateSkill(id, { isActive: false });
const task2 = taskStore.createTask({ title: "bare prompt task" });
await runNow(task2.id);
const planSys2 = captured.plan[1]?.find((m) => m.role === "system")?.content ?? "";
check("D5 zero active skills → PLAN prompt is the bare system prompt", !planSys2.includes("<skill_policies>") && planSys2.length > 0);
for (const id of [s1.id, s2.id]) skills.updateSkill(id, { isActive: true });
engine.setEngineLlmForTests(null);

// ---------------------------------------------------------------------------
// E. route contract (direct-import handlers)
// ---------------------------------------------------------------------------
console.log("--- E. routes ---");

const jreq = (url, method, body) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const idCtx = (id) => ({ params: Promise.resolve({ id }) });

const listRes = await listRoute.GET(jreq("/api/v2/skills", "GET"));
const listJson = await listRes.json();
check("E1 GET list: active-order rows, archived hidden",
  listRes.status === 200 && Array.isArray(listJson.skills) &&
  listJson.skills.some((s) => s.id === s1.id) && !listJson.skills.some((s) => s.id === s3.id));
const allJson = await (await listRoute.GET(jreq("/api/v2/skills?all=1", "GET"))).json();
check("E2 GET ?all=1 includes archived rows", allJson.skills.some((s) => s.id === s3.id && s.archivedAt));

const createRes = await listRoute.POST(jreq("/api/v2/skills", "POST", { title: "Route-created", policyMd: "ROUTE-POLICY body", isActive: false }));
const created = (await createRes.json()).skill;
check("E3 POST → 201 with the skill", createRes.status === 201 && created?.title === "Route-created" && created.isActive === false);
check("E4 POST without title → 400", (await listRoute.POST(jreq("/api/v2/skills", "POST", { policyMd: "x" }))).status === 400);

const getRes = await idRoute.GET(jreq(`/api/v2/skills/${created.id}`, "GET"), idCtx(created.id));
check("E5 GET [id] → the skill", getRes.status === 200 && (await getRes.json()).skill.id === created.id);
check("E6 GET unknown id → 404", (await idRoute.GET(jreq("/api/v2/skills/nope", "GET"), idCtx("nope"))).status === 404);

const patchRes = await idRoute.PATCH(jreq(`/api/v2/skills/${created.id}`, "PATCH", { isActive: true, position: 99 }), idCtx(created.id));
const patched = (await patchRes.json()).skill;
check("E7 PATCH toggles is_active + position", patchRes.status === 200 && patched.isActive === true && patched.position === 99);
check("E8 PATCH-activated skill now renders in the policy block", skills.renderSkillPolicyBlock().includes("ROUTE-POLICY"));
check("E9 PATCH unknown id → 404", (await idRoute.PATCH(jreq("/api/v2/skills/nope", "PATCH", { title: "x" }), idCtx("nope"))).status === 404);

const delRes = await idRoute.DELETE(jreq(`/api/v2/skills/${created.id}`, "DELETE"), idCtx(created.id));
const delJson = await delRes.json();
check("E10 DELETE → soft-archive (ok:true, archivedAt set, inactive)",
  delRes.status === 200 && delJson.ok === true && !!delJson.skill.archivedAt && delJson.skill.isActive === false);
check("E11 archived row survives in the DB and leaves the injection",
  db.prepare("SELECT COUNT(*) AS c FROM v2_skills WHERE id = ?").get(created.id).c === 1 &&
  !skills.renderSkillPolicyBlock().includes("ROUTE-POLICY"));
check("E12 DELETE unknown id → 404", (await idRoute.DELETE(jreq("/api/v2/skills/nope", "DELETE"), idCtx("nope"))).status === 404);

// ---------------------------------------------------------------------------
// teardown (Windows libuv: stop timers before exit)
// ---------------------------------------------------------------------------
try {
  const queue = await import("../../src/lib/v2/memory/queue.ts");
  queue.stopMemoryQueue?.();
} catch {}
try {
  const s = globalThis.__agentosV2Scheduler;
  if (s?.timer) clearInterval(s.timer);
} catch {}
await new Promise((r) => setTimeout(r, 250));
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}
try { fs.rmSync(tmpSettings, { force: true }); } catch {}
console.log(failures === 0 ? "\nsmoke-skills: ALL PASS" : `\nsmoke-skills: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
