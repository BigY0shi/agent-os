# Task Group: cc-g2-win backend runtime, reachability, and simulator verification

scope: Reuse for debugging live runtime mismatches in `cc-g2-win`, especially when the source tree looks correct but the phone/simulator still shows old behavior, Claude replies never arrive, or the chosen URL/QR path is not reachable.
applies_to: cwd=C:\Users\Yoshi\.agent_even\cc-g2-win and cwd=C:\Users\Yoshi\.agent_even; reuse_rule=safe for this project family and nearby EvenHub simulator work, but treat PIDs, ports, and network addresses as ephemeral and revalidate each run

## Task 1: Fix the Claude no-reply path by switching to valid UUID session IDs and draining stderr

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-QcAv-even_realities_g2_claude_session_uuid_stderr_fix.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd0a-0189-7b92-9629-c12c5fdc7e27.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd0a-0189-7b92-9629-c12c5fdc7e27, success; direct evidence for UUID requirement and stderr drain)
- rollout_summaries/2026-06-25T04-29-11-gTQi-cc_g2_win_claude_session_id_uuid_fix.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffe3-7e63-b334-46f326fe18c6.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ffe3-7e63-b334-46f326fe18c6, success; same backend failure pattern)
- rollout_summaries/2026-06-25T04-29-11-k5yy-cc_g2_win_fix_invalid_session_id_no_reply.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd0a-001b-7b01-b54a-641b3d2d6237.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd0a-001b-7b01-b54a-641b3d2d6237, success; same invalid-session diagnosis)
- rollout_summaries/2026-06-25T04-29-11-lvH6-cc_g2_win_claude_reply_fix_uuid_stderr.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffac-7072-abf4-29e57e404b34.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ffac-7072-abf4-29e57e404b34, success; daily-log framing of the same fix)
- rollout_summaries/2026-06-25T04-29-11-sBtJ-cc_g2_invalid_session_id_claude_no_reply.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fffc-7e42-bec6-ca65ab260af2.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fffc-7e42-bec6-ca65ab260af2, success; same no-reply symptom from another pass)

### keywords

- session.py, invalid session id, Must be a valid UUID, stderr=PIPE, asyncio.create_subprocess_exec, Claude CLI, stream-json, no reply after transcription

## Task 2: Debug stale runtime behavior when review-flow edits do not appear live

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-23xB-cc_g2_win_review_flow_and_stale_process_debug.md (cwd=\\?\C:\Users\Yoshi\.agent_even, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fff3-7110-a38f-e099217f4d7f.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fff3-7110-a38f-e099217f4d7f, partial; old auto-send behavior traced to stale process / stale served bundle)
- rollout_summaries/2026-06-25T04-29-11-9NQq-cc_g2_win_3tap_review_left_right_bubbles_stale_backend.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffaf-7d50-a2a9-7c918bab8862.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ffaf-7d50-a2a9-7c918bab8862, partial; stale runtime after launch)
- rollout_summaries/2026-06-25T04-29-11-A8Lw-cc_g2_win_ux_redesign_stale_runtime_debug.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffe3-7e63-b334-4709b673bc1e.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ffe3-7e63-b334-4709b673bc1e, partial; stale backend kept serving old behavior)
- rollout_summaries/2026-06-25T04-29-11-rrNh-cc_g2_win_review_flow_layout_and_stale_backend_debug.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffd4-7403-9518-20feb24c8e23.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ffd4-7403-9518-20feb24c8e23, partial; stale backend after review-flow redesign)
- rollout_summaries/2026-06-25T04-29-11-Ig4b-daily_memory_log_entry_for_cc_g2_win_simulator_blocker.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff8c-77b0-ba7e-5044f1f37503.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ff8c-77b0-ba7e-5044f1f37503, success; Vite port collision note preserved for routing)

### keywords

- stale backend, cached bundle, PID 7636, port 8787, port 5173, review state false, sendPending true, Vite, PORT=8787, auto-send still happening

