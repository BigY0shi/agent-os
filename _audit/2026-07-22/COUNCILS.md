# Agent Councils — deliberation log
Cross-lineage council for the genuinely debatable calls (non-concrete, interpretation-dependent). Each seat wears a contrasting Nemotron-Personas-USA persona so the debate has real friction. A **bias-aware Judge** (Supreme-Court-Justice temperament: fair, benevolent, names its own biases, rules narrowly on evidence) arbitrates.

## Seats & personas (real rows from nvidia/Nemotron-Personas-USA)
| Seat | Lineage | Persona (row) | Debate temperament it forces |
|---|---|---|---|
| **Codex** | OpenAI | *Stephen Cate* — "structure-loving, competition-driven supervisor; disciplined, occasionally skeptical" | Skeptic/conservative: resist churn, demand the change earns its cost |
| **Hermes** (local Kimi/GLM) | OSS | *Ravin Vanchipura* — "data-driven economist; favors flexibility over rigid plans; competitive edge" | ROI pragmatist: what's the dollar/time return, cut what doesn't pay |
| **Claude seat A** | Anthropic | *Marie Pickett* — "disciplined artist's eye, restless curiosity, perfectionism vs procrastination" | Craft/quality: the monster should be *good*, not just alive |
| **Claude seat B** | Anthropic | *Ruth Gresham* — "methodical community-focused steward; preserves, hoards clippings" | Preservationist: don't destroy optionality; exile-not-delete ethos |
| **Judge** | Anthropic (bias-aware) | *Owen Newsom* recast as an arbiter — "quiet imagination, meticulous, balances craft with restraint" | Names biases, weighs evidence, rules narrowly, benevolent to the builder |

Rule: seats get the QUESTION + evidence only, never each other's or my hypotheses first (independence). Judge gets all four takes + my synthesis, must state which biases it's checking for (recency, sunk-cost, novelty, security-theater, consolidation-zeal).

## Council #1 — Engineering triage (post-Pass-1)
Debatable questions:
- **Q1.1 Git recovery:** `.git` is empty (P0). Options: (a) `git init` fresh clean start; (b) re-clone upstream juliangoldie + overlay local changes to recover history; (c) hard-fork — new repo, cut upstream, own it. Trade: history/updates vs clean slate vs independence.
- **Q1.2 Sequencing:** "make the monster live" says fix the front page + Loop first (visible value). Security says the RCE-over-one-password boundary is a loaded gun. Which comes first for a solo LAN+Tailscale user?
- **Q1.3 Dead-code disposition:** orphaned components (HermesPanel/Talk/Profiles), orphaned Radar pipeline (unique WP-publish, unused since Jul 1), nav-orphaned pages. Kill, wire, or exile-and-leave?

