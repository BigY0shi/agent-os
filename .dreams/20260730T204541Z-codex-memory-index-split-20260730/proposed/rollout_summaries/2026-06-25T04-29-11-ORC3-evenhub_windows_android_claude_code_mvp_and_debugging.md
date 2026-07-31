thread_id: 019efd09-fef7-7743-be94-fe6b320b3cfb
updated_at: 2026-06-25T04:29:11+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fef7-7743-be94-fe6b320b3cfb.jsonl
cwd: \\?\C:\Users\Yoshi\.agent_even

# Custom Claude Code CLI app for Even Realities G2 on Windows/Android, with iterative debugging of networking, gesture handling, STT, session persistence, and HUD layout

Rollout context: The user needed a custom Claude Code–driven EvenHub app for Even Realities G2 that works with an Android phone and a Windows machine (not the built-in even-terminal, and not the macOS/iPhone-oriented reference apps). The goal evolved into an MVP with local faster-whisper STT on a Windows backend, full agentic Claude CLI invocation, and session continuity when the glasses/phone disconnect. The rollout included extensive inspection of the reference repo `sam-siavoshian/claude-code-g2`, the EvenHub SDK docs, and many iterative code changes in `C:\Users\Yoshi\.agent_even\cc-g2-win`.

## Task 1: Assess reference repo / even-terminal safety and architecture

Outcome: success

Preference signals:
- The user repeatedly clarified they were *not* using the repo’s even-terminal path and instead wanted to build their own Windows/Android architecture first: "I have windows and an android. So I need to build a full claude code CLI terminal app for the Even Realities G2."
- The user preferred a Claude-only architecture, not multiprovider: "no, not multiprovider. This will be separate from the IRIS app, and will be claude code only."
- The user wanted full agentic CLI, not chat-only: "I want full claude code invocation."

Key steps:
- Inspected the GitHub repo metadata and README, confirming it is a legitimate public MIT-licensed project for running Claude Code on G2 glasses, but targeted at macOS + iPhone with a local backend and tunnel-based URL generation.
- Read reference backend/frontend files, especially `backend/src/auth.ts`, `backend/src/index.ts`, `backend/src/sessions/claudeProc.ts`, `frontend/src/audio.ts`, `frontend/src/glass/AppGlasses.tsx`, `frontend/src/glass/selectors.ts`, and `frontend/app.json`.
- Confirmed the reference app uses a local backend, bearer token auth, SSE/stream-json, and `claude` CLI subprocesses with `--dangerously-skip-permissions`.

Failures and how to do differently:
- None material here; the repo inspection succeeded.

Reusable knowledge:
- The reference repo’s frontend is a WebView-based EvenHub app; the backend is local, not a third-party service.
- The G2 SDK and reference app use 16kHz PCM audio from `audioEvent.audioPcm` and stream-json Claude CLI output.
- The reference repo’s `dev.sh` prints/generated URLs and uses a tunnel/local IP model rather than a fixed cloud backend.

References:
- Repo metadata: description "Run Claude Code from your Even Realities G2 AR glasses. Voice-first, hands-free, billed against your Claude Max subscription."
- Files inspected: `backend/src/index.ts`, `backend/src/auth.ts`, `backend/src/sessions/claudeProc.ts`, `frontend/src/audio.ts`, `frontend/src/glass/AppGlasses.tsx`, `frontend/src/glass/selectors.ts`, `frontend/app.json`.

## Task 2: Build Windows/Android EvenHub Claude Code MVP and debug it step-by-step

Outcome: partial

Preference signals:
- The user wanted a Windows + Android solution, not macOS/iPhone: "all of the claude code apps use a mac and iphone. I have windows and an android."
- The user wanted local faster-whisper if it fit the GPU: "Let's use local faster-whisper. Especially if it doesn't take up much VRAM."
- The user wanted a quick MVP first, tunnel later: "Eventually I'll set up a tunnel but right now i Just need an MVP."
- The user wanted the Claude subprocess to stay alive after disconnection: "if the glasses lose connection, keep claude alive for 15-20 minutes."
- The user later confirmed a specific UX flow: tap to record, tap to review, tap again to send, double tap to erase and re-record.
- The user explicitly wanted session recovery: "I need a way to resume sessions. I keep getting disconnected or kicked off or osmething."

Key steps:
- Built a new project under `C:\Users\Yoshi\.agent_even\cc-g2-win` with a Python FastAPI backend and an EvenHub plugin frontend.
- Verified EvenHub SDK constraints from `@evenrealities/even_hub_sdk` and `even-toolkit`, including:
  - G2 audio is 16kHz 16-bit little-endian PCM.
  - gesture mapping in the reference app treats `CLICK_EVENT` as tap, `DOUBLE_CLICK_EVENT` as back/cancel, and scroll events as up/down.
  - real hardware tap events may arrive as `eventType = 0` or `null`.
- Confirmed `even-toolkit` exposes raw gesture handling and that the reference app already collapses tool calls, supports text-only HUD rendering, and uses event capture containers.
- Implemented/iterated through multiple fixes: QR generation, Tailscale/LAN URL handling, websocket reconnection, local STT, session persistence, and display formatting.
- Verified the backend and plugin with `python -c ast.parse(...)` and `./node_modules/.bin/tsc -b`, catching some type issues and then resolving them.

