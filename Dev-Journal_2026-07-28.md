# Dev Journal — 2026-07-28

## Audit Console module (feat-004 of the Business Audit Engine harness)

New sidebar module under **Agent Orchestration**: start and watch Business Audit Engine
runs from the dashboard. The engine stays standalone at `C:\Users\Yoshi\Documents\
BusinessAuditEngine` (override with `AUDIT_ENGINE_DIR`); Agent OS shells to its CLI and
**never writes audit state** — job bookkeeping lives on `globalThis`, in memory only.

- `src/lib/auditEngine.ts` — the bridge. `engineQuery()` for fast reads (`cli.mjs list`,
  `status`) parsing the CLI's JSON; `startAuditJob()` spawns `node cli.mjs run|distill|
  warroom` fire-and-forget with a tail buffer, mirroring the Deal Desk scrape job. A CLI
  failure is surfaced with its last stderr lines, never as an empty response.
- `src/app/api/audit/route.ts` — GET: clients + current job (one poll target).
- `src/app/api/audit/run/route.ts` — POST starts (409 if busy) and returns immediately;
  GET reports the job heartbeat plus the engine's own per-agent/per-pass status.
- `src/app/api/audit/warroom/route.ts` — GET serves `clients/<slug>/war-room.html`
  straight from the engine (served, never copied).
- `src/components/AuditConsole.tsx` + `/audit` page — client table (state, stage, brief
  readiness), ensemble-passes selector (default 3), Audit/Distill/War Room/View actions,
  live job panel with per-agent chips, per-pass chips and a log tail. The poller
  re-attaches on mount, so a reload during a multi-minute run resumes watching.
- `Sidebar.tsx` — `/audit` ("Audit Console", Radar icon, emerald) added to NAV and to
  `ORCHESTRATION_ROUTES` (membership is what places it under Agent Orchestration).

Verified: `npx tsc --noEmit` exit 0. Live click-through pending the next rebuild.
Design hook: the two side-accent status borders kept deliberately — same idiom as the
HireEngine/Deal Desk cards, and the color is the status signal.

Rollback: delete `src/lib/auditEngine.ts`, `src/app/api/audit/`, `src/app/audit/`,
`src/components/AuditConsole.tsx`; revert the two Sidebar.tsx lines.
