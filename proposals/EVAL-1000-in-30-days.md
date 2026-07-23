# Evaluation — 25 Proposals vs. "An Agent Makes $1,000 in 30 Days"

**Date:** 2026-07-01
**Evaluator lens:** Can an AI agent (supervised, not fully autonomous) drive this to **$1,000 of real revenue within 30 days**?
**Source of the bar:** `AI-Money-Research/MONEY-REPORT.md` already established two truths this evaluation leans on:
1. *"Freelancing / done-for-you AI services via Upwork + cold email is the fastest validated path to a first $1,000."*
2. *"AI fails when it does ALL the thinking (generic output) and succeeds only when a human supplies judgment/taste/relationships and uses AI to execute faster."*

So the winning shape is **narrow, supervised, service-style, sold via outreach** — not hardware, not "autonomous agent," not audience-dependent subscriptions.

---

## Scoring rubric (each 0–3, composite /9)

- **AE — Agent-Executable:** 3 = an agent does ~all the work; 0 = requires physical fab, fulfillment, licensing, or heavy human labor the agent can't touch.
- **MK — $1k Reachable:** 3 = one or two sales clears $1k; 0 = economics don't get there in the window.
- **T30 — Revenue in 30 days:** from the master doc's time-to-revenue (≤4wk = 3, ~1mo = 2, 1–2mo = 1, >2mo = 0).

A proposal must score **well on all three** to fit the bar. A high AE with T30=0 (great for an agent but slow) does not qualify.

---

## Scores (ranked)

| # | Proposal | AE | MK | T30 | Σ/9 | Verdict for THIS bar |
|---|----------|----|----|-----|-----|----------------------|
| 10 | ElevenLabs Outbound Cyber Audit Campaign (B2B) | 3 | 2 | 3 | **8** | **Best fit** — but see compliance flag |
| 8 | Custom PCB Design-as-a-Service | 2 | 2 | 2 | 6 | Possible — niche demand, agent does design |
| 17 | AI Agent Security Audit Service | 2 | 3 | 1 | 6 | Highest ticket, most defensible; too slow for 30d |
| 19 | PayloadsCo "Daily Dose" email | 3 | 1 | 2 | 6 | Agent runs it fully; monetization needs an audience first |
| 12 | HackerOutlet "Mystery Box" | 1 | 2 | 2 | 5 | Fails AE — real inventory + fulfillment |
| 15 | YoshiCorp "Black Card" VIP sub | 2 | 1 | 2 | 5 | Needs an existing base to sell to |
| 22 | Affiliate / Reseller Program | 2 | 1 | 2 | 5 | Docs are agent-made; revenue waits on recruited resellers |
| 13 | SEO Content Farm (100 articles) | 3 | 1 | 0 | 4 | Agent-native, but revenue is indirect and 3–4mo out |
| 14 | YouTube / TikTok Shorts | 2 | 1 | 1 | 4 | Monetization gated by views threshold |
| 21 | "Breach & Build" Workshop | 1 | 2 | 1 | 4 | Ships hardware + live teaching |
| 25 | Pentest Reporting Automation Tool | 2 | 2 | 0 | 4 | SaaS build; no revenue inside 30d |
| 4 | HackN Pro course + cert | 1 | 2 | 0 | 3 | Needs authority + audience |
| 6 | AI Phishing Sim SaaS | 1 | 2 | 0 | 3 | XL build, 3–4mo |
| 3 | Red Team in a Box (sub kit) | 0 | 1 | 1 | 2 | Hardware kitting |
| 9 | Flipper Payload Marketplace | 1 | 1 | 0 | 2 | Platform build |
| 11 | DEF CON Pop-Up Store | 0 | 1 | 1 | 2 | Physical goods, seasonal |
| 16 | CTF Hosting Platform | 1 | 1 | 0 | 2 | Build-heavy |
| 20 | FIDO2 Security Key | 0 | 2 | 0 | 2 | Hardware + firmware |
| 23 | OSS Firmware + Paid Flashing | 0 | 1 | 1 | 2 | Physical service |
| 24 | TQP Comic / Motion Comic | 1 | 1 | 0 | 2 | Content + art, slow |
| 1 | Flipper ESP32 Backpack | 0 | 1 | 0 | 1 | Hardware, 2–3mo |
| 2 | Malicious USB-C Cable Kit | 0 | 1 | 0 | 1 | Hardware + dual-use legal |
| 5 | TQP Skins / DLC | 0 | 1 | 0 | 1 | Needs a shipped game |
| 7 | RFID/NFC Cloner Bundle | 0 | 1 | 0 | 1 | Hardware |
| 18 | Maker Kit Bundles | 0 | 1 | 0 | 1 | Hardware |

