# SPEC-B — Tasks + Scratchpad (Workstream B: B1–B6)

Status: IMPLEMENTATION-READY (written 2026-08-27, Ultraplan pass).
Inputs: `_design/agentos-v2/MASTER-PLAN.md` §2.B, `_design/agentos-v2/DOCS-CHEATSHEET.md` §4/§5/§10, read-only reference repo `..\AgentOSCore`.
Depends on: F1 (`src/lib/v2/db.ts`), F2 (`src/lib/v2/scheduler.ts` + `src/lib/v2/events.ts`), and consumes A2 (`src/lib/v2/memory/ingest.ts`) behind a stub interface so B can land before A is finished.

---

## 1. Scope & goals

| ID | Item | This spec delivers |
|---|---|---|
| B1 | Task model | SQLite task model: title, status, scheduledDate, RRULE recurrence, spec (user words, in the task page), plan (agent-drafted `<plan>` zone, approval-gated), subtasks (2-level, `tk-N.M` display ids), sessions[] linkage, activity log (event rows), dedicated chat thread (conversations scoped to taskId). |
| B2 | Execution engine | Claim → gather context → draft plan → await approval (configurable auto-approve per category) → execute via capability layer / agent runtime → deliver + ingest. Blocker escalation = Waiting + one tight question to the chat thread + `attention.flag` event to Homepage. Actor-gated state machine ported from upstream (`task.phase.ts`). |
| B3 | Recurring tasks | RRULE scheduler integration (F2 contract), NL→schedule extraction, seeds adapted from upstream `tasks.json` + `morning-brief.ts`: Morning Brief, End-of-Day Wrap-up, Sunday Planning, Weekly Retro scaffold — all idempotency-guarded, append-only scratchpad writes. |
| B4 | Tasks page layout | `/tasks`: (1) task list + compact month calendar; (2) large drag-drop Kanban; (3) Agents section with compact cards and the shared color status-band component (green running / blue idle / amber waiting-on-me / red error / gray offline). |
| B5 | Scratchpad | `/today` daily page: TipTap block editor, single-client autosave (**Yjs/hocuspocus DEFERRED — assessment in §1.1**), `[ ]` → real task binding with display-id badge, `@jarvis` paragraph mentions → inline comment reply with processed-once tracking. |
| B6 | Memory ingestion | Every task chat exchange, run result, and scratchpad mention exchange ingested into Memory V2 with a `task` label + `tk-N` label, through a stub-safe interface. |

Non-goals: coding/browser session *implementations* (F3/E own those; B stores linkage rows and mounts lookup tools), widgets panel in scratchpad (H2), channels delivery (later).

### 1.1 Decision: Yjs / hocuspocus — DEFER (pattern-only port)

Upstream runs a Hocuspocus websocket collab server + Yjs binary page state + IndexedDB persistence + Yjs relative-position comment anchors. For a single-user, single-machine app this buys nothing we need now and costs: a second server process (or custom Next WS route — awkward in Next 16), binary state in SQLite, and NodeView/cursor-destruction traps that upstream spent multiple fixes on.

