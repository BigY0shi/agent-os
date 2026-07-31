v1

## User Profile
The user works locally on Windows and usually wants the agent to operate against the real running app, machine state, hardware inventory, or editor session rather than stopping at theory. Recurring work includes AgenticOS / Codex tooling, EvenHub / `cc-g2-win`, HexMod hardware and firmware, and now Unreal-editor collaboration in `C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8`.

They prefer concrete artifacts on disk over chat-only guidance: updated docs, handoff files, skills, zip bundles, validated commands, working code, and direct flash/runtime steps. When an assumption is wrong, they correct quickly and expect an immediate pivot.

They care about groundedness. For software, that means checking the real process, served bundle, selected route, local path, or live simulator/runtime before claiming a fix. For hardware, that means designing around owned boards first, separating roles cleanly, and keeping exact model names provisional until verified. For live/editor workflows, timing matters: restart only when asked, and if a project says to wait after a readiness check, wait.

In artist-name and personal-name contexts, the correct names are Eezus (artist name) and Robby (real name); "Julian Golde" / "Golde" should not be used as the user's identity. [ad-hoc note]

## User preferences
- When the user is dealing with a live app, runtime bug, or editor session, verify the real runtime path first: actual PID/process age, served bundle, simulator/live UI, selected route, active level, or the exact local config/path in use.
- When the user asks where something is installed, saved, or configured, answer with exact local paths and env/config mappings, not public links or generic docs.
- If the user asks to get acquainted with a codebase or project, start with a concise repo/workspace map and the main entrypoints/docs before editing.
- Do not restart a live app unless the user explicitly asks; if they later say it is okay, restart then.
- When the user asks for a handoff, plan, skill, or novice-facing document, produce the real artifact on disk rather than leaving it in chat.
- For Unreal work in `DDSKitV3-58 5.8`, read `AGENTS.md` before acting; if the user asks for native MCP only, avoid PowerShell/HTTP fallback, say "connected and ready", and wait.
- For interactive `/model` questions, keep the answer concise, exact, and directly pasteable as a model ID.
- For HexMod-Hardware planning, treat the user's owned boards/modules as the first candidate set and keep ESP32 in the control/event role unless the task specifically needs more.
- For RV/security planning, do not default to Pi-heavy architectures; prefer cheap or already-owned camera-node POCs first and keep clips event-driven unless asked otherwise.
- For firmware/build help when the user is working CLI-first, default to terminal commands and direct flash steps rather than IDE instructions.
- For `cc-g2-win`, do not claim QR/startup/reachability flows are ready unless the script actually emits or proves them; if behavior still looks old, check for stale runtime before editing more code.
- When a version/model name is ambiguous, clarify the product/vendor before answering instead of anchoring on the first plausible interpretation.
- For album-cover, artist-name, identity, or personal-name work, use "Eezus" for the artist name and "Robby" for the real name; do not reuse "Julian Golde" / "Golde" from workspace-path context. [ad-hoc note]
- For strict compression requests like "No prose. Raw signal.", preserve facts, relationships, chronology, and required format while stripping filler.