Failures and how to do differently:
- The initial `dev.ps1` behavior caused confusion because it opened windows and then the build vanished; the user needed the process/windows to be visible and stable.
- The original QR generation approach failed silently; a dedicated Python helper script was added later.
- The first IP detection picked a WSL/virtual adapter (`172.22.x.x`) instead of a reachable IP; it was later corrected to use the actual LAN/Tailscale IP.
- The app initially cleared the HUD too aggressively on taps, making it appear broken when recording started.
- The first STT path returned "Nothing heard" because VAD was too aggressive; it was disabled.
- The first session resume path returned "Session expired" because the in-memory backend session did not survive restarts; the plugin was updated to clear stale session IDs and the backend was updated to auto-restore/resume.

Reusable knowledge:
- The G2 SDK docs and `even-toolkit` package are enough to implement real bordered text containers, mic capture, and event handling; no camera/speaker exists on the glasses.
- `audioEvent.audioPcm` is the authoritative raw audio source; it is 16kHz PCM.
- `OsEventTypeList.CLICK_EVENT` may come through as `0`/`null` on real hardware, so tap handlers must accept those cases.
- The Claude CLI rejects invalid session IDs; a proper UUID is required for `--session-id`.
- The session transcript persists on disk under `~/.claude/projects/.../*.jsonl`, so `--resume` can be used after backend restarts if the backend reattaches correctly.
- The user’s environment has Tailscale already installed on both devices, which is the preferred non-LAN access path.

References:
- Working directory: `C:\Users\Yoshi\.agent_even\cc-g2-win`
- Frontend files touched: `plugin\src\main.ts`, `plugin\src\display.ts`, `plugin\src\ws.ts`, `plugin\index.html`
- Backend files touched: `backend\main.py`, `backend\session.py`, `backend\stt.py`, `backend\requirements.txt`, `backend\gen_qr.py`
- Diagnostic evidence:
  - `Error: Invalid session ID. Must be a valid UUID.` when `--session-id` used a 16-char hex string.
  - `Nothing heard` from STT when VAD was too aggressive.
  - Uvicorn logs showing 404 spam were traced to the local dev stack, not an external service.
  - `ls ~/.claude/projects/.../*.jsonl` confirmed transcript persistence on disk.

## Task 3: Fix UI/layout, gesture flow, and session resume architecture

Outcome: partial

Preference signals:
- The user wanted a more spatial conversation layout: messages on the left, Claude responses on the right.
- The user said the current top rule was too long and the panel sizing was wrong, asking for a box or real border instead of purely ASCII lines.
- The user wanted a safer send flow: "tap once to record, tap again to transcribe and review, tap a third time to send or double tap to erase message and record again."
- The user wanted automatic recovery from disconnects and the ability to resume sessions without losing context.
- The user accepted a one-bordered transcript with calibration on the glasses and auto-restore plus session list when offered explicit layout/session choices.

Key steps:
- Read `plugin/src/display.ts` and confirmed the current renderer was an ASCII/monospace text buffer with constants like `COLS = 38`, `BUBBLE = 30`, and a fixed number of visible lines.
- Read the SDK type definitions and confirmed `TextContainerProperty` supports real borders (`borderWidth`, `borderColor`, `borderRadius`, `paddingLength`) and that `CreateStartUpPageContainer`/`TextContainerUpgrade` now require `toJson()`-capable SDK classes.
- Confirmed the backend transcript lives on disk and can be resumed with `--resume`; the issue was in the app’s in-memory session handling, not in Claude itself.
- The rollout ended after the user accepted the proposed design directions and the assistant began applying the UI/calibration/session-list changes.

Failures and how to do differently:
- The user’s stated physical screen resolution (`640 x 350`) conflicted with the SDK/repo assumptions (`576 x 288`), so the correct path was to calibrate on the glasses rather than assume the spec.
- The UI work was only partially landed before compaction; the final end-to-end behavior was not revalidated after the latest edits.

Reusable knowledge:
- The SDK can draw real borders, so a proper box is preferable to a long ASCII rule when the text width is off.
- A calibration ruler on the HUD is a good way to resolve real usable width/height when the reported spec and observed screen size disagree.
- Session persistence should be backed by on-disk transcript state plus a session list, not just transient in-memory state.

References:
- SDK type definitions showed `TextContainerProperty` / `TextContainerUpgrade` require `toJson()` and support border fields.
- Transcript files existed under `C:\Users\Yoshi\.claude\projects\C--Users-Yoshi--agent-even\...jsonl` and `C--Users-Yoshi--agent-even-cc-g2-win-backend`.
- User wording preserved: "messages are on the left and claude's responses are supposed to be on the right", "The line that is drawn across the top of the app is too long, by about 30%", "Can we draw a box or something?", "tap once to record, tap again to transcribe and review, tap a third time to send or double tap to erase message and record again", "I need a way to resume sessions".
