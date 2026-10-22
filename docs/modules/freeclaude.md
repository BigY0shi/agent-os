# Free Claude Code

Route: `/freeclaude` · UI: `src/app/freeclaude/page.tsx`, `src/components/SpeakBuild.tsx`, `src/components/FreeClaudePanel.tsx` · Backend: `src/app/api/freeclaude/` (`build`, `builds`, `chat`, `workspace`, `preview`), `src/app/api/fcc/route.ts`, `src/lib/fcc.ts`, `src/lib/freeClaudeWorkspace.ts`

Two ways to get work out of free or cheap models. **Agent Factory** turns a spoken or typed idea into a single self-contained HTML page and runs it next to you. **Chat & Workspace** runs the real Claude Code CLI, but routed through the local `fcc-server` proxy to a different upstream model.

## Tabs and controls

Two pill tabs at the top: **Agent Factory** and **Chat & Workspace**. Both stay loaded when you switch, so a running preview or build is not lost.

### Agent Factory

| Control | What it does |
|---|---|
| **On-device** / **N2 ✦ smarter** | Picks the engine. On-device uses a model through Ollama; N2 uses `nex-agi/nex-n2-pro:free` on OpenRouter. Each engine has its own project folder and history. Locked while building. |
| Mic button | Browser speech recognition (Chrome or Safari). What it hears is put in the box and built straight away. |
| Idea box | Type an idea. Ctrl/Cmd+Enter builds. |
| **Build** / **Stop** | Streams the model's output into a live build log, then saves the HTML as `<slug>.html` in the project folder. **Stop** aborts the request. |
| Example chips | Fill the box with a sample idea (does not build). |
| **what you've built** / **built with N2** list | Past builds for this engine, with an **example** tag on shipped samples. Click one to run it. |
| Reload icon | Reloads the running preview. |
| Open-in-new-tab icon | Opens the page through `/api/freeclaude/preview/`. |
| X ("Stop preview") | Unloads the preview iframe to free CPU. Previews stay off until you start one. |
| **gallery** / **n2 gallery** strip | Every `.html` file in the project folder, newest first. Click to run. |

### Chat & Workspace

The panel header shows **live** or **offline** (whether `fcc-server` answers), the active model and provider from `~/.fcc/.env`, the active project, and a **clear** button.

| Control | What it does |
|---|---|
| **Chat** / **Workspace** | Inner tabs. |
| **clear** | Empties the chat thread (Chat tab, idle only). No confirmation. |
| Message box | Ctrl/Cmd+Enter sends, Esc stops. |
| **Send** / **Stop** | Sends to `/api/freeclaude/chat`, or aborts. **Send** is disabled while `fcc-server` is offline. |
| **Projects** list, refresh icon | Folders under `~/freeclaude-scratch/`. Re-polls every 4 seconds on the Workspace tab. |
| `new-project-name` box + **Add** | Creates a project and makes it active. |
| **Set active** | Makes that project the chat's working folder. |
| File list | Click a file to preview it. |
| **Preview** / **Source**, **New tab**, **Copy**, **Save**, close (X) | Same file viewer as the other agent workspaces: HTML in a sandboxed iframe or as source, media inline, copy, download. |

## How it works

- **Agent Factory, On-device** posts to `/api/freeclaude/build`, which calls Ollama's `/api/chat` at the **Local Ollama URL** from the Ollama Cloud page's gear (`settings.ollama.localUrl`), else `OLLAMA_URL`, else `OLLAMA_HOST`, else `http://localhost:11434`. The model is the `MODEL=` value from `~/.fcc/.env` when it starts with `ollama/`, otherwise the model picked by `src/lib/localModel.ts`. If Ollama does not answer, the build fails with "local model not reachable".
- **Agent Factory, N2** calls OpenRouter directly. It needs `OPENROUTER_API_KEY` in `~/.hermes/.env` or `~/.fcc/.env` (or the environment). Without one it fails with a clear error. Token use is logged for the dashboard.
- Both engines use a fixed system prompt asking for one offline HTML file with no external resources. The route pulls the HTML out of the reply and refuses to save if there is none. Builds land in `~/freeclaude-scratch/free-claude-code/` (On-device) or `~/freeclaude-scratch/n2/` (N2); the history list is saved beside them as `.builds.json`. The scratch root can be moved with `AGENTIC_OS_FCC_SCRATCH`.
- **Chat** spawns the normal `claude` CLI with `--bare -p --output-format=stream-json --include-partial-messages --verbose`, with `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` pointed at `fcc-server` on port 8082. It runs in `~/freeclaude-scratch/<active project>/`. If the proxy is not listening, the route returns 503 and the reply tells you to start `fcc-server` in a terminal. Agent OS does not start it.
- The CLI is single-shot, so prior turns (last 24, about 8,000 characters) are packed into each prompt. The thread and active project are kept in browser localStorage (`agentic-os/freeclaude/history/v1`, `agentic-os/freeclaude/active-project/v1`).
