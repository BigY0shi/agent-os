thread_id: 019efd09-ff19-7742-8670-df31958e1e3e
updated_at: 2026-06-25T04:29:11+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff19-7742-8670-df31958e1e3e.jsonl
cwd: \\?\C:\Users\Yoshi\.agent_even

# Investigated the G2 HUD "doubled line" complaint, then pivoted to a port-spam / duplicate-backend issue before the user interrupted.

Rollout context: working in `C:\Users\Yoshi\.agent_even` on the `cc-g2-win` / `even-dev` codebase. The user first reported the HUD still had a doubled line, then clarified it was the top line being too long, then added that the top UI was fading and they also needed session resume plus connection visibility. The later, more urgent complaint was that PowerShell was hammering ports and producing many `404 not found` errors, bogging down the machine.

## Task 1: Diagnose the doubled HUD line / top-line wrapping
Outcome: partial

Preference signals:
- When the agent asked what was doubling, the user eventually clarified: "It's the line at the top of the app. It's too long." -> future fixes should treat this as a layout/width problem first, not a generic duplicate-render bug.
- The user then added broader UX concerns in the same thread: "I also need to get the ability to resume past sessions and the UI at the top keeps like fading out and I can't tell if I'm losing the connection or not" -> future work on the HUD should anticipate session-resume and connection-status visibility as first-class requirements, not afterthoughts.

Key steps:
- Read `cc-g2-win\plugin\src\display.ts` and `cc-g2-win\plugin\src\main.ts` to inspect render logic.
- The assistant hypothesized the header was overlong due to non-ASCII `·` characters and short truncation caps, but this was not resolved in the rollout.
- The user explicitly confirmed the screen dimensions as "640 by 350" and said those are the known Even Realities binocular waveguide dimensions.

Failures and how to do differently:
- The likely root cause was not fixed in this rollout; the user interrupted before a patch/verification.
- The assistant also over-investigated the exact doubling source before the user had a chance to answer the multiple-choice question, which led to a dead end.
- Future agents should verify the exact top-line container width/character budget against the known 640x350 display before making further changes.

Reusable knowledge:
- `cc-g2-win\plugin\src\display.ts` already uses `COLS = 38`, `BUBBLE = 30`, and `VISIBLE_LINES = 8` for HUD text layout.
- `cc-g2-win\plugin\src\main.ts` routes HUD content through `Display.render(hudHeader(), hudHint())`; status text changes are centralized there.
- The user treated 640x350 as the authoritative display resolution for the glasses.

References:
- [1] `cc-g2-win\plugin\src\display.ts`: `COLS = 38`, `BUBBLE = 30`, `VISIBLE_LINES = 8` and the `_fmt` / `_render` path that pads right-aligned text.
- [2] `cc-g2-win\plugin\src\main.ts`: HUD states and strings, including `CLAUDE CODE · configure on phone`, `claude thinking...`, `claude responding...`, and the hints for tap/scroll behavior.
- [3] User wording: "It's the line at the top of the app. It's too long." and "640 by 350 for the binocular waveguide display."

## Task 2: Investigate port spam / 404 storm and duplicate backend processes
Outcome: partial

Preference signals:
- When the user said the terminal was "just hitting a bunch of ports and giving me 404 not found errors" and that it was "bogging my computer down," the assistant correctly pivoted to the resource-spam issue as the urgent one -> future agents should prioritize machine-bogging loops over cosmetic UI issues when both are present.

Key steps:
- Read `cc-g2-win\backend\main.py`, `cc-g2-win\plugin\src\ws.ts`, and `cc-g2-win\dev.ps1`.
- Confirmed backend behavior: the FastAPI app only exposes `/health` and `/ws`; other endpoints naturally return 404.
- `dev.ps1` opens backend and plugin in separate windows, installs deps, and frees ports 8787 and 5173 before launching.
- Used PowerShell process and socket inspection to identify the live backend and stray duplicate:
  - `Get-Process python,node,pythonw ...`
  - `Get-NetTCPConnection -State Listen -LocalPort 8787,5173`
  - `Get-CimInstance Win32_Process -Filter "Name='python.exe'" ...`
- Found two `main.py` backend processes: one real server (`PID 56344`, system Python, ~742 MB) and one zombie duplicate (`PID 19292`, venv Python, ~3 MB) that could not bind the port.
- Killed the zombie backend (`Stop-Process -Id 19292 -Force`), which succeeded.

Failures and how to do differently:
- The rollout ended before the actual 404 source was fully traced; only the duplicate backend was confirmed and removed.
- The evidence suggests the backend was not the only issue: `dev.ps1` had already been run many times, leaving many node/python processes around, so future debugging should check for repeated launcher invocations plus a stale window/pid before assuming a single code bug.
- The 404s may have been benign route misses rather than the direct cause of slowdown; in this rollout, the confirmed actionable fix was killing the zombie backend, not changing request handling.

Reusable knowledge:
- `cc-g2-win\backend\main.py` prints the bearer token and uses a session manager with `idle_timeout_seconds=15 * 60`.
- WebSocket resume is already wired in `cc-g2-win\plugin\src\ws.ts`: on open, if `sessionId` exists it sends `{ type: 'resume', session_id: this.sessionId }`, and it persists the `session_id` to `localStorage` as `cc_g2_session_id`.
- `dev.ps1` explicitly frees ports `8787` and `5173` before launch, so repeated launches can still leave stray windows/processes even when ports are reclaimed.
- The backend socket listener was active on `8787`; the live phone/device connection was `100.89.54.83` with two established connections.

References:
- [1] `cc-g2-win\backend\main.py`: `/health`, `/ws`, session startup, and `idle_timeout_seconds=15 * 60`.
- [2] `cc-g2-win\plugin\src\ws.ts`: resume flow and heartbeat every `20_000` ms.
- [3] `cc-g2-win\dev.ps1`: port freeing loop for `8787` and `5173`.
- [4] Process evidence: `PID 56344` = `"C:\\Users\\Yoshi\\AppData\\Local\\Programs\\Python\\Python311\\python.exe" main.py`; `PID 19292` = `"C:\\Users\\Yoshi\\.agent_even\\cc-g2-win\\backend\\.venv\\Scripts\\python.exe" main.py`.
- [5] The cleanup command succeeded: `Stop-Process -Id 19292 -Force -Confirm:$false -ErrorAction SilentlyContinue` -> `zombie backend 19292 killed`.

## Task 3: Session interrupted before resolution
Outcome: uncertain

Preference signals:
- The user ended the rollout with `[Request interrupted by user]` -> future agents should expect the thread to resume mid-debug and avoid assuming the issue was solved.

Key steps:
- No further validation after killing the duplicate backend.

Failures and how to do differently:
- Because the user interrupted, there was no confirmation that the HUD width issue, session-resume concern, or port-spam complaint was fully resolved.
- Future follow-up should re-establish the live state before editing: confirm which backend process is authoritative, whether the HUD still wraps, and whether the top status fading/connection visibility issue remains.

Reusable knowledge:
- This rollout contains verified evidence of one zombie backend process and one live backend process; that distinction is likely useful when resuming.

References:
- [1] Final user interrupt: `[Request interrupted by user]`
