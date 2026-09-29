# Local Engine

Route: `/engine` · UI: `src/components/LocalHermesEngine.tsx` · Backend: `src/app/api/local-hermes/run`, `src/app/api/local-hermes/workspace`, `src/app/api/local-hermes/preview`

An offline agent that does real work on this machine. You give it a task, it runs the Hermes CLI under its `local` profile, and anything it writes lands in a workspace folder you can browse and preview on the right. It is the tool-using sibling of the Local chat module: it runs commands and writes files instead of only replying.

## Tabs and controls

The page is two panels side by side: the agent log on the left and "What it built" on the right.

### Agent log (left)

| Control | What it does |
|---|---|
| **Mic button** (VoiceButton) | Dictates into the task box. Final phrases are appended to what is already there. |
| **Task box** | Free text task. The placeholder reads "Give it a task, build a file, run a command, summarise a folder...". Ctrl+Enter (Cmd+Enter on Mac) runs it. |
| **Run** | Posts the task to `/api/local-hermes/run` and waits for the whole run to finish. A "working locally..." timer shows while it runs. Disabled while a run is in progress or the box is empty. |
| **Clear log** (trash icon, only shown once there are turns) | Asks "Clear the engine log?" and then wipes the local transcript. Files in the workspace are not touched. |
| **built ...** link under a reply | Shown when the run changed files. Opens the last file in the list in the right panel. |
| **no file was actually written** warning | Shown when the task looked like a build request (build, create, make, write, save, generate) but nothing on disk changed. |

### What it built (right)

| Control | What it does |
|---|---|
| **Refresh** (circular arrow) | Re-lists the workspace from `/api/local-hermes/workspace`. The list also refreshes after every run. |
| **File row** | Opens the file. HTML renders in a sandboxed iframe, images render inline, text files show their contents, other files show nothing useful. |
| **<- files** | Goes back to the file list. |
| **open** (HTML files only) | Opens the file in a new browser tab via `/api/local-hermes/preview/<path>`. |

## How it works

- Each run shells out to `hermes --profile local -z "<task>" --yolo --accept-hooks` with its working directory set to `~/.hermes/profiles/local/workspace`. `--yolo` means the agent does not stop to ask before running commands. The run times out after 6 minutes.
- Before and after each run the route snapshots the top level of the workspace by modification time. The `built` list is the files that are new or changed, so the "built" link reflects what is really on disk, not what the model claimed.
- The file list walks the workspace up to 4 folders deep and at most 200 files, skipping dot files, `node_modules`, `.git`, `.venv`, `__pycache__`, `.next` and `dist`. Text files are read up to 800 KB.
- The transcript lives only in your browser's localStorage (key `agentic-os/local-hermes/transcript/v1`, last 50 turns). It is not on the server.
- Needs: the `hermes` CLI on the PATH with a `local` profile set up, and Ollama running with that profile's model pulled. If a run produces no output, the reply shows the exit code and the tail of stderr.
- Which model answers is decided by the Hermes `local` profile, not by this page. The header text says "Gemma-4 12B Coder", while the route's comments and its no-output hint mention `llama3.1:8b`. Check the profile config if the label matters.
