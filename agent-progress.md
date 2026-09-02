# Agent Progress - Agent OS harness

Cross-session state for the Ralph harness (scripts/harness/ralph-loop.sh). Each session
reads this first and updates it last. Keep it short and current: it is the working memory
a cold-started session trusts. The roadmap itself is ROADMAP.md; the journal is
DEV-JOURNAL.md (hyphen, not underscore).

## Now
- (nothing in progress)

## Next
- feat-s8-voicebox-everywhere, then top-down through features.json

## Standing notes for every session
- The owner is away (errands, from 2026-09-02 16:14 PDT). He wants as many features done
  as possible until the loop stops; a feature you cannot finish is skipped, not fought:
  write why in its `notes`, leave it `failing`, and do NOT write the stop marker (see AGENTS.md 'Stopping early') for it
  unless the whole loop must stop. (The two pause markers are named in AGENTS.md; never
  spell them in this file unless they are live.) The loop picks the next `failing` row top-down, so a
  skipped row would be picked again: set its `status` to `"failing"` and append
  `SKIP <date>: <reason>` to notes; the operator will reorder.
- Rate limit / API error mid-session: commit what is green, write the state here, stop.
- The Agent OS server on 3737 belongs to the owner; never start, stop or restart it.
- Stage explicit file lists only. The tree carries ~50 of the owner's dirty files.
- Every code commit needs a version bump (`npm run version:bump -- minor|patch`) and a
  staged doc (DEV-JOURNAL.md / ROADMAP.md) or the commit-msg hook rejects it.
- Re-render the roadmap page after a slice: `node scripts/roadmap-page.mjs`. Publishing
  the Artifact is the supervising session's job; leave the HTML at ~/.agentic-os.

## Log (newest first)
- 2026-09-02 16:30 harness installed: features.json holds S8, S6, S3, backlog wrap, S4,
  S5, S7, S9 (S10 has no spec and is not listed). Gate = ./test.sh (tsc + every offline
  smoke). Loop default model claude-fable-5-1, --strict-mcp-config.
