---
name: cc-g2-win-debug-loop
description: Debug the Windows + Android EvenHub `cc-g2-win` stack when the glasses or phone UI does not match the edited code, QR/IP setup is confusing, or Claude replies never arrive.
user-invocable: false
allowed-tools:
  - Read
  - Grep
  - Bash
---

# cc-g2-win debug loop

## When to use

Use this when work is happening around `C:\Users\Yoshi\.agent_even\cc-g2-win` and the problem smells like one of these:

- "it still does the old behavior"
- no Claude reply after transcription
- QR / plugin URL / backend URL confusion
- phone or glasses cannot reach the app
- EvenHub simulator or live UI looks wrong
- tap / review / hold-to-record / HUD state bugs

Do not use this for broad IRIS architecture planning or generic Windows troubleshooting outside `cc-g2-win`.

## Inputs / context to gather

Read these first:

1. `C:\Users\Yoshi\.agent_even\cc-g2-win\dev.ps1`
2. `C:\Users\Yoshi\.agent_even\cc-g2-win\plugin\src\main.ts`
3. `C:\Users\Yoshi\.agent_even\cc-g2-win\plugin\src\display.ts`
4. `C:\Users\Yoshi\.agent_even\cc-g2-win\backend\main.py`
5. `C:\Users\Yoshi\.agent_even\cc-g2-win\backend\session.py`
6. `C:\Users\Yoshi\.agent_even\even-dev\apps.json` when simulator validation matters

Reconfirm the scope boundary before debugging:

- This project is separate from IRIS.
- Target is Windows backend + Android EvenHub app.
- Default scope is Claude Code only, not multiprovider.

## Procedure

1. Check whether the symptom is runtime, network, or code-path.
   - If the user says the app still shows old behavior after an edit, do not trust source files alone.
   - Verify the listening ports and the actual processes behind them.
   - Compare process age / command line with the expected fresh launch.

2. Validate the launcher and reachability path.
   - `dev.ps1` should start backend and plugin separately.
   - QR should encode only the plugin URL.
   - Backend URL and token are entered later inside the plugin UI.
   - Reject bad interface choices immediately:
     - `127.0.0.1` is local only.
     - `169.254.x.x` is link-local.
     - `172.22.x.x` from WSL is wrong for phone reachability here.
   - Prefer a routable LAN IP or Tailscale `100.x.x.x`.

3. If the UI does not match the edit, prove what bundle is live.
   - Check whether the plugin dev server is really serving the updated code.
   - If needed, inspect served source/output for key strings such as review-state logic or send-handler branches.
   - Treat "health endpoint is up" as necessary but not sufficient.

4. Use the simulator early for layout and flow debugging.
   - `C:\Users\Yoshi\.agent_even\even-dev` is the local EvenHub simulator.
   - `apps.json` already maps `"cc-g2"` to `"../cc-g2-win/plugin"`.
   - When the simulator opens the wrong thing, verify it is using the plugin app port (`5173`), not the backend port chain.

5. For "transcription works but Claude never replies", check backend subprocess contracts first.
   - In `backend\session.py`, `claude --session-id` must receive a real UUID, not a shortened hex string.
   - Drain stderr concurrently so CLI failures do not disappear silently.
   - Treat this as a Claude subprocess bug before blaming STT or WebSocket transport.

6. For disconnects, inspect server-level WebSocket behavior.
   - If the phone/glasses connect and then keep dropping, check uvicorn ping settings in `backend\main.py`.
   - The proven fix in this project was disabling uvicorn websocket ping timeouts.

7. If the machine is slow or logs are flooding, inspect the full dev stack before editing more code.
   - `127.0.0.1:<port> ... 404 NOT FOUND` here can just be uvicorn showing a client ephemeral source port.
   - Repeated interrupted `dev.ps1` runs can leave duplicate Python/Node helpers behind.
   - If the flood only appears with the full stack up, inspect `plugin\src\main.ts` for leaked `BackendWs` instances.
   - The known bad pattern was creating `new BackendWs()` on Connect without destroying the prior instance, plus missing `import.meta.hot.dispose` teardown during HMR.

8. For plugin gesture/HUD bugs, inspect the downstream state path.
   - `eventType` can be `0` or `null`; do not only check for `undefined`.
   - If the screen shows transcription but the app still says `!Nothing heard`, the failure is in the handoff after capture.
   - If `setState('listening')` renders a blank HUD, preserve a status line and avoid empty `_lines` rendering.
   - Hold-to-record is not proven; SDK evidence only confirmed tap, double-tap, and swipe, so treat hold as an open compatibility question unless fresh instrumentation says otherwise.
   - If the top line is still too long or the user asks for a box, prefer SDK border support and on-device calibration over more ASCII-rule tweaking.

9. For layout issues, use known-good width references.
   - `display.ts` originally used `COLS = 44`.
   - A working Even app in the simulator repo used a wrap width of `38`.
   - Prefer tested glass-width references over guessing from desktop screenshots.

## Efficiency plan

- Start with the smallest branch that can falsify the current theory:
  - runtime mismatch -> process/PID/served bundle
  - reachability -> chosen IP / QR payload / same-network vs Tailscale
  - no reply -> `session.py` UUID + stderr
  - layout -> simulator + `display.ts`
- Reuse the same file set instead of broad repo scans.
- Stop once the symptom is traced to one layer and the fix is verified in that same layer.

## Pitfalls and fixes

- Symptom: old auto-send behavior persists after a code edit
  - Likely cause: stale backend or cached plugin bundle
  - Fix: verify the actual PID, process age, and served bundle contents before editing more

- Symptom: phone cannot load the prototype URL
  - Likely cause: launcher chose WSL / loopback / link-local IP
  - Fix: use LAN or Tailscale IP; QR should contain only the plugin URL

- Symptom: the console floods with 404s or the machine slows down after restarts
  - Likely cause: duplicate dev helpers or leaked `BackendWs` / HMR instances
  - Fix: inspect duplicate Python/Node processes, prove whether backend-alone traffic is quiet, then add destroy-before-new plus HMR teardown

- Symptom: transcription shows on screen but Claude says nothing
  - Likely cause: invalid `--session-id` or hidden stderr in `session.py`
  - Fix: use a real UUID and drain stderr

- Symptom: tap makes the HUD blank
  - Likely cause: listening-state render cleared the display buffer
  - Fix: preserve status text and guard rendering paths

- Symptom: simulator looks wrong or blank
  - Likely cause: wrong port or wrong app target
  - Fix: confirm `apps.json` mapping and start the simulator against port `5173`

- Symptom: the top HUD line still wraps or the connection state is hard to read
  - Likely cause: width assumptions or ASCII-header hacks do not match the real viewport
  - Fix: calibrate on-device and prefer SDK border/container support

## Verification checklist

- The live process matches the edited code path.
- The plugin URL is reachable from the intended device path.
- QR payload contains only the plugin URL.
- Backend `/health` passes and the connection stays up long enough to test the user flow.
- If testing Claude replies, a real reply arrives after transcription or a concrete stderr error is visible.
- If testing UI flow, tap/review/send behavior is verified on the live runtime or simulator, not inferred from source alone.