**We start with:** TipTap JSON stored per page, debounced client autosave (800 ms) with an optimistic `rev` counter (server rejects stale writes with 409 → client refetch-merge), and server-side mutation through the same JSON tree helpers. Comment anchoring = `conversationId`/`resolved` **attrs directly on the paragraph node in stored JSON** + normalized-text fallback (upstream's `comment-tools.ts` already implements the fallback — port it). The one real Yjs casualty, concurrent-edit-safe anchors, doesn't apply with one writer.

**Revisit trigger:** the moment multi-device simultaneous editing is wanted, add Yjs behind `pageStore` without changing the API surface (the store's `getPageJson`/`savePageJson` contract is the seam). Recorded as an explicit follow-up, not built now.

---

## 2. Data model — SQLite DDL

Owned by `src/lib/v2/db.ts` migrations (F1). B contributes migration `002_tasks_scratchpad`. All ids are `uuid` TEXT (crypto.randomUUID). Timestamps are ISO-8601 UTC TEXT. JSON columns are TEXT with `json_valid` checks where cheap.

> F1 correction carried forward: `better-sqlite3` is **not currently in package.json** (current kanbanDb uses built-in `node:sqlite`). This DDL is driver-agnostic; B calls whatever `db.ts` exports (`db.prepare/transaction`). The synchronous-transaction requirement below (display-id assignment) is satisfied by both drivers.

```sql
-- workspace-level counters (single-row table; single-user app)
CREATE TABLE IF NOT EXISTS v2_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed: INSERT OR IGNORE INTO v2_meta(key,value) VALUES ('task_root_counter','0'), ('timezone','UTC');

CREATE TABLE IF NOT EXISTS v2_tasks (
  id TEXT PRIMARY KEY,
  display_id TEXT NOT NULL UNIQUE,          -- 'tk-1', 'tk-1.3', 'tk-1.3.2'
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Todo'
    CHECK (status IN ('Todo','Waiting','Ready','Working','Review','Done')),
  source TEXT NOT NULL DEFAULT 'manual',    -- manual | daily | agent | automation | seed
  category TEXT,                            -- B2 auto-approve granularity (nullable)
  assigned_agent_id TEXT,                   -- agents-module id; NULL = generalist
  parent_task_id TEXT REFERENCES v2_tasks(id) ON DELETE CASCADE,
  child_count INTEGER NOT NULL DEFAULT 0,
  page_id TEXT UNIQUE,                      -- task body doc (v2_pages)
  result TEXT,
  error TEXT,
  job_id TEXT,                              -- current scheduler job (F2)
  -- scheduling block (RRULE stored in USER-LOCAL tz; next_run_at UTC)
  schedule TEXT,
  next_run_at TEXT,
  last_run_at TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  max_occurrences INTEGER,                  -- 1 = one-shot scheduled; NULL = unlimited
  is_active INTEGER NOT NULL DEFAULT 1,
  start_date TEXT,
  end_date TEXT,
  scheduled_date TEXT,                      -- B4 calendar/date-settable list (no auto-fire)
  metadata TEXT NOT NULL DEFAULT '{}',      -- scheduleText, rescheduleCount, kind, seedKey...
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_tasks_status ON v2_tasks(status);
CREATE INDEX IF NOT EXISTS idx_v2_tasks_next_run ON v2_tasks(next_run_at) WHERE next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_tasks_parent ON v2_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_v2_tasks_sched_date ON v2_tasks(scheduled_date);

-- FTS over title + page text (replaces upstream Fuse.js)
CREATE VIRTUAL TABLE IF NOT EXISTS v2_tasks_fts USING fts5(
  task_id UNINDEXED, title, body, tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS v2_pages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('daily','task')),
  date TEXT,                                -- daily only: 'YYYY-MM-DD' key in USER tz
  content_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
  rev INTEGER NOT NULL DEFAULT 0,           -- optimistic concurrency (B5, no-Yjs design)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, date)
);

-- outlinks: which pages reference which taskItem nodes (replaces Page.outlinks JSONB)
CREATE TABLE IF NOT EXISTS v2_page_task_links (
  page_id TEXT NOT NULL REFERENCES v2_pages(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES v2_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, task_id)
);

-- chat threads (task-scoped conversations; recurring = one per run, one-shot = shared)
CREATE TABLE IF NOT EXISTS v2_conversations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,                     -- 'task' | 'scheduled-task' | 'daily' | 'chat'
  task_id TEXT REFERENCES v2_tasks(id) ON DELETE CASCADE,
  agent_id TEXT,
  run_no INTEGER,                           -- occurrence number for recurring runs; NULL for shared
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_conv_task ON v2_conversations(task_id);

CREATE TABLE IF NOT EXISTS v2_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  user_type TEXT NOT NULL DEFAULT 'human' CHECK (user_type IN ('human','system')),
  ephemeral INTEGER NOT NULL DEFAULT 0,     -- skipUserMessage triggers: kept for audit, hidden in UI
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_msgs_conv ON v2_messages(conversation_id, created_at);

-- task activity log (also mirrored to F2 event bus)
CREATE TABLE IF NOT EXISTS v2_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES v2_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                       -- status_change|plan_drafted|plan_approved|run_started|run_ok|run_fail|rescheduled|comment|...
  actor TEXT NOT NULL,                      -- 'user' | 'agent' | 'system'
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_task_events ON v2_task_events(task_id, id);

-- session linkage (F3/E own the sessions themselves)
CREATE TABLE IF NOT EXISTS v2_task_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES v2_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('coding','browser','exec','pty')),
  external_id TEXT,                         -- NULL until the slot echoes = status 'starting'
  agent TEXT, dir TEXT, prompt TEXT,
  status TEXT NOT NULL DEFAULT 'starting',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- @jarvis paragraph comments (ButlerComment equivalent, block-attr anchored)
CREATE TABLE IF NOT EXISTS v2_page_comments (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES v2_pages(id) ON DELETE CASCADE,
  selected_text TEXT NOT NULL,              -- normalized paragraph text at detection time (dedupe key)
  content TEXT NOT NULL DEFAULT '',         -- first agent reply (thread lives in the conversation)
  conversation_id TEXT REFERENCES v2_conversations(id),
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_comments_page ON v2_page_comments(page_id);

-- B6 fallback when Memory V2 (A) isn't live yet: durable ingest outbox
CREATE TABLE IF NOT EXISTS v2_ingest_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,                    -- {episodeBody, source, labels[], sessionId, referenceTime}
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  created_at TEXT NOT NULL
);
```

Display-id assignment (upstream Postgres trigger → synchronous transaction in `tasksStore.createTask`):
root → `task_root_counter+1` in `v2_meta` → `tk-N`; child → parent `child_count+1` → `parent.display_id + '.' + n`. Depth cap 2 enforced by counting dots in the parent's display_id (throw on `tk-a.b.c` parent). Reparent = delete+recreate (cascades subtasks — surface a confirm dialog, upstream gotcha).

---

## 3. Module layout

```
src/lib/v2/tasks/
  types.ts            client-safe types + status/actor enums + STATUS_BAND colors (no node imports — agentsTypes.ts convention)
  phase.ts            canTransition(from, to, actor) — verbatim port
  store.ts            CRUD, displayId txn, resolveTaskId (uuid|tk-*), FTS sync, search
  lifecycle.ts        changeTaskStatus, markTaskInProcess/Completed/Failed, scheduleNextTaskOccurrence, parent auto-Done
  dispatch.ts         wake-up dispatcher: staleness guard, buffer-expiry GC, fire-override, normal fire, stuck recovery
  runner.ts           execution engine: agent resolution, conversation policy, plan/approval flow, 30-min timeout
  zones.ts            mergeStructuredSections + upsertPageSection + clearPageSection (<plan>/<outcome>/<log>)
  scheduleUtils.ts    computeNextRun (tz-safe RRULE), formatScheduleForUser, getRecurrenceIntervalMinutes — verbatim port (deps: rrule, luxon)
  recurrence.ts       extractScheduleFromText (provider-routed LLM) + applyScheduleToTask + detectAndApplyRecurrence
  prompts.ts          <waiting_tasks>/<task_execution>/<task_context>/<trigger_context>/<scratchpad_context> blocks (butler→Jarvis rename)
  tools.ts            agent tool surface (create/get/list/update/unblock/delete_task, get_task_tree, reschedule_self, get/update_scratchpad, session lookups)
  seeds.ts            B3 seed definitions + ensureSeeds() (idempotent by metadata.seedKey)
  ingest.ts           B6: taskIngest(payload) → memory A2 if present, else v2_ingest_outbox + drain job
src/lib/v2/pages/
  store.ts            findOrCreateDailyPage, findOrCreateTaskPage, getPageJson/savePageJson (rev check), JSON↔HTML via @tiptap/html
  treeUtils.ts        pure JSON-tree walkers: collectTaskIds, updateTaskTitleInDoc, removeTaskItemFromDoc, findParagraphByText, tagParagraph
  outlinks.ts         sync v2_page_task_links on save; cross-page title propagation (skip sourcePageId)
  comments.ts         create/resolve jarvis comments; buildAnnotatedPageXml port
  mentionScan.ts      scan saved JSON for @jarvis mention nodes minus processed comments → debounced scheduler job

src/app/api/v2/tasks/route.ts                  GET(list/search) POST(create)
src/app/api/v2/tasks/[id]/route.ts             GET PATCH  (delete = exile: status Done + metadata.exiled, never row-delete except empty-daily GC)
src/app/api/v2/tasks/[id]/status/route.ts      POST {status, actor:'user'}
src/app/api/v2/tasks/[id]/approve/route.ts     POST — plan approval (unblock_task semantics)
src/app/api/v2/tasks/[id]/chat/route.ts        GET(messages) POST(user message → checkWaitingTaskReply → optional run)
src/app/api/v2/tasks/[id]/runs/route.ts        GET — per-run conversations (recurring)
src/app/api/v2/tasks/board/route.ts            GET — kanban snapshot + agents section payload (one poll)
src/app/api/v2/pages/route.ts                  GET ?date= (find-or-create daily)  |  GET ?taskId=
src/app/api/v2/pages/[id]/route.ts             GET PATCH {content_json, rev} → 409 on stale
src/app/api/v2/pages/[id]/comments/route.ts    GET POST
src/app/api/v2/comments/[id]/route.ts          PATCH {resolved} | POST reply (appends to comment conversation, runs Jarvis turn)

src/app/tasks/page.tsx                         B4 page (client shell)
src/app/today/page.tsx                         B5 scratchpad page

src/components/v2/tasks/
  TasksView.tsx        page composition
  TaskListPanel.tsx    one-time + repeating lists, date-settable rows
  MiniCalendar.tsx     compact month grid (dots per day from scheduled_date/next_run_at)
  TaskBoard.tsx        drag-drop kanban (HTML5 DnD, greenfield — see §6)
  TaskCard.tsx
  AgentsSection.tsx    compact agent cards + current/upcoming tasks
  StatusBand.tsx       SHARED status-band component (also consumed by F6)
  TaskDetail.tsx       drawer/route: title, properties bar, TipTap body (plan/outcome/log nodes), subtasks, chat panel
  TaskChatPanel.tsx    one-shot: single thread; recurring: runs list
  TasksSettings.tsx    ConfigMenu children (rule 16 — see §6 settings list)
src/components/v2/scratchpad/
  DailyScroller.tsx    bidirectional day scroller (initial today+3, today-anchored)
  DayEditor.tsx        TipTap instance per day
  extensions/
    scratchpadTaskItem.ts(x)   [ ]→task binding NodeView (port)
    checklistInputRule.ts      '^\[\] ' input rule (port)
    conversationParagraph.ts   paragraph w/ conversationId/resolved attrs → highlight
    jarvisMention.ts           @jarvis mention node (@tiptap/extension-mention config)
    planNode.ts / outcomeNode.ts / logNode.ts   collapsible zone boxes (port)
  CommentPopover.tsx   anchored thread UI (reply → POST /comments/[id])
  SelectionBubble.tsx  'Create task' / 'Convert list to tasks' (port, phase 2)

scripts/v2/
  smoke-b1-model.mjs  smoke-b2-engine.mjs  smoke-b3-recurring.mjs  smoke-b5-scratchpad.mjs
```

New deps: `rrule`, `luxon`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/html` (server-side JSON↔HTML). All pure-JS (no native builds).

Sidebar: add `/tasks` and `/today` to `NAV` **and** to the correct section Set in `src/components/Sidebar.tsx` (documented gotcha: membership is decided by the Sets, not NAV order — otherwise they land in "Self").

---

## 4. Port map (AgentOSCore → agent-os)

| Reference (apps/webapp/app/…) | Ours | Strategy |
|---|---|---|
| `services/task.phase.ts` | `src/lib/v2/tasks/phase.ts` | **verbatim-adapt** (pure TS; agents may only set Waiting/Review) |
| `services/task.server.ts` (CRUD, changeTaskStatus, updateScheduledTask, resolveTaskId) | `tasks/store.ts` + `tasks/lifecycle.ts` | **pattern-only** (Prisma→SQLite DAO; keep the exact control flow incl. only-touch-queue-when-schedule-changed) |
| `packages/database/.../sequential_task_displayid/migration.sql` | `tasks/store.ts` createTask txn | **reimplement** (PG trigger → synchronous SQLite transaction) |
| `jobs/task/scheduled-task.logic.ts` | `tasks/dispatch.ts` | **verbatim-adapt** control flow (staleness guard / buffer-expiry / fire-override / normal fire / stuck recovery) |
| `jobs/task/task.logic.ts` | `tasks/runner.ts` | **pattern-only** (Mastra loop → our provider-routed runtime; keep conversation policy + ephemeral trigger message + 30-min abort) |
| `services/coding-task.server.ts` (mergeStructuredSections, upsertPageSection, checkWaitingTaskReply) | `tasks/zones.ts` + chat route | **verbatim-adapt** (pure JSON merge; swap page IO) |
| `services/agent/tools/task-tools.ts` | `tasks/tools.ts` | **verbatim-adapt** (descriptions + zod schemas + background guards; prisma→DAO) |
| `services/agent/context.ts:590-773` prompt blocks | `tasks/prompts.ts` | **verbatim-adapt** (butler→Jarvis; gateway tool names→our slot names) |
| `utils/schedule-utils.ts` | `tasks/scheduleUtils.ts` | **verbatim** (pure rrule+luxon; keep no-BYHOUR = relative-interval semantics) |
| `services/tasks/recurrence.server.ts` + `services/agent/prompts/recurrence.ts` | `tasks/recurrence.ts` | **verbatim-adapt** (LLM call → `cliComplete`/provider picker) |
| `lib/queue-adapter.server.ts` contract | F2 `src/lib/v2/scheduler.ts` | **reimplement** — B consumes the F2 contract below, keeping upstream function names |
| `services/task-scheduler.ts` (startup recovery) | F2 rehydrate + `tasks/dispatch.ts` | **verbatim-adapt** (missed fires run at max(nextRunAt, now)) |
| `services/morning-brief.ts` | `tasks/seeds.ts` | **verbatim-adapt** (description text is the deliverable; Gmail steps conditional on G wave-1) |
| upstream `tasks.json` patterns (docs) | `tasks/seeds.ts` | **pattern-only** (EOD wrap-up, Sunday planning, weekly retro scaffold) |
| `components/editor/extensions/scratchpad-task-item.tsx` + `checklist-input-rule.ts` | `scratchpad/extensions/*` | **verbatim-adapt** (Remix `useNavigate`→`next/navigation`; API paths) |
| `components/editor/extensions/plan-extension.tsx` (+outcome/log) | `scratchpad/extensions/*Node.ts` | **verbatim** (TipTap is framework-agnostic) |
| `components/editor/page-editor.client.tsx` | `DayEditor.tsx` | **pattern-only** (drop Yjs/Hocuspocus/IndexedDB; keep extension assembly) |
| `components/daily/daily-page.client.tsx` | `DailyScroller.tsx` | **verbatim-adapt** (fetch contract → /api/v2/pages?date=) |
| `services/hocuspocus/content.server.ts` (HTML↔JSON, headless mutation, paragraph tagging) | `pages/store.ts` + `pages/treeUtils.ts` | **pattern-only** (Yjs doc mutation → plain JSON mutation + rev bump; `@tiptap/html` for round-trip) |
| `services/hocuspocus/page-outlinks.server.ts` | `pages/outlinks.ts` + `treeUtils.ts` | **verbatim-adapt** (tree-walkers verbatim; JSONB query → join table) |
| `services/collab-scanner.server.ts` (deprecated upstream) | `pages/mentionScan.ts` | **pattern-only** — wire OUR trigger into the autosave PATCH handler (upstream's trigger is disconnected; don't copy the wiring) |
| `services/butler-comment.server.ts` | `pages/comments.ts` | **pattern-only** (Yjs relative positions → paragraph attrs + normalized-text fallback) |
| `services/agent/tools/comment-tools.ts` (buildAnnotatedPageXml, add_comment) | `pages/comments.ts` | **verbatim-adapt** (serializer over JSON instead of Yjs) |
| `services/butler-activity.server.ts` | `AgentsSection` data in `/api/v2/tasks/board` | **verbatim-adapt** (state derivation → status bands) |
| `services/agent/tools/session-tools.ts` | `tasks/tools.ts` (get/list_task_coding_sessions) | **verbatim-adapt** (rows from v2_task_sessions; F3 fills status) |
| `task-detail-full.client.tsx`, `task-chat-panel.client.tsx` | `TaskDetail.tsx`, `TaskChatPanel.tsx` | **pattern-only** |
| `services/tasks/search.server.ts` (Fuse.js) | FTS5 in `store.ts` | **skip** (replaced by v2_tasks_fts) |
| Hocuspocus server, Yjs persistence, IndexedDB layer | — | **skip** (deferred per §1.1) |
| Credits/BYOK, Trigger.dev twins, voiceInboxMessage clearing | — | **skip** |

### F2 scheduler contract B consumes (names kept so ported logic lands unchanged)

```ts
enqueueScheduledTask(payload: {taskId: string}, runAt: Date): jobId   // wake-up; NO idempotency — caller removes first
removeScheduledTask(taskId: string): void
enqueueTask(payload: {taskId: string}, opts?: {delayMs?: number}): jobId  // immediate/delayed run
cancelTaskJob(taskId: string): void
enqueueDebounced(dedupeKey: string, payload: unknown, delayMs: number)    // mention scan: key `scratchpad-<pageId>`
```

---

## 5. API contracts

All routes: `runtime="nodejs"`, `dynamic="force-dynamic"`, `cache-control: no-store`, body via `req.json().catch()` + explicit 400s (house pattern). Behind `src/proxy.ts` password gate (no exemptions needed — no webhooks here).

```
GET  /api/v2/tasks?status=&type=one-time|recurring&date=YYYY-MM-DD&q=&parent=
  → { tasks: TaskRow[] }            // q → FTS5; date filters scheduled_date OR next_run_at day
POST /api/v2/tasks
  body { title?, description?, status?='Todo', parentTaskId?, assignedAgentId?, category?,
         source?='manual', scheduledDate?, schedule?, nextRunAt?, maxOccurrences? }
  → 201 { task }                    // schedule|nextRunAt → createScheduledTask path (default maxOccurrences 1)
                                    // else createTask + fire-and-forget detectAndApplyRecurrence(title)
                                    // status 'Ready' arms the 2-minute editing buffer
GET  /api/v2/tasks/:id              // :id = uuid or tk-* (resolveTaskId at the boundary)
  → { task, page: {id, contentJson, rev}, subtasks, sessions, events[…50] }
PATCH /api/v2/tasks/:id
  body { title?, sourcePageId?, description?, scheduledDate?, assignedAgentId?, category?,
         schedule?, isActive?, endDate?, maxOccurrences? }
  → { task }                        // title change propagates to OTHER pages via outlinks (skip sourcePageId);
                                    // queue only touched when schedule/isActive/endDate/maxOccurrences changed
POST /api/v2/tasks/:id/status   { status } → { task }        // actor='user'; canTransition enforced, 422 on illegal
POST /api/v2/tasks/:id/approve  { note? }  → { ok }          // Waiting-only; appends note as user turn, enqueueTask, status untouched (worker flips Working)
GET  /api/v2/tasks/:id/chat     → { conversationId, messages }   // one-shot shared thread (created lazily)
POST /api/v2/tasks/:id/chat     { text } → { message }       // persists turn; if task Waiting → auto-unblock (checkWaitingTaskReply); B6 ingest
GET  /api/v2/tasks/:id/runs     → { runs: [{conversationId, runNo, startedAt, status}] }
GET  /api/v2/tasks/board
  → { columns: {todo[], inprogress[], waiting[], done[]},     // §6 status→column mapping
      agents: [{id, name, band:'running'|'idle'|'waiting'|'error'|'offline',
                currentTask?: {displayId,title}, upcoming: [{displayId,title,nextRunAt}] }] }

GET  /api/v2/pages?date=YYYY-MM-DD  → { page }               // find-or-create daily (date key in settings tz)
GET  /api/v2/pages?taskId=…         → { page }               // find-or-create task page
PATCH /api/v2/pages/:id  { contentJson, rev }
  → 200 { rev: rev+1 } | 409 { current: {contentJson, rev} } // stale write; client merges + retries
  // side effects on 200: outlinks sync; empty-title-taskItem delete detection; mention scan enqueue (10 s debounce)
GET  /api/v2/pages/:id/comments → { comments }
POST /api/v2/comments/:id  { text } → { message }            // reply into comment conversation → Jarvis turn → B6 ingest
PATCH /api/v2/comments/:id { resolved } → { comment }        // also flips the paragraph's resolved attr in stored JSON
```

Agent tool surface (`tasks/tools.ts`, mounted in task runs and later in F4 `/api/mcp`): `create_task` (background runs: parentTaskId REQUIRED — subtasks only), `get_task`, `list_tasks`, `update_task` (zone merge; background: `<plan>`/`<outcome>`/replaceDescription rejected with the "plan is frozen" strings; foreground replaceDescription requires ≥0.3 similarity), `unblock_task`, `delete_task` (exile), `get_task_tree`, `reschedule_self` (1–60 min, metadata.rescheduleCount cap 10), `get_scratchpad {date?}`, `update_scratchpad {content, date?}` (append-only by contract), `get_task_coding_session`, `list_task_coding_sessions`, `list_task_browser_sessions`.

---

## 6. UI

Style: existing muted-neobrutalist dashboard — CSS vars (`--fg`, `--panel-border`), per-module accent hex, framer-motion, lucide. Accent for Tasks: reuse kanban accents (`src/lib/kanban.ts` COLUMNS colors) as the seed palette. All polling via `usePollWhileVisible` (3–5 s board, 15 s list).

```
/tasks (TasksView)
├─ header row: title · search box (FTS) · "New task" · <ConfigMenu title="Tasks" accent>…TasksSettings</ConfigMenu>
├─ Row 1 (grid 2fr/1fr):
│  ├─ TaskListPanel — tabs [One-time | Repeating]; rows: checkbox(Done) · title ·
│  │   mono display-id chip · date pill (click → date picker → PATCH scheduledDate) ·
│  │   schedule text ("mon/wed/fri 9:30am · 3 left") · status dot
│  └─ MiniCalendar — month grid; day dots colored by column; click day filters the list
├─ Row 2: TaskBoard (full width, tall)
│  columns Todo / In Progress / Waiting / Done — status→column mapping:
│    Todo=Todo · In Progress=Ready("starting…" chip)+Working(pulse) · Waiting=Waiting("needs you" amber)+Review("review me" amber) · Done=Done
│  HTML5 drag-drop (greenfield; Sidebar customize-mode is the in-repo DnD exemplar):
│    drop→ POST /status with actor 'user' (drop on In Progress sets Ready — system flips Working);
│    illegal transition → card snaps back + toast with the phase-rule reason
│  card: display-id · title · agent avatar · plan/blocker badge · subtask count · next-run chip
│  click card → TaskDetail drawer (right slide-over, ConfigMenu-shell width)
└─ Row 3: AgentsSection
   compact cards (grid, ~5/row): agent name · StatusBand (4px full-width color band, top edge) ·
   current task line · up-to-3 upcoming (displayId + next fire) ·
   bands: green #22c55e running · blue #3b82f6 idle · amber #f59e0b waiting-on-me · red #ef4444 error · gray #6b7280 offline
   StatusBand.tsx is exported standalone for F6 reuse; derivation server-side in /board (butler-activity port:
   running run → running; Waiting/Review task assigned → waiting; last run failed → error; enabled+quiet → idle; disabled → offline)

/today (Scratchpad)
├─ DailyScroller: DaySections, initial today+3 future, prepend/append 7 on scroll, cap 30, today-anchored until first scroll
├─ DayEditor per day: TipTap — StarterKit + scratchpadTaskItem + checklistInputRule + jarvisMention +
│   conversationParagraph + plan/outcome/log nodes; 800 ms debounced PATCH autosave with rev
├─ taskItem NodeView: '[ ] ' → POST create {title:'Untitled task', source:'daily', status:'Ready'} → id attr;
│   hydrate GET; checkbox=Done toggle; strikethrough; mono display-id → opens TaskDetail; next-run badge;
│   title sync = 500 ms debounced PATCH {title, sourcePageId} OUTSIDE React (NodeView update callback — cursor trap)
├─ @jarvis mention → highlighted ConversationParagraph once processed; click → CommentPopover thread
└─ header: date · "Brief" indicator when the morning-brief heading exists · gear (shared TasksSettings scratchpad section)
```

Settings (rule 16 — every knob in-app via `settings.tasks` subtree + TasksSettings in ConfigMenu):

| key | default | meaning |
|---|---|---|
| `tasks.timezone` | `"America/Chicago"` (prompt on first open) | schedule interpretation; changing it recalculates every active schedule |
| `tasks.planApproval` | `"always"` | `always \| auto` — global gate |
| `tasks.autoApproveCategories` | `[]` | categories that skip plan approval (B2) |
| `tasks.editingBufferSec` | `120` | Ready buffer before a run starts |
| `tasks.runTimeoutMin` | `30` | AbortController budget per run |
| `tasks.planProvider` / `tasks.execProvider` | `"cli:claude"` / `"agent-sdk"` | provider routing (rule 11; fail loudly) |
| `tasks.seeds.{morningBrief,eodWrapup,sundayPlanning,weeklyRetro}` | enabled:false + time fields | per-seed toggle + fire time (seed disabled = task isActive 0) |
| `voiceIndependent — scratchpad.mentionDebounceSec` | `10` | mention scan idle debounce |
| `scratchpad.emptyTaskGc` | `true` | buffer-expiry GC of abandoned Untitled tasks |

---

## 7. Granular task list (each ≤ ~half day)

Legend: [dep: …] = must land first. Every task ends with its verification step. F1/F2 are external dependencies; B0.x provides interim stubs so B never blocks.

**B0 — scaffolding & stubs**
- **B0.1** Create `src/lib/v2/tasks/types.ts` (TaskRow, TaskStatus, Actor, STATUS_BAND map, zod input schemas — client-safe, zero node imports) and `scripts/v2/` dir. Verify: `tsc` clean; import from a client component compiles.
- **B0.2** Migration `002_tasks_scratchpad` in `src/lib/v2/db.ts` per §2 DDL (+ `ensureFts()` sync helper). [dep: F1 db.ts exists; if not, add a minimal `db.ts` with migrations table per F1 spec and flag it]. Verify: `node scripts/v2/smoke-b1-model.mjs` creates the schema in a temp DB, inserts, round-trips.
- **B0.3** Scheduler shim: if F2 isn't merged, add `src/lib/v2/schedulerShim.ts` implementing the §4 contract on a `globalThis.__agentosV2Jobs` map + `v2_jobs` table + setTimeout rehydration from `src/instrumentation.ts`. Same file signature as F2 so deleting the shim is a one-line import swap. Verify: enqueue at +2 s fires once; restart-rehydrate test in smoke script.

**B1 — task model**
- **B1.1** `tasks/store.ts`: createTask (displayId txn, depth cap, Ready→buffer arm via enqueueScheduledTask now+bufferSec), getTask, resolveTaskId, listTasks (filters), updateTask (title/scheduledDate/agent/category), FTS upsert. [dep B0.2]. Verify: smoke creates tk-1, tk-1.1, rejects tk-1.1.1 child, resolves both id forms, FTS finds by body word.
- **B1.2** `tasks/phase.ts` verbatim port + unit-style assertions in smoke (agent→Done rejected, agent→Review allowed, user→Done allowed). [dep B0.1].
- **B1.3** `pages/store.ts` + `pages/treeUtils.ts`: find-or-create daily (settings-tz date key) & task pages; getPageJson/savePageJson with rev 409; JSON↔HTML via `@tiptap/html` with server-safe node set (plan/outcome/log/taskItem/mention/conversationParagraph minimal specs). Verify: smoke saves JSON, stale rev → 409, HTML round-trip preserves zone nodes.
- **B1.4** `tasks/lifecycle.ts` part 1 — changeTaskStatus: park on Todo/Waiting/Review (cancelTaskJob, clear nextRunAt for non-scheduled), Ready arms buffer only when no pending wake-up, subtask→Done parent auto-Done (Review counts active), Done on scheduled → deactivate, event rows + F2 event-bus emits. [dep B1.1, B0.3]. Verify: smoke walks the matrix incl. parent auto-Done blocking on a Review sibling.
- **B1.5** Conversations: v2_conversations/v2_messages DAO in store.ts — getOrCreateTaskConversation (one-shot shared), createRunConversation (recurring, run_no), append message. Verify: policy assertions in smoke (recurring gets fresh conv per run; one-shot reuses).
- **B1.6** Routes: `/api/v2/tasks` GET/POST, `/api/v2/tasks/[id]` GET/PATCH, `/status`, `/chat` GET/POST, `/runs`. House conventions (§5). [dep B1.1–B1.5]. Verify: curl script in smoke-b1 exercises every route incl. 422 on illegal transition.

**B2 — execution engine**
- **B2.1** `tasks/zones.ts`: mergeStructuredSections (one node per type per call, replace-in-place, append-if-absent, drop everything else), upsertPageSection, clearPageSection. Pure-function port. Verify: smoke merges a `<plan>` twice (position preserved), rejects double-plan input, user prose untouched.
- **B2.2** `tasks/prompts.ts`: port the five prompt blocks, rename butler→Jarvis, replace gateway tool names with our slot/tool names, keep the plan-frozen and reschedule-protocol text verbatim. Verify: snapshot test (string contains the load-bearing rules; grep in smoke).
- **B2.3** `tasks/tools.ts`: zod schemas + implementations for the §5 tool list against the DAO, incl. background guards (create_task parentTaskId requirement, update_task plan-frozen rejection strings, ≥0.3 similarity guard using a simple bigram-dice similarity). Mount as `createSdkMcpServer` (agentsHttpTool.ts pattern). [dep B1.x, B2.1]. Verify: direct-call tests in smoke (background create without parent → instructive error string).
- **B2.4** `tasks/runner.ts` part 1 — plan phase: resolve agent (assignedAgentId ?? generalist), build system prompt (persona stub + `<task_execution>` + task page HTML), **plan draft via provider-routed `cliComplete(settings.tasks.planProvider)`** producing `<plan>` HTML → zones merge → if approval required (planApproval/category): status Waiting (actor agent) + one tight question appended to chat + `attention.flag` event; else fall through to B2.5. [dep B2.1–B2.3]. Verify: smoke-b2 creates a task, run drafts plan, task parks Waiting, event emitted.
- **B2.5** `tasks/runner.ts` part 2 — execute phase: **agent-sdk execution** reusing the agentsRuntime `query()` pattern (streaming-input generator — SDK MCP tools require it; sanitizeSpawnEnv; PreToolUse gate) with task tools mounted; ephemeral trigger message `"Work on the task tk-… (reschedule N/10)."` with skipUserMessage semantics (persist ephemeral=1); 30-min AbortController; agent owns lifecycle (only crash/timeout → markTaskFailed). markTaskCompleted→Review+result; markTaskFailed→Waiting+error+`<p>[Error] ISO: msg</p>` append. [dep B2.4]. Verify: smoke with a trivial task ("write DONE into the outcome") reaches Review with `<outcome>` populated.
- **B2.6** Approval loop: `/approve` route (unblock semantics: verify Waiting, append note as user turn, enqueueTask, DON'T touch status) + chat-reply auto-unblock (checkWaitingTaskReply port: any Waiting task whose conversation got the reply → Ready, actor user). [dep B2.4, B1.6]. Verify: smoke parks a task Waiting, POSTs /approve, run resumes and completes.
- **B2.7** `tasks/dispatch.ts`: wake-up handler — staleness guard (nextRunAt null or >1 s future → no-op), buffer expiry (Ready+no schedule → if source=daily && isTaskEmpty → delete task + removeTaskItemFromPages, else clear nextRunAt + enqueueTask), fire-override (Todo|Waiting + schedule → Working + run), normal fire, stuck recovery (Working/Review + schedule). Register handler with F2/shim. [dep B2.5, B1.4]. Verify: smoke covers all five branches incl. the double-fire staleness case.
- **B2.8** `tasks/ingest.ts` (B6): taskIngest → dynamic-import A2 ingest if present else outbox row; drain job on scheduler tick; call sites: chat POST, run completion (result + plan), comment replies. Labels: `["task", displayId]` (+`"scratchpad"` for mentions). Verify: smoke asserts outbox rows appear with correct payload shape; with a mock A2 module they route through instead.

**B3 — recurring**
- **B3.1** `tasks/scheduleUtils.ts` verbatim port (rrule+luxon): computeNextRun (BYHOUR day-iteration path ≤400 days; no-BYHOUR = relative interval — DO NOT "fix"), formatScheduleForUser, getRecurrenceIntervalMinutes (floor 30 min). Verify: table-driven smoke: "FREQ=DAILY;BYHOUR=9" in America/Chicago across a DST boundary; FREQ=MINUTELY;INTERVAL=5 relative.
- **B3.2** `tasks/lifecycle.ts` part 2 — scheduleNextTaskOccurrence (self-no-op for non-recurring; Review|Working → Ready actor system; removeScheduledTask BEFORE enqueue — no idempotency key by design), incrementTaskOccurrenceCount, checkShouldDeactivate (maxOccurrences/endDate). Pipeline failure must still schedule next occurrence. [dep B3.1, B2.7]. Verify: smoke-b3 runs a FREQ=MINUTELY task twice with a forced failure in between — recurrence survives.
- **B3.3** `tasks/recurrence.ts`: extractScheduleFromText (provider-routed prompt from upstream `prompts/recurrence.ts`, `<output>` JSON parse via marketing's `extractJsonObj` tolerant parser), applyScheduleToTask (recurring clears stale maxOccurrences=1 — upstream bug fix), detectAndApplyRecurrence fire-and-forget on create/title-edit. Verify: "remind me friday 3pm" title → task acquires schedule + scheduleText.
- **B3.4** updateScheduledTask discipline in PATCH handler: description merges via upsertPageSection (never wholesale), scheduleText regen, queue touched ONLY when schedule/isActive/endDate/maxOccurrences changed. [dep B3.2]. Verify: smoke edits a title mid-pending-fire; wake-up still fires once.
- **B3.5** `tasks/seeds.ts`: `ensureSeeds()` from `src/instrumentation.ts` — Morning Brief (adapted MORNING_BRIEF_TASK_DESCRIPTION: memory-first setup questions; Gmail sections marked "skip silently if Gmail connector absent"; scratchpad append with `<h3>Brief — {date}</h3>` idempotency heading, plain bullets never taskItems, cap 5/section), End-of-Day Wrap-up (6 pm: Shipped/Still open/Blocking, "Quiet day." if empty), Sunday Planning (7 pm: reads last retro + open work), Weekly Retro scaffold (Fri 4 pm: empty headings only). All created isActive per `settings.tasks.seeds.*`, keyed by metadata.seedKey (upsert not duplicate), source `seed`. [dep B3.2, tools update_scratchpad]. Verify: smoke enables morningBrief, forces a fire, asserts scratchpad has exactly one Brief heading after two fires.

**B4 — Tasks page**
- **B4.1** `/api/v2/tasks/board` route: columns mapping + agents payload (butler-activity-style derivation joining agents-module run state (`~/.agentic-os/agents/*/runs` meta via agentsStore) with v2 task assignments). Verify: curl shows 4 columns + bands for existing agents.
- **B4.2** Sidebar + page shell: NAV entries + Set membership for `/tasks` and `/today`; `src/app/tasks/page.tsx` mounting TasksView with `usePollWhileVisible`. Verify: pages render, land in the intended sidebar section.
- **B4.3** TaskListPanel + MiniCalendar (fed by one list fetch; date pill → PATCH scheduledDate; calendar dots). Verify: Playwright/browser pass — set a date, dot appears.
- **B4.4** TaskBoard drag-drop: HTML5 DnD (draggable cards, column onDragEnter highlight, onDrop → /status; optimistic move, snap-back+toast on 422). Verify: drag Todo→In Progress sets Ready and the buffer chip appears; drag agent-forbidden target snaps back.
- **B4.5** TaskDetail drawer + TaskChatPanel: contentEditable title (800 ms debounce), properties bar (display-id chip, status dropdown, schedule button w/ scheduleText, agent picker, category), TipTap body with zone nodes, subtask list + inline add, chat (shared thread / runs list). Verify: draft plan visible as collapsible `<plan>` box; approve button drives B2.6.
- **B4.6** AgentsSection + shared StatusBand.tsx (export for F6). Verify: kill/finish a run → band flips within one poll cycle.
- **B4.7** TasksSettings in ConfigMenu (all §6 keys; timezone change → recalc endpoint POST `/api/v2/tasks/recalc-tz`). Verify: change buffer to 10 s, `[ ]` task fires in ~10 s.

**B5 — Scratchpad**
- **B5.1** DayEditor: TipTap assembly (StarterKit minus conflicting nodes + custom extensions), autosave-with-rev loop, 409 merge (refetch, replay local steps is out of scope — replace-and-toast). [dep B1.3]. Verify: type, reload, content persists; concurrent stale write recovers.
- **B5.2** checklistInputRule + scratchpadTaskItem NodeView port: create-on-mount (Ready+Untitled), hydrate, checkbox toggle, display-id link, next-run badge, 500 ms title sync with sourcePageId, Enter/Backspace/Shift-Tab keymap. [dep B5.1, B1.6]. Verify: '[ ] buy milk' → task exists with title syncing; abandon empty → GC'd by buffer expiry AND node stripped (B2.7 branch).
- **B5.3** Delete-detection plugin (appendTransaction diff of task ids; empty/Untitled + no description → DELETE, titled survives) + `pages/outlinks.ts` (sync join table on save; cross-page title propagation skipping sourcePageId; removeTaskItemFromPages). Verify: smoke-b5 + editor: delete an untitled line kills the task; a titled one survives.
- **B5.4** DailyScroller + `/today` page (+ Homepage handoff note for H1: exports `<DayEditor date=today>` for embedding). Verify: scroll up/down loads days; today anchor holds until first scroll.
- **B5.5** jarvisMention extension + `pages/mentionScan.ts`: on autosave, walk JSON for mention nodes; normalized paragraph text not in v2_page_comments.selected_text → enqueueDebounced(`scratchpad-<pageId>`, 10 s). Handler: create conversation(source daily) + comment row + run a Jarvis turn (provider-routed; `<scratchpad_context>` block; page HTML in context) → write reply into comment.content + tag paragraph attrs in stored JSON (rev bump; client refetches if not focused). [dep B2.x runner primitives]. Verify: type "@jarvis summarize this paragraph" → highlighted paragraph + popover reply within ~15 s; editing the same text does not double-process.
- **B5.6** ConversationParagraph + CommentPopover (thread UI, reply POST → Jarvis turn, resolve toggle PATCHes row + attrs). Verify: reply round-trip; resolve dims highlight; reopen works.
- **B5.7** plan/outcome/log TipTap nodes (collapsible bordered boxes, hide-when-empty) shared by TaskDetail body and scratchpad. Verify: task page renders agent-written zones; user prose edits don't disturb them.
- **B5.8** (phase 2, optional) SelectionBubble convert-to-tasks port. Verify: select 3 lines → 3 bound taskItems.

**B6** is delivered inside B2.8 call sites + B5.5/B5.6 (mention exchanges ingest with scratchpad label). Final check task:
- **B6.1** Ingest audit pass: grep all mutation call sites → every chat POST, run completion, comment reply calls taskIngest exactly once; outbox drain works. Verify: smoke counts outbox rows for one full E2E flow (expected: create/plan/approve/complete/chat = ≥3 episodes).

Suggested landing order: B0 → B1 → B2.1–B2.3 → B3.1 → B2.4–B2.8 → B3.2–B3.5 → B4 → B5 (B4/B5 parallelizable after B2).

---

## 8. Risks & Windows-specific notes

1. **Native deps**: none added by B (rrule/luxon/TipTap are pure JS). The better-sqlite3-vs-node:sqlite question lives in F1; B's DDL and DAO calls are compatible with both. If F1 lands on better-sqlite3, Windows needs the prebuilt binary (it ships prebuilds for Node 22 — verify at install, don't assume node-gyp works).
2. **Timers vs sleep/restart**: setTimeout-based wake-ups die with the dev server and drift across machine sleep. Mitigations already in the design: DB-persisted jobs + rehydration from `instrumentation.ts` (missed fires run at max(nextRunAt, now)), and the dispatcher's staleness guard makes duplicate/late fires safe. Never trust an in-memory timer as the source of truth.
3. **globalThis singletons**: scheduler shim, in-flight run registry (`__agentosV2TaskRuns`), and the runner's AbortControllers must live on `globalThis` — Next instantiates modules per route bundle.
4. **Spawn hygiene**: every run/exec path routes through `sanitizeSpawnEnv` + `runner.ts` (PORT-inheritance hijack, .cmd shims, 32 k arg cap → stdin, `killTree` for timeouts). The SDK execution path must also strip `CLAUDE_CODE_*` env leakage (agentEnv already does).
5. **Timezone**: schedules stored in USER-LOCAL tz, next_run_at UTC; default tz must be prompted (a 9 am UTC morning brief is the documented footgun). DST handled by the ported computeNextRun day-iteration path — do not simplify it.
6. **Cursor destruction** (even without Yjs): any server write into the doc the user is editing (title propagation, comment tagging, brief append) must skip the focused page (sourcePageId thread-through) or arrive via refetch-on-blur; the taskItem NodeView re-renders React only on id-attr change.
7. **Recurrence stalls** (upstream's hard-won fixes — all preserved above): no idempotency key on enqueueScheduledTask (remove-then-enqueue), queue untouched on title edits, scheduleNextTaskOccurrence always runs even after pipeline failure, stuck-Working/Review recovery branches exist.
8. **Deletion policy**: only the empty-Untitled daily GC row-deletes; every other "delete" is exile-style (metadata.exiled + Done) per the global rule. `delete_task` tool follows suit.
9. **Provider routing** (rule 11): planProvider/execProvider are settings; a missing/failed provider throws with stderr tail — no silent local fallback. The SDK execution engine is Claude-lineage; that's declared in settings, not hidden (open question 3).
10. **Fable-safety** (user rule 17): implementing agents should use the §4 port map file list — no broad enumeration sweeps over AgentOSCore.

---

## 9. Verification plan (`scripts/v2/`)

All scripts run against a temp DB (`AGENTOS_V2_DB=%TEMP%\agentos-test.db`) so the live store is never touched; they exit non-zero on first failure and print a checklist. Runnable individually and via `scripts/v2/smoke-b-all.mjs`.

- **smoke-b1-model.mjs** — schema create; displayId sequence (tk-1, tk-2, tk-1.1) + depth-cap rejection; resolveTaskId both forms; phase matrix (agent Waiting/Review only); parent auto-Done incl. Review-sibling block; FTS search; conversation policy (shared vs per-run); route-level curl pass against a dev server if `AGENTOS_URL` set (else DAO-only).
- **smoke-b2-engine.mjs** — zone merge invariants (replace-in-place, double-node rejection, prose preservation); plan-frozen + parentTaskId background guards return the instructive strings; plan→Waiting→approve→execute→Review E2E with a trivial task; failure path → Waiting + `[Error]` line appended; ingest call-count audit; dispatcher branch table (staleness no-op, buffer GC of empty daily task incl. node strip, fire-override, stuck recovery).
- **smoke-b3-recurring.mjs** — computeNextRun table (DST boundary, BYHOUR path, relative no-BYHOUR); occurrence loop ×2 with an injected failure between (recurrence survives); maxOccurrences/endDate deactivation; NL extraction ("every weekday at 9am", "in 5 minutes", "friday 3pm" one-shot); title-edit-during-pending-fire race; seed idempotency (double ensureSeeds → no duplicates; double brief fire → one heading).
- **smoke-b5-scratchpad.mjs** — daily find-or-create keyed by settings tz; rev conflict 409 + recovery; outlinks sync + cross-page title propagation skipping source; mention scan dedupe (same normalized text processed once; edited text reprocessed — accepted behavior); comment create/reply/resolve round-trip with a mocked Jarvis turn (`AGENTOS_MOCK_LLM=1` env making `cliComplete` return canned output — add the hook to the runner for testability).
- **UI pass** (manual/Playwright, after B4/B5): board drag legal+illegal, date pill → calendar dot, `[ ]` → badge → detail nav, @jarvis popover, band flip on run start/stop, settings buffer change takes effect without rebuild.

Phase exit (MASTER-PLAN §0): `tsc` clean, Yoshi's `npm run build` passes, `smoke-b-all` green.

---

### Open questions (for Yoshi / Ultraplan integrator)

1. **Execution engine lineage**: v1 tool-using execution runs on the Claude Agent SDK (agentsRuntime reuse) while plan-drafting + recurrence extraction are fully provider-routed. Acceptable, or must tool-executing runs also be routable to codex/cursor CLIs (would need a text-protocol tool loop — significant extra scope)?
2. **Done column vs exile**: `delete_task` exiles; should the board's Done column auto-archive after N days (hide, not delete)?
3. **`/today` vs Homepage**: H1 will embed today's DayEditor — confirm `/today` stays a full page too (spec assumes yes).
4. **Category taxonomy** for auto-approve: free-text `category` on tasks with a settings list, or a fixed enum? Spec assumes free-text + settings-managed list.
5. **F1 driver**: DDL is driver-agnostic, but B3.2's remove-then-enqueue and B1.1's displayId txn assume synchronous transactions — both node:sqlite and better-sqlite3 satisfy this; confirm F1 doesn't pick an async driver.
