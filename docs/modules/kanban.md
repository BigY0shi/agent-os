# Kanban

Route: `/kanban` · UI: `src/components/KanbanView.tsx`, `src/components/KanbanSettings.tsx` · Backend: `src/app/api/hermes/kanban/` (`board`, `task`, `action`, `dispatch`, `workspace`), `src/lib/kanbanDb.ts`, `src/lib/kanbanWorkspace.ts`, `src/lib/kanban.ts`

A window onto the Hermes agent task board. It reads Hermes's own kanban database and sends every change through the `hermes kanban` CLI, so tasks you create here are picked up by Hermes workers, and work they do shows up here. It has no database of its own.

## Tabs and controls

The page is one board: a toolbar, a create row, six columns, and a task drawer that opens when you click a card.

### Toolbar

| Control | What it does |
|---|---|
| Board picker | Shown when more than one Hermes board exists. Lists each as "<name> (<slug>)". The page opens on `?board=<slug>` if given, else the last board you viewed, else **Default board** from settings. |
| **Search...** | Filters cards by title or task id. |
| **Configure** (gear) | Opens "Kanban settings": **Default board** (a board slug) and **Dispatch agent** (a CLI agent picker; saved but not used yet, because Hermes's own dispatcher spawns the workers, and its hint says so). Saved to the `kanban` section of `~/.agentic-os/settings.json`. |
| Assignee filter | **All assignees**, or one Hermes profile (with its task count). |
| **Show archived** / **Hide archived** | Toggles archived tasks, which then get their own group. |
| **Refresh** | Reloads the board now. The board also refreshes every 20 seconds. |
| **Dispatch now** | Runs `hermes kanban dispatch --max 10 --json` instead of waiting for the dispatcher's next 60-second tick. A banner then shows "Promoted N · Spawned N · Reclaimed N", plus a warning if ready tasks were skipped because they have no assignee. |
| Counter | "N tasks · N profiles". |

### Create row

| Control | What it does |
|---|---|
| **New task title...** | The title. Ctrl/Cmd+Enter creates the task. Once you type a title, an optional body box appears ("Optional body / context for the worker..."). |
| Assignee select | **(unassigned)** or a Hermes profile. Defaults to `julian`. |
| **Triage** | Checkbox, on by default. Creates the task in Triage. A note explains the orchestrator can auto-decompose it if `kanban.auto_decompose` is enabled in your Hermes config. |
| **Add** | Creates the task via `hermes kanban create`. |

### Columns and cards

Columns are **Triage**, **Todo**, **Ready**, **Running**, **Blocked**, **Done**, each with a count. A card shows its title, assignee, age and id. A Ready or Triage card with no assignee is outlined amber and marked "unassigned · stuck", because the dispatcher skips it. Cards whose title starts with a pin emoji sort to the top. On the `content` board, pinned cards show the Content Machine's finished blog (iframe) or video inside the card.

### Task drawer

| Control | What it does |
|---|---|
| Status, id, age, title | Header. The X closes the drawer. `/kanban?task=<id>` opens a task's drawer directly. |
| Assignee select | Reassigns the task (`hermes kanban assign`). Choosing **(unassigned)** sends `none`. |
| **Specify** / **Decompose** | Shown in Triage. Run `hermes kanban specify` or `decompose` on the task. |
| **Unblock** | Shown when Blocked. |
| **Block...** | Opens a reason box ("Why are you blocking this?") with **Confirm**. |
| **Complete** | Marks the task done. |
| **Archive** | After a confirm, archives the task. |
| Description, Parents, Children | The task body (Markdown) and linked tasks with their status. |
| **Latest handoff summary** / **Output** | The worker's latest summary and its result, when present. |
| **Workspace (N files)** | Files in the task's workspace folder, with a copy-path button. Click a text file to preview it, or a video to play it. Binary files cannot be previewed. |
| **Rendered** / **Source** | For Markdown files, switch between formatted and raw view. |
| **Copy** / **Save** | Copy the file text, or download it. For videos, **Save** downloads the raw file. Files over 1 MB are truncated in the preview. |
| **Run history (N)** | Each run's outcome, profile, duration, summary and error. |
| **Comments (N)** + **Send** | Read comments and add one (Ctrl/Cmd+Enter sends). The hint says comments give the worker context on its next run. |
| **Event log (N)** | Collapsed list of task events. |

If the backend is not usable, a setup card replaces the empty board and names the blocker: Node older than 22, Hermes not installed, or no board database yet.

## How it works

- Reads go straight to Hermes's SQLite files through `node:sqlite` (Node 22 or newer): `~/.hermes/kanban.db` for the default board and `~/.hermes/kanban/boards/<slug>/kanban.db` for others. Profiles come from `~/.hermes/profiles`.
- Every write runs the `hermes` CLI on the server (`hermes kanban [--board <slug>] create|complete|block|unblock|archive|comment|assign|specify|decompose`). Errors from the CLI are shown in a red box on the page.
- Task workspaces are read from `~/.hermes/kanban/workspaces/<task_id>/` (or `~/.hermes/kanban/boards/<board>/workspaces/<task_id>/`), unless the task records its own workspace path.
- The actual work is done by Hermes workers spawned by the Hermes dispatcher, not by this app.
- Needs: Hermes installed and logged in to a provider, and at least one task created so the database exists.