### Seat verdicts (Council #1)
| Q | Codex/Stephen (skeptic) | Hermes/Ravin (ROI) | Marie (craft) | Ruth (steward) | Tally |
|---|---|---|---|---|---|
| **Q1.1 git** | (b) re-clone+overlay | **(c) hard-fork** | (b) re-clone | (b) re-clone + keep upstream remote | **3× (b), 1× (c)** |
| **Q1.2 seq** | security containment FIRST (short gate) then live | security in 48h THEN Loop (stop the cash-burn) | security-first + honesty (front page lies) | security-first as "tourniquet not fortress" (3 cheap fixes) | **Unanimous: short security gate first, then features** |
| **Q1.3 dead code** | exile+manifest; wire Radar only after core stable | exile ALL incl Radar (unfinished=fiction) | wire Radar (it's "unborn"), exile rest | differentiated + "nothing leaves without a ledger entry" | **Consensus: exile-with-catalog; Radar = tracked backlog, wire later** |

Notable friction: Hermes is the lone hard-fork + exile-Radar voice (pure ROI: upstream merges are negative-value, unfinished code is balance-sheet fiction). Marie is the lone wire-Radar-now voice (craft: unique = unborn, not dead). Ruth added the load-bearing mechanism that reconciles everyone: **every exile gets a one-line manifest entry (what/why/how-to-revive) — the line between an archive and a graveyard is a catalog.** Ruth also corrected a factual nuance: Tailscale traffic IS WireGuard-encrypted (the "cleartext" risk is the bare-LAN path + brute-force/traversal, which don't care about transport).

### JUDGE RULING (Owen Newsom, bias-aware)
Self-check declared: guards against bandwagon (3-seat convergence ≠ evidence), availability bias (vivid "RCE" language), deference-to-eloquent (Hermes/Marie rhetoric). Treats the builder's ethos (no irreversible loss, exile-not-delete, workflows→skills) as BINDING LAW.
- **Q1.1 → (b) re-clone, exile the current tree FIRST, keep upstream remote.** (a) init discards history = the exact irreversible loss the ethos forbids → disqualified. (c) hard-fork buys only "cleanliness" while destroying cheap cherry-pick optionality. Condition: verify .exile backups complete before re-cloning. (Sided with Codex/Marie/Ruth over Hermes.)
- **Q1.2 → few-hours security TOURNIQUET first, THEN Loop, THEN go-live.** "The split is smaller than it appears — all four say security-first, all price it in hours." Rate-limit login, close traversal, salt+expire sessions, bind tailnet-only/HTTPS. Then Loop (certain continuous budget bleed, per Hermes). Marie's honesty fix (real /api/activity feed) rides with go-live — valid but is NOT security, must not jump the queue.
- **Q1.3 → exile-by-default WITH manifest; consolidate duplicate chats to one winner; PROMOTE Radar to a tracked backlog item, wire only if last-mile short AND after security+Loop+homepage stable.** Rejected Hermes' "kill all" (forecloses the one differentiated asset, violates workflows→skills) AND Marie's "wire now" (lets novelty jump security's queue). "Don't destroy it, don't crown it. Name it, gate it." (Sided with Ruth + Codex's gating conditions.)

**Council #1 net doctrine:** re-clone (reversible) · short security tourniquet → Loop → honest go-live · exile-with-catalog, Radar tracked-not-crowned. Every destructive step stays reversible; the ethos is the tiebreaker.

## Council #2 — Roadmap (post-Pass-2)
Debatable questions (to finalize after exec analysis):
- **Q2.1** 31 modules, 1 operator: aggressive consolidation vs optionality-preservation.
- **Q2.2** The single highest-leverage NEW build for an augment-consulting solo founder.
- **Q2.3** Front page: what SHOULD the founder see first thing every morning?

### Seat verdicts (Council #2)
| Q | Codex/Stephen (skeptic) | Hermes/Ravin (ROI) | Carl Turner (growth) | Ruth (steward) |
|---|---|---|---|---|
| **Q2.1 consolidate?** | ruthlessly — keep only find→win→deliver→productize + infra; retire product surface, preserve capability | ruthlessly to 6-8; flexibility via external tools not sprawl | consolidate revenue surface; keep the multi-CLI stack (delivery engine) | consolidate the NAV, DELETE NOTHING — catalog+exile dormant studios (R&D soil) |
| **Q2.2 one build** | **(b) Deal Flow** — cockpit = thin read-only projection of it | **(b) Deal Flow** — cockpit on fractured data = more fake telemetry | **(a) Cockpit** as ACTION QUEUE — latency is the constraint, unsent drafts=frozen cash | **(d) One Agent Console** — purely removes surface, reversible, mints the agent-picker the cockpit reuses |
| **Q2.3 morning** | pipeline / approval queue / today's top actions / delivery / honest exceptions | pipeline $ / drafts / machine health / today's outreach / honest overnight log | drafts+age / deals+days-since-touch / new leads / booked $ vs goal + MRR / machine deploys | drafts / deals by stage / weighted $ + won-this-week / agent runs needing attention / new verified leads |

**Q2.2 is a real 3-way split:** 2× Deal Flow merge, 1× Cockpit, 1× One Agent Console. **Q2.3 is near-unanimous convergence:** every seat's morning glance = drafts-awaiting-approval + deals-in-flight/pipeline-$ + new-leads + delivery/machine-status + honest-exceptions; every seat explicitly says KILL the fabricated tokens/cost. Q2.1: unanimous "consolidate the nav surface," Ruth's binding nuance = hide/catalog, never delete (matches the ethos).

### JUDGE RULING (Council #2, Owen Newsom, bias-aware)
Self-checks declared: consolidation-zeal, sunk-cost/loss-aversion, majority-deference ("2-1-1 is a count, not an argument"), revenue-tunnel-vision, dashboard-theater/novelty-bias, builder-bias (preferring construction over subtraction).
- **Q2.1 → consolidate the visible surface to 6-8** (Cockpit, Deal Flow, Machine Shop, Agent Console, Pipeline/Loop, Memory). **The line is HONESTY, not activity** (Ruth): whatever lies or endangers comes off now, unconditionally; everything dormant is **exiled behind a catalog manifest, never deleted**. Carl's carve-out granted: **the multi-CLI delivery stack is capability, not surface — exempt from module-counting.** "The nav is not where options are stored" — optionality lives in the exile catalog + skills library.
- **Q2.2 → (b) Deal Flow merge, FIRST.** Controlling argument is DEPENDENCY not proximity-to-money: a cockpit on fractured data is just more fabricated telemetry (Hermes); the cockpit is properly a thin read-only projection of Deal Flow (Codex). Carl's constraint-diagnosis (latency/attention; unsent drafts = frozen cash) absorbed as a **binding condition: build Deal Flow as an ACTION QUEUE with the Gmail approval gate surfaced on it, not a CRM DB. Its top strip becomes the interim cockpit and replaces the lying home page** — discharging the Q2.1 honesty order in the same stroke.
  **Sequence:** (1) Deal Flow (action-queue, approval gate on-dashboard) → (2) One Agent Console (purely subtractive, reversible, mints the agent-picker primitive) → (3) Founder Cockpit proper (thin projection over real data, reuses the picker) → (4) Machine Shop (last — productization waits until the funnel consistently feeds it; **jumps queue if a 2nd machine sells first**).
- **Q2.3 → 5 clickable action-lists, exceptions-only:** (1) drafts awaiting approval + age [frozen cash first], (2) deals in flight by stage / days-since-touch / weighted $, (3) new verified leads, (4) machine/delivery status — blocked-or-failing only, (5) overnight agent runs needing attention — honest log, exceptions only. **Excluded with prejudice: token counts, cost graphs, activity charts, any non-clickable tile.**

**Council #2 net doctrine:** the seats disagreed on SEQUENCE, not destination. Merge the funnel first (action-queue + approval gate = the honest cockpit's first form), then subtract the 13-tab sprawl, then the real cockpit, then productize. Consolidate the nav to ~6-8; catalog-and-exile the rest; the CLI stack is exempt.

---
# COUNCIL SYNTHESIS (both benches)
**Re-clone git (reversible) → hours-long security tourniquet → fix Loop (budget bleed) → make it honest by MERGING Leads+Deal Desk into an approval-queue whose top strip replaces the fake home → collapse the 13 agent tabs → real Cockpit → Machine Shop. Everything dormant is exiled with a manifest, never deleted. The CLI delivery stack stays. Honesty is the line; reversibility is the rule; the ethos is the tiebreaker.**
