# Task Group: AgenticOS repo orientation and Agent Kanban CLI routing

scope: Reuse for work in `C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os`, especially when the user wants a concise codebase map first or when Agent Kanban/planner-builder routing is ignoring the selected CLI agent and falling back to local Ollama/Gemma.
applies_to: cwd=C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os; reuse_rule=safe for follow-up work in this checkout/project family, but revalidate live runtime state, restart timing, and pre-existing build warnings each run

## Task 1: Get acquainted with the AgenticOS codebase and establish the main entrypoints, success

### rollout_summary_files

- rollout_summaries/2026-06-30T10-17-34-6OSt-agent_kanban_gemma_fallback_fix_and_restart.md (cwd=\\?\C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T03-17-34-019f1808-bef6-7ce3-9e54-5c66932e2039.jsonl, updated_at=2026-06-30T10:49:08+00:00, thread_id=019f1808-bef6-7ce3-9e54-5c66932e2039, success; repo reconnaissance and entrypoint map)

### keywords

- AgenticOS, Next.js 16, React 19, Tailwind v4, Turbopack, src/app/layout.tsx, src/lib/config.ts, src/lib/settings.ts, src/proxy.ts, src/lib/runner.ts

## Task 2: Fix Agent Kanban silently falling back to Gemma instead of the selected CLI agent, success

### rollout_summary_files

- rollout_summaries/2026-06-30T10-17-34-6OSt-agent_kanban_gemma_fallback_fix_and_restart.md (cwd=\\?\C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T03-17-34-019f1808-bef6-7ce3-9e54-5c66932e2039.jsonl, updated_at=2026-06-30T10:49:08+00:00, thread_id=019f1808-bef6-7ce3-9e54-5c66932e2039, success; planner/builder routing fixed and restart performed only after permission)

### keywords

- Agent Kanban, Gemma fallback, localOllama, localModel, cliComplete, LOOP_CLI_AGENTS, AgentPicker includeIds, builderAgent, localStorage, not wired for Agent Kanban yet

## User preferences

- When the user asks to “Get acquianted with this codebase,” start with a concise repo map and main entrypoints/docs before editing. [Task 1]
- When the user says the Agent Kanban board “tries to pull some gemma model” despite a CLI selection, treat the selected CLI agent as governing the whole board, not just part of the flow. [Task 2]
- When the user says “No, never do that. I am using it, i'll restart it when I'm at a stopping point” -> do not restart a live app unless explicitly asked. [Task 2]
- When the user later says “ok restartr it now please,” a restart is acceptable only after explicit permission / at a stopping point. [Task 2]

## Reusable knowledge

- The active app is a Next.js `16.2.6` / React `19.2.4` / Tailwind v4 / Turbopack dashboard where `src/app/layout.tsx` wraps pages with `Shell`, `HydrateFleet`, and the global visual layers. [Task 1]
- `src/lib/config.ts` is the startup-config layer and `src/lib/settings.ts` is the live UI settings layer; `src/lib/runner.ts` centralizes CLI spawning and Windows shim resolution. [Task 1]
- `src/proxy.ts` is the auth gate and fails closed unless `AGENTOS_PASSWORD` is set. [Task 1]
- `source-original-backup` is a preserved snapshot excluded from TypeScript, not active code. [Task 1]
- `AGENTS.md` says this Next version differs from older mental models and the relevant docs in `node_modules/next/dist/docs/` should be read before making Next-specific changes. [Task 1]
- Root cause of the Gemma fallback: `src/app/api/agent-kanban/plan/route.ts` always called `resolveModel()` from the local Ollama path, so planner selection ignored the UI’s chosen CLI agent. [Task 2]
- `LOOP_CLI_AGENTS` in `src/lib/loopEngine.ts` is the canonical allowlist of wired one-shot CLI agents: `claude`, `codex`, `cursor`, `pi`, `hermes`. [Task 2]
- `AgentPicker` now supports `includeIds`, `AgentKanban.tsx` persists `builderAgent` in localStorage and sends it to both plan/build requests, and unsupported non-local agent selections now fail loudly instead of silently falling back to local Ollama/Gemma. [Task 2]
- `npm run build` succeeded here; the remaining warning was the pre-existing non-fatal Turbopack NFT tracing warning through `src/app/api/antigravity/workspace/raw/route.ts`. [Task 1][Task 2]

## Failures and how to do differently

- Symptom: repo orientation starts from stale docs -> cause: README lagged behind the current feature set -> fix: treat the source tree and build output as the source of truth. [Task 1]
- Symptom: version-control assumptions break immediately -> cause: `git status` from this working folder returned “not a git repository” -> fix: do not assume the current folder is a git root until verified. [Task 1]
- Symptom: a UI dropdown suggests the chosen agent will be used but the backend still runs Gemma -> cause: the planner endpoint ignored the selected agent and always used the local fallback path -> fix: trace both client and server routes, then fail loudly for unsupported selections instead of silently switching models. [Task 2]
- Symptom: the selected CLI agent still behaves inconsistently after the route fix -> cause: React closure state captured an old `builderAgent` -> fix: keep `builderAgent` in the callback dependency list. [Task 2]
- Symptom: the assistant restarts a live app at the wrong time -> cause: acting on a maintenance instinct instead of the user’s workflow -> fix: wait for explicit restart permission when the app is in active use. [Task 2]
