# Agent OS

This repository is the local desktop dashboard for a mixed single-user AI operating environment. The codebase currently contains both legacy V1 surfaces and a newer V2 foundation. The V2 layer is the main source of truth for the current data model, scheduler, memory graph, browser tooling, task engine, and WebMCP integration.

This README is intentionally grounded in what exists in the codebase today, not in older marketing copy from earlier releases.

## Current repository reality

The app is a Next.js 16 dashboard. The runtime entrypoint is `src/app/page.tsx`, which renders the main `Overview` screen. A large number of user-facing modules are defined under `src/app/*` and `src/lib/*`, while the V2 foundations live under `src/lib/v2/*` and `src/app/api/v2/*`.

The current implementation includes:

- V1/V2 hybrid dashboard surfaces under `src/app/`
- Runtime settings and configuration in `src/lib/settings.ts` and `src/lib/config.ts`
- V2 SQLite foundations in `src/lib/v2/db.ts`, `src/lib/v2/dbSchema.ts`, and `src/lib/v2/boot.ts`
- Memory, tasks, WebMCP, integrations, browser, agents, Jarvis, automation, newsletter, and widget systems under `src/lib/v2/`

## Installation and local setup

Requirements:

- Node.js 22+
- npm
- A local working directory for your data; runtime state is stored in `~/.agentic-os/` on the host machine

Install and run:

```bash
npm install
npm run dev
```

Then open:

- `http://127.0.0.1:3000`

The app's local runtime store is expected to live in:

- `~/.agentic-os/agentos.db` for the SQLite database
- `~/.agentic-os/settings.json` for runtime, user-editable settings

This matches the runtime configuration in `src/lib/settings.ts` and the V2 boot path in `src/lib/v2/boot.ts`.

## Supported workflows and shipped surfaces

The repository supports a local, self-hosted workflow rather than a remote SaaS backend. The main workflows in the current code are:

- local CLI agent routing and model selection through the app settings and agent modules
- V2 memory ingestion, search, compaction, and persona/rule integration
- task scheduling, dispatch, recurrence, and approval flows
- WebMCP package publishing, approvals, execution, and tool registry integration
- integrations and OAuth sync flows
- browser automation, audit, and session handling
- Jarvis-style context and voice handoff
- attention/event collection and automation triggers
- newsletters, marketing surfaces, and widget registry data routes

## V2 module coverage matrix

The matrix below is the current audit record for the V2 module stack and the main user-facing surfaces it powers.

| V2 module / surface | Implementation source | Documentation source | Status | Remaining gap |
| --- | --- | --- | --- | --- |
| V2 foundations: DB, schema, boot | `src/lib/v2/db.ts`, `src/lib/v2/dbSchema.ts`, `src/lib/v2/boot.ts` | `AGENTS.md`, `CONVENTIONS.md` in `_design/agentos-v2/ultraplan/` | Implemented foundation | The public README was stale and did not reflect the actual SQLite + settings architecture. |
| Memory graph + ingest + recall | `src/lib/v2/memory/*.ts`, `src/app/api/v2/memory/*` | planning docs under `_design/agentos-v2/ultraplan/` | Implemented core path | Public installation docs do not explain memory setup or data lifecycle. |
| Tasks engine | `src/lib/v2/tasks/*.ts`, `src/app/api/v2/tasks/*` | `_design/agentos-v2/ultraplan` | Implemented | User-facing task workflow docs are still incomplete. |
| WebMCP registry + approvals + execution | `src/lib/v2/webmcp/*.ts`, `src/app/api/v2/webmcp/*` | `_design/agentos-v2/ultraplan` | Implemented | Package publishing and security review need an owner sign-off on trust boundaries. |
| Integrations + OAuth + sync | `src/lib/v2/integrations/*.ts`, `src/app/api/v2/integrations/*` | `_design/agentos-v2/ultraplan` | Implemented | OAuth callback origin and third-party credentials still require owner verification per install. |
| Browser automation | `src/lib/v2/browser/*.ts`, `src/app/api/v2/browser/*` | `_design/agentos-v2/ultraplan` | Implemented | Local browser security defaults should be documented per install. |
| Jarvis | `src/lib/v2/jarvis/*.ts`, `src/app/api/v2/jarvis/*` | `_design/agentos-v2/ultraplan` | Implemented core behavior | Voice backend/provider choices remain install-specific and need owner confirmation. |
| Agents lifecycle | `src/lib/v2/agents/*.ts`, `src/app/api/v2/agents/*` | `_design/agentos-v2/ultraplan` | Implemented | Lifecycle and trigger policies need final owner sign-off for strict deployment gating. |
| Attention events | `src/lib/v2/attention/*.ts`, `src/app/api/v2/attention/route.ts` | `_design/agentos-v2/ultraplan` | Implemented | Attention UI/notification policy still needs owner decision on default mute behavior. |
| Automations engine | `src/lib/v2/automations/*.ts`, `src/app/api/v2/automations/*` | `_design/agentos-v2/ultraplan` | Implemented | Owner validation still required for production rules and safety defaults. |
| Pages / scratchpad / notes | `src/lib/v2/pages/*.ts` | `_design/agentos-v2/ultraplan` | Implemented | Owner decision still needed on what is public vs local-only scratchpad content. |
| Skills and capability gates | `src/lib/v2/skills/*.ts`, `src/lib/v2/capability/*.ts` | `_design/agentos-v2/ultraplan` | Implemented | Capability allowlists and folder scope policy need explicit install review. |
| AnyNotes integration | `src/lib/v2/anynotes/*.ts` | `_design/agentos-v2/ultraplan` | Implemented | Details of note-source assumptions need owner validation. |
| Newsletter stack | `src/lib/v2/newsletter/*.ts`, `src/app/api/newsletter/*` | `_design/agentos-v2/ultraplan` | Implemented core path | Gmail/addy credential rotation and alias filtering still require owner verification. |
| Marketing widgets | `src/lib/v2/marketing/*.ts`, `src/lib/v2/widgets/*.ts` | `_design/agentos-v2/ultraplan` | Implemented | Widget-specific data-source assumptions need final owner sign-off. |
| AgentMail config and client | `src/lib/v2/agentmail/*.ts` | `_design/agentos-v2/ultraplan` | Implemented | Credentials must stay out of any public getter or UI; local config only. |
| Hermes 3D / 3D asset flow | `src/lib/v2/hermes3d/*.ts` | `_design/agentos-v2/ultraplan` | Implemented in code path | Asset provenance is still off-repo and requires local source-pack setup. |
| Role of legacy V1 modules | `src/app/*`, `src/lib/*.ts` | legacy README text | Active and mixed | Not all legacy modules are documented as V1 surfaces; some remain experimental. |

