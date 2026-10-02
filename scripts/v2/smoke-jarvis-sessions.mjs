// S13 Sessions tab smoke (_design/jarvis-v3-plan.md), offline.
//   store: search by title AND message body, literal wildcards, scopes, restore,
//          counts; routes: ?q=&scope= contract, 400 on a bad scope, the original
//          C3.6 list contract unchanged, PATCH {archived:false} restores;
//   wiring: tab registered, resume in Console (?c=) and overlay (event) reach
//          the code that loads the conversation.
// Run: npx tsx scripts/v2/smoke-jarvis-sessions.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-jsess-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jsess-set-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_WEBMCP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jsess-sec-"));
process.env.AGENTIC_OS_AGENTMAIL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jsess-am-"));
process.env.AGENTIC_OS_NEWSLETTER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jsess-nl-"));
process.env.AGENTOS_MOCK_LLM = "1";

const conv = await import("../../src/lib/v2/jarvis/conversations.ts");
const { NextRequest } = await import("next/server");
const listRoute = await import("../../src/app/api/v2/jarvis/conversations/route.ts");
const idRoute = await import("../../src/app/api/v2/jarvis/conversations/[id]/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra !== undefined ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`);
  if (!cond) failures++;
};
const ctxOf = (id) => ({ params: Promise.resolve({ id }) });
const tick = () => new Promise((r) => setTimeout(r, 8));

// ── seed ───────────────────────────────────────────────────────────────────────
const a = conv.createConversation({ title: "Deal Desk triage", channel: "overlay" });
conv.appendJarvisMessage({ conversationId: a.id, role: "user", content: "open the JobNimbus listing and read me the notes" });
conv.appendJarvisMessage({ conversationId: a.id, role: "assistant", content: "The notes say the client wants a CRM sync by Friday." });
await tick();
const b = conv.createConversation({ title: "Budget: 50% off plan", channel: "page" });
conv.appendJarvisMessage({ conversationId: b.id, role: "user", content: "what is 5 to 0 in dollars" });
await tick();
const c = conv.createConversation({ title: "Old thread", channel: "page" });
conv.appendJarvisMessage({ conversationId: c.id, role: "user", content: "archived words live here" });
conv.archiveConversation(c.id);

// ── store ──────────────────────────────────────────────────────────────────────
const ids = (rows) => rows.map((r) => r.id);
check("empty query lists live sessions newest first", JSON.stringify(ids(conv.searchConversations(""))) === JSON.stringify([b.id, a.id]));
check("title match", ids(conv.searchConversations("deal desk")).join() === a.id);
const body = conv.searchConversations("crm sync");
check("message-body match finds the session", ids(body).join() === a.id, body);
check("body match carries a snippet around the hit", /CRM sync/i.test(body[0]?.snippet ?? ""), body[0]?.snippet);
check("title-only match has no snippet", conv.searchConversations("deal desk")[0]?.snippet === null);
check("'%' is literal, not a wildcard", ids(conv.searchConversations("%")).join() === b.id, ids(conv.searchConversations("%")));
check("'_' is literal, not a wildcard", conv.searchConversations("_").length === 0);
check("a backslash in the query does not break the SQL", Array.isArray(conv.searchConversations("C:" + String.fromCharCode(92) + "path")));
check("archived hidden from live scope", !ids(conv.searchConversations("archived words")).includes(c.id));
check("archived scope finds archived only", ids(conv.searchConversations("", { scope: "archived" })).join() === c.id);
check("all scope has all three", conv.searchConversations("", { scope: "all" }).length === 3);
check("lastMessageAt is the newest message time", typeof conv.searchConversations("deal")[0]?.lastMessageAt === "string");
const counts = conv.sessionCounts();
check("counts are measured: 2 live, 1 archived, 4 messages (2 + 1 + 1 seeded)", counts.live === 2 && counts.archived === 1 && counts.messages === 4, counts);
const restored = conv.restoreConversation(c.id);
check("restore clears the archive flag", restored && restored.archivedAt === null);
check("restore is idempotent", conv.restoreConversation(c.id)?.archivedAt === null);
check("restore of an unknown id is null", conv.restoreConversation("nope") === null);
conv.archiveConversation(c.id);

