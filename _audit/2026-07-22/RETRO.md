# Audit Run #1 — Retro (data point for the reusable workflow)
Captured fresh right after the Agent OS audit. Goal: after run #2 on a different project, diff the two to extract the invariant skeleton (→ reusable skill/workflow) from the project-specific scaffolding.

## The skeleton that worked (candidate invariant)
1. **Recon** — read repo structure + docs + memories, confirm the app runs, form falsifiable hypotheses (H1..Hn) BEFORE spawning agents.
2. **Pass 1 fleet (parallel, read-only)** — partition the codebase by AREA, one agent each, with a strict output contract (severity tag P0-P3 + file:line + evidence quote + fix + confidence). Areas used here: core-plumbing · front-page/entry · all API routes · views×N (grouped by domain) · security (dedicated auditor) · build-health. + 1 independent CROSS-LINEAGE critic (Codex) on the core.
3. **Pass 2 (exec/value lens)** — re-judge the same system against the USER's real goals (only very-high-confidence truths), map modules to mission, find synergy gaps, propose new/merged modules.
4. **Councils on the debatable calls** — 4 cross-lineage seats (Codex/OpenAI + Hermes/local + 2 Claude), each a contrasting persona (Nemotron set), given the QUESTION + evidence only (never each other's takes). A bias-aware Judge names its own biases and rules narrowly. One council per pass (engineering triage / roadmap).
5. **Journal continuously**, then a **grounded human-readable presentation** (Artifact) themed to the subject.

## What to PARAMETERIZE (varied by project — the workflow's inputs)
- `projectPath`, tech stack (drove the "Windows portability" theme here — will differ elsewhere).
- Area partition + fleet size (scale agent count to repo size).
- Whether a Pass-2 exec/personal lens applies at all (here it did: solo-founder mission; a team OSS project might skip it or use a "maintainer" lens).
- Council questions (emerge from Pass 1 — can't be hardcoded).
- Persona picks + Judge framing (kept generic; re-draw per run).
- "Make it live" emphasis vs pure review.

## What to FIX in the workflow (run-#1 lessons — the perishable data)
- **Subagents over-spawned children** against instructions (2 of the view-agents fanned out their own sub-agents; their results reported to the PARENT, not to me → I had to resume them to compile). Workflow must either forbid nested spawning explicitly OR use the Workflow engine's `pipeline`/`parallel` so fan-out is deterministic and results always land at the top.
- **Codex background stdout needs a flush delay** before reading (first read came back empty; content appeared seconds later).
- Agents returned huge reports; the manager (me) had to compress into the journal each time. A workflow should force a STRUCTURED SCHEMA return (JSON findings) so synthesis is mechanical, not prose-wrangling.
- Verification-gate worked: I re-confirmed the 2 headline P0s (fake telemetry, empty .git) FIRST-HAND before asserting. Keep this as a mandatory step (manager verifies top-N findings before the presentation).
- Council personas + bias-aware judge produced genuinely useful friction (real dissents: hard-fork vs re-clone; wire-Radar vs exile). Keep.
- Presentation grounded in the app's OWN visual identity landed well. Keep "theme to subject."

## Open question for the workflow's shape
- **Skill vs Workflow-script vs both.** Leaning: a `/<name>` SKILL (one-command trigger + the gotchas above) that DRIVES a Workflow JS script for the deterministic parallel fan-out + council. Decide after run #2 shows which parts are truly fixed.
- Reusable sub-primitive: the **cross-lineage council + bias-aware judge** is useful far beyond audits (any debatable decision). Might extract it as its own skill the audit calls.
