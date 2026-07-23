# LAU-13 Compliance Risk Review — Money Maker Candidates

Owner: CISO
Rollup: LAU-6 Assign Tasks
Date: 2026-06-30
Scope: All 20 candidates in LAU-6-money-maker-csuite-dispatch.md

---

## Risk Classification Method

| Color | Meaning |
|---|---|
| **GREEN** | Low risk. Can proceed with standard disclaimers. No special review required. |
| **YELLOW** | Moderate risk. Proceed with stated guardrails, disclaimers, and conditions. Requires a compliance review ticket if implemented. |
| **RED** | High risk. Requires hard no-go conditions, explicit legal/TOS vetting, or infrastructure locks before any implementation or marketing. |

Risk dimensions reviewed per candidate:
- **Sec** — Security posture (data handling, access, breach risk)
- **Priv** — Privacy (PII collection, retention, consent)
- **TOS** — Platform terms of service (scraping, automation, API use)
- **Legal** — Legal-claim risk (guarantees, outcomes, warranties)
- **Child** — Child safety / dual-use educational content
- **SMS** — SMS/voice telephony compliance (TCPA, A2P 10DLC, opt-in)
- **HW** — Dual-use hardware / export / safety risks

---

## Compliance Matrix: All 20 Candidates

| # | Candidate | Risk | Reason | Sec | Priv | TOS | Legal | Child | SMS | HW |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Local AI missed-call receptionist | **YELLOW** | Phone/SMS automation triggers TCPA, A2P 10DLC, and opt-in consent requirements. Must not transmit customer PII to unvetted LLM endpoints. | Y | Y | N | N | N | **Y** | N |
| 2 | Google Business Profile rescue sprint | **GREEN** | Client-managed listing optimization. No external automation. Claims must be evidence-based ("improve visibility" not "guarantee ranking"). | N | N | N | Y | N | N | N |
| 3 | Recommerce listing factory | **YELLOW** | Platform policy risk: eBay/Etsy TOS on listing automation, condition accuracy, and drop-shipping claims. Must not scrape competitor data. | N | N | **Y** | Y | N | N | N |
| 4 | Refurb electronics QA checklist packs | **GREEN** | Digital template. Risk only in buyer misusing grading as a warranty claim. Disclaimers required. | N | N | N | **Y** | N | N | N |
| 5 | Maker kit documentation service | **YELLOW** | Technical accuracy liability if documentation leads to unsafe assembly. BOM errors could create safety hazards. | N | N | N | **Y** | N | N | **Y** |
| 6 | Pi kiosk deployment bundle | **YELLOW** | Hardware support scope must be capped. Firmware/software updates are the buyer's responsibility. Physical installation liability. | N | N | N | **Y** | N | N | **Y** |
| 7 | ESP32 sensor alert starter kits | **RED** | **Dual-use hardware + firmware liability.** Preflashed firmware creates ongoing security and safety obligations. Environmental sensors (gas, temp) can be misused. Firmware rollback and update path must be guaranteed. Child-safety if sold to schools without vetting. | **Y** | N | N | **Y** | **Y** | N | **Y** |
| 8 | Tiny compliance pack for Etsy/eBay hardware sellers | **YELLOW** | Legal disclaimer boundaries are sharp. Must not cross into unauthorized practice of law. "Dual-use wording" is sensitive; cannot advise on export control classification. | N | N | N | **Y** | N | N | **Y** |
| 9 | AI inbox triage for solo operators | **YELLOW** | Gmail data access requires OAuth with least-privilege scopes. Must not retain or train on customer emails. Data privacy and confidentiality obligations apply. | **Y** | **Y** | **Y** | N | N | N | N |
| 10 | Quote-to-invoice automation mini-build | **GREEN** | Low risk if no payment processing is handled. If Stripe/PayPal integrated, becomes YELLOW (PCI scope, tax nexus). | N | N | N | N | N | N | N |
| 11 | Review mining report for niche products | **RED** | **Scraping/TOS violation.** Mining competitor reviews from Etsy/eBay/Amazon without API access violates platform TOS. Automated scraping may violate CFAA (US) or similar laws. | N | N | **Y** | **Y** | N | N | N |
| 12 | Digital repair logbooks | **GREEN** | Template product. No PII, no automation, no claims. Lowest-risk category. | N | N | N | N | N | N | N |
| 13 | School club cyber-lab curriculum kits | **RED** | **Child safety + dual-use content.** "Ethical hacking" curriculum for minors requires extreme care. Content could be repurposed maliciously. Must include educator vetting, parental consent framework, and clear ethical-use agreements. | N | N | N | **Y** | **Y** | N | N |
| 14 | Privacy-first family device inventory | **GREEN** | Self-hosted template. "Privacy-first" positioning must not overpromise. No external data transmission if kept local. | N | N | N | Y | N | N | N |
| 15 | AI product photography prompt packs | **GREEN** | Digital product. Risk only in marketplace image rules (e.g., Etsy prohibits AI-generated images in some categories). Disclaim category restrictions. | N | N | Y | N | N | N | N |
| 16 | Local menu/price change monitor | **YELLOW** | Scraping competitor menus may violate TOS. Must use public data, manual research, or API partnerships. Data freshness claims must be bounded. | N | N | **Y** | Y | N | N | N |
| 17 | Vendor lead-time risk dashboard | **GREEN** | Internal-use template. No customer data. No external automation. | N | N | N | N | N | N | N |
| 18 | Micro-SaaS teardown reports | **GREEN** | Public information analysis. Must not access private accounts or non-public data. Screenshots of public interfaces are fair use. | N | N | N | N | N | N | N |
| 19 | Agent-ready SOP conversion service | **YELLOW** | Confidential data handling: converting client docs/videos into SOPs requires NDAs, data retention limits, and no training-data leakage. | **Y** | **Y** | N | N | N | N | N |
| 20 | Security posture starter pack for tiny businesses | **YELLOW** | Must avoid overclaiming security guarantees. "Password manager rollout" is fine; "make you secure" is not. Cannot provide legal advice or compliance certification. | **Y** | N | N | **Y** | N | N | N |

