thread_id: 019efd09-ff25-7a11-af67-b25bff2b32e1
updated_at: 2026-06-25T04:29:11+00:00
rollout_path: C:\Users\Yoshi\.codex\archived_sessions\rollout-2026-06-24T21-29-11-019efd09-ff25-7a11-af67-b25bff2b32e1.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# Diagnosed two issues in cc-g2-win but did not finish a fix.

Rollout context: In \"C:\\Users\\Yoshi\\.agent_even\\cc-g2-win\", the user said the top HUD line was still doubling/wrapping and later reported hundreds of port hits/404s from the PowerShell window; they also noted the Even Realities display is 640x350 and asked about resuming past sessions and stopping the top UI from fading so it’s clear whether the connection is dropping.

## Task 1: investigate doubled top line + port spam

Outcome: partial

Preference signals:
- When the top line was still doubled, the user clarified: \"It's the line at the top of the app. It's too long.\" -> future fixes should target the header width first, not the divider, when the HUD wraps on the glasses.
- When asked about the screen size, the user confirmed: \"640 by 350 for the binocular waveguide display\" -> future work can treat 640x350 as the known device resolution, not something to rediscover.
- The user added: \"I also need to get the ability to resume past sessions and the UI at the top keeps like fading out and I can't tell if I'm losing the connection or not\" -> future similar sessions should treat session-resume and connection-status visibility as explicit product needs, not incidental polish.

Reusable knowledge:
- The agent suspected the doubled line came from a wide non-ASCII `·` in `display.ts` (around lines 34-42), not from the divider; the proposed quick fix was to replace it with plain ASCII `-` and shorten the header text.
- `backend/main.py` only serves `/health` and `/ws`; other requests 404 by design.
- Repeated `dev.ps1` runs left a process pileup: about 6 Python processes and ~30 Node processes, which was likely contributing to the machine bogging down.

Failures and how to do differently:
- The initial \"doubled line\" diagnosis was incomplete because the user later clarified it was the top app line being too long; future debugging should verify the exact rendered line before editing separators.
- The port-spam symptom appears tied to accumulated dev processes rather than backend routes; future cleanup should check for duplicate backend/Vite instances before chasing 404s.
- The rollout ended while the agent was still confirming which Python processes were duplicate backends, so the fix was not completed in-session.

References:
- `display.ts` suspected hotspot: `C:\Users\Yoshi\.agent_even\cc-g2-win\plugin\src\display.ts` (wide `·` in the header area, approx. lines 34-42).
- Backend route fact: `C:\Users\Yoshi\.agent_even\cc-g2-win\backend\main.py` serves only `/health` and `/ws`.
- Process symptom: \"6 python and ~30 node processes piled up from a day of repeated `dev.ps1` runs\".
- Device resolution confirmed by user: `640 by 350`.
- User wording worth preserving: \"resume past sessions\", \"UI at the top keeps like fading out\", \"can't tell if I'm losing the connection or not\".
