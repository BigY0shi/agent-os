# Agent-OS — Go-To-Market Plan

**Last updated:** April 2026  
**Stage:** Pre-launch (v1.0 just shipped)

---

## Model Comparison: Open Source + Paid Plugins/Monitoring vs. SaaS

Before the action plan, here's an honest head-to-head of the two most viable paths.

### Model A: Open Source Core + Paid Plugins & Remote Monitoring

**How it works:** Agent-OS core is free and MIT licensed forever. Revenue comes from a plugin marketplace (premium integrations, workflow templates, harness adapters) and a remote monitoring tier (cloud-relay that lets you observe your self-hosted instance from anywhere).

| Dimension | Assessment |
|---|---|
| **Trust** | ✅ Very high — open source builds credibility fast with technical audiences |
| **Adoption ceiling** | ✅ No friction to try — anyone can self-host in 5 min |
| **Revenue timeline** | 🟡 Slow to start — need community before marketplace has buyers |
| **Revenue ceiling** | 🟡 Moderate — plugin revenue is transactional, monitoring is sticky but competitive |
| **Complexity** | 🟢 Low to start — ship the core, build the marketplace later |
| **Competitive moat** | 🟡 Medium — plugins can be cloned, monitoring can be DIY'd |
| **Alignment with users** | ✅ Strong — builders want a free core and pay for specific capabilities |
| **Proxmox / homelabber fit** | ✅ Excellent — this audience strongly prefers self-hosted + paid addons |

