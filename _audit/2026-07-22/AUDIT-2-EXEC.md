# Audit Pass 2 — Executive Assistant lens ("best all-in-one Founder's Mission Control")
Question this pass answers: *given who Robby actually is and what he does day to day, which modules earn their place, where's the synergy, and what's missing?* Value tiers: 🟢 core-to-mission · 🟡 situational · 🔴 vanity/dead-weight · ✨ proposed-new.

## High-confidence user truths (ONLY very-high-confidence signals — the lens for every judgment below)
1. **Solo founder/operator.** Robby Denton (robbyjdenton@gmail.com). One human, many agents. Time is the bottleneck, not ideas.
2. **Core business = AI-automation consulting, "Augment-the-Hire."** One-time ~$2,500 setup that ramps a new hire to ~90-day productivity by automating the repetitive 40-60% of their job. Foot-in-the-door → retainer. Do NOT pitch "replace."
3. **Build-once-sell-N productization.** CS Triage & Draft Engine = "machine #1" (done, judged). Shared spine INGEST→CLASSIFY→RETRIEVE→DRAFT→ROUTE→HUMAN-APPROVE→SEND/LOG. SDR/Ops/EA machines planned to reuse it.
4. **B2B lead pipeline is real and operating.** Upwork + RemoteOK/WWR/Reddit scrape → LLM score → Hunter verify → **Gmail drafts, approval-gated, never auto-send** (the hard rule). Signs "Robby."
5. **Serious homelabber.** Proxmox cluster, self-hosts umbrelOS on LXC. Real infra skill + an outreach credibility asset (esp. self-host/privacy ICPs).
6. **Multi-CLI-agent maximalist, subscription-first.** Runs claude/codex/cursor/pi/hermes/antigravity/openclaw/ollama. Wants his subscriptions, not per-token API keys (only Ollama Cloud/paste-your-own keys tolerated). This is the app's whole design axis.
7. **Windows 11 always-on host** (desktop-u82pdau), LAN + Tailscale exposed; the app runs where the CLIs are authed.
8. **Prefers Opera** over Chrome.
9. **Builds games on the side** (Unity "Let's Start a Cult!", Unreal Engine) — separate repos, not this app's job, but part of his week.
10. **Creator-economy literate.** Analyzed 154 AI-money YouTube transcripts; thesis = teach free, sell community, augment-not-replace.
11. **Operating values (from the rules engine):** full autonomy minus irreversible loss (exile, never delete); human-in-the-loop on anything outbound/destructive; recurring workflow → capture as a skill; every claim/identifier must cite a this-session artifact (verification gate).

## The founder's actual flywheel (what the cockpit SHOULD orbit)
`FIND leads → VERIFY → PITCH (augment offer) → DELIVER an automation → PRODUCTIZE it as a reusable "machine" → sell it N times`. Everything else is either (a) the substrate that powers it (multi-agent orchestration, vault/memory) or (b) not this app's job. The test for every module: *does it move a dollar down this flywheel, or is it a toy that wandered in?*

## Module → mission map (31 nav items, judged against the flywheel + module health from Pass 1)
### 🟢 Core (the money + the second brain) — protect & polish these
| Module | Why it's core | Health (Pass 1) |
|---|---|---|
| **Deal Desk** | THE money module — Upwork lead triage + AI proposal drafting, the top of the consulting funnel | Live; elevator-pitch line still missing; board 3-4wk stale, no last-sync |
| **Leads** | B2B prospecting engine — find/verify/score ICP contacts | Live, CLEAN (no auto-send, matches the hard rule); silent Hunter-key no-op |
| **Pipeline** | idea→approve→build→ship deliverable = the "machine"-builder spine | Live, provider routing works; misleading error copy |
| **Loop** | autonomous build-until-passing loop = how machines get built | Live but the worst bug cluster (abort, >32k, Rule-11 silent fallback) |
| **Memory** | Obsidian vault search + graph = his second brain / substrate | Live, Windows-safe; hardcoded "1261 omi · 186 notes" counts |
| **Mission Control (home)** | should be the morning cockpit | **Demo shell — fabricated telemetry (P0 of Pass 1)** |

