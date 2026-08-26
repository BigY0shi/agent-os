# Agent OS — Presentation & speaker notes

**Audience:** Stakeholders / advisors / teammates  
**Length:** 12–15 minutes talk + 5 minute live demo + Q&A  
**Props:** Pi tablet (primary), laptop backup, printed one-pager

---

## Slide outline (12 slides)

### Slide 1 — Title

**Agent OS**  
*Ambient control plane for a private AI agent fleet*

Device + working firmware · Week delivery

**Say:** “This is the tablet that runs the company of agents—and the software that boots with it.”

---

### Slide 2 — Problem

- Agents live in chat windows and CLIs
- Context dies with the session
- No shared approvals, audit, or specs
- Multiple harnesses = multiple truths

**Say:** “We don’t need another chatbot. We need an operating system for agents.”

---

### Slide 3 — Vision (one sentence)

Persistent · Ambient · Agentic · Harness-agnostic

**Say:** “Always-on runtimes on Proxmox; one tablet for governance; one user model in Honcho; one fleet catalog in Agent OS.”

---

### Slide 4 — What we ship this week

| Device | Firmware |
|--------|----------|
| Raspberry Pi + touch display | Agent OS production service |
| Bookworm 64-bit | systemd + Chromium kiosk |
| LAN optional | Offline governance works |

**Say:** “Firmware means the bootable app stack—not microcontroller code.”

---

### Slide 5 — Architecture (use DIAGRAMS §2)

Show physical topology: Pi → Agent OS → Hermes / Honcho / OpenClaw

**Say:** “The Pi is the cockpit. Hermes is the engine room. Honcho is long-term memory about *me*. Agent OS is policy and inventory.”

---

### Slide 6 — Three axes (critical insight)

1. **Runtime** — where it runs (Hermes, OpenClaw, Claude Code)
2. **Model** — who answers (Ollama Cloud, Anthropic, …)
3. **Memory** — Honcho user model vs fleet SQLite catalog

**Say:** “Mixing these three is how every agent dashboard gets confusing. We refuse that conflation.”

---

### Slide 7 — Control plane features (already built)

- Fleet (C-suite departments) + AGENT.md / SKILL.md
- Memory OS · Pipelines · Governance · Model providers · Audit
- Runtime health · Honcho sync · Bundle push/pull

**Say:** “Software is ahead of the device. This week we put the software on glass.”

---

### Slide 8 — Governance loop

Agent proposes → Decision queue → Operator approves on tablet → Audit

**Say:** “Autonomy with a seatbelt. Tools and model changes don’t silently ship.”

---

### Slide 9 — Device boot path (DIAGRAMS §8)

Power → systemd → Next.js → Chromium kiosk

**Say:** “From cold power to fullscreen UI without touching a keyboard—that’s the firmware bar.”

---

### Slide 10 — Live demo script (5 min)

See § Live demo below. Do not improvise new features.

---

### Slide 11 — Week plan & risks

Point to [WEEK_1_DEVICE_FIRMWARE.md](./WEEK_1_DEVICE_FIRMWARE.md) gates D1–D5  
Risks: Trixie OS, touch fail, LAN down → mitigations ready

---

### Slide 12 — Ask / next

- Accept week-1 DoD
- After: production keys, Hermes cron pull, Honcho peers for CLIs
- Optional second display / wall mount

---

## Live demo script (≤ 5 minutes)

**Setup:** Pi kiosk on, seeded DB, USB keyboard under table.

| Time | Action | Narration |
|------|--------|-----------|
| 0:00 | Power cycle Pi (or show already-booted kiosk) | “Cold boot into Agent OS—no desktop.” |
| 0:45 | Dashboard — point at runtime pills | “Health of Hermes and Honcho if LAN is up; otherwise offline fleet still works.” |
| 1:15 | Agents → Content Agent → Memory / Governance tabs | “Each agent has goals, model, runtime—edited on-device.” |
| 2:15 | Approvals → approve a pending decision | “Elevation requires a human.” |
| 3:00 | Audit → show the approve row | “Every mutation leaves a trail.” |
| 3:45 | Memory → add quick note OR show Honcho sync if stretch | “Fleet memory lives here; user memory syncs from Honcho.” |
| 4:30 | Stop | “That’s the device + firmware. Questions?” |

**Backup:** Laptop `npm run start` on same repo; cast screen.

---

## Anticipated Q&A

| Question | Answer |
|----------|--------|
| Is this ChatGPT with a UI? | No—control plane for *many* harnesses; ChatGPT is one possible model provider. |
| Where do agents run? | Proxmox LXCs (Hermes/OpenClaw), not on the Pi. Pi is operator surface + API. |
| What if the Pi dies? | Same app runs on desktop/VM; SQLite backup; agents keep running on LXCs. |
| Is Honcho required for demo? | No for D1–D5. Required for ambient multi-harness memory. |
| Security? | Private LAN; API keys for roles; confidential memory gated; Honcho not public. |
| Open source? | Your repo; patterns inspired by public AgentOS projects—see INTEGRATIONS bibliography. |
| Timeline after week 1? | Harden keys → Hermes pull cron → CLI Honcho peers → alerts (Phase D). |
| Why not Trixie? | Wayland breaks current kiosk scripts; Bookworm is the supported firmware base. |

---

## Leave-behind checklist

- [ ] Printed / PDF [EXECUTIVE_OVERVIEW.md](./EXECUTIVE_OVERVIEW.md)
- [ ] Link to repo `docs/agent-os/DOC_INDEX.md`
- [ ] Device handoff sticker (hostname, IP, SSH, “Bookworm only”)
- [ ] 60s backup video of demo path

---

## Timing cheat sheet

| Segment | Minutes |
|---------|---------|
| Problem + vision | 3 |
| Architecture + axes | 3 |
| What’s built | 2 |
| Week device plan | 2 |
| Live demo | 5 |
| Ask + Q&A | 5+ |

---

## Related

- [EXECUTIVE_OVERVIEW.md](./EXECUTIVE_OVERVIEW.md)
- [DIAGRAMS.md](./DIAGRAMS.md)
- [WEEK_1_DEVICE_FIRMWARE.md](./WEEK_1_DEVICE_FIRMWARE.md)
- [PHASE_B_DEMO.md](./PHASE_B_DEMO.md)
- [ECOSYSTEM_STANDUP.md](./ECOSYSTEM_STANDUP.md)
