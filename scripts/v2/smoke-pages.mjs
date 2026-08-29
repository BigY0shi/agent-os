// SPEC-B B5/B6 smoke: scratchpad pages — daily find-or-create, rev CAS 409,
// [ ] task binding (create/attrs/link, checkbox sync, title sync, removal
// cleanup), removeTaskItemFromPages node strip (incl. the dispatch buffer-GC
// branch), @jarvis mention debounce → comment + attention.flag + processed-once,
// nightly scratchpad.ingest, comments CRUD routes.
// Run: npx tsx scripts/v2/smoke-pages.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ---- env BEFORE imports (temp DB + temp settings + mock LLM) ----
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-pages-${stamp}.db`);
const tmpSettings = path.join(os.tmpdir(), `agentos-smoke-pages-settings-${stamp}.json`);
process.env.AGENTIC_OS_DB = tmpDb;
process.env.AGENTIC_OS_SETTINGS = tmpSettings;
process.env.AGENTOS_MOCK_LLM = "1";

fs.writeFileSync(
  tmpSettings,
  JSON.stringify({
    tasks: {
      timezone: "America/Chicago",
      // Long buffer: bound Ready tasks must NOT auto-run mid-smoke; the GC leg
      // forces its wake due by hand.
      editingBufferSec: 600,
      planApproval: "always",
      emptyTaskGc: true,
      seeds: {}, // all seeds default-disabled
    },
    scratchpad: { mentionDebounceSec: 0.2 },
    memory: { ingestEnabled: false }, // rows land PENDING and stay — countable
  }),
  "utf8",
);

const { NextRequest } = await import("next/server");
const { getDb } = await import("../../src/lib/v2/db.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const store = await import("../../src/lib/v2/pages/store.ts");
const butler = await import("../../src/lib/v2/pages/butler.ts");
const tasksStore = await import("../../src/lib/v2/tasks/store.ts");
const { ensureV2 } = await import("../../src/lib/v2/boot.ts");

const pagesRoute = await import("../../src/app/api/v2/pages/route.ts");
const pageRoute = await import("../../src/app/api/v2/pages/[id]/route.ts");
const commentsRoute = await import("../../src/app/api/v2/pages/[id]/comments/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) {
  const until = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > until) return false;
    await sleep(100);
  }
}

const req = (url, init) => new NextRequest(new Request(`http://smoke.local${url}`, init));
const jsonInit = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const ctx = (id) => ({ params: Promise.resolve({ id }) });

// Doc builders (TipTap JSON).
const p = (text, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: text ? [{ type: "text", text }] : [] });
const taskItem = (text, attrs = {}) => ({ type: "taskItem", attrs: { checked: false, ...attrs }, content: [p(text)] });
const taskList = (...items) => ({ type: "taskList", content: items });
const doc = (...content) => ({ type: "doc", content });

ensureV2();
const db = getDb();

const scratchQueueRows = () =>
  db.prepare("SELECT COUNT(*) c FROM ingestion_queue WHERE source = 'scratchpad'").get().c;

console.log("=== DAILY PAGE (find-or-create, per-date key) ===");
let res = await pagesRoute.GET(req("/api/v2/pages?date=2026-08-25"));
let j = await res.json();
check("daily: created for explicit date", res.status === 200 && j.page?.date === "2026-08-25" && j.page.rev === 0, j);
const pageA = j.page;
res = await pagesRoute.GET(req("/api/v2/pages?date=2026-08-25"));
j = await res.json();
check("daily: same date → same page id", j.page?.id === pageA.id);
res = await pagesRoute.GET(req("/api/v2/pages"));
j = await res.json();
check("daily: default = today in settings tz", res.status === 200 && j.page?.date === store.localDateStr(), j.page?.date);
const pageToday = j.page;
check("daily: two dates → two pages", pageToday.id !== pageA.id);
res = await pagesRoute.GET(req("/api/v2/pages?date=bogus"));
check("daily: bad date → 400", res.status === 400);
res = await pagesRoute.GET(req("/api/v2/pages?list=1"));
j = await res.json();
check("list: summaries without doc bodies", Array.isArray(j.pages) && j.pages.length >= 2 && j.pages.every((x) => !("doc" in x)), j.pages?.length);

