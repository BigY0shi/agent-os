# OpenMontage

Route: `/openmontage` · UI: `src/components/OpenMontageStudio.tsx`, `src/components/OpenMontageSettings.tsx` · Backend: `src/app/api/openmontage/`, `src/lib/v2/openmontage/`

Your own checkout of OpenMontage, the open-source agentic video production system, wrapped as an Artist's Corner module. The page lists the pipelines in the checkout, takes a brief, and starts the pipeline as a module run: your CLI agent works inside the checkout, every step shows in the runs tray, and the rendered files are listed when it ends.

## Tabs and controls

One page, no tabs.

| Control | What it does |
|---|---|
| Environment strip | One chip per check: **Checkout**, **Python**, **Dependencies**, **Agent**, **Output dir**. A red chip is explained below the strip with the exact command to run. Nothing is installed from this page. |
| Reload icon | Reads the checkout, the checks and the project list again. |
| **Preflight** | Runs OpenMontage's own tool registry report (`make preflight` in its Makefile) with the configured python, as a module run. Shows which tools are usable with the keys and binaries in the checkout. |
| **Configure** | The gear. **Repo path** (empty = `~/Documents/OpenMontage`), **Python executable** (default `python`; on Windows never `python3`), **Output directory** (empty = `<repo>/projects`, which is what the Backlot board watches), **CLI agent** (claude, codex, cursor or hermes; default claude), **Fallback agent** (**Codex** or **None**), **Run timeout** in minutes (default 90). **Save** writes them to settings. |
| Pipeline list | Every `*.yaml` in the checkout's `pipeline_defs/`: name, category, stability, description, stage count and the manifest's default budget. A manifest that does not parse is named under the list, not dropped. |
| Brief box | What to make. The selected pipeline's stages are shown above it. |
| **Project id** | Auto-filled from the brief plus the date; editable. Lowercase letters, digits, `-` and `_`. The project folder is `<output dir>/<project id>/`. |
| **Run pipeline** | Posts to `/api/openmontage/run`. Disabled while a run is in flight. A missing checkout, python or dependency refuses the start with the fix. |
| Run card | Status, the log lines (the same events the runs tray shows), **STOP** while running, the error if any, who actually ran it when the fallback was used, and the rendered files found under the project folder when it ends. |
| Projects | Project folders under the output directory, newest first, with their checkpoints and rendered files. |

## How it works

- OpenMontage has no Python entry point for a pipeline. Its `AGENT_GUIDE.md` (Rule Zero) and `docs/ARCHITECTURE.md` say the coding agent is the orchestrator and Python is tools plus checkpoints. So a run is the configured CLI started inside the checkout with a prompt that names the manifest, the project id and the brief, the way you would type it into Claude Code there. The prompt tells the agent the run is unattended: choose at approval gates and log the decision, prefer free and local tools, stay under the manifest's budget, never install anything, and print `MISSING: <command>` if a dependency is absent.
- Claude runs with `--output-format stream-json`, so each turn's text and tool calls become tray lines as they happen. The other CLIs log their raw output lines.
- The fallback (rule 20) is used only when the chosen CLI cannot start (not installed, spawn error) and only if the gear names one. A CLI that started and then failed is a failed run. The run result carries `agent`, `fellBackFrom` and `fallbackReason`.
- Python is used for two things: the dependency check (imports `yaml`, `pydantic`, `jsonschema`, `dotenv`, the core block of `requirements.txt`) and Preflight. A missing package is reported with `"<python>" -m pip install -r "<repo>/requirements.txt"`; you run it.
- Runs are module runs (`src/lib/moduleRuns.ts`): they survive leaving the page, the tray shows them, STOP kills the child, and the page polls `/api/runs/<id>`.
- Rendered files are whatever media lands under the project folder (`renders/` first), listed with sizes. The page does not serve or play them; open the folder.
- Settings keys: `openmontage.repoPath`, `openmontage.pythonBin`, `openmontage.outputDir`, `openmontage.agent`, `openmontage.fallbackAgent`, `openmontage.timeoutMin`.

## Known gaps

- Approval gates in a pipeline (`human_approval_default: true`) are decided by the agent, because nobody is in the chat. Use the Backlot board in the checkout (`python -m backlot open <project-id>`) when you want to approve stages yourself.
- Paid providers are not blocked, only discouraged by the prompt: a key already in the checkout's `.env` is usable by the agent.
- Narration is whatever TTS the checkout can reach; the Kokoro voice used elsewhere in Agent OS is not wired into OpenMontage yet.
