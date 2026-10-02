# Handoff, 2026-09-02 (autonomous run while Yoshi was out)

Branch `feat/v2-hermes3d-and-versioning`, tracking origin. Read `AGENTS.md` first
("Running it" and "Harness"), then this. The roadmap checklist is `ROADMAP.md`, published at
https://claude.ai/code/artifact/bae4deb6-3e84-43df-a594-bcdb1f2cf2b0 (regenerate with
`node scripts/roadmap-page.mjs`; only an interactive session can republish it).

## Done today before the loop (all pushed)

| version | what |
|---|---|
| v2.11.1 | ROADMAP.md checklist + `scripts/roadmap-page.mjs` + published page |
| v2.11.2 | S0: `Restart Agent OS.bat` honours an aborted restart |
| v2.12.0 | S1: Voicebox is the voice engine (client, TTS provider, local-Whisper mic, gear, smoke) |
| v2.13.0 | ElevenLabs stays as the owner-chosen, labelled backup (AGENTS.md rule 20) |
| v2.13.1 | Profile names matched trimmed ("Alfred " had a trailing space); live audio verified |
| v2.14.0 | S2: module-run registry, `/api/runs` + SSE, RunsTray, Content Engine wired |
| v2.14.1 | Restart-within-60s race: guard frees a lock whose PID is gone; launcher exits 1 |
| docs | Agent OS system map (`_design/agentos-map/`), Tailscale/https note, harness install |

Verified live by Yoshi at 16:12: Jarvis reply voice (Voicebox) and the local-Whisper mic
work at http://localhost:3737 in Opera. At the Tailscale address the mic stays hidden until
`tailscale serve --bg 3737` fronts the app with https (MagicDNS `desktop.hair-halfmoon.ts.net`,
certs enabled, no serve config yet).

## The loop

`scripts/harness/ralph-loop.sh` was launched in the background at the time noted in
`agent-progress.md`. It spawns one fresh `claude -p --model claude-fable-5-1` session per
`failing` row of `features.json`, top-down: S8, S6, S3, backlog route wrapping, S4, S5, S7, S9.
Each cycle's transcript is in `.harness-logs/cycle-N-<id>-<ts>.log`. A row a session could not
finish carries `SKIP <date>: <reason>` in `notes` and is left for you to reorder; the loop moves
on. Exit codes: 0 done, 2 paused on a marker in `agent-progress.md`, 3 stalled.

## Loop pass 1 (16:52 to 18:18 PDT): four features landed, all pushed

| version | feature | what |
|---|---|---|
| v2.15.0 | S8 | The Oracle speaks Voicebox on its own settings (`settings.oracle.voice`, gear in its header, module-scoped fallback in the TTS route); smoke-voicebox section H |
| v2.16.0 | S6 | Hermes 3D was never mounted, not stale: `/hermes3d` in Artist's Corner on plain three.js (office.glb, seated idle bodies, loud missing-assets panel, gear); smoke-hermes3d-ui 36 checks |
| v2.17.0 | S3 | STOP (AbortController per run, `/api/runs/:id` stop, tray button, signal reaches the CLI child) + RunLaunchDrawer on Content Engine and Agent Kanban, options persisted in `settings.launch.<module>`; smoke-launch-drawer 70 |
| v2.17.1 | backlog | 8 Deal Desk / Hire Engine long routes register module runs (`deals/enrich` skipped: in your dirty set); `lib/runRoute.ts`; smoke-module-runs 84 |

