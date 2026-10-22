# Cursor

Route: `/cursor` · UI: `src/components/CursorView.tsx` · Backend: `src/app/api/cursor/chat/route.ts`, `src/lib/runner.ts`

A plain chat window for Cursor's agent CLI (`cursor-agent`), running on your own Cursor subscription. There is no API key involved: the CLI uses whatever account you signed in with in a terminal.

## Tabs and controls

The page has a single chat panel, no tabs.

| Control | What it does |
|---|---|
| Message box | Type a prompt. Ctrl/Cmd+Enter sends. |
| **Send** | Posts the prompt and the prior turns to `/api/cursor/chat` and streams the reply in. While it waits, the bubble reads "Cursor is working...". |
| **Stop** | Aborts the request. The server kills the CLI process when the stream is cancelled. |
| Trash icon ("Clear history") | Shown once there are messages. Asks for confirmation, then empties the thread. |

Errors (for example, the CLI is not signed in) show as a red note under the messages.

## How it works

- Each send spawns `cursor-agent -p "<prompt>" --output-format stream-json --stream-partial-output --force --trust` in `~/.agentic-os/workspaces/cursor/` (created on first use). Only the streamed text deltas are forwarded, so the final consolidated message is not shown twice; if nothing streamed, the final `result` text is used.
- `--force` lets the agent run commands and edit files without asking. Anything it writes lands in `~/.agentic-os/workspaces/cursor/`. There is no workspace browser on this page.
- The CLI is single-shot, so the route packs up to the last 24 turns (about 8,000 characters) into each prompt. Prompts over 16,000 characters are rejected.
- The thread is stored in browser localStorage under `agentic-os/cursor/history/v1` (last 200 messages). It is not logged to the Obsidian vault.
- Needs the Cursor CLI installed and signed in with `cursor-agent login`. The binary is found via `AGENTIC_OS_CURSOR_BIN`, `cursor` in `~/.agentic-os/config.json`, `cursor-agent` on the PATH, or common install folders. On Windows the runner starts Cursor's bundled `node.exe` with its `index.js` directly (it picks the newest folder under `versions/`), so a Cursor self-update does not break it.
- If the CLI exits with no output and its error text mentions login or auth, the reply says "Cursor isn't signed in" and tells you to run `cursor-agent login`.
- The route accepts an optional `model` field, but this page never sends one, so Cursor's default model is used.
