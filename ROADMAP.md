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

- [ ] **S0. Launchers tell the truth.** `Restart Agent OS.bat` ignores the exit code
  of `agentos-restart.ps1`, so an aborted restart (a survivor on 3737) still prints
  "Done", opens the browser, and closes the window after 5 s. Check `%errorlevel%`,
  pause on failure. Also correct AGENTS.md: BOTH start and restart call
  `kokoro-start.ps1`. Small, and it is the thing the owner runs most.
- [ ] **S1. Voicebox becomes the voice engine.** Voicebox (localhost:17493, REST +
  HTTP MCP + STDIO MCP, cloned profiles) replaces the dead Jarvis voice avenue and
  becomes the shared vocal source for anything that speaks. Deliverables: a
  `src/lib/voicebox.ts` client (host asserted in code, no key material), a
  `provider: "voicebox"` branch in `/api/hermes/tts`, a `/profiles` proxy, settings
  `voice.provider` + `voice.voiceboxProfile` exposed in the Jarvis and Oracle gears,
  and a smoke that mocks `fetch` so it never needs the server. Fail loudly when
  Voicebox is down; never fall back to another provider the user did not pick.
  Part B: speech-to-text through Voicebox `/transcribe` (whisper-turbo), which
  gives Jarvis a mic path that does not depend on Opera's disabled Web Speech.
- [ ] **S2. Runs survive navigation.** Content Engine bypasses the agents registry,
  so leaving the page mid-run loses the run with nothing on the Agents page. Route
  every long run through the registry first, then add a corner tray stacking one
  entry per live run. The tray is the visible half; the registry is the fix.

## Next

- [ ] **S3. Pre-launch settings drawer + STOP.** Decided by Yoshi 2026-09-02:
  configuration happens before launch in a drawer (skills applied, guardrails
  added/removed); the only mid-run control is STOP. Deal Desk is the reference
  implementation to copy. Start with Content Engine and Kanban, the two he has
  run most.
- [ ] **S4. Deal Desk: gate enrichment on a live Upwork session.** The browser got
  logged out and the enrich workflow ran as if nothing was wrong. Detect the
  logged-out page, stop, and ask, instead of enriching against a login wall.
  From the bug list; not in the earlier handoff tasklist.
- [ ] **S5. Legacy memory backfill, 20-episode sample.** Imported episodes carry no
  aspect (Identity/Event/Relationship). Re-import cannot fix it (content-hash
  dedup). New routine reads existing rows and runs derivation over them using the
  local models Yoshi already has (`bonsai 8b`, `nomic-embed-text`). Show him real
  rows from ~20 episodes, then decide on the full set (6-8 LLM calls per episode).
- [ ] **S6. Hermes 3D is "nowhere".** Confirm whether it is a stale build or an
  unmounted route before doing anything else. Cheap check, large confusion if
  left.

## Later

- [ ] **S7. WebMCP wizard.** Description in, AI digests and asks clarifying
  questions, reasons in a scratchpad without code, proposes a tool list for
  approval, then emits JSON. 5-10 tools per server, one tool one job, split by
  persona. Escape hatch: paste your own JSON and have the agent proofread it.
- [ ] **S8. Voicebox everywhere it makes sense.** Video voiceover, the walkthrough
  voiceover track below, any module that emits speech. Same client, same settings.
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

## Done

(Slices move here with their commit and version when they land.)

- 2026-09-02 · v2.8.0 `eccdbf9` · Mac wording and Cmd glyphs replaced for a Windows owner.
- 2026-09-02 · v2.9.0 `ded6823` · Jarvis: browser action set registered.
- 2026-09-02 · v2.10.0 `4c1c06b` · Sidebar: Artist's Corner and Agent Toolbox, foldable.
- 2026-09-02 · v2.11.0 `d46a79e` · Version display reads package.json; AGENTS.md "Running it".
