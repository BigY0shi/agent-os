# Agents

Route: `/agents` · UI: `src/components/v2/agents/AgentsPageV2.tsx` (with `AgentsHero.tsx`, `AgentCardsGrid.tsx`, `ForgeWizard.tsx`, `HarnessLibrary.tsx`, `AgentsSettings.tsx`, `AgentDetail.tsx`, `tabs/`), `ApprovalsStrip` from `src/components/AgentsView.tsx` · Backend: `src/app/api/agents/`, `src/app/api/v2/agents/`, `src/app/api/v2/harnesses/`, `src/lib/agentsStore.ts`, `src/lib/agentsRuntime.ts`, `src/lib/agentsTriggers.ts`

Reusable background agents that run on your machine and your subscriptions. The list is at `/agents`; each agent has a detail page at `/agents/<id>`. Each agent has standing instructions, a permission mode, a model tier, optional tools and triggers. Runs pause for your approval before anything risky happens.

## Tabs and controls

### Agents page (`/agents`)

| Control | What it does |
|---|---|
| **Configure** (gear, tooltip "Agents intelligence dial") | Sets the model for the **Fast tier**, **Standard tier** and **Deep tier** (blank Deep = the pinned Claude model). |
| **Configure** (gear, tooltip "Agents page") | **Hero poll interval (ms)**, **Default harness**, **Deploy gate: require a test run**, **Per-run spend ceiling** (Dollars, Tokens), **Let a run ask you a question**, **Also park when a turn merely ends in a question mark**, **Question timeout (minutes)**. |
| **New agent** | Opens the Forge wizard. |
| Live status strip | One chip per agent with its live status (running, waiting, idle, error, offline). Uses the live feed, falling back to polling. |
| **Deploy Agent** | Opens the wizard at its review step, listing agents still in Test so you can promote one. |
| **Forge Agent** | Opens the Forge wizard. |
| **Forge Harness** | Opens the harness library. |
| **Registry & Runs** | Scrolls to the registry list at the bottom. |
| Approvals strip, **Approve** / **Deny**, answer box | Pending tool approvals and questions from running agents. An answer goes straight back into the run (Ctrl+Enter). A notice says if a decision resolved nothing. |
| Agent cards | Name, harness, trigger summary, last run. Click to open `/agents/<id>`. |
| **Forge the first one** | Shown when there are no agents. |
| Registry & Runs rows | Last run per agent (trigger, status, age). Click opens `/agents/<id>?tab=runs`. |

### Forge wizard

Steps: **Idea**, **Persona**, **Harness**, **Tools**, **Connectors**, **Permissions**, **Triggers**, **Review**; **Next** and back.

| Control | What it does |
|---|---|
| Name, one-liner, instructions, **Draft with AI** | The instructions become the agent's `system.md`. Draft with AI tightens them (`/api/v2/agents/draft`). |
| Writing persona checkbox and fields | Persona name, voice rules, audience, banned phrases, CTA style. Stored as data and injected whatever the provider. |
| Harness cards, **Forge Harness** | Pick a harness (run structure) or make one. |
| **Inherit MCP servers** / **No MCP**, **Browser tools**, browser sessions, WebMCP tool packages | Tools the agent may use. |
| Connectors | Integration accounts the agent may use. |
| Permission mode, intelligence tier, Provider **sdk** / **cli** / **ollama** | cli and ollama need a CLI name or Ollama model and fail loudly if unreachable. The ollama provider talks to the **Local Ollama URL** (and sends the Ollama Cloud key when one is saved) from the Ollama Cloud page's gear, else `OLLAMA_URL` / `OLLAMA_API_KEY`. |
| Trigger editor | When the agent runs. |
| **Create in Test** | Creates the agent in Test: triggers stay parked, manual runs work. |
| **Run test**, **Deploy**, **Deploy anyway**, **Open agent** | Fire a test run (its approvals and transcript show inline), then deploy. Deploy anyway overrides the test-run gate for this deploy only. |
| **Repair provisioning** | Shown if browser tools could not be provisioned. |

### Harness library

| Control | What it does |
|---|---|
| **New harness**, **Edit**, **Exile**, **show exiled** | Manage harnesses. Built-in harnesses can be edited but not exiled. |
| Editor | Name, description, **System preamble**, loop settings (max iterations, stop marker, review prompt), phases (name, prompt, approval before the phase), and a raw JSON toggle. Validated on save. |

### Agent detail (`/agents/<id>`)

| Control | What it does |
|---|---|
| **Agents** | Back to the list. |
| **Run now** | Starts a manual run. |
| **Pause** / **Resume** | Disables or enables the agent. |
| **Overview** | Lifecycle, harness and persona cards, **Run now**, **Exile agent**. |
| **Runs** | Run list with transcript, browser sessions this agent drove, status history. |
| **Approvals** | This agent's pending cards. |
| **Settings** | Identity, **Instructions (system.md)** with **Save**, harness, writing persona with **Save persona**, provider with **Save provider**, browser sessions, and a **Danger zone** with **Exile agent**. |

## How it works

- Each agent is a folder under `~/.agentic-os/agents/<id>/`: `agent.json`, `system.md`, `skills/`, `memory/`, `runs/<runId>.jsonl` (the full event stream), `workspace/` (the run's working folder) and `cursors.json` (trigger state). Exiling moves the folder to the exile area; nothing is hard-deleted.
- The default `sdk` provider runs the Claude Agent SDK, one query per run. Every tool call passes a permission gate; "queue" decisions park the run until you approve in the approvals strip. The SDK's own bypass mode is never used.
- Triggers fire only for deployed agents. The deploy gate can require a finished test run first.
- Live status comes from `/api/v2/agents/status` (server-sent events, with polling as fallback).