console.log("=== REV CAS (409 on stale save) ===");
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world")), rev: 0 })), ctx(pageA.id));
j = await res.json();
check("save: rev 0 → 200 rev 1", res.status === 200 && j.rev === 1 && j.docChanged === false, j);
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("stale write")), rev: 0 })), ctx(pageA.id));
j = await res.json();
check("save: stale rev → 409 + current doc/rev", res.status === 409 && j.current?.rev === 1 && JSON.stringify(j.current.docJson).includes("hello world"), j);
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: "nope", rev: 1 })), ctx(pageA.id));
check("save: non-object docJson → 400", res.status === 400);
res = await pageRoute.GET(req(`/api/v2/pages/${pageA.id}`), ctx(pageA.id));
j = await res.json();
check("get: page round-trips content", res.status === 200 && JSON.stringify(j.page.doc).includes("hello world"));

console.log("=== [ ] TASK BINDING ===");
let rev = 1;
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world"), taskList(taskItem("buy milk"))), rev })), ctx(pageA.id));
j = await res.json();
check("bind: response reports one bound task + docChanged", res.status === 200 && j.bound?.length === 1 && j.docChanged === true, j);
const boundId = j.bound?.[0]?.taskId;
const boundDisplay = j.bound?.[0]?.displayId;
check("bind: displayId is tk-N", /^tk-\d+$/.test(boundDisplay ?? ""), boundDisplay);
const itemAttrs = j.docJson?.content?.find((n) => n.type === "taskList")?.content?.[0]?.attrs;
check("bind: attrs written back into the returned doc", itemAttrs?.taskUuid === boundId && itemAttrs?.displayId === boundDisplay, itemAttrs);
let bt = tasksStore.getTask(boundId);
check("bind: task source 'daily' + status 'Ready'", bt?.source === "daily" && bt?.status === "Ready", { source: bt?.source, status: bt?.status });
check("bind: task title from node text", bt?.title === "buy milk", bt?.title);
check("bind: v2_page_task_links row", store.listPageTaskIds(pageA.id).includes(boundId));
rev = j.rev;

// Checkbox → Done, uncheck → reopen.
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world"), taskList(taskItem("buy milk", { checked: true, taskUuid: boundId, displayId: boundDisplay }))), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
bt = tasksStore.getTask(boundId);
check("checkbox: checked → task Done", bt?.status === "Done", bt?.status);
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world"), taskList(taskItem("buy milk", { checked: false, taskUuid: boundId, displayId: boundDisplay }))), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
bt = tasksStore.getTask(boundId);
check("checkbox: unchecked → task reopened", bt?.status === "Todo", bt?.status);

// Title sync.
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world"), taskList(taskItem("buy oat milk", { checked: false, taskUuid: boundId, displayId: boundDisplay }))), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
check("title sync: node text edit PATCHes the task", tasksStore.getTask(boundId)?.title === "buy oat milk", tasksStore.getTask(boundId)?.title);

// Node removal → empty (title-only) daily task exiled.
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world")), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
check("removal: title-only daily task exiled", tasksStore.getTask(boundId) === null);
check("removal: link row gone", !store.listPageTaskIds(pageA.id).includes(boundId));

// Contentful task survives removal (kept + unlinked).
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world"), taskList(taskItem("write the report"))), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
const richId = j.bound?.[0]?.taskId;
tasksStore.updateTask(richId, { descriptionMd: "important context the user typed in /tasks" }, "user");
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world")), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
check("removal: contentful task KEPT", tasksStore.getTask(richId) !== null);
check("removal: contentful task unlinked", !store.listPageTaskIds(pageA.id).includes(richId));

console.log("=== removeTaskItemFromPages (node strip) ===");
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world"), taskList(taskItem("strip me"))), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
const stripId = j.bound?.[0]?.taskId;
const touched = store.removeTaskItemFromPages(stripId);
let pg = store.getPage(pageA.id);
check("strip: one page touched", touched === 1, touched);
check("strip: node gone from doc (empty taskList pruned)", !JSON.stringify(pg.doc).includes(stripId) && !JSON.stringify(pg.doc).includes("taskList"), JSON.stringify(pg.doc).slice(0, 200));
check("strip: rev bumped (client's next save 409s → refetch)", pg.rev === rev + 1, { rev, now: pg.rev });
check("strip: link removed", !store.listPageTaskIds(pageA.id).includes(stripId));
rev = pg.rev;

