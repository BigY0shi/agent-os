# Agent OS — One-page project brief

*Print this page. Pair with [EXECUTIVE_OVERVIEW.md](./EXECUTIVE_OVERVIEW.md).*

---

## Mission

Stand up a **persistent, ambient, agentic** private fleet: always-on runtimes, shared user memory, and a touchable control plane with approvals and audit.

## Stack at a glance

| Piece | Role | Address / form |
|-------|------|----------------|
| **Agent OS** | Control plane (firmware) | Next.js + SQLite · Pi kiosk / desktop |
| **Hermes Workspace** | Primary agent runtime | `192.168.0.168:3000` · GW `:8642` |
| **Honcho** | Long-term user model | `192.168.0.99:8000` · peer `yoshi` |
| **OpenClaw** | Optional runtime | Gateway ~`:18789` |
| **Models** | Inference | Ollama Cloud/local, Anthropic, OpenAI, Google |

## Principles

1. **Persistent** — memory & audit survive sessions  
2. **Ambient** — glanceable Pi kiosk, not terminal babysitting  
3. **Agentic** — agents propose; humans approve elevated actions  
4. **Split axes** — runtime ≠ model ≠ memory  

## Week deliverable

**Device + working firmware:** Pi boots to fullscreen Agent OS; approve → audit; reboot survives.

## Built already

Fleet · Memory OS · Pipelines · Governance · Model providers · Audit · Runtime health · Honcho sync · Harness bundles

## Docs

[DOC_INDEX.md](./DOC_INDEX.md) · [PRESENTATION.md](./PRESENTATION.md) · [WEEK_1_DEVICE_FIRMWARE.md](./WEEK_1_DEVICE_FIRMWARE.md) · [ECOSYSTEM_STANDUP.md](./ECOSYSTEM_STANDUP.md)

---

**Contact / owner:** Yoshi  
**OS constraint:** Raspberry Pi OS **Bookworm** 64-bit (not Trixie for kiosk)
