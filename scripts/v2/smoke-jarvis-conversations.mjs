// Phase-4 chunk 2 smoke: C3.6 conversations REST + transcript drawer.
//   list (newest first, messageCount) / get (messages incl. tool_calls) /
//   PATCH title / DELETE = ARCHIVE (soft — rows never destroyed) + static
//   drawer contract in ChatboxOverlay.
// Run: npx tsx scripts/v2/smoke-jarvis-conversations.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-jconv-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jconv-set-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_WEBMCP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jconv-sec-"));
process.env.AGENTOS_MOCK_LLM = "1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const conv = await import("../../src/lib/v2/jarvis/conversations.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");
const { NextRequest } = await import("next/server");
const listRoute = await import("../../src/app/api/v2/jarvis/conversations/route.ts");
const idRoute = await import("../../src/app/api/v2/jarvis/conversations/[id]/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra !== undefined ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`);
  if (!cond) failures++;
};
const ctxOf = (id) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
// Seed: two conversations with messages (incl. tool_calls_json)
// ---------------------------------------------------------------------------
const c1 = conv.createConversation({ title: "first conversation", channel: "overlay" });
conv.appendJarvisMessage({ conversationId: c1.id, role: "user", content: "hello jarvis" });
conv.appendJarvisMessage({
  conversationId: c1.id,
  role: "assistant",
  content: "hello back",
  toolCalls: [{ name: "tasks_create", summary: "tk-9 created", ok: true }],
});
await new Promise((r) => setTimeout(r, 10)); // distinct updated_at for the ordering assert
const c2 = conv.createConversation({ title: "second conversation", channel: "page" });
conv.appendJarvisMessage({ conversationId: c2.id, role: "user", content: "newer one" });

// ---------------------------------------------------------------------------
// A. GET list — newest first + messageCount + shape
// ---------------------------------------------------------------------------
const list1 = await (await listRoute.GET(new NextRequest("http://127.0.0.1/api/v2/jarvis/conversations"))).json();
check("list returns both, newest (c2) first", list1.conversations.length === 2 && list1.conversations[0].id === c2.id && list1.conversations[1].id === c1.id);
const row1 = list1.conversations.find((c) => c.id === c1.id);
check("list rows carry {id,title,channel,updatedAt,messageCount}", row1.title === "first conversation" && row1.channel === "overlay" && typeof row1.updatedAt === "string" && row1.messageCount === 2);

// ---------------------------------------------------------------------------
// B. GET [id] — messages incl. toolCalls; 404 unknown
// ---------------------------------------------------------------------------
const getRes = await idRoute.GET(new NextRequest("http://127.0.0.1/x"), ctxOf(c1.id));
const getJson = await getRes.json();
check("GET [id] returns conversation + ordered messages", getRes.status === 200 && getJson.conversation.id === c1.id && getJson.messages.length === 2 && getJson.messages[0].content === "hello jarvis");
check("messages include toolCalls from tool_calls_json", getJson.messages[1].toolCalls?.[0]?.name === "tasks_create" && getJson.messages[1].toolCalls[0].ok === true);
check("GET unknown → 404", (await idRoute.GET(new NextRequest("http://127.0.0.1/x"), ctxOf("nope"))).status === 404);

// ---------------------------------------------------------------------------
// C. PATCH title
// ---------------------------------------------------------------------------
const patchRes = await idRoute.PATCH(
  new NextRequest("http://127.0.0.1/x", { method: "PATCH", body: JSON.stringify({ title: "renamed!" }), headers: { "content-type": "application/json" } }),
  ctxOf(c1.id),
);
check("PATCH renames", patchRes.status === 200 && (await patchRes.json()).conversation.title === "renamed!" && conv.getConversation(c1.id).title === "renamed!");
const patchBad = await idRoute.PATCH(
  new NextRequest("http://127.0.0.1/x", { method: "PATCH", body: JSON.stringify({}), headers: { "content-type": "application/json" } }),
  ctxOf(c1.id),
);
check("PATCH without title → 400", patchBad.status === 400);
check("PATCH unknown → 404", (await idRoute.PATCH(
  new NextRequest("http://127.0.0.1/x", { method: "PATCH", body: JSON.stringify({ title: "x" }), headers: { "content-type": "application/json" } }),
  ctxOf("nope"),
)).status === 404);

