thread_id: 019efd09-ffd4-7403-9518-20feb24c8e23
updated_at: 2026-06-25T04:29:11+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffd4-7403-9518-20feb24c8e23.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# cc-g2-win UX revamp for the G2 HUD, then debugged a stale backend that kept serving old behavior.

Rollout context: user was testing the cc-g2-win app from `C:\Users\Yoshi\.agent_even\cc-g2-win` (rollout cwd hint was `\?\C:\Users\Yoshi\AppData\Local\Temp`, but the substantive work was in the app repo). The conversation covered a new recording/review/send flow, display layout changes, dev launcher updates, and post-launch debugging when the new flow still behaved like the old one.

## Task 1: redesign the recording/review/send flow and message layout

Outcome: success

Preference signals:

- The user said they did not like that “you tap to record and then the next tap automatically sends” and wanted to “read the transcription and have the option to cancel and rerecord or send after that” -> they want a review step before send, not auto-send.
- The user said it was “hard to see where your replies begin and my transcription ends” and wanted “some type of break in the text to indicate that it's the changing of the speech” -> they want explicit turn separation in the HUD, not a single undifferentiated text stream.
- The user later asked, “Can we actually put your reply on the right side of the screen and my message on the left side of the screen like a normal texting app?” -> they prefer chat-style left/right alignment, with user text on the left and assistant text on the right.

Key steps:

- The assistant inspected `plugin/src/main.ts` and `plugin/src/display.ts`, then implemented a 3-step interaction model: tap to record, tap to stop+transcribe, then read draft and either tap to send or double-tap to re-record.
- The display was updated to use left/right bubbles and blank-line turn separation so the HUD visually distinguishes user transcription from assistant replies.
- The backend was changed so `audio_end` no longer auto-sends; instead a new `send` handler triggers the Claude call after review.
- The plugin build/typecheck was run; the assistant reported the changes were type-clean aside from pre-existing SDK `toJson` issues on unchanged calls.

Failures and how to do differently:

- The first implementation looked correct in code but was not yet proven on-device; the user’s live test later showed it still “goes straight to sending again,” so future similar UI-flow changes should be validated in the actual device/runtime before declaring the interaction fixed.
- The assistant initially assumed the code path was enough; the rollout shows runtime/browser caching or stale process issues can make a correct source change appear ineffective.

Reusable knowledge:

- In this app, the review flow is implemented across `plugin/src/main.ts`, `plugin/src/display.ts`, and `backend/main.py`; changing only one surface is insufficient when altering tap/record/send semantics.
- A 44-col HUD makes width tradeoffs real; compact bubbles and clear blank-line separators are needed for readable turn boundaries.
- `sendJson` in `plugin/src/ws.ts` accepts arbitrary objects, so a `{ type: 'send', text }` message shape is compatible without extra type plumbing.

References:

- [1] User request: “tap to record and then the next tap automatically sends” -> wanted 3 taps with review/cancel/send.
- [2] Files touched: `C:\Users\Yoshi\.agent_even\cc-g2-win\plugin\src\display.ts`, `...\plugin\src\main.ts`, `...\backend\main.py`.
- [3] Behavior described by assistant after edit: “tap=record → tap=stop+transcribe → read it → tap=send / double-tap=re-record.”

## Task 2: launch dev env and debug stale backend / cached old behavior

Outcome: partial

Preference signals:

- After the assistant asked whether to start `dev.ps1`, the user said “Yes, please.” -> they wanted immediate launch/verification after the code changes, not just source edits.
- When the test still failed, the user pointed out “there's a bunch of red text on one of the PowerShell windows” -> they expect visible startup errors to be investigated rather than ignored.

Key steps:

- The assistant read and edited `dev.ps1` to match the new flow before launching the dev environment.
- The launcher started a backend on `:8787` and plugin on `:5173`; the assistant reported both up and told the user to scan the QR/reload the plugin.
- The user’s on-device test still auto-sent immediately, so the assistant investigated live processes/ports and discovered the backend was fresh but the visible red text came from `gen_qr.py` crashing on `print_ascii` (cosmetic).
- The assistant then concluded the more important issue was a stale backend process or cached client bundle: the backend on `:8787` was running under global Python while the launcher uses the venv, and the running process was suspected to be serving old behavior despite the on-disk backend having the new `send` handler.

Failures and how to do differently:

- “Code changed” did not equal “device behavior changed”; the rollout shows a stale process/cached bundle can survive a relaunch, so future debugging should verify the actual served bundle/process identity before assuming the new code is active.
- The QR generator crash produced red text but was not the user-facing bug; future agents should separate cosmetic launcher noise from functional startup failure.
- The user’s live report (“it already didn't work”) is stronger than the assistant’s early success claim; treat runtime user feedback as the decisive validation signal.

Reusable knowledge:

- `dev.ps1` controls launch for both backend and plugin and can be updated to match new flow text before running.
- The visible red text in the launcher can come from `gen_qr.py` failing on `print_ascii`; that does not necessarily mean the whole app is broken.
- The backend port/process state matters more than file diffs when a behavior change appears not to take effect.

References:

- [1] User feedback after test: “it just goes straight to sending again.”
- [2] Visible launcher error called out by assistant: `gen_qr.py` crashing on `print_ascii`.
- [3] Launcher status reported: backend on `:8787`, plugin on `:5173`.
- [4] Working files: `C:\Users\Yoshi\.agent_even\cc-g2-win\dev.ps1`, `...\backend\gen_qr.py`, `...\backend\main.py`.
