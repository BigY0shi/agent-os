# Agent Progress - Agent OS harness

Cross-session state for the Ralph harness (scripts/harness/ralph-loop.sh). Each session
reads this first and updates it last. Keep it short and current: it is the working memory
a cold-started session trusts. The roadmap itself is ROADMAP.md; the journal is
DEV-JOURNAL.md (hyphen, not underscore).

## Now
- OWNER TO VERIFY, loop released by the supervisor 21:12 PDT (S5 legacy memory backfill, v2.24.0,
  LM Studio path added v2.25.0): the routine is built and smoke-verified against a fake Ollama AND
  a fake LM Studio; the real ~20-episode sample is the owner's to run and look at (feature
  contract: "Do NOT run the real 20-episode sample yourself"). Owner checklist, in order,
  all PowerShell-safe:
  1. Decide which server holds the chat model. Bonsai 27B needs a llama.cpp fork, so
     Ollama cannot serve it; LM Studio can. Either way the EMBEDDING model stays on
     Ollama, so Ollama must be running as well. Both were DOWN when this was written
     (nothing listening on 1234 or 11434 at 2026-09-03 ~05:00 PDT).
     - LM Studio: load Bonsai, Developer tab > Start Server, note the API identifier
       (the owner reported `bonsai-27b`). Confirm: `Invoke-RestMethod http://127.0.0.1:1234/v1/models`
     - Ollama: `ollama list` must show `nomic-embed-text` (and `bonsai:27b` only if the
       chat model runs there too).
  2. Dry run, writes nothing, contacts no model server:
     `npx tsx scripts/v2/memory-backfill.mjs --limit 20 --dry-run`
  3. The sample (6 to 8 model calls per episode, so minutes on a 27B model):
     - on LM Studio: `npx tsx scripts/v2/memory-backfill.mjs --limit 20 --provider openai-compat --model bonsai-27b`
     - on Ollama:    `npx tsx scripts/v2/memory-backfill.mjs --limit 20 --model bonsai:27b`
     It prints each episode's outcome, the aspects that landed (Identity / Event / ...),
     and up to five derived facts. Or from the app: Memory > gear > "Legacy backfill" >
     pick "Served by", fill the model id and (for openai-compat) the server URL, then
     Run backfill (the runs tray carries progress; STOP works). The CLI and the app share
     the DB, so run one at a time.
  4. Look at the rows: Memory > Episodes (the derived legacy episodes now carry
     statements and voice facts) and the log in `GET /api/v2/memory/backfill`.
  5. Decide the full-set size (ROADMAP Later: "Legacy memory: full backfill size"). A
     bigger run is the same command with a bigger `--limit` (cap 500 per run); derived
     rows are never picked again, so runs can be repeated until the count reaches 0.
  6. (Retitled by the supervisor so the loop could continue to S7 and S9, per the owner's
     "if you block at one, go to the next"; the checklist above is also in HANDOFF.md.)
- Cactus Needle 2 is the owner's tool-calling model and is NOT involved here: the backfill
  makes no tool calls, only structured-JSON completions, which is the role he assigned to
  Bonsai. He noted it is installed under his python311 folder inside KiCad.
- UNCOMMITTED partial work from the killed pass-3 S7 cycle is still in the tree:
  `src/lib/v2/webmcp/wizard.ts` (untracked) plus a `resolveModel()` export in
  `llm.ts` and hunks in `settings.ts` / `dbSchema.ts`. `wizard.ts` was ALSO untracked
  before that cycle, so the session may have overwritten the owner's own draft; no
  `.exile` copy exists. Ask him before the next S7 run.

## Next
- S7 webmcp-wizard, then S9 openmontage-module (top-down in features.json). Both wait on
  the marker above being retitled.

## Follow-ups seen, not done
- S4 owner-to-look (needs the rebuilt app): the verdict line + edge colour on cards, the
  Parked/Denied lane under the board, "Paste URLs" against a real upwork.com listing
  (`scripts/deals/intake-scrape.mjs` uses his Chrome + the actor's parse.js), "Enrich
  approved" through `/api/deals/enrichment` with a logged-out session (expect the red
  banner + `needs login` badges), and "Need more info" / "Get more info" firing a
  research run in the tray. Every browser and model call is smoke-covered by a seam only.
- S4 seam: `/api/deals/enrich` (old, ungated) was in the owner's working set on
  2026-09-02 and is superseded by `/api/deals/enrichment`; retire it (or point it at
  `runEnrichment`) once his `sanitizeSpawnEnv` edit lands.
- S4 seam: `dealIntake.ts` re-runs `score_board.mjs`, which rebuilds board.json from
  the actor dataset; a re-scrape purges that dataset, so intake rows leave board.json
  then (same lifecycle as every board row). If the owner wants pasted listings to
  survive a re-scrape, keep them in a `feeds.json`-style side file instead.
- S4 seam: `deals.dropped-<date>.json` sidecars accumulate in the leads dir, one per day
  with drops; nothing prunes them.
- Backlog-wrap seam: `generateHireBrief` / `generateHirePitch` (hireBrief.ts) and
  `createGmailDrafts` (hireDraft.ts) take no signal, and both files were in the owner's
  working set on 2026-09-02, so hire/brief, hire/pitch, hire/draft mark a run stopped
  without killing the claude child. Add `signal?: AbortSignal` -> `claudeJson` -> `run()`
  once his edits land. `deals/enrich` was skipped for the same reason; it is one wrap.
