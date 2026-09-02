# Handoff, 2026-09-02

Branch `feat/v2-hermes3d-and-versioning`, tracking `origin/feat/v2-hermes3d-and-versioning`.
Written at the end of a session that worked the 7-item TASKLIST. Read `AGENTS.md` first,
especially the new "Running it" section, then this.

## Tree state

Three commits are local and **unpushed**:

| commit | version | what |
|---|---|---|
| `eccdbf9` | v2.8.0 | Mac wording and Cmd glyphs replaced for a Windows owner |
| `ded6823` | v2.9.0 | Jarvis: register the browser action set it was missing |
| `4c1c06b` | v2.10.0 | Sidebar: Artist's Corner and Agent Toolbox, foldable sections |

Everything above `fa10f64` on the branch is pushed. All three are `tsc --noEmit` clean.

The running app is **older than all of them**: `.next/BUILD_ID` is stamped
2026-09-01 06:28. Anything reported as "not working" in the live UI may simply predate
these commits. Check that mtime before believing a bug report about them.

## Uncommitted, from the end of this session

Three files, reviewed but not committed. They belong together as one commit:

- `src/app/api/version/route.ts` (new, untracked) and `src/components/Sidebar.tsx`:
  the sidebar was displaying "v0.2 Build 2026-06-24". Two independent stale sources.
  `v0.2` was a hardcoded literal in `Sidebar.tsx`; the date came from the root `VERSION`
  file, which git shows was written once by `202ed22 chore: baseline snapshot before
  Phase-0 repair` and never touched again. `VERSION` is the **upstream pack's** stamp,
  like `CHANGELOG.md`, and is not ours to bump. Nothing was reading `package.json`,
  which is the version `npm run version:bump` actually maintains (rule 18).
  The route now returns `{ version, pack }`: `version` from `package.json`, `pack` from
  `VERSION`, labeled in the UI as an upstream stamp rather than as this build.
- `AGENTS.md`: new "## Running it" section recording port 3737, the production-only
  workflow, the `.bat` launchers, the auth gate, and the `BUILD_ID` staleness check.

**`AGENTS.md` had the git skip-worktree bit set** (`git ls-files -v` returned `S`). It was
the only file in the repo carrying it, and the working copy was byte-identical to HEAD, so
it was protecting nothing. Edits to the project contract were silently unshippable: they
lived on disk and never reached a commit or a clone. The bit was cleared with
`git update-index --no-skip-worktree AGENTS.md`. If it comes back, that is the reason
contract edits keep evaporating.

## The tasklist

1. **Mac references and control glyphs.** Done, `eccdbf9` / v2.8.0. The first sweep
   under-reported: a subagent found 3 files, the tree actually held 13 occurrences across
   6 files plus 3 more in `src/lib/pageMeta.ts`, and 25 glyph instances across 22 files.
   Verify counts against the tree, not against an agent's summary.
2. **Legacy memory.** Open, not started. Imported episodes sit untagged with no aspect
   (Identity, Event, Relationship). Re-running import in `full` mode cannot fix them:
   content-hash dedup rejects the rows as already present. This needs a new backfill
   routine that reads existing episode rows and runs derivation over them. Yoshi has
   `bonsai 8b` and `nomic-embed-text` local and asked why the backlog would not use those
   first. Agreed plan: run ~20 episodes, show him real rows, then decide on the full set.
   Derivation is 6 to 8 LLM calls per episode, so the full run is not cheap.
3. **Jarvis.** Browser action set fixed in `ded6823` / v2.9.0. **Voice is dead and that is
   settled**: Yoshi confirmed on 2026-09-02 that Jarvis voice does not work, and said it is
   fine because there is a new avenue now. That avenue was not named, so ask before
   assuming what replaces it. Do not spend more time on Web Speech providers. Background
   for whoever revisits it: Opera disables Web Speech by spec, and Kokoro at
   `/api/hermes/tts` is text-to-speech, so it was never going to appear in a
   recognition list.
4. **WebMCP wizard.** Open, not started. Wanted shape: exact description in, AI digests it
   and asks clarifying questions, reasons in a scratchpad without writing code, proposes a
   tool list for approval, and only then emits JSON. 5 to 10 tools per server, one tool one
   job, split by persona. Needs an escape hatch: write your own JSON and have the agent
   proofread it.
5. **Runs disappear on navigation.** Open, not started. Leaving a module page mid-run loses
   the run with nothing shown on the Agents page. Root cause found: the agents module
   detaches work to a registry, Content Engine bypasses that registry entirely. Wanted: a
   corner tray stacking one entry per live run, or failing that every run listed on the
   agents page.
6. **Granular run control.** Open, now unblocked. Decided by Yoshi on 2026-09-02:
   **configuration happens BEFORE a run launches, in a settings drawer, and the only
   mid-run control is a STOP button.** No live intervention, no editing constraints while
   a run is in flight. The drawer is where skills get applied and guardrails get added or
   removed. Yoshi's own note was "the deal desk is the only one that I think is done
   pretty well and tight", so Deal Desk is the reference implementation to copy.
7. **Sidebar.** Done, `4c1c06b` / v2.10.0. Two new groups named by Yoshi: "Artist's Corner"
   and "Agent Toolbox". Sections fold, CLI Agents starts collapsed, state persists in
   `localStorage` under `agentos.sidebar.collapsed`. Group membership comes from
   `sectionOf()` and the route Sets, not from array order. Yoshi confirmed on 2026-09-02
   that Skills and Terminal are correctly placed in Agent Toolbox.

## Open questions for Yoshi

Items 3, 6 and 7 were answered on 2026-09-02 and are folded into the list above. What is
still open:

- `Restart Agent OS.bat` has been seen exiting silently. The `.bat` files have never been
  read; a request to read them was declined earlier, so ask before opening them.
- Item 2: how many legacy episodes to backfill after the ~20-episode sample is reviewed.
- What the "new avenue" for Jarvis is, now that voice is retired.

## Traps worth knowing

- **Never `git add -A`.** The tree carries 49 dirty files of Yoshi's in-progress work.
  Stage an explicit file list. This has already swept ~30 unrelated files into a commit once.
- **Smokes must run offline.** A smoke here once made live calls to ollama.com because the
  memory queue drains `while (ingestEnabled())` and the setting defaults true. Set
  `memory.ingestEnabled: false` before importing. Any smoke touching a credential directory
  must redirect it first (rule 19). `smoke-agentmail.mjs` section F greps siblings to enforce this.
- **`listDeals` skips board records with no matching `pitches.json` entry**, keyed by URL.
  An unpitched Upwork lead has no card, cannot be decided on, and cannot be remembered.
  That is real behavior, not a test artifact.
- **CRLF.** Multi-line anchors fail against CRLF files. Normalize for matching, restore the
  original ending on write.
- **Verify subagent output against the tree.** See item 1.

## Backlog carried forward

Roughly 33 module docs unwritten. `PROGRESS.md` is stale. SPEC-F still carries a stale
Hermes 3D claim. The licence decision (MIT) is still deferred.
