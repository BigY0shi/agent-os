# Dev Journal — 2026-07-30

## launchworks.io email — Google Workspace live

robby@launchworks.io created (Business Starter). DNS in Namecheap, all verified
on 8.8.8.8: MX @→smtp.google.com prio 1 (Custom MX), SPF
`v=spf1 include:_spf.google.com ~all`, DKIM google._domainkey 2048-bit
(admin console: "Authenticating email with DKIM"), DMARC `p=none;
rua=robby@launchworks.io`. Domain-release case 73818186 closed; its CNAME left
in place. **Rollback:** MAIL SETTINGS back to Private Email preset + restore
`v=spf1 include:spf.privateemail.com ~all`; DKIM/DMARC TXTs are inert if unused.
**Open:** Hire Engine Gmail-MCP drafts still author from robbyjdenton@gmail.com —
send-as alias vs MCP-on-Workspace not yet decided. New-domain warm-up applies.

## Adversarial pass before rebuild — lifecycle gaps closed

**Commit:** `d347e4b` · **Rollback:** revert it (pure additions + one dial).

Pre-rebuild sweep of the whole delta found 5 gaps, all lifecycle (undo/abort/
visibility), none happy-path:
1. No cancel for a running council → `cancelValidation` + DELETE on
   /api/idea-engine/validate + UI Cancel button; execute() re-checks status at
   every stage boundary so a cancelled run can never publish a dossier.
2. No dossier removal → `exileDossier` (house rule: moved to
   `~/.agentic-os/idea-engine/.exile/<ts>/`, never deleted) + DELETE route +
   trash icon w/ confirm. Live-verified via bundled smoke (moved, archive clean).
3. Manual "Validate ↑" never linked the candidate → daily loop could re-burn
   its 1/day slot on an already-validated candidate. candidateId now flows
   UI → route → run; candidate patched validating/validated/reverted in the
   engine itself (both flows benefit; daily's own patches stay, idempotent).
4. Daily run failures were invisible (banner needed a dossierId) → muted note
   line now surfaces daily.note when today's slot was spent without a dossier.
5. Hire Gmail draft model was hardcoded → `settings.hire.draftModel` dial
   (default claude-sonnet-5), read at call time, gear field added.

`tsc --noEmit` clean.

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
