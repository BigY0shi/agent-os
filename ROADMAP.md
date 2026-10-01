# Roadmap

The working checklist for Agent OS. One vertical slice at a time; a slice is done
when its code, smoke, journal entry, and version bump have all landed. When a slice
lands, tick it here and write the DEV-JOURNAL entry in the same commit. The published
checklist page is regenerated from this file at the same time:
`node scripts/roadmap-page.mjs`, then republish
https://claude.ai/code/artifact/bae4deb6-3e84-43df-a594-bcdb1f2cf2b0 from
`~/.agentic-os/roadmap.html`.

Order is a judgment call made 2026-09-02 and can be reshuffled. Reasoning per slice
is one line; the journal carries the rest.

## Now

- [ ] **Jarvis v3 + Mission Control + per-module skills + memory off Honcho (in progress, 2026-09-28).**
  Owner's request of 2026-09-28 with reference screenshots and the NEXORA prompt pack.
  Plan and slice order: `_design/jarvis-v3-plan.md` (S11-S25); NEXORA diff:
  `_design/nexora-diff.md`. Landed: S11 glass + faces, S12 Jarvis tabs (v2.33.0), type redesign (v2.34.0),
  S13 Sessions (v2.35.0), S14 Skills + Workflows (v2.36.0),
  S19 memory off Honcho (config), S15 Control Room (v2.37.0), S16 MCP tab (v2.38.0), S17 Missions (v2.40.0), S18 Mission Control (v2.41.0), S21 Crew (v2.42.0), S28 Files (v2.43.0), S27 Health (v2.44.0), S26 Standing orders (v2.45.0), S23 Mission board (v2.46.0), S24 Crew archive (v2.47.0), S25 Mastermind (v2.48.0), S22 Voice mode (v2.49.0), S29 Guide (v2.50.0).
  Jarvis v3 plan complete. Guide-writer fixes landed v2.50.3-v2.51.16 (see Done); the ones that need the owner's call are listed in DEV-JOURNAL 2026-09-29.
  Parked by the owner (2026-09-30): SEO is not in use yet, so its per-site Deploy command stays saved-but-unused (the field says so) until SEO is picked up.

- [x] **Jarvis user-directed screen control.** Shipped 2026-09-08, v2.30.0 (see Done).
  Inspect and operate app controls, with Deal Desk / Hire Engine labels and spoken
  readbacks. Spec: `_design/jarvis-screen-control.md`. Not yet seen in a browser.
