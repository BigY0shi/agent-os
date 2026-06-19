# Agent OS

Harness-agnostic command center for agent fleets: agents, skills, tools, memory, pipelines, approvals, and Pi-friendly deployment.

## Docs

- [docs/agent-os/ARCHITECTURE.md](docs/agent-os/ARCHITECTURE.md) — control plane layers & threat model  
- [docs/agent-os/MEMORY_MODEL.md](docs/agent-os/MEMORY_MODEL.md) — shared memory layers  
- [docs/agent-os/SKILL_PIPELINE_SPEC.md](docs/agent-os/SKILL_PIPELINE_SPEC.md) — pipeline JSON  
- [docs/agent-os/GOVERNANCE.md](docs/agent-os/GOVERNANCE.md) — roles & API keys  
- [docs/agent-os/INTEGRATIONS.md](docs/agent-os/INTEGRATIONS.md) — memory backends & harness adapters  
- [docs/agent-os/PHASE_B_PLAN.md](docs/agent-os/PHASE_B_PLAN.md) — Phase B goals & win gates  
- [docs/agent-os/MODEL_PROVIDERS.md](docs/agent-os/MODEL_PROVIDERS.md) — runtime vs API model providers (B3)  
- [docs/agent-os/PROXMOX_RUNTIME_STACK.md](docs/agent-os/PROXMOX_RUNTIME_STACK.md) — Hermes Workspace (:3000), OpenClaw, Honcho LXCs  
- [docs/agent-os/HONCHO.md](docs/agent-os/HONCHO.md) — shared memory across harnesses  
- [docs/harness-sdk.md](docs/harness-sdk.md) — runtime bundle format  

## Dev

```bash
npm install
npm run dev
```

Set optional env for API auth (JSON map of token → role):

`AGENT_OS_API_KEYS='{"your-secret":"operator"}'`

Runtime health probes (LAN defaults; override on deploy):

```bash
AGENT_OS_HERMES_UI_URL=http://192.168.0.168:3000
AGENT_OS_HERMES_GATEWAY_URL=http://192.168.0.168:8642
AGENT_OS_HONCHO_URL=http://192.168.0.99:8000
```

`GET /api/runtimes/health` — also included on the home dashboard as status pills.

## Deploy

See `deploy-pi.sh`, `ROADMAP.md`, and `HANDOFF.md`.
