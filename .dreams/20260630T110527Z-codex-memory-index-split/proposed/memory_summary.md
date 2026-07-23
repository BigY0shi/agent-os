v1

## User Profile
The user works locally on Windows and usually wants the agent to operate against the real machine or live app state, not stop at abstract advice. Their recent work centers on Even Realities / EvenHub projects (`cc-g2-win`, IRIS/`agent_even`), local repo/bootstrap workflows (`agentplus`, `finance-app`), and pragmatic debugging where exact runtime behavior matters more than elegant theory.

They respond best when the assistant keeps project boundaries straight, especially between IRIS and the separate `cc-g2-win` Claude Code app, and when it preserves concrete wording that carries operational meaning. They often want real deliverables in the repo or on disk: updated READMEs, planning-framework files, project memory, portable archives, or working launcher/debug paths.

They also tend to steer quickly when assumptions are off. If they interrupt with more context, platform constraints, or a specific doc/repo to read, that is usually a signal to pause and realign before building further. For compression/cleanup tasks, they sometimes want strict structure preservation and "raw signal" rather than prose.

## User preferences
- When the user is dealing with a live app or machine issue, verify the real runtime path first: actual PID/process age, served bundle, simulator/live UI, or the exact metric they are watching.
- When the user asks where something was saved or configured, answer with exact on-disk paths or config locations.
- For `cc-g2-win`, assume Windows backend + Android EvenHub app, separate from IRIS, Claude Code-only, with local `faster-whisper` preferred unless the user says otherwise.
- In `cc-g2-win`, do not claim QR/startup/reachability flows are ready unless the script actually emits or proves them; if the user says behavior is still old, check for stale runtime before editing more code.
- For network/reachability questions, distinguish loopback, link-local, and WSL adapter IPs from routable LAN/Tailscale addresses; in the EvenHub flow, QR should contain only the plugin URL.
- When the user interrupts to add constraints or points to specific docs/repos to read, pause and absorb that context before continuing implementation.
- When the user asks for structured planning or novice-facing docs, produce real artifacts with the requested structure, not a loose brainstorm.
- For strict compression requests like "No prose. Raw signal.", preserve facts, relationships, chronology, and required format while stripping filler.

## General Tips
- Environment: Windows + PowerShell, with heavy local work in `C:\Users\Yoshi\Documents\Codex`, `C:\Users\Yoshi\.agent_even`, `C:\Users\Yoshi\agentplus`, and `C:\Users\Yoshi\finance-app`.
- Keep `agent_even` scopes separate: `agent_even\agent_even` is the IRIS template/desktop-agent architecture repo; `agent_even\cc-g2-win` is the separate EvenHub Claude Code app.
- `cc-g2-win` routing: start with `dev.ps1`, `plugin\src\main.ts`, `plugin\src\display.ts`, `backend\main.py`, `backend\session.py`, and `even-dev\apps.json`. See `skills/cc-g2-win-debug-loop/SKILL.md`.
- `cc-g2-win` failure shields: no reply after transcription often means invalid Claude `--session-id` or hidden stderr; stale behavior often means stale backend/cached bundle; disconnects can come from uvicorn websocket ping settings.
- EvenHub simulator path: `C:\Users\Yoshi\.agent_even\even-dev`, with `apps.json` already mapping `"cc-g2"` to the local plugin.
- `agentplus` cloud planning: `ultraplan` requires a git repo first, then committed/pushed files plus the Claude GitHub App; if those are satisfied and cloud still stalls, pivot local.
- `finance-app` startup truth lives in the actual launch command/binding, not stale README text; baseline pattern was commit -> annotated tag -> branch -> push.
- Windows live-troubleshooting on this machine works better with short targeted probes, and Task Manager alignment often comes from `Processor Utility`, not just `% Processor Time`.

## What's in Memory

### C:\Users\Yoshi\.agent_even\cc-g2-win

#### 2026-06-25

- cc-g2-win architecture and MVP bootstrap: EvenHub, Windows, Android, Claude Code only, faster-whisper, dev.ps1, QR code missing
  - desc: Search this first for the intended shape of the custom G2 app, MVP assumptions, launcher expectations, and project-boundary rules for `C:\Users\Yoshi\.agent_even\cc-g2-win`.
  - learnings: This app is separate from IRIS, targets Windows backend + Android EvenHub, prefers local STT, and should not promise QR/persistence behavior until the script actually proves it.