- The feed pull and "Clear passed & refill" still call `startBriefBatch` outside the
  tray (they were never on the list). `planBriefBatch` + `runBriefBatch` make that a
  small change when Deal Desk is next touched (S4).
- S3 owner-to-look: the pre-launch drawer on Content Engine (Plan calendar…, Generate materials…) and Agent Kanban (Assemble board…, Run the team…), and a Stop from the tray against a real CLI child. Needs the rebuilt app. The Kanban Builder picker now lives in the drawer, not the composer.
- S3 seam: the other 34 long routes get STOP for free once they call startModuleRun and pass ctx.signal; the drawer needs a LAUNCH_MODULE_DEFS entry per module (declare only guardrails the route enforces).
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
- 2026-09-03 05:30 PDT S5 follow-up (v2.25.0): the backfill can be served by LM Studio. New memory provider `openai-compat` in llm.ts; backfill takes `provider` and preflights GET /v1/models (exact id match: LM Studio says `bonsai-27b`, Ollama says `bonsai:27b`); embeddings stay Ollama-only and are still checked, with the error naming which of the two servers is short. CLI --provider/--base-url, route body `provider` (400 on unknown), gear "Served by" + "Server URL". No key in settings (OPENAI_COMPAT_API_KEY from the env). smoke-memory-backfill 62 -> 79 checks, fake LM Studio at 127.0.0.1:1234. Neither real server was up during the build, so the openai-compat path has never spoken to a live LM Studio.
- 2026-09-02 21:12 PDT supervisor retitled the S5 verify marker (checklist kept, copied to HANDOFF.md) and RELAUNCHED the loop (`--max-cycles 4`) for S7 and S9.
- 2026-09-02 ~22:00 PDT feat-s5-legacy-memory-backfill PASSING (v2.24.0): lib/v2/memory/backfill.ts + scripts/v2/memory-backfill.mjs + POST/GET /api/v2/memory/backfill (module run, module "memory") + "Legacy backfill" section in the Memory gear; withMemoryModel() async-local override in llm.ts pins ollama-local + the chosen model for the whole addEpisode tree; migration 4 memory_backfill_log; loud errors for Ollama down / model not pulled / embed model not pulled, no fallback. smoke-memory-backfill 62 checks; gate 77/77 exit 0. The real 20-episode sample is NOT run (feature contract); the owner-verify block above (retitled by the supervisor 21:12) carries the checklist.
- 2026-09-02 ~21:30 PDT feat-s4-deal-desk-control PASSING (v2.18.0..v2.23.0, six commits in the owner's order c,b,f,d,a,e): verdict first + edge colour; face deny + bulk deny + Parked/Denied lane under the board; deals.maxAgeDays gate (gear) with dropped-row sidecars; login-wall gate via lib/dealEnrich.ts + /api/deals/enrichment (old /enrich untouched, owner's working set); manual intake via scripts/deals/intake-scrape.mjs + lib/dealIntake.ts + /api/deals/intake; research pass via lib/dealResearch.ts + /api/deals/research. smoke-deal-desk-control 75 checks; gate 76/76 exit 0. Nothing seen in a browser.
- 2026-09-02 20:03 PDT loop RELAUNCHED (`--max-cycles 8`) after the 18:18 session limit (cycles 6-8 died on 'You've hit your session limit, resets 8pm'); remaining: S4, S5, S7, S9.
- 2026-09-02 18:35 PDT feat-backlog-wrap-long-routes PASSING (v2.17.1): 8 Deal Desk / Hire Engine long routes register module runs and return runId (deals/enrich skipped as dirty); lib/runRoute.ts shared catch block; briefBatch split plan/run; smoke-module-runs 84; gate 75/75 exit 0.
- 2026-09-02 18:05 PDT feat-s3-prelaunch-drawer-stop PASSING (v2.17.0): STOP (AbortController per run, /api/runs/:id stop, tray button, signal reaches the CLI child) + RunLaunchDrawer on Content Engine and Agent Kanban with a strict launchOptions contract persisted in settings.launch.<module>; smoke-launch-drawer 70, smoke-module-runs 62; gate 75/75 exit 0.
- 2026-09-02 17:30 PDT feat-s6-hermes3d-missing PASSING (v2.16.0): not a stale build, an unmounted route. `/hermes3d` mounted in Artist's Corner on plain three.js (office.glb + seated idle bodies, loud missing-assets panel, gear); smoke-hermes3d-ui 36 checks; gate 74/74 exit 0. Cycle 2 built it and died waiting on its background gate; cycle 3 verified and committed.
- 2026-09-02 17:05 PDT feat-s8-voicebox-everywhere PASSING (v2.15.0): Oracle speaks Voicebox on `settings.oracle.voice`, gear in its header, module-scoped fallback in the TTS route; smoke-voicebox section H (48 checks), gate 73/73 exit 0.
- 2026-09-02 16:52 PDT loop LAUNCHED by the supervising session: `bash scripts/harness/ralph-loop.sh --max-cycles 12` (gate baseline 73/73 green in 396 s at 3900c75).
- 2026-09-02 16:30 harness installed: features.json holds S8, S6, S3, backlog wrap, S4,
  S5, S7, S9 (S10 has no spec and is not listed). Gate = ./test.sh (tsc + every offline
  smoke). Loop default model claude-fable-5-1, --strict-mcp-config.