## General Tips
- Environment: Windows + PowerShell, with heavy local work in `C:\Users\Yoshi\Documents\Codex`, `C:\Users\Yoshi\.agent_even`, `C:\Users\Yoshi\agentplus`, `C:\Users\Yoshi\finance-app`, `C:\Users\Yoshi\Documents\Codex\HexMod-Hardware`, and `C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8`.
- AgenticOS lives at `C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os`; README can lag, so source tree + `npm run build` are more reliable than docs there.
- The `JulianGolde - AgenticOS` folder name is not identity evidence; in naming-sensitive contexts, use Eezus / Robby per the correction note. [ad-hoc note]
- AgenticOS routing truth for Agent Kanban is in `src/components/AgentKanban.tsx`, `src/components/AgentPicker.tsx`, `src/app/api/agent-kanban/plan/route.ts`, `src/app/api/agent-kanban/build/route.ts`, and `src/lib/loopEngine.ts`.
- On this machine, Codex CLI resolves through npm shims at `C:\Users\Yoshi\AppData\Roaming\npm\codex.cmd` / `codex.ps1`; `CODEX_HOME` should point to `C:\Users\Yoshi\.codex`.
- Paperclip-style Codex hello probes can be slowed heavily by user config, MCP servers, and hooks; compare against `--ignore-user-config` before blaming the executable path.
- Unreal `DDSKitV3-58 5.8` startup truth lives in repo `AGENTS.md`; if native `unreal-mcp` tools are missing, the likely fix is reopening the session from that project directory. Keep Unreal MCP calls sequential because `list_toolsets` and `get_current_level` can be slow.
- Fast Unreal active-level query path: `editor_toolset.toolsets.scene.SceneTools.get_current_level`.
- Local Codex skill creation: `SKILL.md` is required, `agents/openai.yaml` is optional but useful, and `quick_validate.py` is the fast correctness check.
- HexMod RV-security defaults: separate camera/perception nodes from the ESP32 alarm hub, treat CrowTail ProtoBoards + I2C hubs as the preferred v0.1 integration path, and keep exact module naming provisional until silkscreen/docs confirm it.
- Keep `agent_even` scopes separate: `agent_even\agent_even` is the IRIS template/desktop-agent architecture repo; `agent_even\cc-g2-win` is the separate EvenHub Claude Code app.
- `cc-g2-win` routing: start with `dev.ps1`, `plugin\src\main.ts`, `plugin\src\display.ts`, `backend\main.py`, `backend\session.py`, and `even-dev\apps.json`. See `skills/cc-g2-win-debug-loop/SKILL.md`.
- `cc-g2-win` failure shields: no reply after transcription often means invalid Claude `--session-id` or hidden stderr; stale behavior often means stale backend/cached bundle; disconnects can come from uvicorn websocket ping settings; request floods can come from orphaned `BackendWs` / HMR teardown gaps or repeated interrupted `dev.ps1` runs.
- EvenHub simulator path: `C:\Users\Yoshi\.agent_even\even-dev`, with `apps.json` already mapping `"cc-g2"` to the local plugin.
- `agentplus` cloud planning: `ultraplan` requires a git repo first, then committed/pushed files plus the Claude GitHub App; if those are satisfied and cloud still stalls, pivot local.
- `MoveToNewFolder` shell-extension work lives under `C:\Users\Yoshi\MoveToNewFolder`; multi-select Explorer workflows there require worker/COM aggregation, not a naive one-line registry verb.
- `finance-app` startup truth lives in the real launch command and binding, not stale README text; the clean-baseline pattern was commit -> annotated tag -> branch -> push.

## What's in Memory

### C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8

#### 2026-07-12

- Unreal native MCP startup, reconnect, and ProtoRaid level checks: unreal-mcp, AGENTS.md, list_toolsets, get_current_level, /Game/ProtoRaid, /model
  - desc: Search this first for this Unreal worktree when the user wants native MCP-only startup, a readiness check, hook rerun, exact model-ID guidance, or confirmation of the active level before collaborative build work.
  - learnings: `AGENTS.md` is the startup contract, fallback MCP plumbing stays off, calls should remain sequential, and `/Game/ProtoRaid` was confirmed through `SceneTools.get_current_level`.

### Cross-workflow

#### 2026-07-06

- User identity and naming correction: Eezus, Robby, Julian Golde, Golde, artist name, album cover
  - desc: Search this first for album-cover, artist-name, or personal-name tasks where a workspace path could be mistaken for the user's identity; details live in `MEMORY.md` under the cross-workflow identity block. [ad-hoc note]
  - learnings: The authoritative correction is Eezus = artist name, Robby = real name, and "Julian Golde" / "Golde" should not be used as identity defaults. [ad-hoc note]

### C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os

#### 2026-07-03

- Local Codex skill creation and transfer packaging: robust-product-design, product-design:index, skill-creator, quick_validate.py, agents/openai.yaml
  - desc: Search this first for local skill-authoring work that should mirror an existing plugin/index pattern and end as an installable folder or zip bundle.
  - learnings: `SKILL.md` is required, `agents/openai.yaml` is worth keeping when metadata helps, PowerShell can eat `$skill-name` prompt text, and `quick_validate.py` is the fast validation gate.

### Older Memory Topics

#### C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os

- AgenticOS repo map and Agent Kanban CLI routing fix: Agent Kanban, Gemma fallback, LOOP_CLI_AGENTS, AgentPicker includeIds, src/lib/runner.ts
  - desc: Use for AgenticOS orientation or the bug where Agent Kanban ignored the selected CLI agent and silently fell back to local Ollama/Gemma in `cwd=C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os`.

- Windows Codex CLI path and Paperclip timeout diagnosis: CODEX_HOME, codex.cmd, Get-Command codex -All, codex exec, --ignore-user-config
  - desc: Use for local Codex install-path questions, `CODEX_HOME` mapping, or slow Paperclip hello-probe debugging on this machine in `cwd=C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os`.

#### C:\Users\Yoshi\Documents\Codex\HexMod-Hardware

