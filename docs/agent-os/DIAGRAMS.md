# Agent OS — Diagrams

Copy Mermaid blocks into GitHub, Notion, Obsidian, or [mermaid.live](https://mermaid.live) for slides.

---

## 1. System context (C4 L1)

```mermaid
C4Context
title Agent OS — System Context

Person(op, "Operator", "Yoshi — tablet + desktop")
System(agentOs, "Agent OS", "Control plane: fleet, memory, governance, audit")
System_Ext(hermes, "Hermes Workspace", "Agent runtime LXC")
System_Ext(honcho, "Honcho", "User-model memory LXC")
System_Ext(openclaw, "OpenClaw", "Gateway runtime LXC")
System_Ext(models, "Model APIs", "Ollama / Anthropic / OpenAI / Google")

Rel(op, agentOs, "Approves, edits fleet")
Rel(agentOs, hermes, "Bundle, health, link-out")
Rel(agentOs, honcho, "Sync conclusions, register peers")
Rel(agentOs, openclaw, "Bundle, health")
Rel(hermes, honcho, "memory.provider=honcho")
Rel(hermes, models, "Inference")
Rel(openclaw, models, "Inference")
```

---

## 2. Physical LAN topology

```mermaid
flowchart TB
  subgraph Operator["Operator surfaces"]
    PI["Raspberry Pi tablet<br/>kiosk Chromium"]
    DESK["Desktop browser"]
  end

  subgraph Control["Control plane host"]
    AOS["Agent OS<br/>Next.js :3000<br/>SQLite"]
  end

  subgraph Proxmox["Proxmox host"]
    HERMES["LXC Hermes<br/>192.168.0.168<br/>UI :3000 · GW :8642"]
    HONCHO["LXC Honcho<br/>192.168.0.99:8000"]
    OC["LXC OpenClaw<br/>GW :18789"]
  end

  PI --> AOS
  DESK --> AOS
  AOS -->|health · sync · push| HERMES
  AOS -->|API + Bearer| HONCHO
  AOS -->|health · push| OC
  HERMES -->|LAN memory API| HONCHO
```

---

## 3. Logical planes

```mermaid
flowchart TB
  EXP["Experience<br/>Dashboard · Approvals · Memory · Pipelines · Kiosk"]
  API["Control API<br/>REST · RBAC · Audit"]
  KER["Kernel data<br/>SQLite agents · memory · pipelines · decisions"]
  ADP["Adapters<br/>Honcho · Harness bundle · MCP · Model providers"]

  EXP --> API --> KER
  API --> ADP
  ADP --> R1["Hermes"]
  ADP --> R2["Honcho"]
  ADP --> R3["OpenClaw"]
```

---

## 4. Runtime vs model vs memory (three axes)

```mermaid
flowchart LR
  A["Agent record"] --> R["Runtime<br/>hermes-workspace<br/>openclaw<br/>claude-code"]
  A --> M["Model provider<br/>ollama-cloud<br/>anthropic<br/>…"]
  A --> MID["Model id<br/>llama3.3<br/>claude-sonnet-…"]
  A --> MEM["Memory path<br/>Honcho peers<br/>+ Agent OS catalog"]
```

---

## 5. Memory source-of-truth

```mermaid
flowchart TB
  subgraph Honcho["Honcho LXC — canonical USER model"]
    P["Peer: yoshi"]
    AI["AI peers: hermes, claude, codex, gemini"]
    C["Conclusions / dialectic"]
  end

  subgraph AOS["Agent OS — canonical FLEET catalog"]
    W["working"] --> MID["mid"] --> L["long / artifact"]
    GOV["Approvals · SOPs · policies"]
  end

  subgraph RT["Harness session"]
    SCR["Scratch · tool traces"]
  end

  C -->|POST /api/honcho/sync| L
  L -.->|optional promote to peer card| C
  RT -->|retrieve| AOS
  RT -->|hybrid recall| Honcho
```

---

## 6. Governance / autonomy loop

```mermaid
sequenceDiagram
  participant Agent as Agent runtime
  participant API as Agent OS API
  participant Op as Operator (kiosk)
  participant Audit as audit_log

  Agent->>API: POST tool_proposal / model_change decision
  API->>Audit: proposal.create
  Op->>API: Approve (operator role)
  API->>API: Apply side effect (release / update model)
  API->>Audit: decision.approve + domain action
  API-->>Agent: Status approved
```

---

## 7. Harness bundle sync

```mermaid
flowchart LR
  AOS["Agent OS<br/>SQLite"] -->|GET /api/harness/bundle| PULL["harness-pull-bundle.mjs<br/>on Hermes LXC"]
  AOS -->|POST /api/harness/push| GW["Hermes / OpenClaw gateway"]
  PULL --> DIR["~/.hermes/agent-os-bundle/<br/>AGENT.md · SKILL.md · pipelines"]
  GW -.->|if ingest exists| DIR
```

---

## 8. Device boot path (firmware)

```mermaid
sequenceDiagram
  participant Power as Power on
  participant OS as Pi OS Bookworm
  participant SD as systemd agent-os
  participant NX as Next.js :3000
  participant Aut as Autostart
  participant Chr as Chromium kiosk

  Power->>OS: Boot + autologin
  OS->>SD: start agent-os.service
  SD->>NX: npm start / next start
  Aut->>Aut: Wait until localhost:3000 responds
  Aut->>Chr: --kiosk http://localhost:3000
  Chr-->>Power: Fullscreen touch UI
```

---

## 9. Phase roadmap (high level)

```mermaid
gantt
  title Agent OS delivery phases
  dateFormat  YYYY-MM-DD
  section Foundation
  Phase 0 App + SQLite           :done, p0, 2026-03-01, 14d
  Phase A Contracts              :done, pA, after p0, 14d
  section Operator UI
  Phase B Surfaces               :done, pB, after pA, 21d
  section Integration
  Phase C Runtimes + Honcho      :active, pC, after pB, 21d
  section Device
  Week device + firmware         :crit, w1, 2026-08-26, 7d
  section Ambient
  Phase D Alerts + sync workers  :pD, after w1, 30d
```

*(Adjust dates to your calendar; week bar is the presentation deadline.)*

---

## 10. C-suite fleet model

```mermaid
flowchart TB
  CEO["CEO"]
  CTO["CTO"]
  CMO["CMO"]
  CFO["CFO"]
  COO["COO"]
  CIO["CIO"]
  CHRO["CHRO"]

  CEO --- CTO
  CEO --- CMO
  CEO --- CFO
  CEO --- COO
  CEO --- CIO
  CEO --- CHRO

  CMO --> Content["Content Agent"]
  CMO --> SEO["SEO Specialist"]
  CTO --> Research["Research Agent"]
  CTO --> Deploy["Deploy Agent"]
```

---

## 11. Threat model (simple)

```mermaid
flowchart LR
  subgraph Trust["Semi-trusted"]
    RT["agent-runtime token"]
  end
  subgraph Trusted["Trusted"]
    OP["operator / admin token"]
    HOST["Pi filesystem · SQLite"]
  end
  subgraph Untrusted["Untrusted"]
    NET["Public internet"]
  end

  RT -->|scoped memory · runs| API["Control API"]
  OP -->|approvals · promote| API
  NET -.->|blocked| HONCHO["Honcho LXC"]
  HOST --> API
```

---

## Slide tips

- Prefer **§2 Physical**, **§4 Three axes**, **§6 Governance**, **§8 Boot** for a 10-minute pitch.
- Export PNG from mermaid.live at 2× for Keynote/PowerPoint.
- Keep dark background (#0a0a0a) and orange accent (#FF6B00 / #F97316) to match product UI.
