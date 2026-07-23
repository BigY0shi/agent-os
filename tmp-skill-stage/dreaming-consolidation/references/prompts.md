# Prompt And Scheduler Patterns

Use these patterns when wiring dreams into another agent or scheduler.

## Universal Dream Prompt

```text
You are performing a memory consolidation dream.

Memory root: <memory-root>
Session root: <session-root>
Dream artifact root: <dream-root>
Mode: review

Follow this pipeline:
1. Orient: read the memory index and skim existing topic files.
2. Gather signal: search recent sessions narrowly for drift, repeated patterns, stale facts, and contradictions. Do not read whole transcript files.
3. Consolidate: edit only the staged proposed memory tree. Merge overlapping topics, convert relative dates to absolute dates, delete contradicted facts at the source, and preserve working memories.
4. Prune and index: keep the index under 200 lines, with one-line pointers to topic files.

Evidence rules:
- Promote only patterns seen in 3 or more independent sessions, unless the user explicitly gave a direct preference.
- Do not hallucinate memories. If evidence is weak, put it in the changelog as "not promoted".
- Summarize logs instead of pasting raw tails.

Deliver:
- proposed/ memory tree
- diff.patch
- changelog.md
- metadata.json
```

## Narrow Search Examples

```bash
rg -n "ModuleNotFoundError.*torch" <session-root>
rg -n "always use|never use|prefer .* over" <session-root>
rg -n "AGENTOS_PASSWORD|LOCAL_MODEL|OPENROUTER_API_KEY" <session-root>
```

## Scheduling Guidance

Start conservative:

- First run: review mode.
- Early cadence: daily or weekly.
- Mature cadence: every 6 to 24 hours only if the memory store is actively changing.

Do not schedule a dream before confirming:

- Memory root exists.
- Session root exists or a search API is available.
- Artifact root is writable.
- The scheduler process is actually running.

## Promotion Checklist

Before promoting review output:

- Inspect `changelog.md`.
- Inspect `diff.patch`.
- Confirm deleted/merged files are intentional.
- Confirm no secret values were copied into memory.
- Confirm index links resolve.
