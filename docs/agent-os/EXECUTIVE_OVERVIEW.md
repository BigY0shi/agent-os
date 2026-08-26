# Agent OS — Executive overview

**Product:** Private ambient agent fleet control plane  
**Form factor:** Raspberry Pi tablet (kiosk) + desktop browser + Proxmox LXC runtimes  
**Owner:** Yoshi · **Status:** Software control plane live; device firmware (Pi kiosk image) due in **7 days**  
**One-line pitch:** *A touch dashboard that governs always-on AI agents the way an OS governs processes—with memory, permissions, and audit.*

---

## The problem

AI agents today are **session-shaped**: chat windows, CLI tools, and ad-hoc scripts that forget context, scatter credentials, and have no shared governance. An operator with Hermes, OpenClaw, Claude Code, Codex, and Gemini ends up with:

- Five places to check “what happened?”
- No single source of truth for agent specs
- No approval path when an agent wants a new tool or model
- Memory that dies when a session ends

## The solution

**Agent OS** is the **control plane** for a private agent fleet:

| Layer | What it does |
|-------|----------------|
| **Device (Pi kiosk)** | Ambient operator surface — glanceable status, approve/reject, fleet edit |
| **Firmware (this app)** | Next.js + SQLite service that boots with the device |
| **Runtimes (LXCs)** | Hermes Workspace, OpenClaw — where agents actually execute |
| **Memory (Honcho)** | Shared long-term user model across harnesses |

Agents propose. Humans (or policy) approve. Everything is audited.

---

## What “device + working firmware” means (week deadline)

| Term | Concrete deliverable |
|------|----------------------|
| **Device** | Raspberry Pi (Bookworm 64-bit) + touch display, powered, on LAN |
| **Firmware** | Production Agent OS (`systemd` service) + Chromium **kiosk** autostart |
| **Working** | Boot → kiosk UI → dashboard health pills → approve a decision → audit row |

*Not required for week-1 exit:* full Hermes/Honcho live integration on the Pi (nice-to-have if LAN already up).

---

## Value props (for stakeholders)

1. **Ambient** — Walk past the tablet; see fleet status without opening a laptop.
2. **Persistent** — Memory layers + Honcho + audit survive restarts.
3. **Governed** — Tool publish, model change, infra changes go through approvals.
4. **Harness-agnostic** — Same AGENT.md / SKILL.md bundle for Hermes, OpenClaw, CLIs.
5. **Deployable** — One codebase: Pi kiosk, desktop, or VM.

---

## Architecture in 30 seconds

```text
[ Pi tablet / browser ]  →  Agent OS (control plane)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
               Hermes LXC      Honcho LXC      OpenClaw LXC
               (runtime)       (user memory)   (runtime)
```

**Split axes (critical):**

- **Runtime** ≠ **model** (Hermes vs Ollama Cloud)
- **Honcho memory** ≠ **fleet memory** (who the user is vs what the company must know)

---

## What’s already built (software)

| Capability | Status |
|------------|--------|
| Agent fleet (C-suite departments) + AGENT.md export | ✅ |
| Skills / tools / MCP inventory + SKILL.md | ✅ |
| Memory OS (layers, promote, agent attach) | ✅ |
| Multi-step pipelines + run console | ✅ |
| Governance (proposals, safety, goals, model change) | ✅ |
| Model providers registry | ✅ |
| Audit explorer | ✅ |
| Runtime health, Honcho sync, harness bundle push/pull | ✅ |
| Pi deploy scripts (`deploy-pi.sh`, `deploy-pi-lite.sh`) | ✅ |

Deep dive: [ECOSYSTEM_STANDUP.md](./ECOSYSTEM_STANDUP.md) · [PHASE_B_DEMO.md](./PHASE_B_DEMO.md) · [V1_1.md](./V1_1.md)

---

## Week-1 milestone (demo for stakeholders)

**Title:** *Device boots into Agent OS kiosk; operator can govern the fleet offline or on LAN.*

### Must demo

1. Power on Pi → Chromium kiosk loads Agent OS (no desktop chrome).
2. Touch: open Agents, Approvals, Memory, Dashboard.
3. Approve a pending decision → appears in Audit.
4. Runtime pills show configured endpoints (green if Hermes/Honcho reachable).

### Stretch

5. Sync Honcho → Memory OS.
6. Export / push agent bundle.

Full plan: [WEEK_1_DEVICE_FIRMWARE.md](./WEEK_1_DEVICE_FIRMWARE.md)

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Wrong Pi OS (Trixie) breaks kiosk | **Bookworm only** — scripts warn and refuse |
| Touch calibration flaky | Document `xinput_calibrator`; keep USB keyboard for demo |
| LAN / Honcho unreachable at venue | Demo works **offline** on SQLite seed data |
| Scope creep (full multi-agent orchestration) | Defer v1.2; week exit = **device + firmware only** |

---

## Ask / next after week 1

- Harden production API keys on the Pi.
- Cron pull of harness bundles on Hermes LXC.
- Register Claude/Codex/Gemini as Honcho peers.
- Optional: second kiosk or wall-mount display.

---

## Document pack (presentation)

| Doc | Use |
|-----|-----|
| **This file** | Leave-behind / one-pager |
| [PRESENTATION.md](./PRESENTATION.md) | Slide outline + speaker notes + live demo script |
| [DIAGRAMS.md](./DIAGRAMS.md) | Mermaid figures for slides / Notion / GitHub |
| [WEEK_1_DEVICE_FIRMWARE.md](./WEEK_1_DEVICE_FIRMWARE.md) | Day-by-day build & acceptance |
| [ECOSYSTEM_STANDUP.md](./ECOSYSTEM_STANDUP.md) | Full engineering north star |
| [DOC_INDEX.md](./DOC_INDEX.md) | Master index of all docs |

---

*Confidential — internal project overview.*