---

## The honest read

**Only one of the 25 (#10) clears all three filters — and it carries a compliance flag.** The list was built for a *different* goal ("20 fresh money-makers, any timeframe"), so grading it on agent + $1k + 30 days is inherently unkind. The pattern of failure is consistent and instructive:

- **Hardware plays (≈8 of 25) fail AE and T30 outright.** Fab lead times, BOM, inventory, and fulfillment are things an agent cannot do and cannot compress into 30 days. Every hardware proposal lands at Σ ≤ 2.
- **Subscription / content / audience plays fail MK or T30.** Daily Dose (#19), Black Card (#15), the course (#4), Shorts (#14), SEO farm (#13) are all agent-friendly to *produce*, but the money depends on an audience that doesn't exist yet. You can't monetize a list in 30 days that you're also building in those 30 days.
- **SaaS builds (#6, #16, #25) fail T30.** An agent can build them; nobody pays inside the window.

### What actually wins

1. **#10, reframed as a written deliverable, not a robo-call.** The agent-native core is real: scrape targets → recon their public posture → draft a specific, personalized outbound → deliver a **written cyber-posture audit report** as the paid artifact. One or two SMB reports at ~$500–750 clears $1k. **This is the only proposal that is genuinely agent-executable, high-margin, and fast.**
   - **Compliance flag:** the *ElevenLabs voice cold-call* mechanism is TCPA/robocall-exposed and is exactly the dual-use surface `LAU-13-compliance-risk-review.md` exists to gate. Drop the AI-voice-call channel; use written outreach (email/LinkedIn) + a written report. This also aligns with the "human supplies relationships/judgment" rule — you approve every send and sign off on every report.

2. **The thing that beats all 25 is already built.** Per `PROJECT-INDEX.md` #1–#2, the **CS Triage engine + Batch #1 outreach** is the textbook instance of MONEY-REPORT's #1 validated path (done-for-you AI service, sold by cold outreach, human-in-the-loop). It is built, tested, has 8 named warm leads, and a single deploy (6–10h of work) is worth more than $1k. If the literal goal is "$1,000 in 30 days," this is the answer — not a new proposal.

3. **#8 and #17 are real but need a human closer.** PCB-DaaS (#8) and the AI-Agent Security Audit (#17) are legitimately agent-heavy and high-margin, but both are gated by **credibility and a sales conversation**, not by build effort. #17 is the best *long-term* money (the $5k-audit → $50k-build tier MONEY-REPORT calls the most defensible), just not a 30-day play.

### The uncomfortable meta-finding

None of the 25 was conceived as an "agent makes $1k in 30 days" play, and it shows. The proposals optimize for *cool* (offensive-security hardware, branded gear) over *fast-and-supervised-service*. Your own research already named the winning shape; the proposal set drifted away from it. If you want a **new** idea that fits the bar, don't mine this list — productize the audit. Which is exactly what the two new harness profiles (`business-analysis`, `marketing`) were built to mass-produce.

---

## Recommendation

- **For the literal $1k/30d goal:** run PROJECT-INDEX #1–#2 (CS engine deploy + Batch #1). Nothing here beats it.
- **For a NEW agent-driven offer from this list:** take **#10 → "AI-assisted Cyber Posture Audit report,"** written-outreach only, and generate it with the `marketing` / `business-analysis` harness profiles. This is the single defensible pivot from the 25.
- **Shelve for this bar (revisit later):** #17 and #6 as the high-ticket security-SaaS lane (months, not weeks); all hardware as the PayloadsCo long game already pinned to the bottom of the triage.

*This evaluation grades against a narrow bar (agent + $1k + 30 days). Several low-scoring proposals are perfectly good businesses on a longer horizon — see PROPOSALS-MASTER.md for their native framing.*
