# Pipeline

Route: `/pipeline` · UI: `src/components/PipelineView.tsx`, `src/components/PipelineSettings.tsx` · Backend: `src/app/api/pipeline/`, `src/lib/pipeline.ts`

An idea-to-deliverable board with one human checkpoint. You capture an idea, an agent classifies it and drafts a plan, you approve or reject it once, and then an agent builds a single-file HTML deliverable you can preview in place. Every item is a Markdown file in your Obsidian vault.

## Tabs and controls

### Header and capture

| Control | What it does |
|---|---|
| **Configure** | The "Pipeline settings" gear. **Provider** is **Ollama · local (this machine)**, one of your detected CLI agents, or **MiniMax · coding plan**. For Ollama it also shows **Ollama model** (blank auto-detects, the refresh button re-reads the installed list from `/api/pipeline/models`) and **Ollama URL** (blank is `http://localhost:11434`). **Save** writes them. |
| **Pipeline** / **Gallery** | Switches between the board and a grid of built deliverables. |
| Idea box | What the idea is. Ctrl+Enter (Cmd+Enter on Mac) captures it. |
| **Capture** | Posts the idea, goal, details and type to `/api/pipeline/capture`. The item lands in Capture. |
| **Add detail (helps the agents)** / **Less** | Shows or hides the optional **Goal** and **Details** boxes. |
| **Type** | auto, project, action, idea or reference: a hint to the classifier. |

### Board (Pipeline view)

Four stages left to right: **Capture**, **Human Gate**, **Execute**, **Shipped & Filed**. Rejected items do not appear on the board.

| Control | What it does |
|---|---|
| Star ("Pin to top") | Pins or unpins the card through `/api/pipeline/pin`. Pinned cards sort first. |
| **Shape it** | On Capture cards. Posts to `/api/pipeline/shape`: classifies the idea (project, action, idea, reference, escalate) and drafts a plan, moving it to Human Gate. |
| **Approve** | On Human Gate cards. Posts to `/api/pipeline/decide` with approve. Tasks are broken out and the item moves to Execute. A `project` item then starts building straight away. |
| Ban icon (no label) | On Human Gate cards. Rejects the item (`approve: false`). |
| **Build the deliverable** | On Execute cards. Posts to `/api/pipeline/build`. |
| **View what was built** | On Shipped cards with a build. Opens the drawer. |
| **Stop** | Shown while a card is working. Aborts the request from the browser. |
| Clicking a card | Opens the drawer. |

### Gallery view

| Control | What it does |
|---|---|
| **Preview live** | Loads the build in an iframe on the tile (only on click). |
| Star | Pin or unpin. |
| External link ("Open full-screen") | Opens the build in a new tab. |

### Drawer

| Control | What it does |
|---|---|
| Archive icon ("Remove from board") | Asks for confirmation, then posts to `/api/pipeline/delete`, which moves the item to `Pipeline/.exile/<timestamp>/items/` in the vault. |
| **Let the agents shape it** | Same as **Shape it**. |
| **Tweak the proposal** box + **Agent** picker + **Revise plan** | Human Gate only. Posts your feedback and the chosen CLI agent to `/api/pipeline/revise`, which rewrites the plan. Repeat as often as you like. |
| **Your notes** + **Save note** | Human Gate only. Posts to `/api/pipeline/note`. |
| **Approve & build** / Ban icon | Same as the card buttons. |
| **Build the deliverable** / **Rebuild** | Builds, or rebuilds an existing deliverable. |
| Open full-screen link | On the "What the agents built" preview. |

The drawer also shows the vault path, Idea, Classification, Proposed Plan, Execution Tasks and Notes.

## How it works

- Items live as Markdown files under `<vaultRoot>/Agentic OS/Pipeline/items/`. With no `vaultRoot` in the Agent OS config, the page shows a message asking you to set it and nothing else.
- Classification, planning and building go to the provider in the gear. The CLI path runs the agent on your subscription with full access; MiniMax needs a Hermes `minimax-oauth` login; Ollama needs a model installed. A provider that is not available fails with a named error.
- Builds are written into the `free-claude-code` project folder shared with the Agent Factory gallery and previewed through `/api/freeclaude/preview/free-claude-code/...`. The build step checks the HTML for dead controls and asks the model to fix what it finds.
- **Stop** aborts the browser request; the shape and build routes pass that abort signal to the model call.
- Remove never deletes: `/api/pipeline/delete` exiles the item's markdown to `Pipeline/.exile/<timestamp>/items/<slug>.md` in the vault (move it back to restore). With no vault configured it answers 503; an unknown item is a 404.
