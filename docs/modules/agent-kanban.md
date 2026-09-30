# Agent Kanban

Route: `/agent-kanban` · UI: `src/components/AgentKanban.tsx`, `src/components/RunLaunchDrawer.tsx` · Backend: `src/app/api/agent-kanban/` (`plan`, `build`, `preview/[id]`, `workspace`), `src/lib/kanbanStore.ts`, `src/lib/localOllama.ts`, `src/lib/launchOptions.ts`

A small agent team that turns a goal into a set of single-file HTML builds. The Planner splits your goal into a few cards, the Builder writes one self-contained HTML page per card, and each result is checked and shown as a live preview. Finished builds are kept in a Workspace on disk.

## Tabs and controls

The header has two tabs, **Board** and **Workspace**, and a team strip (**Planner**, **Builder**, **Reviewer**) that highlights whichever step is active. Hover a team chip for a one-line description. The subtitle shows the model used for the last plan or build.

### Board

| Control | What it does |
|---|---|
| Goal box | "Give the team a goal..." Pressing Enter opens the launch drawer for a plan. |
| **Assemble board...** | Opens the launch drawer to plan. Reads **Planning... (Stop from the runs tray)** while running. Planning replaces the current cards. |
| **Run the team...** | Shown when there are queued or rejected cards. Opens the launch drawer to build them. Reads **Building... (Stop from the runs tray)** while running. |
| Trash icon ("Clear board") | After a confirm, empties the board and clears it from browser storage. Builds already saved in the Workspace are kept. |
| Columns | **Backlog**, **Build + check**, **Done** (Done also holds rejected cards), each with a count. |
| Done card | Shows the build in a sandboxed iframe, its size, "verified", and an **open** link that opens the page in a new tab. |
| Rejected card | Shows the reason, for example "no real build landed". Rejected cards are retried on the next **Run the team...**. |

### Launch drawer

Opened by **Assemble board...** or **Run the team...**. Last-used values are remembered per module. Once a run starts, the only control is **Stop** in the runs tray.

| Control | What it does |
|---|---|
| **Seat** | Who does the work: Local team (Ollama), Claude (CLI), Codex (CLI), Cursor (CLI), Pi (CLI), Hermes (CLI). |
| **Skills for this run** | Skills from `~/.agentic-os/skills` to add to this run's prompt. |
| **Guardrails** | **Model call timeout (min)** (1 to 15, default 4), **Max cards per plan** (1 to 6, default 5), **No external scripts** (off by default). |
| **Extra instructions** | Free text appended to the prompt. |
| **Assemble board** / **Run the team** | Starts the run. **Cancel** closes the drawer. |

### Workspace

| Control | What it does |
|---|---|
| Build tiles | Every saved build, newest first, with a live iframe preview, title, "from: <goal>" and size. |
| **open** | Opens the build in a new tab via `/api/agent-kanban/preview/<id>`. |
| **delete** | After a confirm, removes that build. |
| **Clear all** | After a confirm, removes every build one by one (each is exiled, see below). |
| Refresh icon | Reloads the list. |

## How it works

- **Plan** posts `{ goal, launch }` to `/api/agent-kanban/plan`. The Planner must return strict JSON cards, capped at **Max cards per plan**. **Run** loops through queued and rejected cards in the browser, posting each to `/api/agent-kanban/build`. Every plan and every card build is its own run in the runs tray. Stopping a build ends the loop and puts the remaining cards back in the backlog.
- Seats: "Local team (Ollama)" calls your local Ollama at `127.0.0.1:11434`, using `LOCAL_MODEL` if set, else the model already loaded, else a coder-like model from the installed list. The CLI seats go through `cliComplete()` with your own CLI logins.
- The check happens inside the build route: a card is approved only when real HTML comes back, and with **No external scripts** on, a page that loads a script or stylesheet from off the page is rejected. The board shows this as one **Build + check** column; there is no separate timed Review step, and the Reviewer is not a separate model call.
- Builds are saved to `~/.agentic-os/agent-kanban/builds/<id>.html`, listed in `~/.agentic-os/agent-kanban/manifest.json`. Deleting a build moves its file to `~/.agentic-os/agent-kanban/.exile/<timestamp>/`; nothing is hard-deleted.
- The board itself (cards, goal, model) lives only in browser localStorage under `agentic-os/agent-kanban/v1`, so it is per browser.
- Previews are served with `sandbox="allow-scripts allow-popups"`.