## Stale-claim and removal log

The following claims were removed or rewritten because they were not supported by the current implementation:

- Replaced the old "single-purpose, Claude/OpenClaw/Hermes-only" README with the current mixed-surface reality. The repo includes CLI agent routing, browser, marketing, newsletter, memory, tasks, and integrations; this is evident from `src/app`, `src/lib`, and the V2 surfaces under `src/lib/v2`.
- Removed the inherited "copy this folder anywhere and it is the app" framing. This is a repository checked out from Git, not a standalone binary distribution.
- Removed the hard requirement that Obsidian is a required upstream dependency for all workflows. The code has runtime settings and DB support, but not every module demands an Obsidian vault.
- Removed unsupported claims that the app is limited to macOS/Linux or that every route is a simple auto-detected agent flow. The codebase includes Windows support scripts and framework config for local runtime use.
- Replaced the old config narrative with the actual runtime configuration path: `~/.agentic-os/settings.json` and `~/.agentic-os/agentos.db`.
- Removed any claim that platform data lives in a single vendor backend; the code is self-hosted and local, but the implementation uses exactly the local filesystem and runtime config store described in `src/lib/settings.ts`.

## Installation and operation commands that are actually in the repo

These commands are present in `package.json` and are the supported local commands for this repository:

```bash
npm install
npm run dev
npm run build
npm run start
npm run version:check
npm run version:bump
npm run version:release
```

The app is designed to be run locally with a regular Node toolchain and local filesystem state, not through a remote deployment pipeline.

## Verification evidence

The repository's code paths and commands were checked against the live files:

- `package.json` defines the supported startup, build, and version commands.
- `src/app/page.tsx` confirms the app entrypoint is the `Overview` screen.
- `src/lib/settings.ts` confirms runtime settings live under `~/.agentic-os/settings.json` and are read at request time, with no rebuild required.
- `src/lib/v2/boot.ts` shows the V2 boot process that registers memory, tasks, WebMCP, integrations, browser, and newsletter jobs.
- `src/lib/v2/dbSchema.ts` confirms the V2 data model is SQLite-backed and includes the memory, tasks, event, and job tables.
- `src/app/api/v2` contains the current V2 API entrypoints grouped by memory, tasks, agents, webmcp, integrations, browser, events, and widgets.

Local validation performed in this workspace:

```bash
npm run build
```

This is the repository's current compile-time validation command. It is a local, offline validation step; it does not confirm remote provider connectivity or any externally hosted credentialed services.

In this sandbox, the build did not complete because `next/font` attempted to fetch the `Geist` and `Geist Mono` fonts from Google Fonts and the environment has no outbound access to that domain. The failure is environmental, not a code-level regression in the documentation change itself.

## Unverified / owner-checked items

The following items are either deliberately kept as placeholders or require explicit owner confirmation before being treated as a final release promise:

- Any claim that a specific third-party SaaS or external auth provider is required for all installs
- Final trust boundaries for WebMCP publishing and remote tool execution in production use
- Final decision on the exact default agent model/provider set for each module
- Final approval of OAuth callback origin and provider client configuration per machine
- Final confirmation of which browser, automation, or newsletter integrations are enabled by default on each host

## Bottom line

The current codebase is a self-hosted local dashboard with a real V2 engine under `src/lib/v2`, mixed with a larger pre-existing V1 app. This README now reflects the implementation accurately and intentionally avoids unverified marketing claims or older upstream assumptions.