### 🟡 Situational (real utility, not the core loop) — keep, tidy, don't invest heavily
Notebook (NotebookLM research — real), Kanban (Hermes task DB viewer — real), AI Agent Mastermind /room (multi-agent decision debates — the mechanism THIS audit uses), Paperclip (external app launcher — 3/4 backend routes dead), SEO (his own sites; 0 configured here), Agent Kanban (demo-builder — overlaps Pipeline), Thumbnails (creator-content; default backend lies about saving).

### 🔴 Vanity / hobby / broken-for-a-consultant — candidates to cut, hide, or spin out
Video (**broken end-to-end** — Unix binary path), Music (Suno hobby; cookie backend fake), Games (HTML-game toy; he does real gamedev in Unity/Unreal elsewhere), Open Design (design-app launcher, niche), Guide + SEO-Guide (one-time onboarding docs), Sakana Fugu / Fusion (extra model panels), Local + Local Engine (two offline-chat surfaces). None move the flywheel; several are dead.

### 🔴🔴 The 13-agent tab sprawl (biggest single consolidation target)
The "Agents" group is **13 near-identical chat surfaces** for one pattern (prompt→CLI→render): claude, openclaw, hermes, antigravity, codex, cursor, pi, ollama, freeclaude, fusion, sakana, local, engine. Add Jarvis (3 more Hermes chat paths) + UnifiedChat + MiniMaxVoiceAgent + per-module studios → **the app has ~20 ways to talk to an agent.** A founder needs ONE great chat with an agent-picker, not 13 tabs to maintain. This is where most of the app's dead weight and duplicate-maintenance lives.

## Synergy gaps (things that SHOULD connect but don't)
1. **Leads → Deal Desk is a manual re-keying, not a pipe.** Two separate prospecting systems (Leads finds+verifies; Deal Desk triages Upwork) with zero shared code. The flywheel's first two stages don't touch.
2. **Deal Desk → CS Engine / "machines" has no bridge.** When a pitch lands, there's no path from "won deal" → "spin up the machine for this client." The productization spine (CS Engine, machine #1) lives in a *different repo* the dashboard can't see.
3. **The vault is under-leveraged as memory-for-agents.** Memory module can search it, but agents driven from the cockpit don't get client context injected. Every proposal starts cold.
4. **No revenue/pipeline truth anywhere.** The home page fabricates cost/tokens but there is no real "deals in flight / $ pipeline / hours saved" view — the one number a founder actually wants each morning.
5. **Outreach approval gate lives in Gmail, off-dashboard.** The hard rule (draft, never auto-send) is honored, but the human-in-the-loop step happens in another app — the cockpit can't show "3 drafts awaiting your review."

## Proposed new / reshaped modules (draft — Council #2 stress-tests these)
- ✨ **Founder Cockpit (rebuild the home page):** replace fabricated telemetry with the 5 numbers that matter — deals in flight, drafts awaiting approval, active agent runs (real /api/activity), $ pipeline, this-week's shipped machines. Honest > impressive.
- ✨ **Deal Flow (merge Leads + Deal Desk):** one funnel — find → verify → draft → approve → won → handoff. Close synergy gap #1 + #5.
- ✨ **Machine Shop (productization tracker):** the build-once-sell-N registry — each "machine" (CS Engine, SDR, Ops, EA), which clients run it, deploy checklist state. Closes gap #2. This is his actual business model, and it's invisible in the cockpit.
- ✨ **One Agent Console (collapse the 13 tabs):** a single chat with an agent-picker + workspace, retiring the per-agent tabs. Massive maintenance win.
- 🔁 **Spin creative studios (Video/Music/Games) into an optional "Studio" bundle** behind one nav entry, or exile — they don't serve the consulting mission and several are broken.

(Council #2 to rule on: consolidation aggression, the single highest-leverage build, and what the morning cockpit shows.)
