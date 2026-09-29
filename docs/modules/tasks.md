# Tasks

Route: `/tasks` · UI: `src/components/v2/tasks/TasksView.tsx` (with `TaskListPanel.tsx`, `MiniCalendar.tsx`, `TaskBoard.tsx`, `AgentsSection.tsx`, `TaskDetail.tsx`, `TasksSettings.tsx`) · Backend: `src/app/api/v2/tasks/`, `src/lib/v2/tasks/` (store, engine, dispatch, recurrence, seeds)

Tasks that an agent can plan and carry out. You write a task (or tick a `[ ]` line on the Today page), an agent drafts a plan, you approve it, and the engine runs it step by step. Tasks can be one-time or repeating. This is the V2 task surface; the older `/kanban` module is separate.

## Tabs and controls

### Header

| Control | What it does |
|---|---|
| Counts line | "N open · N repeating". |
| **Search tasks...** | Filters the list by text (queries `/api/v2/tasks?q=`). |
| **New task** | Opens a drawer with **Task title**, an optional spec ("what should the agent accomplish?") and **Create**. Enter in the title also creates. |
| **Configure** (gear, tooltip "Tasks Settings") | See Settings below. |

### List and calendar (row 1)

| Control | What it does |
|---|---|
| **One-time** / **Repeating** | Switches between tasks without and with a schedule. |
| **needs you** | Shows only tasks in Waiting or Review, or with a drafted plan waiting for approval. Shows a count. |
| Date chip with X | Appears when a calendar day is selected; clears the day filter. |
| Row checkbox | "Mark Done", or "Reopen (Todo)" if already done. |
| Row date pill | "Set a calendar date (no auto-fire, just a pin)": sets the task's scheduled date. |
| Row | Opens the task detail. |
| Calendar, **Previous month** / **Next month** | Month grid with a dot per board column that has a task due that day. Click a day to filter the list. |

### Board (row 2)

Four columns you drag cards between: **Todo**, **In Progress** (Ready and Working), **Waiting** (Waiting and Review), **Done**. Dropping into In Progress sets the task to Ready; the worker moves it to Working. A move the rules refuse bounces back with the reason in a toast. Cards show the assigned agent and the schedule text.

### Agents strip (row 3)

One card per background agent with its status band, its current task and its upcoming runs. Clicking a task id opens that task. With no agents it says to create them on the Agents page.

### Task detail (slide-over)

| Control | What it does |
|---|---|
| **Run** | "Run now (fire-override)": posts to `/api/v2/tasks/<id>/run`. |
| **Exile** | "Exile (recoverable delete)". Asks first; the full bundle is saved to `~/.agentic-os/.exile/tasks/` before removal. |
| **Overview** tab | **spec (your words)** with **Save spec**; the agent-drafted plan with **Approve** / **Reject** when drafted ("No plan yet" otherwise); the result, any error, subtasks and the status timeline. |
| **Chat** tab | The task's thread. Runs stream their plan, steps and questions here. Replying to a Waiting task unblocks it. Box and **Send**. |
| **Sessions** tab | Linked sessions ("No linked sessions" when none). |
| **Activity** tab | Full event log. |

### Settings (Configure gear)

| Control | What it does |
|---|---|
| **Timezone** | IANA zone for schedules. Saving a change recalculates every active schedule. |
| **Plan approval** | "always" parks every drafted plan for you; "auto" skips the gate. |
| **Auto-approve categories**, **Auto-approve max steps** | Categories that skip approval, and the size above which they still ask. |
| **Max steps per run**, **Run timeout (min)**, **Editing buffer (sec)** | Step cap, time budget per run, and the grace period after a task turns Ready before it starts. |
| **GC empty scratchpad tasks** | Exiles abandoned untitled daily tasks when their editing buffer expires. |
| **Seed tasks** | Toggles for the built-in recurring tasks: Morning Brief, End-of-Day Wrap-up, Sunday Planning, Weekly Retro scaffold. |

`/tasks?focus=<displayId>` opens a task directly; Today's task chips and attention items use this.

## How it works

- Tasks, events, messages and sessions live in the V2 SQLite database (`~/.agentic-os/agentos.db`). Settings are `settings.tasks` in the runtime settings store, so changes apply without a restart.
- The engine (`src/lib/v2/tasks/engine.ts`) claims a task, gathers context, drafts a plan (approval-gated unless auto-approved), then walks the steps up to the step cap and time limit, delivers a result and ingests it into Memory. All model calls go through the Memory module's provider setting (`src/lib/v2/memory/llm.ts`); an empty reply is an error, not a silent fallback.
- Scheduled and immediate runs are jobs in the V2 scheduler (`dispatch.ts`). A schedule fires even if the task is in Todo or Waiting. A run that crashed mid-way is picked up again on the next wake.
- The `sdk` run mode is not implemented yet; runs use the bounded step walker.