Cycles 6-8 (S4) died at 18:18 on "You've hit your session limit, resets 8pm" and the loop
stalled out (exit 3). Relaunched at 20:03 for S4, S5, S7, S9 (`.harness-logs/loop-2026-09-02-b.log`).
Follow-ups the sessions noticed but did not do are listed in `agent-progress.md` under
"Follow-ups seen, not done" (Video voiceover on Voicebox, Hermes 3D run-state wiring, hire
routes' STOP once your hireBrief/hireDraft edits land, feed-pull runs in the tray).

## Loop pass 2 (20:03 to 21:07 PDT): S4 and S5 landed, all pushed

| version | feature | what |
|---|---|---|
| v2.18.0 .. v2.23.0 | S4 | Deal Desk control in your order c,b,f,d,a,e, one commit each: verdict first + edge colour; deny from the card face, bulk deny, a Parked/Denied lane under the board; `deals.maxAgeDays` gate (gear); login-wall gate via `lib/dealEnrich.ts` + `/api/deals/enrichment` (your dirty `/enrich` untouched); manual URL intake (`/api/deals/intake`); "Need more info" fires a research pass (`/api/deals/research`); smoke-deal-desk-control 75 checks |
| v2.24.0 | S5 | Legacy memory backfill: `lib/v2/memory/backfill.ts`, `scripts/v2/memory-backfill.mjs`, `/api/v2/memory/backfill` as a module run, "Legacy backfill" in the Memory gear, local model pinned for the whole derivation, loud errors when Ollama or a model is missing; smoke-memory-backfill 62 checks. The 20-episode sample was NOT run: that is yours (checklist below) |

The loop then paused on the S5 verify marker. Per your "if you block at one, go to the next",
the supervisor retitled it (checklist preserved) and relaunched for S7 and S9 at 21:12
(`.harness-logs/loop-2026-09-02-c.log`). Nothing has been seen in a browser by anyone.

## What to do when you are back

1. **Rebuild and restart** (your scripts). Everything below assumes the new build.
2. **S5, the memory sample (PowerShell-safe, in order).** Extended 2026-09-03 (v2.25.0) so the
   chat model can be served by LM Studio: Bonsai 27B needs a llama.cpp fork and Ollama cannot
   serve it at all. Embeddings are Ollama-only either way, so **both servers must be up**.
   Neither was listening when this was written.
   - LM Studio: load Bonsai, Developer tab > Start Server, and note the API identifier
     (you reported `bonsai-27b`; it is not the Ollama-style `bonsai:27b`).
     Confirm with `Invoke-RestMethod http://127.0.0.1:1234/v1/models`
   - Ollama: `ollama list` must show `nomic-embed-text`.
   - Dry run, writes nothing, contacts no model server:
     `npx tsx scripts/v2/memory-backfill.mjs --limit 20 --dry-run`
   - The sample (6-8 model calls per episode, so minutes):
     `npx tsx scripts/v2/memory-backfill.mjs --limit 20 --provider openai-compat --model bonsai-27b`
     Or, if the model is on Ollama instead: `… --limit 20 --model bonsai:27b`
     Or from the app: Memory > gear > Legacy backfill > pick "Served by", fill the model id and
     the server URL, then Run (the tray shows progress; STOP works). CLI and app share the DB:
     one at a time.
   - Look at the rows: Memory > Episodes, and `GET /api/v2/memory/backfill` for the log. Then
     decide the full-set size; bigger runs are the same command with a bigger `--limit`
     (cap 500), derived rows are never picked twice.
3. **Look at, in this order:** Deal Desk (verdict line at the top of the yellow box, edge colour, deny on the card face, the lane under the board, paste a URL into intake, "Need more info" on a card), the runs tray bottom-left while a Content Engine generate runs, then STOP it, `/hermes3d` in Artist's Corner (framing, seat height, roof), the Oracle's Read aloud on The Sage, Kanban's launch drawer.
4. **Remote mic:** `tailscale serve --bg 3737` on the host, then `https://desktop.hair-halfmoon.ts.net`.
5. **Follow-ups the sessions noticed but did not do** are listed in `agent-progress.md` under "Follow-ups seen, not done". Two involve your dirty files (`hireBrief.ts`, `hireDraft.ts`, `deals/enrich`): once your edits land, their STOP wiring and run registration are one call each.



_(filled in by the supervising session when the loop stops; if this section is still empty,
the session was cut off: read `agent-progress.md` and `git log --oneline` for the truth.)_
