# Pi

Route: `/pi` · UI: `src/components/PiView.tsx` · Backend: `src/app/api/pi/chat/route.ts`, `src/lib/runner.ts`

A plain chat window for the Pi coding CLI (`pi`, the npm package `@mariozechner/pi-coding-agent`). Pi is set up to use a model on Ollama Cloud, so no API key is stored in Agent OS.

## Tabs and controls

The page has a single chat panel, no tabs. The header reads "pi CLI · Ollama glm-5.2:cloud · no API key".

| Control | What it does |
|---|---|
| Message box | Type a prompt. Ctrl/Cmd+Enter sends. |
| **Send** | Posts the prompt and the prior turns to `/api/pi/chat` and streams the reply in. While it waits, the bubble reads "Pi is working...". |
| **Stop** | Aborts the request. The server kills the CLI process when the stream is cancelled. |
| Trash icon ("Clear history") | Shown once there are messages. Asks for confirmation, then empties the thread. |

Errors show as a red note under the messages.

## How it works

- Each send spawns `pi -p "<prompt>" --mode text --no-session --no-context-files` in `~/.agentic-os/workspaces/pi/` (created on first use). Pi prints plain text, and the route forwards stdout as it arrives.
- `--no-session` keeps every call separate, so the route packs up to the last 24 turns (about 8,000 characters) into each prompt. `--no-context-files` stops Pi from reading `AGENTS.md` or `CLAUDE.md` files in the folder. Prompts over 16,000 characters are rejected.
- The model is whatever Pi itself is configured to use (check with `pi --list-models`). The header says so rather than naming a model it cannot see. The route accepts an optional `model` field; this page never sends one.
- The thread is stored in browser localStorage under `agentic-os/pi/history/v1` (last 200 messages). It is not logged to the Obsidian vault.
- Needs the `pi` CLI installed and able to reach its model (Ollama signed in). The binary is found via `AGENTIC_OS_PI_BIN`, `pi` in `~/.agentic-os/config.json`, `pi` on the PATH, or `~/AppData/Roaming/npm/pi.cmd` / `~/.local/bin/pi`. If none is found, the send fails with "pi is not installed or not configured". On Windows the npm `.cmd` shim is resolved to its Node entry file and run directly.
- If Pi exits with no output and its error mentions an API key, provider, login or Ollama, the reply says "Pi couldn't reach its model" and shows the tail of the error.