// Dispatch buffer-GC branch: empty 'Untitled task' from the page → exiled AND node-stripped.
const gcTask = tasksStore.createTask({ title: "Untitled task", source: "daily", status: "Ready", actor: "user" });
pg = store.getPage(pageA.id);
pg.doc.content.push(taskList(taskItem("Untitled task", { taskUuid: gcTask.id, displayId: gcTask.displayId })));
store.savePageDocInternal(pageA.id, pg.doc);
store.linkTaskToPage(pageA.id, gcTask.id);
const past = new Date(Date.now() - 2000).toISOString();
db.prepare("UPDATE v2_tasks SET run_at = ? WHERE id = ?").run(past, gcTask.id);
db.prepare("UPDATE jobs SET run_at = ?, payload = json_set(payload, '$.expectedRunAt', ?) WHERE id = ?").run(past, past, `task:${gcTask.id}`);
await sched.tickOnce();
await waitFor(() => tasksStore.getTask(gcTask.id) === null);
pg = store.getPage(pageA.id);
check("buffer-GC: empty daily task exiled", tasksStore.getTask(gcTask.id) === null);
check("buffer-GC: node stripped from the page (dispatch TODO filled)", !JSON.stringify(pg.doc).includes(gcTask.id));
rev = pg.rev;

console.log("=== @jarvis MENTIONS (debounce → comment + flag, processed-once) ===");
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: doc(p("hello world"), p("@jarvis what should I focus on today?")), rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
check("mention: queued once + nodeId assigned", j.mentionsQueued === 1 && j.docChanged === true, j);
const mentionPara = j.docJson.content.find((n) => JSON.stringify(n).includes("@jarvis"));
const nodeId = mentionPara?.attrs?.nodeId;
check("mention: paragraph carries nodeId attr", typeof nodeId === "string" && nodeId.length > 0, mentionPara?.attrs);

await waitFor(() => store.listPageComments(pageA.id).length >= 1, 8000);
let comments = store.listPageComments(pageA.id);
check("mention: comment row created", comments.length === 1, comments.length);
check("mention: author jarvis + mock reply body", comments[0]?.author === "jarvis" && comments[0]?.bodyMd.startsWith("Mock Jarvis reply"), comments[0]?.bodyMd);
check("mention: anchored to the paragraph nodeId", comments[0]?.anchorNodeId === nodeId);
check("mention: conversation created (source daily)", !!comments[0]?.conversationId && db.prepare("SELECT source FROM v2_conversations WHERE id = ?").get(comments[0].conversationId)?.source === "daily");
const flagRow = db.prepare("SELECT payload FROM events WHERE type = 'attention.flag' AND payload LIKE '%pagecomment-%' ORDER BY id DESC LIMIT 1").get();
const flag = flagRow ? JSON.parse(flagRow.payload) : null;
check("mention: attention.flag {kind scratchpad.reply, route /today, dedupeKey pagecomment-<id>}", flag?.kind === "scratchpad.reply" && flag?.severity === "info" && flag?.route === "/today" && flag?.dedupeKey === `pagecomment-${comments[0].id}`, flag);
pg = store.getPage(pageA.id);
const handledAttr = pg.doc.content.find((n) => JSON.stringify(n).includes("@jarvis"))?.attrs?.mentionHandled;
check("mention: mentionHandled hash stamped on the node", typeof handledAttr === "string" && handledAttr.length > 0, handledAttr);
await waitFor(() => scratchQueueRows() === 1, 4000);
check("mention: exchange queued for memory ingest (source scratchpad)", scratchQueueRows() === 1, scratchQueueRows());
rev = pg.rev;

// Processed-once: same text (server doc echoed back) does NOT re-trigger.
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: pg.doc, rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
check("processed-once: same text → no re-queue", j.mentionsQueued === 0, j.mentionsQueued);
await sleep(700);
check("processed-once: still exactly one comment", store.listPageComments(pageA.id).length === 1, store.listPageComments(pageA.id).length);