- RV perimeter redesign around cheap distributed nodes first: RV perimeter, Tapo, MLX90640, event driven clips only, batteries and/or solar, ESP-NOW, LoRa fallback
  - desc: Use for the current perimeter plan where cheap or existing camera hosts feed an ESP32-centered alarm/control layout with battery/solar and fallback transport assumptions in `cwd=C:\Users\Yoshi\Documents\Codex\HexMod-Hardware`.

- RV security / edge-AI node planning and inventory-first defaults: RV perimeter, ESP32, Luckfox, SenseCAP Watcher, CrowTail ProtoBoard, COMPONENT-INVENTORY-SEED.md
  - desc: Use for the broader candidate-board inventory, earlier ESP32 hub framing, and the handoff/build-order defaults in `cwd=C:\Users\Yoshi\Documents\Codex\HexMod-Hardware`.

- T-Watch S3 Plus FieldWatch PlatformIO build and flash: T-Watch S3 Plus, FieldWatch, PlatformIO, COM6, LilyGoLib, espressif32@6.10.0
  - desc: Use for terminal-first build, dependency triage, device detection, and flashing of `firmware\t-watch-s3-plus-fieldwatch` in `cwd=C:\Users\Yoshi\Documents\Codex\HexMod-Hardware`.

#### C:\Users\Yoshi\Documents\Codex

- Model ETA/status checks and ambiguity resolution: 5.6, GPT-5.6 Sol, Mythos, Fable, official OpenAI source
  - desc: Use for live model-availability or ETA questions where the user gives a short or ambiguous name and expects current web-verified status in `cwd=C:\Users\Yoshi\Documents\Codex`.

#### C:\Users\Yoshi\.agent_even\cc-g2-win

- cc-g2-win architecture and MVP bootstrap: EvenHub, Windows, Android, Claude Code only, faster-whisper, dev.ps1, QR code missing
  - desc: Use for project boundaries, intended app shape, launcher expectations, and MVP assumptions in `cwd=C:\Users\Yoshi\.agent_even\cc-g2-win`.

- cc-g2-win runtime, reachability, and simulator verification: session.py, valid UUID, stderr=PIPE, stale backend, even-dev, Tailscale
  - desc: Use when live behavior does not match source edits, Claude never replies after transcription, the simulator shows the wrong surface, or the phone cannot reach the app in `cwd=C:\Users\Yoshi\.agent_even\cc-g2-win`.

- cc-g2-win plugin UX, gestures, and HUD state: three taps instead of just two, !Nothing heard, hold to record, Display.render(), Listening...
  - desc: Use for review-before-send flow, transcript/reply separation, hold-to-record questions, HUD blanking, and downstream heard-state bugs in `cwd=C:\Users\Yoshi\.agent_even\cc-g2-win`.

#### C:\Users\Yoshi\.agent_even\agent_even

- Even Terminal activation and IRIS desktop-agent architecture: agent_even, ARCHITECTURE_V2.md, providers, refiner, Continual Harness
  - desc: Use for IRIS template adaptation, Even Terminal LAN routing, and the provider/memory/skills/refiner architecture in `cwd=C:\Users\Yoshi\.agent_even\agent_even`.

- IRIS/G2 note compression rules: No prose. Raw signal., Preserve ## timestamp | branch format, maximum non-destructive compression
  - desc: Use for strict note-compression requests tied to the IRIS/G2 work in `cwd=C:\Users\Yoshi\.agent_even\agent_even`.

#### C:\Users\Yoshi\agentplus

- Agentplus ambient-agent planning and Claude cloud prep: ambient agentic presence, ultraplan, git repository required, Claude GitHub App, PLANNING_FRAMEWORK.md
  - desc: Use for `cwd=C:\Users\Yoshi\agentplus` work involving the ambient-agent design brief, repo bootstrap, or Claude cloud planning setup.

#### C:\Users\Yoshi\MoveToNewFolder

- Win11 Move to New Folder shell extension: MoveToNewFolder, IExplorerCommand, sparse MSIX, %L, gdi32.lib
  - desc: Use for the Explorer multi-select move-into-new-folder plugin in `cwd=C:\Users\Yoshi\MoveToNewFolder`, from broken `.inf` verb behavior through worker/COM and sparse-MSIX native build.

#### C:\Users\Yoshi\finance-app

- Finance-app startup, baseline, and blocked doc redesign: uvicorn, 8765, 0.0.0.0, v1.0-known-good, iterate, 401 Invalid authentication credentials
  - desc: Use for `cwd=C:\Users\Yoshi\finance-app` startup verification, clean restore-point creation, or the novice-facing instruction-packet redesign brief that was blocked by auth.
