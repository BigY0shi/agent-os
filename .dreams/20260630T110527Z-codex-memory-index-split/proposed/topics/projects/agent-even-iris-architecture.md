# Task Group: Even Terminal activation and IRIS desktop-agent architecture

scope: Reuse for work in `C:\Users\Yoshi\.agent_even\agent_even`, especially when the user wants the IRIS Electron app treated as a template for a more autonomous desktop agent or needs Even Terminal network details for cross-device access.
applies_to: cwd=C:\Users\Yoshi\.agent_even and cwd=C:\Users\Yoshi\.agent_even\agent_even; reuse_rule=safe for follow-up architecture work in this repo family, but treat runtime/network specifics as machine-specific and revalidate before reuse

## Task 1: Activate Even Terminal and surface the routable host address

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-YZsy-even_terminal_iris_agent_architecture_and_core_build.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff9c-7643-b382-b5f7a129285e.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ff9c-7643-b382-b5f7a129285e, success; Even Terminal activation plus working LAN IP)
- rollout_summaries/2026-06-25T04-29-11-vQ3s-even_terminal_activation_and_iris_agent_architecture.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff88-78f0-86eb-1529c2e37f1b.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ff88-78f0-86eb-1529c2e37f1b, success; same activation + routing context)

### keywords

- Even Terminal, agent_even, port 3456, 192.168.0.94, localhost, 169.254.x.x, LAN IP, glasses polling

## Task 2: Turn the IRIS template into a desktop-agent architecture with provider, memory, skill, and refiner layers

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-YZsy-even_terminal_iris_agent_architecture_and_core_build.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-ff9c-7643-b382-b5f7a129285e.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-ff9c-7643-b382-b5f7a129285e, success; architecture doc plus 19-file scaffold)
- rollout_summaries/2026-06-25T04-29-11-hhvd-even_terminal_iris_agent_architecture_build.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd0a-01aa-7dd2-b904-488879fe824e.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd0a-01aa-7dd2-b904-488879fe824e, success; same IRIS architecture family from another pass)

### keywords

- IRIS template, ARCHITECTURE_V2.md, kernel, providers, agent-loop, refiner, memory, skills, protocol, Claude Code, Codex, Gemini CLI, Copilot CLI, OpenAI, Anthropic, Ollama, Continual Harness

## Task 3: Compress IRIS/G2 notes with maximum non-destructive compression

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-12-jjng-iris_g2_notes_max_compression.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-01ea-7353-baeb-07e85afd89c6.jsonl, updated_at=2026-06-25T04:29:12+00:00, thread_id=019efd0a-01ea-7353-baeb-07e85afd89c6, success; lossless-style note compression rules)

### keywords

- maximum non-destructive compression, ZERO information loss, No prose. Raw signal., Group entries by subject, Preserve ## timestamp | branch format, oldest to newest

## User preferences

- When the user asks for cross-device access and says "I can't use localhost from a different machine" -> surface the routable LAN IP, not just localhost or link-local addresses. [Task 1]
- When the user says the IRIS app is "a template" and wants "an app that can run on the even realities G2 glasses" -> adapt the template toward the new target instead of preserving unrelated subsystems. [Task 2]
- When the user says they want a desktop agent "similar to Hermes or OpenClaw" with "free range or autonomous nature" -> default to autonomous desktop-agent framing, not a narrow helper-tool framing. [Task 2]
- When the user says voice routing will not be handled by Even Terminal and mentions "11 Labs or Deepgram or Sonionics" -> do not assume voice is solved at the terminal layer; keep STT/TTS external. [Task 2]
- When the user interrupts with more repos/papers to review before coding -> pause and do the research pass before implementation. [Task 2]
- When the user asks for "maximum non-destructive compression" with "ZERO information loss" and "No prose. Raw signal." -> preserve all facts/relationships and compress by removing filler, not by turning notes into prose. [Task 3]

## Reusable knowledge

- Even Terminal was running as `agent_even` on port `3456`, and `192.168.0.94` was the working LAN IP in this session. [Task 1]
- The IRIS template repo is at `C:\Users\Yoshi\.agent_even\agent_even`, and the architecture plan was written to `docs\ARCHITECTURE_V2.md`. [Task 2]
- The new architecture split the app into `kernel`, `providers`, `agent`, `memory`, `skills`, `protocol`, and provider-agnostic `tools` layers, with provider stubs for Claude Code, Codex, Gemini CLI, Copilot CLI, OpenAI, Anthropic, and Ollama. [Task 2]
- The existing IRIS template already contained useful desktop-control primitives such as `@nut-tree-fork/nut-js`, `screenshot-desktop`, `tesseract.js`, `node-window-manager`, `ghost-control.ts`, `telekinesis.ts`, and `puppeteer`. [Task 2]
- The refiner design was explicitly tied to the Continual Harness idea: periodic CRUD updates to prompts, sub-agents, skills, and memory. [Task 2]
- For strict compression requests in this family, the right output shape is a raw shorthand note stream grouped by subject and kept oldest-to-newest within the preserved time format. [Task 3]

## Failures and how to do differently

- Symptom: the user cannot reach Even Terminal from another device -> cause: link-local or localhost address was surfaced instead of the routable LAN IP -> fix: distinguish `169.254.x.x` from real LAN addresses and push the routable address first. [Task 1]
- Symptom: implementation starts before the user finishes adding references and constraints -> cause: planning jumped ahead of the requested research pass -> fix: pause on interruptions and complete the repo/paper review before coding. [Task 2]
- Symptom: large structural scaffolds feel complete even though wiring was not proven -> cause: architecture was created without compile/run validation -> fix: follow scaffolding with explicit build/startup verification before calling the architecture integrated. [Task 2]
- Symptom: aggressive note compression drops causality -> cause: compressing by paraphrase rather than subtraction -> fix: preserve entities, verbs, and relationships, and only strip filler words. [Task 3]
