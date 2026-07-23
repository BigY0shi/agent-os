# Task Group: cc-g2-win plugin UX, gesture handling, and HUD debugging

scope: Reuse for `plugin\src\main.ts` / `display.ts` work on `cc-g2-win`, especially when the user is steering recording flow, speaker alignment, hold-to-record behavior, or debugging why the HUD state and transcription handoff look wrong on-device.
applies_to: cwd=C:\Users\Yoshi\.agent_even\cc-g2-win and `plugin` subpaths; reuse_rule=safe for follow-up UX/debug work in this plugin, but treat exact SDK gesture support and live-device behavior as needing fresh verification

## Task 1: Redesign recording flow for review-before-send and clearer speaker separation

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-VaZn-cc_g2_win_ux_redesign_review_flow_bubbles.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd0a-0007-7c63-8465-5bdc6fc9061d.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd0a-0007-7c63-8465-5bdc6fc9061d, partial; first redesign discussion without validation)
- rollout_summaries/2026-06-25T04-29-11-23xB-cc_g2_win_review_flow_and_stale_process_debug.md (cwd=\\?\C:\Users\Yoshi\.agent_even, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fff3-7110-a38f-e099217f4d7f.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fff3-7110-a38f-e099217f4d7f, partial; redesign intent plus user report that old auto-send persisted)

### keywords

- three taps instead of just two, cancel and rerecord, send after that, left side / right side, normal texting app, review state, main.ts, display.ts, audio_end

## Task 2: Debug the transcription handoff when the app still says `!Nothing heard`

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-KrZY-even_realities_plugin_transcription_debug_fix.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd0a-01ba-7d53-9f6a-1e8aafed416e.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd0a-01ba-7d53-9f6a-1e8aafed416e, partial; `eventType` null/0 handling plus on-screen debug logging)

### keywords

- !Nothing heard, eventType 0, eventType null, chrome://inspect, index.html, on-screen debug box, transcription visible, downstream handoff

## Task 3: Fix the HUD blanking bug and probe hold-to-record support

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-12-Vtfp-even_realities_hud_recording_display_bug.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-01db-7041-a331-66e9c61a0e67.jsonl, updated_at=2026-06-25T04:29:12+00:00, thread_id=019efd0a-01db-7041-a331-66e9c61a0e67, success; HUD blanking fix and SDK-gesture limit note)
- rollout_summaries/2026-06-25T04-29-12-KHwt-recording_hud_debug_logging_tap_broke.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-01ca-75b1-af88-bf24f7452799.jsonl, updated_at=2026-06-25T04:29:12+00:00, thread_id=019efd0a-01ca-75b1-af88-bf24f7452799, partial; approved recording visual but taps stopped working)

### keywords

- hold to record, tap and hold to record, setState('listening'), Display.render(), empty _lines buffer, connection guard, status line, Listening..., tap does nothing, tap double-tap swipe

## User preferences

- When the user says "I don't like how you tap to record and then the next tap automatically sends" and asks for "three taps instead of just two" -> default to review-before-send with rerecord/cancel as first-class options. [Task 1]
- When the user says "it's hard to see where your replies begin and my transcription ends" and wants replies on the right and user text on the left "like a normal texting app" -> make turn boundaries visually explicit rather than relying on subtle headers. [Task 1]
- When the user says their other apps are "hold to record" or "It should be a tap and hold to record" -> treat hold-to-record as the desired UX, and if the SDK blocks it, surface that constraint explicitly instead of silently substituting tap-to-toggle. [Task 3]
- When the user says "that visual you sent is perfect" -> a strong on-screen recording indicator in the content area is a preferred default for this app. [Task 3]
- When the user rejects a remote-debug path with "nah it's not weorking" -> pivot quickly to in-app/on-screen logging instead of insisting on the same tooling. [Task 2]

## Reusable knowledge

- `plugin\src\main.ts` is the primary edit point for the recording state machine, review flow, connection guards, and event handling; `plugin\src\display.ts` controls the HUD rendering constraints. [Task 1][Task 3]
- On this Android/WebView path, `eventType` can be `0` or `null`; checking only for `undefined` misses real taps. [Task 2]
- A visible in-app debug element in `plugin\index.html` was a practical fallback when `chrome://inspect` was unavailable. [Task 2]
- The symptom "transcription appears on screen but the app still says `!Nothing heard`" means capture succeeded and the remaining bug is in the downstream heard-state propagation. [Task 2]
- The blank-HUD bug came from `setState('listening')` triggering `Display.render()` with an empty `_lines` buffer; keeping a persistent status line avoids a blank screen. [Task 3]
- The strongest approved recording-state visual was a larger "Listening..." style box in the content area, not just a tiny header/state label. [Task 3]

## Failures and how to do differently

- Symptom: the code change looks right but taps stop working -> cause: interaction was not revalidated after the UX change -> fix: immediately retest tap, double-tap, and any candidate hold behavior after each gesture/UI edit. [Task 3]
- Symptom: visible transcription is treated as proof the app is fixed -> cause: downstream handoff/state update was skipped -> fix: keep tracing past capture until the app leaves `!Nothing heard` and enters the intended heard/review path. [Task 2]
- Symptom: hold-to-record is assumed to work because the user wants it -> cause: UX preference was stronger than the proven SDK contract -> fix: instrument actual event output and treat hold support as open until the device logs confirm it. [Task 3]
- Symptom: recording/listening state blanks the HUD -> cause: render logic clears the line buffer on state changes -> fix: preserve at least a status line and guard empty-buffer renders. [Task 3]
