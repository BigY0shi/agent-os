thread_id: 019f1808-bef6-7ce3-9e54-5c66932e2039
updated_at: 2026-06-30T10:49:08+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T03-17-34-019f1808-bef6-7ce3-9e54-5c66932e2039.jsonl
cwd: \\?\C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os

# Repo reconnaissance, then fixed Agent Kanban’s silent Gemma fallback and restarted the app on request

Rollout context: Windows/PowerShell workspace at `C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os`; the codebase is a large Next.js 16 dashboard with many agent/studio tabs and a live local server on port 3737.

## Task 1: Get acquainted with the codebase

Outcome: success

Preference signals:

- The user asked only to “Get acquianted with this codebase” and then later accepted the reconnaissance-style approach, which suggests that for similar orientation requests a concise repo map plus the main entrypoints/docs is useful before making changes.

Key steps:

- Ran `Get-ChildItem`, `rg --files`, and read `package.json`, `README.md`, `next.config.ts`, `tsconfig.json`, `AGENTS.md`.
- Identified the active app as a Next.js 16.2.6 / React 19.2.4 / Tailwind v4 / Turbopack project.
- Confirmed `src/app/layout.tsx` wraps pages with `Shell`, `HydrateFleet`, and the global visual layers.
- Confirmed the app is mostly thin route pages mounting large feature components from `src/components`.
- Confirmed config/settings split: startup config in `src/lib/config.ts`, live UI settings in `src/lib/settings.ts`.
- Verified `npm run build` succeeds.

Failures and how to do differently:

- `git status` returned “not a git repository” from this working folder, so version-control assumptions should not be made unless the repo is reinitialized or the actual git root is located.
- The README is older than the current tree and under-describes the current feature set; use the source tree and build output as the source of truth.
- The build emits a persistent Turbopack NFT warning tracing `src/app/api/antigravity/workspace/raw/route.ts` through `next.config.ts`; it is non-fatal but worth remembering if packaging behavior changes.

Reusable knowledge:

- `src/proxy.ts` is the auth gate: it fails closed unless `AGENTOS_PASSWORD` is set.
- `src/lib/runner.ts` is the central CLI spawning layer and handles Windows shim resolution plus env cleanup.
- `source-original-backup` is excluded from TS and behaves like a preserved snapshot, not active code.
- `AGENTS.md` explicitly says this Next version differs from older mental models; read the relevant docs in `node_modules/next/dist/docs/` before changing Next-specific code.

References:

- [1] `package.json` scripts: `dev: next dev -H 127.0.0.1`, `build: next build`, `start: next start -H 0.0.0.0`
- [2] `src/app/layout.tsx` shows `Shell`, `HydrateFleet`, `AuroraBackground`, `ParticleField` wrapping all pages.
- [3] `src/lib/config.ts` loads env → `~/.agentic-os/config.json` → autodetect; `src/lib/settings.ts` reads/writes `~/.agentic-os/settings.json` at request time.
- [4] `npm run build` completed successfully; only recurring warning was Turbopack NFT tracing through `src/app/api/antigravity/workspace/raw/route.ts`.

## Task 2: Fix Agent Kanban selecting Gemma instead of the chosen CLI

Outcome: success

Preference signals:

- The user said: “The Agent Kanban board isn't working. No matter what CLI model i set it for, it tries to pull some gemma model” -> this indicates they expect the chosen CLI agent to control both planning and building, not only part of the flow.
- The user later said: “No, never do that. I am using it, i'll restart it when I'm at a stopping point” -> they do not want the assistant to restart a live app unless explicitly asked.
- After that they said: “ok restartr it now please” -> restart is acceptable only after explicit permission / at a stopping point.

Key steps:

- Traced the Agent Kanban path through `src/components/AgentKanban.tsx`, `src/app/api/agent-kanban/plan/route.ts`, `src/app/api/agent-kanban/build/route.ts`, `src/lib/localModel.ts`, and `src/lib/localOllama.ts`.
- Found the root cause: the planner route always used `resolveModel()` from local Ollama, whose fallback is the Gemma model, while only the builder path used the selected agent.
- Patched `AgentKanban.tsx` to persist `builderAgent` in localStorage and send it to both `/api/agent-kanban/plan` and `/api/agent-kanban/build`.
- Patched `plan/route.ts` and `build/route.ts` to route supported CLI choices through `cliComplete(...)` and to error loudly for unsupported/stale non-local selections instead of silently falling back to the local Gemma path.
- Restricted the kanban picker to the CLI agents that are wired for this board by adding `includeIds` to `AgentPicker` and using it in `AgentKanban`.
- Updated the React callback dependencies so the selected agent can’t be captured stale in the run handler.
- Added a learned rule to `AGENTS.md` stating Agent Kanban must not silently fall back to local Ollama/Gemma when the user selected a CLI agent.
- Rebuilt successfully after each patch pass.
- Restart was initially attempted but declined by the user; later, after explicit permission, the app was restarted with `agentos-restart.ps1`, and `http://127.0.0.1:3737/login` returned `200`.

Failures and how to do differently:

- Don’t try to restart the live Agent OS server unless the user explicitly asks; the user was actively using it and corrected this behavior.
- Avoid silent model fallback in multi-agent routing flows; if a selection is unsupported, return a clear error instead of switching to a local default.
- A seemingly UI-only bug can originate in a server route: here the dropdown was misleading, but the planner endpoint was the real Gemma fallback.

Reusable knowledge:

- The Agent Kanban board’s builder dropdown now supports filtering by exact agent ids via `AgentPicker includeIds`.
- `LOOP_CLI_AGENTS` in `src/lib/loopEngine.ts` is the canonical list of CLI agents wired for non-interactive one-shot completion: `claude`, `codex`, `cursor`, `pi`, `hermes`.
- `src/app/api/agent-kanban/plan/route.ts` now uses CLI completion when a wired CLI agent is selected; otherwise it uses the warm local Ollama path.
- `src/app/api/agent-kanban/build/route.ts` mirrors that same routing and now fails loudly for unsupported non-local selections.
- Build verification after the fix was clean; the only remaining build warning was the pre-existing Turbopack NFT tracing warning through `src/app/api/antigravity/workspace/raw/route.ts`.

References:

- [1] Culprit path: `src/app/api/agent-kanban/plan/route.ts` originally called `resolveModel()` unconditionally, which can return the Gemma fallback from `src/lib/localModel.ts` / `src/lib/localOllama.ts`.
- [2] Patched files: `src/components/AgentKanban.tsx`, `src/components/AgentPicker.tsx`, `src/app/api/agent-kanban/plan/route.ts`, `src/app/api/agent-kanban/build/route.ts`, `AGENTS.md`.
- [3] Important added guard: unsupported non-local selection now returns an explicit error like `"<agent> is not wired for Agent Kanban yet"` instead of silently using local Ollama.
- [4] Verification: `npm run build` succeeded after the patches; `Invoke-WebRequest http://127.0.0.1:3737/login` returned `200` after restart.
