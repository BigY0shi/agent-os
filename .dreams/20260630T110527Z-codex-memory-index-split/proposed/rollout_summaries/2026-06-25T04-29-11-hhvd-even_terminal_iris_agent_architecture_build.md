thread_id: 019efd09-ff88-78f0-86eb-1529c2e37f1b
updated_at: 2026-06-25T04:29:11+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff88-78f0-86eb-1529c2e37f1b.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# Built IRIS into an autonomous desktop-agent scaffold after user asked for a CLI-driven G2-glasses agent with desktop autonomy and multi-backend support.

Rollout context: The user wanted the IRIS Electron/React template turned into a desktop agent for Even Realities G2 glasses, using CLI backends (Claude Code, Codex, Gemini CLI, GitHub CLI/Copilot CLI) and optionally OpenAI/other API endpoints, with strong computer-use autonomy; they also asked the agent to study multiple reference repos/papers before building.

## Task 1: Activate Even Terminal and verify network access
Outcome: success

Preference signals:
- The user asked to "activate the even-terminal" after npm install and expected the QR-based setup flow to work.
- When asking "what's the IP? I can't use localhost from a different machine..." and later confirming "I had to use the 192.168.0.94 IP address to make it work," they signaled they care about routable LAN IPs, not localhost or link-local addresses, when connecting from another device.

Key steps:
- Ran Even Terminal activation and read the task output showing it was live with name `agent_even`, local URL `http://localhost:3456`, token, and working dir `C:\Users\Yoshi\.agent_even`.
- Retrieved the link-local IP `169.254.83.107` from output, then later confirmed the correct routable LAN IP was `192.168.0.94`.

Failures and how to do differently:
- `localhost` and `169.254.x.x` were not usable from another machine; the user had to switch to a `192.168.0.x` LAN address.
- For similar setups, check for the machine's actual LAN IP early instead of assuming the displayed local address is reachable externally.

Reusable knowledge:
- Even Terminal was running on port `3456` in `C:\Users\Yoshi\.agent_even`.
- The session produced a token and displayed QR code for glasses pairing; the working connection from another device used `192.168.0.94`.

References:
- `agent_even`
- `http://localhost:3456`
- `169.254.83.107`
- `192.168.0.94`
- `C:\Users\Yoshi\.agent_even`

## Task 2: Research IRIS refs and build autonomous agent scaffold
Outcome: success

Preference signals:
- The user said IRIS was only a template and wanted it adapted into a desktop agent "similar to Hermes or OpenClaw" that uses CLI agents like "Claude Code, Codex, Gemini CLI, GitHub Copilot CLI" and also has "the option to use ... OpenAI API endpoints." This suggests the next agent should default to multi-backend agent-agnostic design, not a single-model integration.
- The user explicitly corrected scope to include "free range or autonomous" computer use, indicating autonomy should be a first-class design goal.
- The user said "go with the defaults on everything" except that "the even terminal will not do the voice routing" and voice must be piped through external STT/TTS ("11 Labs or Deepgram or Sonionics or something"). This suggests default-accepting behavior is appropriate when the user says to use defaults, but voice routing must be treated as external to Even Terminal.
- The user asked to inspect specific external references before building: agentOS / SpharxTeam AgentOS, EverMind-AI EverOS, BAI-LAB MemoryOS, ynulihao AgentSkillOS, PhyAgentOS, hollow-agentOS, and Princeton's Continual Harness. This signals they want the implementation informed by those architectures rather than invented from scratch.

Key steps:
- Inspected the IRIS Electron app structure and key files (`package.json`, `src/main/index.ts`, `src/main/services/iris-coder.ts`, `src/main/logic/terminal-control.ts`, `src/main/tools/tool.ts`, `src/renderer/src/services/IRIS_AI.ts`, etc.).
- Researched the six reference repos/paper and distilled their patterns into a unified architecture.
- Wrote `docs/ARCHITECTURE_V2.md` and created new core modules under `src/main/` for kernel, providers, agent loop, memory, skills, protocol, and tools.

Failures and how to do differently:
- The user interrupted a few exploratory/questions phases, so the agent should keep asking only high-value clarifying questions and otherwise proceed with the stated defaults.
- The build did not yet include the IPC bridge / renderer wiring; the agent explicitly identified that as the next step after the 19 core files were created.

Reusable knowledge:
- IRIS is an Electron + React + Vite + TypeScript/Tailwind desktop app; the existing stack already includes desktop-control pieces like `nut-js`, `screenshot-desktop`, `tesseract.js`, `node-window-manager`, `ghost-control.ts`, `telekinesis.ts`, and `puppeteer`.
- The new architecture introduced:
  - `src/main/kernel/*` for universal types/event bus/config
  - `src/main/providers/*` for CLI/API provider abstraction (`claude-code.ts`, `codex.ts`, `gemini-cli.ts`, `copilot-cli.ts`, `openai.ts`, `anthropic.ts`, `ollama.ts`, `registry.ts`)
  - `src/main/agent/*` for observe→think→act loop, safety gate, refiner, screen observer, action executor
  - `src/main/memory/*` for hierarchical memory and retrieval
  - `src/main/skills/*` for skill registry and synthesis
  - `src/main/protocol/state-files.ts` for state-as-a-file protocol
  - `src/main/tools/*` for provider-agnostic tool declarations
- The refiner incorporated the Continual Harness idea: periodic CRUD edits to prompt/sub-agents/skills/memory without resetting the session.
- The session report was used as an input to the memory design; it was saved as `C:\Users\Yoshi\.agent_even\session-report-20260618-1821.html` and mentioned token/cache stats that informed the memory/skill architecture.

References:
- External refs studied: `SpharxTeam/AgentOS`, `EverMind-AI/EverOS`, `BAI-LAB/MemoryOS`, `ynulihao/AgentSkillOS`, `PhyAgentOS/PhyAgentOS`, `ninjahawk/hollow-agentOS`, Continual Harness (Princeton, arXiv `2605.09998`)
- New files created:
  - `docs/ARCHITECTURE_V2.md`
  - `src/main/kernel/types.ts`
  - `src/main/kernel/event-bus.ts`
  - `src/main/kernel/config.ts`
  - `src/main/providers/types.ts`
  - `src/main/providers/cli/claude-code.ts`
  - `src/main/providers/cli/codex.ts`
  - `src/main/providers/cli/gemini-cli.ts`
  - `src/main/providers/cli/copilot-cli.ts`
  - `src/main/providers/api/openai.ts`
  - `src/main/providers/api/anthropic.ts`
  - `src/main/providers/api/ollama.ts`
  - `src/main/providers/registry.ts`
  - `src/main/agent/screen-observer.ts`
  - `src/main/agent/safety-gate.ts`
  - `src/main/agent/action-executor.ts`
  - `src/main/agent/agent-loop.ts`
  - `src/main/agent/refiner.ts`
  - `src/main/tools/types.ts`
  - `src/main/tools/declarations.ts`
  - `src/main/protocol/state-files.ts`
  - `src/main/memory/store.ts`
  - `src/main/memory/updater.ts`
  - `src/main/memory/retriever.ts`
  - `src/main/skills/registry.ts`
  - `src/main/skills/synthesizer.ts`
