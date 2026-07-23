thread_id: 019efd09-ffaf-7d50-a2a9-7c918bab8862
updated_at: 2026-06-25T04:29:11+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffaf-7d50-a2a9-7c918bab8862.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# cc-g2-win UI/flow redesign with follow-up debug on stale launch

Rollout context: the user was using the cc-g2-win app on G2 glasses (`.agent_even/cc-g2-win/`) and asked for a 3-tap review flow after transcription plus clearer turn separation on the small screen.

## Task 1: redesign recording/reply UX and verify it

Outcome: partial

Preference signals:
- the user said they did not like that “tap to record” and the next tap “automatically sends” -> they want a review step by default, not immediate send.
- the user asked to “read the transcription and have the option to cancel and rerecord or send after that” and described it as “three taps instead of just two” -> future similar flows should default to explicit review/confirm before send.
- the user also asked that it be “hard to see where your replies begin and my transcription ends” and wanted “some type of break in the text” / later “your reply on the right side of the screen and my message on the left side… like a normal texting app” -> future UI changes should favor clear turn boundaries and left/right alignment on this HUD.

Key steps:
- inspected `plugin/src/main.ts`, `plugin/src/display.ts`, and `backend/main.py` to trace the current auto-send path from `audio_end`.
- implemented a `review` state, changed the plugin flow to tap=record -> tap=stop+transcribe -> review draft -> tap=send / double-tap=re-record, and updated rendering to left-align user text and right-align assistant text with blank-line separation.
- changed the backend so `audio_end` no longer auto-sends and added an explicit `send` handler.
- updated `dev.ps1` to match the new flow before launching the dev environment.

Failures and how to do differently:
- the user’s first test after launch still “goes straight to sending again,” so the intended flow was not actually live on-device yet.
- red text in a PowerShell window indicated a startup issue; later investigation suggested the visible red text was `gen_qr.py` failing on `print_ascii` (cosmetic) and the more important problem was a stale backend/bundle situation rather than the on-disk code.
- future similar changes should verify the actual running processes and served bundle, not just the edited source files, before declaring the UX live.

Reusable knowledge:
- `plugin/src/main.ts` was the main place for the review-state/tap-flow change; `display.ts` handled turn alignment; `backend/main.py` handled the auto-send vs explicit-send split.
- the dev launcher is `dev.ps1`, and it may need updating when the UX contract changes.
- a visible red PowerShell window in this setup can be a QR-script cosmetic crash (`gen_qr.py` / `print_ascii`) and may not be the core runtime issue.

References:
- edited files: `C:\Users\Yoshi\.agent_even\cc-g2-win\plugin\src\main.ts`, `C:\Users\Yoshi\.agent_even\cc-g2-win\plugin\src\display.ts`, `C:\Users\Yoshi\.agent_even\cc-g2-win\backend\main.py`, `C:\Users\Yoshi\.agent_even\cc-g2-win\dev.ps1`
- quoted user requirement: “I would like to read the transcription and have the option to cancel and rerecord or send after that… three taps instead of just two.”
- quoted user requirement: “your replies begin and my transcription ends… some type of break in the text” and “reply on the right side… my message on the left side”
- verification clue: the launched env reported backend on `:8787` and plugin on `:5173`, but the user’s test still auto-sent, implying stale/cached runtime state rather than source mismatch.