## Task 3: Use the EvenHub simulator and fix layout/disconnect/reachability issues

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-Gq0p-even_hub_simulator_ui_overflow_and_disconnect_fix.md (cwd=\\?\C:\Users\Yoshi\.agent_even, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff45-7771-b6ba-a5086501ba51.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ff45-7771-b6ba-a5086501ba51, partial; simulator path, width fix, websocket ping disable)
- rollout_summaries/2026-06-25T04-29-11-fTCc-cc_g2_win_hud_wrap_and_websocket_timeout_fix.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff33-70d2-a5b1-928099796a84.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ff33-70d2-a5b1-928099796a84, partial; same wrap + disconnect cluster from another pass)
- rollout_summaries/2026-06-25T04-29-11-jHHB-evenhub_right_alignment_simulator_setup.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffbe-7261-abcc-2979d64c9fd3.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ffbe-7261-abcc-2979d64c9fd3, partial; simulator harness for alignment validation)
- rollout_summaries/2026-06-25T04-29-11-zuy6-cc_g2_win_right_align_and_even_dev_simulator_debug.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ffd3-73c2-854d-ced437fd9e92.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ffd3-73c2-854d-ced437fd9e92, partial; hardware-free verification path)
- rollout_summaries/2026-06-25T04-29-12-pDM7-even_realities_plugin_qr_reachability_fix.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-01e8-7680-abd8-601913bd90db.jsonl, updated_at=2026-06-25T04:29:12+00:00, thread_id=019efd0a-01e8-7680-abd8-601913bd90db, partial; plugin URL / QR payload / WSL-IP reachability)

### keywords

- even-dev, apps.json, APP_NAME=cc-g2, port 5173, GLASS_RESPONSE_WRAP_WIDTH = 38, ws_ping_interval=None, ws_ping_timeout=None, plugin URL only, backend URL, token, 172.22.32.1, Tailscale, ngrok

## User preferences

- When the user says the UI is stuck or asks "do you see where I provided the simulator" -> prefer checking the real simulator/UI path instead of only reading code or logs. [Task 2][Task 3]
- When the user reports "it already didn't work" after an edit -> verify the actual running process and served bundle, not just the on-disk files. [Task 2]
- When the user says "Try 5173 as the port" -> be ready to follow the app port the user names and confirm which service a port actually belongs to before debugging the wrong surface. [Task 3]
- When the user asks "I just need the plugin url as the qr code?" -> answer explicitly that the QR should contain only the plugin URL, with backend URL/token entered separately. [Task 3]
- When the user says the phone will not be on the same Wi-Fi and Tailscale is already installed -> pivot to Tailscale quickly instead of spending more time on unreachable local LAN URLs. [Task 3]

## Reusable knowledge

- `claude --session-id` must receive a real UUID; a shortened `uuid.uuid4().hex[:16]` fails with `Invalid session ID. Must be a valid UUID.` [Task 1]
- `backend\session.py` needs concurrent stderr drainage when using `asyncio.create_subprocess_exec(..., stderr=PIPE)` so CLI failures do not vanish behind a blank no-reply symptom. [Task 1]
- In stale-runtime cases, simple `backend: UP` / `plugin: UP` health checks were not enough; the useful proof was PID age, command line, and served bundle content such as `review state: False` even after a supposed review-flow patch. [Task 2]
- `C:\Users\Yoshi\.agent_even\even-dev` is the local EvenHub simulator workspace, and `apps.json` already maps `"cc-g2"` to `"../cc-g2-win/plugin"`. [Task 3]
- A working Even app in the repo used a glass wrap width of `38`, which became the concrete reference for shrinking `display.ts` from `COLS = 44`. [Task 3]
- The proven reconnect fix here was disabling uvicorn websocket ping timeouts in `backend\main.py`. [Task 3]
- A WSL address like `172.22.32.1` is the wrong interface for phone reachability in this workflow; use a routable LAN IP or Tailscale `100.x.x.x` instead. [Task 3]
- Related skill: skills/cc-g2-win-debug-loop/SKILL.md [Task 1][Task 2][Task 3]

## Failures and how to do differently

- Symptom: transcription succeeds but Claude never replies -> cause: invalid `--session-id` or hidden stderr in the subprocess layer -> fix: validate the CLI contract first, use a real UUID, and drain stderr before blaming STT or transport. [Task 1]
- Symptom: the user still sees old behavior after a source edit -> cause: stale backend process or cached plugin bundle -> fix: inspect the live PID/process age and prove what bundle is being served before editing more code. [Task 2]
- Symptom: the simulator opens but shows the wrong thing -> cause: port confusion between backend and plugin -> fix: point the simulator at the actual plugin app port (`5173`) and confirm `apps.json` mapping. [Task 3]
- Symptom: phone loads forever or cannot reach the plugin -> cause: launcher chose loopback, link-local, or WSL adapter IP -> fix: reject those interfaces early and switch to LAN/Tailscale. [Task 3]
- Symptom: disconnects keep breaking the flow -> cause: websocket ping handling at the server layer, not necessarily app heartbeat logic -> fix: inspect uvicorn websocket settings instead of only the app-level code. [Task 3]