- [ ] **Jarvis hands-free loop (proposed, owner's call).** The overlay needs a mic
  press per turn (C2b contract: mic not hot on open). An opt-in "Hands-free" toggle
  that re-arms capture when read-aloud ends, plus auto-send, would make Deal Desk
  voice-only. Touches a contract Yoshi stated twice, so it waits for his yes.

- [x] **S3. Pre-launch settings drawer + STOP.** Shipped 2026-09-02 (see Done). Decided by Yoshi 2026-09-02:
  configuration happens before launch in a drawer (skills applied, guardrails
  added/removed); the only mid-run control is STOP. Deal Desk is the reference
  implementation to copy. Start with Content Engine and Kanban, the two he has
  run most.
## Next

- [x] **S4. Deal Desk: more control from the chair.** Asked by Yoshi 2026-09-02; all six parts landed 2026-09-02 (see Done, v2.18.0 to v2.23.0). Not yet seen in a browser.
  (a) Manual intake: paste one or more job-listing URLs and have the desk scrape,
  evaluate, and pitch them like any feed item. (b) Deny without opening: a deny
  control on the card face, multi-select with bulk deny, and the Parked/Denied
  lane reachable without scrolling off-screen (today: open card, dropdown, deny,
  close; the deny lane sits off the right edge). (c) Verdict first: the
  evaluator already scores the listing and then says pass or pursue; that
  "hit or stand" sentence moves to the TOP of the yellow summary box so cards can
  be cleared at reading speed, and a color band on the card edge encodes it. (d) Gate enrichment on a live Upwork session:
  the browser was logged out and enrich ran as if fine; detect the login wall,
  stop, and ask. (e) "More info needed" must do something: today it paints a
  yellow cone on the card and fires no task. It should kick off a research pass
  (enrich + brief + the open questions) and report back on the card, with a
  button inside the drawer to ask for more on demand. (f) Gate scrapes by posted date: the feed is pulling listings 3-4 weeks old;
  add a max-age setting in the gear (default a few days), drop older listings at
  scrape time, and show the age on the card. Ride-along from an earlier session:
  a visible Reload spinner. (The "how we'd do it" line already exists.) Deal Desk is also
  the reference for S3, so (b) and (c) shape the drawer pattern.
- [x] **S5. Legacy memory backfill, 20-episode sample.** Built 2026-09-02, extended
  2026-09-03 to run on LM Studio (see Done); the 20-episode sample is pending the owner
  (command in agent-progress.md). Imported episodes carry no
  aspect (Identity/Event/Relationship). Re-import cannot fix it (content-hash
  dedup). New routine reads existing rows and runs derivation over them using the
  local models Yoshi already has. Bonsai 27B needs a llama.cpp fork and cannot run on
  Ollama at all, so the chat model can be served by LM Studio (`--provider openai-compat`,
  API identifier `bonsai-27b`) while embeddings stay on Ollama (`nomic-embed-text`);
  both servers must be up. Show him real rows from ~20 episodes, then decide on the
  full set (6-8 LLM calls per episode). Sampled live 2026-09-03: 6 episodes derived on
  LM Studio, 332 still undrived. Owner: holding off on the full run until downtime, when
  multiple local Bonsai instances can be loaded at once (VRAM is needed elsewhere now).
- [x] **S6. Hermes 3D is "nowhere".** Answered 2026-09-02 (see Done): not a stale
  build, an unmounted route. The scene (SPEC-F L2) was never started after the
  asset pipeline landed. Mounted on plain three.js; run state is the next slice.

## Later

- [ ] **S7. WebMCP wizard.** Description in, AI digests and asks clarifying
  questions, reasons in a scratchpad without code, proposes a tool list for
  approval, then emits JSON. 5-10 tools per server, one tool one job, split by
  persona. Escape hatch: paste your own JSON and have the agent proofread it.
- [x] **S8. Voicebox everywhere it makes sense.** The Oracle done (2026-09-02, see
  Done). Still open on the same client: Video voiceover and the walkthrough voiceover
  track below (backlog).
- [ ] **S9. OpenMontage module (Artist's Corner).** Local checkout at
  `C:/Users/Yoshi/Documents/OpenMontage`: a Python agentic video production system
  (pipelines, Remotion composer, AGPLv3). Read `AGENT_GUIDE.md` and
  `docs/ARCHITECTURE.md` first, then wrap it as a sidebar module the way the other
  Artist's Corner tools are wrapped. Pairs with Agent-Reach and with Voicebox (S8)
  for narration.
- [ ] **S10. PRIME AGENT (Agent Toolbox).** Named in Yoshi's new-modules doc with no
  description yet. Needs a spec before it gets a slot.

## Walkthrough video (carried from the previous roadmap)

1. **Done** — Add GitHub pull-request quality and approval gates for `local-main`.
2. **In progress** — Create a safe, source-grounded Agent OS walkthrough video.
3. **Next** — Add an optional approved voiceover track to the walkthrough (S8).
4. **Next** — Refresh the walkthrough after a major information-architecture change.

## Backlog

- ~33 module docs unwritten under `docs/modules/`.
- `PROGRESS.md` is stale (last touched 2026-08-28, still presents Phase 0).
- SPEC-F carries a stale Hermes 3D claim.
- Licence decision (MIT) deferred.
- Legacy memory: full backfill size, after S5.
- Video voiceover on Voicebox (S8 follow-up): `/api/video/voices` and the voiceover step still speak ElevenLabs only; the Oracle's `oracle.voice` block + `module` tag on `/api/hermes/tts` is the pattern to copy.
- Wrap the remaining 27 long request-scoped routes (`grep -L startModuleRun $(grep -rl maxDuration src/app/api)`) in `startModuleRun()` as their modules get touched. Deal Desk brief/brief-batch/proposal and all five Hire Engine routes landed in v2.17.1; `deals/enrich` is next (it was in the owner's working set that day). Seam for the three hire routes where STOP cannot yet kill the child: `signal?: AbortSignal` on `generateHireBrief` / `generateHirePitch` / `createGmailDrafts`.

## Done

(Slices move here with their commit and version when they land.)

- 2026-09-30 · v2.51.18-v2.54.0 · Owner's decisions on the open items: Agent Room has no OpenRouter, no local-Ollama fallback and no invented replies; the Loop judge is Ollama Cloud (no local Ollama) and its fallback is a Loop-gear choice (default none), with every Loop parameter in a new gear; the Oracle speaks Kokoro (bm_lewis) with its own labelled backup; Idea Engine seats default to Claude with a Codex fallback, all in its gear. Smokes: room-honesty, oracle-kokoro, idea-seats; loop-cli-only extended.

- 2026-09-29 · v2.50.3-v2.51.16 · Guide-writer fixes: db.backup beside its DB; Fusion and Sakana show only real status; Loop is CLI agents only (v2.51.0); the gate makes no live model calls; Delete exiles in Kanban, Music, Local builds, Room history and Pipeline (whose Remove route was missing); chat Logged only when logged; honest labels in Thumbnails, Agent Kanban, Pi, OpenClaw, Local Engine, SEO, Skills; no silent provider switches in Hermes Talk and Video; Codex previews on Windows; Game Studio, Open Design and Notebook settings honoured; SEO auto-deploys every configured site. Smokes: db-backup-location, fusion-honesty, loop-cli-only, exile-deletes, honest-labels.

- 2026-09-29 · v2.50.0 · Jarvis v3 S29 Guide: all 50 modules documented from the code (every tab and control, how it works), the in-app wiki at /guide with search and a link from every page, the same docs as the repo's GitHub docs with an index. smoke-guide 16 checks.

- 2026-09-29 · v2.49.0 · Jarvis v3 S22 Voice mode: a rotating dial of Jarvis, the Oracle, every specialist and crew agent (arrows, keys, click or "talk to <name>"), the chosen face on stage driven by real mic/reply/audio state, push-to-talk through Parakeet, replies spoken through Kokoro. smoke-voice-mode 23 checks.
- 2026-09-29 · v2.48.1 · Glass cards no longer override absolute / fixed / sticky (the unlayered position rule moved into the components layer).

- 2026-09-29 · v2.48.0 · Jarvis v3 S25 AI Agent Mastermind: a Specialists rail with one real status word each (working now / unreachable / active today / ready) and header counts, the unchanged group chat as The whole room, and a persistent one-on-one thread per specialist. smoke-mastermind 15 checks.

- 2026-09-29 · v2.47.0 · Jarvis v3 S24 Crew archive: one searchable wall of mission reports and seat answers, Oracle consultations, News Radar briefings, Deal/Hire pitches, Jarvis conversations and Brainstorm briefs, read in place (nothing copied), with a reader and a link to where each lives. smoke-archive 21 checks.

- 2026-09-29 · v2.46.0 · Jarvis v3 S23 Mission board: a Board view in Missions with one waiting-on-you list (mission plans and results plus the agents' approvals and questions, answered in place), a ring of missions by state with real counts, delivered, and the detail below.

- 2026-09-29 · v2.45.0 · Jarvis v3 S26 Standing orders: every recurring job (scheduled tasks, agents' cron triggers, system jobs) with owner, cadence, prompt, model, last run and result; Run it now / Hold it / Let it run / Take it off through each system's own path; take-off never deletes. smoke-standing 30 checks.

- 2026-09-29 · v2.44.0 · Jarvis v3 S27 Health (Mission Control view, grown from System pulse): a plain-words headline, machine facts, load (said plainly when Windows has none), memory, four live sparklines labelled by computed shape, per-core, every drive, busiest processes with an agents-only filter, diagnostics. Sampled only while watched. smoke-health 22 checks.

- 2026-09-29 · v2.43.0 · Jarvis v3 S28 Files: read and edit the files that shape Jarvis, Hermes, each agent and each skill where they live; allow-list + real-path containment, credential files never shown, secrets masked and restored, a gate for files that shape an agent, every save keeps the previous version, a 409 when the file changed since it was opened. smoke-files 35 checks.

- 2026-09-29 · v2.42.0 · Jarvis v3 S21 Crew: Agent City (tower + a seeded building per agent, pulsing by real status, roads lit only while running, click to chat), the Talk-to-the-crew ring, a messenger per agent backed by real runs, roster, a when-the-crew-speaks heatmap from run times, recent activity, and a 4-step Deploy agent wizard with prepared roles. smoke-crew 33 checks.
- 2026-09-29 · v2.41.1 · Activity feed shows the time a log line carries, or none (was an invented mtime-minus-200 ms per line).

- 2026-09-29 · v2.41.0 · Jarvis v3 S18 Mission Control: Cockpit / System pulse / Scratchpad views; telemetry on first load (system pulse, runs ring over a stated window, missions by stage, orchestration with per-agent load), the scratchpad moved last, and a System pulse view (rings, per-core, what is holding the machine, diagnostics, services). smoke-home-cockpit 29 checks.

- 2026-09-29 · v2.40.0 · Jarvis v3 S17 Missions: brief -> Jarvis plans -> you approve -> each seat's CLI runs in its own scratch folder (claude and hermes capped at 50 turns, codex and agy bounded by the time limit) -> report -> review or deliver. Desk, stage columns, time-limit ring, measured stats, and a WHAT HAPPENED, IN ORDER timeline carrying each brief sent. smoke-missions 68 checks.
- 2026-09-29 · v2.39.2 · Jarvis keeps his warm session when memory updates the persona mid-conversation (the intermittent turn-2 rebuild); sessionRebuilt on the done event.
- 2026-09-29 · v2.39.1 · Faces: a three-shell Jarvis plexus with orbit rings; a five-arm Oracle galaxy with filaments, dust lanes and a bulge.
- 2026-09-28 · v2.39.0 · Skills & Workflows pop-up offers every library (Agent OS, Claude Code, SkillDB: 676 skills) with source filters; opaque panel.
- 2026-09-28 · v2.38.4 · /api/settings masks key material (first 5 characters shown); MCP secret copies through a cookie-only reveal route.
- 2026-09-28 · v2.38.1-3 · Test gate green again: V1 MemoryPanel exiled, smoke-search facet window pinned, smoke-browser offline-only in the gate.

- 2026-09-28 · v2.38.0 · Jarvis v3 S16 MCP tab: Jarvis's own external MCP servers (HTTP or stdio, added switched off, retire/restore), install wizard with write-only secrets and Hermes-catalogue prefill, Claude Code and Hermes servers listed read-only (names only, URL query stripped). External tools bypass Jarvis's gates, so SDK hooks deny them on tainted turns and taint the turn after they run. smoke-jarvis-mcp 51 checks.

- 2026-09-28 · v2.37.0 · Jarvis v3 S15 Control Room tab: measured host and local-service status with plain-words checks (Windows load average reported as unavailable, loopback-only probes), one skills/workflows matrix across every module, Claude Code plugins (global, next session, backup per change), insights from the run registry with its window stated, and every module's settings behind a new masked door (`/api/control/settings`). Found and queued: GET /api/settings returns key material. smoke-control-room 42 checks.

- 2026-09-28 · config · Jarvis v3 S19: memory off Honcho. Claude Code uses Agent OS Memory V2 through the user-scope MCP server `agent-os` (memory_search / memory_ingest / memory_about_user, verified live); Honcho plugins disabled; global CLAUDE.md updated. Hermes not moved (its `mcp add` cannot send the auth header). No repo code changed.

- 2026-09-28 · v2.36.0 · Jarvis v3 S14: skills and workflows on every module. A "Skills & workflows" pop-up in the TopBar (every page; Jarvis tabs are their own modules) switches each skill and workflow on per module or everywhere, runs workflows in place (module runs: runs tray, STOP) and creates new ones; Jarvis's `module_kit` tool does the same by voice (writes gated). Skills now reach 14 modules (cliComplete `module` option + Oracle + Jarvis's own); `moduleRegistry` says which, and the smoke proves it against the code. Workflows are new (`~/.agentic-os/workflows`, retire never deletes). `/api/skills` finally exists (the launch drawer's picker was always empty). Also fixed: Deal Desk saves painted success before the server answered. smoke-module-kit 73 checks.

- 2026-09-28 · v2.35.0 · Jarvis v3 S13 Sessions tab: search titles and message bodies (literal wildcards), Live/Archived/All, measured counts, transcript reader, Resume in Console (`/jarvis?c=`) or overlay (window event), rename, archive, restore (new). smoke-jarvis-sessions 33 checks.

- 2026-09-28 · v2.34.0 · Type redesign (owner: NEXORA looks "eerily similar"). Unbounded display, Geist UI/body, Geist Mono data, all self-hosted via next/font; old Google-loaded families dropped; 103 hardcoded family names moved to tokens; eyebrows off wide-tracked mono. smoke-jarvis-v3-ui 43 checks.

- 2026-09-28 · v2.33.0 · Jarvis v3 S11 + S12. Glass-neumorphism classes defined (GlassCard had referenced undefined classes since it was written); `AgentFace` three.js faces (Jarvis constellation violet to electric blue, Oracle galaxy, News Radar sweep) driven only by real state; `/jarvis` is a tabbed hub (Console, Oracle, News Radar, Outreach), the last three moved from Hermes with redirects; Wall mode's random-walk telemetry replaced by measured readouts. smoke-jarvis-v3-ui 38 checks incl. real Chromium WebGL + no-WebGL poster.

- 2026-09-08 · v2.31.1 · Jarvis "(no reply)" after one message: the SDK read loop's `break` out of `for await` called the query's `return()`, which the Agent SDK implements as `cleanup()`, so every warm session died at the end of its first turn and turn two read a closed stream in 1 ms (11 such rows in the store). Now explicit `next()`; a closed stream or an error result is a thrown, visible error. Brain smoke live leg gained a same-conversation second turn. This, not Voicebox, was the morning's "one reply then it breaks".

- 2026-09-08 · v2.31.0 · Off Voicebox (retires S1): Parakeet hears, Kokoro speaks. New local STT server `~/.agentic-os/parakeet-stt` (NVIDIA Parakeet-TDT 0.6B v2 on ONNX Runtime, int8 CPU, port 8881, `parakeet-start.ps1` from both launchers), `lib/parakeet.ts` + `/api/stt/{transcribe,health}`, `parakeet` capture provider first in the list, recorder lane generalised, gear health + URL, defaults mic=parakeet / reply=Kokoro. Measured: 5 consecutive utterances 0.18 to 0.32 s each, all word-correct, model stays loaded. Voicebox stays selectable, nothing defaults to it. VoxCPM cloning only if asked. smoke-parakeet-stt 28 checks.

- 2026-09-08 · v2.30.1 · Screen control, first live run: the overlay is a docked panel (bottom-right above the orb, no backdrop) so pages Jarvis navigates to stay usable; read-aloud shows the route's fallback label ("voicebox failed (reason); elevenlabs is speaking instead") and keeps the rest of a reply on the voice the route chose instead of re-stalling 8 s per chunk; the TTS route logs the backup's outcome. Voicebox itself is failing model reload (torch meta tensor, reproduced by direct probe), which is the owner's app to restart. smoke-jarvis-screen-control 43 checks.

- 2026-09-08 · v2.30.0 · Jarvis user-directed screen control. `ui_control` tool (inspect / click / fill / select / navigate) over a per-turn SSE command with a one-use token; the browser executes against observed control IDs bound to a snapshot signature and POSTs evidence back to `/api/v2/jarvis/ui-result`. Deal Desk and Hire Engine cards and drawers carry names, `role="dialog"`, `data-jarvis-record` and `data-jarvis-saved-value` so "open the X listing, read the notes, approve it" resolves to named controls and reports saved only when the store acknowledged. Hire Engine's silent save failures (`.catch(() => {})`, optimistic status) replaced with real errors. Overlay reads replies aloud through the gear's reply voice, with Stop / Voice off / Stop actions. `router.push` replaces full reloads so the ask stream survives navigation. smoke-jarvis-screen-control, 40 checks, real Chromium via Playwright. Not yet seen in a browser.

- 2026-09-03 · v2.26.1 · S5 fix: a zero-fact `derived` row no longer retires itself. Distinguished the model explicitly deciding an episode is empty (`NOTHING_TO_REMEMBER` -> outcome `nothing`, correctly final) from the model running the whole pipeline and extracting nothing anyway (`derived` with 0 statements, 0 voice aspects - a verdict about the pass, not the episode). `UNDRIVED_WHERE` now retires a `derived` log row only when it landed something; the "still undrived" arithmetic in both `backfill.ts` and the CLI is corrected to match, and both name the zero-yield count. Verified against the real DB (episode `0f7dea7e` from the first sample is back in the candidate set) and smoke-covered: 90 -> 108 checks (section M), which itself needed two fixture bugs fixed (the marker lost through a crude normalize regex; a manual override leaving the upstream extract call empty so the pipeline short-circuited before the branch it was meant to test).
- 2026-09-03 · v2.26.0 · S5 follow-up: a thinking budget, because the first live sample was 96% monologue. Measured on the real server: overhead 0.1 s, 1200 prompt tokens 0.8 s, 76 tok/s, but 1978 completion tokens of which 1905 were reasoning, for a 51-token answer. LM Studio reports it in `message.reasoning_content`, not an inline `<think>` block, so the existing strip never fired. `reasoning_effort: "none"` is the only knob that works (`low` is slower than baseline; `chat_template_kwargs` are ignored): 26.6 s → 1.2 s with the same facts, and on one note thinking-off caught a fact thinking-on missed. Shipped as `settings.memory.openaiCompatReasoningEffort` (default `none`), "Thinking budget" in the Memory gear, `--reasoning-effort` on the CLI through the same env door as `--base-url` (writes nothing to disk), named in the preflight line and in `BackfillResult.reasoningEffort`; `""` omits the field rather than sending an empty string, and it never reaches the Ollama path. Live: 3 episodes in 63.8 s, down from 496.8 s. 20 episodes is now ~7 min, the full 332 about 2 h instead of 15. smoke-memory-backfill 79 → 90 checks.
- 2026-09-03 · v2.25.0 · S5 follow-up: the backfill can be served by LM Studio. Bonsai 27B needs a llama.cpp fork, so Ollama cannot serve it at all; `openai-compat` is now a fifth memory provider in `llm.ts` (`openaiCompatChat` posts to `{settings.memory.openaiCompatUrl}/chat/completions` with the JSON schema in `response_format` plus the same textual instruction the Ollama path uses, `<think>` stripped). The backfill takes `provider` (`settings.memory.backfillProvider`, the gear) and preflights the server it will actually use: `GET /v1/models` must list the model id verbatim (LM Studio's API identifier `bonsai-27b`, not the Ollama tag `bonsai:27b`). Embeddings are Ollama-only, so an LM Studio run still checks `nomic-embed-text` on Ollama and the error names which of the two servers is missing what. `--provider openai-compat [--base-url …]` on the CLI, `provider` in the POST body (400 on an unknown one, never a default), "Served by" + "Server URL" in the Memory gear. No key in settings: `OPENAI_COMPAT_API_KEY` is read from the environment only. smoke-memory-backfill 62 → 79 checks with a fake LM Studio on 127.0.0.1:1234 beside the fake Ollama. The real sample is still the owner's to run.
- 2026-09-02 · v2.24.0 · S5 Legacy memory backfill, built, sample pending owner. `lib/v2/memory/backfill.ts`: `listUndrivedEpisodes` (legacy rows with no provenance edge and no voice fact, oldest first), `backfillEpisodes({limit, model, dryRun})` runs the normal `addEpisode()` pipeline over the EXISTING rows with the chat model pinned to the local Ollama through the new `withMemoryModel()` async-local override in `llm.ts` (settings untouched, STOP reaches every fetch), embeddings on `nomic-embed-text`; migration 4 `memory_backfill_log` records derived / nothing / failed per episode so a run is idempotent without touching content_hash dedup. Ollama down or the model not pulled stops the run with a named error and no fallback. Three doors: `scripts/v2/memory-backfill.mjs --limit 20 --model bonsai:27b [--dry-run]`, `POST /api/v2/memory/backfill` as a module run (module `memory`, progress in the tray), and a "Legacy backfill" section in the Memory gear (limit, model, Dry-run, Run backfill; knobs persist to `settings.memory.backfillLimit/backfillModel`). smoke-memory-backfill, 62 checks, fake Ollama behind fetch. The real 20-episode sample is the owner's to run and look at.

- 2026-09-02 · v2.18.0 to v2.23.0 · S4 Deal Desk, more control from the chair, six commits in the owner's order. (c) `deriveVerdict()` in `lib/dealDeskControl.ts`: the evaluator's own pass/pursue sentence is the first line of the summary box and the card edge colour. (b) `setStatusBulk` + `action: "bulkStatus"`: tick boxes and a deny cross on every card face, "Deny N selected", Parked/Denied as a full-width lane under the board with two drop targets; Reload says "Reloading…". (f) `settings.deals.maxAgeDays` (gear, default 5): `pruneLeadsFileByAge` after scoring and after a feed pull, dropped rows kept as `<name>.dropped-<date>.json`, undated kept, age on the card with OLD past the gate. (d) `lib/dealEnrich.ts` + `POST /api/deals/enrichment`: a login wall stops the run, flags the unreached cards `needs login`, banner with "Open Upwork login" / "Update cookie", a saved cookie clears the flags (the old `/enrich` route was in the owner's working set; untouched). (a) `parseIntakeUrls` + `scripts/deals/intake-scrape.mjs` + `lib/dealIntake.ts` + `POST /api/deals/intake`: pasted Upwork URLs go dataset → `score_board.mjs` → `pitch.mjs` → New, as a module run. (e) `lib/dealResearch.ts` + `POST /api/deals/research`: "Need more info" ON starts enrich + brief + open questions as a module run, "Get more info" in the drawer, state on the card. smoke-deal-desk-control, 75 checks, every browser and model call a seam. Nothing seen in a browser yet.

- 2026-09-02 · v2.17.1 · Backlog: Deal Desk and Hire Engine long routes register module runs. `deals/brief`, `deals/brief-batch`, `deals/proposal`, `hire/brief`, `hire/draft`, `hire/pitch`, `hire/scrape`, `hire/enrich` call `startModuleRun()`, log their steps, and return `runId`; same awaits, same status codes, 409 `{ stopped }` after STOP. `lib/runRoute.ts` (`HttpError` + `runErrorResponse`) is the shared catch block; `lib/briefBatch.ts` split into `planBriefBatch` + `runBriefBatch` so the batch route owns its run and STOP reaches every claude child. `deals/enrich` skipped (owner's working set). smoke-module-runs 84 checks.
- 2026-09-02 · v2.17.0 · S3 Configure before launch, STOP after: `RunLaunchDrawer` (seat, skills from /api/skills, per-module guardrails, instructions; persists `settings.launch.<module>`; locked while that module runs) on Content Engine plan/generate and Agent Kanban plan/build; `lib/launchOptions.ts` strict contract (unknown field = 400 naming it); `stopModuleRun` + `POST /api/runs/:id {action:"stop"}` + Stop button in the tray, signal threaded to the CLI child / Ollama fetch; Kanban runs registered in the tray. smoke-launch-drawer 70 checks, smoke-module-runs 62. Not yet seen in a browser.
- 2026-09-02 · v2.16.0 · S6 Hermes 3D mounted: `/hermes3d` in Artist's Corner, office.glb + seated idle bodies on plain three.js (r3f was never installed), gear for quality/shadows/fps/seatedCount, loud "assets not baked" panel naming PIPELINE.md, HUD that says the bodies are not agents. smoke-hermes3d-ui, 36 checks. Follow-up: wire run state (L2.1) so real agents take the seats.
- 2026-09-02 · v2.15.0 · S8 The Oracle speaks Voicebox: `settings.oracle.voice` (provider / The Sage profile / ElevenLabs voice / own fallback), a gear in the Oracle's header, `module: "oracle"` on `/api/hermes/tts` so the backup is the Oracle's choice in the Sage's voice, labelled in the footer; smoke-voicebox section H, 48 checks. Video voiceover stays on the backlog.

- 2026-09-02 · v2.14.1 · S0 follow-up: restart-within-60s race fixed. The single-instance guard now treats a fresh heartbeat from a PID that no longer exists as dead; the restart launcher exits 1 and prints the server's last words when nothing comes online.
- 2026-09-02 · v2.14.0 · S2 Runs survive navigation: module-run registry (`lib/moduleRuns.ts`), `/api/runs` + SSE stream, corner RunsTray in the layout, Content Engine generate + plan wired, 29-check smoke. 34 more long routes are one `startModuleRun()` call each; wire them as each module is touched.
- 2026-09-02 · v2.12.0 · S1 Voicebox is the voice engine: `lib/voicebox.ts`, `provider: "voicebox"` in the TTS route, `/api/voicebox/{profiles,transcribe}`, local-Whisper mic provider, Jarvis gear controls, 35-check offline smoke; ElevenLabs stays as the owner-chosen, labelled backup (v2.13.0 `94942fb`). Live audio HEARD 2026-09-02 (Alfred profile, CUDA, `completed` status confirmed); profile-name trailing-space fix v2.13.1.
- 2026-09-02 · v2.11.2 · S0 Launchers tell the truth: Restart .bat now pauses on an aborted restart; AGENTS.md Kokoro claim corrected.
- 2026-09-02 · v2.8.0 `eccdbf9` · Mac wording and Cmd glyphs replaced for a Windows owner.
- 2026-09-02 · v2.9.0 `ded6823` · Jarvis: browser action set registered.
- 2026-09-02 · v2.10.0 `4c1c06b` · Sidebar: Artist's Corner and Agent Toolbox, foldable.
- 2026-09-02 · v2.11.0 `d46a79e` · Version display reads package.json; AGENTS.md "Running it".
