# Dev Journal — 2026-07-30

## Idea Engine — trend surfacing + validation council + evidence-first dossiers

**Commits:** `18434af` (Phase 1: spine) · `778711b` (Phases 2+3: radar + daily)
**Rollback:** revert both; `~/.agentic-os/idea-engine/` data (signals, candidates,
dossiers, pytrends venv) survives harmlessly.

New Agent Orchestration module (spec: `_specs/idea-engine.md`, approved before
build). Does the Exploding-Topics + DimeADozen + IdeaBrowser job locally:

- **Trend Radar** — six adapters: Google Trends (pytrends, auto-provisioned own
  venv), reddit pain mining (RSS — anonymous JSON is DEAD: 403 on www+old with
  a browser UA, verified live; RSS works with 2s spacing + 429 retry), HN
  Algolia, Product Hunt RSS, Google autocomplete, Tavily news (existing key).
  Cheap-tier clustering (kimi→codex fallback) into opportunity candidates;
  candidate scores computed in CODE from signal metrics so inputs are stored.
- **Validation council** — cross-lineage: pain miner + market mapper (web
  claude), sizing analyst (kimi, evidence-only), KILL-IT adversary (codex —
  different lineage, never grades own homework), judge (sees the kill case),
  writer. Degraded seats recorded, never faked.
- **Dossiers** — schema v1 with the extraction-recipe invariants enforced in
  code: `sanitizeSourced` drops unsourced numerics to `insufficient_evidence`,
  `sanitizeScore` nulls inputless scores (8/8 unit tests on the real bundle).
  JSON is source of truth, markdown re-renderable. The user's
  `idea-dossier-schema-extraction` recipe runs LATER as refinement once 12+
  IdeaBrowser samples are captured (via the save-framed-webpage skill).
- **Daily Idea** — instrumentation loop, one scan + one auto-validation at the
  configured hour, stamp-before-run so the 1/day cap can't double-spend.
  Off by default (settings gear).

**Verified live (esbuild-bundled libs, no rebuild needed):** full council run on
the spec's control target (powersports dealership service intake) — 6/6 seats in
8.5 min, verdict WATCH with an honest "WTP evidence is borrowed from automotive
adjacents" rationale, real competitors (Toma, Numa, Impel, Kenect, Podium, DX1),
2 of 3 sizing estimates correctly `insufficient_evidence`. Radar: 6/6 adapters
ok, 116 signals first scan, 6 on-thesis candidates, dedupe confirmed on rescan.
`tsc --noEmit` clean throughout. UI click-through pends the next rebuild.
