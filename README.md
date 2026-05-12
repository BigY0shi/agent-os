# Agent OS

Harness-agnostic command center for agent fleets: agents, skills, tools, memory, pipelines, approvals, and Pi-friendly deployment.

## Docs

- [docs/agent-os/ARCHITECTURE.md](docs/agent-os/ARCHITECTURE.md) — control plane layers & threat model  
- [docs/agent-os/MEMORY_MODEL.md](docs/agent-os/MEMORY_MODEL.md) — shared memory layers  
- [docs/agent-os/SKILL_PIPELINE_SPEC.md](docs/agent-os/SKILL_PIPELINE_SPEC.md) — pipeline JSON  
- [docs/agent-os/GOVERNANCE.md](docs/agent-os/GOVERNANCE.md) — roles & API keys  
- [docs/harness-sdk.md](docs/harness-sdk.md) — runtime bundle format  

## Dev

```bash
npm install
npm run dev
```

Set optional env for API auth (JSON map of token → role):

`AGENT_OS_API_KEYS='{"your-secret":"operator"}'`

## Deploy

See `deploy-pi.sh`, `ROADMAP.md`, and `HANDOFF.md`.
