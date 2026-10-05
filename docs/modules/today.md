# Today

Route: `/today` · UI: `src/components/v2/pages/ScratchpadView.tsx` (with `PageHeader.tsx`, `Editor.tsx`, `CommentBubble.tsx`, `ScratchpadSettings.tsx`) · Backend: `src/app/api/v2/pages/`, `src/lib/v2/pages/store.ts`, `src/lib/v2/pages/butler.ts`

A daily scratchpad: one page per day. You write freely; a line typed as a checkbox becomes a real task, and a paragraph that mentions `@jarvis` gets a reply from Jarvis as a comment beside it. The same scratchpad is embedded at the bottom of Mission Control.

## Tabs and controls

| Control | What it does |
|---|---|
| Day title | The date of the page. The line under it reads "today" (or the date) and the hints "type [ ] for a task · @jarvis to ask". |
| Previous day (left arrow) | Loads the page for the day before. |
| **Today** | Jumps back to today's page. Disabled when you are already on it. |
| Next day (right arrow) | Loads the page for the day after. |
| **Widgets** | Shows or hides the widgets panel above the editor (highlighted when open). The panel is the Mission Control widget grid with its own layout for Today: **Customize** arms drag-to-reorder, the size cycle, remove and the per-widget config form, and **Add widget** opens the same catalog (**Done** keeps the layout, **Cancel** restores the previous one). It starts empty and says so. Open state and layout are settings (`settings.home.todayShowWidgets`, `settings.home.todayCells`), saved the same way as Mission Control's `settings.home.cells`. |
| **Configure** (gear, tooltip "Scratchpad Settings") | One field, **@jarvis reply debounce (seconds)** (default 8): how long Jarvis waits after you stop typing before answering. A note says timezone, empty-task cleanup and execution settings live in the Tasks gear. |
| Editor | Rich-text page. Saves itself about 1.5 s after you stop typing. |
| Checkbox line (`[ ]`) | On save, a new non-empty checkbox line creates a task (source "daily", status Ready). Ticking or unticking it marks the task Done or reopens it; editing the text renames the task. |
| Task id chip | "Open <id> in Tasks": goes to `/tasks?focus=<id>`. A status pill next to it shows the task's current status. |
| Comment bubbles | Jarvis's replies (and any comments) sit in the right gutter next to their paragraph, labelled "Jarvis" or "You". If the paragraph is gone, the comment moves to a list at the bottom quoting the text it was about. |
| Resolve / Reopen (check or undo icon on a bubble) | Marks the comment resolved, or reopens it. |
| Toast "Page changed elsewhere" | Shown when your save lost a race with another save; the latest version is reloaded in place. |

## How it works

- Pages and comments are stored in the V2 SQLite database (`~/.agentic-os/agentos.db`, tables from the pages migration). `GET /api/v2/pages?date=YYYY-MM-DD` finds or creates the page for a day; `/api/v2/pages/<id>` loads and saves it; `/api/v2/pages/<id>/comments` lists comments and resolves them. Saves use a revision number, so a stale save is rejected rather than overwriting newer text.
- Task binding runs on every save (`src/lib/v2/pages/butler.ts`). Task statuses for the chips come from `GET /api/v2/tasks?source=daily`. If you delete a checkbox line, its task is exiled only when it has nothing beyond its title; otherwise it is kept and just unlinked from the page.
- `@jarvis` replies are a debounced background job. The answer comes from the Memory module's model setting (`settings.memory.provider` and its low-tier model) with recalled memory as context, and is written as a comment. It also raises a "scratchpad.reply" item in Mission Control's attention list. The same paragraph text is never answered twice; editing it triggers a new reply. If the model call fails, nothing is written and the next save tries again.
- The day's text is ingested into Memory nightly (around 23:55 local) when it changed.
- The Widgets panel is `HomeGrid` (`src/components/v2/home/HomeGrid.tsx`) with `cellsKey="todayCells"`: the same registry, data routes and picker as Mission Control, a separate cells list, and an empty default instead of the Overview's legacy panels.
