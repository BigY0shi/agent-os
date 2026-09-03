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

- [ ] **S3. Pre-launch settings drawer + STOP.** Decided by Yoshi 2026-09-02:
  configuration happens before launch in a drawer (skills applied, guardrails
  added/removed); the only mid-run control is STOP. Deal Desk is the reference
  implementation to copy. Start with Content Engine and Kanban, the two he has
  run most.
## Next

- [ ] **S4. Deal Desk: more control from the chair.** Asked by Yoshi 2026-09-02.
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
- [ ] **S5. Legacy memory backfill, 20-episode sample.** Imported episodes carry no
  aspect (Identity/Event/Relationship). Re-import cannot fix it (content-hash
  dedup). New routine reads existing rows and runs derivation over them using the
  local models Yoshi already has (`bonsai 27b`, downloading 2026-09-02, and `nomic-embed-text`). Show him real
  rows from ~20 episodes, then decide on the full set (6-8 LLM calls per episode).
- [ ] **S6. Hermes 3D is "nowhere".** Confirm whether it is a stale build or an
  unmounted route before doing anything else. Cheap check, large confusion if
  left.

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
- Wrap the remaining 34 long request-scoped routes (`grep -l maxDuration src/app/api`) in `startModuleRun()` as their modules get touched; Deal Desk brief/proposal and Hire Engine first (S4).

## Done

(Slices move here with their commit and version when they land.)

- 2026-09-02 · v2.15.0 · S8 The Oracle speaks Voicebox: `settings.oracle.voice` (provider / The Sage profile / ElevenLabs voice / own fallback), a gear in the Oracle's header, `module: "oracle"` on `/api/hermes/tts` so the backup is the Oracle's choice in the Sage's voice, labelled in the footer; smoke-voicebox section H, 48 checks. Video voiceover stays on the backlog.

- 2026-09-02 · v2.14.1 · S0 follow-up: restart-within-60s race fixed. The single-instance guard now treats a fresh heartbeat from a PID that no longer exists as dead; the restart launcher exits 1 and prints the server's last words when nothing comes online.
- 2026-09-02 · v2.14.0 · S2 Runs survive navigation: module-run registry (`lib/moduleRuns.ts`), `/api/runs` + SSE stream, corner RunsTray in the layout, Content Engine generate + plan wired, 29-check smoke. 34 more long routes are one `startModuleRun()` call each; wire them as each module is touched.
- 2026-09-02 · v2.12.0 · S1 Voicebox is the voice engine: `lib/voicebox.ts`, `provider: "voicebox"` in the TTS route, `/api/voicebox/{profiles,transcribe}`, local-Whisper mic provider, Jarvis gear controls, 35-check offline smoke; ElevenLabs stays as the owner-chosen, labelled backup (v2.13.0 `94942fb`). Live audio HEARD 2026-09-02 (Alfred profile, CUDA, `completed` status confirmed); profile-name trailing-space fix v2.13.1.
- 2026-09-02 · v2.11.2 · S0 Launchers tell the truth: Restart .bat now pauses on an aborted restart; AGENTS.md Kokoro claim corrected.
- 2026-09-02 · v2.8.0 `eccdbf9` · Mac wording and Cmd glyphs replaced for a Windows owner.
- 2026-09-02 · v2.9.0 `ded6823` · Jarvis: browser action set registered.
- 2026-09-02 · v2.10.0 `4c1c06b` · Sidebar: Artist's Corner and Agent Toolbox, foldable.
- 2026-09-02 · v2.11.0 `d46a79e` · Version display reads package.json; AGENTS.md "Running it".
