# Dream Pipeline

Use this reference when executing a memory consolidation dream.

## Phase 1: Orient

Goal: understand the existing memory shape before editing.

Actions:

1. List the memory root and identify the index file. Common names are `MEMORY.md`, `CLAUDE.md`, or a project memory summary.
2. Read the index completely if it is reasonably small.
3. Read or skim each topic file referenced by the index.
4. Identify overlapping topics, stale-looking files, and high-signal files.

Do not edit during orientation.

## Phase 2: Gather Signal

Goal: find evidence worth preserving without exhausting context.

Priority order:

1. Drift: existing memories contradicted by recent sessions.
2. Recurrence: the same preference, workflow, bug, fix, or tool quirk appears in 3 or more sessions.
3. Staleness: relative dates, vanished tools, old paths, outdated model names, obsolete commands.
4. Cross-session patterns: a pattern no single session captured cleanly.

Use targeted search:

```bash
rg -n "exact error or tool name" <session-root>
rg -n "preference|always|never|use .* instead" <session-root>
```

Avoid:

- Reading complete transcript JSONL files.
- Promoting one-off mistakes.
- Treating old as wrong without newer contradicting evidence.

Working list format:

```text
FINDINGS
- UPDATE: environment/tools.md - Node moved from 20 to 22, confirmed in 3 sessions.
- MERGE: preferences/coding-style.md + preferences/typescript.md - overlapping TS rules.
- DELETE: pitfalls/old-cli-bug.md - fixed by newer version, contradicted by current logs.
- PRESERVE: preferences/communication.md - still accurate, no change.
```

## Phase 3: Consolidate

Goal: apply only evidence-backed changes.

Rules:

- Merge into existing files when a topic already exists.
- Create a new topic file only for a coherent domain that does not already have a home.
- Delete contradicted facts from their source files.
- Convert relative dates to absolute dates.
- Split files that have become god-files. As a rough guide, consider splitting topic files over 100 lines.
- Preserve precise operational wording if it carries meaning.

Suggested topic layout:

```text
memory-root/
  MEMORY.md
  preferences/
  environment/
  workflows/
  pitfalls/
  projects/
```

Do not force this layout if the target agent already has a different convention. Improve the existing convention.

## Phase 4: Prune And Index

Goal: keep startup memory fast.

Actions:

1. Remove pointers to deleted or merged files.
2. Add one-line pointers to new topic files.
3. Demote verbose summaries into topic files.
4. Resolve index-level contradictions.
5. Reorder high-use topics toward the top.
6. Keep the index under 200 lines when possible.

## Quality Gates

- Every new durable memory has evidence or a clear source.
- Every deleted memory has a reason in `changelog.md`.
- Index links point to real files.
- No raw transcript/log dumps in `changelog.md`.
- `diff.patch` can be reviewed without reading the whole memory tree.
