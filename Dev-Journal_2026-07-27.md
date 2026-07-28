# Dev Journal — 2026-07-27
Per-date work log for this session (companion to the running `DEV-JOURNAL.md`).
Newest entry at the top. Every change lists its commit and rollback.

---

## ~23:55 PDT · Content Engine multi-model mandate + Jarvis voice answer (commit `e4bca9e`)
- **Content Engine, per `/multi-agent-mcp-orchestration`:** Claude stays manager (plan + merge), but generation now rotates per item across lineages — codex → kimi (Ollama Cloud) → claude — via `seatForItem()` (stable id hash) + `multiModelComplete()` in `lib/contentEngine.ts` (reuses brainstorm's `seatComplete`). Insights run on **codex** (cross-lineage check: the grader ≠ the planner). Failed seat → Claude fallback, and `materials.by` / `insights.by` record who ACTUALLY wrote it — badges on card, drawer, and the performance read.
- **Jarvis voice question answered:** the Realtime tab already speaks to `gpt-realtime` — the same model behind ChatGPT's Advanced Voice Mode — over WebRTC (`api/hermes/realtime/session`). Caveat: bills `OPENAI_API_KEY` per-minute; the consumer ChatGPT voice mode has no API and codex CLI is text-only. Standard mic loop remains STT → codex/claude → OpenAI TTS butler voice.
- **Class D fix in passing:** realtime tool description said "on the user's Mac" with macOS app examples — now host-neutral with per-platform examples.
**Verified:** tsc clean, build compiled.
**Rollback:** `git revert e4bca9e`.

## ~00:15 (7-28 local, same session) · Jarvis → Codex Voice + standalone (commit `b7f37ad`)
- **Backend swap:** `agent()` in `lib/hermesJarvis.ts` now runs `codex exec --full-auto --skip-git-repo-check --ignore-user-config -` (prompt over stdin) instead of `hermes -z`. Same tool powers, ChatGPT subscription. Fast/auto completion chain untouched (OpenRouter-if-keyed → Claude CLI).
- **Standalone:** new `/jarvis` page + Sidebar entry (Agent Orchestration); Hermes-Jarvis tab removed from `/hermes` (union, valid list, tab button, render branch); `/hermes?tab=jarvis` deep-links redirect to `/jarvis`.
- **Copy:** title "Jarvis", agent tooltip says Codex, wake status drops Hermes, fixed latent "Building it on your Mac, sir…" (macOS copy class D from the 07-25 staleness sweep).
- Backend API routes intentionally stay at `/api/hermes/jarvis*` (path-independent; renaming would touch ~11 client call sites for zero behavior change).
**Verified:** tsc clean; `npm run build` green — `/jarvis`, `/brainstorm`, `/content-engine` all present in the route manifest.
**Rollback:** `git revert b7f37ad`.

## ~23:55 · Content Engine module shipped (commit `3e42641`)
New `/content-engine` (Self section, with SEO/Thumbnails/Video). Three loops:
- **PLAN** — goals + channels + cadence → Claude drafts a dated calendar (`api/content-engine/plan`); replans keep drafted/posted items, replace only untouched planned slots.
- **GENERATE** — per slot (`api/content-engine/generate`): channel-sized copy, hashtags, image prompt (feeds Thumbnails), video script for video formats; copy editable + persisted.
- **MONITOR** — log post URL + views/likes/comments/shares/clicks (manual-first — no platform OAuth exists in this stack); "Analyze performance" → AI read: WORKING / NOT WORKING / DOUBLE DOWN / CHANGE.
State: `~/.agentic-os/content-engine/state.json`. Client-safe types split into `contentEngineTypes.ts` (node:fs bundle rule). **Verified:** tsc clean.
**Rollback:** `git revert 3e42641`.

## ~23:35 · Brainstorm council module shipped (commit `9998f46`)
New `/brainstorm` module in Agent Orchestration — a three-seat ideation council.
- **Seats:** Claude + ChatGPT via their own CLIs (`cliComplete()` from `loopEngine`, subscription auth, no API keys); Kimi via Ollama Cloud (`lib/brainstorm.ts` → `resolveKimiModel()` picks from live `/api/tags` with a k3-first preference — **verified it resolves to `kimi-k3`, which IS live on Ollama Cloud** despite no repo references).
- **Protocol:** new session = diverge (3 concepts per seat, each seat has a distinct voice: depth / execution / contrarian) → converge (cross-examination) → chair synthesis (Claude writes CONCEPT / WHY IT WORKS / MVP SCOPE / BUILD PLAN / RISKS / FIRST ACTION). Follow-up = steer round → brief rewritten.
- **Transport:** NDJSON streaming (same pattern as the Mastermind room), parallel fan-out per round, each reply streams as its seat finishes; a failed seat degrades to a smaller panel instead of killing the round.
- **Persistence:** `~/.agentic-os/brainstorm/<id>.json`, session rail in the UI (top 60).
- **Files:** `lib/brainstorm.ts`, `api/brainstorm/route.ts`, `components/BrainstormView.tsx`, `app/brainstorm/page.tsx`, Sidebar NAV + `ORCHESTRATION_ROUTES`.
**Verified:** tsc clean; live smoke test of the Ollama tag resolution (19 models, kimi tags: k2.5/k2.6/k2.7-code/k3 → resolves `kimi-k3`).
**Rollback:** `git revert 9998f46`.

---

## 23:15 · Journal opened mid-session (backfilled below)

## ~23:10 · Pipeline artifacts fixed — "invalid project name" (commit `6f6c9be`)
**Symptom:** Pipeline ran and logged fine, but every artifact preview rendered "invalid project name".
**Root cause:** one-character regex typo in the project-name guard shared by all preview routes:
`/^(?!.+$)[A-Za-z0-9_.-]+$/` — the lookahead `(?!.+$)` rejects EVERY non-empty string. Intended: `(?!\.+$)` (reject dot-only names like `..`).
**Proof:** `node -e` check — bad regex: `my-app`→false, `x`→false (everything false); fixed: real names true, `.`/`..` false.
**Fix:** replaced in all 7 routes that carried the copy-pasted guard: `api/{claude,codex,antigravity,freeclaude,openclaw,hermes}/preview/[...path]` + `api/hermes/goals/preview/[...path]`.
Pipeline previews go through `/api/freeclaude/preview/free-claude-code/…` (`PipelineView.tsx:16`), so this was the Pipeline bug too.
**Rollback:** `git revert 6f6c9be`.

## ~22:55 · Hire Engine → Deal Desk parity (commits `170b92e` + build fix `ee8634c`)
User: "it is supposed to mimic the Deal Desk." Was a flat card grid; now:
- **Kanban board** — New / Researching / Approved / Sent + trailing Parked, drag-and-drop, machine strip kept as filter (`HireEngine.tsx` rebuilt on the `DealDesk.tsx` pattern).
- **F/E/W scoring** — `deriveScores()` in `lib/hireDesk.ts`: Fit = machine coverage (capped 3 if enriched company too large), Ease = machine built? (9/5, −1 part-time), Win = salary signal (±firmo fit). Composite = Deal Desk weights 0.4E+0.4W+0.2F.
- **Briefs** — new `POST /api/hire/brief` → summary/why/approach/crashCourse via `claude -p`; amber Project Summary box + Approach + Crash Course sections in drawer; "Generate brief" CTA.
- **Ask AI** — new `POST /api/hire/ask`; Q&A persisted per lead (last 20), rendered in drawer.
- **Notes** — drawer textarea wired to the existing `notes` action (was API-only).
- **Pitch edits persist** — new `action:"pitch"` in `/api/hire/action` (drawer previously dropped hand edits silently).
- **Enrichment cues** — cyan headcount chip (red when fit=poor / lookup failed), amber `brief` badge, purple `pitched`.
- **Descriptions** — run through shared `formatDescription()` (bullets/sections instead of one flat line).
- **Build fix** (`ee8634c`): `HIRE_COLUMNS` moved to client-safe `lib/hireDeskColumns.ts` — importing the value from `hireDesk.ts` pulled `node:fs` into the client bundle and broke `npm run build`.
- Sidebar move (Self → Agent Orchestration) was already at HEAD (`60e66de`).
**Verified:** `tsc --noEmit` clean; `npm run build` green after `ee8634c`.
**Rollback:** `git revert ee8634c 170b92e`. State file `hire-state.json` gains `brief`/`answers` keys — old code ignores them, safe.

---

## Queue (as of 23:15)
1. ~~Pipeline "invalid project name"~~ ✅ `6f6c9be`
2. **Brainstorming module** — Agent Orchestration; mini council of Claude + ChatGPT (codex CLI) + Ollama Cloud Kimi K3; topic/idea/goal → developed project idea. (Explore agent mapping the Mastermind/CLI plumbing now.)
3. **Content Engine module** — plan a posting calendar → generate the materials → monitor engagement/success metrics.
4. **Jarvis** — replace Hermes with Codex Voice; make Jarvis a standalone module.
