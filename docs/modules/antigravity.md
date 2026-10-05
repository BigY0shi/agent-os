# Antigravity

Route: `/antigravity` · UI: `src/components/AntigravityView.tsx`, `src/components/UnifiedChat.tsx` · Backend: `src/app/api/antigravity/` (`chat`, `workspace`, `workspace/file`, `workspace/raw`, `preview`), `src/lib/antigravityWorkspace.ts`

Chat with Google's Antigravity CLI (`agy`, the successor to the Gemini CLI) and browse the files it produced. The Gemini CLI agent was removed from Agent OS after Google retired it; this module replaces it.

## Tabs and controls

Two pill tabs at the top: **Chat** and **Workspace files** (with a count of projects).

### Chat

This is the shared chat panel, locked to Antigravity.

| Control | What it does |
|---|---|
| **Logged · <time>** | Appears after a reply. Links to `/memory`. See the note below about logging. |
| **Clear** | Asks for confirmation, then empties the thread. |
| Mic button | Voice input into the message box. |
| Message box | Ctrl/Cmd+Enter sends, Esc stops. |
| **Send** / **Stop** | Sends the prompt to `/api/antigravity/chat`, or aborts the wait. A seconds counter shows while it works, with a "slow model" note after 30 seconds. |

Antigravity does not stream, so the whole reply arrives at once (the footer says 10 to 90 seconds is normal).

### Workspace files

| Control | What it does |
|---|---|
| **Refresh** | Reloads the project list. The list also re-polls every 8 seconds while this tab is open. |
| **Projects** list | Folders from `~/.gemini/antigravity-cli/scratch` (tagged **scratch**) and `~/.gemini/antigravity-cli/brain` (tagged **brain**, name shortened to 8 characters), with file count and age. |
| **path** | Copies the selected project's full folder path. |
| File list | Files with kind, size and age. Click to preview. Files of unknown binary type are greyed out and cannot be opened. |
| **Preview** / **Source** | For HTML files: render in a sandboxed iframe (served by path so relative assets load), or show source. |
| **New tab** | Opens the HTML preview in a new tab. |
| **Copy** / **Save** | For text: copy content, or save it as a file. For media: **Save** downloads the raw file. |
| Close (X) | Closes the preview. |

Images, video, audio and PDF preview inline. Text files over 1 MB show only the first 1 MB with a warning.

## How it works

- Each send runs `agy -p "<prompt>"` once through `/api/antigravity/chat`, with a 5 minute timeout, in your home folder. The route strips terminal colour codes from the output. If there is no output, it returns a diagnostic instead: either that it was killed at the time limit, or the exit code plus the last 4,000 characters of stderr.
- `-p` is single-shot, so the route packs the last 24 turns (about 8,000 characters) into the prompt. Prompts over 32,000 characters are rejected. The route supports a `dangerouslySkipPermissions` flag, but this page never sends it.
- The thread is stored in browser localStorage under `agentic-os-chat-v2:antigravity` (last 50 messages).
- The Workspace tab only reads Antigravity's own folders under `~/.gemini/antigravity-cli/`. It shows work even when the chat reply was lost to an error mid-task.
- Needs the `agy` CLI installed and signed in. It is found via `AGENTIC_OS_ANTIGRAVITY_BIN`, `antigravity` in `~/.agentic-os/config.json`, or `agy` on the PATH.
- Each reply is logged to the Obsidian vault through `/api/memory/log` (which accepts `antigravity`). The chat shows **Logged** only when that request succeeds; if it fails (for example no vault is configured, a 503), the footer says "Not logged to Obsidian" with the reason.