**Revenue streams:**
- Plugin marketplace (one-time or subscription per plugin: $5–$49)
- Remote monitoring relay ($/month: see user's fleet from phone/browser anywhere)
- Priority support tier ($29–$99/month)
- Enterprise license (volume + SLA + custom plugins)

**Best for:** Technical homelab / developer audience. Strong GitHub presence, community-first growth.

---

### Model B: SaaS Product

**How it works:** Agent-OS is a hosted product. Users sign up, pay monthly, and get a managed instance. No self-hosting required.

| Dimension | Assessment |
|---|---|
| **Trust** | 🟡 Moderate — SaaS asks for data + payment immediately |
| **Adoption ceiling** | 🔴 High friction — credit card + signup before value is seen |
| **Revenue timeline** | ✅ Fast if you get paying users — MRR from day one |
| **Revenue ceiling** | ✅ High — MRR scales linearly with users, enterprise contracts are large |
| **Complexity** | 🔴 High — auth, billing, multi-tenancy, infra, security, compliance |
| **Competitive moat** | ✅ Strong — hosted convenience is sticky once people are in |
| **Alignment with users** | 🟡 Medium — the target audience (Proxmox/homelab builders) strongly prefers self-hosted |
| **Proxmox / homelabber fit** | 🔴 Poor fit for core audience; better fit for enterprise teams |

**Revenue streams:**
- Indie tier: $12/month (1 user, up to 25 agents)
- Team tier: $49/month (5 users, unlimited agents)
- Enterprise: $299+/month (SSO, SLA, custom harness adapters)

**Best for:** Enterprise teams and non-technical users who don't want to manage infrastructure. Requires significant upfront investment in infra and auth before launch.

---

### Recommendation

**Start with Model A, leave the door open for Model B.**

Your current audience (homelab builders, Proxmox operators, CrewAI/OpenClaw users) strongly prefers self-hosted. Forcing them through a SaaS signup will kill adoption before you build the community that a SaaS pricing model requires to work.

Model A gets you traction fast with zero friction. Once you have 500+ GitHub stars and an active Discord, you'll have real signal on whether a managed tier is something people will actually pay for. At that point, a light SaaS layer (cloud-managed Agent-OS for teams) becomes a natural v3.0 upsell — not a pivot.

**Hybrid path (recommended):**
1. v1.0–v1.5: Pure open source, no monetization. Build community.
2. v1.6: Launch plugin SDK + marketplace (Model A revenue begins)
3. v1.6: Launch remote monitoring relay ($9–$19/month)
4. v2.0: Add managed cloud tier (Model B light) for teams who don't want to self-host

---

## Monetization Modules

### Module 1: Plugin Marketplace
The plugin SDK lets developers build extensions — custom dashboard pages, harness adapters, notification integrations, workflow templates, AI-powered features. The marketplace hosts free and paid plugins.

**Revenue model:** 70/30 split (developer gets 70%, Agent-OS takes 30%)  
**Initial paid plugins to build yourself:**
- Remote monitoring relay plugin ($12/month)
- CrewAI Pro adapter (full bidirectional sync, $19 one-time)
- OpenClaw Pro adapter ($19 one-time)
- NemoClaw adapter ($19 one-time)
- Slack/Discord notification plugin ($9/month)
- Analytics export (PDF/CSV scheduled reports, $9/month)

**Timeline:** Plugin SDK in v2.0, marketplace launch at v2.0

---

### Module 2: Remote Monitoring Relay
Lets users observe their self-hosted Agent-OS fleet from anywhere — phone, browser, any network. A lightweight cloud relay that proxies status data (no agent specs or sensitive data pass through).

**Revenue model:** $9–$19/month subscription  
**Features:**
- Dashboard accessible from any device, any network
- Push notifications (agent failure, pending decisions, cost spikes)
- 30-day activity history in the cloud
- Read-only mode for observers/stakeholders

**Timeline:** v1.6 (post-community traction)

---

### Module 3: Priority Support
For power users, small teams, and builders who want guaranteed response times.

**Tiers:**
- Community: free, GitHub Discussions, best-effort
- Pro ($29/month): 48hr response, direct Discord channel, early access to releases
- Business ($99/month): 8hr response, video calls, custom deployment help

**Timeline:** Offer once GitHub Discussions become active (first 200 stars)

---

### Module 4: Enterprise License
For organizations running Agent-OS at scale — multiple instances, custom harness adapters, compliance requirements.

**Pricing:** $500–$2,000/year depending on scope  
**Includes:** Custom SLA, dedicated support, volume plugin licenses, co-development of custom adapters  

**Timeline:** First enterprise inquiry drives this — don't build until someone asks

---

## 90-Day Action Plan

### Days 1–30: Foundation

**Goal:** Make v1.0 bulletproof, build distribution.

| Week | Action |
|---|---|
| 1 | Write compelling README with animated GIF of the UI in action |
| 1 | Post launch on r/selfhosted, r/homelab, r/LocalLLaMA, r/MachineLearning |
| 1 | Post on Hacker News: "Show HN: Agent-OS — open source AI agent fleet manager" |
| 2 | Set up GitHub Discussions (Q&A, Feature Requests, Show & Tell) |
| 2 | Create a Discord server — `#general`, `#help`, `#showcase`, `#roadmap` |
| 2 | Record a 3-min demo video (Pi tablet kiosk running Agent-OS) |
| 3 | Write launch blog post: "Why I built Agent-OS" |
| 3 | Share on Twitter/X: thread showing the Pi kiosk build |
| 4 | Write tutorial: "Deploying your first CrewAI agent with Agent-OS" |
| 4 | Respond to every GitHub issue and Discussion within 24hrs |

**Target:** 100 GitHub stars, 5 active contributors/testers

---

### Days 31–60: Community + v1.1

**Goal:** Ship v1.1 polish, deepen community engagement, get first real user stories.

| Week | Action |
|---|---|
| 5 | Ship v1.1 — loading skeletons, onboarding flow, empty states, Docker |
| 5 | Ask 5 community members for live feedback sessions (30 min each) |
| 6 | Write tutorial: "Running Agent-OS on a $60 Raspberry Pi tablet" |
| 6 | Submit to awesome-selfhosted, awesome-ai-agents lists on GitHub |
| 7 | Ship v1.2 alpha — WebSocket status, run history log |
| 7 | Post on LinkedIn targeting DevOps / MLOps / platform engineering audience |
| 8 | Publish "Agent-OS vs. managing agents manually" comparison post |
| 8 | Set up a public roadmap vote (GitHub Discussions poll: what should v1.3 prioritize?) |

**Target:** 300 GitHub stars, 20+ Discord members, 3 pull requests from community

---

### Days 61–90: Traction + Monetization Alpha

**Goal:** Validate the plugin/monitoring revenue model with a small paid cohort.

| Week | Action |
|---|---|
| 9 | Ship v1.2 stable — live status, cost tracking, alerts, CrewAI adapter |
| 9 | Announce remote monitoring relay as "early access" — $9/month, waitlist |
| 10 | Direct-message top 20 GitHub stargazers: offer free Pro support tier for feedback |
| 10 | Write "How I run 47 AI agents from a Raspberry Pi" long-form post |
| 11 | Ship v1.3 — real analytics, agent versioning, performance metrics |
| 11 | Launch plugin SDK documentation + `create-agent-os-plugin` CLI scaffolder |
| 12 | Open remote monitoring relay beta to waitlist — target 10 paying users |
| 12 | Publish 90-day retrospective: what worked, what didn't, what's next |

**Target:** 500 GitHub stars, 50+ Discord members, 10 paying remote monitoring users, $90–$190/month MRR

---

## Key Metrics to Track

| Metric | Day 30 Goal | Day 60 Goal | Day 90 Goal |
|---|---|---|---|
| GitHub Stars | 100 | 300 | 500 |
| Discord Members | 20 | 50 | 100 |
| Active forks (with commits) | 3 | 10 | 20 |
| Monthly installs (inferred from clone traffic) | — | 50 | 150 |
| Paying remote monitoring users | 0 | 0 | 10 |
| MRR | $0 | $0 | $90–$190 |

---

## Distribution Channels (Ranked by Expected ROI)

1. **Hacker News Show HN** — high ceiling, technical audience, aligns perfectly
2. **r/selfhosted + r/homelab** — very high fit, Pi kiosk angle is a strong hook
3. **r/LocalLLaMA** — active AI builder community, agent tooling is a hot topic
4. **Twitter/X thread** — Pi tablet build video + fleet demo is highly shareable
5. **GitHub awesome lists** — passive, long-tail discovery
6. **YouTube** — longer-term; Pi build + Agent-OS setup tutorial could get traction
7. **LinkedIn** — for enterprise angle later; less relevant in first 90 days
8. **Product Hunt** — worth a launch post around v1.2 when live features are ready

---

## What NOT to Do in the First 90 Days

- Don't set up paid tiers before you have 200+ stars — it signals desperation and puts off the self-hosted crowd
- Don't build the SaaS tier before validating demand — it's months of infra work before you know if anyone wants it
- Don't try to compete with LangSmith or Weights & Biases — Agent-OS serves a different audience (homelab + small team self-hosters, not enterprise MLOps)
- Don't neglect GitHub issues — a responsive maintainer is the #1 factor in early community growth
