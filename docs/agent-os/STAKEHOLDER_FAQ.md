# Stakeholder FAQ

Short answers for presentation Q&A. Expand in [ECOSYSTEM_STANDUP.md](./ECOSYSTEM_STANDUP.md).

---

### What is Agent OS?

A **control plane** for a private fleet of AI agents: inventory (agents, skills, tools), memory, pipelines, approvals, and audit—surfaced on a **touch tablet** and desktop browser.

### What is the “device”?

A **Raspberry Pi** with a touch display that boots into a fullscreen Chromium **kiosk** showing Agent OS. It is the ambient operator cockpit—not where heavy agent inference runs.

### What is “firmware”?

The **software stack that boots with the device**: production Next.js app, `systemd` service, and kiosk autostart scripts (`deploy-pi.sh` / `deploy-pi-lite.sh`). Not microcontroller firmware.

### Where do the agents actually run?

On **Proxmox LXCs**—primarily **Hermes Workspace** (`192.168.0.168`) and optionally **OpenClaw**. Shared user memory is **Honcho** (`192.168.0.99:8000`).

### How is this different from ChatGPT / Claude.ai?

Those are **model chat UIs**. Agent OS manages **many agents across many runtimes**, with **governance, specs, and audit**. ChatGPT/Claude can be *model providers* behind an agent; they are not the fleet OS.

### Does it work offline?

**Yes for core governance** (agents, approvals, memory catalog, audit) on the Pi’s SQLite database. Hermes/Honcho health sync requires LAN.

### Is it secure?

Designed for a **private LAN**. Roles via API keys (`operator`, `agent-runtime`, `viewer`). Confidential memory is gated. Honcho should not be exposed to the public internet without TLS and auth. Production should set `AGENT_OS_API_KEYS`.

### What’s done vs what’s due in a week?

| Done | Due in 7 days |
|------|----------------|
| Full control-plane app + APIs | Flash Pi Bookworm |
| Deploy scripts for kiosk | systemd + Chromium kiosk working |
| Docs + demo scripts | Pass acceptance gates D1–D5 |

### What are we *not* promising this week?

Multi-agent visual orchestration (v1.2), Trixie/Wayland kiosk, public SaaS multi-tenant auth, vector semantic search.

### Who is the user?

**Yoshi** (operator). Honcho user peer is typically `yoshi`; Hermes AI peer `hermes`.

### How do I try it on a laptop today?

```bash
git clone <repo> && cd agent-os
npm ci && npm run dev
# open http://localhost:3000
```

### Where do I read more?

Start at [DOC_INDEX.md](./DOC_INDEX.md).