// Edited text re-triggers (hash changes).
pg = store.getPage(pageA.id);
const paraIdx = pg.doc.content.findIndex((n) => JSON.stringify(n).includes("@jarvis"));
pg.doc.content[paraIdx] = { ...pg.doc.content[paraIdx], content: [{ type: "text", text: "@jarvis and what about tomorrow?" }] };
res = await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: pg.doc, rev })), ctx(pageA.id));
j = await res.json();
rev = j.rev;
check("re-trigger: edited text queues again", j.mentionsQueued === 1, j);
await waitFor(() => store.listPageComments(pageA.id).length >= 2, 8000);
comments = store.listPageComments(pageA.id);
check("re-trigger: second comment lands", comments.length === 2, comments.length);
await waitFor(() => scratchQueueRows() === 2, 4000);
check("re-trigger: second exchange also queued for ingest", scratchQueueRows() === 2, scratchQueueRows());
rev = store.getPage(pageA.id).rev;

console.log("=== NIGHTLY scratchpad.ingest (B6) ===");
check("ingest: nightly job registered (FREQ=DAILY)", (db.prepare("SELECT rrule FROM jobs WHERE id = 'scratchpad:ingest'").get()?.rrule ?? "").startsWith("FREQ=DAILY"), db.prepare("SELECT rrule FROM jobs WHERE id = 'scratchpad:ingest'").get());
let ing = await butler.ingestScratchpadDay("2026-08-25");
check("ingest: non-empty changed page ingests", ing.ingested === true, ing);
check("ingest: queue row added", scratchQueueRows() === 3, scratchQueueRows());
ing = await butler.ingestScratchpadDay("2026-08-25");
check("ingest: unchanged page skips", ing.ingested === false && ing.reason.includes("unchanged"), ing);
check("ingest: no extra queue row on skip", scratchQueueRows() === 3, scratchQueueRows());
pg = store.getPage(pageA.id);
pg.doc.content.push(p("an evening addendum"));
await pageRoute.PUT(req(`/api/v2/pages/${pageA.id}`, jsonInit("PUT", { docJson: pg.doc, rev })), ctx(pageA.id));
ing = await butler.ingestScratchpadDay("2026-08-25");
check("ingest: changed content re-ingests", ing.ingested === true, ing);
ing = await butler.ingestScratchpadDay(store.localDateStr());
check("ingest: empty page skips", ing.ingested === false && ing.reason.includes("empty"), ing);
const inlineOk = await sched.runInline("scratchpad.ingest", {});
check("ingest: handler registered for the scheduler (runInline ok)", inlineOk === true);

console.log("=== COMMENTS CRUD (routes) ===");
res = await commentsRoute.GET(req(`/api/v2/pages/${pageA.id}/comments`), ctx(pageA.id));
j = await res.json();
check("comments: GET lists jarvis comments", res.status === 200 && j.comments?.length === 2, j.comments?.length);
res = await commentsRoute.POST(req(`/api/v2/pages/${pageA.id}/comments`, jsonInit("POST", { bodyMd: "a user note", anchorNodeId: nodeId })), ctx(pageA.id));
j = await res.json();
check("comments: POST creates user comment", res.status === 201 && j.comment?.author === "user" && j.comment?.bodyMd === "a user note", j);
const userCommentId = j.comment?.id;
res = await commentsRoute.PATCH(req(`/api/v2/pages/${pageA.id}/comments`, jsonInit("PATCH", { commentId: userCommentId, resolved: true })), ctx(pageA.id));
j = await res.json();
check("comments: PATCH resolves", res.status === 200 && typeof j.comment?.resolvedAt === "string", j);
res = await commentsRoute.PATCH(req(`/api/v2/pages/${pageA.id}/comments`, jsonInit("PATCH", { commentId: userCommentId, resolved: false })), ctx(pageA.id));
j = await res.json();
check("comments: PATCH un-resolves", res.status === 200 && j.comment?.resolvedAt === null, j);
res = await commentsRoute.PATCH(req(`/api/v2/pages/${pageA.id}/comments`, jsonInit("PATCH", { commentId: "nope", resolved: true })), ctx(pageA.id));
check("comments: unknown comment → 404", res.status === 404);
res = await commentsRoute.POST(req(`/api/v2/pages/${pageA.id}/comments`, jsonInit("POST", {})), ctx(pageA.id));
check("comments: missing bodyMd → 400", res.status === 400);

// ---------------------------------------------------------------------------
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
