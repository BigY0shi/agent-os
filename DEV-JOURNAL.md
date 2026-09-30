# Agent OS — Dev Journal

## 2026-09-29 - "Delete" in four modules now exiles instead of destroying (v2.51.2)

Found by the Guide writers (v2.50.0): Agent Kanban (`kanbanStore.deleteBuild`), Music
(`musicStudio.deleteTrack`), Local builds (`localBuilds.deleteBuild`) and the Agent Room
history (`agentRoom.deleteConversation`) called `unlink`, which breaks the house rule that
nothing is ever hard-deleted. Agent Kanban's "Clear all" confirm even said "This can't be
undone".

New `src/lib/exileFile.ts`: `exileFile(file, root, stamp?)` moves a file to
`<root>/.exile/<stamp>/<relative path>` (the pattern `exileAgent`/`exileDossier` already
use), returns null when it is absent, and throws for a path outside the root. Each of the
four modules now exiles into its own folder; Music moves audio, cover and sidecar together
under one stamp. A side effect worth noting: Music used to `unlink(path.join(MUSIC_ROOT, f))`
with `f` taken from the sidecar, so a sidecar naming `../../x` could delete outside the music
folder; that is now refused. Every listing already filters to `.json`/manifest entries, so
the `.exile` folders never show up. The Kanban confirm text and the four Guide docs say what
really happens.

