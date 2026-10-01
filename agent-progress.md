# Agent Progress - Agent OS harness

Cross-session state for the Ralph harness (scripts/harness/ralph-loop.sh). Each session
reads this first and updates it last. Keep it short and current: it is the working memory
a cold-started session trusts. The roadmap itself is ROADMAP.md; the journal is
DEV-JOURNAL.md (hyphen, not underscore).

## Now
- AWAITING USER VERIFY (S30 settings sweep, 2026-10-01, worktree settings-sweep, branch
  feat/s30-settings-sweep, v2.56.0 to v2.59.0): the code is complete and every acceptance
  criterion is met in the tree EXCEPT the literal "./test.sh exits 0", which this worktree
  cannot produce for reasons outside the slice. All 113 offline smokes were run to the end:
  110 pass; the 3 red ones are the owner's uncommitted work that this worktree (branched
  from v2.55.0) does not hold:
  1. `smoke-guide` B1: `docs/modules/rabbit.md` (committed) names `/rabbit`, but
     `src/app/rabbit/page.tsx` is untracked in the main checkout. Commit it (or exile the doc).
  2. `smoke-exile-deletes` H1-H3, H6: the committed id guard `(?!.+$)` in
     `src/lib/studioHistory.ts`, `ultracodeRuns.ts`, `claudeArtifacts.ts` rejects every id; the
     `(?!\.)` fix is uncommitted in the main checkout (DEV-JOURNAL 2026-09-30). Commit it.
  3. `smoke-memory-ui`: expects the gitignored `.exile/` copies of the old memory page, which
     exist only in the main checkout. Either copy `.exile/` into the worktree or accept this one.
  Then, in a tree with 1 and 2 committed, run `./test.sh`; when it exits 0, set
  `feat-s30-settings-sweep` to `"passing"` in features.json (the notes already carry the
  evidence) and merge `feat/s30-settings-sweep`. Nothing else is pending on the slice.
  Owner-to-look after the rebuild: the gears on /ollama (key shows masked after save),
  the Claude Chat tab's **Model**, the Room rail's **Configure**, Jarvis **Configure** (four
  voice-lane fields), Brainstorm **Models** (two time limits), Thumbnails **Configure**
  (Prompt model). Worktree facts still true: holds none of the owner's uncommitted work;
  node_modules is a junction to the main checkout (do not npm install here); never start,
  stop or restart the server on 3737.
- S31 fix-s31-artifacts-windows-deploy BUILT 2026-10-01 in worktree artifacts-deploy (branch fix/s31-artifacts-deploy, v2.56.0):
  netlify is resolved Windows-safe (lib/platform.ts resolveCli), the SEO deploy route too, the site lives in
  settings.artifacts behind the Configure gear on the Artifacts tab, smoke-artifacts-deploy 35/35, smoke-exile-deletes
  green again (8 name guards fixed here). features.json status stays "failing" ONLY because ./test.sh exits 1 at
  smoke-guide, which is pre-existing in any fresh checkout (docs/modules/rabbit.md was committed 2026-09-29 but
  src/app/rabbit exists in no ref) and smoke-memory-ui wants the gitignored .exile folder; neither touches S31.
  The owner's checklist is at the END of this file (AWAITING USER VERIFY). Worktree notes still hold: node_modules
  is a junction to the main checkout (do not npm install here); never start, stop or restart the server on 3737.
- AWAITING USER VERIFY (S32 placeholders, worktree placeholders, branch feat/s32-placeholders,
  v2.56.0, 2026-10-01): the feature is built, smoke-covered (smoke-placeholders, 85 checks) and
  committed, but `./test.sh` cannot exit 0 in this worktree for three reasons outside the
  feature, all living in the owner's uncommitted work or the main checkout's ignored folders
  (full no-break run: 110 of 113 smokes pass, `.harness-logs/all-smokes.out`):
  (a) `smoke-guide` B1 fails on `rabbit.md` because `/rabbit` has no page in the committed
  tree: the Rabbit module is untracked in the main checkout (`git status` there:
  `?? src/app/rabbit/`, `?? src/components/v2/rabbit/`, `?? src/lib/v2/rabbit/`) while
  `docs/modules/rabbit.md` was committed by the guide commit b5304fa.
  (b) `smoke-exile-deletes` H1-H3 and H6: the committed name guards in `studioHistory.ts`,
  `ultracodeRuns.ts` and `claudeArtifacts.ts` reject every id ("bad slug"); the owner's fix
  (`(?!.+$)` to `(?!\.)`) is ` M` uncommitted in the main checkout (journal 2026-09-30).
  (c) `smoke-memory-ui` looks for the gitignored `.exile/` folder, present in the main
  checkout only. Owner checklist:
  1. In the main checkout, commit the Rabbit module (page, components, lib) and the
     name-guard fix in the three stores, each on its own; or say the doc should be retitled
     and the smokes made worktree-tolerant.
  2. In this worktree: `git merge` or rebase onto those commits, then `./test.sh` (expect
     exit 0; `smoke-memory-ui` still needs the `.exile/` folder, so run the gate from the main
     checkout after merging if it stays red here).
  3. Flip feat-s32-placeholders to "passing" in features.json (the notes already carry the
     evidence), or tell the loop to.
  4. Owner-to-look after rebuild: Tasks gear > Run mode "sdk", run a small task, watch the run
     in the tray and press STOP once; a campaign page's Board (drag a drafted card to
     approved); Today > Widgets > Customize > Add widget.
