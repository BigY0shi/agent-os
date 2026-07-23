# Adapter Notes

Use this reference to map the dream workflow to a specific agent environment.

## Codex

Likely roots:

- Memory registry: `~/.codex/memories/MEMORY.md`
- Summary: `~/.codex/memories/memory_summary.md`
- Rollout evidence: `~/.codex/memories/rollout_summaries/`
- Skill memory extensions: `~/.codex/memories/skills/`

Codex-specific rules:

- Prefer `MEMORY.md` as the registry and open only the rollout summaries it directly points to.
- Cite or record rollout ids when consolidating facts from rollout summaries.
- Do not edit core memory files directly unless the user explicitly asked for memory updates. For review mode, stage under a dream artifact.
- If updating Codex memory through this chat, follow the active memory instructions: write ad-hoc notes rather than editing memory files directly.

## Claude

Likely roots:

- Global files: `~/.claude/CLAUDE.md`, `~/.claude/skills/`
- Sessions/logs: inspect `~/.claude/sessions/`, `~/.claude/projects/`, or local project `.claude` folders if present.

Claude-specific rules:

- Preserve user-authored `CLAUDE.md` wording unless there is direct evidence it is stale.
- Prefer a staged proposed tree over editing `CLAUDE.md` live.
- Treat skill folders as durable procedures, not session memory.

## Hermes

Likely roots:

- Memory: `~/.hermes/memory/`
- Dream artifacts: `~/.hermes/dreams/`
- Sessions/logs: inspect `~/.hermes/sessions/`, `~/.hermes/cache/`, or profile-specific logs if present.

Hermes-specific rules:

- If scheduling cron dreams, verify the Hermes gateway is alive. A scheduled job can remain pending forever if the gateway is down.
- Use review mode for first runs or large memory rewrites.
- For auto mode, write a timestamped dream artifact before promotion.

## Generic Agent

Ask or infer:

- `memory_root`: current durable memory files.
- `session_root`: searchable transcripts/logs.
- `dream_root`: where staged artifacts should be written.
- `mode`: `review` or `auto`.

If the framework has no clear memory store, produce a standalone proposed memory tree and ask where to install it.
