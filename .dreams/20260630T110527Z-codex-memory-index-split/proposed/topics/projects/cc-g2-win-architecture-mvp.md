# Task Group: cc-g2-win Windows/Android Claude Code app architecture and MVP bootstrap

scope: Reuse for scoping or extending the custom Even Realities G2 app at `C:\Users\Yoshi\.agent_even\cc-g2-win`, especially when the user wants a Windows backend + Android EvenHub app that stays separate from IRIS and uses full Claude Code invocation.
applies_to: cwd=C:\Users\Yoshi\.agent_even\cc-g2-win and related `C:\Users\Yoshi\.agent_even` work; reuse_rule=safe for follow-up work in this project family, but treat exact launcher behavior, QR state, and persistence status as checkout-specific unless revalidated

## Task 1: Clarify the target platform and architecture for the G2 build

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-12-8SGC-g2_claude_code_windows_android_evenhub_architecture.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-0210-7b62-b638-75a6ae83294a.jsonl, updated_at=2026-06-25T04:29:12+00:00, thread_id=019efd0a-0210-7b62-b638-75a6ae83294a, success; platform correction from mac/iPhone reference app to Windows + Android EvenHub target)

### keywords

- Even Realities G2, EvenHub, Windows, Android, claude-code-g2, Not quite a web app, hub.evenrealities.com/docs/get-started/overview, Whisper, ElevenLabs, self-hosted STT

## Task 2: Build the first `cc-g2-win` MVP and stabilize the launcher expectations

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-12-7vYY-cc_g2_win_mvp_devps1_qr_missing.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-0202-78d3-95e7-9423f7981e98.jsonl, updated_at=2026-06-25T04:29:12+00:00, thread_id=019efd0a-0202-78d3-95e7-9423f7981e98, partial; MVP backend/plugin build plus rewritten `dev.ps1`, but QR/persistence remained unresolved)

### keywords

- cc-g2-win, EvenHub, Claude Code only, faster-whisper, FastAPI, WebSocket, stream-json, dev.ps1, QR code missing, audio_end, keep Claude alive 15-20 minutes, syncing python deps

## User preferences

- When the user corrected the framing with "I have windows and an android" and "Not quite a web app" -> default future work on this project to Windows backend + Android EvenHub app, and read the EvenHub docs before proposing architecture. [Task 1]
- When the user said "This will be separate from the IRIS app, and will be claude code only" and "I want full claude code invocation" -> keep this project separate from IRIS and do not drift into multiprovider or lighter chat-only scope. [Task 2]
- When the user said "Let's use local faster-whisper. Especially if it doesn't take up much VRAM" -> prefer local STT over hosted credits for this build unless they explicitly override. [Task 2]
- When the user said "Your default is fine. Eventually I'll set up a tunnel but right now i Just need an MVP" -> default to LAN-first delivery for the first pass instead of prematurely optimizing for tunnel/cloud setup. [Task 2]
- When the user said "if the glasses lose connection, keep claude alive for 15-20 minutes" -> preserve the Claude session across short disconnects instead of resetting immediately. [Task 2]
- When the user asked "Where is the QR at? And is it supposed to shutdown right away?" -> if the walkthrough mentions QR or startup behavior, make sure the script actually does it before claiming the path is ready. [Task 2]

## Reusable knowledge

- The authoritative app shape here is: Windows backend plus Android EvenHub plugin, separate from IRIS, using full Claude Code invocation. [Task 1][Task 2]
- The EvenHub plugin facts used during the MVP build were: Android WebView app surface, 16 kHz PCM audio input, and text-only output via `textContainerUpgrade`. [Task 2]
- The project root is `C:\Users\Yoshi\.agent_even\cc-g2-win`, with `backend\` for FastAPI / faster-whisper / Claude CLI session handling and `plugin\` for the EvenHub UI/HUD. [Task 2]
- `dev.ps1` is the expected launcher entrypoint for this project, and the debug path for "syncing python deps" is to run `backend\.venv\Scripts\pip install -r requirements.txt` directly so real install errors appear. [Task 2]
- Related skill: skills/cc-g2-win-debug-loop/SKILL.md [Task 2]

## Failures and how to do differently

- Symptom: discussion drifts toward mac/iPhone or generic web-app patterns -> cause: overfitting to reference repos before confirming the user's platform -> fix: restate Windows + Android EvenHub constraints first, then map any reference repo back into that target. [Task 1]
- Symptom: the walkthrough promises QR sideloading but the user cannot find it -> cause: QR support was described before it actually existed -> fix: do not advertise QR readiness until the script visibly emits or serves it. [Task 2]
- Symptom: a quiet startup flow looks stuck on dependency sync -> cause: the wrapper hides the real pip output -> fix: run pip directly in `backend` before changing `.env` or rewriting config. [Task 2]
- Symptom: persistence questions appear late in the session -> cause: session/token/storage behavior was never made explicit -> fix: explain where session state, token, and project memory live in the first working walkthrough. [Task 2]