---

## Summary Counts

| Color | Count | Candidate Numbers |
|---|---|---|
| **GREEN** | 8 | 2, 4, 10, 12, 14, 15, 17, 18 |
| **YELLOW** | 9 | 1, 3, 5, 6, 8, 9, 16, 19, 20 |
| **RED** | 3 | 7, 11, 13 |

---

## Hard No-Go Conditions (RED Candidates)

### Candidate 7 — ESP32 Sensor Alert Starter Kits
**Condition:** Cannot ship preflashed firmware without:
- Signed firmware with verified boot chain
- Documented OTA update and rollback procedure
- Safety warnings for all sensor types (gas, temperature, environmental)
- Explicit "not for life-safety or medical use" disclaimer
- If sold to educational institutions: educator background check disclaimer and parental consent framework

**Resolution path:** Downgrade to YELLOW if template-only (schematics + documentation, no preflashed hardware). If hardware ships, remains RED until CISO reviews BOM and firmware architecture.

### Candidate 11 — Review Mining Report for Niche Products
**Condition:** Absolutely no scraping of Etsy, eBay, Amazon, or any other platform without explicit API access or documented permission.
**Permitted alternatives:**
- Manual research with attribution
- Public API access (Amazon Product Advertising API, eBay API with compliant terms)
- Client-provided review exports (with client consent)

**Resolution path:** If rescoped to "manual competitor research report" using public data and client inputs, downgrades to YELLOW. Any automated scraping remains RED.

### Candidate 13 — School Club Cyber-Lab Curriculum Kits
**Condition:** Cannot market to minors without:
- Educator verification system
- Parental consent workflow for all participants
- Explicit ethical-use agreement signed by student + guardian
- Content review by an independent child-safety advisor
- No exploit tool distribution to students

**Resolution path:** If repositioned to adult/professional cybersecurity training (18+ only) with no physical kit, downgrades to YELLOW. Any K-12 offering remains RED until child-safety review is complete.

---

## Required Disclaimers (All Offers)

### Universal Disclaimer Template
> "Launchworks Dynamics provides operational tools, templates, and documentation. We do not guarantee specific business outcomes, revenue, search rankings, or platform performance. All services are provided as-is. Clients are responsible for ensuring their use complies with applicable laws, platform terms of service, and industry regulations."

### Additional Disclaimers by Candidate

| Candidate | Required Additional Disclaimer |
|---|---|
| 1 (Missed-call receptionist) | "SMS/voice services require compliant opt-in consent. Launchworks configures systems but does not provide legal advice on TCPA compliance. Consult a telecommunications attorney before deploying." |
| 3 (Recommerce listing factory) | "Clients are responsible for accurate item condition descriptions and compliance with eBay/Etsy seller policies. Launchworks does not guarantee listing approval or sales volume." |
| 4 (Refurb QA packs) | "QA checklists are operational guidance only. They do not constitute a warranty, guarantee, or product certification. Sellers remain responsible for all consumer protection obligations." |
| 5 (Maker kit docs) | "Documentation is provided for reference. Assembly and use of hardware kits carries inherent risk. Launchworks is not liable for injury, damage, or misuse arising from kit assembly." |
| 6 (Pi kiosk bundle) | "Deployment support covers initial configuration only. Ongoing security patches, OS updates, and physical maintenance are the client's responsibility." |
| 8 (Tiny compliance pack) | "Templates are not legal advice. Export control, product safety, and platform compliance are complex legal areas. Clients must consult qualified counsel for jurisdiction-specific requirements." |
| 9 (AI inbox triage) | "Email data is processed only with explicit client authorization and least-privilege OAuth scopes. Launchworks does not retain, train on, or share email content." |
| 10 (Quote-to-invoice) | "Automation templates do not include payment processing, tax calculation, or accounting advice. Clients must verify compliance with local tax and invoicing regulations." |
| 15 (AI photo prompt packs) | "Prompt packs are creative tools. Clients must verify marketplace policies on AI-generated images before listing. Some platforms restrict or prohibit AI-generated product photography." |
| 19 (SOP conversion) | "All client data is handled under NDA and deleted within 30 days of delivery. Launchworks does not retain or train models on client proprietary information." |
| 20 (Security posture pack) | "Security templates improve baseline hygiene but do not guarantee protection against all threats. This is not a security audit, penetration test, or compliance certification." |

