thread_id: 019efd0a-0202-78d3-95e7-9423f7981e98
updated_at: 2026-06-25T04:29:12+00:00
rollout_path: C:\Users\Yoshi\.codex\archived_sessions\rollout-2026-06-24T21-29-12-019efd0a-0202-78d3-95e7-9423f7981e98.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# Built cc-g2-win MVP and fixed dev startup; QR generation still missing.

Rollout context: Windows/Android EvenHub + Claude Code-only MVP, separate from IRIS, with local faster-whisper, LAN default, full agentic Claude CLI, and a 15-20 min keepalive if glasses disconnect.

## Task 1: Build cc-g2-win MVP
Outcome: partial

Preference signals:
- The user said: "This will be separate from the IRIS app, and will be claude code only" and "I want full claude code invocation" -> future runs should treat this as a hard scope boundary: no multiprovider/IRIS integration, and use the full agentic Claude CLI path by default.
- The user said: "Let's use local faster-whisper. Especially if it doesn't take up much VRAM" -> local STT is preferred over ElevenLabs unless they explicitly override.
- The user said: "Your default is fine. Eventually I'll set up a tunnel but right now i Just need an MVP" -> default to LAN-first / no tunnel for initial delivery.
- The user said: "if the glasses lose connection, keep claude alive for 15-20 minutes" -> future implementations should preserve the Claude session after disconnect rather than exiting immediately.

Key steps:
- The agent fetched the reference repo docs and SDK, confirming the EvenHub plugin is a WebView app on Android, audio is 16kHz PCM, and output is text-only via `textContainerUpgrade`.
- The agent checked `even-toolkit` internals to get the glass gesture/action event types.
- The agent inspected the reference backend stream-json handling, then wrote a new Windows-targeted project under `C:\Users\Yoshi\.agent_even\cc-g2-win` with `backend/` (FastAPI WebSocket server, faster-whisper STT, Claude CLI session handling) and `plugin/` (EvenHub TypeScript HUD + audio/ws/display code), plus `dev.ps1`.
- The agent fixed an audio bug so `audio_end` is sent after the binary PCM chunk, and simplified the `handleServerEvent` type signature in `plugin/src/main.ts`.
- The agent saved project memory files under `.claude\projects\C--Users-Yoshi--agent-even\memory\`.

Failures and how to do differently:
- QR sideload flow was promised in the walkthrough but not actually present at the end of the rollout; the user later asked "Where is the QR at?" and the agent admitted it had not been generated yet.
- The first `dev.ps1` behavior was wrong: it exited too early / hid output. The agent then rewrote it so backend and plugin open in separate PowerShell windows and the main window stays alive with a heartbeat and restart logic.
- The user’s final question "Does it save it anywhere?" was unanswered before the rollout ended, so persistence/retention of the session state remained unverified in this extract.

Reusable knowledge:
- The reference SDK facts used for this build were: no speaker on the G2, audio arrives as 16kHz PCM in the WebView, and plugin output is text-only via `textContainerUpgrade`.
- The project was created in `C:\Users\Yoshi\.agent_even\cc-g2-win` and the main launch command is `.dev.ps1` (the user explicitly asked whether it was the same command and was told to use `dev.ps1`, not `dev-ps1`).
- The backend install/debug guidance in this rollout suggested running pip directly inside `backend` when deps seemed stuck on "syncing python deps".

References:
- [1] User requirements: "separate from the IRIS app", "claude code only", "full claude code invocation", "keep claude alive for 15-20 minutes", "Let's use local faster-whisper"
- [2] Build root: `C:\Users\Yoshi\.agent_even\cc-g2-win`
- [3] Files written: `backend/requirements.txt`, `backend/.env.example`, `backend/stt.py`, `backend/session.py`, `backend/main.py`, `plugin/app.json`, `plugin/package.json`, `plugin/tsconfig.json`, `plugin/vite.config.ts`, `plugin/index.html`, `plugin/src/audio.ts`, `plugin/src/ws.ts`, `plugin/src/display.ts`, `plugin/src/main.ts`, `dev.ps1`
- [4] Bugfix note: "audio_end must come after the binary, not before"
- [5] User feedback: "Ok it's up and working, with the dual terminal windows. Buit still no QR code" followed by an interrupted request and "Does it save it anywhere?"

## Task 2: Dev startup / QR / persistence follow-up
Outcome: partial

Preference signals:
- When the user asked "Where is the QR at? And is it supposed to shutdown right away?" they were implicitly expecting the setup walkthrough to match the delivered script, and wanted the startup behavior fixed rather than explained abstractly.
- When the user asked "Do I need to reset the .env? It's not moving past \"syncing python deps\"" they wanted runtime troubleshooting guidance without unnecessary config churn; the agent responded that `.env` reset was not needed and to inspect pip directly.

Key steps:
- The agent added `qrcode` to backend requirements and rewrote `dev.ps1`.
- The agent explained that the new script should show an ASCII QR in the terminal for `http://<your-ip>:5173`, while the main, backend, and plugin windows each handle their own logs.
- The agent advised checking dependency installation directly with `backend\.venv\Scripts\pip install -r requirements.txt` when the quiet sync looked stuck.

Failures and how to do differently:
- The QR generation was still not present when the user asked about it, so future runs should not mention QR sideloading until the script actually emits or serves one.
- The user’s final "Does it save it anywhere?" suggests persistence should be made explicit in the first pass: where session state, token, and project memory are written, and whether they survive restart/disconnect.

Reusable knowledge:
- `dev.ps1` was the correct launch entrypoint; the user explicitly confirmed the filename format question.
- The debug path for stuck Python deps was to run pip without the quiet wrapper so real install errors are visible.

References:
- [1] Commands mentioned: `.dev.ps1`, `cd C:\Users\Yoshi\.agent_even\cc-g2-win\backend`, `.\.venv\Scripts\pip install -r requirements.txt`
- [2] The rollout ended with an unresolved QR gap and an unanswered persistence question, so these are still open follow-ups rather than completed deliverables.