// ── routes ─────────────────────────────────────────────────────────────────────
const get = async (qs) => {
  const r = await listRoute.GET(new NextRequest(`http://x/api/v2/jarvis/conversations${qs}`));
  return { status: r.status, body: await r.json() };
};
let r = await get("");
check("legacy GET (no q/scope) keeps the C3.6 shape: conversations only", r.status === 200 && Array.isArray(r.body.conversations) && !("counts" in r.body) && r.body.conversations.length === 2);
r = await get("?scope=all&q=");
check("GET ?scope=all returns counts too", r.status === 200 && r.body.conversations.length === 3 && r.body.counts?.archived === 1);
r = await get("?q=jobnimbus");
check("GET ?q= searches message bodies", r.status === 200 && r.body.conversations.map((x) => x.id).join() === a.id);
r = await get("?scope=bogus");
check("GET with a bad scope is a 400 naming the choices", r.status === 400 && /live, archived, all/.test(r.body.error));
const patch = async (id, payload) => {
  const res = await idRoute.PATCH(new NextRequest(`http://x/api/v2/jarvis/conversations/${id}`, { method: "PATCH", body: JSON.stringify(payload) }), ctxOf(id));
  return { status: res.status, body: await res.json() };
};
let p = await patch(c.id, { archived: false });
check("PATCH {archived:false} restores", p.status === 200 && p.body.conversation.archivedAt === null);
p = await patch("missing", { archived: false });
check("PATCH restore of unknown id is 404", p.status === 404);
p = await patch(a.id, { title: "Renamed triage" });
check("PATCH {title} still renames", p.status === 200 && p.body.conversation.title === "Renamed triage");
p = await patch(a.id, {});
check("PATCH with neither is a 400 that names both shapes", p.status === 400 && /archived: false/.test(p.body.error));

// ── wiring (source) ────────────────────────────────────────────────────────────
const read = (f) => fs.readFileSync(f, "utf8");
const hub = read("src/components/jarvis/JarvisHub.tsx");
const view = read("src/components/JarvisView.tsx");
const host = read("src/components/v2/jarvis/JarvisOmnipresence.tsx");
const overlay = read("src/components/v2/jarvis/ChatboxOverlay.tsx");
const tab = read("src/components/jarvis/SessionsTab.tsx");
check("Sessions tab registered in the hub", /key: "sessions"[^\n]*<SessionsTab \/>/.test(hub));
check("hub maps a URL without ?tab= to the Console", hub.includes('const want: JarvisTab = isTab(fromUrl) ? fromUrl : "console"'));
check("Console resumes from ?c= and binds the conversation id", view.includes('get("c")') && view.includes("v2ConversationRef.current = id;"));
check("Resume in Console links to /jarvis?c=", tab.includes("consoleResumeHref(selected.id)") && read("src/lib/v2/jarvis/resume.ts").includes("/jarvis?c="));
check("Resume in overlay dispatches the event the host listens for", tab.includes("resumeInOverlay(selected.id)") && host.includes("window.addEventListener(RESUME_EVENT, onResume)"));
check("host opens the overlay and hands it the id", host.includes("setResumeId(id); setOpen(true);") && host.includes("resumeId={resumeId}"));
check("overlay opens the named conversation, then clears it", overlay.includes("void openConversation(resumeId).finally(() => onResumed?.());"));
check("archived sessions cannot be resumed until restored", tab.includes("disabled={busy || !!selected.archivedAt}"));
check("tab shows measured counts only (no invented numbers)", tab.includes("counts?.live") && !/Math\.random/.test(tab));

console.log(failures ? `smoke-jarvis-sessions: ${failures} FAILURES` : "smoke-jarvis-sessions: all checks passed");
process.exit(failures ? 1 : 0);