---

## Security Review Tickets Required Before Implementation

Any candidate requiring external API access, scraping, platform automation, phone/SMS, or sensitive customer data needs a security review ticket.

| Candidate | Trigger | Required Review |
|---|---|---|
| 1 | Phone/SMS, customer PII | **SEC-001** — Telephony compliance review (TCPA, A2P 10DLC, opt-in workflow) |
| 7 | Preflashed firmware, sensor hardware | **SEC-002** — Hardware/firmware security review (signature chain, OTA, BOM safety) |
| 9 | Gmail OAuth, email content | **SEC-003** — Data handling review (OAuth scopes, retention, LLM data flow) |
| 11 | Scraping / API use | **SEC-004** — Platform TOS and scraping audit (if scope changes to manual research, downgraded) |
| 13 | Child-safety content, dual-use | **SEC-005** — Child-safety and content review (educator verification, consent workflow) |
| 19 | Client confidential docs/videos | **SEC-006** — Data classification and NDA review (retention, access controls, deletion) |

---

## Launch Guardrails for Top 6 Immediate Bets

The dispatch identifies 6 immediate 30-day bets. Below are their compliance guardrails:

### 1. Agent-ready SOP conversion service (YELLOW)
- **Guardrail:** NDAs required for every engagement. Client data deleted within 30 days.
- **Guardrail:** No cloud LLM processing of client proprietary data without explicit opt-in.
- **Guardrail:** Deliver output as structured documents, not hosted SaaS accounts.
- **Ticket:** SEC-006 before first client.

### 2. AI inbox triage for solo operators (YELLOW)
- **Guardrail:** OAuth scopes limited to read-only + label management. No send/delete scopes.
- **Guardrail:** No email content stored or logged. All processing ephemeral.
- **Guardrail:** Client must own the Google Cloud project and OAuth app; no centralized credential store.
- **Ticket:** SEC-003 before first deployment.

### 3. Google Business Profile rescue sprint (GREEN)
- **Guardrail:** All claims evidence-based. No ranking guarantees.
- **Guardrail:** Client retains GBP ownership; no password or credential storage.
- **Guardrail:** Photo plan uses client-provided or licensed imagery only.
- **Ticket:** None required.

### 4. Recommerce listing factory (YELLOW)
- **Guardrail:** No automated scraping. Listings built from client-provided photos and data.
- **Guardrail:** Condition grades must be client-confirmed; Launchworks does not assess physical items.
- **Guardrail:** Platform TOS compliance training for all operators.
- **Ticket:** Operational review (no SEC ticket unless API integration added).

### 5. Maker kit documentation service (YELLOW)
- **Guardrail:** Technical documentation reviewed by a second technical reviewer before delivery.
- **Guardrail:** Safety warnings included for all assembly steps involving power, heat, or cutting.
- **Guardrail:** No warranty or fitness-for-purpose claims in documentation.
- **Ticket:** Technical accuracy review (internal, not SEC ticket unless firmware/hardware ships).

### 6. Tiny compliance pack for Etsy/eBay hardware sellers (YELLOW)
- **Guardrail:** Templates explicitly labeled as "not legal advice" on every page.
- **Guardrail:** No export control classification advice. Direct clients to qualified counsel.
- **Guardrail:** Battery safety and dual-use wording sourced from official guidelines (FAA, DOT, BIS), not invented.
- **Ticket:** Legal disclaimer review by counsel before first sale.

---

## Recommendations to CPO (for LAU-9 top-6 selection)

1. **Replace RED candidates in top 6.** Candidates 7, 11, and 13 carry compliance overhead that will delay 30-day revenue targets. If the top-6 stack currently includes any of these, recommend substituting GREEN candidates (12, 14, 17, 18) or well-guarded YELLOW candidates (2, 4, 10).

2. **Fastest no-review path:** Candidates 12 (Digital repair logbooks), 14 (Privacy-first family device inventory), 17 (Vendor lead-time dashboard), and 18 (Micro-SaaS teardown reports) are GREEN and can be listed/sold this week with only the universal disclaimer.

3. **Security ticket dependency:** If CPO insists on including any RED or API-bearing YELLOW candidate in the top 6, factor SEC ticket lead time (estimate 3-5 days) into launch dates.

---

## Final Disposition

LAU-13 is complete pending CPO top-6 selection. All 20 candidates have risk labels, hard no-go conditions for RED items, disclaimers for every offer, and security review tickets defined for high-risk implementations. Once LAU-9 selects the top 6, apply the launch guardrails above and create the relevant SEC tickets before any implementation begins.

**Status:** Ready for CPO/CISO handoff.
