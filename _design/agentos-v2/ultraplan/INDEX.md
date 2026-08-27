# ULTRAPLAN — Index

Produced 2026-08-27 by a 14-agent workflow (6 recon deep-reads of AgentOSCore + agent-os, 6 spec writers, 2 adversarial critics; 3.37M tokens, 443 tool calls, 0 failures). Verdict: **SHIP WITH FIXES** — fixes captured as binding contracts in CONVENTIONS.md.

## Reading order for implementers

1. `../MASTER-PLAN.md` — workstreams, decisions, build order
2. `../DOCS-CHEATSHEET.md` — upstream docs distillation
3. **`CONVENTIONS.md` — BINDING. Overrides conflicting spec text.**
4. Your spec below.

## Specs

| File | Covers | Tasks |
|---|---|---|
| SPEC-A-foundations-memory.md | F1–F4 foundations + A1–A10 Memory V2 | ~40 |
| SPEC-B-tasks-scratchpad.md | B1–B6 Tasks page + Scratchpad (+B7 Skills per CONVENTIONS §11) | 38 |
| SPEC-C-jarvis-webmcp.md | C1–C6 omnipresent Jarvis + D1–D5 WebMCP Engine | 38 |
| SPEC-D-integrations-widgets-home.md | G1–G5 Integrations/Automations + H1–H4 Homepage/Widgets | 30 |
| SPEC-E-browser-agents.md | E1–E4 Browser + F1–F6 Agents page | 33 |
| SPEC-F-notes-newsletter-marketing-3d.md | I AnyNotes + K Newsletter + J Marketing + L Hermes 3D | 28 |

~207 granular tasks total, each with file paths, dependencies, and a verification step.

## Review outcome (33 findings)

- **6 blockers — all resolved on paper in CONVENTIONS.md:** single DB driver/opener (no shims), /api/mcp deny-by-default security, ingestion_rules ownership, scheduler contract unification, execute_action addressing, StatusBand single ownership+palette.
- **12 major — resolved in CONVENTIONS.md:** ISO timestamps everywhere, single ingest seam, attention.flag contract, one Gmail stack (newsletter consumes the connector), widget slug catalog, agentId episode scoping, migration ranges + env-var names, zod v3 pin, vec0 cosine metric declaration, fallback-scaffolding cull, Skills-as-policies ownership (B7), capability-slot registration API.
- **15 minor** — folded into CONVENTIONS §10–11 (AHK POST mechanics, CDP bind, redactArgs, injection guard, Gmail query syntax, path-space, task sizing, etc.).

## Human checkpoints (agents must PARK here, not spin)

- **K1.3** — Google OAuth consent for the agent Gmail (restricted scope; 7-day token churn in Testing mode → IMAP/app-password fallback specced).
- **L1.3** — one manual Blender pass (Synty office scene assembly + Mixamo Idle/Thinking/Talking retarget).
- **F13 physical key** — confirm Yoshi's F13 source (macro pad / remap); install doc includes CapsLock-remap example.

## Standing recommendations for Yoshi

- Rotate the addy.io API key in the dashboard (it transited chat); update `~/.agentic-os/newsletter/config.json`.
- Deploy-gate default is warning-only (`agents.requireTestRun` toggle) — say if you want a hard gate.
- Embed model locks at first ingest (default nomic-embed-text 768d local); changing later = full re-embed.

## Notes

- During recon, two agent outputs tripped the harness's instruction-pattern filter (strings like `dangerously-skip-permissions` found while reading upstream code/settings). Benign — quoted code, neutralized by the harness, no action needed.
- Workflow run id `wf_26015924-907`; per-agent transcripts in the session's subagents/workflows dir if archaeology is ever needed.
