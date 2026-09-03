# Agent Progress - Agent OS harness

Cross-session state for the Ralph harness (scripts/harness/ralph-loop.sh). Each session
reads this first and updates it last. Keep it short and current: it is the working memory
a cold-started session trusts. The roadmap itself is ROADMAP.md; the journal is
DEV-JOURNAL.md (hyphen, not underscore).

## Now
- (nothing in progress)

## Next
- top-down through features.json (S8, S6 done; S3 is next in file order)

## Follow-ups seen, not done
- S6 follow-up: wire run state into the Hermes 3D scene (SPEC-F L2.1: `mapRunToState`
  per agent, bodies assigned by `characterFor`, `settings.hermes3d.clips` pools read by
  the scene, `talkingHoldMs` consumed). Today the seats hold idle bodies that the HUD
  calls "not agents"; that is the honest state, not a bug.
- Owner to look: `/hermes3d` framing, seat height of the Mixamo sitting clip on a Synty
  chair, and whether the baked level's roof hides the top-down view. Needs the rebuilt app.
- Harness lesson (cycle 2 -> 3): a headless session ENDS when it stops talking, so a
  gate started with `run_in_background` and then "waited for" is abandoned. Run the gate
  in the foreground (or poll its log in a foreground loop) before flipping status.
- S8 seam for Video: `/api/video/voices` and the voiceover step are ElevenLabs-only.
  Copy the Oracle pattern (`settings.<module>.voice` block + `module` tag on
  `/api/hermes/tts` so `fallbackPolicy()` reads that module's own fallback).
  Listed in ROADMAP.md Backlog.
- Owner to hear it: the Oracle's "Read aloud" through Voicebox with "The Sage" is
  smoke-verified only; browser audio needs the rebuilt app and his ear.

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
- 2026-09-02 17:30 PDT feat-s6-hermes3d-missing PASSING (v2.16.0): not a stale build, an unmounted route. `/hermes3d` mounted in Artist's Corner on plain three.js (office.glb + seated idle bodies, loud missing-assets panel, gear); smoke-hermes3d-ui 36 checks; gate 74/74 exit 0. Cycle 2 built it and died waiting on its background gate; cycle 3 verified and committed.
- 2026-09-02 17:05 PDT feat-s8-voicebox-everywhere PASSING (v2.15.0): Oracle speaks Voicebox on `settings.oracle.voice`, gear in its header, module-scoped fallback in the TTS route; smoke-voicebox section H (48 checks), gate 73/73 exit 0.
- 2026-09-02 16:52 PDT loop LAUNCHED by the supervising session: `bash scripts/harness/ralph-loop.sh --max-cycles 12` (gate baseline 73/73 green in 396 s at 3900c75).
- 2026-09-02 16:30 harness installed: features.json holds S8, S6, S3, backlog wrap, S4,
  S5, S7, S9 (S10 has no spec and is not listed). Gate = ./test.sh (tsc + every offline
  smoke). Loop default model claude-fable-5-1, --strict-mcp-config.
