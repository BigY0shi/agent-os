# Loop

Route: `/loop` · UI: `src/components/LoopView.tsx` · Backend: `src/app/api/loop/` (`run`, `builds/[[...path]]`, `nous-models`), `src/lib/loopEngine.ts`, `src/lib/loopModels.ts`

A build-and-grade loop. You write a definition of done, a Builder model makes the thing, a separate Judge grades it out of 100, and the loop repeats with the judge's issues until the judge passes it, progress stalls, or the round cap is hit. It works for anything text-based; HTML builds get a live preview.

## Tabs and controls

One page: the cycle strip, the config panel, the builds workspace, the result, the rounds, and the current artifact.

### Config

| Control | What it does |
|---|---|
| Cycle strip | Static: 1 Check state, 2 Decide, 3 Act, 4 Gather feedback, 5 Verify / terminate. Not clickable. |
| **Definition of done** | The goal. Required to run. |
| **Starting point** | Optional draft to refine. Leave blank to build from scratch. |
| **Builder** | The model that builds. Groups: "Your CLI agents · no API key" (installed CLI agents among Claude, Codex, Cursor, Pi, Hermes), "Free" (Claude CLI, Codex CLI, Cursor CLI, Hermes CLI, N2 and GLM 5.2 via OpenRouter), and "Nous Portal" models when you are logged in. Default is the Claude CLI. |
| **Max rounds** | 2 to 8, default 4. |
| **Judge** | The grader. Groups: your CLI agents, "Free + paid" (Claude CLI, Codex CLI, Local Ollama, N2, Fusion council), and Nous Portal models. Default is the Claude CLI. |
| **Run loop** / **Stop** | Starts the loop, or aborts it. Stopping ends with "Stopped by you." |

### Builds workspace

Shown once at least one build is saved.

| Control | What it does |
|---|---|
| Build tiles | Scaled-down live previews with name, age and size. Click one to open a full preview below; click again to close it. |
| **Open** | Opens the selected build in a new tab. |
| Refresh icon | Reloads the list. |

### Rounds and result

| Control | What it does |
|---|---|
| Result banner | The stop reason, for example "<judge> approved on round N", "No progress for 2 rounds", or "Reached the N-round cap without a clean pass." |
| **Round N** cards | Step chips (check state, build, Fusion verify) with a spinner on the active one, then **PASSED** or **rejected** with the score out of 100, the judge's summary and its list of issues. |
| **Preview** / **Code** | Shown when the artifact contains HTML: render it in a sandboxed iframe, or show the text. |
| **Open** | Opens the HTML in a new tab (a temporary blob URL). |
| **Save** | Downloads the HTML as `loop-build.html`. |
| **Copy** | Copies the HTML, or the plain text if there is no HTML. |

The artifact panel is titled "Work in progress" while running and "Final result" when done.

## How it works

- `POST /api/loop/run` streams NDJSON. Each round: the Builder produces the artifact; if it is HTML, the server opens it in a headless Chrome and auto-rejects it (score 0) on JS errors or a blank render; then the Judge grades it. Two rounds without a higher score stops the loop as stalled.
- The headless browser is Playwright's `chrome-headless-shell`, looked up in `%LOCALAPPDATA%\ms-playwright` on Windows. If it is not installed, the render check is skipped and does not block the round.
- Keys: CLI seats use your own CLI logins. OpenRouter models need `OPENROUTER_API_KEY`, either in the environment or in a Hermes profile `.env` under `~/.hermes/`. Nous Portal models need `NOUS_API_KEY` or a Nous login in `~/.hermes/auth.json` (run `hermes portal`). The run refuses to start with a clear error if the chosen seat's key is missing.
- If the chosen judge fails or returns nothing usable, the local Ollama model (`127.0.0.1:11434`) grades instead, and the first issue says "Graded by the LOCAL fallback judge, not <judge>". If Ollama is also unavailable, the round fails with that reason.
- Every run is logged as Markdown to your Obsidian vault under `Agentic OS/Loops/`, or to `~/.agentic-os/loop-runs/` when no vault is configured.
- Only passed HTML builds are saved, to `~/.agentic-os/loop-builds/<slug>.html`, and served back through `/api/loop/builds/...` for the workspace.
