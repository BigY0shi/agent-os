# Task Group: Cross-workflow user identity and naming corrections

scope: Reuse for album-cover, artist-name, identity, and personal-name tasks where the user must not be mislabeled from a workspace path or prior mistaken suggestion.
applies_to: cwd=cross-workflow; reuse_rule=safe across future naming/identity work, but limit reuse to artist-name, personal-name, and identity contexts rather than file-system path names

## Task 1: Correct the user's artist and personal naming for identity-sensitive contexts, success

### rollout_summary_files

- extensions/ad_hoc/notes/2026-07-06-eezus-robby-identity.md (cwd=C:\Users\Yoshi\.codex\memories\extensions\ad_hoc\notes, rollout_path=C:\Users\Yoshi\.codex\memories\extensions\ad_hoc\notes\2026-07-06-eezus-robby-identity.md, updated_at=2026-07-06T03:56:11-07:00, thread_id=ad-hoc-note-2026-07-06, authoritative extension note; corrects a mistaken identity suggestion)

### keywords

- Eezus, Robby, Julian Golde, Golde, artist name, real name, identity correction, album cover, personal name

## User preferences

- When working on album-cover, artist-name, identity, or personal-name tasks, do not refer to the user as "Julian Golde" or "Golde"; use "Eezus" for the dubstep artist name and "Robby" for the real name. [Task 1]

## Reusable knowledge

- This note is an explicit correction to a mistaken suggestion to use "Julian Golde" / "Golde" as the user's name or artist identity, so future naming work should treat that string as a workspace/path artifact rather than a personal-identity default. [Task 1]

## Failures and how to do differently

- Symptom: album-cover or artist-identity work uses "Julian Golde" / "Golde" for the user -> cause: a workspace path or earlier mistaken suggestion was treated like identity evidence -> fix: ground identity-sensitive naming in the authoritative correction: artist name "Eezus", real name "Robby". [Task 1]
