thread_id: 019efd09-ff0a-75e2-8267-0c7bf1de5080
updated_at: 2026-06-25T04:29:11+00:00
rollout_path: C:\Users\Yoshi\.codex\archived_sessions\rollout-2026-06-24T21-29-11-019efd09-ff0a-75e2-8267-0c7bf1de5080.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# Root-caused a WebSocket flood and started a 3-part fix.

Rollout context: A Claude Code session in the cc-g2-win plugin/backend stack, focused on diagnosing a runaway request storm/slowdown and patching the client-side reconnect behavior.

## Task 1: diagnose and fix WS/request flood

Outcome: partial

Preference signals:
- the user said, "Whichever you think is best. There's also a few other issues" -> in similar debugging/fix sessions, proceed with the safest broader fix when the user defers the choice instead of waiting for extra back-and-forth.
- the user asked to avoid destructive ops earlier in the session (assistant corrected away from `Clear-Content`) -> prefer non-destructive log handling and fresh filenames when capturing evidence.

Key steps:
- Confirmed the storm had already stopped: no `dev.ps1`/`uvicorn`/`main.py` running, TIME_WAIT was low, and the suspicious pids were gone.
- Read `plugin/src/ws.ts` and ruled out the reconnect loop as the source because it had capped backoff, a single socket, and timer cleanup.
- Isolated the backend alone for ~6s and saw zero requests / zero 404s, which strongly suggested the flood only happened when the full dev stack was up.
- Traced the likely leak to `main.ts`: `ws = new BackendWs()` on each Connect click without destroying the previous instance, plus missing `import.meta.hot.dispose` teardown; proposed/started a 3-part fix: destroy-before-new, HMR dispose cleanup, and a reconnect cap / visible unreachable state.

Failures and how to do differently:
- The exact 404 path artifact was lost because the relevant windows had already closed, so the final cause could not be fully proven from live logs.
- The rollout ends after an edit/read step, without final test/verification that the patch eliminated the flood; future similar fixes should be rechecked with a clean repro after patching.

Reusable knowledge:
- `127.0.0.1:<port> ... 404 NOT FOUND` in this context was the uvicorn access log; the `<port>` is the client ephemeral source port, not the backend port.
- Backend-alone isolation with a short-lived access-log run was a useful discriminator: no traffic there meant the flood depended on the full dev stack.
- `main.ts` was implicated because repeated Connect clicks / HMR reloads could accumulate orphaned `BackendWs` instances if teardown is missing.

References:
- `plugin/src/ws.ts` reconnect logic had capped backoff and timer cleanup.
- `main.ts:308` created `new BackendWs()` on Connect without first destroying the prior instance.
- `ws.ts:74`, `ws.ts:112` were referenced as the reconnect + heartbeat timer ownership points.
- Proposed fix set: `ws?.destroy()` before re-creating, `import.meta.hot.dispose(() => ws?.destroy())`, and reconnect cap / backend-unreachable state.

