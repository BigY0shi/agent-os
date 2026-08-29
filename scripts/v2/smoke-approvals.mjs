// Phase-4 chunk 2 smoke: Human-Gate approval flow.
//   interactive requires_approval invoke → PENDING record + approval-required
//   result + attention.flag; approve → tool EXECUTED (source 'human-gate') +
//   result stored + follow-up persisted to the conversation; deny → no
//   execution; expiry → 410; strict/non-interactive → hard refuse (no record);
//   §9.4 taint → refused with NO approval record created.
// Run: npx tsx scripts/v2/smoke-approvals.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any imports — never touch the live DB/settings/secrets.
const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-approvals-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-appr-set-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_WEBMCP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-appr-sec-"));
process.env.AGENTOS_MOCK_LLM = "1"; // no network, deterministic

const store = await import("../../src/lib/v2/webmcp/store.ts");
const { executeTool } = await import("../../src/lib/v2/webmcp/execute.ts");
const approvals = await import("../../src/lib/v2/webmcp/approvals.ts");
const tools = await import("../../src/lib/v2/jarvis/tools.ts");
const conv = await import("../../src/lib/v2/jarvis/conversations.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");
const { recent, on } = await import("../../src/lib/v2/events.ts");
const { createTask, listTasks } = await import("../../src/lib/v2/tasks/store.ts");
const { seedSelfTools } = await import("../../src/lib/v2/webmcp/seedSelfTools.ts");
const { ensureTaskActions } = await import("../../src/lib/v2/mcp/taskActions.ts");
const { NextRequest } = await import("next/server");
const approvalsRoute = await import("../../src/app/api/v2/webmcp/approvals/route.ts");
const approvalIdRoute = await import("../../src/app/api/v2/webmcp/approvals/[id]/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra !== undefined ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`);
  if (!cond) failures++;
};

const flagEvents = [];
on("attention.flag", (ev) => flagEvents.push(ev));
const approvalEvents = [];
on("webmcp.approval", (ev) => approvalEvents.push(ev));

// ---------------------------------------------------------------------------
// Setup: published package with a requires_approval tool
// ---------------------------------------------------------------------------
store.createPackage({ slug: "gate-pkg", name: "Gate Package" });
store.addTool("gate-pkg", {
  name: "guarded_write",
  description: "A guarded write tool",
  inputSchema: {
    type: "object",
    properties: { note: { type: "string" }, apiKey: { type: "string" } },
    required: ["note"],
  },
  handlerKind: "js",
  handlerConfig: { code: "return { wrote: args.note };" },
  requiresApproval: true,
});
store.publishPackage("gate-pkg");

const conversation = conv.createConversation({ title: "approval smoke", channel: "overlay" });

// ---------------------------------------------------------------------------
// A. Interactive invoke → pending record + approval-required result + events
// ---------------------------------------------------------------------------
const res1 = await executeTool("gate-pkg", "guarded_write", { note: "hello-gate", apiKey: "sekrit-value" }, {
  source: "jarvis",
  interactive: true,
  conversationId: conversation.id,
});
check("interactive invoke does NOT execute (ok:false)", res1.ok === false && !String(res1.output).includes("hello-gate"));
check("result names the approval id", typeof res1.approval?.id === "string" && (res1.error ?? "").includes(res1.approval.id));
check("result error says approval + no-retry", /approval/i.test(res1.error ?? "") && /retry/i.test(res1.error ?? ""));
check("approval info redacts secret-looking args", res1.approval.redactedArgs.apiKey === "[redacted]" && res1.approval.redactedArgs.note === "hello-gate");

const pend = approvals.getApproval(res1.approval.id);
check("pending record exists with raw args kept for execution", pend?.status === "pending" && pend.args.note === "hello-gate" && pend.args.apiKey === "sekrit-value");
check("record carries requestedBy + conversationId", pend.requestedBy === "jarvis" && pend.conversationId === conversation.id);
check("expiry ~10min out", new Date(pend.expiresAt).getTime() - Date.now() > 8 * 60 * 1000);

const flag = flagEvents.find((e) => e.payload?.dedupeKey === res1.approval.id);
check("attention.flag emitted {kind webmcp.approval, severity warn, dedupeKey=id}", flag?.payload?.kind === "webmcp.approval" && flag.payload.severity === "warn" && typeof flag.payload.title === "string" && typeof flag.payload.route === "string");
check("webmcp.approval event emitted (pending)", approvalEvents.some((e) => e.payload?.id === res1.approval.id && e.payload.status === "pending"));
check("refusal call-log written (no execution log)", store.listCallLogs({ packageSlug: "gate-pkg" }).every((l) => !l.ok));

