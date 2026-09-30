# Codex

Route: `/codex` · UI: `src/components/CodexView.tsx`, `src/components/GoalLogStream.tsx` · Backend: `src/app/api/codex/` (`chat`, `goals`, `sessions`, `session`, `session-file`, `workspace`, `preview`), `src/lib/codexGoals.ts`, `src/lib/codexWorkspace.ts`

Drives OpenAI's Codex CLI (`codex`) from the dashboard. You can chat with it, hand it long-running goals that run unattended, read back any past Codex session from your terminal, and browse the files it wrote.

## Tabs and controls

The tab bar has **Chat**, **Goal Mode**, **Sessions** and **Workspace**. Goal Mode shows a count of running goals, Sessions and Workspace show their list sizes. A pill on the right shows the active project (default `codex-default`); chats write files there.

### Chat

| Control | What it does |
|---|---|
| **clear** | Empties the chat thread (only shown when idle and there are messages). No confirmation. |
| Message box | Ctrl/Cmd+Enter sends, Esc stops a running reply. |
| **Send** / **Stop** | Sends the prompt to `/api/codex/chat`, or aborts it. An elapsed-seconds counter shows while Codex works. |

### Goal Mode

| Control | What it does |
|---|---|
| **Title (optional)** | Goal name. If empty, the first line of the prompt is used. |
| Prompt box | What Codex should achieve. |
| **Launch goal** | Posts to `/api/codex/goals`, which starts `codex exec --json --full-auto` in the background in the goal's own folder. |
| **All goals** list | Every goal with its status (queued, running, completed, failed, stopped). Polls every 4 seconds while this tab is open. Refresh icon reloads. |
| **Stop** | Shown on a running goal. Stops the process and marks it stopped. |
| **Delete** | Stops the goal if running, then removes it. No confirmation. |
| **Live timeline** | The goal's log, re-read every 2.5 seconds while it runs. |

### Sessions

| Control | What it does |
|---|---|
| **Sessions** list | Your last 80 Codex sessions from `~/.codex/session_index.jsonl`, newest first. Refresh icon reloads. |
| Session detail | Header with the session's working folder (flagged if it no longer exists), then **Transcript** (user, assistant and reasoning turns, each cut at 1,800 characters), **Tool calls** (expand to see args and output), **Files in cwd**, and **Referenced in transcript**. |
| Click a file | Opens an inline preview: images, video, audio, PDF and HTML render in place; other text files link out. |
| **New tab**, **Save**, close (X) | Open the file in a new tab, download it, or close the preview. |

### Workspace

| Control | What it does |
|---|---|
| **Projects** list | Folders under `~/codex-scratch/`. Polls every 5 seconds while this tab is open. Refresh icon reloads. |
| `new-project-name` box + **Add** | Creates a new project folder and makes it the active project. |
| **Set active** | Makes that project the one chats write into. The active one is tagged **active**. |
| File list | Files in the selected project with kind, size and age. Click to open. |
| **Preview** / **Source** | For HTML files: sandboxed iframe or source view. |
| **New tab**, **Copy**, **Save**, close (X) | Open in a new tab (HTML), copy text content, download, or close. |

## How it works

- **Chat** spawns `codex exec --json --skip-git-repo-check --ignore-user-config <prompt>` in `~/codex-scratch/<active project>/` (root overridable with `AGENTIC_OS_CODEX_SCRATCH`) and streams the JSON events back. Each call is single-shot, so the route packs the last 24 turns (about 8,000 characters) into the prompt. Prompts over 16,000 characters are rejected.
- The chat thread and the active project are kept in browser localStorage (`agentic-os/codex/history/v1`, last 200 messages; `agentic-os/codex/active-project/v1`). Codex chat is not logged to the Obsidian vault.
- **Goals** are stored in `~/.agentic-os/codex-goals.json`, with logs in `~/.agentic-os/codex-goal-logs/`. Each goal runs in `~/codex-scratch/<goal id>/`. The process is detached, so it keeps running if you leave the page.
- **Sessions** are read-only views of Codex's own files under `~/.codex/` (`session_index.jsonl`, `sessions/`, `archived_sessions/`). Files are served through `/api/codex/session-file/`, which only serves paths under your home folder. The session reply includes the server's home folder, so previews work for Windows drive-letter paths as well as POSIX ones.
- Needs the `codex` CLI installed and logged in. It is found via `AGENTIC_OS_CODEX_BIN`, `codex` in `~/.agentic-os/config.json`, or `codex` on the PATH. Goal Mode returns "codex CLI not installed" when none is found.
- `--ignore-user-config` means both chat and goals skip your `~/.codex` config file (plugins, MCP servers, profile defaults). The chat's intro text says it uses "your default Codex profile", which that flag contradicts.