- QUEUED 2026-09-30 by the supervisor in worktree placeholders (branch feat/s32-placeholders): work ONLY feat-s32-placeholders (run with --feature). Branched from v2.55.0; holds none of the owner's uncommitted work; node_modules is a junction to the main checkout (do not npm install here). Never start, stop or restart the server on 3737.
- DONE 2026-10-01 in worktree webmcp-wizard (branch feat/s7-webmcp-wizard, v2.57.0): S7
  WebMCP wizard shipped and gate-green (115/115). Owner-to-look after merge + rebuild:
  /webmcp > Wizard > New wizard > type a description > Digest with claude (expect questions
  + a 5-10 tool list and 'answered by claude'); edit/cut a tool > Approve this list > Emit
  JSON > Create package in the builder > open <slug> lands in the Tools tab. Write my own:
  paste a bad JSON, expect concrete problems with no model wait. Gear: Wizard agent /
  Wizard fallback selects. Never run in a harness session: the server on 3737.
- DONE 2026-10-01 in worktree openmontage (branch feat/s9-openmontage-module, v2.57.0):
  feat-s9-openmontage-module is passing. `/openmontage` in Artist's Corner, gear with repo
  path / python / output dir / agent / fallback / timeout, pipelines read from the checkout's
  pipeline_defs, a run = the CLI agent driving the checkout as module run "openmontage"
  (tray streams it), rendered files listed. smoke-openmontage 64/64, ./test.sh 115/115.
  Owner-to-look after rebuild (not a blocker): open /openmontage, the five chips should be
  green (doctor was green read-only on the real checkout: python 3.11.0, deps, claude);
  press Preflight and see the registry JSON; pick framework-smoke, type a brief, Run
  pipeline, and watch the tray. The first real pipeline run spends whatever the checkout's
  .env allows (the prompt says prefer free/local and stay under the manifest budget).
  Branch is pushed; merge to master is the owner's call.