- cc-g2-win runtime, reachability, and simulator verification: session.py, valid UUID, stderr=PIPE, stale backend, even-dev, 172.22.32.1, Tailscale
  - desc: Search this first when live behavior does not match source edits, Claude never replies after transcription, the simulator is on the wrong surface, or the phone cannot reach the app.
  - learnings: Health checks alone were not enough; the useful fixes were UUID `--session-id`, stderr draining, proving the served bundle/PID, using the simulator on port `5173`, rejecting WSL IPs, and treating QR as plugin-URL-only.

- cc-g2-win plugin UX, gestures, and HUD state: three taps instead of just two, !Nothing heard, hold to record, Display.render(), Listening...
  - desc: Search this first for review-before-send flow, transcript/reply separation, hold-to-record questions, HUD blanking, and downstream handoff bugs in `plugin\src\main.ts` and `display.ts`.
  - learnings: The user wants review-before-send and stronger turn separation; `eventType` can be `0`/`null`; transcription-on-screen can still fail the downstream heard-state path.

### C:\Users\Yoshi\.agent_even\agent_even

#### 2026-06-25

- Even Terminal activation and IRIS desktop-agent architecture: agent_even, 192.168.0.94, ARCHITECTURE_V2.md, providers, refiner, Continual Harness
  - desc: Search this first for the IRIS template adaptation path, Even Terminal LAN routing, and the provider/memory/skills/refiner architecture written in `C:\Users\Yoshi\.agent_even\agent_even`.
  - learnings: Surface the routable LAN IP rather than localhost/link-local, treat IRIS as a template for an autonomous desktop agent, and validate scaffolding after architecture work because the big 19-file build was structural first.

- IRIS/G2 note compression rules: maximum non-destructive compression, No prose. Raw signal., Preserve ## timestamp | branch format
  - desc: Search this for strict note-compression requests tied to the IRIS/G2 work.
  - learnings: The desired output is lossless-style shorthand grouped by subject, oldest-to-newest, preserving causality rather than rewriting into prose.

### C:\Users\Yoshi\agentplus

#### 2026-06-25

- Agentplus ambient-agent planning and Claude cloud prep: ambient agentic presence, ultraplan, git repository required, Claude GitHub App, PLANNING_FRAMEWORK.md
  - desc: Search this first for `C:\Users\Yoshi\agentplus` work involving the user's ambient-agent design brief, repo bootstrap, or Claude cloud planning setup.
  - learnings: Pause early for added system constraints, do the requested repo/doc research before coding, and remember that cloud planning here needs git init first, then pushed files and the Claude GitHub App.

### C:\Users\Yoshi\finance-app

#### 2026-06-25

- Finance-app startup, baseline, and blocked doc redesign: uvicorn, 8765, 0.0.0.0, v1.0-known-good, iterate, 401 Invalid authentication credentials
  - desc: Search this first for `C:\Users\Yoshi\finance-app` startup verification, clean restore-point creation, or the novice-facing instruction-packet redesign brief.
  - learnings: Verify the real launch/binding path and patch the README in the same run; the redesign brief is useful, but live implementation was blocked by `/login` auth failure.

### C:\Users\Yoshi\Documents\Codex

#### 2026-06-04

- Windows startup and CPU investigation: StartupApproved, LastBootUpTime, Task Scheduler, Processor Utility, Task Manager
  - desc: Search this first for "what starts with Windows?" questions that are tied to a live high-CPU complaint on this machine.
  - learnings: Combine startup inventory with live CPU context, and check `LastBootUpTime` early because Fast Startup can make the user's timeline misleading.

- Windows CPU spike and Explorer hangs: HapticService, Processor Utility, explorer.exe hang, NCOverlays.dll, CoreSync_x64.dll
  - desc: Search this first when the user is troubleshooting Task Manager CPU mismatches or Explorer/folder-open hangs on this machine.
  - learnings: Align to `Processor Utility`, treat shell extensions as a first-class path, and keep CPU spikes separate from Explorer-hang hypotheses until evidence joins them.

#### 2026-05-31

- Military FPS idea-mining direction and skill export: codex-skills-export-20260530-041315.zip, grounded but gamey, ruck score, 3v3, 4v4
  - desc: Search this for portable local skill export details or follow-up work on the user's tactical-shooter direction in `C:\Users\Yoshi\Documents\Codex`.
  - learnings: The skill export path is exact and local; the shooter concept wants release-worthy, gunfight-first, grounded-but-gamey design with fair consequences instead of punishing complexity.

### Older Memory Topics

All current high-signal topics are covered in the recent memory days above.
