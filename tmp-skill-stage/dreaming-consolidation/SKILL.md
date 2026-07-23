---
name: dreaming-consolidation
description: Safe background or on-demand memory consolidation for Codex, Claude, Hermes, and other agents. Use when asked to "dream", consolidate memory, prune stale memories, resolve contradictory memory entries, extract cross-session patterns, prepare a scheduled memory hygiene job, or produce a reviewable memory artifact from session transcripts/logs.
---

# Dreaming Consolidation

Run a "dream" as a deliberate memory hygiene pass: inspect existing memories, search recent sessions narrowly, stage proposed edits, write a diff/changelog, and promote only when the mode allows it.

## Non-Negotiables

- Default to review mode unless the user or existing scheduler explicitly says auto mode.
- Never read entire transcript/session files. Search with narrow terms and sample only the matching lines or nearby context.
- Require 3 or more independent occurrences before promoting a recurring pattern to durable memory.
- Convert relative dates to absolute dates.
- Resolve contradictions at the source file, not only in the index.
- Preserve working memories. Do not rewrite files just to make them prettier.
- Keep the top-level memory index under 200 lines when one exists.
- Produce a review artifact: proposed tree, changelog, metadata, and a diff when possible.
- Do not dump raw logs into chat. Summarize findings and point to paths.

## Quick Workflow

1. Identify the adapter and paths.
   - Codex: inspect `~/.codex/memories` and recent rollout summaries when available.
   - Claude: inspect `~/.claude` memory/project files and session logs when available.
   - Hermes: inspect `~/.hermes/memory` and session/log roots when available.
   - Unknown framework: ask for or infer `memory_root`, `session_root`, and `dream_root`.

2. Stage a review artifact before editing.
   - Prefer `scripts/dream_artifact.py` to create a timestamped run directory with a copied `proposed/` tree.
   - Edit only the staged `proposed/` tree during review mode.
   - In auto mode, still preserve the staged artifact and diff before promotion.

3. Run the four phases.
   - Orient: read the index and skim existing topic files.
   - Gather: search for drift, repeated fixes, stale dates, and contradictions.
   - Consolidate: merge, update, delete, split, or preserve based on evidence.
   - Prune and index: update the index as a compact pointer map.

4. Verify.
   - Check that referenced files exist.
   - Check the index is compact.
   - Check no staged file contains obvious relative-date rot such as "yesterday" or "last week" unless quoting the user.
   - Generate `diff.patch`, `changelog.md`, and `metadata.json`.

5. Promote only when allowed.
   - Review mode: stop after the artifact and tell the user what to inspect.
   - Auto mode: promote only after a backup/diff exists.

## Resources

- Read `references/pipeline.md` for the exact four-phase checklist and decision rules.
- Read `references/adapters.md` for Codex, Claude, Hermes, and generic path conventions.
- Read `references/prompts.md` when wiring a scheduler or delegating the dream to another framework.
- Use `scripts/dream_artifact.py` to create/stage/diff a dream artifact without overwriting live memory.

## Output Shape

Report:

```text
Dream run: <path>
Mode: review|auto
Sessions searched: <count or search scope>
Memory files changed: <count>
Added: <short list>
Updated: <short list>
Deleted/merged: <short list>
Needs human review: <yes/no and why>
```

Keep the chat summary short. The artifact carries the detail.