- QUEUED 2026-10-01 by the supervisor in worktree openmontage (branch feat/s9-openmontage-module): work ONLY feat-s9-openmontage-module (run with --feature). Branched from v2.56.4 (1daca86, main gate 114/114 green 2026-10-01); holds none of the owner's uncommitted work (launcher .bat/.ps1 edits). node_modules is a junction to the main checkout: do not npm install here. Never start, stop or restart the server on 3737. smoke-memory-ui now skips its .exile checks in a worktree (v2.56.4), so ./test.sh can go green here. Owner rules since the spec was written: every model/provider/fallback is a gear setting, default Claude with Codex as the owner-chosen, labelled fallback (rule 20); there is NO local Ollama on this machine (Ollama means Ollama Cloud or nothing); OpenRouter is not used anywhere; Voicebox is retired (Kokoro is the TTS). Every new control goes in its docs/modules/*.md controls table (smoke-guide checks the docs). OpenMontage is at C:/Users/Yoshi/Documents/OpenMontage (exists, verified 2026-10-01). Read its AGENT_GUIDE.md and docs/ARCHITECTURE.md before writing code; never pip install anything. If it needs a narration voice, use Kokoro (127.0.0.1:8880), not Voicebox.
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
  `llm.ts` and hunks in `settings.ts` / `dbSchema.ts`. Confirmed with the owner
  2026-09-03: `wizard.ts` is the S7 cycle's own generated work, not his draft
  (he didn't write it) - no data loss, safe to build on for the next S7 run.

## Next
- S7 webmcp-wizard, then S9 openmontage-module (top-down in features.json). Both wait on
  the marker above being retitled.

## Follow-ups seen, not done
- Voice stack is now Parakeet (STT, 8881) + Kokoro (TTS, 8880), both local servers started
  by the launchers (v2.31.0, 2026-09-08). Voicebox is retired as a default but still
  selectable. Owner-to-look after rebuild: Jarvis gear shows "Parakeet model loaded"
  under Voice provider; dictate one sentence in the overlay (push-to-talk) and see it land
  in the text box. Not done by the brief: VoxCPM cloning (only if a cloned voice is
  wanted again); the Oracle still defaults to Voicebox + ElevenLabs backup.
- Screen control (v2.30.0, 2026-09-08) owner-to-look, needs the rebuilt app: open the
  overlay on /deals and say "open the first listing and read me the notes", then
  "set its status to approved" (expect the select to change and the reply to cite
  the status, not just "done"); "Voice off" / "Stop reading" / "Stop actions" in the
  overlay header; a Hire Engine status change now shows "Save failed: ..." instead of
  silently painting. Hands-free loop (re-arm mic after read-aloud) is proposed in
  ROADMAP.md and waits on the owner because it touches the C2b mic-not-hot contract.
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
- 2026-09-03 06:35 PDT FIXED: a zero-fact `derived` row no longer retires itself. UNDRIVED_WHERE only excludes a `derived` log row when statements>0 OR voice_aspects>0 (nothing/failed unchanged); the log line and CLI summary now compute "still undrived" as remaining - (derived - derivedEmpty) - nothing, and name the count. Verified against the real DB: `--dry-run` now lists episode 0f7dea7e (the zero-fact row from the first sample) back in the candidate set. smoke-memory-backfill 90 -> 108 checks (section M); two smoke-fixture bugs found and fixed along the way (marker lost through the crude normalize regex; a manual fetch override intercepting only the terminal classify call while leaving the upstream extract call empty, so the pipeline short-circuited before reaching it) - neither touches the actual fix. v2.26.1.
- 2026-09-03 06:26 PDT Owner: not running the remaining ~332 episodes now (needs the VRAM back); will run the full set on downtime when multiple Bonsai instances can be loaded at once. Also noted: the CS triage engine (separate project, Upwork-Leads/cs-engine) already runs Bonsai 4B in production and it performs well there - unmeasured whether the 96%-reasoning-overhead problem seen on 27B also applies to 4B.
- 2026-09-03 06:20 PDT ROOT CAUSE of the slow sample: Bonsai is a reasoning model. Measured live: overhead 0.1 s, 1200 prompt tokens 0.8 s, 76 tok/s - but completion_tokens 1978 of which reasoning_tokens 1905 for a 51-token answer. LM Studio puts it in message.reasoning_content, NOT an inline <think> block, which is why the existing strip never fired and the first probe misreported "not a reasoning model". `reasoning_effort: "none"` is the only knob that works (low is SLOWER than baseline; chat_template_kwargs are ignored silently): 26.6 s -> 1.2 s, same facts. Shipped as settings.memory.openaiCompatReasoningEffort, default "none", "Thinking budget" in the Memory gear, --reasoning-effort on the CLI, named in the preflight line and in BackfillResult. Live re-run a445501c: 3 episodes in 63.8 s (was 496.8 s), 12 facts vs 8, Problem facts spot-checked against original_content and grounded. 20 episodes is now ~7 min and all 332 is ~2 h. smoke-memory-backfill 79 -> 90 checks.
- 2026-09-03 05:55 PDT FIRST LIVE openai-compat run. LM Studio up on :1234 serving `bonsai-27b`; Ollama up with nomic-embed-text. Live probe in openaiCompatChat's exact shape: HTTP 200, schema-valid JSON, parsed on the first path, no <think> block. Warm latency 18-22 s per call. A 3-episode sample (NOT the full 20; run id 3d9c2431) took 496.8 s, ~165 s per episode: 3 derived, 0 failed, 335 still undrived. Extrapolates to ~55 min for 20 and ~15 h for all 335. Facts are grounded and use the real aspect vocabulary (Knowledge, Event), but 0 voice aspects across all three, and episode 0f7dea7e derived ZERO facts while still being logged outcome "derived", which retires it from every future run. Several facts are point-in-time and will age (ElevenLabs "operational", "four active CLI agents"). Owner to judge quality and decide whether to continue to 20.
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

## AWAITING USER VERIFY - S31 Artifacts deploy (2026-10-01)

Built and smoke-proven with a fake netlify; the one step a session cannot do is a real publish.
All PowerShell-safe. Rebuild first (the Artifacts tab and the gear are new UI).
1. Install and log in to the Netlify CLI once, in your own terminal: `npm install -g netlify-cli` then
   `netlify login`. Confirm: `netlify --version` (the CLI was NOT installed on this machine on 2026-10-01).
2. Claude page > Artifacts tab > Configure (the gear): enter the Netlify site ID (Netlify > the site >
   Site configuration > Site ID), a name, and the base URL (https://<site>.netlify.app), Save. The header
   should read "Publishes to <name>." and the Gallery pill should appear.
3. Publish one Loop build from "Built by your agents". Expect a Live link within a minute; open it.
   If it fails, the red line says exactly why (CLI missing, site missing, or netlify's own output) and
   nothing is listed as live.
4. Optional: Take it offline (trash icon) and confirm the link 404s and the page is under
   ~/.agentic-os/.exile/<stamp>/published/<slug>/.
5. The gate: ./test.sh is red at smoke-guide in this worktree for a pre-existing reason (rabbit.md documents
   a /rabbit page that was never committed). Either commit src/app/rabbit or park docs/modules/rabbit.md,
   then flip fix-s31-artifacts-windows-deploy to "passing" in features.json (every other smoke passes; the
   per-smoke run is in the DEV-JOURNAL entry). smoke-memory-ui also needs the main checkout's .exile folder.
6. Retitle this heading when done so the loop can continue (the marker grep is whole-file).
