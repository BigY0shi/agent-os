# fix-idea-judge-parse (2026-10-21)

Morning Brief 2026-10-21: "Idea Engine judge seat still degraded: 39 of 55 verdicts are defaults".

## Evidence
- Newest dossier `~/.agentic-os/idea-engine/dossiers/74901525-a21.md:98`: `Degraded seats ... painMiner, judge:parse`.
- Run logs `~/.agentic-os/idea-engine/runs/<id>.jsonl`, seat `judge`, `ok: true`: the judge DID answer.
  Re-parsing the last 6 judge outputs with the module's own regex + JSON.parse: 5 fail with
  `Expected ',' or '}' after property value` at the last character; 1 parses.
- Depth trace: in all 5 failures `verdict` sits at depth 2 (inside `scores`) and the reply ends at
  depth 1 (outer object never closed). In the one that parsed, `verdict` is at depth 1.
  The model forgets to close `scores` before `verdict`. The prompt template itself is balanced.
- painMiner failures in the same runs are a separate cause: `[timed out after 480000ms]`.

## Names (copied from src/lib/ideaValidation.ts)
- `function extractJson<T>(raw: string): T` (line 80), module-private, used for painMiner,
  marketMapper, sizingAnalyst, judge, writer.
- `judgePrompt(idea, evidence, killCase)`; `interface JudgeOut { scores?: Record<string, Partial<Score>>; verdict?: { call?: string; rationale?: string } }`
- degraded marker string: `"judge:parse"`; default rationale `"judge seat degraded — verdict defaulted to watch"`.
- consumers: `judge.verdict?.call` (line 323), `judge.scores?.opportunity|pain|timing|feasibility|moat` via `sanitizeScore`.
- smoke: `scripts/v2/smoke-idea-seats.mjs` (sections A-D, `check(name, cond, extra)`), env redirected to temp.

## Fix
- `extractJson`: strict parse first; on failure, append the closers for any `{`/`[` still open at
  the end (outside a string) and parse again. Content is never removed or invented.
- `parseJudgeOutput(raw)` (exported): `extractJson`, then if top-level `verdict` is missing and
  `scores.verdict` is an object, move it up.
- Smoke section E covers both with synthetic fixtures shaped like the failing replies.

## Not fixed here
- The 39 existing dossiers keep their defaulted verdicts. Their raw judge replies are still in
  `runs/*.jsonl`, so a re-score is possible as a separate step.
