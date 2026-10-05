# Loop

Route: `/loop` · UI: `src/components/LoopView.tsx` · Backend: `src/app/api/loop/` (`run`, `builds/[[...path]]`), `src/lib/loopEngine.ts`, `src/lib/loopModels.ts`

A build-and-grade loop that runs on your CLI agents only. You write a definition of done, a Builder CLI agent makes the thing, a separate Judge grades it out of 100, and the loop repeats with the judge's issues until the judge passes it, progress stalls, or the round cap is hit. It works for anything text-based; HTML builds get a live preview.

## Tabs and controls

One page: the cycle strip, the config panel, the builds workspace, the result, the rounds, and the current artifact.

### Config

| Control | What it does |
|---|---|
| **Configure** (gear, "Loop settings") | **Default builder**, **Default judge**, **Judge fallback** (None, or Ollama Cloud), **Ollama Cloud model** (blank = picked from your account: Kimi K2.6, then MiniMax M3, then GLM), **Default max rounds** (2 to 8), **Builder time limit** and **Judge time limit** in seconds. Saved to the `loop` section of `~/.agentic-os/settings.json` and read on every run. |
| Cycle strip | Static: 1 Check state, 2 Decide, 3 Act, 4 Gather feedback, 5 Verify / terminate. Not clickable. |
| **Definition of done** | The goal. Required to run. |
| **Starting point** | Optional draft to refine. Leave blank to build from scratch. |
| **Builder** | The CLI agent that builds. Groups: "Your CLI agents · no API key" (the installed ones among Claude, Codex, Cursor, Pi, Hermes) and "Other CLI agents" (the rest of those five). Default is the Claude CLI. |
| **Max rounds** | 2 to 8, default 4. |
| **Judge** | The grader. Groups: your CLI agents and "Other CLI agents + Ollama Cloud" (the rest of the five CLI agents, plus Ollama Cloud). Default is the gear's Default judge (Claude CLI unless changed). Codex is a good independent critic. |
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
| **Round N** cards | Step chips (check state, build, verify) with a spinner on the active one, then **PASSED** or **rejected** with the score out of 100, the judge's summary and its list of issues. |
| **Preview** / **Code** | Shown when the artifact contains HTML: render it in a sandboxed iframe, or show the text. |
| **Open** | Opens the HTML in a new tab (a temporary blob URL). |
| **Save** | Downloads the HTML as `loop-build.html`. |
| **Copy** | Copies the HTML, or the plain text if there is no HTML. |

The artifact panel is titled "Work in progress" while running and "Final result" when done.

## How it works

- `POST /api/loop/run` streams NDJSON. Each round: the Builder produces the artifact; if it is HTML, the server opens it in a headless Chrome and auto-rejects it (score 0) on JS errors or a blank render; then the Judge grades it. Two rounds without a higher score stops the loop as stalled.
- The headless browser is Playwright's `chrome-headless-shell`, looked up in `%LOCALAPPDATA%\ms-playwright` on Windows. If it is not installed, the render check is skipped and does not block the round.
- CLI only: the Builder and Judge run on your own CLI logins, no API keys. The Judge may also be Ollama Cloud (the key and host from the Ollama Cloud page's gear, else `OLLAMA_API_KEY` and `https://ollama.com`; there is no local Ollama). Any other id (an OpenRouter, Nous Portal or MiniMax model) is refused with a clear error before a round runs. An older saved "local" judge is read as Ollama Cloud.
- If a CLI judge fails or returns nothing usable, what happens is the gear's **Judge fallback**: **None** (the default) fails the round with the reason; **Ollama Cloud** grades it instead, the first issue says "Graded by the Ollama Cloud fallback judge (your Loop setting), not <judge>", and the result banner credits the fallback. If the fallback fails too, the round fails naming both reasons.
- Every run is logged as Markdown to your Obsidian vault under `Agentic OS/Loops/`, or to `~/.agentic-os/loop-runs/` when no vault is configured.
- Only passed HTML builds are saved, to `~/.agentic-os/loop-builds/<slug>.html`, and served back through `/api/loop/builds/...` for the workspace.
