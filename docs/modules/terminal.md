# Terminal

Route: `/terminal` · UI: `src/components/TerminalView.tsx` · Backend: `src/lib/ptySessions.ts`, `src/app/api/terminal/route.ts`, `src/app/api/terminal/stream/route.ts`

A real shell on the machine that hosts Agent OS, in the browser. It runs as the same Windows user as the server, so you can re-authenticate a CLI (`claude`, then `/login`), read a log or restart a service from any device that can open the dashboard. Interactive programs work because the shell runs in a real pseudo-terminal.

## Tabs and controls

| Control | What it does |
|---|---|
| Session line (next to the title) | Shows the shell name, its process id and its starting folder. |
| **New** | Kills the current shell, clears the screen and starts a fresh one. |
| **Reconnect** | Reattaches the output stream to the current shell. Use it when the page says "Output stream closed. Try Reconnect." |
| **Kill** | Ends the current shell. The terminal stays on screen but nothing is connected until you press **New**. |
| Terminal area | Click to focus, then type. Resizing the window resizes the shell. 5000 lines of scrollback. |

## How it works

- The server starts the shell with `node-pty` (ConPTY on Windows). It picks PowerShell 7 (`pwsh`) if installed, then Windows PowerShell, then `cmd.exe`, and starts in your user profile folder.
- Output streams to the page over Server-Sent Events from `/api/terminal/stream`. Keystrokes go up as small POSTs to `/api/terminal` (actions `create`, `input`, `resize`, `kill`), batched every few milliseconds so they stay in order. The app runs under `next start`, which has no WebSocket upgrade, hence this split.
- The session id is kept in browser localStorage, so leaving the page and coming back reattaches to the same shell. The server keeps the last 256 KB of output and replays it on reattach.
- Shells live in the server process. Restarting Agent OS ends every shell. At most 8 can be open at once.
- There is no extra permission check beyond the dashboard's password gate in `src/proxy.ts`. Anyone signed in to the dashboard has a shell as the host user.
