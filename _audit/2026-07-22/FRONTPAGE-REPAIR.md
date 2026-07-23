# Agent OS — Front-Page Repair (work log)
**Date:** 2026-07-23 · follows the 2026-07-22 audit (`agent-os-audit.html`).
**Goal:** make the home screen honest and usable ("up and running ASAP") — replace fabricated telemetry with real data, kill dead links, and swap the roster for something that moves the flywheel.
**Status:** all changes applied to source + `tsc --noEmit` clean. **They go live on the next `npm run build` + server restart** (this is a production build; the running server serves the old bundle until rebuilt — see §5).

---

## 0. Git safety baseline (do-first, so everything is reversible)
The repo's `.git` was empty (no history). Before editing, a baseline was created:
- `git init -b main` → commit **`202ed22`** ("baseline snapshot before Phase-0 repair"), 1190 files.
- Added `.exile/` to `.gitignore` (local backup dir, not for git).
- **Rollback anything here:** `git restore <file>` (uncommitted) or `git checkout 202ed22 -- <file>` to revert a file to the baseline. `git diff 202ed22` shows everything changed since.
- *Not done:* recovering the original upstream (juliangoldie) history via re-clone. Optional later; the baseline is a clean local restore point regardless.

## 1. Front-page honesty fixes (removed fabricated data)
| Widget | Was (fabricated) | Now (honest) | File |
|---|---|---|---|
| Fleet telemetry | status by array index (agent #4 always "error"), tokens/cost by formula | all agents idle, usage zeroed until a real telemetry feed exists | `src/lib/store.ts` (`seedRuntime`) |
| **HeroGreeting** | fake "active" count, "all systems nominal", 2 dead buttons | real counts from store; buttons wired → `/pipeline` and `/claude` | `src/components/dashboard/HeroGreeting.tsx` |
| **KPIGrid** | hardcoded "4/7 · 142 · 4.8s · $14.82" + fake sparklines | active-agents real from store; the 3 unwired tiles show "—" (telemetry not wired) | `src/components/dashboard/KPIGrid.tsx` |
| **MissionStripe** | frozen "UPTIME 07:42:14", fake BUILD + BRIDGE version | frozen fakes removed; honest static identity only | `src/components/dashboard/MissionStripe.tsx` |
| **AssistantPanel** | recs about nonexistent agents (Atlas/Orion/Vega/Lyra), fake PR #4218, "● LIVE", dead "Execute plan" | honest "not wired yet" note + working `/claude` link | `src/components/dashboard/AssistantPanel.tsx` |
| **MiniTimeline** | random events under a permanent "LIVE" badge | polls real `/api/activity` (openclaw+hermes logs) every 8s; LIVE only when real data; honest empty state | `src/components/dashboard/MiniTimeline.tsx` |

## 2. Dead-link (404) fixes
- **`/chat` → `/claude`** — there is no `/chat` route. Fixed in HeroGreeting (Open chat) and AssistantPanel (the assistant link was already pointing at the dead `/chat` before this session).
- **`/agents/<id>` → `/<id>`** — the SystemMap "bridge" nodes linked to a nonexistent `/agents/*` route. Agent IDs (`claude`, `codex`, `hermes`, `antigravity`, `ollama`, `cursor`, `pi`, `openclaw`) match the real routes, so `/<id>` resolves. `src/components/dashboard/SystemMap.tsx`.
- The old **FleetSummary** roster ("Manage" → `/agents`, rows → `/agents/<id>`) was the other source of these 404s — removed from the home page (see §3).

## 3. Roster → Deal Desk summary (new widget)
Replaced the fleet roster on the home page with a real **Deal Desk** summary — the "deals in flight" number the audit's founder-cockpit thesis pointed at.
- New: `src/components/dashboard/DealDeskSummary.tsx`; swapped into `src/components/Overview.tsx` (was `<FleetSummary />`).
- Reads real data from `GET /api/deals/list` (→ `lib/upworkDesk.ts listDeals()`, which reads `board.json` from the scraper).
- Shows: a prominent **"Ready to send"** count (deals awaiting your approval — the actionable number), then per-column counts (New · Reviewing · Approved · Ready · Sent). Honest loading + "No deals on the board yet" empty states. Links to `/deals`.
- `FleetSummary.tsx` was **left in place** (not deleted) — just no longer imported on the home page. Reusable if wanted.

## 4. Live event stream — coverage note (not a bug)
`/api/activity` only tails the **openclaw + hermes** agent log dirs (`config.openclawLogs`, `config.hermesLogs`). It does **not** watch the Pipeline, Loop, or Deals — so a pipeline run won't appear there, and if those log dirs are empty the timeline honestly shows "No recent activity." Broadening it is a real follow-up (see §7), not a one-liner.

## 5. How to apply
```bash
cd "C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/agent-os" && npm run build
```
Then restart the server at a stopping point (the assistant does not restart it — the app is a live LAN prod server and you restart at your convenience). **Hard-refresh** the browser (Ctrl+Shift+R) — the prod build caches the old page.

## 6. Configuration & alternatives
- **Deal Desk data path** — env var **`UPWORK_LEADS_DIR`** in `.env.local` (default `~/Documents/Upwork-Leads`). It's the *directory* holding `board.json`/`pitches.json`/`feeds.json`. Use forward slashes; restart to pick up (no rebuild needed for an env-only change).
  - *Alternative if you want UI control:* add a field in a settings menu that writes `~/.agentic-os/settings.json` and have `upworkDesk.ts` read `settings.deals.leadsDir` first, then the env var. Small add; not done (you said env is fine).
- **"Open chat" target** — currently `/claude`. Alternatives: `/room` (AI Agent Mastermind) or a future dedicated `/chat` route if one is ever added. One-line change in HeroGreeting + AssistantPanel.
- **KPI "telemetry not wired" tiles** — to make Runs/Turn-time/Cost real, add a `/api/fleet/runtime` feed (aggregating session data from the codex/hermes session stores) and read it in `store.ts`/KPIGrid. Until then they honestly show "—".
- **Roster replacement** — swapped in Deal Desk; the alternative offered was an **Oracle** entry widget. Either can live there; it's one import swap in `Overview.tsx`.
- **Rollback** — any change: `git checkout 202ed22 -- <file>`. The whole front page: `git checkout 202ed22 -- src/components/dashboard src/components/Overview.tsx src/lib/store.ts`.

## 7. Known-not-done / out of scope (this session)
- **SystemStatusBanner** (in `KPIGrid.tsx`) still has fabricated "41ms / 1.18V / 4 active loops" — but it is **not rendered on the home page**, so it was left alone. Fix or remove if you ever mount it.
- **Unified activity feed** — broaden `/api/activity` (or a new `/api/fleet/activity`) to include pipeline/loop/deals events, so the timeline reflects the whole system, not just openclaw/hermes.
- **Remaining audit roadmap (unstarted):** the **security tourniquet** (rate-limit login, close the `project=".."` path-traversal to `~/.agentic-os` secrets, constant-time cookie compare) — the council's #1; then Loop-engine fixes; then the Deal Flow merge (Leads + Deal Desk into one approval-queue funnel).
- **Agent-module consolidation constraints (your notes, 2026-07-23):** keep **Agent Council chat (`/room`), Oracle, News Radar** standalone; **Jarvis** → decompose to mic → STT → hermes/Claude CLI → **ElevenLabs TTS** (valid key; route already supports it) instead of the dead OpenAI Realtime default.