// ---------------------------------------------------------------------------
// D. DELETE = ARCHIVE (soft) — rows NEVER destroyed
// ---------------------------------------------------------------------------
const delRes = await idRoute.DELETE(new NextRequest("http://127.0.0.1/x", { method: "DELETE" }), ctxOf(c1.id));
const delJson = await delRes.json();
check("DELETE archives (archived:true, archivedAt set)", delRes.status === 200 && delJson.archived === true && typeof delJson.conversation.archivedAt === "string");
const convRow = getDb().prepare("SELECT * FROM jarvis_conversations WHERE id = ?").get(c1.id);
const msgCount = getDb().prepare("SELECT COUNT(*) AS n FROM jarvis_messages WHERE conversation_id = ?").get(c1.id).n;
check("row + messages still in the DB (no hard delete)", Boolean(convRow) && convRow.archived_at && msgCount === 2);
const list2 = await (await listRoute.GET(new NextRequest("http://127.0.0.1/api/v2/jarvis/conversations"))).json();
check("archived conversation drops out of the default list", !list2.conversations.some((c) => c.id === c1.id));
const list3 = await (await listRoute.GET(new NextRequest("http://127.0.0.1/api/v2/jarvis/conversations?includeArchived=1"))).json();
check("?includeArchived=1 still lists it", list3.conversations.some((c) => c.id === c1.id));
const archivedGet = await idRoute.GET(new NextRequest("http://127.0.0.1/x"), ctxOf(c1.id));
check("archived transcript still readable by id", archivedGet.status === 200);
const firstStamp = delJson.conversation.archivedAt;
await idRoute.DELETE(new NextRequest("http://127.0.0.1/x", { method: "DELETE" }), ctxOf(c1.id));
check("re-archive idempotent (stamp kept)", conv.getConversation(c1.id).archivedAt === firstStamp);

// ---------------------------------------------------------------------------
// E. Static drawer + route-file contract
// ---------------------------------------------------------------------------
const mustExist = [
  "src/app/api/v2/jarvis/conversations/route.ts",
  "src/app/api/v2/jarvis/conversations/[id]/route.ts",
  "src/app/api/v2/webmcp/approvals/route.ts",
  "src/app/api/v2/webmcp/approvals/[id]/route.ts",
];
for (const f of mustExist) {
  check(`route file exists: ${f}`, fs.existsSync(path.join(repoRoot, f)));
}
const overlay = fs.readFileSync(path.join(repoRoot, "src/components/v2/jarvis/ChatboxOverlay.tsx"), "utf8");
check("overlay fetches the conversations list route", overlay.includes('fetch("/api/v2/jarvis/conversations")'));
check("overlay fetches one conversation + archives via DELETE", overlay.includes("/api/v2/jarvis/conversations/${id}") && overlay.includes('method: "DELETE"'));
check("overlay has the history toggle + new-conversation control", overlay.includes("toggleHistory") && overlay.includes("newConversation") && overlay.includes("<History"));
check("overlay threads the opened conversation into the next ask", overlay.includes("conversationIdRef.current = id"));
check("overlay renders Human-Gate approval cards with Approve/Deny", overlay.includes('resolveApprovalCard(a.id, "approve")') && overlay.includes('resolveApprovalCard(a.id, "deny")') && overlay.includes("/api/v2/webmcp/approvals/"));
check("overlay parses the 'approval' stream event", overlay.includes('ev.type === "approval"'));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