Not changed here (they sit in the owner's uncommitted files): `studioHistory.ts`,
`ultracodeRuns.ts`, `claudeArtifacts.ts` still hard-delete. Content Engine's Remove drops a
record from its state file (no file is deleted), left as is.

Verified: new `smoke-exile-deletes.mjs`, 20 checks (the helper; each module's delete leaves
the file under `.exile` and out of its list; Music's batch; the traversal refusal; the Room
leg runs only after asserting the vault resolves inside the temp dir; no `unlink` left in the
four files). tsc clean, smoke-guide passes.

Rollback: revert the commit.

## 2026-09-29 - The gate no longer makes live model calls (v2.51.1)

`test.sh` exports `AGENTIC_SMOKE_OFFLINE=1`, but two smokes ignored it for their live legs:
- `smoke-jarvis-brain.mjs` section H checked only `SMOKE_SKIP_SDK`, so every gate run made
  one real Claude SDK call (a tool-driving ask; billed to the subscription, roughly $0.50).
- `smoke-engine.mjs` ran a live task through Ollama whenever a provider was reachable.

Both now skip their live leg under `AGENTIC_SMOKE_OFFLINE` and say so; run either smoke
without the flag to exercise the real model. Verified: both pass with the flag and print
the SKIP line (jarvis-brain ALL PASS, engine ALL PASS).

Rollback: revert the commit.

## 2026-09-29 - Loop runs on CLI agents only (v2.51.0)

Owner, 2026-09-29: provider routing is CLI agents only ("openrouter isn't used", via
/agent-os-fix-provider-routing), then "Loop CLI Only". Loop was half there: both
defaults were already the Claude CLI, but:
- the Builder menu still offered N2 and GLM 5.2 via OpenRouter, the Judge menu N2 and
  the Fusion council (`src/lib/loopModels.ts`), and both menus added Nous Portal models
  from `/api/loop/nous-models`;
- the engine sent any id that was not `cli:`/`local`/`nous:`/`minimax:` to OpenRouter
  (`orComplete`, `orKey`), plus direct Nous Portal and MiniMax paths;
- a request with no builder defaulted to `minimax:MiniMax-M3` in `/api/loop/run`, a
  direct MiniMax API call;
- the page still said the judge defaults to "free N2", and the round chips said
  "Fusion verify".

**Changed.**
- `loopModels.ts`: the menus are the five wired CLI agents (Claude, Codex, Cursor, Pi,
  Hermes) plus, for the judge only, the local Ollama model. New `LOOP_CLI`,
  `isLoopBuilder`, `isLoopJudge`.
- `loopEngine.ts`: `workerAct` and `verdict` refuse anything else with a clear error. The
  OpenRouter, Nous Portal and MiniMax call paths (`orKey`, `orComplete`, `nousToken`,
  `nousModels`, `minimaxComplete`, `fusionVerdict`) are removed, and the `creds` argument
  with them. `MINIMAX_CHAT` stays exported because `v2/memory/llm.ts` uses it for its own
  owner-chosen memory provider.
- `/api/loop/run`: defaults the builder to `DEFAULT_WORKER` (Claude CLI) and refuses a
  non-CLI builder or judge before a round runs.
- `/api/loop/nous-models` is exiled to `.exile/2026-09-29_184632/`.
- `LoopView.tsx`: CLI-only groups with no duplicate options, honest copy, and "verify"
  on the round chips. The page subtitle (`pageMeta.ts`) and `docs/modules/loop.md` match.
- Ran `next typegen` so `.next/types` no longer points at the exiled route (types only;
  the build and `BUILD_ID` are untouched).

**Left as is, for the owner:** when a CLI judge returns nothing parseable, the local
Ollama judge still grades that round. It is labelled (`judgedBy`, `fellBackFrom`, a
flagged first issue) but was never chosen in a setting (rule 20). Also, the Agent Room
(`src/lib/agentRoom.ts`) still has an OpenRouter branch: any agent whose provider isn't
ollama/openai/cli falls through to `orComplete`, with a fallback to Hermes's default
model.

**Verified.** New `smoke-loop-cli-only.mjs`, 18 checks, with `fetch` stubbed and asserted
never called: the menus are CLI only and default to Claude; the engine and the route
refuse N2, GLM, Fusion, Nous, MiniMax, `cli:antigravity` and `cli:rm` with a clear error
before any round; the removed helpers are gone; the UI, subtitle and doc say CLI. The
page was DOM-checked in the browser pane with a fake agent list: two groups per menu, no
duplicate or non-CLI options, and both defaults are `cli:claude`. tsc clean; full gate
green.

Rollback: revert the commit and move `.exile/2026-09-29_184632/src/app/api/loop/nous-models/route.ts`
back to `src/app/api/loop/nous-models/route.ts`.

## 2026-09-29 - Fusion shows only what the request reports: no invented panel or stages (v2.50.4)

Found by the Guide writers (v2.50.0 entry) and confirmed in the code before changing it:
`src/components/FusionView.tsx` rendered a hardcoded `PANEL` ("Opus 4.8", "Gemini 3",
"Grok", "Fable 5", "+ more") as pulsing chips while waiting, a status line chosen by
`stageFor(elapsed)` ("deliberating" at 8 s, "web searches" at 28 s, "the judge is
weighing" at 55 s) and a shimmer progress bar. The route
(`src/app/api/fusion/chat/route.ts`) never reports any of that: it forwards only the
answer text. The "Ask the board" preset had an empty template and the click handler
skipped empty ones, so it did nothing.

**Changed.** The route sends one real milestone, `{"t":"status","s":"accepted"}`, once
OpenRouter has answered 200. The waiting card shows the real elapsed time and a line that
follows what the route reported ("Sending your question to OpenRouter", then "OpenRouter
accepted it. Waiting for the answer to start"), plus a plain note that Fusion does not
report which models are on the panel or how far along they are. The streaming label is
"Answer streaming" (was "Judge writing the verdict", which the page cannot know). The
chips, stage text and shimmer are gone; the empty preset is removed and a preset click
always fills the box. `docs/modules/fusion.md` updated to match.

**Not changed, waiting on the owner:** the `HTTP-Referer: https://aiprofitboardroom.com`
header (looks inherited from upstream; OpenRouter uses it for app attribution). Also
open: Fusion calls OpenRouter directly, while the owner says provider routing is CLI
agents only. Sakana Fugu (`SakanaView.tsx`) has the same shimmer and was not in scope.

**Verified.** New `smoke-fusion-honesty.mjs`, 17 checks: no hardcoded panel, no text
chosen by elapsed seconds, no shimmer, the one interval only ticks the clock, every
preset has a template; the route against a stubbed OpenRouter (fetch replaced, HOME in a
temp dir so the real key is never read) sends "accepted" only after a 200 and before the
first text, relays the text exactly, sends no "accepted" on HTTP 429, and fails loudly
with no key. DOM-checked in the browser pane with a fake stream: "Sending" at 1 s,
"accepted" at 3 s, the text under "Answer streaming", no model chips at any point, and
the Fact-check preset filled the box. tsc clean; smoke-guide passes.

Rollback: revert the commit.

## 2026-09-29 - db.backup writes beside the database it backs up, not into the home dir (v2.50.3)

**The bug.** `registerCoreJobs()` in `src/lib/v2/boot.ts` built the nightly backup folder
from `os.homedir()` (`~/.agentic-os/backups`, old snapshots exiled to
`~/.agentic-os/.exile/`), while the database path honours `AGENTIC_OS_DB`
(`src/lib/v2/db.ts` `dbPath()`). Any process pointed at a temp DB, which every V2 smoke
is, would, if the job ran (Standing orders "Run it now", or a scheduler tick past 03:30),
snapshot the TEMP database into the owner's REAL backups folder under today's filename,
overwriting that day's real snapshot. `smoke-standing.mjs` had only dodged it by
redirecting HOME/USERPROFILE.

**The fix.** New `backupDirFor(dbFile)`: `AGENTIC_OS_BACKUPS_DIR` when set, otherwise a
`backups` folder next to the file `ensureDb()` actually opened (`db.name`). The exile
root is `.exile` beside the backups folder. Default install unchanged:
`~/.agentic-os/agentos.db` still backs up to `~/.agentic-os/backups` and exiles to
`~/.agentic-os/.exile`. A DB with no file path (`:memory:`) now fails loudly instead of
writing into the cwd.

**Verified.** New `smoke-db-backup-location.mjs`, 17 checks: default and override
paths; `runInline("db.backup")` against a temp DB puts the snapshot beside it and it
reads back as a real copy (marker row); nothing appears under the (redirected) home;
retention keeps 14 and exiles the oldest beside the backups; the real
`~/.agentic-os/backups` listing and mtimes are identical before and after. tsc clean;
smoke-standing still passes.

Rollback: revert the commit (the handler goes back to `os.homedir()` paths).

## 2026-09-29 - smoke-widgets no longer fails between 11:00 and 12:00 UTC (v2.50.2)

The gate's second run stopped at `smoke-widgets` "scope=upcoming ... soonest first": the
check required the smoke's own "due in 1h" task to be first in the WHOLE upcoming list,
but the boot-seeded tasks carry real next-run times, and at 11:05 UTC the seeded Morning
Brief (next run 12:00 UTC, 7:00 America/Chicago) legitimately sorted ahead of a task due
at 12:05. Pre-existing and time-of-day dependent; neither the widgets store nor the smoke
had changed. The order is now judged among the smoke's own tasks only. Passes.

Rollback: revert the commit.

## 2026-09-29 - smoke-standing isolates principals (v2.50.1)

The full gate stopped at `smoke-browser-ownership` F4: the isolation guard follows imports
transitively and found that `smoke-standing.mjs` (S26) reaches `saveAgent`, which can
register a browser principal, without redirecting `AGENTIC_OS_PRINCIPALS`. It now points
that at its temp dir like every other store. browser-ownership and standing both pass.

Rollback: revert the commit.

## 2026-09-29 - Guide: every module, tab and control, written from the code (v2.50.0)

S29 of `_design/jarvis-v3-plan.md` (owner: "every module, every tab, and every action
inside of each needs to be documented in a wiki", and "we'll use that to update the
Github with real docs"). Written last, after the other slices, so it documents what
shipped.

**The docs** (`docs/modules/`, 50 files, one per sidebar module): each has a Route / UI /
Backend line, what the module is for, a **Tabs and controls** table (every tab and
control named exactly as it appears on screen, with what it does) and **How it works**
(where its data lives, what runs, what it needs, limits). Written by five parallel
writer agents under one brief ("from the code, never from guesswork"; real paths only;
no em dashes), then checked. `deal-desk.md` kept every existing line and gained its
controls table. Plus `docs/guide/start-here.md`, `around-every-page.md` and
`how-it-works.md`, written from facts verified in this session. The module index
(`docs/modules/README.md`) lists all 50; the root README links it.

**The page** (`/guide`, reached from a new **Guide** link in the top bar): a hero with a
tile per module, a sticky contents rail (Start here, Around every page, the modules, How
it works), search across everything, each doc rendered with its tables
(`react-markdown` + `remark-gfm`, already dependencies) and an **Open <module>** link.
It reads the markdown at request time (`src/lib/guide.ts`), so a doc edit shows without a
rebuild. The previous /guide content (BUILD-YOUR-OWN.md via `/api/guide`) is kept as the
last section; the old page file is kept under `.exile/`.

**Found while writing (the writers read every module's code):**
- `docs/modules/claude.md` and `agents.md` are the same file names as `CLAUDE.md` and
  `AGENTS.md` on Windows (case-insensitive), so an agent CLI working in that folder
  would load a module doc as its instructions (global rule 20's trap). Renamed to
  `claude-cli.md` and `agents-page.md`; the smoke fails if such a name returns.
- Code that says one thing and does another, reported per module and NOT changed here:
  Fusion and Sakana Fugu show timer-driven progress (queued as a task); the Agent Room,
  Idea Engine, Video b-roll and Hermes Talk switch providers without it being chosen
  (Agent Room queued as a task); Agent Kanban shows a "Reviewer" step that is a 950 ms
  pause; Pipeline's Remove posts to a route that does not exist; Video renders through a
  `hyperframes` path that does not exist on this machine; Agent Kanban, Music, Content
  Engine, Local builds and the Room history hard-delete files; saved-but-unused settings
  in Kanban, Notebook, SEO and Open Design; stale macOS setup text and hardcoded
  upstream names/paths in Kanban, Antigravity and SEO; the Oracle voice gear still
  defaults to the retired Voicebox; the Skills gear points at a section that no longer
  exists. The docs describe the real behaviour, so they are accurate today and will need
  a touch when these are fixed.

**Verified.** New `smoke-guide.mjs`, 16 checks: every sidebar module (50) has a doc whose
route matches it, every documented route is a real page, every doc has its controls
table and How it works, every Jarvis tab (13) has its own section, no instruction-file
names, no dashes in the docs' own prose (verbatim UI labels in code spans excepted),
the loader, the page wiring, both indexes. Visually checked in the browser pane with the
real docs and CSS: the tile hero, the rail, search, the rendered tables. tsc clean.

Rollback: revert the commit (and restore `src/app/guide/page.tsx` from `.exile/` if
needed).

## 2026-09-29 - Voice mode: pick who you are talking to on a dial, and talk (v2.49.0)

S22 of `_design/jarvis-v3-plan.md` (the owner's NEXORA "Hand mode" dial, without the
camera hand control). A Jarvis tab, **Voice** (`components/jarvis/VoiceTab.tsx`):

- **The dial**: an elliptical rotating card carousel of everyone you can talk to:
  Jarvis, the Oracle, every Mastermind specialist (`/api/room/status`) and every crew
  agent (`/api/v2/crew`), each with its role and live status. Turn it with the arrows,
  the arrow keys or a click, or say "talk to Hermes" / "switch over to the Oracle"
  (switches instead of sending). No wheel binding, so the page keeps its scroll.
- **The stage**: the chosen agent's face (Jarvis's constellation, the Oracle's galaxy,
  the constellation for the rest), driven only by real signals: listening while the
  mic records, thinking while a reply is awaited, speaking while the audio plays, with
  the level read from that audio.
- **Talking**: push-to-talk (hold Space or the mic button) through Parakeet
  (`useVoiceCapture`, provider "parakeet", `/api/stt/transcribe`), or type. Each member
  answers over its own lane: Jarvis over `/api/v2/jarvis/ask` (SSE sentences, keeping
  the conversation), the Oracle over `/api/oracle`, a specialist alone over `/api/room`,
  a crew agent with a real run over `/api/v2/crew/<id>/chat` polled to its end (10
  minute deadline, said).
- **Speaking**: replies through Kokoro (`/api/hermes/tts`, provider "local"). Jarvis
  uses `bm_george`, the Kokoro voice already used for him in this codebase; everyone
  else uses Kokoro's default (no voice ids were invented). A failed voice, an empty
  reply, an unavailable mic are each said; typing still works without a mic.
- Suggested prompts per kind of member; a conversation panel per member.

Surveyed first (read-only): the capture hook, the TTS contract, the ask lanes and the
voice settings. Found on the way: the Voice dial rendered broken because of the glass
positioning bug, fixed separately in v2.48.1.

**Verified.** New `smoke-voice-mode.mjs`, 23 checks: the roster sources, each lane's
route, Parakeet in and Kokoro out, the named voice existing in the TTS route, the face
honesty rules, the real "talk to" pattern run on phrases, the dial controls and no wheel
trap. Visually checked in the browser pane with the real CSS after the glass fix: the
dial spreads along its ellipse, the face and the prompts render. Not exercised here: a
live microphone and a real spoken reply (needs the owner at the machine; over the
tailnet the mic also needs HTTPS, per AGENTS.md). tsc clean.

Rollback: revert the commit.

## 2026-09-29 - Glass cards no longer override absolute / fixed / sticky (v2.48.1)

While checking the Voice dial in the browser pane, its cards piled up and its arrows sat
mid-row. Measured in the page: every card and arrow computed `position: relative`
despite an `absolute` class. Cause, `src/app/globals.css:715-716` (my S11 rule):
`.glass, .glass-strong, .glass-frost, .glass-inset { position: relative; }` was
UNLAYERED, and Tailwind v4 puts its utilities in a cascade layer; unlayered CSS beats
every layer, so the rule silently won over `absolute`, `fixed` and `sticky` on any glass
element. Also affected (found by a search for the combination): the Agent City hover
card (absolute), the Archive reader (sticky) and the Mastermind rail (lg:sticky).

Fix: that one declaration moves into `@layer components`, below utilities. Glass
elements stay relative by default (checked: a plain `.glass-strong` still computes
`relative`); a positioning utility now wins, as intended. After the fix the dial's cards
compute `absolute` and spread along the ellipse, and the arrows sit at the edges.

New `smoke-glass-layer.mjs` (2 checks): the layered rule exists, and no unlayered glass
rule sets `position`. Proven to catch the old CSS (it reports exactly the old rule as an
offender) and to pass the new. jarvis-v3-ui 43 pass.

Not touched: the design hook flagged two pre-existing lines elsewhere in globals.css (a
one-sided accent border at line 699 and a width/height transition at line 272); they
are not part of this fix.

Rollback: revert the commit.

## 2026-09-29 - AI Agent Mastermind: a line to every specialist (v2.48.0)

S25 of `_design/jarvis-v3-plan.md` (NEXORA "Chat"). A restyle around the existing
module, not a new one: `/room` now renders `MastermindView`, which puts a
**Specialists** rail beside the existing group chat.

- **Rail**: every room specialist with ONE status word from a real signal
  (`GET /api/room/status`), in this order: *working now* (a reply from it is in flight:
  an in-memory counter the room route raises before `roomReply` and releases in a
  `finally`, so a failed or aborted reply can never leave it stuck), *unreachable* (what
  it needs is missing: its CLI not installed, or its key not set, named on hover),
  *active today* (it spoke in a conversation saved today), *ready*. Header: N
  specialists, M working now.
- **The whole room** is the existing group chat, unchanged (its history list now leaves
  out the one-on-one threads, which share its store).
- **One-on-one**: choosing a specialist opens a persistent private thread with it. It
  posts to the same `/api/room` endpoint targeted at that one agent and saves through
  the same vault-backed store as `dm-<agent>`, so it survives reloads and shows on any
  device.

**Flagged, not changed:** `roomReply` (`lib/agentRoom.ts`) quietly retries an OpenRouter
agent on Hermes's default model when its own model fails, and the reply does not say
which model answered. That is the silent-fallback pattern AGENTS.md rule 20 rules out;
raised with the owner rather than decided here.

**Verified.** New `smoke-mastermind.mjs`, 15 checks with HOME, the config file and the
vault in temp dirs (the conversations are proven to land in the temp vault): the
working counter, every specialist's status matching its signals (derived from this
machine's real CLI presence rather than hard-coded), the finally-release in the room
route, the dm- threads and their exclusion from the group list, the page wiring.
Visually checked in the browser pane with the real CSS: the rail, the unchanged room,
and a persisted one-on-one thread. tsc clean.

Rollback: revert the commit (the page goes back to `GroupChatView`).

## 2026-09-29 - Crew archive: everything the agents produced, read where it lives (v2.47.0)

S24 of `_design/jarvis-v3-plan.md` (NEXORA "Crew archive"). A Jarvis tab, **Archive**:
one searchable, filterable wall of every document the crew produced, each card with its
source, author, word count and date, and a reader with the document's metadata and a
link to open it where it lives. Nothing is copied: `lib/v2/archive/archive.ts` builds
an index at read time (cached 30 s) from the stores that already hold each thing
(mapped by a read-only survey of the codebase first):

- **Mission reports** and each **seat's answer** (`~/.agentic-os/missions/`), the seat's
  CLI and model as the author;
- **Oracle** consultations (`lib/oracle.readConsultations`), the question as the title;
- **News Radar** briefings (`~/.agentic-os/news/log.json`), with their items;
- **Deal Desk** and **Hire Engine** pitches (`listDeals`, `listHireLeads`, the text the
  owner would send);
- **Jarvis** conversations (whole transcripts, system lines left out; the link resumes
  the conversation);
- **Brainstorm** council briefs.

Search reaches titles, authors and the text itself; filter by source. Each store is
fenced: one that cannot be read is named on the page ("Could not read: news (...)") and
the rest still show. `GET /api/v2/archive` (list, `?q=`, `?source=`, `?fresh=1`) and
`?id=` for one whole document; lists never carry bodies.

**Verified.** New `smoke-archive.mjs`, 21 checks with HOME and every store in a temp
dir: all fixture sources indexed with the right labels, authors, real word counts and
newest-first order, search into the body, the source filter, the reader with metadata,
404 for unknown ids, a broken store reported while the others show, and a before/after
snapshot proving no store file is written. Deal and Hire pitches follow the same reader
pattern but have no fixture here (their scraper folders are empty in the smoke). tsc
clean.

Rollback: revert the commit.

## 2026-09-29 - Mission board: everything waiting on you, and missions by state (v2.46.0)

S23 of `_design/jarvis-v3-plan.md` (NEXORA "N decisions need you"). Missions now has two
views, remembered per browser: **Desk** (the S17 layout) and **Board**:

- **Waiting on you** (left): mission plans to approve and results to read, PLUS the
  agents' own approval queue from the existing `GET /api/agents/approvals` (tool
  approvals with Allow / Deny, parked questions with a reply box), answered in place
  through the existing `POST /api/agents/approvals`. One list for every decision.
- **The ring** (centre): missions by state with real counts, In flight / Review /
  Blocked / Delivered, plus how many are queued in briefing. Blocked means failed,
  stopped, or a plan that could not be made (said on hover). A segment, or its legend
  button, lists its missions.
- **Delivered** (right), and the chosen mission's full detail and desk below.

No new endpoint: the board reads `/api/v2/missions` and the agents' approvals route.

**Verified.** `smoke-missions.mjs` gains 3 checks (now 71): the view toggle, the
approvals wired to allow / deny / answer, the four ring states and the Blocked
definition. Visually checked in the browser pane with the real CSS and fake data (a
mission to read, a Gmail-send approval, an agent's question). The first render was
stacked because the harness CSS had not been recompiled after the edit; with it
recompiled the three columns render as designed. tsc clean.

Rollback: revert the commit.

## 2026-09-29 - Standing orders: every recurring job on one page (v2.45.0)

S26 of `_design/jarvis-v3-plan.md` (NEXORA "Schedule": nothing runs behind your back).
A Jarvis tab, **Standing orders**, over the three places recurring work actually lives
(`lib/v2/standing/orders.ts`, `GET/POST /api/v2/standing`):

- **Scheduled tasks** (v2 tasks with an RRULE, live or held): owner and "delivered by"
  (the task's agent, else the task runner), cadence in words, what it is told, runs so
  far, last run and its result or error, next run. Actions go through
  `tasks/recurrence.applySchedule` (hold / let run flip `isActive` and re-arm or drop the
  wake job) and `scheduler.enqueueTask` (run it now). **Take it off** clears the schedule;
  the task itself stays.
- **Agents' `schedule` triggers**: cadence as the cron croner actually runs (the same
  `normalizeSchedule` + `Cron.nextRun` as `agentsTriggers.ts`, so the "next" time is the
  real one), the first part of the agent's system.md, its tier's model, scheduled runs
  among its last 100 runs. Hold / let run switch the whole agent (said on the card);
  take it off removes only that trigger after keeping `agent.json` as a version under
  `~/.agentic-os/file-versions/`.
- **System jobs** (v2 scheduler jobs with an rrule that are not task wake-ups, e.g. the
  nightly DB backup): hold / let run via the scheduler; never taken off (Agent OS re-creates
  them at boot, said on the card).

Header counts: on the books, live, next one. Filters: all / live / held. A field no
source records (a task's model when it has no agent) reads "not recorded". Take it off
always asks first.

**Found and flagged, not changed here:** the `db.backup` job (`lib/v2/boot.ts`) writes to
the real `~/.agentic-os/backups` regardless of `AGENTIC_OS_DB`, so a smoke that ever ran
it would snapshot a temp database into the owner's real backups (and could overwrite that
day's file). `smoke-standing` redirects HOME/USERPROFILE and never runs a system job;
the fix is queued as its own task.

**Verified.** New `smoke-standing.mjs`, 30 checks (all three sources, counts, every
task action including that the wake job is armed and dropped, agent hold / resume /
take-off with the version kept, system hold and the refused take-off, routes, UI). The
agent and system "run it now" paths are not exercised offline (they start a real agent
run or a real backup). tasks 78, tasks-api 54, tasks-ui 55, jarvis-v3-ui 43 pass; tsc
clean.

Rollback: revert the commit.

## 2026-09-29 - Health: the machine in plain words, with a live history (v2.44.0)

S27 of `_design/jarvis-v3-plan.md` (NEXORA "Health"). It shares its endpoint with the
S18 System pulse, so rather than a second overlapping page, the Mission Control
"System pulse" view grew into **Health** (same view key; the label is now Health).

- **Headline in plain words**: "The machine is quiet and well" only when every check
  passes; otherwise "N things need a look: <which>", with an N-of-M checks ring.
- **This machine**: host, system, kernel, processor, uptime, drive count.
- **Load 1 / 5 / 15 min**: bars on systems that keep a load average; on Windows it says
  plainly that there is none and points at the live processor line.
- **Memory** in use vs free.
- **Four sparklines** (processor, memory, system-drive use, network) over the last
  minutes, each labelled by a SHAPE word computed from the samples (`hostSampler.shapeOf`:
  flat / spiky / bursty / steady, "gathering" with fewer than 4 samples).
- **Per-core** bars, **storage per partition** (every drive letter that exists:
  `hostHealth.allDisks`; on this machine C: 89%, E: 83%, F: 74%, G: 81%, I: 81% used),
  **busiest processes** as tiles with Everything / Agents only (processes named after an
  agent CLI, said so), **diagnostics** and **local services**.

**Sampler** (`src/lib/hostSampler.ts`): in memory, every 5 s, ONLY while someone reads
it (starts on the first read, stops 2 minutes after the last), at most 120 samples. CPU
from `os.cpus()` deltas, memory from `os`, system-drive use from `statfs`, network bytes
per second from the OS counters (`netstat -e` on Windows, verified against this machine's
output; `/proc/net/dev` elsewhere); an unreadable counter is null ("unknown"), never 0.
`GET /api/v2/home/pulse?history=1` adds the history and every drive.

Tooling note: an appended block through a Git Bash heredoc lost one backslash in
`"C:\\"` (rule 28, again; the grep check passed because grep -F also saw one). tsc caught
it; the string is now built with `String.fromCharCode(92)`.

**Verified.** New `smoke-health.mjs`, 22 checks (shape words on known series, the
netstat parser, the sampler's cap and self-stop, the endpoint with and without history,
the view's honesty rules). Visually checked in the browser pane with the real CSS.
home-cockpit and home-ui pass; tsc clean.

Rollback: revert the commit.

## 2026-09-29 - Files: read and edit the files that shape each agent, safely (v2.43.0)

S28 of `_design/jarvis-v3-plan.md` (owner: "a Files tab to view and EDIT files right in
the OS", "more importantly"). A Jarvis tab, **Files**: agents on the left, their files
grouped Identity / Memory / Configuration / Skills in the middle, an editor on the right.

**Where the files really are** (checked on this machine before building, not assumed):
Jarvis `~/.agentic-os/jarvis-persona.json` (what `jarvisPersona.ts` reads; absent here,
so the tab says Jarvis runs on his built-in persona); Hermes at `$HERMES_HOME`, which is
`%LOCALAPPDATA%\hermes` on this machine (SOUL.md, memories/USER.md, memories/MEMORY.md,
config.yaml; `~/.hermes/profiles/Main` holds only `.env` files and is not a source;
without HERMES_HOME the Windows install folder is tried before `~/.hermes`); each Agent
OS agent's `system.md`, `agent.json` and other top-level notes; each Agent OS skill's
`SKILL.md`. Read-only check against the real folders: Hermes 4 files, 3 agents, 5
skills.

**Safety, in `lib/v2/files/agentFiles.ts`:** an allow-list re-derived on every request
(an id is only a source + a relative path found in that listing); `..`, absolute paths
and malformed ids refused; the resolved REAL path must sit inside the source's real root
(a symlink escaping its folder is a 403); `.env*`, `auth*`, `*token*`, `*secret*`,
`*credential*`, `*.pem`, `*.key` and lock files are never listed or served (Hermes's
`auth.json` and `.env` included); secret-looking values in yaml/json configs come back
as `********` and a save that keeps a mask gets the original line back (a mask with no
original is refused); files that shape an agent need an explicit confirm (the UI's
gate: "I understand, let me edit" / "Just read it"); every save first copies the
previous version to `~/.agentic-os/file-versions/<source>/<path>/<timestamp>` (a no-op
keeps none); a save is refused with 409 and the current text when the file's sha256
changed since it was opened, and the editor keeps the owner's text to copy; JSON must
parse and YAML must load before anything is written; writes are atomic.

**Routes** `GET /api/v2/files` (sources + counts: agents, editable files, last changed,
versions kept) and `/api/v2/files/file` (GET read with versions, POST save).

**Verified.** New `smoke-files.mjs`, 35 checks on temp fixtures (with decoy `.env`,
`auth.json`, lock files and real-looking keys): listing, every refusal including the
symlink escape, masking on read, restore on save with the real keys still on disk,
invalid JSON/YAML untouched, versions kept, the 409 path, routes, UI wiring. Visually
checked in the browser pane with the real CSS. tsc clean.

Rollback: revert the commit. Saved versions stay under `~/.agentic-os/file-versions/`.

## 2026-09-29 - Crew: Agent City, the crew ring, a messenger per agent, Deploy agent (v2.42.0)

S21 of `_design/jarvis-v3-plan.md`, from the owner's NEXORA "Agent City" screenshots
and his description (2026-09-28): the orchestrator is a tower in the centre, every
agent gets its own procedurally generated building that pulses by state, clicking a
building opens a messenger-style chat, and a GitHub-style tracker sits below. Placed
as a new Jarvis tab, **Crew**, since Jarvis is the orchestrator; the existing Agents
page is untouched.

**Numbers, all from the agents' recorded runs** (`lib/agentsStore.listRuns`, up to 500
per agent), via `lib/v2/crew/crew.ts` `buildCrewSnapshot` (pure) and `GET /api/v2/crew`:
agents, working now (live status feed), messages in 7 days (one run = one message and one
reply), average reply (run end minus start), agent time this month. Per agent: runs, reply
time, tokens, runs recorded, last seen. **When the crew speaks**: a 7-day by 24-hour
heatmap (and a 24-hour strip), owner messages at the START of runs the owner sent
(manual, crew chat), agent replies at run ENDS, with a both / you / agents toggle. **Recent
activity** in words. The basis is printed on the page.

**Agent City** (`components/jarvis/AgentCity.tsx`, three.js, lazy): the violet tower;
one building per agent, tiers and footprints seeded from the agent id (stable across
visits, nothing random); neon edges and a beacon in the agent's live status colour
(blue working, warm ready, violet waiting on you, red error, dark off), pulsing at a
rate set by that status; a road to the tower that carries moving pulses only while the
agent is running. Agent-to-agent hand-offs are not recorded anywhere yet, so none are
drawn. Hover card: runs, tokens, reply time. Click: opens the chat. Pauses when hidden
or off screen; still under reduced motion; a plain wheel scrolls the PAGE (Ctrl/Cmd +
wheel zooms) after the first visual pass showed the canvas trapping page scroll.

**Talk to the crew ring**: Jarvis in the centre, each agent an outer segment in its
status colour, keyboard-selectable. **Chat** (messenger drawer): each message starts a
real run of that agent (`startRun`, trigger `crew-chat`); the log
(`~/.agentic-os/crew/<agent>.jsonl`, `AGENTIC_OS_CREW_DIR` for smokes) keeps only the
owner's words and the run id, and every reply is read from that run's own record (its
result, "Working…" while it runs, the reason when it could not start or failed, "record
missing" when it is). Polls only while a reply is pending.

**Deploy agent** (4 steps): pick a prepared role (`lib/v2/crew/roles.ts`: Researcher,
Writer, Inbox triage, Deal scout, Code reviewer, Social listener; instructions written
as plain editable data, rule 17) or write your own; name + one-line role + the
instructions, editable; the model tier with the model it actually runs on today
(`agentsRuntime.modelFor`, now exported); review and confirm through the existing
`POST /api/agents`. A degraded creation shows its warning instead of pretending.

**Verified.** New `smoke-crew.mjs`, 33 checks (known-time runs through the pure
snapshot, the chat assembly, routes from an empty temp agents dir, UI wiring). Visually
checked in the browser pane with the real CSS and fake crew data: city, ring,
messenger, roster, heatmap, recent. agents-forge 56, agents-questions 49,
agents-status 35, agents-ui 87, jarvis-v3-ui 43, missions 69, jarvis-mcp 51 pass;
tsc clean. Not yet exercised against the owner's real agents (a chat message starts a
real, billed run).

Rollback: revert the commit; `~/.agentic-os/crew/` is only read by this code.

## 2026-09-29 - Activity feed: real log times or none, never invented (v2.41.1)

From the NEXORA diff (`_design/nexora-diff.md`), which flagged
`src/app/api/activity/route.ts:23`: every tailed log line got a made-up time (the log
file's mtime minus 200 ms per line), and both the Activity stream and the home
MiniTimeline showed it as when the line happened (AGENTS.md "Never fabricate state").

Fix: new `src/lib/logTime.ts` `lineTime()` reads the time a line carries (ISO,
space-separated, comma or dot millis, Z or offset) and returns null when there is none.
The route returns `ts: number | null`; lines still sort by their own time where known,
else by their file's mtime and position, but that key is stripped before the response.
`ActivityStream` and `MiniTimeline` show an unknown time as `--:--:--` with a title
saying the line carries no time.

The same diff flagged `src/lib/agentRoom.ts:21` as a possible unlabelled fallback.
Read, not changed: with no Ollama Cloud key set, the Agent Room sends Ollama agents to
the local daemon, by configuration rather than after a failure, and its error messages
say so. It does not label a successful local answer, and it runs against the owner's
"everything through Ollama Cloud" policy when the key is missing; that is his call and
is raised with him, not decided here.

New `smoke-activity-times.mjs` (11 checks); home-ui 77 pass; tsc clean.

Rollback: revert the commit.

## 2026-09-29 - Mission Control: telemetry on first load, a System pulse view, the scratchpad moved down (v2.41.0)

S18 of `_design/jarvis-v3-plan.md`. The owner: Mission Control had "no information on
the initial load" and he had to "scroll past that gigantic scratch pad"; he liked how
NEXORA presents telemetry.

**Views.** `Overview.tsx` gains three views (remembered per browser, falls back to
Cockpit): **Cockpit** (default) = greeting, a telemetry band, attention, the widget
grid, and the scratchpad LAST; **System pulse** = the full machine view; **Scratchpad**
= the pad on its own.

**Telemetry band** (`components/v2/home/Cockpit.tsx`), four glass cards:
System pulse (status word, N of M checks clear, CPU / memory / disk bars), Runs (a ring
of runs with the success rate, running now, the average run, a strip of the last 24
outcomes, "Counted over every running run plus the last 50 finished"), Missions
(queued / running / review / parked, waiting on you, delivered, a link to Missions),
Orchestration (Jarvis over each configured agent with its live status, plus mission
seats running per CLI, with load bars).

**System pulse view:** processor / memory / disk rings, per-core bars, "What is holding
the machine" (top processes by CPU over a 0.7 s window and by memory), the diagnostics
checklist and the local services.

**Endpoint** `GET /api/v2/home/pulse` aggregates the sources, each fenced so one broken
source lands in `errors` and the rest still answers: `hostHealth.healthReport`, the
module-run registry (window stated; success rate null with no runs, never 0 or 100),
the S17 mission records, the agent status feed, running seats per CLI.
`?processes=1` adds `hostHealth.topProcesses()`.

**Process sampling, measured before choosing** (2026-09-29, this machine, 947
processes): reading CPU time through Get-Process for every process took 9.2 s (the
protected session-0 services fail slowly), a foreach variant 19 s, the perf-counter CIM
class 6.3 s, while name/id/memory took 0.33 s and CPU for the owner's own session 1.0 s.
So CPU is sampled for the owner's Windows session (two samples, about 2.4 s total) and
memory for every process; unsampled CPU is -1 ("not measured"), filtered out of the CPU
list, and the scope is printed under it. Cached 5 s; only called while that view is
open.

**Verified.** New `smoke-home-cockpit.mjs`, 29 checks (temp stores, fetch stubbed):
measured host, stated window, success rate from real outcomes, null with no runs,
missions by stage, seat load, a broken mission record never hiding the rest, the
sampler's honesty rules, the view order. Visually checked in the browser pane with the
real compiled CSS: the first pass drew the per-core bars as floating pills, fixed to
baseline bars before commit. home-ui 77, widgets 59, control-room 42, missions 69 pass;
tsc clean. Noted, not changed: booting V2 foundations inside a smoke (as the Control
Room insights route already does) tries to open the browser live-view port 3738 and
logs a port conflict while the app is running; harmless, pre-existing.

Rollback: revert the commit.

## 2026-09-29 - Missions: a dedicated Goal Mode with a crew, a desk and a timeline (v2.40.0)

S17 of `_design/jarvis-v3-plan.md`, from the owner's NEXORA screenshots ("essentially a
dedicated Goal Mode", "make sure it has the history of the agents' work").

**Flow.** Brief -> Jarvis plans -> the owner approves -> seats run -> Jarvis reports ->
review (accept, or send back with a note) or straight to delivered, as the owner chose.
Nothing runs before approval; a plan or result sent back re-plans with the note (and the
last report) in the planner's prompt.

**Library** `src/lib/v2/missions/`:
- `store.ts`: files, not a DB migration (so no migration-number race with other work):
  `~/.agentic-os/missions/<id>/mission.json` (atomic), `events.jsonl` (append-only,
  WHAT HAPPENED, IN ORDER), per-step `.log` (raw output) and `.md` (answer), and one
  scratch dir per step (`seats/<step>/`, the seat's cwd). Ids and step ids are
  pattern-checked, so no path walks out. `AGENTIC_OS_MISSIONS_DIR` for smokes.
- `runtime.ts`: the planner (claude, one-shot, strict JSON: a plan that cannot be read
  is an error, never a guessed plan; steps capped at the mission's maximum, every
  dependency must be an earlier step, every seat must be on the crew); the scheduler
  (independent steps run in parallel; a step starts when its dependencies are done and
  gets their answers in `./inputs/`; a failed dependency stops its dependants); the time
  limit as a real timer that kills running seats and reports with what finished; STOP
  (the whole process tree on Windows via taskkill /T); the report (claude, length as
  chosen, told not to invent results); restart recovery (a step still marked running
  with no live process is marked lost, never shown as running); measured stats.
- Seats: `claude -p --model <m> --max-turns 50 --permission-mode acceptEdits
  --allowedTools Read,Write,Edit,Glob,Grep,WebSearch,WebFetch` (no shell), prompt on
  stdin; `hermes chat -q ... --max-turns 50` (flags as in Hermes Goal Mode); `codex exec
  -s workspace-write -C <seat dir> -` and `agy -p`, which have no turn flag and are
  bounded by the time limit, said so in the wizard and in each hand-off event. Spawned
  through `runner.spawnStream`, so npm `.cmd` shims resolve on Windows.
- Every hand-off event carries the exact brief the seat was sent; "last heard" is the
  time of the seat's last real output line.

**Routes** `/api/v2/missions` (GET list + stats + crew, POST create) and
`/api/v2/missions/[id]` (GET mission + events, `?step=&kind=md|log` for a seat's answer
or raw output, POST approve / send-back / replan / accept / stop).

**Tab** Jarvis > Missions (`components/jarvis/MissionsTab.tsx`): a headline count of
decisions waiting on you; stats (waiting on you, median cycle time, on-time % over
missions with a target date, agents at work), each with its basis stated; IN FOCUS
(steps with a LIVE marker, "waits for", last heard, answers and raw output, crew
rationale, guardrails, a time-limit ring, the report); YOUR DESK (approve plan / accept
result / send back with a note / STOP / plan again); four stage columns; the timeline
with expandable briefs; the 3-step create wizard (brief; Jarvis picks the team or you
choose each crew member's CLI, model and role; time limit 15 min to 8 h, maximum steps,
report length, review first or deliver).

**Verified.** New `smoke-missions.mjs`, 68 checks, offline with fake drivers (no CLI
ever starts): validation, strict planning, parallel start, hand-off briefs, dependency
waits, inputs handed on, report and review, a failure cascade, STOP, the time limit,
restart recovery, send back with a note, per-CLI flags and turn caps, stats, routes
(including path-walking ids refused), UI wiring. Visually checked in the browser pane
with the real compiled CSS and fake data: a first pass showed the stage columns as
light panels on the dark page, fixed before commit. tsc clean; jarvis-v3-ui 43,
jarvis-mcp 51 pass. Not yet run against real CLIs (that spends the owner's
subscriptions): the first live mission is the owner's.

Rollback: revert the commit; `~/.agentic-os/missions/` is only read by this code.

## 2026-09-29 - Jarvis keeps his warm session when memory updates the persona (v2.39.2)

`smoke-jarvis-brain` "sdk turn 2 reused the warm session" failed intermittently (2 of 3
runs on 2026-09-28): turn 2 answered correctly but on a freshly booted session
(`turns: 1`). Diagnosis, read through the code rather than guessed:

1. every turn is ingested into memory fire-and-forget (`brain.ts` `ingestExchange`);
2. a finished ingest runs `personaTrigger` (`memory/queue.ts`, post-COMPLETED seam),
   which generates the persona document when none exists (`persona.ts`
   `checkPersonaUpdateThreshold`) and updates it incrementally after that;
3. the persona document is part of Jarvis's stable system prompt (`context.ts`
   `buildStableSystemPrompt` -> `userPersonaBlock`);
4. a changed stable prompt rebuilds the warm session (`askSdk` stale check).

So whenever the ingest finished before the next message, the session was thrown away
mid-conversation and the history replayed. That is live-app behaviour, not only the
smoke's: it cost a full re-prime on the next turn and broke session continuity. The
smoke turns ingestion on with a real provider before its live leg, which is why it saw
it; timing is why it was intermittent.

Fix: the session pins the persona it booted with (`SessionState.personaDoc`); the same
conversation keeps building its stable prompt from the pinned copy, and any rebuild (a
new conversation, a skill or tool change) starts from the current persona. Also added:
the done event now carries `sessionRebuilt` (`no-session` / `conversation` /
`system-prompt` / `tools`), so a lost warm session says which key moved.

New `smoke-jarvis-session-pin.mjs` (10 checks, offline: the mechanism, the code chain,
the pin). jarvis-brain 77 (live leg ran, turn 2 reused the session), jarvis-glasses 43,
jarvis-ui 63, jarvis-conversations 24, jarvis-mcp 51, jarvis-screen-control 43 pass;
tsc clean.

Rollback: revert the commit.

## 2026-09-29 - Faces: a fuller Jarvis plexus, a many-armed Oracle (v2.39.1)

Owner, 2026-09-28: News Radar's face is loved; "The Oracle's needs to have more swirls,
and both the Oracle and Jarvis just need to be much more robust." Only
`src/components/faces/AgentFace.tsx` changed; News Radar is untouched.

- **Jarvis (constellation):** three shells (a dense heart, the plexus body, a sparse
  outer shell; 1,420 nodes, was 560), short bright links plus one long faint link on
  every third node, two tilted orbit rings turning against the cloud, a dust halo, an
  outer aura, and up to 160 signal pulses whose active count follows the state (a
  quarter while idle, all of them while working). Palette unchanged (violet idle to
  electric blue replying).
- **Oracle (galaxy):** five arms wound log-spiral style (was three, loosely wound), two
  tightly wound inner filaments, dim dust lanes riding inside each arm, a puffy bulge, a
  faint halo, a slow precession so the disc reads as 3-D, and an outer glow. 24,100
  points, drawn in one call.
- Both groups are scaled to fit the camera (it shows a radius of about 1.17; the new
  rings and disc reach 1.2 to 1.32).

Verified visually: an esbuild harness rendered all three faces in the browser pane in
idle, working and speaking; the first pass showed the Oracle's dust lanes as white
blobs and both faces cropped, fixed before commit. smoke-jarvis-v3-ui 43 pass; tsc clean.

Rollback: revert the commit.

## 2026-09-28 - Skills & Workflows pop-up: every skill library, and an opaque panel (v2.39.0)

Owner, 2026-09-28, with screenshots: the pop-up on Mission Control was see-through
(page text read through it; the same pop-up on Agents looked fine), and it only offered
5 skills: "I would like to have all the skills in Claude, and ~/.skilldb/skills available
for me to choose from".

**Sources.** `lib/platformSkills.ts` now reads three sources in precedence order:
Agent OS (`~/.agentic-os/skills`, the only writable one), Claude Code
(`~/.claude/skills`) and SkillDB (`~/.skilldb/skills`), in place, never copied. On a
name clash the earlier source wins. Measured on this machine: 676 skills (5 / 249 / 422),
every one with a description, a re-list in 21 ms (descriptions cached by mtime).
- Names: letters, digits, spaces, `_` and `-` (folders such as `Content Creation` and
  `Yoshi_UE_Skills` now count), never dots or separators, so a name cannot walk out of
  its folder.
- Descriptions: YAML folded/literal blocks (`description: >`, used by 104 of them) and
  quoted values are read properly.
- A smoke that redirects `AGENTIC_OS_SKILLS_DIR` gets no extra sources unless it names
  them (`AGENTIC_OS_CLAUDE_SKILLS_DIR`, `AGENTIC_OS_SKILLDB_DIR`), so no test reads the
  real libraries. `createSkill` still writes only the Agent OS folder and refuses a name
  another source holds.
- Switched-on skills from any source reach agents through the same `withSkills` path.

**Pop-up.** Each skill shows its source; filter buttons All / On / Agent OS / Claude
Code / SkillDB with counts. The panel is near-opaque (0.97) over a darker, stronger
blurred backdrop, so page content no longer reads through it.

New `smoke-skill-sources.mjs`, 22 checks. tsc clean; module-kit 73, control-room 42,
skills 42, launch-drawer 70 pass.

Open: `smoke-jarvis-brain` "sdk turn 2 reused the warm session" failed again (2 of the
last 3 runs; the first failure was before this change). The second turn of a
conversation sometimes boots a fresh SDK session. Cause not found yet. Note the live SDK
leg runs even with AGENTIC_SMOKE_OFFLINE=1 and costs about $0.40-0.55 per run.

Rollback: revert the commit.

## 2026-09-28 - /api/settings stops returning key material (v2.38.4)

GET /api/settings (and the PATCH reply) returned `readSettings()` whole, so the MCP
endpoint's secret and any saved Leads/Music/Pipeline keys reached the browser, against
AGENTS.md "Credentials leave through exactly one door".

- Both replies now go through `redactSettings`. The owner asked (2026-09-28) to see the
  first 5 letters, so the mask is the first 5 characters + "********" for secrets of 16+
  characters and "********" alone for shorter ones (`maskSecret`, `isMaskedSecret` in
  `lib/settingsRedact.ts`; the Control Room door uses the same mask).
- PATCH runs `stripPlaceholders`, which now drops any masked value on a secret path, so
  a form that saves back what it loaded keeps the stored key; a typed key replaces it and
  "" clears it, as before.
- New cookie-only door `POST /api/v2/memory/mcp-secret/reveal` for the Memory gear's
  "Copy secret": proxy.ts only lets the MCP header through `/api/mcp`, and the route also
  refuses any request carrying the MCP header or a bearer (403). Each reveal and refusal
  is logged without the value. The gear now shows the masked prefix next to
  "configured".
- Leads (4) and Music (2) key fields show a mask as plain text (so the prefix is
  visible) and switch to a password field once a new key is typed.
- Checked every client read of a secret from /api/settings first: only the Memory gear's
  copy button used one.

New `smoke-settings-secrets.mjs` (24 checks: no key material in GET or PATCH bodies,
masked round trip keeps keys, new key replaces, "" clears, reveal refuses the MCP header
and a bearer, logs carry no value, wiring). `smoke-control-room` updated for the new mask
(42 pass). tsc clean; memory-ui 69, agentmail 30, hermes3d-ui 36, home-ui 77,
jarvis-screen-control 43, voicebox 48, widgets 59 pass.

Rollback: revert the commit.

## 2026-09-28 - Gate fix: smoke-browser no longer depends on example.com (v2.38.3)

`smoke-browser` D2 "snapshot contains 'Example Domain'" failed whenever example.com was
reachable, while D1 and D3 (both on the page title) passed. Evidence: D2 now prints the
snapshot on failure, and the live snapshot is a list of multilingual paragraphs ("This
domain is for use in documentation examples ... avoid relying on it for testing"); a
fetch of the page shows `<title>Example Domain</title>` and no `<h1>` at all. The site
changed; the snapshot was right and the assertion was stale.

Fix, smoke only: with `AGENTIC_SMOKE_OFFLINE=1` (test.sh exports it) example.com is not
probed and the local fixture is the only target, so the gate never depends on a
third-party site. A manual live run keeps the example.com leg, where D2 asserts the
snapshot has real content; the "Example Domain" text check stays on the fixture we
control. Both modes pass all checks (offline and live runs, 2026-09-28).

Rollback: revert the commit.

## 2026-09-28 - Gate fix: smoke-search facet window went stale again (v2.38.2)

`smoke-search` temporal_facets failed "entities include Sarah", "graph aspects counted
(Decision)" and "voice aspects counted separately (Preference)" with empty lists. Cause:
the query window started "30 days ago" (rolling), while the seeded triples and voice
facts carry fixed August 2026 `valid_at` dates (Sarah 08-26, Decisions 08-10..08-21,
Preference 08-19), and the facet handler filters `s.valid_at >= startTime`
(`src/lib/v2/memory/search/handlers.ts:747`). From 2026-09-18 on, those facts slid out of
the window. Not the uncommitted `dbSchema.ts` hunks and not a memory commit: the fix is
in the smoke only. The window now starts at a pinned 2026-08-01 and ends tomorrow, so
both the fixed-date facts and the labels created at run time stay in. smoke-search ALL
PASS offline (the Ollama leg skips as before).

Rollback: revert the commit.

## 2026-09-28 - Gate fix: V1 MemoryPanel exiled again (v2.38.1)

`smoke-memory-ui` failed "old MemoryPanel removed from src/components (moved, not
copied)": `src/components/MemoryPanel.tsx` (the V1 vault-grep panel) was back in the
tree. Nothing imports it; `src/app/memory/page.tsx:4` already records its exile on
2026-08-27. The owner confirmed V1 memory pieces can go. Moved to
`.exile/<2026-09-28 stamp>/src/components/MemoryPanel.tsx`; the 2026-08-27 exile copy
differs from it (from line 1), so both are kept. smoke-memory-ui 69 checks pass.

Rollback: move the file back from `.exile/`.

## 2026-09-28 - MCP tab: Jarvis's own MCP servers, install wizard, taint-gated (v2.38.0)

S16 of `_design/jarvis-v3-plan.md`. The owner asked for an MCP tab showing what is
installed, what is available, and an install wizard / click-through.

**Store.** `lib/v2/jarvis/mcpServers.ts` keeps Jarvis's external servers in
`~/.agentic-os/jarvis/mcp-servers.json` (mode 600 where honoured;
`AGENTIC_OS_JARVIS_DIR` for smokes). HTTP (URL + headers) or stdio (program + args +
env; a shell line is refused). Servers are added switched OFF. Retiring moves a record
to `retired`; restore brings it back switched off. A corrupt file throws a 500 rather
than reading as empty.

**Credentials, one door.** The public view carries header and env NAMES only. The only
reader of values is `sdkServers()`, which the brain calls when it boots a session, and
only for enabled servers. `externalSignature()` hashes the enabled set (no values) and
is folded into `toolsSignature()`, so switching a server on or off starts a fresh
session on the next turn.

**Brain.** `bootSession` mounts the enabled servers next to `agentos` and allows only
their tools. External tools do not pass through Jarvis's capability gates or the
Human-Gate, so the taint rule is enforced by SDK hooks: PreToolUse denies any external
tool on a turn that carries integration content, and PostToolUse taints the turn after
any external tool returns (its output is outside content too). The tab says this in
plain words and asks before a server is turned on.

**Route** `/api/v2/jarvis/mcp`: GET overview (Jarvis servers + retired, the built-in
`agentos` tool list, Claude Code's user-scope servers from `~/.claude.json` with
header/env names only and the URL query stripped via new `lib/claudeMcpServers.ts`,
Hermes's installed servers); `?catalog=1` the Hermes catalogue; `?manifest=<name>`
prefill for the wizard; POST add/enable/disable/retire/restore.

**Tab** `components/jarvis/McpTab.tsx`, registered in `JarvisHub` (Plug icon). Sections:
Installed, Claude Code & Hermes (read-only), Available. Wizard: source and transport,
connection with write-only password fields for secrets, review; "Add to Jarvis" from
the catalogue prefills name, transport, description and the manifest's env var names,
and shows its upstream and bootstrap lines.

**Smokes.** New `smoke-jarvis-mcp.mjs`, 51 checks: validation, no secret in any public
view or route body (Jarvis and Claude Code, including a URL query token), enable/retire/
restore and the signature, the hook wiring in brain.ts, the route's export list, the
built-in tool list matched against `tools.ts` handlers, tab registration. Home, the
Jarvis dir and `~/.claude.json` are redirected to a temp dir. `smoke-jarvis-brain` and
`smoke-jarvis-glasses` now also redirect `AGENTIC_OS_JARVIS_DIR`, since the brain reads
it. tsc clean; jarvis-v3-ui 43, jarvis-sessions 33, module-kit 73, control-room 42,
jarvis-screen-control 43, jarvis-ui 63, jarvis-conversations 24, jarvis-glasses 43,
agentmail 30, jarvis-brain 77 all pass. One jarvis-brain run failed "turn 2 reused the
warm session" (turn 2 booted fresh) and passed 77/77 on the immediate rerun; noted as a
flake in the live SDK leg, cause not found.

Rollback: revert the commit; `~/.agentic-os/jarvis/mcp-servers.json` is only read by
this code and can be moved aside.

## 2026-09-28 - Control Room: status, every module's skills and workflows, plugins, insights, settings (v2.37.0)

S15 of `_design/jarvis-v3-plan.md`. The owner asked for a Jarvis tab "where I can
monitor and manage Statuses, Workflows, Skills, Plugins, Insights, and ALL other
settings for ALL the agents and modules."

**Five sections, each from a live source.**
- Status: `lib/hostHealth.ts` measures the host at request time (CPU from two
  `os.cpus()` samples 400 ms apart, per-core bars, memory, disk via `fs.statfs` for the
  home and app drives) and probes the local services (Kokoro, Parakeet, Ollama; LM
  Studio and Voicebox marked optional), then turns it into plain-words checks and one
  status word. Two honesty rules are in code: Windows has no load average and
  `os.loadavg()` returns zeros there, so it is reported as "not available on Windows",
  not as an idle machine; and only loopback URLs are probed (a remote LM Studio URL in
  settings is reported, never called). This is the shared endpoint S18's System pulse
  and S27's Health page will build on.
- Skills & workflows: one matrix, modules down, skills or workflows across, every cell
  a switch through the same `/api/modules/kit` door as the pop-up, plus an Everywhere
  row. Modules whose code does not read skills are labelled "not wired".
- Plugins: Claude Code's `enabledPlugins`, with the truth that they are global to
  Claude Code (not per module) and take effect next session. Each toggle copies the
  file into `~/.claude/.exile/<timestamp>/` first, changes one key, writes atomically
  and reads back; invalid JSON is refused and left untouched.
- Insights: counts from the module-run registry, with its window stated on the page
  (it keeps running runs plus the last 50 finished, so these are recent activity, not
  all-time totals), agent status, Jarvis session counts, skill and workflow coverage.
- Settings: every top-level settings block as an expandable JSON editor through a new
  door, `/api/control/settings`, that masks key material (the leaf-name rule catches
  apifyToken, sunoCookie, mcp.secret and camelCase ...Key, case-insensitively; a
  hotkey's key name is not a secret) and strips the placeholder from writes, so a
  round-trip save can never write "********" over a key. Writes read back, because
  `writeSettings` swallows disk errors.

**Found: GET /api/settings returns key material to the browser**, including the MCP
secret bootstrapped for S19 earlier today. Not changed here, because the Memory gear
reads `mcp.secret` from that route on purpose to show it for pasting into an MCP
client, so the fix is a small redesign (mask the general route, give the Memory gear a
reveal-on-click door); queued for the owner as its own task with that proposal.

**Got wrong on the way:** the first secret-name pattern was case-sensitive and would
have shown `apifyToken` and `sunoCookie` in clear; caught on review before the smoke,
which now pins both.

**Evidence.** `smoke-control-room`, 42 checks, fetch stubbed so no live service is
touched and Claude Code's settings redirected to a temp file: CPU sampling and host
shape, Windows load average null, loopback-only probing (the remote URL was never
called), optional services never fail the board, check counts and status word;
masking on read and on the save reply, placeholder writes leave secrets alone, new
values replace them, shape/key guards; plugin toggle with backup, rest of file kept,
404/400/500 paths; insights counting one done and one failed run from a temp registry
with a measured average. Sibling Jarvis smokes still pass; `tsc` clean. Not yet seen
in a browser.

## 2026-09-28 - Memory off Honcho: Claude Code now remembers through Agent OS (config only)

S19 of `_design/jarvis-v3-plan.md`. The owner: "my Honcho server is down, and won't be
able to be used in the future", then "we also need to change claude code over to using
the Agent OS memory". No repo code changed; this entry records configuration outside
the repo, with rollback lines.

**Nothing had to be built.** Agent OS already serves its Memory V2 (SQLite + local
Ollama embeddings) over `/api/mcp` as `memory_search`, `memory_ingest` and
`memory_about_user`, behind an `x-agentos-mcp-secret` header that the password gate
lets through. The secret did not exist yet; the endpoint creates it on first request,
so one unauthenticated call (401, as designed) bootstrapped it into
`~/.agentic-os/settings.json`.

**Verified before wiring:** against the live app, `initialize` 200 (`agentos`),
`tools/list` 10 tools including the three memory tools, and a real `memory_search`
returned about 37,000 characters of recalled context. The probe read the secret from
settings and never printed it.

**Changes, each with rollback:**
- Claude Code: user-scope MCP server `agent-os` -> `http://127.0.0.1:3737/api/mcp` with
  the secret header, written straight into `~/.claude.json` by a script (Claude's own
  output shows it `[REDACTED]`). `claude mcp list` shows it connected.
  Rollback: `claude mcp remove agent-os --scope user`.
- Claude Code: `enabledPlugins` `honcho@honcho` and `honcho-dev@honcho` set to false in
  `~/.claude/settings.json` (still valid JSON, 24 plugins listed).
  Rollback: `~/.claude/.exile/2026-09-28_203148/settings.json`.
- `~/.claude/CLAUDE.md` "Memory & Journals": durable facts now go to the `agent-os`
  tools; Honcho marked retired, its endpoints not to be called, any injected
  "[Honcho Memory ...]" text treated as stale.
  Rollback: `~/.claude/.exile/2026-09-28_203313/CLAUDE.md`.

**Not moved, deliberately.** Local Hermes: `hermes mcp add` takes `--url` but has no
header option, so it cannot send the secret and would only get 401s. The homelab
Hermes's own Honcho memory provider lives on the .99 box. Both are the owner's call.
Honcho's contents could not be exported: the server is down.

**Cost.** Memory now depends on the Agent OS app being up on 3737; when it is not, the
tools error and the instructions say to say so rather than guess. The Honcho injection
that has been adding unrelated recalls to every prompt stops at the next session start.

## 2026-09-28 - Skills and workflows on every module, by pop-up or by Jarvis (v2.36.0)

S14 of `_design/jarvis-v3-plan.md`. The owner: "Another very important thing is that I
need to be able to activate/deactivate Skills and Workflows on every module
individually. Either by a pop-up on each module tab, or via Jarvis."

**What was actually true before.** Skills were SKILL.md files with per-module
activation in `settings.skills`, but they reached an agent only where code passed a
module key to `withSkills`: deals, hire, marketing, content-engine and agent-kanban.
The comment in `platformSkills.ts` described a "global wrap" inside `cliComplete` that
never existed, and `browser` only mentioned `withSkills` in a doc comment. The launch
drawer had been fetching `/api/skills` since S3 and getting a 404, so its skills picker
was always empty. There was no workflow concept at all.

**Skills now reach 14 modules.** `cliComplete` takes an optional `module` and prepends
that module's skills (global + module); omitted means no skills, so the JSON-extraction
callers (memory, newsletter parse) stay clean, and incognito calls (the Mastermind's
clean-room seat) never get them. Wired: news-radar, brainstorm, idea-engine, pipeline,
leads, games, room, the Oracle (arg-capped, since some CLIs take the prompt as an
argument), and Jarvis itself, which gets only its own module skills with bodies in the
stable prompt (the global ones it already names; pulling every global body into a warm
session would bloat it). `src/lib/moduleRegistry.ts` is the one list of modules and
says which read skills; the smoke scans the code (comments stripped) and fails if that
claim and the code ever disagree in either direction.

**Workflows are new.** A workflow is data: name, prompt template with `{{input}}`,
optional input label, agent. `~/.agentic-os/workflows/workflows.json`, atomic writes,
three honest starters (summarize, draft a reply, research brief) that use only what
they are handed, so none pretends to read an inbox it cannot see. Activation global or
per module. Nothing is ever deleted: retire moves a workflow to `retired`, restore
brings it back. A corrupt file is an error, not an empty store that the next save would
write over the owner's workflows with. Runs go through `runWorkflow` (shared by the
route and Jarvis), as a module run: it shows in the runs tray, STOP reaches the CLI
child, and the calling module's skills apply.

**The pop-up** is a "Skills & workflows" button in the TopBar, so every page has it
without 48 edits (Sidebar.tsx carries someone else's uncommitted work and was not
touched). It resolves the module from the URL when opened (Jarvis tabs are their own
modules: Oracle, News Radar, Outreach), shows every workflow and skill with on-here and
on-everywhere switches (`role="switch"`), runs a workflow in place, and creates new
skills and workflows. A module whose agent calls do not read skills says so rather than
showing a switch that silently does nothing. Setting a skill reads settings back after
writing, because `writeSettings` swallows disk errors; a write that did not land is a
500, not a false "on".

**Jarvis** gets `module_kit` (list / set / run); set and run sit behind the same taint
gate as every other write, list does not.

**Got wrong on the way.**
- A Python heredoc through Git Bash turned `\n` escapes into real newlines (a syntax
  error inside `.join("...")`) and mangled the search pattern of the next edit. Caught
  by reading the bytes back; all later edits went through script files written with the
  file tool. Rule 28 covers Python heredocs too, not just sed/node.
- The honesty scan first counted `browser` as wired because it matched the doc comment
  in `skillSeed.ts`; the scan now strips comments, and browser stays unwired.
- Retire left an empty module entry that switching off would have deleted; aligned.

**The full gate found a bug of mine from v2.30.0.** `smoke-jarvis-screen-control`
failed "failed status write never paints approval". The Deal Desk store's `post()`
ignored the server's reply entirely, and `move` / `saveNotes` / `savePitch` /
`toggleNeedsInfo` painted the new value before the request left, so a rejected save
looked saved; Jarvis reads "saved" from that store, so by voice it would have said
"saved" for a write that never happened. The v2.30.0 journal said the Deal Desk side
of this was fixed. The previous agent had fixed it in the working copy of
`upworkDeskStore.ts`; I left that file out of the v2.30.0 commit because it was on the
session-start dirty list and I took it for the owner's in-progress work, even though
the screen-control baseline folder held a `.bak` of it (the tell). The working copy has
since been reverted, and `task_notes/` (the rollback copies the v2.30.0 entry points to)
no longer exists; git history is the rollback now. Fixed here: `post()` returns
`{ ok, error }` and the four writes change the store only after the server keeps them
(needsInfo is put back and the research pass does not start on a rejected save).
Screen-control and all six Deal Desk smokes pass.

**Evidence.** `smoke-module-kit`, 73 checks, temp dirs for settings, skills, workflows
and DB (a smoke never writes the owner's skills: `AGENTIC_OS_SKILLS_DIR` is new for
that). The run route's success path needs a real CLI and is the owner's to see; its
guards (unknown workflow 404, unknown module 400, missing required input 400) are
tested. Full offline gate, `./test.sh` then every smoke after its first stop: 84 of 87
green after the store fix. The three red are not from this slice, each checked:
`smoke-browser` D2 fails identically on the previous commit in a clean worktree (its
live example.com leg); `smoke-memory-ui` asserts `MemoryPanel.tsx` was removed, and that
file, deleted in the owner's working set at session start, has since been restored;
`smoke-search` imports only memory modules, none touched here. Not yet seen in a
browser.

**Not done here:** `settings.skills` is still written through `writeSettings`, whose
silent disk-error swallow affects every module; worth its own fix.

## 2026-09-28 - Jarvis Sessions tab: find any conversation and pick it back up (v2.35.0)

S13 of `_design/jarvis-v3-plan.md`. The overlay already had a small history drawer;
the owner wanted a real place to see past sessions and resume them.

**What it is.** A Sessions tab in the Jarvis hub: measured header counts (live,
archived, messages kept), a search box that matches titles AND everything said, a
Live / Archived / All filter, a list with message count, channel, last activity and a
snippet around the hit, and a reader pane with the full transcript (tool calls shown
as "ran X" / "failed X"). Actions: Resume in Console, Resume in overlay, Rename,
Archive, Restore.

**Resume goes through the path that already existed.** Both resume actions just bind
the conversation id; the next ask carries it and the SDK brain treats a different
conversation as stale, rebuilds the session and replays the last 20 turns
(`historyBlock`). Console: `/jarvis?c=<id>`, which JarvisView reads on mount; the hub
now treats a URL without `?tab=` as Console, otherwise the link from the Sessions tab
would have changed the URL and left you on Sessions. Overlay: a
`jarvis:open-conversation` window event that JarvisOmnipresence turns into "open the
overlay on this id", so it works from any page.

**Restore.** Archive was always a soft flag (`archived_at`); there was no way back.
`restoreConversation` + `PATCH {archived:false}`. Archived sessions cannot be resumed
until restored, so a hidden thread never silently comes back to life.

**Got wrong on the way (rule 28 again).** The store's search SQL was appended with a
bash heredoc, and Git Bash turned every `ESCAPE '\'` into `ESCAPE '\'`, which in a JS
string is an escaped quote: the SQL would have read `ESCAPE ''` and thrown on the
first search. The wildcard-escaping regex lost its backslash the same way, so a typed
`%` would have matched everything. Caught by reading the bytes back, fixed with the
backslash built from `chr(92)`, verified with Python `repr`, and pinned by smoke checks
(a literal `%` matches only the title containing it; `_` matches nothing; a query with
a backslash does not break the SQL). The Sessions UI and its smoke were then written
with the file tool, not a heredoc.

**Evidence.** `smoke-jarvis-sessions`, 33 checks against a temp DB: title and body
search, snippets, literal wildcards, scopes, measured counts, restore (idempotent,
unknown id), the list route's new `?q=&scope=` contract with the ORIGINAL C3.6 reply
shape unchanged when neither is given, 400 on a bad scope, PATCH restore/rename, and
the resume wiring end to end in source. smoke-jarvis-conversations, smoke-jarvis-ui
and smoke-jarvis-v3-ui still pass; `tsc` clean. Not yet seen in a browser.

## 2026-09-28 - Type redesign: stop looking like NEXORA (v2.34.0)

Owner, after walking through the NEXORA screenshots: "seeing how eerily similar his OS
is to ours, we need to redesign all of our typography". The shared signature was the
wide-tracked uppercase mono micro-label over a large light display line. NEXORA's own
display face is a high-contrast serif (the pack names Press Baskerville), so the new
system goes the other way.

**The system.** Display = Unbounded (wide geometric; run light and nearly untracked,
because it is already wide). UI and body = Geist. Data and code = Geist Mono with
tabular figures. All three are self-hosted by next/font, so Bricolage Grotesque,
Manrope and JetBrains Mono no longer load from fonts.googleapis.com at runtime; only
Caveat (hand-script numerals) still does. Tokens `--font-display`, `--font-sans`,
`--font-mono`; classes `.type-display`, `.type-figure`; every h1 is display. Eyebrows
move to semibold UI face at 0.07em tracking.

**How it was applied.** Tailwind's `font-mono` / `font-sans` read the tokens, so the
~480 class uses changed with two lines. 103 hardcoded family names in 13 app-rendered
files were rewritten to the tokens mechanically, after listing every distinct form they
took. Excluded on purpose: `src/lib/claudeArtifacts.ts`, which emits standalone HTML
where app CSS variables do not resolve (and which carries the owner's uncommitted
edits). Checked that `Unbounded` is exported by this Next's `next/font/google` before
relying on it, since the owner's production build is the first place it would fail.

**Evidence.** `smoke-jarvis-v3-ui` gained the type checks (self-hosted Unbounded, no old
families in the Google link, tokens, no hardcoded old family in any app-rendered file,
eyebrow not wide-tracked mono): 43 checks, green. `tsc` clean. Not yet seen in a
browser: Unbounded is much wider than Bricolage, so any hard-sized title elsewhere may
wrap; the owner's first look is the real test.

Rollback: revert this commit; the old families return with the Google link.

## 2026-09-28 - Jarvis v3, first two slices: glass, faces, and a tabbed Jarvis (v2.33.0)

The owner asked, over one evening, for a Jarvis rebuild plus a long list around it
(Mission Control, per-module skills, MCP, Control Room, Goal Mode as missions, memory
off Honcho, NEXORA adoptions). The whole request, the decisions taken without asking,
and the slice order live in `_design/jarvis-v3-plan.md`; the NEXORA prompt pack diff
is `_design/nexora-diff.md`. This entry is S11 + S12 only.

**Art direction first, because the owner named the skill.** He asked for the
awwwards skill (`build-awwwards-quality-sites`); it demands a written direction before
code and a compatible style skill, so `blue-laser-clean-glass-layout` is the second
reference. Two deliberate deviations are recorded in the plan: no smooth-scroll engine
(this is an app shell with independently scrolling panels, and Lenis would fight them
and Jarvis's screen-control bridge), and lucide icons stay (Iconify Solar would mean a
second icon language across 48 modules and a runtime call to an external API).

**S11: glass that actually exists.** `GlassCard` had been applying `glass`,
`glass-strong`, `hud-corners` and `neon-ring` since it was written, and none of those
classes was defined anywhere in `src/`: every GlassCard in the app was an unstyled div
with a fade-in. They are defined now in `globals.css` as glass neumorphism (frosted
fill, light rim top-left, dark rim bottom-right, two-sided drop shadow), plus
`.glass-frost` (the owner's pale KPI tiles, used there only), `.glass-inset`, and a
`.glass-tabs` segmented bar. Defining them upgraded the nine existing GlassCard users
without touching them.

`AgentFace` is one three.js component with three variants driven by a `state` prop:
the constellation plexus for Jarvis (violet `#8b5cf6` idle through to electric blue
`#22d3ff` replying, with signal pulses along the edges while thinking or working), a
spiral galaxy with differential rotation for the Oracle, and concentric rings under a
sweep for News Radar. Per the skill's WebGL rules: DPR capped at 2, paused when the tab
is hidden AND when the face is scrolled offscreen (IntersectionObserver), context loss
handled, a CSS radial poster underneath that is the whole face when WebGL is missing,
one static frame under reduced motion, and no per-frame allocation (the first draft
built a `new THREE.Color` every frame in the pulse loop; caught on review).

**S12: Jarvis gets tabs; three move in from Hermes.** `/jarvis` is now `JarvisHub`:
Console (the old JarvisView), Oracle, News Radar, Outreach. The tab lives in `?tab=`,
so Jarvis's own screen control can deep-link, and old `/hermes?tab=oracle|radar|outreach`
bookmarks redirect. The moved components and their APIs are unchanged; only their
mount point moved. Tabs register as their slices land, so nothing unfinished is listed.

**Faces show only real state.** Console: the same signals the phase label already used
(building -> working, busy -> thinking or working in agent mode, listening, speaking,
"Brain error" -> error). Oracle: `busy` -> thinking, TTS loading -> working, playing ->
speaking, `err` -> error. News Radar: working only while a briefing is actually in flight.

**Found and removed: invented telemetry.** Wall mode showed NEURAL THROUGHPUT, CORE
LOAD, SIGNAL and LATENCY, all random walks from `Math.random()` on a 1.5 s timer, and a
hardcoded "DANIEL · EN-GB" voice that stopped being true when the voice moved to
Kokoro. Replaced with measured values: the last reply's duration, turns this session,
and the configured TTS provider. The old `ArcReactor` canvas (104 lines) is gone.

**Evidence.** `smoke-jarvis-v3-ui`, 38 checks: the source contract (hub tabs, Hermes
redirects, honest face mapping, no random telemetry, the glass classes), and a real
headless Chromium rendering an esbuild bundle of `AgentFace`: all three variants go
live on SwiftShader WebGL, each reports the state it was given, a state change reaches
the rendered face, no page errors; and with WebGL disabled each face falls back to its
poster. `tsc` clean. Not yet seen by the owner in his browser.

**Also found, not fixed here (queued in the plan):** the NEXORA diff agent flagged
`src/app/api/activity/route.ts:23` synthesising log timestamps (file mtime minus
200 ms per line) and `src/lib/agentRoom.ts:21` falling back to a local model when no
cloud key is set, possibly unlabelled.

Rollback: exile `src/components/faces/`, `src/components/jarvis/JarvisHub.tsx`, restore
`src/app/jarvis/page.tsx`, `src/app/hermes/page.tsx`, `JarvisView.tsx`, `OracleView.tsx`,
`NewsView.tsx` from `4ddede3`, and drop the S11 block at the end of
`globals.css`.

## 2026-09-08 - "(no reply)" after one message was the brain, not the voice (v2.31.1)

Owner: "Still immediately fails with (no reply) after 1 message." That string is the
overlay's placeholder for an ask stream that ended with no sentence and no error,
so this was never Voicebox. It was also, almost certainly, the real cause of the
morning's "I can get one reply and then voicebox breaks": the voice was blamed for
a brain that had gone silent.

**Evidence.** `jarvis_messages` held 11 assistant rows reading exactly `(no reply)`.
Within one conversation the pattern was: turn one answered; every later turn was
`(no reply)` with a ONE MILLISECOND gap between the user row and the assistant row
(21:25:10.734 -> 21:25:10.735). The "sometimes it works again" the owner saw was him
opening a new conversation: a fresh SDK session answers its first turn, then dies
the same way (three conversations in the log, same shape each).

**Cause.** `askSdk` read the warm session with `for await (const msg of b.q) { ...
if (msg.type === "result") break; }`. `break` inside `for await` calls the
iterator's `return()`. The Agent SDK's `Query` returns itself as its iterator and
implements `return(e)` as `await this.cleanup(); return this.sdkMessages.return(e)`
(sdk.mjs, read this session). So the end of every first turn tore the session
down; turn two pushed its message into a dead query and `next()` came back `done`
instantly, which the loop treated as an empty answer.

**Why nothing caught it.** The brain smoke's live leg asked its second question in a
NEW conversation, and its offline sections never touch the SDK iterator. The
persistent-session design (S-C3) was verified turn-by-turn with fresh conversations.

**Fix.** Explicit `await b.q.next()` in a `while (true)`; `break` out of a while does
not call `return()`. A `done` step is now a thrown error ("Jarvis session ended /
was already closed; ask again (session rebuilt)") with the session cleared, and an
`is_error` result with no text throws `SDK <subtype>: <errors>` instead of being
persisted as `(no reply)`. Live, outside the smoke: turn one 10.6 s cold, turn two
1.9 s warm, `turns: 2`, "pong" then "ping".

**Smoke.** `smoke-jarvis-brain` live leg gained a same-conversation second turn
(must answer, no error) and a `turns === 2` check that the warm session was reused.
The turns check failed once on its first live run and passed on the rerun; I could
not explain the first result from evidence, so the check now prints the `done`
event and durations when it fails. If it flakes again, that is the thread to pull
(a suspected cause: `toolsSignature()` changing between the two turns and forcing a
rebuild, which would still answer, just cold).

**Cost.** None to the owner's flow. The error path is new text where there was
silence; a rebuilt session costs one cold start.

## 2026-09-08 - off Voicebox: Parakeet hears, Kokoro speaks (v2.31.0)

Owner: "I don't care about voicebox. I want to switch off of it ... Download Nvidia
Parakeet TDT and hook it up to Kokoro or Piper, or VoxCPM if we need to do voice
cloning. And call it a day." This retires the S1 decision of 2026-09-02 (Voicebox
as the voice engine). Voicebox code stays in the tree and stays selectable; nothing
defaults to it any more.

**Speaking** needed no new code: the Kokoro server the launchers already start on
8880 (`kokoro-start.ps1`, PyTorch venv under `~/.agentic-os/kokoro-tts`) is the
"local" reply voice, and the owner had already switched to it in the gear. For the
record: Kokoro is not bundled ONNX inside the app, it is a sibling local server like
everything else here; the weights (hexgrad/Kokoro-82M) sit in the shared Hugging
Face cache, the same file Voicebox had downloaded.

**Hearing** is new. `~/.agentic-os/parakeet-stt/server.py` (FastAPI, port 8881)
runs NVIDIA Parakeet-TDT 0.6B v2 through ONNX Runtime via the `onnx-asr` package,
int8 on CPU. CPU on purpose: the GPU had 12.7 of 16 GB taken by the local LLMs when
this was built, and a 0.6B TDT model on CPU is already faster than speech. Measured
on this box, cold model load 16.4 s; then, over five consecutive different sentences
through the live HTTP server (Kokoro speech encoded to webm/opus exactly as the
browser's MediaRecorder sends it, decoded by ffmpeg to 16 kHz mono): 0.18 to 0.32 s
of recognition per utterance, round trips 225 to 470 ms, all five word-correct
("JobNimbus" came back as "Job Nimbus"), model still loaded afterwards. That
consecutive run was the owner's question, because Voicebox died on message two.
NeMo was rejected outright: it is the reference runtime but a Windows swamp, and
the ONNX export is the same weights.

**Wiring.** `lib/parakeet.ts` (loopback asserted like Voicebox), `/api/stt/transcribe`
and `/api/stt/health`, a `parakeet` capture provider listed first in
`useVoiceCapture`, the Voicebox-only recorder branch generalised to `usesRecorder()`
so both local recognisers share one MediaRecorder lane, `transcribeClient` picks the
endpoint from the provider and refuses providers with no local transcriber, gear
shows Parakeet health + URL when selected (rule 16), defaults `provider: "parakeet"`
+ `ttsProvider: "local"`, `parakeet-start.ps1` called from Start and Restart (kill
list too). The owner's saved settings were flipped the same way, with the previous
file exiled to `~/.agentic-os/.exile/2026-09-08_135836/settings.json`.

**Got wrong on the way.** A replace-all of the Voicebox lane check rewrote the body
of the new `usesRecorder()` into a call to itself; caught by rereading the grep
before running anything. The smoke's own section A wrote an empty URL into the temp
settings and then the "defaults" check read that back; defaults are now captured
before any write. `settings.ts` carries the killed S7 cycle's `wizardProvider`
hunks, so it was staged hunk-by-hunk from a filtered patch, never whole.

**Not done, by the brief.** VoxCPM (cloning) only "if we need to"; the cloned
profiles (Alfred, Stokes, The Sage, Yoshi) are one reference sample each and
exportable from Voicebox when that day comes. The Oracle's own voice setting still
defaults to Voicebox with its ElevenLabs backup; untouched, one line if wanted.
GPU inference for Parakeet is an env var (`PARAKEET_PROVIDER=cuda`) plus
`onnxruntime-gpu`, not worth it at 0.2 s on CPU.

Evidence: smoke-parakeet-stt, 28 checks (fake server; client, both routes, hook
wiring, defaults, launchers); smoke-voicebox, smoke-jarvis-ui,
smoke-jarvis-conversations, smoke-jarvis-brain still pass; `tsc` clean. Live: the
five-utterance run above, plus `/api/stt/health` from the gear once rebuilt.

## 2026-09-08 - first live run: the curtain and the silent backup (v2.30.1)

Owner, after rebuilding v2.30.0: "I can get one reply and then voicebox breaks. No
fallback for some reason. Also the Jarvis modal takes over the screen, so if I asked
him to pull something up or navigate somewhere, I wouldn't be able to use it."

**The curtain** was a design fact, not a bug hunt: `ChatboxOverlay` was `fixed inset-0`
with a dimmed, click-to-dismiss backdrop and `aria-modal`. Every page Jarvis navigated
to rendered behind it. It is now a docked panel, bottom-right above the orb, no
backdrop, the page stays visible and clickable, Esc still discards, the orb still
toggles. The C2b capture contract (textarea focused on open, mic not hot,
push-to-talk) is untouched; only the frame changed.

**Voicebox** was reproduced with a direct probe (`POST /generate` with the owner's
profile): `loading_model` for ~8 s, then `failed` with torch's "Cannot copy out of
meta tensor; no data!". `/health` reports `model_loaded: false`. So the first reply
spoke while the model was resident; once Voicebox dropped it, every reload fails
inside Voicebox itself. Nothing in this repo can fix that; the owner restarts Voicebox.

**"No fallback"** is the part that mattered. The server log had four lines of
`[tts] Voicebox failed (...); falling back to ElevenLabs as configured for jarvis`,
so the fallback was attempted, and probes showed the ElevenLabs leg healthy (key
valid, creator tier, 3,853 of 374,235 characters used, the configured Alfred voice
id resolves). Two things were wrong on our side regardless of what the browser did:
- The overlay never showed the route's `fellBackFrom` / `fallbackReason` labels
  (rule 20: a fallback the owner chose must say so where he is looking). The Oracle
  footer does this; the overlay did not. Now an amber line: "voicebox failed (reason);
  elevenlabs is speaking instead."
- Every 500-char chunk of a reply re-asked Voicebox and paid the 8 s stall before
  falling back, so a three-chunk reply was ~25 s of silence punctuated by speech.
  `useReadAloud` now keeps the rest of the current reply on the provider the route
  already chose. The client makes no provider decision of its own; it repeats the
  server's labelled one, and the next reply asks Voicebox again.
- The route logged the fallback attempt but not its outcome, which is why this
  entry cannot say whether ElevenLabs audio reached the browser. It now logs
  `ElevenLabs backup spoke` or `ALSO failed: <status>`, so the next report carries
  the missing line.

Evidence: smoke-jarvis-screen-control 40 → 43 (labelled fallback continues the reply
on the chosen voice; the label reaches the client; the overlay source has no modal
curtain). smoke-jarvis-ui and smoke-jarvis-conversations still pass. Not seen live.

## 2026-09-08 - Jarvis can see and work the active tab (v2.30.0)

The owner wants Jarvis as an accessibility stand-in: navigate pages, read sections,
write in fields, press buttons, by voice, with Deal Desk and Hire Engine first.
Before this, the V2 brain could emit a `navigate` event and received a one-line page
descriptor; it could not see a control, let alone press one, and the global overlay
captured speech but never spoke back. Spec: `_design/jarvis-screen-control.md`.

Two sessions. The first built everything below and was rate-limited before it could
verify; its journal stub ended "Verification results follow here". This session
re-read every hunk against the `.bak` copies in `task_notes/jarvis-screen-control-baseline`
(both component baselines equal HEAD, so none of the owner's uncommitted work is
mixed in), then ran the evidence: `smoke-jarvis-screen-control` 40 checks,
`tsc --noEmit` clean, `./test.sh` 78 passed, 1 failed. The failure is
`smoke-webmcp-ui`, two checks: one was ours (the home module's ask body had
`uiControl` before `text` and the smoke greps for the original key order; reordered),
the other is the killed S7 cycle's uncommitted `wizardProvider` hunk in
`settings.ts`, which is not staged here and turns that smoke red until S7 lands or
the regex is relaxed. Logged so the next gate run is not mistaken for a new break.
Also seen: `smoke-engine` re-reads `OLLAMA_API_KEY` from `.env.local` after the gate
unset it and ran a live Ollama Cloud leg for minutes inside the "offline" gate;
flagged as its own fix, not touched here.

**The shape.** One tool, `ui_control`, with five actions: inspect, click, fill,
select, navigate. The model never sends a selector, a URL outside the app, or
JavaScript; it sends a control ID it was handed by the last inspection. The bridge
is a per-turn SSE event (`ui_request`) carrying a random one-use token; the browser
executes, then POSTs the result to `/api/v2/jarvis/ui-result`, which resolves the
waiting promise only if the token matches, and only once (`uiRequests.ts`). The
model gets browser evidence back, not a dispatch receipt. The result endpoint sits
behind the proxy gate like everything else; the token is defence in depth against a
second tab or a replay, not the authentication.

**Decisions, and what they replaced.**
- Control references are `snapshot:index` and are bound to the element *and* a
  signature (name, href, type, value, checked, record id). Any of: navigation,
  the element leaving the DOM, a concurrent user edit changing its value, or a
  drawer closing invalidates the reference with "Stale or unknown control. Inspect
  the page again." A bare index or a CSS path would have let the model act on
  whatever happened to be there now.
- The inspection root is the topmost visible `role="dialog"` when one is open,
  otherwise the body. Deal and Hire drawers now carry that role, the listing title
  as their name, and `data-jarvis-record` with the deal/lead id; cards got
  `role="button"` plus `aria-label="Open <title>"` (and became keyboard-openable in
  passing). So "open the JobNimbus listing" is a click on a named control, and
  "read the notes" reads the notes of the drawer that is open, not the board behind it.
- React controlled inputs ignore `el.value = x`; the client writes through the
  prototype's native value setter and dispatches `input` + `change`, then blurs
  after a settle, because the Deal/Hire save handlers are `onBlur`. The existing
  handlers stay the authority; the bridge only presses the keys.
- Every textarea that persists on blur carries `data-jarvis-saved-value`, so an
  inspection reports `saved: true/false` by comparing the live value to what the
  store last acknowledged. The prompt tells the model a field is saved only when
  that flag says so, or after reopening the card. Cost: the attribute is one more
  thing to hand-maintain when a new saveable field is added.
- Navigation switched from `window.location.href` to `router.push` in all three
  callers (overlay, Jarvis page, home module). A full reload would have killed the
  SSE stream mid-turn and left the pending UI request to time out at 30 s.
- Hidden, `aria-hidden`, `data-jarvis-private`, password/secret/token fields and the
  overlay's own chrome (`data-jarvis-chrome`) are excluded from text and controls.
  Inspection refuses on `/login`, `/api/*`, `/logout`.
- Mutating actions run through the same `gateTaint` as every other write, so a
  turn poisoned by external content can still *look* but cannot click or fill.
- The overlay speaks through `useReadAloud`: chunks of at most 500 chars to the
  existing `/api/hermes/tts` with the gear's `jarvis.voice.ttsProvider`, played in
  order, with a Stop, a Voice on/off toggle, and "Stop actions" aborting the ask
  stream (which aborts any pending UI request server-side). A provider failure is
  surfaced in red, never swapped for another voice (rule 20 still governs the
  route's own labelled Voicebox -> ElevenLabs backup).

**Found on the way.** `HireEngine` swallowed every save failure: `fetch(...).catch(() => {})`
on status, pitch and notes, with an optimistic status update painted before the
request left. A voice user would have been told "approved" by a UI that had not
saved. Status now waits for `{ ok: true }`, surfaces `Save failed: ...`, and the
Deal Desk drawer shows the store's error the same way. Cost: the Hire status change
is no longer instant on screen.

**Evidence.** `scripts/v2/smoke-jarvis-screen-control.mjs`, 40 checks: the protocol
(wrong token, replay, timeout, cancel), the tool under taint, and a real Chromium
(Playwright) driving an esbuild bundle of `uiClient.ts` against a fixture board:
open card, read listing, private content excluded, controlled textarea commits on
blur, stale write rejected, approve/deny/dismiss, Q&A round trip, disabled control,
external link refused, concurrent edit invalidates, navigation invalidates, long
page and long field pagination, speech chunking preserves every character. Not
seen in a browser by the owner yet.

**Not in this slice.** A hands-free loop. The overlay still needs a mic press per
turn (C2b: mic not hot on open, push-to-talk default), so "voice only" today means
press, speak, listen, press. Re-arming capture after read-aloud ends is a small
opt-in toggle but it touches a contract the owner stated twice, so it is his call.
Canvas pixels and cross-origin frames remain invisible, by design.

Rollback: exile `uiProtocol.ts`, `uiRequests.ts`, `uiClient.ts`, `useReadAloud.ts`,
`api/v2/jarvis/ui-result/`, and restore this task's hunks from the baseline copies.

## How to keep this file (read this before adding an entry)

You are an agent working in this repo. The `commit-msg` hook in `.githooks/`
blocks a commit that changes code under `src/` or `scripts/` without staging an
engineering doc. Usually the doc it wants is this one.

**Write the entry as you finish the work, not at the end of a session.** A
journal reconstructed from memory loses the thing that makes it worth keeping:
what you believed before you were corrected.

An entry earns its place if a future reader learns something they could not get
from `git log`. That means:

- **The decision, and the alternative you rejected.** "Keyed ephemeral dirs on a
  random nonce" is a diff. "Keyed on a nonce because PIDs are recycled and the
  pid-based version silently resurrected the previous run's cookies" is a
  journal entry.
- **What you got wrong on the way.** The failed attempt is often the most
  valuable line in the file, because it is the one that stops someone
  re-introducing it. If a check passed while the bug was live, say so.
- **The evidence.** Name the smoke, the count, the file:line, the command whose
  output convinced you. "Verified" without an artifact is not verification.
- **What it costs.** A guard that needs hand-maintenance, a cap that will annoy
  someone, a doc left deliberately blank. Say it here rather than letting the
  next person discover it.

**Do not** log routine edits, dependency bumps with no consequence, or anything
already obvious from the diff. A journal that logs everything gets read by
nobody.

Newest entry at the top. Date each one. Companion docs: `_design/agentos-v2/`
for the plan, `_audit/2026-07-22/` for the original audit.

---
## 2026-09-04 - the dossier was user-facing and invisible, which is the same as absent

The owner: "is the dossier supposed to be user facing? I don't see it, even though
the AI is referencing it."

It was rendering. `grep -l "what they actually asked" .next/static/chunks/*.js` found
it in the live bundle, and the section has no conditional around it. It was just at
the bottom of the drawer, under an uncapped `whitespace-pre-wrap` block holding the
entire job posting - up to 18,781 characters on this board - plus an eight-row
proposal textarea. Two screens of scrolling to reach the panel whose whole purpose is
to be checked *before* drafting.

Shipping a feature below the fold of a wall of text is indistinguishable from not
shipping it. The drawer now reads verdict, dossier, proposal, listing: what they
asked, what we write, then the raw posting as reference. The description is capped at
13rem with a fade and a "Show the full listing (N characters)" toggle, so no section
can be buried under it again.

Found while measuring the burial, and worse than the burial: **`feeds.mjs` truncates
feed descriptions at the source.** Line 52 does `it.desc.slice(0, 1500)` for WWR and
line 46 `slice(0, 2000)` for RemoteOK. 130 of the 131 rows in `feeds.json` are exactly
1500 characters. `board.json` (Upwork) is untouched, median 2,064 and max 18,781.

That is the same defect fixed downstream this afternoon, one layer earlier. Raising
the proposal's window from 1,500 to 14,000 characters was measured against Upwork
listings and is real for them; for every WWR and RemoteOK lead there is nothing past
1,500 to read, because the scraper threw it away before the file was written. The
application instructions those listings carry - the thing the dossier exists to
extract - are cut off before anything in this repo can see them.

`feeds.mjs` lives in the leads directory, not here, so it is the owner's call like
`score_board.mjs`. Flagged, not changed.

Gate: 77 passed, 1 failed (`smoke-webmcp-ui`, unchanged).

## 2026-09-04 - a scrape could take a card the owner had already approved

The owner, after a scrape: "it also nuked all of my 'ready to send' and 'approved'
lists... I thought they were immutable until I explicitly and manually dropped them
off the board."

That expectation was right, and the desk did not honour it.

Nothing had actually been destroyed, which was worth establishing before anything
else. The state file still held all 151 rows - 11 approved, 5 ready - and 8 of the
missing cards were carrying finished proposals, one of them 3,037 characters. What
had gone was the *lead record* the board joins against.

Root cause, and it predates every change made today. `score_board.mjs` ends with

    fs.writeFileSync(`${OUT}/board.json`, JSON.stringify(scored, null, 2))

a wholesale replacement. The desk's leads are pipeline output; the owner's decisions
live in a separate file keyed by lead id. Any scrape that does not re-find a lead
removes its record, and the state row is left pointing at nothing. `listDeals()`
walks the lead files and looks up state by id, so a state row with no lead is
invisible - the approval survives and the card does not.

Two things were ruled out with evidence before accepting that diagnosis, because
both were plausible and one was mine. `feeds.json` was untouched since Sep 2, so the
feed pull was not it. And the read-time age gate shipped an hour earlier exempts
approved and ready - if it had been holding those cards, "Show them anyway" would
have brought them back. It did not, because they were not being filtered.

The fix is one idea: **the desk keeps its own copy of anything it has committed to.**
`patch()` is the single funnel every state mutation goes through, so the capture goes
there - touching a card in any way is the owner committing to it, and from that
moment `DealState.lead` holds the record. `listDeals()` then emits from the snapshot
when the pipeline no longer has a row. A lead nobody has touched is still disposable,
which is correct: it is pure scraper output and nothing is lost by regenerating it.

The snapshot is a floor, never a ceiling. It is captured once and never refreshed,
and when the live record exists the normal path serves it, so a later scrape is free
to supply fresher fields. It just can no longer take the card away. Dismissal still
removes a card, and keeps the snapshot, so even that stays reversible.

`scripts/v2/recover-desk-leads.mjs` rebuilt the 16 already-orphaned rows from
`pitches.json`, which is keyed by the same ids and still held title, url and the
analysis. Dry run by default; `--apply` copies the state file to `.exile/` first. All
16 recovered with real titles and zero unrecoverable. Approved is back to 11 and
Ready to 5, each with its proposal.

A rebuilt card says what it does not know. `easiness` and `winnability` were the
scraper's and are genuinely gone, so `recovered: true` makes the UI render them as a
purple NA instead of the 0 they default to, alongside a "rebuilt" badge. `fitRefined`
came from the pitch pass and is a real judgement, so it is kept. Client details and
the posted date stay null. Showing a fabricated 0 here would have been the same
mistake as the invented uptime already stripped out of this codebase.

The new smoke earned its place immediately: section D caught that the board and feeds
loops never added to the `emitted` set, so a lead present in both a pipeline file and
the snapshot rendered twice. Found by a test asserting the live record wins, which is
not a case anyone would have clicked through by hand.

Still open, and the owner's call: `score_board.mjs` lives in the leads directory, not
this repo, and it will keep replacing `board.json` on every scrape. The desk is now
immune to that, but the file itself still loses history.

Gate: 77 passed, 1 failed (`smoke-webmcp-ui`, the owner's in-flight S7 wizard work in
`settings.ts`; unchanged before and after).

## 2026-09-04 - the age gate was pruning a file, when it needed to filter a view

The owner: "off the rip, it is still pulling old ass listings. 3 weeks old..."

He was right, and the gate that was supposed to stop it had never once run.

Measured before touching anything. `listDeals()` returned 151 rows, 111 of them in
New and every one of those from WeWorkRemotely. By age: 6 at 0-5 days, 13 at 6-10,
63 at 11-21, and 29 at 22 or more, including three postings from **2024** (844, 810
and 810 days old). None were undated, so none were being kept by the "an unknown
date is not an old one" rule. `settings.deals.maxAgeDays` was 5.

Then the decisive pair. Running `partitionByAge` over the live `feeds.json` with a
5-day window: 131 rows, keep 11, drop 120. So the logic was correct. And
`ls *.dropped-*.json` in the leads directory: **nothing**. `pruneLeadsFileByAge`
writes the dropped records beside the file every time it drops any, so an empty
result there is proof the prune had never dropped a row in that directory. Working
code that had never executed.

Two holes let that happen, and they are the same hole seen from two sides.

The prune only runs inside `POST /api/deals/feeds`. Anything that writes
`feeds.json` by another path never meets it - running `feeds.mjs` by hand, or the
route returning early at its own 502 guard before reaching the prune. And more
fundamentally: **age is not a property that holds still.** A row that passed a
5-day gate on Monday is 12 days old by the following Friday, and nothing looked at
it a second time. Landing-time pruning can only ever be correct at the instant it
runs.

So the gate is now also applied where the board is READ, against the current clock,
in `GET /api/deals/list`. Filtering, not deleting: the rows stay in `feeds.json`,
and `ageGate.hidden` rides back on the response so the board can say how many it
withheld. An empty column because 107 leads aged out is a different fact from an
empty column because the feed returned nothing, and the desk now distinguishes
them out loud rather than just looking broken.

One rule keeps this from destroying work. `AGE_GATE_EXEMPT` covers reviewing,
approved, ready, sent, denied and dismissed: once a lead has been picked up, its
posting date stops being the point, and hiding a card out from under a proposal
already sent would be far worse than showing something old. Only untouched triage
("new", "parked") is eligible. Twelve checks in section H of
`smoke-deal-desk-control.mjs` pin that, the inclusive boundary, the undated
carve-out, and the 844-day row from the live board.

What the fix exposes, which is worth saying plainly rather than hiding behind a
filter: at his 5-day setting the board goes from 151 rows to 44, and New from 111
to **6**. The stale cards were not the disease. `feeds.json` was last written
Sep 2 and its rows were already old then, so the desk has been showing three weeks
of the same listings because no successful pull has replaced them. At 14 days the
board is 63 with 25 in New; at 30 days, 135 with 97. The window is a gear setting
and this is now his dial to turn, but the honest reading is that the feed itself
needs looking at next.

Left alone deliberately: `pruneLeadsFileByAge` on the pull path. It keeps the file
from growing without bound, and it is no longer load-bearing for correctness.

Gate: 76 passed, 1 failed (`smoke-webmcp-ui`, the owner's in-flight S7 wizard work
in `settings.ts`; unchanged before and after).

## 2026-09-04 - the dossier: understanding a listing before writing about it

The owner proposed two shapes for fixing thin proposals. Either an agent per listing
that stays warm and owns the whole life of a card, or a pass that reviews the chats, the
posting and the material, writes durable notes, and only then writes the proposal.

The first does not survive this codebase. Every desk route shells out to a `claude -p`
that exits when it answers; there is no long-lived agent to hold context. Keeping one
warm per listing means either resident processes that die on each server restart, or
replaying the accumulated context on every call - which is the second option with a
session store nobody can open. The CLI can `--resume`, but that state is opaque: when
the agent drifts you cannot read it, diff it, or correct it. His second idea is the same
continuity expressed as data, and data is the better substrate precisely because the
server restarts and because he can edit it.

So: a dossier per card, in `DealState` beside `brief` and `screen`. It holds the
client's asks quoted from the listing with our answer to each, the phrase the listing
demands the proposal open with, our reconciled position, and the honest gaps. The
proposal route now runs it first and writes from that account.

The part worth more than the prompt improvement: once the asks are a LIST rather than
prose buried at the bottom of a 12,000-character posting, "did the draft answer them?"
becomes checkable. `likelyMissedAsks()` compares the draft against each ask, and a miss
triggers one bounded revision pass told exactly which asks are unaddressed. What
survives that is reported on the response rather than swallowed.

That check is deliberately one-sided and the smoke pins it as such. It reports what
looks MISSING and never asserts that anything is covered, because term overlap cannot
prove an answer is present or good. A "covered" claim would be the same invention the NA
verdict band was added to prevent two commits ago. The function is named for what it can
actually claim, and section D asserts no `coveredAsks` exists to be misread.

Staleness is computed from the inputs, not from age: an FNV-1a hash over the
description, notes, Q&A and brief. The owner adding a note after a dossier was built is
exactly when the account must be rebuilt, and a proposal quietly anchored to superseded
material is the failure that matters. The card shows a "stale" badge and the proposal
route rebuilds before writing.

Failure paths, as ever: `parseDossier` returns null unless the shape is usable and
nothing is persisted on failure, because an EMPTY dossier would read as "this listing
asks for nothing" and license a draft that answers no questions. A card with no dossier
reads as stale, which means "build one".

Gate: 76 passed, 1 failed (`smoke-webmcp-ui`, the owner's in-flight S7 wizard work).
`smoke-deal-dossier.mjs` adds 40 offline checks. `settings.ts` again carried his
uncommitted S7 changes, so only the `dossierModel` hunk was staged (rule 22).

## 2026-09-04 - the proposal writer could not see the questions it had to answer

Three things the owner asked for, and one of them turned out to be a measurable defect
rather than a preference.

**Selecting a stale board.** He had ~130 New cards to clear and bulk deny already
existed (S4 b), but only over a hand-built selection - hence 130 clicks. The New column
header gets "Select all N", scoped to the visible source tab so it never reaches past
the filter he is looking at. He asked for the selection, not a one-click nuke, and was
explicit about it: "Really, I just need to be able to select them."

Denying a handful is a judgment per card and each earns a memory episode. Selecting the
whole column is a different act - the call is that the board is stale, not that 130
listings were each assessed - so `bulkStatus` takes a `sweep` flag that moves the cards
without writing episodes. Same reasoning as the brief pass only recording an assessment
for a lead you approved: 130 near-identical "denied" episodes would bury the signal.

**The proposal writer was blind to the application instructions.** It built its prompt
from `description.slice(0, 1500)` while the BRIEF got 4000. Measured over the real board
(170 listings): 88 run past 1500 characters, 75 carry explicit application instructions,
and **54 of those 75 sit past character 1500**. Instructions are terminal - "To Apply",
"How to Apply", "When applying" are all in the SECTION_HEADERS list at the bottom of a
posting - so the head slice removed exactly what had to be answered, in 72% of the
listings that asked for anything. The one component whose whole job is answering the
client was the one component that could not see the questions.

`listingText()` now lives in `dealDeskControl.ts` (pure, so the smoke imports it bare)
with a 14,000 cap that clears the corpus maximum of 12,069. If a listing ever exceeds
it, both ends are kept, because the tail is the part that matters. The prompt also now
carries the card's Q&A as ground truth, the full brief including `why` and crashCourse
(neither of which reached it before - only `summary` and `approach` did, as loose "raw
material"), and an instruction to extract and answer every question before writing.

**The card chat had no memory.** He noticed it first: "is the chat bot a new
zero-context every time? It doesn't seem to have any memory of what the last message
was." It was. `ask/route.ts` rebuilt its prompt from the listing plus the single
question and never passed `deal.answers`, so a follow-up had nothing to resolve against.
It now gets the conversation so far, and the full description instead of 1500 characters
- which was also why asking "what are they asking applicants for?" could not be answered
from the prompt.

Gate: 75 passed, 1 failed (`smoke-webmcp-ui`, the owner's in-flight S7 wizard work),
unchanged from before these edits. `smoke-deal-desk-control.mjs` gains section G, seven
checks pinning that an over-long listing keeps its tail.

A note on process: two patch attempts corrupted this route because `\n` escapes collapse
when a generator script is piped through the shell here, and a third failed because em
dashes in a match anchor were re-encoded. Long anchors carrying escapes or non-ASCII are
not reliable in this environment; write the file directly or splice by line index.

## 2026-09-03 - an unjudged lead now says NA instead of inventing a Pursue

The owner noticed the verdict-first card (S4 c) had taken something with it: the
non-Upwork listings lost their pass/not check, and "everything without a check done is
defaulting to pass 8/10".

He was right, and the number came from further away than the UI. `briefBatch` caps a
pass at the top 20 by composite on purpose - a full brief is ~15s a lead, and briefing
248 of them analyses a queue nobody can review. Everything under that cap reached the
board with `summary` and `why` null, and `deriveVerdict` fell through to
`bandFromScore(effectiveFit)`. That fit is not a judgement: it is the keyword score
`feeds.mjs` writes outside this repo. Reading his live corpus, `feeds.json` holds 131
WeWorkRemotely rows scoring {6:51, 7:27, 8:53} - 53 at exactly 8, and 80 at or above the
`>= 7` pursue threshold. One of them is "Cribl: Customer Support Manager", a staff
support role, presented as a green **Pursue** with "No written verdict yet (fit 8/10)"
as the first line on the card.

So the card was not merely defaulting optimistically. It was asserting a verdict that
nothing had reached, which is the failure "Never fabricate state" exists to catch, and
the same class as the fabricated BUILD tag stripped out of `MissionStripe.tsx`.

Two changes. `VerdictBand` gains `unknown`, rendered NA in purple (`#c084fc`), and the
score fall-through returns it. The two branches above it still band off the fit and
deliberately so: there an evaluator wrote prose and just phrased no explicit call, and
banding real prose is interpretation. Banding a lead nobody read is invention. Only the
last branch was the bug.

Then the missing check itself. `dealScreen.ts` is one short call per lead returning
`{band, line}`, cheap enough to run over the whole board where a brief is not. It
targets exactly the leads whose verdict is already `unknown`, so it fills gaps and
leaves briefed or pitched cards alone, and it runs automatically after a feed pull
(`deals.screenOnPull`, on by default) with a "Screen NA leads" button for the tail.

The failure path is the point. `parseScreen` returns null for anything it does not
recognise - a refusal, a fence with no JSON, a band the model invented, an empty line -
and `runScreenBatch` only calls `setScreen` on a real result. A lead the check could not
judge has no `screen` key at all and keeps reading NA. The pass reports its failures
(`N left NA`) rather than hiding them, because a partially judged board is something the
operator needs to know about.

`smoke-deal-screen.mjs` covers it in 33 offline checks, including the exact shape that
caused this (fit 8, no brief, no pitch -> unknown) and the twelve unparseable responses
that must all leave a card untouched. Two assertions in `smoke-deal-desk-control.mjs`
had pinned the old behaviour - A11 read "the band comes from the score (5 -> maybe)" -
and now pin the honest one. Gate: 75 passed, 1 failed (`smoke-webmcp-ui`, the owner's
in-flight S7 wizard work, untouched here).

`settings.ts` carried his uncommitted S7 changes alongside mine, so only the two `deals`
hunks were staged and his `webmcp` wizard fields were left in the working tree (rule 22).

## 2026-09-03 - a zero-fact 'derived' row no longer retires itself

Yoshi flagged this while reviewing the first live sample: episode 0f7dea7e came
back as `outcome: "derived"` with 0 statements and 0 voice aspects, and the
existing candidate query treats any `derived` log row as final. That episode
was gone for good after one weak pass.

The distinction this routine needs is between two things that look identical
at the type level (`outcome === "derived"`, no error) but mean opposite things:

- **The model explicitly decided there was nothing worth remembering.**
  `normalizeEpisodeBody()` returns `NOTHING_TO_REMEMBER`, `addEpisode()` short-
  circuits with `episodeUuid: null`, and `backfillEpisodes()` already logs this
  as `outcome: "nothing"` — a deliberate verdict about the *episode*, correctly
  final.
- **The model ran the whole pipeline and came up empty anyway.** Normalize
  succeeds, `addEpisode()` returns a real `episodeUuid`, but
  `comprehendAndClassify()` extracted zero graph facts and zero voice facts.
  This is a verdict about the *model's pass*, not the episode, and nothing in
  the code distinguished it from a real derivation.

The fix is in `UNDRIVED_WHERE`'s log-exclusion clause, and it is small because
`memory_backfill_log` already carries `statements` and `voice_aspects` columns
per row — no migration needed. A `derived` row only retires the episode now
when `statements > 0 OR voice_aspects > 0`; `nothing` still always retires,
`failed` still never does. The graph-side exclusions (a provenance edge, a
voice_aspects row) were already correct — they only exist when something real
landed — so the log check was the one place treating a zero-yield attempt as
done.

Two knock-on fixes, both in the same commit because leaving either wrong would
make the other's fix report bad numbers:

- **The "still undrived" arithmetic.** `remaining - derived - nothing` assumed
  every `derived` row left the pool. With zero-yield rows staying eligible,
  that undercounts what's actually still waiting. Both `backfill.ts`'s own log
  line and the CLI's mirrored summary line now subtract only
  `derived - derivedEmpty`, and name the zero-yield count in a parenthetical
  when it's nonzero.
- **The per-episode line.** `describe()` now appends "— stays eligible, will
  be offered again" when a derived row is zero-yield, so the CLI's scrollback
  is honest about what will happen next, not just the fact count.

**Writing the smoke for this was the actual work, and it surfaced two of its
own bugs before it passed.** The fake model in this file dispatches by JSON
schema key, and the pipeline has stages the smoke had never needed to
distinguish before:

1. The first attempt at an "empty extraction" fixture put the marker only in
   the raw episode text and let the normalize call's canned response (a crude
   `/Yoshi [^\n]*/` regex over the WHOLE prompt) decide what survived into
   `episode.content`. It grabbed some other "Yoshi" occurrence from deeper in
   the prompt scaffolding, so the marker never reached the extraction calls
   and the "empty" fixture derived normal facts instead. Fixed by having the
   marker case's normalize response name the marker explicitly rather than
   relying on the regex to preserve it by luck.
2. Reproducing "a stronger pass lands a real fact" needed a second, manual
   fetch override, and it broke twice more: first by calling
   `JSON.parse(init.body)` unconditionally, which threw on the bodyless
   `/api/tags` preflight GET; then, once that was guarded, by only intercepting
   the terminal `"facts"` schema call while leaving the upstream `"entities"`
   extraction call empty — which means `comprehendAndClassify()`'s own
   short-circuit (`worldExtract.graph_facts.length > 0 ? reflect() : []`)
   never reaches the classify stage at all, so the "facts" branch was dead
   code. And the reason: `classifyWorldPrompt()` doesn't resend
   `episode.content` — its prompt is built purely from the graph facts' own
   `fact` strings (`src/lib/v2/memory/prompts/classify-world.ts`), so the
   marker had to be carried in the FACT TEXT through extract and reflect, not
   just in the normalized episode body, for the override to still recognise
   the call three stages later.

None of that second bug touches the actual fix — it's smoke-fixture plumbing —
but it's exactly the kind of thing that makes an assertion pass for the wrong
reason if you don't trace WHY a mocked pipeline reached the state it claims to.

Evidence: `smoke-memory-backfill.mjs` 90 → 108 checks. Section M covers: a
zero-yield row stays eligible after one weak pass (M1-M2), after two (M3),
retires once a real fact lands (M4), the log-line wording and the corrected
"still undrived" arithmetic use the run's own reported numbers rather than a
hardcoded count (M5, since this file's cumulative fixture state varies run to
run), and a regression guard that a genuinely-empty (`nothing`) row and a
genuinely-derived row both retire exactly as before (M6). Also verified
directly against the owner's real database: `npx tsx scripts/v2/memory-backfill.mjs
--limit 20 --dry-run` now lists episode `0f7dea7e` — the exact zero-fact row
from the first live sample — back in the candidate set.

**Not running the remaining ~332 episodes now.** Yoshi needs the VRAM Bonsai
was using; the full backfill waits for downtime, when he can load multiple
Bonsai instances at once and parallelize. Noted separately: the customer-
service triage engine already uses Bonsai's 4B variant in production and it
performs well there — a data point for later, since a smaller model in that
role clearly does not carry the same 96%-reasoning-overhead problem the 27B
model showed on this task, or does but the task tolerates it; not measured
either way, worth checking if the 4B is ever considered for this pipeline.

## 2026-09-03 - the backfill was slow because Bonsai thinks for 25 seconds and throws it away

Yoshi ran the first live openai-compat sample and called it: "It's not really
worth the time. Why is it taking so long per episode? Is there a lot to read
through, or is it just thinking real hard?" Both halves of that question turned
out to be answerable with numbers, and the answer was the second one.

The 3-episode sample took 496.8 s, about 165 s per episode. The obvious
suspects were wrong. Measured against the live server:

| probe | result |
|---|---|
| fixed per-request overhead | 0.1 s |
| ~1200 extra prompt tokens | 0.8 s |
| generation speed | 76 tok/s |

Nothing to read (prompts are 136 tokens), nothing slow about the hardware. The
`usage` block gave it away: `completion_tokens 1978`, of which
`reasoning_tokens 1905`. The answer itself was 51 tokens. Bonsai writes a
7,600-character monologue into `message.reasoning_content` to emit a
205-character JSON object, and this pipeline discards every word of it. 96% of
the wall clock was the model talking to itself.

**Why the earlier `<think>` strip never fired.** `openaiCompatChat` strips
`<think>…</think>` out of `content`, copied from the MiniMax path. LM Studio
does not put it there; it splits reasoning into a separate `reasoning_content`
field and leaves `content` clean. So the strip was correct, did nothing, and
told us nothing. The first probe printed `has <think>: false` and I read that as
"not a reasoning model", which was exactly backwards. The token counts, not the
response shape, are what settle this question.

Four knobs were tried against the live server. Only one works, and the two
chat-template ones are silently ignored rather than rejected:

| knob | time | reasoning tokens |
|---|---|---|
| baseline | 26.6 s | 1925 |
| `reasoning_effort: low` | 30.0 s | 2216 |
| `reasoning_effort: minimal` | 22.2 s | 1615 |
| `reasoning_effort: none` | **1.2 s** | **0** |
| `chat_template_kwargs.enable_thinking: false` | 26.8 s | 1986 |
| `chat_template_kwargs.thinking: false` | 24.9 s | 1837 |

Note `low` is SLOWER than baseline. Treating these as a monotonic dial would be
a mistake; only `none` is worth having.

**Quality does not drop, which is the part that matters.** Side by side on three
real legacy notes, thinking-off returned the same facts, and on the browser-
preference note it caught a third fact (the instruction about wording) that
thinking-on missed. The live re-run bears it out: 3 episodes in 63.8 s (21.3 s
each, down from 165) producing 12 facts against the earlier run's 8, across a
wider aspect set (Problem, Event, Knowledge). Spot-checked the three `Problem`
facts on episode 3e67a84a against `original_content` before trusting them: the
note really does end "regressed: dummy data, Paperclip crashes, Express 404s",
so they are grounded, not invented.

For the whole corpus this is the difference between ~15 hours and ~2 hours.

**The setting defaults to "none", and that is a deliberate behaviour change, so
it is stated out loud rather than buried.** `settings.memory.openaiCompatReasoningEffort`
is in the Memory gear as "Thinking budget" (rule 16), the run's preflight line
now reads `reasoning_effort=none` or `reasoning_effort not sent`, and
`BackfillResult.reasoningEffort` carries what actually went out (rule 20). Empty
string means omit the field entirely and let the server decide - which is a
different thing from sending `""`, and smoke L3 pins that distinction. The CLI
flag `--reasoning-effort` overrides through `OPENAI_COMPAT_REASONING_EFFORT`,
the same env door `--base-url` uses, so neither flag writes to disk.

The field never reaches the Ollama path; smoke L4 asserts it by recording
`reasoning_effort` on the fake Ollama and requiring it to be undefined.

Evidence: smoke-memory-backfill 79 -> 90 checks, ALL PASS. Live run
a445501c: 3 derived, 0 failed, 63.8 s.

**Still open:** an episode that derives zero facts is logged `derived` and never
offered again (seen once on 0f7dea7e in the first sample). The outcome is
decided by whether the pipeline returned an episode, not by whether anything was
learned. Yoshi has not yet said whether to change it. Also unchanged: 0 voice
aspects across six real episodes, though this window is all terse June
changelog entries with no stated preferences, so that may be honest.

## 2026-09-03 - S5: the backfill can run on LM Studio, because Bonsai 27B cannot run on Ollama

Yoshi asked whether the memory backfill could use LM Studio, because Bonsai 27B
needs a llama.cpp fork and Ollama will not serve it. As shipped yesterday the
answer was no, and the reason is worth recording: the backfill was written as
"local means Ollama". It hard-pinned `provider: "ollama-local"` in
`withMemoryModel()` and preflighted `GET /api/tags`. Both of those encode a
transport, not a policy. The policy Yoshi actually stated on 2026-09-02 was
"local models only, never a hosted one", and LM Studio on loopback satisfies it.

So `openai-compat` is a fifth memory provider, not a special case inside the
backfill. `openaiCompatChat()` in `llm.ts` posts to
`{settings.memory.openaiCompatUrl}/chat/completions` with the JSON schema in
`response_format.json_schema` AND the same textual `withJsonInstruction()` the
Ollama path uses, because the belt-and-suspenders note in that file (SPEC-A risk
#8) applies at least as much to a llama.cpp server as to Ollama. A `<think>`
block is stripped, copying `minimaxChat`. The whole memory pipeline can use the
provider now, not only the backfill, which is why it went in the choke point.

**The design decision worth the entry: the preflight splits rather than swaps.**
The backfill has two model roles, and only one of them moved. Chat goes wherever
`backfillProvider` says; embeddings are Ollama-only, because
`settings.memory.embedProvider` accepts `ollama-local | ollama-cloud` and nothing
else. A run on LM Studio therefore needs Ollama up as well, and the first draft
of `checkOpenAICompat()` did not check for that. It would have preflighted green
and then failed on the first episode with a connection error from deep inside
`embed.ts`, which is exactly the "backfill failed" non-answer the rest of this
routine was written to avoid. It now checks both and names which server is
missing what: "Chat is served at http://127.0.0.1:1234/v1, but the embedding
model 'nomic-embed-text' is not pulled on Ollama at http://127.0.0.1:11434".
Smoke section K3 pins that sentence.

Model naming is the trap for whoever runs this next. Ollama wants the tag
`bonsai:27b`; LM Studio wants its API identifier, `bonsai-27b`, which Yoshi read
off the Developer tab. They are not interchangeable and `ollamaHasModel`'s
`:latest` fuzzing would happily paper over a near-miss, so the openai-compat
check (`openaiCompatHasModel`) is exact-match only and the error lists every id
the server reported. The gear swaps its own hint text and placeholder on the
provider select for the same reason.

No key is stored. `OPENAI_COMPAT_API_KEY` is read from the environment inside
the request that uses it and appears in no settings field and no getter, per the
credentials rule in AGENTS.md. Local servers normally want none. Smoke section J
asserts `openaiCompatKey` appears nowhere in `llm.ts`.

Evidence: `smoke-memory-backfill.mjs` grew from 62 to 79 checks, ALL PASS. The
fake LM Studio lives behind the same `globalThis.fetch` shim as the fake Ollama;
the host guard was widened to exactly two loopback origins and still throws on
anything else, and K4 asserts every chat call went to :1234 with `bonsai-27b`
while every embedding call still went to :11434. Section F also carried a latent
flake: it asserted the derived aspects render in the order "Identity 1, Event 1",
which depends on statement row order and had simply been lucky. It failed on a
rerun today and now accepts either order.

**What is NOT done:** the real sample. `curl` to 127.0.0.1:1234 answered nothing
while this was written, so the openai-compat path has never spoken to a real LM
Studio, only to the fake. Ollama was also down. The 20-episode sample stays the
owner's to run, as the feature contract says.

Files: `src/lib/v2/memory/llm.ts` (provider union, `openaiCompatBase`,
`openaiCompatChat`), `src/lib/v2/memory/backfill.ts` (`BackfillProvider`,
`checkOpenAICompat`, `checkBackfillProvider`, result carries `provider` + `base`),
`src/lib/settings.ts` (`memory.backfillProvider`, `memory.openaiCompatUrl`),
`scripts/v2/memory-backfill.mjs` (`--provider`, `--base-url`),
`src/app/api/v2/memory/backfill/route.ts` (body `provider`, 400 on an unknown one),
`src/components/v2/memory/MemorySettings.tsx` (Served by select, Server URL field).

## 2026-09-02 - S5: legacy memory backfill, built; the 20-episode sample waits for the owner

Harness session (feat-s5-legacy-memory-backfill), v2.24.0. HANDOFF item 2: the A9
importers wrote legacy episodes in raw mode (verbatim text, an embedding, `legacy` labels,
no LLM calls), so every one of them sits with no aspect. Re-running the import in full
mode cannot repair that: `content_hash + source` dedup in `migrate.ts` rejects the rows as
already present. The agreed plan was a routine over the EXISTING rows, on the owner's local
models, ~20 episodes first so he sees real rows before paying for the full set.

**Pinning the model without touching settings.** Every derivation call goes through
`resolve()` in `lib/v2/memory/llm.ts`, which reads provider and model from
`settings.memory`. The backfill must use `bonsai:27b` on the LOCAL Ollama while the owner's
settings keep naming Ollama Cloud for live ingest, and the pipeline fans out through
`Promise.all` in `comprehendAndClassify`, so a parameter would have had to be threaded
through eight functions. The seam is an `AsyncLocalStorage` override, `withMemoryModel()`:
the whole `addEpisode()` call tree sees `{ provider: "ollama-local", model }`, a concurrent
queue drain still resolves from settings, and the run's STOP signal rides in the same store
so `signalFor()` combines it with the per-call timeout and every fetch dies on STOP. The
rejected alternative was a module-level mutable override; it would have leaked into any
ingest that overlapped the run.

**"Lacking derivation" is a graph fact, not a flag.** Statements hang off an episode by
`provenance` edges and voice facts carry `episode_uuids`; an episode with neither was
never derived. Migration 4 (`memory_backfill_log`, memory band) records every attempt with
its outcome: `derived`, `nothing` (the pipeline's NOTHING_TO_REMEMBER, row kept verbatim,
same as live ingest) or `failed` (with the error). Derived and nothing rows are never
offered again; a failed one is, so a model hiccup costs one retry, not a lost episode.
Dedup is untouched by construction: `addEpisode()` gets the episode's own uuid, the re-save
goes through `ON CONFLICT(uuid)` and copies `content_hash` back; `original_content` is
write-once. The smoke asserts the hash, the original text and the episode count before and
after.

**Fail loudly, in order.** `checkLocalOllama()` hits `GET /api/tags` on the local host
before any episode is touched: Ollama unreachable names the host and says there is no
fallback; the chat model missing names it, lists what is pulled and prints the
`ollama pull` line; the embed model missing (when `embedProvider` is local) does the same
for `nomic-embed-text`. Mid-run, one episode failing is recorded and the run continues;
every episode failing throws, so the tray shows an error and never a quiet "done".

**Three doors, one routine.** `lib/v2/memory/backfill.ts` (`listUndrivedEpisodes`,
`countUndrivedEpisodes`, `backfillEpisodes`, `listBackfillLog`);
`scripts/v2/memory-backfill.mjs --limit 20 --model bonsai:27b [--dry-run] [--json]` prints
each episode's aspects and up to five derived facts; `POST /api/v2/memory/backfill` answers
a dry run inline and otherwise registers a module run (module `memory`, progress per
episode, 409 while one is in flight), `GET` reports how many legacy rows still lack
derivation; the Memory gear gained a "Legacy backfill" section (limit, local model, Dry-run,
Run backfill) that persists both knobs to `settings.memory.backfillLimit/backfillModel`
before starting (rule 16). RunsTray names the module.

**Evidence.** `smoke-memory-backfill.mjs`, 62 checks, offline behind a fake Ollama on
`globalThis.fetch` with settings deliberately set to `ollama-cloud` + `glm-5.2:cloud`:
every chat call went to `127.0.0.1:11434` with `bonsai:27b`; 6 to 8 chat calls per episode;
Identity + Event statements and a Preference voice fact land on the row; the CLI dry run is
exercised as a child process against the same temp DB. Gate 77/77, exit 0.

**What I got wrong.** The first per-episode-failure test poisoned its healthy neighbour:
both fixtures shared a session, and `getSessionContext()` put the failing episode's text in
the healthy one's normalize prompt, so the mock choked on both. Real consequence worth
knowing: a backfill run feeds each episode the last five of its session as context, legacy
sessions are per-day buckets, so derivation quality on day N depends on days already run.
Oldest-first ordering is deliberate for that reason.

**Not done here.** The real 20-episode sample. The owner asked to see the rows before
deciding on the full set, and the routine does 6 to 8 local model calls per episode on a
27B model, so the command is in agent-progress.md for him to run, not run for him.

---
## 2026-09-02 - S4 (e): "More info needed" fires a research pass and reports on the card

Harness session (feat-s4-deal-desk-control), part six of six. The owner's words: today it
paints a yellow cone on the card and fires no task. It should kick off a research pass
(enrich + brief + the open questions) and report back on the card, with a button inside
the drawer to ask for more on demand.

**One run, three steps, every skip in words.** `lib/dealResearch.ts` `runResearch()`:
enrich through the gated runner from (d) (skipped as "feed lead" or "no cookie", said on
the card, never silent; a login wall flags the card and the pass carries on because the
other two steps do not need Upwork), then the brief (`generateBrief`), then the open
questions: a prompt that asks for 3 to 5 questions we would need answered before
bidding, each with the best answer the listing supports or exactly "Unknown - ask the
client", saved as Q&A entries so they show where the drawer already shows answers.
State goes to the card through `setResearch()` as it moves (running, done / error /
stopped, with a note like `enrich skipped: no cookie · brief done · 2 questions`).

**Not awaited, on purpose.** `/brief` awaits its run; `/research` returns `runId` at once
and the store polls the board every 5 s until `deal.research.status` settles (capped at
~12 minutes). A pass is two claude calls and possibly a browser, and the toggle that
starts it must not hang the drawer for a minute. 409 when a pass is already running on
that card, with the live `runId`.

**Wiring.** Turning "Need more info" ON starts the pass; turning it off leaves what ran.
"Get more info" in the drawer runs it without touching the flag. The card face and the
drawer show the research line (spinner while running, "researched 3m ago · 2 answers",
or the failure reason). Evidence: `smoke-deal-desk-control` section F, 13 checks, every
model and browser call replaced by a seam (no cookie, feed lead, login wall on enrich,
STOP mid-brief leaves the card "stopped", a throwing step leaves it "error"); `tsc`
clean. Not seen in a browser: the real pass needs the owner's claude CLI.

---
## 2026-09-02 - S4 (a): pasted URLs become cards through the normal pipeline

Harness session (feat-s4-deal-desk-control), part five. The owner's words: paste one or
more job-listing URLs and have the desk scrape, evaluate and pitch them like any feed
item.

**Why it goes through the actor's pipeline and not a shortcut.** `listDeals()` shows a
board row only when `pitches.json` has its URL, and `score_board.mjs` rebuilds
`board.json` from the actor's dataset directory. So the shortest honest path was to make
an intake row look exactly like a scraped one: `scripts/deals/intake-scrape.mjs`
(Playwright from this repo, the owner's real Chrome channel like the actor) visits each
page and calls the actor's own `parseDetailPage` + `mergeRecord` (imported by file URL
from `UPWORK_ACTOR_DIR`), `lib/dealIntake.ts` writes the row as
`intake-<uid>.json` into the dataset dir, runs `score_board.mjs`, then `pitch.mjs` with
the new ids, then forces them into New the way refill does. Rejected: porting the
scorer's three functions into the repo to append to board.json directly; that is
external logic that would drift the day the owner tunes it.

**What it costs, said plainly.** Crawlee purges the dataset at the start of the next
actor run, so a re-scrape drops intake rows from board.json unless the search finds the
same listing. That is already the lifecycle of every board row (a re-scrape replaces every
URL; the scrape route's header note measured 0 overlap), and desk state survives by id.
Also: the scraper only accepts Upwork job pages, because the record shape is keyed on
the job uid; any other URL is rejected by name with the reason
(`parseIntakeUrls`, cap 20 per paste, the apply-form spelling and `~01` ids
canonicalise to the same target).

**The gate rides along.** The intake rows pass `detectLoginWall()`; a wall stops the run
and flags the rest `needsLogin`, the same state (d) built. The route is a module run
("Intake: N pasted listings", STOP kills whichever child is up); the paste box is a
panel under the header. Evidence: `smoke-deal-desk-control` section E, 13 checks, with
fake intake / score / pitch scripts in the redirected leads dir (row 1 lands in New
with a pursue verdict, row 2 is the login page, row 3 is never reached); `tsc` clean.
Not seen in a browser: the real `intake-scrape.mjs` against upwork.com needs the owner's
Chrome and his session.

---
## 2026-09-02 - S4 (d): enrichment stops at the login wall and says so on the card

Harness session (feat-s4-deal-desk-control), part four. The owner's words: the browser
was logged out and enrich ran as if fine; detect the login wall, stop, and ask.

**What was there.** `actor/enrich.mjs` already detects the wall in the browser and
returns `error: "login"`; `/api/deals/enrich` turned that into "stopped on login" in a
banner and left every card untouched, so the next click did the same thing. The route
was also in the owner's uncommitted working set (`sanitizeSpawnEnv` on the spawn), so it
was not edited or staged. Rejected: stashing his hunk to edit around it; a conflict on
pop could mangle work that is not mine.

**What landed instead.** `lib/dealEnrich.ts` is the same spawn with the gate:
`runEnrichment()` reads the actor's rows, and on a wall (the actor's own error, or
`detectLoginWall()` over any title/finalUrl/text a row carries) it stops, flags the card
at the wall AND every card the run never reached with `needsLogin` + `loginWallAt` in one
write (`setNeedsLogin`), and clears the flag on any card that enriched cleanly. A new
`POST /api/deals/enrichment` runs it as a module run ("Enrich: N approved cards", STOP
kills the browser child) and the store's "Enrich approved" button calls it; the old
route stays and works, minus the gate. `detectLoginWall()` in `dealDeskControl.ts` checks
URL (Upwork's `/ab/account-security/login`), then title, then the login-form text; a
text match is vetoed by listing markers ("Proposals", "About the client"), because
listings quote "Log in to apply" in their own copy (smoke D1).

**The way out.** A red banner above the board names the count and offers "Open Upwork
login" plus "Update cookie"; each flagged card wears a `needs login` badge. Saving a
cookie clears every flag (`/api/deals/cookie` POST), on the reading that a fresh cookie
is the owner saying he logged back in; if the session is still dead, the next run flags
them again. Evidence: `smoke-deal-desk-control` section D, 17 checks, including the
runner against a fake actor script that returns ok / login / (unreached), and a check
that the cookie never appears in a log line. `tsc` clean.

---
## 2026-09-02 - S4 (f): a max-age gate on what lands on the board

Harness session (feat-s4-deal-desk-control), part three. The owner's words: the feed is
pulling listings 3-4 weeks old; add a max-age setting in the gear, drop older listings at
scrape time, show the age on the card.

**Where the gate sits.** `settings.deals.maxAgeDays` (default 5, clamped 1..365, edited
in the new Deal Desk gear `DealDeskSettings.tsx`, rule 16). `pruneLeadsFileByAge()` in
`upworkDesk.ts` runs in `/api/deals/scrape` between scoring and pitching, on board.json
AND shortlist.json, so an old listing is neither pitched (one claude call each) nor
shown; and in `/api/deals/feeds` after `feeds.mjs`, before the brief pass, because the
feed was the source of the old rows. Rejected: filtering in `listDeals()` as well,
because that would hide cards the owner has already moved to Reviewing or Approved the
day the gate is lowered. The gate is on arrival, and a card that is on the board stays.

**Nothing is discarded.** A prune writes the dropped rows to
`<name>.dropped-<date>.json` beside the file (appending on the same day) before it
rewrites the file. `board.json` is a pipeline output, but it is the owner's data too,
and a gate that quietly deletes 40 listings is the kind of thing that gets discovered a
month later. An undated record is kept, never dropped: an unknown date is not an old one
(smoke C5).

**The age on the card.** `PostedAgo` already re-derived "12d ago" from `postedAt`; it
now judges "old" against the gate from the store (`/api/deals/list` returns
`maxAgeDays`) instead of a fixed 21 days, turns amber, and appends OLD. Undated shows
"undated" instead of an empty span. Evidence: `smoke-deal-desk-control` section C, 10
checks (partition, clamp, file prune, sidecar, idempotence, missing file); `tsc` clean.
Cost: the sidecar files accumulate in the leads dir, one per day with drops.

---
## 2026-09-02 - S4 (b): deny from the card face, deny many, and a lane you can reach

Harness session (feat-s4-deal-desk-control), part two. The owner's words: to deny a
lead today you open the card, find the dropdown, pick denied, close; and the Parked /
Denied column sits off the right edge of the board.

**One write for many cards.** `setStatusBulk(ids, status)` in `upworkDesk.ts` takes the
write lock once, patches every id, and rotates the store one generation. Looping
`setStatus` would have rotated twenty times for twenty cards and left a crash window
between each pair (smoke B4 pins "one generation"). `/api/deals/action` gained
`action: "bulkStatus"` with `ids[]`; it is handled before the `id` check so the existing
single-card contract is untouched. A bulk deny records one memory episode per card,
because each is a call the owner made by hand; refill's bulk *dismiss* stays silent, as
before, because that is triage.

**The lane moved, it did not get a scrollbar.** Parked and Denied are now a two-column
lane UNDER the pipeline, full width, each half its own drop target with a dashed outline
while a drag is in flight. Rejected: a sticky right-edge strip, because it would cover
the Sent column on a laptop and still put the denied cards out of sight. Cards in
Parked keep their tick box and deny cross; cards already in Denied have neither.

**Face controls.** A tick box (multi-select) and a deny cross on every pipeline card,
both stopping propagation so the drawer does not open. A red bar appears above the
board only while something is ticked: "Deny N selected" and "Clear selection".
Ride-along: Reload now disables itself, turns amber, and says "Reloading…" while the
fetch runs (the roadmap's "visible Reload spinner"). Evidence:
`smoke-deal-desk-control` section B, 7 checks; `tsc` clean.

---
## 2026-09-02 - S4 (c): the verdict is the first thing a card says

Harness session (feat-s4-deal-desk-control), part one of six. The owner's words: the
evaluator already scores the listing and then says pass or pursue; that sentence was the
last thing in the yellow summary box, so every card had to be opened to find it.

**Where the sentence lives.** `pitch.mjs` (Upwork-Leads) writes `why` as "one blunt
sentence on why it is/isn't a fit" and opens `pitch` with `Skip -` for a lead it scored
<= 3; `dealBrief.ts` asks for the fit call at the start of `summary`. `deriveVerdict()` in
the new `src/lib/dealDeskControl.ts` reads those in that order (a `Skip -` pitch wins,
then the first sentence of `why`, then of `summary`), bands it pursue / maybe / pass on
the wording, and falls back to `effectiveFit` (>= 7 / >= 4 / below) only when the text
carries no readable call. Nothing written at all gives `No written verdict yet (fit N/10)`
with `source: "score"`, never an invented sentence.

**What it cost.** The band regexes are wordlists, and wordlists have edges: `pass` needs a
negative lookahead so "pass the data through their API" does not read as a pass (smoke
A14 pins it). The verdict reads the evaluator's own `pitch`, never `editedPitch`, so a
hand edit cannot flip the band. Rejected: asking the model for a separate `verdict` key,
because 145 existing cards would have shown nothing until re-briefed.

**UI.** Card edge colour now encodes the verdict (it was the composite score); the band
label plus sentence sit under the title on the card face; in the drawer the sentence is
the first line of the summary box, in the band colour. Evidence:
`scripts/v2/smoke-deal-desk-control.mjs` section A, 15 checks; `tsc` clean.

---
## 2026-09-02 - Backlog: Deal Desk and Hire Engine long routes register module runs

Harness session (feat-backlog-wrap-long-routes). S2 built `lib/moduleRuns.ts` and wired
Content Engine; S3 added STOP. This wraps the next tranche the roadmap named: the Deal
Desk and Hire Engine "await a model for minutes" routes.

**Wired (8):** `deals/brief`, `deals/brief-batch`, `deals/proposal`, `hire/brief`,
`hire/draft`, `hire/pitch`, `hire/scrape`, `hire/enrich`. Each calls
`startModuleRun({ module: "deals" | "hire", label, href })`, logs its meaningful steps,
awaits the same promise it always did, and adds `runId` to every response. Status codes
are unchanged (400/404 pre-checks still run BEFORE a run is registered, so a rejected
request never leaves a tray row); the one new code is 409 `{ stopped: true }` after a
STOP, the same contract content-engine/generate set.

**Skipped as dirty (1):** `deals/enrich` was in the owner's uncommitted working set
(`sanitizeSpawnEnv` on the actor spawn), so it was not touched or staged. Its wrap is one
call once that change lands.

Decisions and what they cost:

- **`lib/runRoute.ts` instead of a regex per route.** content-engine/generate maps the
  error message to a status with `/did not return JSON|.../.test(msg)`. Eight more copies
  of that would drift. `HttpError(status, message)` thrown inside the run keeps the status
  the route always sent and puts the reason on the run record; `runErrorResponse` is the
  one catch block. It is pure, so the smoke exercises it (409 / 502 / 500 / non-Error).
- **`brief-batch` never awaited its work, and still does not.** The pass ran in a
  fire-and-forget IIFE inside `startBriefBatch`, so nothing in the route could hold the
  run. Split the lib: `planBriefBatch` (pure target selection) + `runBriefBatch` (owns the
  job state, takes `signal` / `onProgress` / `log` / `runId`). The route registers the run
  around `runBriefBatch` and answers at once as before; `startBriefBatch` still exists as
  plan+run for the feed pull and "refill", which are NOT in the tray (that is the honest
  state: they were never routes on this list). `BriefJob.runId` is new so the GET poll
  can name the tray row. Rejected: polling `briefBatchStatus()` inside a run until
  `running` flips, which would have kept the signal away from the children.
- **STOP reaches the child in five of eight, and the other three say so.**
  `generateBrief` and `run()` already take a signal (committed), so deals/brief,
  deals/brief-batch and deals/proposal kill the claude child on STOP; hire/scrape kills
  the `hire.mjs` child from an abort listener; hire/enrich ends the Hunter fetches with
  `AbortSignal.any([timeout, ctx.signal])` and a stopped lead is NOT written as a failed
  firmo. `generateHireBrief`, `generateHirePitch` and `createGmailDrafts` take no signal
  and live in `hireBrief.ts` / `hireDraft.ts`, both in the owner's working set, so they
  were not changed: those three routes mark the run stopped, answer 409, and let the
  child finish and discard its result. Each carries a comment saying exactly that and the
  smoke asserts the comment, so the seam cannot be forgotten silently. The seam:
  `signal?: AbortSignal` on those three exports, threaded to `claudeJson` -> `run()`.
- **Nothing secret in a label or a log line.** Labels name the listing or lead; the
  enrich log names companies and verdicts, the draft log names subjects. No email
  address, no Hunter key, no `to` field reaches `module-runs.json`.

What I got wrong: the first smoke run failed 3 checks because the "says why STOP cannot
reach the child" regex used `\s+` across a wrapped comment line and could not cross the
`// ` prefix. The routes were right; the regex now spans `[\s/]+`.

Evidence: `npx tsc --noEmit` rc=0; `smoke-module-runs.mjs` section F grows from 62 to 84
checks (eight route greps, eight signal/seam checks, two for the briefBatch split, four
runRoute cases); `./test.sh` 75 passed, 0 failed, exit 0.

## 2026-09-02 - S3: configure before launch, STOP after

Harness session (feat-s3-prelaunch-drawer-stop). Yoshi's decision: configuration
happens BEFORE a run launches, in a drawer; the only mid-run control is STOP. No
live editing of constraints. Built for Content Engine (plan, generate) and Agent
Kanban (plan, build), the two he runs most. Deal Desk untouched (S4 owns it).

**STOP.** `lib/moduleRuns.ts` keeps one AbortController per live run (in
memory, never persisted) and hands `ctx.signal` to the work. `stopModuleRun(id,
by)` marks the run "stopped" with who and when plus a STOP event, then aborts.
Order matters: the status is set before the abort fires, so the work's rejection
lands in a catch that already knows the run was stopped and rethrows an
AbortError-shaped error instead of flipping the row to "error". A work that
ignores the signal and resolves later is caught the same way: "stopped" is
terminal, the awaiting caller never receives a result it must not trust.
`POST /api/runs/:id {action:"stop"}`, 409 when the run is not in flight. The
tray shows a Stop button on running rows and "stopped by owner after 12s",
never "done". The signal actually reaches the child: `seatComplete`,
`kimiComplete`, `multiModelComplete` and `localChat` gained an opts.signal,
threaded from ctx.signal, and `runner.ts` already killed the process tree on
abort (taskkill /T on win32). That kill path has existed since the Loop and was
simply unreachable from these four routes. A STOP is never something to fall
back from: multiModelComplete rethrows when the signal is aborted instead of
rescuing with Claude.

Rejected: recording a stop as status "error" with "stopped by owner" in the
message. The tray would have shown a red triangle for something the owner did
on purpose; a stop is not a failure and must not look like one.

**Drawer.** `lib/launchOptions.ts` is the contract: per module, the seats and
the guardrails its routes actually enforce. Content Engine declares
`timeoutMin` and `noFallback`; Kanban declares `timeoutMin`, `maxCards`,
`noExternalScripts`. The feature text's example list ("max steps / no network /
require test run") was not adopted as written, because nothing in these four
routes could honour "require test run", and a switch wired to nothing is the
fake-telemetry pattern again. Parse is strict: an unknown top-level field, an
unknown guardrail, a wrong type, an out-of-range number, a foreign seat or a bad
skill name is a 400 that names the field. The alternative (drop unknown fields)
was rejected because a mistyped guardrail would launch WITHOUT the guardrail the
operator believed they had set. Resolve order is body > settings.launch.<module>
> defaults; a stale stored value falls back to defaults field by field and the
result says which source won. `RunLaunchDrawer.tsx` renders exactly those
declarations plus the installed skills from /api/skills and an instructions
box; on Launch it PATCHes settings.launch.<module> first (rule 16) and then hands
the same object to the caller, which POSTs it. While a run of that module is in
flight (caller flag OR a /api/runs probe every 4 s) the fieldset is disabled
and Launch is replaced by "Stop it from the runs tray". Skills chosen in the
drawer ride through `skillBlock(module, max, extra)`, so the local Ollama seat
and the Kimi seat get them too. Before this, only CLI seats received any
skills at all; the Kimi seat in the Content Engine rotation got none.

Kanban's Builder picker moved into the drawer; the composer no longer sends
`agent`, though both routes still accept the legacy field and turn it into a
launch object through the same validation. Each plan and each card build is now
a run in the tray. A stopped build halts the client loop and puts the remaining
cards back in the backlog instead of marching on.

**Evidence.** `smoke-module-runs.mjs` §G+F, 62 checks: the signal fires,
status "stopped" with stoppedBy, the promise rejects with name AbortError, a
late resolve cannot flip to "done", route 200/409/404, "stopped" survives a
restart as "stopped" (not "lost"). `smoke-launch-drawer.mjs`, 70 checks:
declarations, twelve rejection shapes, resolve order, settings round-trip
(arrays replaced wholesale), the helpers, all four routes 400 on a bad launch
with zero runs registered, source wiring, and the real settings.json untouched.
`tsc --noEmit` clean. Gate `./test.sh` exit 0, 75/75 (`.harness-logs/gate-s3.log`).
NOT verified: the drawer in a browser, and a STOP against a live CLI child (the
smoke proves the signal fires and the route flips the status; the taskkill leg
is runner.ts's and predates this slice).

**Costs.** A guardrail is declared once in launchOptions.ts and enforced by hand
in each route; adding one means both, and the smoke's wiring section is what
catches a declaration without an enforcement. A five-card board is now six tray
rows. `AbortSignal.any` needs Node 20+ (node 24 here). Version v2.17.0.

---


## 2026-09-02 - S6: Hermes 3D was never mounted; now it is

Harness session (feat-s6-hermes3d-missing). Yoshi's report was "Hermes 3D is
nowhere". The roadmap asked first whether that was a stale build or an
unmounted route.

**What was actually missing.** Not a build. `public/hermes3d/` held every
baked artifact (office.glb 5.5 MB, hermes-clips.glb 7.7 MB, 18 character
GLBs + atlas, office-seats.json with 149 anchors, all dated 2026-08-31) and
`smoke-hermes3d.mjs` had been green against them for two days. What did not
exist: a page under `src/app`, a NAV entry, a component, anything in
`src/components` or `src/app` containing the string `hermes3d` (grep,
this session). SPEC-F L2.2 planned the scene on `@react-three/fiber` +
`drei`, and neither was ever installed (`package.json`: `three` 0.184
and its types only). The asset pipeline (L1, L3) shipped; the scene (L2) was
never started. A smoke that asserts the artifacts cannot notice that nobody
looks at them, which is why this slice adds a second smoke for the mount.

**What landed.** `/hermes3d` in Artist's Corner (Sidebar NAV +
`ARTIST_ROUTES`, pageMeta "Hermes 3D"), a server page shell,
`Hermes3DView` (client; owns the `dynamic(..., { ssr: false })` boundary,
which Next 16 accepts only inside a client component) and `HermesOffice`,
the scene on plain three.js with `GLTFLoader` + `OrbitControls` from
`three/examples/jsm`. It loads office.glb, then office-seats.json, then the
clip library and N character bodies, seats them on the chairs nearest the
chairs' centroid (`pickSeats` in `lib/v2/hermes3d/scene.ts`, deterministic)
and plays the SEATED idle clips (`idle-sitting`, `idle-sitting-2`, baked
but excluded from the standing pools for the reason PIPELINE.md gives). The
atlas is applied at runtime because the character bake exports untextured.
A gear (rule 16) edits `hermes3d.quality / shadows / showFps / seatedCount`;
`seatedCount` is new in `settings.ts`, default 4, and 0 shows the office
alone. `DEFAULT_SETTINGS.hermes3d` now spreads `DEFAULT_HERMES3D` from
`sceneDefaults.ts` so the gear and the store cannot drift.

**Honesty rules in the scene.** The seated bodies are NOT agents: no run
state reaches this scene yet, so the HUD says so in words ("Not agents: run
state is not wired") and the pageMeta standfirst says the same. Idle is the
one state a body may hold with no run behind it (clips.ts); anything else
would be the fake-telemetry pattern in 3D. Missing assets are a probe
(`HEAD /hermes3d/office.glb`) before any WebGL exists, and the answer is a
panel quoting `MISSING_ASSETS_MESSAGE`, which names PIPELINE.md. An
office.glb that parses to zero meshes is an error panel, not a dark canvas.
Every partial failure (seats file, clip library, atlas, one body) is a line
in the HUD, never a swallowed catch. `talkingHoldMs` stays out of the gear
because nothing consumes it yet; a switch wired to nothing is a lie of the
same family.

**Evidence.** `scripts/v2/smoke-hermes3d-ui.mjs`: 36 checks, offline, §E
parses the real office-seats.json (149 rows, 60 chairs, 4 picked, stable
across two calls) and SKIPs with a printed reason when the gitignored dir is
absent. `tsc --noEmit` clean. Gate `./test.sh` exit 0, 74/74 smokes
(`.harness-logs/gate-s6-cycle3.log`). The building session (harness cycle 2)
ended while its gate was still running in the background, so nothing was
committed; cycle 3 re-verified the tree and landed the commit.
What is NOT verified: the picture. This session cannot open the app; the
first look at the framing (a raised three-quarter view of the seated
cluster), the seat height of a Mixamo sitting clip on a Synty chair, and
whether the baked level has a roof that hides the top-down view, is Yoshi's.

**Costs and follow-ups.** Run state (SPEC-F L2.1: `mapRunToState` per
agent, characters assigned by `characterFor`) is the next slice and is
listed in agent-progress.md; `clips` pools in settings are still unread by
the scene. Draco decoder files were never copied and are not needed: the
bake does not Draco-compress. Version v2.16.0.

---

## 2026-09-02 - S8: the Oracle speaks Voicebox, on its own settings

Harness session (feat-s8-voicebox-everywhere). The Oracle still spoke
ElevenLabs with a voice id hardcoded in `OracleView.tsx` and a picker of its
own that persisted to localStorage; Yoshi had already cloned "The Sage" in
the studio for it. Scope was the Oracle only; Video's voiceover is untouched
and noted as the follow-up in ROADMAP.md.

**What landed.** `settings.oracle.voice` = `{ provider: "voicebox" |
"elevenlabs", voiceboxProfile, elevenVoiceId, fallback: "elevenlabs" |
"none" }` with defaults Voicebox + "The Sage" + the Sage's ElevenLabs id
(now the named constant `ORACLE_ELEVEN_VOICE_ID` in `lib/settings.ts`, where
Jarvis's lives) + ElevenLabs backup. A gear in the Oracle's eyebrow row
(rule 16) lists the studio's profiles from `/api/voicebox/profiles` and the
ElevenLabs voices from `/api/video/voices`, persisting through
`PATCH /api/settings`. `speak()` reads the settings and sends
`{ provider, voiceId, module: "oracle" }` to `/api/hermes/tts`.

**The decision: whose fallback.** The TTS route read
`jarvis.voice.ttsFallback` for every caller. Rule 20 says a fallback is legal
only when *that module's* settings chose it, so the request now carries
`module` and `fallbackPolicy(module)` picks `oracle.voice.fallback` for the
Oracle and Jarvis's setting for everyone else. The rejected alternative was a
second route; one door for credentials is the house rule. The policy also
carries the backup *voice*: before this, a Voicebox failure in the Oracle
would have made ElevenLabs answer as Alfred. Section H pins that the Sage's
id reaches ElevenLabs, not Jarvis's.

**A missing profile is loud.** `voiceboxProfile` defaults to "The Sage" by
name. If the studio does not have it, `resolveVoiceboxProfile` throws with
the available names, the route returns that (or the labelled backup speaks,
if allowed), and the gear shows the same warning with the saved value kept
selectable so a typo is visible. The alternative, "use the studio's first
profile when the named one is missing", is exactly the quiet swap AGENTS.md
bans.

**Visible, not just logged.** JarvisView only `console.warn`s when the
backup spoke. The Oracle shows it in the answer's footer ("elevenlabs spoke:
voicebox failed (...)") as well, because the person reading counsel is not
watching the console.

**Evidence.** `scripts/v2/smoke-voicebox.mjs` grew section H: 48 checks
(from 36), offline. It asserts the defaults survive a settings file that
lacks them, greps `OracleView.tsx` for the absence of `provider: "elevenlabs"`
and of the voice id, and drives the route with `module: "oracle"` through:
The Sage found by name (third fixture profile, so position cannot pass it),
Oracle fallback `none` while Jarvis's is `elevenlabs` (502, no ElevenLabs
call), the labelled backup in the Sage's voice, and an unknown profile
naming the options. `tsc --noEmit` clean; `./test.sh` green (the harness
gate). Not verified: audio in the browser, which needs the rebuilt app and
Yoshi's ear.

**Cost.** The pickers load when the gear opens, not on page view, so the
studio and ElevenLabs are not polled by every visit to the Hermes tab. The
ElevenLabs picker still comes from `/api/video/voices`, a Video route; if
Video is ever de-ElevenLabs'd that list needs a home of its own.

**Rollback.** Revert the commit. `settings.json` may carry an `oracle` key
the old code ignores. No migration, no data.

## 2026-09-02 - The gate had to be made honest before the loop could trust it

Installing the Ralph harness meant running every smoke as one gate, and the
first full run showed three things a per-smoke habit had hidden.

1. **Five smokes go online when Ollama is up.** compaction, ingest,
   jarvis-brain, memory-api and search grow a model leg (cloud when a key is
   in the env, else local models); on this box Ollama is always up, so
   "offline" meant 331 s of model calls in one smoke. CI never sees it
   because CI has no Ollama. `AGENTIC_SMOKE_OFFLINE=1` now skips the leg,
   decided BEFORE the probe: with the probe socket still closing,
   `process.exit` tripped a libuv assertion on Windows (`UV_HANDLE_CLOSING`,
   smoke-ingest). `test.sh` sets the flag and unsets provider keys.
2. **smoke-search carried a time bomb.** Its temporal_facets check queried a
   literal 2026-08-01..08-31 window; from September 1 the freshly seeded
   episodes fell outside it and two facet checks failed on every run. The
   window is relative now.
3. **smoke-jarvis-ui caught S1 breaking a contract.** The capture hook is
   "capture only, no sends", and the Voicebox lane had put a fetch to
   /api/voicebox/transcribe inside it. The call moved to
   `transcribeClient.ts`; the smoke now also asserts that helper reaches only
   the transcribe route and never the brain. The contract's intent (the
   transcript is never auto-dispatched) was never violated; the letter was.

Gate cost, offline: about 6 minutes for tsc + 73 smokes.

## 2026-09-02 - Voice verified live; the tailnet needs https for the mic

16:12: Yoshi confirms Jarvis voice works at http://localhost:3737 after the
rebuild - Voicebox reply voice and the local-Whisper mic both. The S1 entry's
"not verified: the MediaRecorder lane end to end" is now verified by the
owner, in Opera, on the host.

What did not work first: the same app at his Tailscale address
(100.88.224.75) showed every mic provider as "unavailable". Plain http on a
non-localhost origin is not a secure context, so the browser hides
`navigator.mediaDevices`; nothing in Voicebox or the app was wrong. The
availability message now names the origin and the fix (`d2ce6f9`), AGENTS.md
records the access path (`ccd6469`), and the durable fix on his side is
`tailscale serve --bg 3737` -> https://desktop.hair-halfmoon.ts.net (MagicDNS
and certs already enabled on the tailnet, no serve config yet).

## 2026-09-02 - "It says the server started, but I can't connect"

Reported at 15:06, right after the S2 rebuild. Shell first: nothing listening
on 3737, `.next/BUILD_ID` fresh (14:29), and the server's own err log:

    REFUSING TO START - Agent OS is already running as PID 33256, up since
    9/2/2026, 2:37:09 AM.

PID 33256 did not exist. The lock file still carried it, with a heartbeat
that was fresh when the refusal happened.

**The race.** `agentos-restart.ps1` kills the old server, waits 1.2 s,
and launches the new one. `singleInstance.ts` judges liveness by heartbeat
alone - stale after 60 s - by design, because a PID can be recycled and a
recycled PID would make a healthy boot refuse. So every restart within a
minute of a healthy server saw a warm heartbeat from a dead process,
refused, and exited. The launcher then printed "still starting - see the
err log" and, because that branch exited 0, the batch file said "Done".
This morning's S0 fix only covered the abort-on-survivor path; this was the
other lie.

**Fix, both halves.** `liveHolder()` keeps the heartbeat rule and adds one
one-directional check: a fresh heartbeat from a PID that does not exist at
all (`process.kill(pid, 0)` -> ESRCH) frees the lock. Absence is certain;
a recycled PID still looks alive and still refuses, which is the failure the
original design chose to accept. `agentos-restart.ps1` now exits 1 when the
port is not up after 40 s and prints the last six lines of the err log, so
the reason is on screen instead of in a file nobody opens.

**The smoke had the same blind spot.** `smoke-restart-integrity.mjs` built
its "live foreign holder" fixture with `process.pid + 1`, a PID that
usually does not exist - exactly the case now treated as dead, so A8 would
have failed. The fixture is `process.ppid` now (a real process), and A11b/
A11c pin the new rule: fresh heartbeat + missing PID = ignored. 54 checks.

**Not verified live.** The guard change needs a rebuild to be in the running
server; until then the fix for a stuck restart is to wait a minute for the
heartbeat to go stale and run the launcher again, which is what unblocked
Yoshi today.

**Rollback.** Revert the commit; previous launcher at
`.exile/2026-09-02_150800/agentos-restart.ps1`.

## 2026-09-02 - S2: a run outlives the page that started it

Tasklist item 5, from Yoshi's bug list: "If I leave a module's page in the
middle of an agent run, it disappears. I don't know if it kills it."

**What was actually happening.** It did not kill it. Content Engine's
generate and plan are plain awaited POSTs with a 600 s ceiling; the browser
drops the fetch on navigation, the Node handler keeps going, and
`patchItem` writes the drafted materials anyway. The owner just never hears
about it: no spinner, no record, no way back. Thirty-six routes share that
shape (`grep -l maxDuration src/app/api`). The V2 agents module has a
registry (`agentsRuntime` RUNS + the status feed); V1 had nothing.

**Built.** `src/lib/moduleRuns.ts`: `startModuleRun(spec, work)` registers a
run the moment it starts, returns `{ id, promise }`, and finishes on its own.
The route still awaits the same promise, so the drawer gets its answer as
before; the difference is that the run now exists outside the request.
`/api/runs` (list, with live V2 agent runs merged in from a new
`listLiveAgentRuns()`), `/api/runs/stream` (SSE, snapshot then one frame per
change, same shape as `/api/v2/agents/status`), `/api/runs/:id` (detail,
dismiss). `RunsTray.tsx` sits bottom-left in the root layout - Jarvis's orb
owns bottom-right - one card per run, elapsed time while running, done/error
with the last event, an Open link, auto-dismiss after `runsTray.autoDismissSec`
with the knob in the tray's own gear (rule 16). Empty tray renders nothing.

**Honesty rules baked in.** A run that was "running" when the server died is
marked `lost` with "server restarted while this run was in flight" on the
next boot, never left spinning. A live run cannot be dismissed (409); STOP
is S3's verb and a different thing. The result stored on a run is a
summary, never the payload.

**Two things the smoke caught before anyone else could.** `patchItem` can
return null and the summarizer would have read `.status` off it - a tsc
error, fixed by failing the run with "item vanished while its materials were
being written". And an ordering bug of the exact class the newsletter
replies had last week: two runs finishing in the same millisecond sorted by
Map insertion, oldest first. The comparator now tiebreaks on `startedAt`.
Section B fails without it.

**Scope, stated plainly.** Content Engine generate and plan are wired. The
other 34 routes are one call each and are listed in the backlog; Deal Desk
and Hire Engine go first when S4 opens them anyway. Wiring all 34 blind
would have been a large untested diff across modules I have not read.

**Design-hook note.** The tray cards carry a 3 px left accent whose colour
IS the state (cyan running, green done, red error/lost). The impeccable hook
flags that pattern generically; here it is the same device ContentEngineView
already uses for its hook panel, and the colour encodes data, so it stays.

**Evidence.** `scripts/v2/smoke-module-runs.mjs`, 29 checks: lifecycle,
failure without unhandled rejection, dismiss, the 40-event cap, persistence
and boot reconciliation, the three routes, and a grep that the two Content
Engine routes, the layout mount and the agentsRuntime export are really
there. `tsc --noEmit` clean; agentmail section F still passes.

**Not verified.** The tray in a browser: SSE reconnect, the poll fallback,
auto-dismiss timing. Needs the rebuilt app and one real generate.

**Rollback.** Revert the commit. `module-runs.json` under `~/.agentic-os`
is ignored by the old code.

## 2026-09-02 - S1: Voicebox is the voice engine

Yoshi retired Jarvis's Web Speech avenue and named the replacement: Voicebox,
the local AI vocal studio at 127.0.0.1:17493 (REST + HTTP MCP + STDIO MCP,
cloned profiles; one profile, "Yoshi", already exists). The brief was wider
than Jarvis - "drive the vocals of anything we make" - so the client is a
shared library, not a Jarvis feature.

**What landed.** `src/lib/voicebox.ts` (profiles, synthesize, transcribe,
health), a `provider: "voicebox"` branch in `/api/hermes/tts`, proxy routes
`/api/voicebox/profiles` and `/api/voicebox/transcribe`, a `voicebox` capture
provider in `useVoiceCapture` (MediaRecorder -> local Whisper, so the mic works
in Opera), settings `jarvis.voice.ttsProvider` + `voicebox.{url,profile,engine,
timeoutMs}` surfaced in the Jarvis gear (rule 16), and both Jarvis speakers
(`JarvisView`, dashboard `JarvisModule`) reading the provider from settings
instead of hardcoding `"auto"`. Default reply voice is now Voicebox.

**Three things the live server taught me before a line was written.**
`/generate` returns in 129 ms with `status: "generating"`; the work is
asynchronous. `/generate/{id}/status` is a Server-Sent Events stream, not a
JSON poll - a plain GET never returns, which is why my first probe hung for
two minutes. And `/audio/{id}` answers 500 until the clip exists. The client
therefore posts, follows the stream to a terminal state, then fetches audio
and takes the MIME type from Voicebox's own header rather than assuming wav.

**What I could not observe.** The terminal status names. The box reports
`gpu_available: false, backend pytorch/cpu`, and my one real generation was
still `loading_model` after four and a half minutes. So the client treats any
status outside the in-flight set (queued/pending/loading_model/generating/
processing/running) as terminal and lets `/audio` decide, and a timeout reads
"still loading_model after 120s" rather than "broken". That is a guess about
names, stated as one; the first completed generation will confirm or correct
it. Yoshi should check why Voicebox sees no GPU - this machine has one.

**Loopback is asserted in code.** The URL is a setting, but `voiceboxBase()`
refuses anything but 127.0.0.1/localhost/::1. Dictation and every spoken reply
pass through here; a pasted LAN address would otherwise ship both off-box
silently. Smoke section A proves a remote URL throws before any request.

**No fallback.** A down studio returns 502 with the studio's reason. The old
`"auto"` cascade (Kokoro -> ElevenLabs -> OpenAI) still exists and is still
selectable in the gear; it is no longer what Jarvis does unasked.

**A bug the smoke found in the client, not the studio.** The stall test hung
the process with "unsettled top-level await": `AbortSignal.timeout` uses an
unref'd timer in Node, so with nothing else pending the loop drained before
the deadline fired. In the server a live socket hides that. Replaced with an
`AbortController` on a referenced timer. The smoke asserts the stream was
actually aborted, not just that an error came back.

**Evidence.** `scripts/v2/smoke-voicebox.mjs`, 27 checks, offline (fetch is a
fake studio; section F asserts every URL was loopback and nothing hosted was
contacted). `tsc --noEmit` clean. `smoke-agentmail.mjs` section F still passes
over the new sibling. Not verified: audio actually playing in the browser, and
the MediaRecorder lane end to end - both need the rebuilt app and a mic.

**Follow-up the same morning: ElevenLabs stays, as a labelled backup
(`94942fb`, v2.13.0).** Yoshi's correction on reading the above: "don't
completely remove ElevenLabs, make it a backup if Voicebox fails." That is
not the silent cascade AGENTS.md bans; it is a fallback he chose. The
difference is now written down as rule 20: a fallback is allowed only when
the owner picked it in the module's settings and the reply labels it.
`jarvis.voice.ttsFallback` (default `elevenlabs`, or `none`) sits under the
Voicebox block in the gear; when the studio fails the route tries ElevenLabs
with the configured reply voice and returns `provider: "elevenlabs",
fellBackFrom: "voicebox", fallbackReason: <the studio's error>`. Both failing
returns one 502 naming both reasons. JarvisView logs a console warning when
the backup spoke.

The smoke had to grow a wall for this. `elevenTts()` reads the key from
`~/.hermes/profiles/<active>/.env` before the environment, via
`hermesPhone.ts`, which is one of Yoshi's dirty in-progress files and so was
not touched. Instead the smoke points `USERPROFILE`/`HOME` at its temp dir
before any import and supplies a smoke key by env; section G asserts the
fake ElevenLabs received exactly that key and that no `.hermes` directory
was ever created under the redirected home. 35 checks now.

Two other things from the same message: the "Yoshi" profile is his own
cloned voice, not Jarvis's, and he is making Jarvis one, so the gear's
"studio default (first profile)" is a placeholder until he picks it. And
the CPU backend was a missing CUDA download, on his side.

**A process slip, recorded so it is not repeated.** The docs edit for this
commit failed on a stale anchor, and the shell chain used a newline instead
of `&&`, so the bump and commit ran without the journal or roadmap change.
The commit-msg gate passed because AGENTS.md was staged. This entry is the
docs-only follow-up commit.

**Heard, 12:00 the same day (v2.13.1).** Yoshi installed the CUDA backend
(RTX 4070 Ti SUPER, 8.8 GB VRAM in use) and made two more profiles: "The
Sage" for the Oracle and "Alfred" for Jarvis. One real generation through
`voiceboxSynthesize` with Alfred produced a 4.16 s WAV (RIFF header, 199 KB),
sent to him. So the guesses in the entry above are now facts:

- The terminal status IS `completed`, carrying `duration`; `generating`
  repeats about once a second until then. Captured from the raw stream on the
  third clip, at the moment `/audio` flipped from 500 to 200. The in-flight
  set and the "anything else is terminal" rule were right; nothing to change.
- The first clip took 234 s and the next two about 120 s and 150 s. Not the
  client: Alfred has no default engine, so the studio used qwen 1.7B, which
  ran at roughly a minute per second of audio even on the GPU. The same
  profile on `chatterbox_turbo` produced 2.18 s of audio in 38 s. Set the
  engine on the profile in the studio (or `voicebox.engine` in the gear) and
  Jarvis stops taking two minutes to answer.
- A bug the studio handed me for free: the profile is stored as "Alfred "
  with a trailing space, and name matching was exact, so the first live call
  failed with `profile "Alfred" not found. Available: The Sage, Alfred ,
  Yoshi` - the space visible in the list. Matching now trims both sides; the
  smoke's second fixture carries a trailing space to pin it, 36 checks.

Pushed after this, at Yoshi's word: "commit and push everything after we
test the voice."

**Left for S8.** The Oracle still speaks ElevenLabs with its own hardcoded
"Hermes" voice id; Video's voiceover is untouched. Same client, next slice.

**Rollback.** Revert the commit. `settings.json` may carry `voicebox` and
`ttsProvider` keys the old code ignores. No migration, no data.

## 2026-09-02 - S0: the restart launcher stops lying about aborts

`agentos-restart.ps1` was already right: it verifies the kill and exits 1
rather than launching a second server next to a survivor (the 2026-08-29 split
brain). `Restart Agent OS.bat` threw that away - no `%errorlevel%` check, so
it printed "Done. The server runs in the background", opened the browser, and
closed the window after `timeout /t 5`. From the chair, an aborted restart and
a successful one looked identical for five seconds and then vanished. That is
the "exits silently" report.

**Fix.** Seven lines: on a non-zero exit, say the OLD server is still running
and nothing new was started, `pause`, `exit /b 1`. The abort message from the
ps1 stays on screen because the window no longer closes.

**Verified.** A throwaway `abort.ps1` with `exit 1` run via
`powershell -NoProfile -ExecutionPolicy Bypass -File` from a batch file:
`CAUGHT rc=1`. The propagation the fix relies on is real, not assumed. Not
verified: the actual abort path with a live survivor on 3737, because that
means holding the owner's port with a stray process.

**Also corrected.** AGENTS.md said the restart script starts Kokoro and the
start script does not. Both call `kokoro-start.ps1`; the claim was recorded
from the owner's description before either file had been read.

**Rollback.** Revert the commit; the previous launcher is at
`.exile/2026-09-02_042500/Restart Agent OS.bat`.

## 2026-09-02 - A roadmap that is regenerated, not retyped

Yoshi asked for a roadmap/checklist artifact updated alongside this journal
after every vertical slice. `ROADMAP.md` at the root is the source of truth
(the commit-msg hook already accepts that name as an engineering doc, so a
slice commit that touches it and this file passes the gate in one go), and
`scripts/roadmap-page.mjs` renders it to `~/.agentic-os/roadmap.html`, which
is the published Artifact. Two copies of a checklist drift; a generator does
not. The page stamps HEAD, `package.json`, and whether `.next/BUILD_ID` is
older than HEAD, because "is the running build current?" is the first
question every bug report here has to answer.

**Ordering is mine, and it is written down as a judgment.** S0 is the
launcher fix because it is the thing Yoshi runs most; S1 is Voicebox because
it is the "new avenue" that retires Jarvis voice; S2 is the vanishing-runs
registry gap. The Deal Desk logged-out gate from the bug list was missing
from the earlier handoff tasklist and is now S4.

**Two findings from finally reading the `.bat` launchers** (permission given
this session):

1. `Restart Agent OS.bat` never checks `%errorlevel%` after
   `agentos-restart.ps1`. The script aborts with `exit 1` when a process
   survives on 3737 (correctly - launching would recreate the 2026-08-29 split
   brain), but the batch file then prints "Done", opens the browser, and
   closes after `timeout /t 5`. That is the "exits silently" report: the red
   ABORTED block is on screen for five seconds. S0.
2. AGENTS.md says the restart script brings Kokoro up and the start script
   does not. Both call `kokoro-start.ps1`. Corrected in S0.

**Voicebox is live** at 127.0.0.1:17493 with one cloned profile ("Yoshi"),
verified with a GET on `/profiles` this session. It also exposes
`/transcribe` (whisper-turbo), which is a speech-to-text path that does not
depend on Opera's disabled Web Speech API - so the Jarvis mic loop can be
Voicebox end to end. That changes the S1 scope from "another TTS provider"
to "the voice engine".

**Cost.** The generator understands exactly the markdown ROADMAP.md uses
(checkbox slices with a bold `S<n>. Name.` prefix, numbered status lines,
plain bullets). Write a new construct and it renders as a paragraph. That is
deliberate: it is a 150-line script, not a markdown engine.

**Rollback.** Revert the commit. The previous four-line roadmap is at
`.exile/2026-09-02_041500/ROADMAP.md`.

## 2026-09-02 - Sidebar: two owner-named groups, and sections that fold

Tasklist item 7. The owner named the groups: "Artist's Corner" and "Agent
Toolbox".

**Membership is not array order.** A subagent mapped the existing structure and
the load-bearing detail is one the file already warns about: `sectionOf()` plus
three `Set`s decide the group, and a route missing from every set silently lands
in "Self" wherever it sits in `NAV`. So the regroup is two new Sets, not a
reordering.

Agent Toolbox sits directly under Agent Orchestration, which is what "up at the
top with Deal Desk" means in practice. Artist's Corner collects the make-things
modules. CLI Agents drops below both and starts collapsed, because the owner uses
one of its thirteen entries.

**A judgment call worth flagging:** removing the two new groups from "Self" left
Skills and Terminal as a two-item orphan. Both went into Agent Toolbox rather
than leaving a stub group. "Self" now renders empty and stays as the fallback, so
a route added to `NAV` and to no Set still appears rather than vanishing.

**The collapse had one trap.** A section's header is rendered inside its FIRST
item's wrapper, so filtering a collapsed section's items out would take the
header with them and the section would disappear entirely rather than fold. The
first item therefore renders header-only and the rest return null. Collapse is
disabled while customizing so drag-to-reorder still sees every row. State
persists to `agentos.sidebar.collapsed`, alongside the existing order and hidden
keys.

**Evidence.** `tsc --noEmit` clean, and a parser over the committed file (not
over my intent) reports all 48 NAV entries placed: Workspace 5, Agents 1, Agent
Orchestration 12, Agent Toolbox 11, Artist's Corner 6, CLI Agents 13, Self empty,
and zero routes listed in the new Sets that do not exist in NAV.

**Not verified in a browser.** The dev server was not answering while this was
written - see the note in the session; the check above is static.

**Rollback.** Revert this commit; the two Sets and the collapse state go with it,
and stale `agentos.sidebar.collapsed` in localStorage is ignored by the old code.

## 2026-09-01 - Jarvis could not see the browser module

Tasklist item 3, part C: "it seems like Jarvis can only see Mission Control".

A sonnet subagent traced it and I confirmed the diff firsthand. `mcp/server.ts`
registers five action sets before dispatching; `jarvis/tools.ts` registered three,
in both `get_actions` and `execute_action`. `ensureBrowserActions()` was the
missing one that matters: it is the only thing that re-syncs the browser module
to `settings.capability.browserEnabled`, so flipping that setting on without a
restart left Jarvis permanently blind to eighteen browser actions that every
other MCP caller could see. `ensureMemoryActions()` is also absent, but Jarvis
has its own `memory_search`/`memory_ingest` tools, so that one is left alone
pending a decision rather than assumed to be a bug.

Adding the call cannot widen a capability: the registration syncs to the setting,
and the handlers independently refuse with CAPABILITY_DISABLED.

**Honest limit.** This explains why the BROWSER module specifically was missing.
It does not, on its own, explain "only Mission Control" - `ensureCoreActions()`
registers plenty besides. Treat this as one confirmed gap closed, not as a
diagnosis of the whole symptom, until the owner reports what he sees now.

**My own bug, caught by a guard.** The first patch attempt anchored on the
call line at two different indents; the 8-space anchor is a substring of the
10-space one, so the uniqueness check counted two matches and refused to write.
Replaced with a line-based insert that matches on a regex and splices bottom-up.
The refusal is the reason this cost a minute instead of a corrupted file.

**Rollback.** Revert this commit; Jarvis returns to three action sets.

## 2026-09-01 - The app told a Windows owner to press a key he does not have

Tasklist item 1. Reported as three spots: a Command glyph on the palette, two
"100% on your mac" lines in Agent Kanban, one more in Local.

**It was 38.** A haiku subagent swept for it and found 25 glyph labels across 22
components; a follow-up grep found "your Mac" in 13 places across 6 files, three
of which the subagent had missed. Then a second grep, widened past
`src/components` and `src/app`, found three more in `src/lib/pageMeta.ts` - the
TopBar subtitles, which is where he would have seen them most often. Worth
remembering: the first sweep's scope was the thing that was wrong, not its
diligence, and verifying a subagent's counts against the tree is cheap.

**The shortcut was never broken.** `CommandPalette.tsx` already tested
`(e.metaKey || e.ctrlKey)`, so Ctrl+K always worked. Only the label lied. That
distinction decided the fix: this was a text bug, not a behaviour bug.

**MOD, not a hook.** `src/lib/modKey.ts` resolves the modifier once at module
load. A hook would be strictly more correct for someone opening the LAN address
from a Mac, but it would mean a hook call in 22 components, several of which use
these labels inside nested render helpers where a hook cannot legally go. On the
Windows host the constant is "Ctrl" on both the server and the client, so
hydration always matches and the value never changes; a Mac viewer gets the glyph
plus one hydration warning. Wrong modifier on the machine that actually runs this
beat a rules-of-hooks hazard across 22 files.

**What the preview caught.** The transform was run once in preview mode before
writing, and it was wrong twice. It turned `placeholder="..."` into
`placeholder=\`...\``, which is not legal JSX - an attribute value must be a
string or a braced expression. And a general "insert a plus if one is missing"
regex turned `CMD/Ctrl + Enter` into `{MOD}+ + Enter`. Both were replaced with
explicit rules: brace only when the literal is an attribute value (`out[open-1]
=== "="`), and name the two irregular sites rather than inferring them.

A third bug survived into the write pass and was caught by the script's own
residue assertion: `HermesStudio.tsx:170` carries TWO labels on one line, in a
ternary, and the single-span transform silently handled only the first. The
guard refused the file rather than half-writing it, and it was done by hand.
That assertion is the reason this is a footnote instead of a bug report.

**Evidence.** `tsc --noEmit` clean. Zero glyphs and zero "your Mac" left in
`src/`. All 22 importers verified to actually use `MOD` (2 of them twice).

**Not done here.** The four other investigations landed and are written up for
the owner, not yet built: Jarvis voice providers, the vanishing-run tray, legacy
memory backfill, sidebar regrouping.

**Rollback.** Revert this commit. Nothing else depends on `src/lib/modKey.ts`.

## 2026-09-01 - Deal Desk and Hire Engine finally write to memory

**The gap.** Memory V2 was never broken. `ingestFromModule` had 11 call sites
across 7 files and the queue drained fine; every table read zero because every
writer was a V2 module. The two surfaces carrying the most human judgment, Deal
Desk and Hire Engine, are V1 and predate the seam entirely, so nothing either of
them knew was ever recallable. Yoshi's read of it was right and the diagnosis was
a wiring gap, not a bug.

**What earns an episode.** A judgment status (approved, denied, sent, parked)
with the note attached, a generated proposal or outreach pitch, and a Q&A answer.
The shared seam is `src/lib/deskMemory.ts`; both desks are structurally identical
so they share it.

**What deliberately does not, and why.** Triage motion - new, reviewing,
researching, dismissed - because refill auto-dismisses in bulk and recording that
buries the signal under the noise it exists to filter. `ready`, because it is a
staging step between approved and sent and both ends are already recorded.
Briefs, because `brief-batch` runs one pass per un-briefed card and a fresh
248-card board would enqueue 248 near-identical episodes on one click; a brief is
also regenerable from the listing, which a decision is not. That last one is a
judgment call rather than an obvious truth, and it is one line to reverse.

**Hooked in the routes, not the store.** `setEditedPitch` is called by the drawer
on every hand edit as well as by the generator, so hooking the store would have
recorded a keystroke save as a fresh pitch. The routes are also where the deal is
already in hand. `getDeal` is called only after the judgment check passes, so
routine triage does not pay for a board read.

**Three things this shook out.**

1. *The smoke went to the network.* Enqueuing woke the queue's drain loop, which
   runs `while (ingestEnabled())` against settings that default to true, and it
   made live calls to ollama.com with whatever credentials were on the box. That
   breaks the offline rule in AGENTS.md outright. I only saw it because a failing
   run printed more than the `grep -E "^(PASS|FAIL)"` I had been filtering
   through - the earlier green runs had been doing it silently. The smoke now
   writes `memory.ingestEnabled: false` before importing anything. Lesson worth
   keeping: filtering smoke output to the assertion lines hides everything the
   smoke does on the way.

2. *The 20-char episode floor is unreachable.* Every body is wrapped in
   `Deal Desk: ... "title"`, which clears 20 characters on its own, so
   `MIN_EPISODE_CHARS` cannot fire from any entry point. The real gates are the
   empty-content checks. Left in place as a backstop, but annotated at the
   constant and pinned by smoke section E, because a guard that looks like a
   safety net and is not is worse than no guard.

3. *A board record with no pitch is invisible.* `listDeals` matches board records
   against `pitches.json` by URL and skips the unmatched, so my first route
   fixture yielded `listDeals -> 0` and `getDeal -> NULL`, and section G failed
   with the wiring perfectly correct. Not a test artifact: an unpitched Upwork
   lead has no card, so it cannot be decided on or remembered. Documented in
   `docs/modules/deal-desk.md`.

**Follow-up the same day: briefs, but only on approval.** Yoshi reversed the
brief exclusion with a sharper rule than either of the two I had weighed - not
every brief, and not none, but the ones attached to a lead we actually committed
to. That keeps the whole reason for the exclusion intact, since brief-batch never
triggers it, while keeping the assessment for the leads where it matters. Added
`recordDeskBrief`, called from both action routes when the status is approved.
Smoke section H covers it: the four brief fields present, denying records the
decision without the brief, and an approved-but-never-briefed lead records
nothing. 43 checks now.

**Evidence.** `scripts/v2/smoke-desk-memory.mjs`, 43 checks. Section G drives the
real `/api/deals/action` handler against a fixture board and asserts that
`reviewing` records nothing while `approved` records an episode carrying the
listing title and the operator's existing note as the reason - tsc proves the
imports resolve, only this proves the hook is reached. `smoke-deal-desk.mjs` and
`smoke-agentmail.mjs` (whose section F greps every sibling smoke for isolation)
both still pass.

**What is not proven.** The end-to-end path from a click in the running app
through to a settled episode. That needs the dev server and a live model, and it
will confirm itself the first time a card is approved.

**Rollback.** Revert this commit. Nothing migrates and nothing is destructive:
the desks write into the ingestion queue and ignore failures, so removing the
hooks leaves both stores exactly as they were.

## 2026-09-01 - Deal Desk state is now rotated, not overwritten

**How this started.** Yoshi asked whether wiring Deal Desk into memory would
erase the proposals he had drafted but not sent. The answer was no, and checking
it properly is what found the actual hazard: `upwork-desk.json` had exactly one
writer, `patch()`, which read the whole store, replaced one key, and called
`writeFile` straight over the canonical path. 121 KB rewritten in place on every
status change, every note, every saved proposal - 145 deals and 5 drafted
proposals at the time of writing. A crash or a power cut mid-write left the file
truncated, and `readJson`'s `catch { return fallback }` turned that into `{}`.
The board would have rendered empty rather than broken, and the next write would
have persisted the empty version over the wreckage.

**The design is Yoshi's.** Write the new state to a new file, rename the current
live file aside, then rename the new one into the live name. The live body is
never edited in place; it only ever changes by rename.

I diverged in one place. He described reusing the retired file as next round's
staging target. I give staging a fresh nonce instead, so every body is written
exactly once, and retire to a fixed `_prev` name. Same two files at rest, same
three steps, but nothing is ever overwritten - retiring is a rename, which swaps
the directory entry and unlinks the old inode.

**What I got wrong on the way.** The first version retired the current live file
unconditionally. So when live was corrupt, the recovery write moved the damaged
file over `_prev` - destroying the only good copy at the exact moment it was the
only good copy. The smoke caught it by crashing in section D while trying to read
a `_prev` full of truncated JSON. Review had not caught it; I had read that code
three times. A damaged live file is now parked as `upwork-desk_corrupt_<stamp>.json`,
never deleted, and `_prev` is left alone.

Second thing I got wrong: preferring the newest orphaned staging file
unconditionally. An orphan is normally the newest state, an interrupted write
that never got promoted, which is why it wins. But a staging file left by a crash
months ago is older data, and preferring it on existence alone would quietly roll
the board back. It now has to be newer than `_prev` by mtime.

**Also fixed, separately.** `patch()` had no mutex, so approving one card while
another saved a proposal had both reads see the same store and the slower write
drop the other's change. Rotation does nothing for that - it makes a single write
crash-safe, not two concurrent read-modify-writes safe. Same `withLock` shape as
`hermesGoals.ts`.

**The guarantee, and its limit.** Recovery costs at most one generation. `_prev`
deliberately stops advancing while live keeps arriving damaged, so back-to-back
corruptions lose the writes in between - section F of the smoke stages exactly
that and asserts the honest outcome rather than papering over it. A single
corruption followed by any healthy write costs one generation, because that
healthy live then becomes `_prev`.

**Rule 19.** `AGENTIC_OS_DESK` added, because there was no way to redirect this
store and a smoke would otherwise have read and rewritten the owner's live board.
`UPWORK_LEADS_DIR` already existed and is redirected too.

**Evidence.** `scripts/v2/smoke-deal-desk.mjs`, 24 checks, all passing: rotation
and promotion, `_prev` holding the previous body byte for byte, rename over an
existing `_prev` working on Windows, recovery from a corrupt live file, from a
missing one, from an interrupted write, an ancient orphan being ignored, and
three concurrent writes all surviving. Separately, against a copy of the real
board: 145 deals and 5 drafts in, 146 deals and 5 drafts out, `_prev` written,
zero stray staging files. The real file was never opened for writing.

**Rollback.** Revert this commit. The previous writer is also at
`.exile/2026-09-01_190049/src/lib/upworkDesk.ts`. Existing `upwork-desk.json`
files need no migration: the first rotated write simply creates `_prev`.

## 2026-09-01 - Four modules were writing to a vault that does not exist

**Symptom.** A Loop run finished, its modal closed, and there was nowhere to
read what happened.

**Cause.** `loop/run/route.ts` hardcoded its log directory to
`~/Documents/Obsidian Vault/Agentic OS/Loops`. That path does not exist on this
machine - the configured `vaultRoot` is `C:\Users\Yoshi\.agentic-os\agentos` and
was ignored. `mkdir -p` cheerfully created the phantom folder, and the write sat
inside `catch { /* vault optional */ }`, so it failed silently every time.

Sweeping for the pattern found three more, all in notebooklm (ask, library,
artifact/download). All four now resolve through `AGENTIC_DIR`, with a
`~/.agentic-os/` fallback rather than the RELATIVE path that `path.join("")`
yields when no vault is set. `config.ts:180` still names the Obsidian path and
is left alone: it is the legitimate default when nothing is configured.

**Two Loop fixes that had been conflated.** The run log now writes on EVERY run,
pass or fail - a run the judge rejected is exactly the one worth reading. The
gallery keeps its `if (passed)` guard. Both had been decided by the same
condition, and they are different questions: one is a showcase, the other is the
only record. A failed log write is now emitted on the stream (`logfail`) instead
of swallowed, because a run whose log did not write looks identical to one that
did until you go looking.

**A correction.** I first reported that vault writes "stopped on 2026-08-28".
Wrong. The distribution is Jun 30, Jul 24-30, Aug 8, Aug 28 - 29 files over
three months. It has always been sparse, because those writers fire per Pipeline
item or per explicit save. Aug 28 was the last occasional write, not a cliff.
There was no regression to chase, and chasing one would have wasted the time.

**The finding that actually matters, not yet fixed.** Memory V2 is not broken:
`ingestFromModule` has 11 call sites, boot starts the queue, `ingestEnabled` is
true. Every table reads 0 rows because nothing has been ingested. All seven
files that feed memory are V2 modules (tasks chat, anynotes, integrations,
jarvis brain + tools, pages butler, tasks engine). **Zero V1 modules write
episodes** - so Deal Desk's triaged opportunities and the Hire Engine's leads,
which carry more judgment than anything else here, have never entered memory.
A wiring gap rather than a bug, and the next thing to close.

## 2026-09-01 - Docs stop drifting: a commit-msg gate, and a narrowed ASCII hook

**The failure this answers.** PROGRESS.md was last touched 2026-08-28 and still
presented Phase 0 as the frontier while the repo had shipped v2.0.0 through
v2.4.0 and PRs #11 to #18. This journal was in better shape but had zero
coverage of the identity/containment work, the spend ceiling, or either PR.
A plan doc that is never revised does not become "slightly old"; it becomes
actively misleading, because the next reader trusts it.

**Decision: enforce at commit time, not by reminder.** `.githooks/commit-msg`
blocks a commit that changes `src/` or `scripts/` without staging one of
DEV-JOURNAL / PROGRESS / SPEC-* / ROADMAP / README / AGENTS. A reminder would
not have worked - the standing rule to keep this file already existed and was
ignored for an entire session.

Chose `commit-msg` over `pre-commit` deliberately: it can read the message, so
a commit that genuinely warrants no doc change says `Docs: n/a - <reason>` and
leaves that in the history. `--no-verify` leaves no trace, which is the point.
The trailer is rejected without a reason, so it cannot decay into a reflex.

Installed via `core.hooksPath .githooks` (tracked; `.git/hooks` protects
exactly one working copy). `scripts/install-hooks.sh` for fresh clones.

Verified all four paths by hand: code without a doc blocks; bare `Docs: n/a`
rejects; `Docs: n/a - reason` allows; code plus a staged doc allows.

**The ASCII hook got narrowed, and the measurement is why.** The first design
scanned whole files for non-ASCII. Measured against this repo that fires on
752/914 `.ts`, 301/384 `.tsx` and 75/79 `.mjs` - roughly 82% of edits - because
box-drawing in smoke headers and em dashes in comments are everywhere and
harmless. A warning at that rate is wallpaper.

`.claude/hooks/check-console-ascii.ps1` checks only lines that EMIT (console.log,
print, Write-Host, echo). That is the actual cp1252 failure; a comment never
reaches stdout. It also handles `CLAUDE_FILE_PATHS` being plural, which the
one-liner version could not - `Get-Content -Raw` on a multi-path value throws
instead of checking.

It immediately flagged real hits in my own smoke files (`console.log("
-- SS A --")`
style section headers), which will mojibake on a cp1252 console. Left as-is for
now, noted here rather than silently fixed.

**Cost, stated plainly.** Every code commit now needs a doc touched or an
explicit reason. That is friction by design, and it will occasionally be
annoying on a one-line fix. The alternative was the state this entry opens with.

**Correction.** I exiled DEV-JOURNAL.md and ROADMAP.md during the root cleanup.
The journal was not stale - its newest entry was that same day. I flagged it as
significant at the time and still batched it with 17 genuinely dead upstream
docs. Both restored here.

## 2026-09-01 - GitHub PR quality and approval gates

**Decision:** `local-main` now has two additive GitHub Actions gates.

- `PR quality / required-ci` uses Node 24, `npm ci`, `npm run version:check`,
  `npx tsc --noEmit`, and every offline `scripts/v2/smoke-*.mjs` file. It has
  read-only repository permission and is deliberately independent of the dev
  server, credentials, network services, and generated build output.
- `PR approval gate / approval-gate` requires a deliberate `merge:approved`
  label, removes it for every new commit, and blocks while the latest review
  state for a non-author reviewer is `CHANGES_REQUESTED`. Its only write
  permission lives on the label-reset job; the review check itself is read-only
  and never checks out pull-request code on `pull_request_target`.

**Hosting gate:** verified with GitHub's API on 2026-09-01: the private
repository's current plan returns HTTP 403 for rulesets and branch protection.
The checks report their result but cannot yet be mandatory in GitHub's merge
UI. `scripts/github/apply-merge-protection.mjs` is the fail-loud, repeatable
activation step after making the repo public or moving to a plan that supports
private branch protection; it requires both workflow names, resolved
conversations, stale-review dismissal, one non-author approval, and no force
push/deletion. Full contract: `_design/github-merge-gates.md`.

**Rollback:** remove `.github/workflows/pr-quality.yml` and
`.github/workflows/pr-approval-gate.yml` to stop the reported gates. If remote
protection has later been applied, remove or revise it in GitHub before merging
without the checks. No application state or production process changed.

**Verified:** YAML parsed with the repository's `js-yaml`; `node --check
scripts/github/apply-merge-protection.mjs`; `npm run version:check`; `npx tsc
--noEmit`; and `git diff --check`.

---

## 2026-08-28 - Agents: a run can ask the user a question (ask-user park + reply)
Found in live testing: an agent asked clarifying questions about scope and they went nowhere. Root cause was structural, not a missing feature - `agentsRuntime.ts` pushed assistant text (question included) as `{kind:"text"}` and stopped there, and the `waiting` status was only reachable from `queueApproval`, i.e. from a TOOL requesting permission. A sentence could never trip it, so the run carried on and guessed.

**Fix** - questions attach to the other place a run can pause: the per-turn result.
- **Detection is marker-first.** Every run's rendered system text now carries `ASK_USER_PROTOCOL`, instructing the agent to end its turn with `[[ASK-USER]] <question>`. `detectQuestion()` reads that marker; a punctuation fallback (last non-empty line ends in "?", <=300 chars) exists but ships **default OFF** - agent reports close on rhetorical questions all the time, and a false positive would park a *finished* run instead of completing it.
- **Park** - `parkRunOnQuestion()` deliberately mirrors `queueApproval`: same `approvals.json` queue, same `meta.status = "waiting"`, same two `notifyStatus()` transition sites. So the hero band goes amber with no second code path, and `getStatusSnapshot()` remains the single derivation (CONVENTIONS section 6 - nothing re-derived).
- **Reply** - `answerQuestion()` resolves the promise the park is awaiting *inside* `onTurnResult`, which is awaited inside `consumeRunStream`'s `for await`. The SDK stream is suspended mid-iteration while the human types, so the answer is pushed into the same `query()` session's input queue and the agent continues with context intact.
- **Never a silent completion** - an unanswered question (skip / timeout / kill) sets `r.stranded`, and the run finalizes `error` with the question in the error text, never `done`. No curator pass fires on it.
- Both lanes: the SDK path and the cli/ollama provider path park identically, off the one `renderedSystem` render site (rule 17).
- Settings gear (rule 16): `agents.askUser.{enabled, heuristic, timeoutMin}` - all three exposed in AgentsSettings, nothing config-file-only.

**Load-bearing behavior change:** `execute()` no longer eagerly closes the input queue for plain one-shot runs (`if (!controller) queue.close()` is gone) - a question can arrive on turn 1, and a closed queue leaves nothing to answer into. The turn handler now owns every close.

**Verified:** `scripts/v2/smoke-agents-questions.mjs` 51/51 - drives the REAL turn path (`consumeRunStream` + `makeTurnResultHandler` + `makeInputQueue`) with a synthetic message stream, no SDK/network/model. Covers detection, park->waiting->reply->done, skip/timeout/kill all landing as `error`, the route's answer verb, and the wiring greps. Regressions green: smoke-approvals, smoke-agents-status, smoke-agents-forge, smoke-harnesses, smoke-agents-ui (its `agents.requireTestRun` assertion was a whitespace-exact grep that my multi-line defaults block broke - relaxed to assert the value; the hard default is unchanged, confirmed `{"requireTestRun":true,...}` at runtime). `tsc --noEmit` clean.

**NOT yet verified live (the one open item):** that the SDK emits a per-turn `result` while the input queue is still open on a *plain* run. The shipped loop harness relies on exactly this, but its live leg was explicitly out of scope for the Phase 7 smokes, so it is asserted-by-precedent, not observed. First live plain run should be watched for a hang; rollback is one line - restore `if (!controller) queue.close();` in `execute()`, which reverts to today's behavior at the cost of the feature.

Files: `src/lib/agentsRuntime.ts`, `src/lib/agentsTypes.ts`, `src/lib/settings.ts`, `src/app/api/agents/approvals/route.ts`, `src/components/AgentsView.tsx`, `src/components/v2/agents/{AgentsPageV2,AgentsSettings}.tsx`, `src/components/v2/agents/tabs/ApprovalsTab.tsx`, `scripts/v2/{smoke-agents-questions.mjs,smoke-agents-ui.mjs}`. Uncommitted - stage this explicit list only (rule 22; the tree carries 50+ unrelated dirty files).

---

## 2026-08-27 · V2 rebuild: Phases 3–7 built in one run (Jarvis · WebMCP · Integrations · Homepage · Browser) + adversarial review
The Ultraplan build continued autonomously (harness loop: background agent per chunk → orchestrator re-runs smokes + tsc → explicit-file commit). Fine-grained per-chunk records + deltas live in _design/agentos-v2/ultraplan/PROGRESS.md — this entry is the day-level index.
- **Phase 3 (PR #5, feat/v2-phase3-jarvis):** F13 global chatbox (voice never auto-sends) · WebMCP engine + /webmcp builder · Jarvis brain (warm Claude-SDK session, persona+page context, conversations migration 031, §9.4 taint gate) · CR.1 legacy repoint. NOTE: pre-existing untracked JarvisModule.tsx + api/jarvis/brain/route.ts entered git here.
- **Phase 4 (PR #6, feat/v2-phase4-webmcp):** D5 exporter (client mode \, zero secret embedding) + spec_json 032 + Spec tab · Human-Gate approvals (033) · LLM-filtered getActions · conversations drawer.
- **Phase 5 (PR #7, feat/v2-phase5-integrations):** G2 runtime (040, AES-256-GCM store, OAuth PKCE, watermark sync → memory label integration:<slug>) · 7 connectors (gmail 20 tools / gcal 8 / notion 16 / github / slack HMAC / buzz) + /integrations page · G4 meta-tools on /api/mcp + brain · G5 automations (no-eval) + attention store (041/042) · B7 skills-as-policies (022). Deps: googleapis, google-auth-library ^10, turndown.
- **Phase 6 (PR #8, feat/v2-phase6-home):** widget framework + honest {available:false} data layer · AttentionHero · Overview rebuilt on the grid (Yoshi's uncommitted layout preserved as default via legacy-* widgets; TodoPanel.tsx entered git) · edit-mode DnD · calendar widget. 
- **Phase 7 (in flight, feat/v2-phase7-browser-agents):** E browser backend committed (Playwright manager, 18 tools, allowlists, capability slot, migration 050; deps playwright+ws, Chromium 151 installed) · chunk 2 browser live-view committed `d251621` (CDP ws bridge :3738, HMAC tickets, /browser page) · 13-item hardening backlog committed `e0f056f` (migrations 003/034/043 — taint fail-closed on provenance, watermark tail-loss + dedupe keys, approval version pinning, HMAC session tokens w/ 7-day legacy grace, durable webhook inbox, memory-queue leases; record in HARDENING-2026-08-27.md) · chunk 3 agents F1-F3 committed `6ee83ae` (migration 051 harnesses + agent_status_events, getStatusSnapshot as the single band derivation, SSE status route, renderHarness injection, lifecycle trigger gating, §9.5 browser_evaluate approval) · chunk 4 agents page UI committed `88e3461` (Forge wizard + Draft-with-AI via cliComplete, harness library, AgentsHero SSE + cards grid, /agents/[id] detail tabs with ?tab= deep links, telemetry route; checkDeployGuard consolidated so the §11 gate has ONE implementation, both modes behind agents.requireTestRun). **Phase 7 COMPLETE — PR #9 open** against feat/v2-phase6-home. Gate re-run independently at each chunk: tsc clean, agents-forge 36 · agents-ui 77 · agents-status 35 · harnesses 54 · hardening 69 · tasks 78 · approvals 41, scripts/ zero deletions.
- **Phase 8 (COMPLETE, same branch — PR #9 retitled to cover 7+8; splitting it would need a force-push):** AnyNotes I committed `f82624b` (migration 060, capture engine w/ oEmbed+readability, routes, memory ingest, @jarvis reply worker; deps @mozilla/readability+linkedom) + `0f00c4f` (/anynotes page, thread, gear, widget, attention mapping). Newsletter K committed `9ec31e7` (migration 061, addy alias client, Gmail sync, extraction+dedupe, jobs; shared extractJsonObj lifted to v2/json.ts) + `7ee3728` (edition builder, subscriptions, /newsletter, widget). Three agent spec-refusals, all upheld: pending-ingest.jsonl (CONVENTIONS §2 deletes it by name), the "+20s" watermark (= hardening item 7's mail-loss bug), and the edition POST force/idempotent contradiction (§5 vs K4.1 verify — §5 needs correcting). **Real bug found via a "flaky" check:** listReplies tiebroke on the random shortId(), so replies sharing a millisecond shuffled ~25% of runs — Jarvis's answer could render above the question; now ORDER BY created_at, rowid, and the check burst-inserts 8 replies and asserts they actually collided. NOTE: `src/lib/marketing.ts` (Yoshi's UNTRACKED WIP) was edited by chunk 3 to import the shared json helper — deliberately NOT staged; it now depends on the committed v2/json.ts.
- **Independent review (Codex + Antigravity, both headless CLIs):** 25+10 findings, 10 confirmed+fixed (commit 'fix(v2): independent-review fixes'): gmail attachment arbitrary-write P0, §9.4 taint lost on session rebuild, SDK native Bash/Write/Edit ungated, live-read taint, approval double-execute race, scheduler run_at clobber, sync tx, untracked spawnEnv.ts (clean checkouts of #5–#8 were unbuildable), timing-safe compares, source-spoof hardening. 4 refuted. 13-item hardening backlog agent in flight → HARDENING-2026-08-27.md.
- **Incident:** tracked scripts/ tree (53 smokes) deleted from working tree mid-parallel-agents, no exile; restored via git restore, zero loss; hardening agent warned + integrity check mandated.
- **Env notes:** Ollama Cloud account hit session quota (429 glm-5.2:cloud) — memory-ingest legs degraded until reset; gemini CLI is dead (Google: migrate to Antigravity), agy works with --dangerously-skip-permissions BEFORE -p.
**Rollback:** each phase is its own stacked branch/PR (#5→#8 + phase-7 branch) — revert = drop the branch from the stack. DB migrations are forward-only (022,031-033,040-042,050) on ~/.agentic-os/agentos.db; snapshot exists via the nightly db.backup job (keep-14, .exile). New deps removable via package.json revert + npm i. Chromium: npx playwright uninstall.
**Verified:** every chunk gated on its smoke suite + regressions + tsc (records in PROGRESS.md); review fixes re-verified incl. brain taint legs + SDK live leg.

---

## 2026-07-27 · Hire Engine brought to Deal Desk parity
User: "it is supposed to mimic the Deal Desk" — it was a flat card grid with none of the review tooling. Changes:
- **Kanban board** — `HIRE_COLUMNS` (New / Researching / Approved / Sent + trailing Parked) in `lib/hireDesk.ts`; `HireEngine.tsx` rebuilt as drag-and-drop columns like `DealDesk.tsx`. Machine strip kept as the filter above the board.
- **F/E/W scoring** — `deriveScores()` maps the scrape's coverage/budget/commitment onto Deal-Desk axes: Fit = coverage (capped 3 when firmo says company too large), Ease = machine built? (9/5, −1 part-time), Win = salary signal (±firmo fit). Composite reweighted 0.4E+0.4W+0.2F. Displayed as chips on card + drawer.
- **Brief** — new `POST /api/hire/brief` (mirrors deals/brief): summary/why/approach/crashCourse via `claude -p`, stored in `hire-state.json` under `brief`. Drawer shows amber Project Summary box, Approach, Crash Course sections + "Generate brief" CTA when missing.
- **Ask AI** — new `POST /api/hire/ask` (mirrors deals/ask), answers persisted per lead (`answers[]`, last 20), Q&A section in drawer.
- **Notes** — drawer textarea wired to existing `notes` action (was API-only, no UI).
- **Pitch edits persist** — new `action:"pitch"` in `/api/hire/action`; the drawer textarea previously dropped hand edits on close.
- **Enriched cue** — cards show cyan Building2 chip (headcount) when firmo present, red `enrich ✗` on lookup failure, amber `brief` sparkle when analysed, purple `pitched`.
- **Description** — now run through `formatDescription()` (shared from upworkDesk) so postings render with bullets/sections instead of one flat line.
- Sidebar move (Self → Agent Orchestration) was already at HEAD (60e66de); needs only a rebuild.
**Rollback:** revert `src/lib/hireDesk.ts`, `src/components/HireEngine.tsx`, `src/app/api/hire/action/route.ts`; exile `src/app/api/hire/brief/`, `src/app/api/hire/ask/`. State file gains `brief`/`answers` keys — ignored by old code, safe.
**Verified:** `npx tsc --noEmit` clean; all hireDesk consumers are inside the hire module (grep).

---

## 2026-07-25 · Staleness sweep — the same 4 bug classes, repo-wide
Ran a grep pass for every failure mode found in Jarvis/Loop/Deal Desk, to see what else is stale before the rebuild. **Everything below is the SAME four classes repeated** — this is a macOS-authored codebase running on Windows, and each module that was never exercised here still carries the original assumptions.

### CLASS A — macOS-only commands/paths (breaks outright on Windows)
| Where | What | Verdict |
|---|---|---|
| `api/hermes/realtime/open/route.ts:25` | spawns macOS `open` | **BROKEN** — identical to the Jarvis bug just fixed (this is Realtime voice's "open a site" tool) |
| `api/seo/research/route.ts:18` | `const PY = "/usr/bin/python3"` absolute | **BROKEN** — GSC keyword research can't run |
| `api/thumbnails/generate/route.ts:86` | `exec("python3")` | **LIKELY BROKEN** — Windows has `python`/`py`, not `python3` |
| `lib/pipeline.ts:442` | `spawn("python3", …)` | **LIKELY BROKEN** |
| `lib/outreach.ts:30` | `~/.browser-use-env/bin/python3` (POSIX venv layout) | **LIKELY BROKEN** — Windows venvs use `Scripts/python.exe` |
| `lib/hermesPhone.ts:70,92,111,117,120` | `pgrep`/`pkill`/`brew install` | **BROKEN** (module is unmounted, so latent) |
| `api/openclaw/studio/stt/route.ts:19` | ffmpeg only at Homebrew paths, bare `ffmpeg` fallback | degraded — works only if ffmpeg is on PATH |
| **PATH corruption** — `codex/goals:58`, `hermes/goals:67`, `opendesign/control:17`, `seo/deploy:18`, `thumbnails/generate:48`, `video/hyperframes/render:62`, `claudeArtifacts.ts:19` | colon-join Homebrew dirs onto `process.env.PATH` | **BROKEN on Windows** — `;`-delimited PATH gets a bogus POSIX blob glued onto the first entry (the exact anti-pattern `runner.ts` documents avoiding) |

### CLASS B — hardcoded local model that isn't pulled
`freeclaude/build:32`, `video/auto/script:82`, `lib/localModel.ts:8`, `lib/localOllama.ts:6` all default to `xentriom/gemma-4-12B-coder-…`, which **isn't installed** → Ollama 404s. Same bug fixed in `loopEngine` (now queries `/api/tags`). Affects FreeClaude build, Video script-gen, and anything via `localModel`/`localOllama`. Also `local-hermes/run` mentions `llama3.1:8b` while its UI says "Gemma-4 12B Coder".

### CLASS C — MiniMax wired in (user does NOT have it; "shouldn't be wired into anything")
Still referenced in **20 files**. Highest-impact: **`lib/agentRoom.ts`** — that's the **Agent Council chat the user explicitly wants kept**. Also `api/hermes/talk` (Talk tab), `HermesStudio`, `VideoDirector/Studio/Settings`, `PipelineSettings`, `ConfigMenu`, `TokenUsage`, `loop/run`.

### CLASS D — macOS copy (the "system lies about itself" theme)
"your Mac" / "on my Mac" in `AgentKanban` (×3), `LocalHermesEngine` (×2), `LocalView` (×2), `JarvisView:817-818` ("Building it on your Mac, sir…"), plus `realtime/session` tool descriptions telling the model to open "macOS app name (e.g. 'Notes', 'Safari')". Cosmetic, but it's what steered Jarvis into the dead path.

### CLASS E — OpenRouter-only, no fallback (key invalid here)
`fusion/chat` (P0 dead), `freeclaude/build` (N2 engine), `lib/agentRoom.ts`, `lib/leads.ts`. `hermesJarvis` + `loopEngine` now have CLI fallbacks; these don't.

**Takeaway:** nothing new in kind — the audit's "macOS→Windows bug class" is broader than the 5 P0s it named. Fixing it module-by-module is whack-a-mole; the durable fix is a shared cross-platform helper set (`launchTarget()`, `pythonBin()`, `augmentPath()`, `resolveLocalModel()`) that these call instead of each re-implementing POSIX assumptions.

---

## 2026-07-23 · Session 4 — Jarvis rewired to a stack that actually exists (DONE)
**Goal:** get Jarvis working, per the plan: drop the dead OpenAI Realtime default → mic → speech-to-text → an LLM we have → **ElevenLabs TTS**. User confirmed ElevenLabs + hermes CLI both work.

### What was broken (verified first-hand)
- `JarvisView.tsx:645` — **Realtime defaulted ON**, and it needs an `OPENAI_API_KEY` this box doesn't have. Worse, while ON it **disabled every working path**: tap-to-talk (`coreTap` early-returns), Live, and the wake word are all `disabled={realtime}`. So the default experience was: nothing works.
- `JarvisView.tsx:1124` — hardcoded **"Realtime voice is live below — just talk."** It reported the *toggle*, never the connection. Pure UI lie.
- `JarvisView.tsx:768` — `speak()` hardcoded `provider: "openai"`, so TTS hit the one provider without a key, even though `/api/hermes/tts` already supports ElevenLabs (`route.ts:111`).
- `VOICES` were OpenAI voice names (`ash`/`onyx`/`ballad`) — meaningless to ElevenLabs, whose ids are long alphanumerics.
- `hermesJarvis.ts complete()` — the engine behind the **default "auto" mode** tried MiniMax OAuth → OpenRouter and then **gave up**. Both are unavailable here, so Jarvis's normal chat path returned an error string.

### Fixes
| Area | Change |
|---|---|
| Voice out | `speak()` now uses **`provider:"elevenlabs"`**; default voice = Daniel (`onwK4e9ZLuTAKqWW03F9`, British — fits the butler) |
| Voice picker | fetches the **real ElevenLabs voice list** from `/api/video/voices` (same source the Oracle uses), falling back to the built-in default if unreachable |
| Realtime | **defaults OFF** — so tap-to-talk / Live / wake word (browser speech-recognition, no key needed) work out of the box. Toggle still there if a key is ever added; tooltip now says it needs one |
| Status line | no longer claims "voice is live"; defers to the Realtime panel's own state |
| Chat engine | `complete()` gained a **local CLI fallback** (`claude -p`, one-shot, on the user's subscription) when MiniMax **and** OpenRouter are unavailable — including when OpenRouter is reachable but returns an empty/bad-key reply |

**Result:** the working stack is now the default — browser STT → Jarvis (MiniMax → OpenRouter → **Claude CLI**) → **ElevenLabs** voice. No OpenAI key anywhere in the path.

**Honest caveat:** the CLI fallback is a *correctness* fix, not a speed one — `claude -p` is slower than a hosted API call, so "fast" mode won't feel fast when it's on the fallback. It answers instead of erroring, which is the point. (Agent mode already used the hermes CLI and was the only path that worked before.)

**Verification:** `tsc --noEmit` → 0 errors; no OpenAI voice names or `provider:"openai"` left in Jarvis. **Not runtime-tested** — needs a rebuild + a real mic session to confirm end-to-end.

---

## 2026-07-23 · Session 3 — Loop engine repair (DONE, commit `be17294`)
**Goal:** fix the autonomous Loop engine (Builder → Judge → retry). It's the feature that works unsupervised, so its bugs cost real time + tokens.

### Known issues going in (from the audit, to be verified first-hand)
| # | Issue | Where (claimed) | Impact |
|---|---|---|---|
| L1 | Stop/abort never reaches the spawned CLI child | `loopEngine.cliComplete` → `runner.run` | pressing Stop burns the full timeout (up to 600s) of tokens |
| L2 | Prompt args >32k chars silently dropped | `runner.ts` MAX_ARG_LEN filter | loop spins uselessly after iteration 1 (artifact is embedded in the prompt) |
| L3 | `"false"` string coerced to a passing verdict | `loopEngine.verdict` `!!v.pass` | a failing build can be recorded as passed |
| L4 | Judge silently falls back to local Ollama | `loopEngine.verdict` catch | you don't know which model actually graded it (Rule 11 violation) |
| L5 | Judge error cause swallowed | same catch | "no parseable verdict" instead of the real reason |
| L6 | Hardcoded gemma model + ignores configured Ollama URL | `loopEngine` ollama judge | local judge 404s (only glm-5.2:cloud is installed) |
| L7 | Browser render-check is macOS-only (silently no-ops) | `api/loop/run/route.ts` findChrome | "runs clean" reported without ever checking |
| L8 | UI duplicates the WORKERS/JUDGES lists (diverged from engine) | `LoopView.tsx` | picker doesn't match what the server supports |

### Key finding first: **the Loop page has never been run.**
No `~/.agentic-os/loop` directory exists — the engine has never saved a build. So these bugs were costing *nothing* (I had earlier claimed it was "wasting API budget right now" — that was wrong and is corrected here). The value of this work is that the feature will **work the first time it's used**, instead of spinning silently and misreporting grades.

### What was verified + fixed
| # | Verified? | Fix |
|---|---|---|
| L1 abort ignored | ✅ `cliComplete` took `opts.signal` (loopEngine:19) but never passed it to `run()` (:31); `run()` had no signal support at all | `run()` now accepts `signal`, kills on abort, and reports `[stopped by user]`. Signal threaded through `cliComplete`. |
| L2 >32k args dropped | ✅ `safeArg` returned null for >32k, then `cleanArgs` filtered it out — the CLI ran with **no prompt** | Long prompts (>30k) now go via **stdin** for codex/cursor/pi/hermes; `run()` also **fails loudly** on an oversized arg instead of dropping it |
| L3 `"false"` → pass | ✅ `pass: !!v.pass` — the string `"false"` is truthy | strict check: only real `true` / `"true"` passes; everything else **fails closed**. Verified with a case table |
| L4 silent judge fallback | ✅ bare `catch {}` then silent `ollamaJudge()` | fallback still happens (loop keeps moving) but is now **labelled**: `judgedBy`, `fellBackFrom`, and a `⚠ Graded by the LOCAL fallback judge, not "<judge>"` line prepended to issues |
| L5 judge error swallowed | ✅ same `catch {}` | real cause captured in `judgeError` and surfaced in the issues text |
| L6 hardcoded gemma model | ✅ `xentriom/gemma-4-12B-...` hardcoded; not installed here → local judge always 404'd | new `localJudgeModel()` asks Ollama `/api/tags` what's actually pulled and picks a sensible one (`LOCAL_MODEL` env still wins) |
| L7 macOS-only Chrome | ✅ only checked `~/Library/Caches/ms-playwright` → on Windows always null → render check reported "clean" **without opening the page** | cross-platform: Windows `%LOCALAPPDATA%\ms-playwright` + `.exe` suffix, plus the linux path |
| L8 "Ollama on your Mac" | ✅ stale label on a Windows box | → "Ollama on this machine" |

**Bonus (found while in there):** `run()` now kills the **whole process tree** (`taskkill /T` on win32) instead of just the direct child — previously a timed-out CLI left orphaned grandchildren holding ports/tokens. Also added a `stdin` error handler: an EPIPE when a child died early was an unhandled event that could crash the server process.

**Not done (deliberate):** L-UI — `LoopView.tsx` hand-duplicates the WORKERS/JUDGES lists instead of importing them from the engine, so the picker can drift from what the server supports. Left for the UI pass; it's cosmetic-ish and the engine is the thing that had to be correct first.

### Verification
`tsc --noEmit` → 0 errors. Verdict-pass logic verified against a 9-case table (`true`/`"true"`/`"TRUE"` pass; `false`/`"false"`/`"no"`/`0`/`1`/`""` fail).

---

## 2026-07-23 · Session 2 — Security right-sizing
- **Committed `d24c8b3`** — `fix(paths)`: tightened the shared segment regex to reject dot-only names (`.`/`..`/`...`) at **43 call sites across 26 files**. The old `/^[A-Za-z0-9_.-]+$/` allowed `..` because the dot is inside the character class, so a `project=".."` walked out of its workspace root. Verified with a case table + `tsc` clean.
- **Rest of the security tourniquet intentionally SKIPPED** — user's call: single-user LAN box, so login rate-limiting + constant-time cookie compare are defending against an attacker already on the network. Documented rather than built.
  - *Revisit trigger:* if the dashboard is ever port-forwarded or the tailnet is shared, do the login rate-limit first (~20 min). Note Tailscale already widens reach beyond the physical LAN.
  - Session model decision: **minimal hardening only** — keep the derived-hash cookie (pass-the-hash + non-expiring accepted).

## 2026-07-23 · Session 1 — Front page made honest
- **Committed `28b95fb`** — replaced fabricated front-page telemetry with real data, fixed dead links, swapped the fleet roster for a real Deal Desk summary. Full detail: `_audit/2026-07-22/FRONTPAGE-REPAIR.md`.
- **Committed `202ed22`** — baseline snapshot; restored version control (`.git` was empty, no history since ~Jun 30).

## Standing constraints (user preferences)
- **Restarts are the user's** — never restart the live server; it's a prod build on the LAN. Assistant edits source + typechecks; user runs `npm run build` and restarts at a stopping point.
- **Agent modules to keep standalone** (do NOT fold into a unified console): **Agent Council chat (`/room`)**, **The Oracle**, **News Radar**.
- **Jarvis** — wanted working. Plan: drop the dead OpenAI Realtime default; decompose to mic → STT → hermes/Claude CLI → **ElevenLabs TTS** (key valid; `/api/hermes/tts` already supports it).
- Exile-not-delete; never hard-delete files.