// ---------------------------------------------------------------------------
// B. GET routes: list + status filter + raw-args NEVER in responses
// ---------------------------------------------------------------------------
const listRes = await approvalsRoute.GET(new NextRequest("http://127.0.0.1/api/v2/webmcp/approvals?status=pending"));
const listJson = await listRes.json();
check("GET ?status=pending lists the record", listRes.status === 200 && listJson.approvals.some((a) => a.id === res1.approval.id));
check("route response carries redacted args ONLY (no raw secret)", !JSON.stringify(listJson).includes("sekrit-value"));
const badStatus = await approvalsRoute.GET(new NextRequest("http://127.0.0.1/api/v2/webmcp/approvals?status=nope"));
check("GET bad status → 400", badStatus.status === 400);
const get1 = await approvalIdRoute.GET(new NextRequest("http://127.0.0.1/x"), { params: Promise.resolve({ id: res1.approval.id }) });
check("GET [id] returns the record", get1.status === 200 && (await get1.json()).approval.id === res1.approval.id);
const get404 = await approvalIdRoute.GET(new NextRequest("http://127.0.0.1/x"), { params: Promise.resolve({ id: "nope" }) });
check("GET unknown id → 404", get404.status === 404);

// ---------------------------------------------------------------------------
// C. Approve via the route → tool EXECUTED + result stored + follow-up message
// ---------------------------------------------------------------------------
const approveRes = await approvalIdRoute.POST(
  new NextRequest("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ action: "approve" }), headers: { "content-type": "application/json" } }),
  { params: Promise.resolve({ id: res1.approval.id }) },
);
const approveJson = await approveRes.json();
check("approve route → 200 + executed result returned", approveRes.status === 200 && approveJson.result?.ok === true && approveJson.result.output.includes("hello-gate"));
check("record now approved with result stored", (() => { const a = approvals.getApproval(res1.approval.id); return a.status === "approved" && a.result?.ok === true && a.result.output.includes("hello-gate") && a.resolvedAt; })());
check("execution logged with source 'human-gate'", store.listCallLogs({ packageSlug: "gate-pkg", source: "human-gate" }).some((l) => l.ok));
const msgs = conv.listMessages(conversation.id);
const followUp = msgs.find((m) => m.role === "system" && m.content.includes("[human-gate]"));
check("follow-up persisted to the conversation (system + toolCalls)", followUp && followUp.content.includes("gate-pkg/guarded_write") && followUp.toolCalls?.[0]?.ok === true);
check("webmcp.approval event emitted (approved)", approvalEvents.some((e) => e.payload?.id === res1.approval.id && e.payload.status === "approved"));
const reApprove = await approvalIdRoute.POST(
  new NextRequest("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ action: "approve" }), headers: { "content-type": "application/json" } }),
  { params: Promise.resolve({ id: res1.approval.id }) },
);
check("re-approving a resolved record → 409", reApprove.status === 409);

// ---------------------------------------------------------------------------
// D. Deny → denied, NO execution
// ---------------------------------------------------------------------------
const res2 = await executeTool("gate-pkg", "guarded_write", { note: "deny-me" }, { source: "jarvis", interactive: true, conversationId: conversation.id });
const humanGateLogsBefore = store.listCallLogs({ packageSlug: "gate-pkg", source: "human-gate" }).length;
const denyRes = await approvalIdRoute.POST(
  new NextRequest("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ action: "deny" }), headers: { "content-type": "application/json" } }),
  { params: Promise.resolve({ id: res2.approval.id }) },
);
const denyJson = await denyRes.json();
check("deny route → 200, status denied, no result", denyRes.status === 200 && denyJson.approval.status === "denied" && denyJson.result === null);
check("deny did NOT execute (no new human-gate log)", store.listCallLogs({ packageSlug: "gate-pkg", source: "human-gate" }).length === humanGateLogsBefore);
check("deny follow-up persisted", conv.listMessages(conversation.id).some((m) => m.role === "system" && m.content.includes("DENIED")));

// ---------------------------------------------------------------------------
// E. Expiry → 410
// ---------------------------------------------------------------------------
const res3 = await executeTool("gate-pkg", "guarded_write", { note: "expire-me" }, { source: "jarvis", interactive: true });
getDb().prepare("UPDATE webmcp_approvals SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), res3.approval.id);
const expiredRes = await approvalIdRoute.POST(
  new NextRequest("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ action: "approve" }), headers: { "content-type": "application/json" } }),
  { params: Promise.resolve({ id: res3.approval.id }) },
);
check("approve after expiry → 410", expiredRes.status === 410);
check("record flipped to expired", approvals.getApproval(res3.approval.id).status === "expired");

// ---------------------------------------------------------------------------
// F. Strict / non-interactive callers → HARD REFUSE, no record
// ---------------------------------------------------------------------------
const countBefore = approvals.listApprovals({ limit: 200 }).length;
const nonInt = await executeTool("gate-pkg", "guarded_write", { note: "x" }, { source: "mcp:remote", interactive: false });
check("non-interactive → hard refuse (no approval offer)", nonInt.ok === false && !nonInt.approval && /non-interactively/.test(nonInt.error ?? ""));
const strictInt = await executeTool("gate-pkg", "guarded_write", { note: "x" }, { source: "mcp:remote", interactive: true, strict: true });
check("strict caller → hard refuse even when interactive", strictInt.ok === false && !strictInt.approval);
check("no approval records created for strict/non-interactive", approvals.listApprovals({ limit: 200 }).length === countBefore);

// ---------------------------------------------------------------------------
// G. Jarvis lanes: hub-tool wrapper + execute_action registry gate + taint
// ---------------------------------------------------------------------------
ensureTaskActions();
seedSelfTools();

// Hub-tool wrapper: approval event streamed, conversation threaded from state.
const events1 = [];
const state1 = tools.newTurnState();
state1.conversationId = conversation.id;
const handlers1 = tools.buildJarvisToolHandlers({ emit: (ev) => events1.push(ev), state: state1 });
const hubGate = await handlers1.guarded_write.run({ note: "via-jarvis" });
const approvalEv = events1.find((e) => e.type === "approval");
check("jarvis hub tool → isError + approval stream event", hubGate.isError === true && approvalEv?.slug === "gate-pkg" && approvalEv.tool === "guarded_write");
check("jarvis-created approval threads the conversation", approvals.getApproval(approvalEv.id)?.conversationId === conversation.id);
check("model-facing text says approve/deny, no retry", /Approve or Deny/i.test(hubGate.content[0].text) && /Do NOT retry/i.test(hubGate.content[0].text));

// execute_action registry gate (plain key, requiresApproval on the registry entry).
const task = createTask({ title: "approval-smoke task", source: "user" });
const events2 = [];
const state2 = tools.newTurnState();
state2.conversationId = conversation.id;
const handlers2 = tools.buildJarvisToolHandlers({ emit: (ev) => events2.push(ev), state: state2 });
const regGate = await handlers2.execute_action.run({ key: "tasks_update_status", args: { id: task.displayId, status: "Waiting" } });
const regEv = events2.find((e) => e.type === "approval");
check("execute_action registry gate → approval created (slug 'registry')", regGate.isError === true && regEv && approvals.getApproval(regEv.id)?.slug === "registry");
check("registry gate did not run the action yet", listTasks({}).find((t) => t.id === task.id)?.status === "Todo");
const regResolved = await approvals.resolveApproval(regEv.id, "approve");
check("approve executes the registry action (task → Waiting)", regResolved.result?.ok === true && listTasks({}).find((t) => t.id === task.id)?.status === "Waiting");

// execute_action on a `<slug>/<tool>` key resolves to the package lane.
const task2 = createTask({ title: "approval-smoke task 2", source: "user" });
const events3 = [];
const state3 = tools.newTurnState();
const handlers3 = tools.buildJarvisToolHandlers({ emit: (ev) => events3.push(ev), state: state3 });
const pkgGate = await handlers3.execute_action.run({ key: "agentos/tasks_update_status", args: { id: task2.displayId, status: "Review" } });
const pkgEv = events3.find((e) => e.type === "approval");
check("`agentos/...` key gates into the package lane", pkgGate.isError === true && pkgEv?.slug === "agentos" && pkgEv.tool === "tasks_update_status");
const pkgResolved = await approvals.resolveApproval(pkgEv.id, "approve");
check("package-lane approve executes via published snapshot (task2 → Review)", pkgResolved.result?.ok === true && listTasks({}).find((t) => t.id === task2.id)?.status === "Review");

// §9.4 taint STILL WINS — no approval path around taint.
const taintCount = approvals.listApprovals({ limit: 200 }).length;
const events4 = [];
const state4 = tools.newTurnState();
state4.integrationTainted = true;
const handlers4 = tools.buildJarvisToolHandlers({ emit: (ev) => events4.push(ev), state: state4 });
const taintedHub = await handlers4.guarded_write.run({ note: "tainted" });
check("tainted session: hub tool refused outright", taintedHub.isError === true && /integration/i.test(taintedHub.content[0].text));
const taintedReg = await handlers4.execute_action.run({ key: "tasks_update_status", args: { id: task.displayId, status: "Review" } });
check("tainted session: execute_action refused outright", taintedReg.isError === true && /integration/i.test(taintedReg.content[0].text));
check("taint created NO approval records", approvals.listApprovals({ limit: 200 }).length === taintCount && !events4.some((e) => e.type === "approval"));

// attention.flag rows are in the events table too (persisted contract).
check("attention.flag persisted to the events table", recent({ type: "attention.flag" }).some((e) => e.payload?.kind === "webmcp.approval"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
