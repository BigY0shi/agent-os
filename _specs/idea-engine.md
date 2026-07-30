# Idea Engine — Trend Surfacing + Validation + Dossier (Spec v1)

Status: APPROVED 2026-07-30.
Sources: design session 2026-07-30 + the user's `idea-dossier-schema-extraction.md`
recipe (its hardening discipline is adopted wholesale; its sample-mining phase is
deferred — see "Schema lineage" below).

## What we're building

A module that does what Exploding Topics / Glimpse / Treendly (surface trends),
DimeADozen / ValidatorAI / PainMap (validate ideas), and IdeaBrowser (daily
opportunity dossier) sell — locally, evidence-first, on the operator's own
subscriptions. Three stages, one pipeline:

```
RADAR (signals→candidates) → VALIDATION (council + kill-pass) → DOSSIER (schema→report)
```

Any stage is usable alone: type an idea straight into Validation; read Radar
without ever validating; re-render past dossiers from stored JSON.

## Non-negotiable invariants (from the extraction recipe — these ARE the product)

1. **Zero unsourced numerics.** Market sizes, growth rates, prices: every one
   carries `{value, sources[{url, retrieved, excerpt_locator}], confidence, method}`
   or is `insufficient_evidence`.
2. **`insufficient_evidence` is a first-class value.** Never interpolate a
   plausible number. A dossier with honest gaps beats a fluent fabrication.
3. **Scores expose their inputs.** Every score stores the component values it was
   computed from; a score without stored inputs is invalid and dropped.
4. **Schema is versioned and additive-only after v1** (`schema_version` field).
5. **The validator never grades its own homework.** The kill-pass seat runs on a
   different model lineage than the research seats; the verdict judge sees the
   kill case before scoring.

## Stage 1 — Trend Radar

Source adapters (server-side, all keyless except Tavily which uses the existing
outreach key). Each emits `RawSignal {source, term, title?, url, metrics{},
excerpt?, capturedAt}`:

| Adapter | Mechanism | Signal |
|---|---|---|
| Google Trends | `pytrends` via python (own venv under `~/.agentic-os/idea-engine/venv` — do NOT contaminate `~/.browser-use-env`) | interest-over-time growth, breakout related queries |
| Reddit pain mining | public JSON (`/r/<sub>/top.json`, search) over a configurable sub list + pain phrases ("is there a tool", "why is there no", "i'd pay for") | recurring complaints, demand phrasing, upvote mass |
| Hacker News | Algolia REST (free) | what builders discuss/upvote; Show HN traction |
| Product Hunt | leaderboard scrape (best-effort; token-based GraphQL if user later adds one) | what's shipping and winning |
| Google Autocomplete | `suggestqueries` endpoint (free) | demand phrasing expansion around seed terms |
| Tavily news | existing key (`~/.agentic-os/outreach/config.json`) | news momentum for candidate terms |

**Clustering pass** (cheap tier — kimi or haiku): groups raw signals into named
**candidates** `{topic, thesis, signals[], firstSeen, momentum}`. Candidate scores
(each with stored inputs, invariant #3): momentum, pain intensity, builder
activity. Board columns: `new / watching / validating / validated / parked`.
Signals persist so re-scans ACCUMULATE evidence per candidate (cursor dedupe,
same pattern as the Agents module's pollers).

## Stage 2 — Validation Engine

Input: a Radar candidate OR a typed idea (or a Brainstorm brief — accept-brief
integration later). Cross-lineage fan-out per the orchestration doctrine:

| Seat | Lineage | Job |
|---|---|---|
| Pain miner | claude (web-capable via builder posture) | quoted pain evidence with URLs — forums, reviews, reddit |
| Market mapper | claude (web) | competitors, pricing, positioning gaps — every claim sourced |
| Sizing analyst | kimi or codex (given the harvested evidence, no web) | bottom-up sizing with `method` shown, or `insufficient_evidence` |
| **Kill-it adversary** | codex (MUST differ from research seats) | strongest case against; flags unfalsifiable claims and hollow evidence |
| Verdict judge | claude (sees kill case + all evidence) | bounded scores (inputs stored) + call: `build / watch / pass` |

Runs are resumable and logged (JSONL per run, Deal-Desk-brief-batch style job
status). Failure of one seat degrades the run (recorded), never fabricates.

## Stage 3 — Dossier Generator

Writer seat (opus-tier) populates **idea-dossier schema v1** from validation
output, then renders markdown. Both stored: `dossiers/<id>.json` (source of
truth) + `<id>.md` (render). Archive browsable in the UI; re-render is free.

**Schema v1 top level** (every factual leaf wrapped in the provenance envelope):

```
schema_version, id, generated_at
identity   { title, one_liner, category, tags[] }
opportunity{ problem, avatar, pain_evidence[], why_now, trend_signals[] }
market     { size_estimates[], competitors[], gaps[], moat_potential }
business   { model, pricing_anchor, value_ladder[], channels[], first_customers }
execution  { mvp_scope, build_plan[], time_to_mvp, founder_fit_notes }
scores     { opportunity, pain, timing, feasibility, moat }   // each {value, scale, inputs[], method}
verdict    { call, rationale, kill_case_summary }
provenance { model_seats{}, run_cost, signal_ids[] }
```

**Schema lineage:** v1 is designed, not induced — the user's extraction recipe
runs LATER as a refinement pass once 12+ IdeaBrowser samples are captured (the
`save-framed-webpage` skill is the capture tool). Additive-only from v1, so
refinement extends rather than breaks.

## Daily Idea

Scheduler tick (registered in `src/instrumentation.ts` beside the Agents
scheduler): at the configured hour, run a Radar scan, auto-validate the top new
candidate, emit its dossier as **Idea of the Day**. Settings-gated: on/off,
hour, and a hard cap of one auto-validation per day (cost guard). Everything
else is on-demand.

## Module mechanics

- Route `/idea-engine`, sidebar under **Agent Orchestration**.
- Data: `~/.agentic-os/idea-engine/` — `signals.json`, `candidates.json`,
  `dossiers/`, `runs/`, `venv/` (pytrends).
- Settings (ModelSettings pattern + module gear): source toggles, reddit sub
  list, seed terms, daily on/off + hour, model dials per seat tier
  (cheap/research/writer — defaults kimi-k2.6 / claude-sonnet-5 / CLAUDE_MODEL).
- Client-safe types in their own file (the HIRE_COLUMNS lesson).
- Costs measured, not guessed: every run records wall-clock + which seats ran;
  the first end-to-end run reports its cost in the run log.

## Build order (thin end-to-end; each step leaves it usable)

1. **Core spine:** schema v1 + storage + manual-idea Validation → Dossier
   (renderer + archive UI). Smoke on the recipe's control target:
   *powersports dealership service-department intake* — a market the operator
   knows cold, so hollow output is recognizable on sight.
2. **Radar:** adapters + clustering + candidate board; "Validate" button feeds
   stage 1's spine.
3. **Daily idea:** scheduler + settings + Idea-of-the-Day surface.
4. **Later (explicitly out of v1):** IdeaBrowser sample capture + the extraction
   recipe as schema refinement; Product Hunt GraphQL token path; Brainstorm
   accept-brief → auto-validate hook.

## Open questions

None blocking — reddit sub list and seed terms ship with editable defaults.
