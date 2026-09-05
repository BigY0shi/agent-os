# WEBMCP WIZARD — the Program X pipeline

**Status:** normative procedure. **Scope:** how the WebMCP wizard turns an arbitrary
program into a published, deployed, *adopted* tool package — repeatably, with no
per-target improvisation.

This document is target-agnostic on purpose. The target is always called **Program X**.
If a rule here only makes sense for one kind of program, it is a bug in the rule.

Program X may be:

- **ours** — software we wrote and control;
- **the client's** — software they wrote, that we are paid to integrate;
- **a third party's** — commercial software neither of us controls.

Which of the three it is changes Phase 0 and Phase 1 substantially and changes nothing
after that. The pipeline is the same shape in all three cases.

Terminal artifact is a package in this repo's existing format —
`src/lib/v2/webmcp/store.ts` (`SnapshotTool`: `name`, `description`, `inputSchema`,
`handlerKind`, `handlerConfig`, `requiresApproval`, `position`), published as a
snapshot, optionally emitted through `exporter.ts`. The pipeline does not introduce a
new package shape.

CONVENTIONS.md remains binding and overrides anything here that conflicts with it.

---

## 1. Why a pipeline and not a tutorial

Every "make an MCP server for Program X" engagement decomposes the same way. Only three
things vary between targets:

1. **Which seam** the program exposes.
2. **Which verbs** the operator wants.
3. **Who the humans are** who will use the result.

Everything else — schema authoring, handler binding, validation, gating, publishing,
export, documentation — is mechanical once those are fixed. The pipeline exists to make
(1) a classification problem with a closed answer set, (2) an explicit human input, and
(3) a delivered artifact rather than an afterthought, so the remaining work can run
largely unattended.

Two standing rules that the rest of this document elaborates:

**The pipeline never invents capability.** A tool package can only expose what Program X
already lets an outside process do — or, when we own Program X, what we are willing to
add to it. If no seam exists and none can be added, the correct output is an abort.

**Delivery is not publish.** An engagement ends when the client's people are using the
tools correctly and the call log proves it, not when the package goes live. Phases 7–9
are part of the job, not follow-up.

---

## 2. The seam taxonomy (closed set)

Every program that can be automated at all exposes at least one of these. This list is
the whole search space for Phase 1; if a target appears to fit none of them, re-probe
before concluding S8.

| ID | Seam | Recognised by | Native lane |
|---|---|---|---|
| **S0** | **A seam we add** | we own or can modify Program X | `http` |
| **S1** | Network service | listens on a port; publishes REST/GraphQL/gRPC/WS/OSC | `http` |
| **S2** | Command line | shippable binary with flags/subcommands | `js` |
| **S3** | In-process library | importable package, SDK, FFI/DLL surface | `js` / `internal` |
| **S4** | OS automation | AppleScript/JXA dictionary, COM/OLE, D-Bus, PowerShell module | `js` + bridge |
| **S5** | Extension runtime | the program runs third-party code: plugins, macros, scripts, add-ons | bridge → `http` |
| **S6** | Data at rest | project files, embedded DB, config, import/export formats | `js` / `internal` |
| **S7** | Local IPC | named pipes, unix sockets, message queue, filesystem watch | bridge → `http` |
| **S8** | Synthetic input | keyboard/mouse injection, accessibility tree, screen scraping | out of scope |

### 2.1 S0 — check this first when we own Program X

When Program X is ours or the client's, **adding a small purpose-built endpoint is
usually cheaper, more stable and more secure than bridging whatever seam happens to
exist.** Six read endpoints and three write endpoints, designed for this integration,
beat scraping an internal database or driving a UI, permanently.

S0 is available exactly when: we can ship a change to Program X, and its release cadence
lets that change land in reasonable time. If both hold, prefer S0 over S2–S7 even when
another seam already works — the integration surface you designed will outlive the one
you reverse-engineered.

S0 is **not** available for third-party commercial software, which is why the taxonomy
below it still matters.

### 2.2 Seam scoring

A target often has several seams. Score each on six axes, 1–5, and take the highest
total that clears the stability floor:

| Axis | 1 | 5 |
|---|---|---|
| Reach | one corner of the program | the program's whole object model |
| Stability | undocumented, breaks per release | versioned public contract |
| Latency | seconds | sub-100ms |
| Auth burden | per-user OAuth dance | none (loopback) |
| Install burden | user must build from source | already present |
| Reversibility | writes are permanent | writes are undoable |

**Stability floor: reject any seam scoring 1 on Stability unless it is the only one.**
A high-reach seam that breaks every release costs more over a year than a narrow stable
one — and on a paid engagement that cost is *ours*, recurring, after the invoice cleared.
Say so during scoping, in writing.

### 2.3 The bridge collapse — the central move

The three handler lanes are `internal`, `http` and `js`. `http` is the only **zero-code**
lane, because `execute.ts` already interpolates `{{arg:name}}` / `{{args.name}}` and
`{{secret:NAME}}` into a templated request.

Therefore: **the wizard's structural goal is to reduce every seam to S1.**

- S0/S1 → already there. Bind directly to `http`.
- S4, S5, S7 → put a **bridge** in front: a small long-lived process (or in-app script)
  that speaks the seam's native dialect on one side and HTTP on the other. Once the
  bridge exists, every tool is a zero-code `http` binding.
- S2, S3, S6 → usually cheaper to bind through `js`/`internal` than to stand up a bridge.
  Use a bridge only when the target must be driven by a *live* process that holds state.

A bridge is written **once per program**, not once per tool. That is what makes the
per-tool cost collapse and what makes an S5 target tractable at all.

**Before writing a bridge, search for one.** Long-lived programs with extension runtimes
usually have a community bridge already. Finding it converts the most expensive band into
the cheapest one, and it is the single highest-leverage step in the whole pipeline.

---

## 3. Phases

Each phase has an input, an owner, an output artifact, and a **gate**. A phase may not
advance until its gate passes. Gates are checkable by a machine wherever possible.

| # | Phase | Owner | Output artifact | Gate |
|---|---|---|---|---|
| 0 | Intake & authorization | operator | `TargetBrief` | target named; ≥1 verb; **right to integrate confirmed** |
| 1 | Recon | agent | `SeamReport` | ≥1 seam S0–S7 with evidence, or explicit abort |
| 2 | Capability map | agent | `CapabilityMap` | every verb classified reachable / compound / unreachable |
| 3 | Tool spec | agent + operator | `ToolSpec[]` | ≤ budget; 3-sentence descriptions; danger set by a human |
| 4 | Binding | agent | draft package | schemas valid; no secret values in `handlerConfig` |
| 5 | Harness | agent | stub + smoke | smoke passes offline **and fails when broken** |
| 6 | Gate & publish | agent + operator | published snapshot | high-danger tools gated; smoke green |
| 7 | Handover | agent + operator | export + runbook | no secret values in export; client can install unaided |
| 8 | **Enablement** | operator | capability card + patterns | a non-author completes 3 real tasks unaided |
| 9 | Operate | agent | log review | unused/erroring tools identified and fixed |

### Phase 0 — Intake & authorization

Minimum viable brief:

```
Target:      <Program X>, version, OS, where it runs
Ownership:   ours | client's | third party's
Verbs:       3–10 things you want done, in plain language
Users:       who will actually be typing at this, and what they know
Environment: local / our server / the client's machine
Rules:       what must never happen
```

**Authorization is a gate, not a formality.** Before any recon on software we do not own:

- Does the client have the right to automate it? Vendor terms sometimes forbid
  programmatic access, scraping, or credential sharing.
- Whose credentials will the tools use? A named service account is correct; a specific
  employee's login is not.
- If the vendor ships a breaking change, who pays for the fix? Answer this before the
  engagement, not after.

**Gate:** a brief with no verbs is not a brief. A third-party target with no confirmed
right to integrate is not a project. Park and ask.

### Phase 1 — Recon (the probe ladder)

Run in order. Stop at the first rung yielding a seam that clears the stability floor.
Cost ascends down the ladder; P0–P1 can end the project in minutes.

| Rung | Probe | Yields |
|---|---|---|
| **P0** | Does an MCP server for Program X already exist? | done — install it, do not build |
| **P1** | Does a community bridge / automation library exist? | collapses S4/S5/S7 → S1 |
| **P2** | **Do we own Program X?** | S0 — consider adding the seam |
| **P3** | Official docs: API, webhooks, integration guide | S1 |
| **P4** | `<binary> --help`, `--version`, man page | S2 |
| **P5** | Package registries for an official/maintained SDK | S3 |
| **P6** | Runtime observation: open ports, spawned processes, files written | S1, S6, S7 |
| **P7** | Docs for plugin / macro / scripting / add-on system | S5 |
| **P8** | OS automation surface (AppleScript dictionary, COM, D-Bus introspection) | S4 |
| **P9** | none of the above | S8 → abort or escalate |

**P0 is not optional and not a formality.** Building a second MCP server for a program
that already has a maintained one is the most expensive avoidable failure in this
pipeline — and on a paid engagement it is the one that damages trust.

`SeamReport` records, per candidate seam: id, evidence (URL, command output, port), the
six scores, and the recommended lane. **Evidence means something observed** — a fetched
doc page, a command's real output, an actual open port — not something assumed.

**Gate:** at least one seam S0–S7 with evidence.

### Phase 2 — Capability map

For each operator verb, find the concrete operation on the chosen seam that performs it
(endpoint, subcommand, function, file mutation). Record the exact address, its arguments,
and whether it returns a result.

Three outcomes per verb, all recorded:

- **reachable** — bound in Phase 4.
- **compound** — needs N operations; note the sequence.
- **unreachable** — the seam cannot do it. Report it; never silently drop it. On a paid
  engagement an unreported dropped verb is a dispute at delivery.

**Gate:** no verb unclassified.

### Phase 3 — Tool spec

**Tool budget: default ceiling 12, hard ceiling 25.** Tool cards are context the model
re-reads every turn, and near-duplicate tools measurably degrade selection. Exceeding
the default requires a stated reason in the package description.

Mechanical rules:

- **One tool per user intent, not per API endpoint.** If three calls always happen
  together, that is one tool. This matters more for non-technical users than for us:
  their intents are coarse.
- **Name `{target}_{verb}_{noun}`**, snake_case, verb-first, matching `TOOL_NAME_RE`.
  The target prefix is required — packages coexist in one hub namespace.
- **Description is three sentences:** what it does, when to use it, when *not* to.
  The third sentence prevents mis-selection and is the one most often skipped.
- **Every schema property carries a `description`** with a concrete example value.
- **Schema must be `type: "object"`** — enforced at publish by `assertObjectSchema`.
  Stay inside the documented converter subset in `schema.ts`: no `format`, `pattern`,
  bounds, `oneOf`, `$ref`. Enforce those in the handler and say so in the description.
- **Read tools return state; write tools return the state they produced.** Never report
  success a handler did not observe.

Danger classification, **operator-owned**:

| Level | Meaning | `requiresApproval` |
|---|---|---|
| none | read-only | 0 |
| low | write, trivially reversible | 0 |
| medium | write, reversible with effort | 0 or 1 — operator's call |
| high | destructive, costly, or externally visible | **1** |

On client engagements, "externally visible" is broader than it looks: anything a customer,
a regulator, or an auditor could see is high, regardless of how easy it is to undo
internally.

**Gate:** budget respected; three-sentence descriptions; danger set by a human.

### Phase 4 — Binding

- **`http`** — templated request. Preferred; zero code. Arguments interpolate with
  `{{arg:name}}`; credentials with `{{secret:NAME}}`, never literal values.
- **`js`** — authored handler, for CLI/library/file seams and compound verbs. Gated by
  `settings.webmcp.allowJsHandlers`; check before choosing this lane.
- **`internal`** — an existing registry action. Only for capabilities the OS already has.
  `internal` handlers are **not exportable** — the exporter stubs them — so a package
  destined for a client must not depend on this lane.

**Gate:** `validateInputSchema` passes for every tool; no secret value in any
`handlerConfig`; no `internal` handler in a package flagged for export.

### Phase 5 — Harness

Build a **stub of the seam**, not of the tools. Every seam band has an obvious stub shape:

| Seam | Stub |
|---|---|
| S0/S1 | a local server answering the same routes |
| S2 | a fake binary on `PATH` echoing canned stdout |
| S3 | a monkeypatched module |
| S4/S5/S7 | a process speaking the same dialect on the same socket/port |
| S6 | a temp directory of fixture files |

Then `scripts/v2/smoke-<slug>.mjs`, run with `npx tsx`, obeying the standing repo rules:

- passes offline — no network, no dev server, no live credentials;
- **redirects every config directory to a temp dir before importing anything that reads
  it** — `AGENTIC_OS_DB`, `AGENTIC_OS_SETTINGS`, `AGENTIC_OS_WEBMCP_DIR` and siblings
  (Learned Rule 19; `smoke-agentmail.mjs` §F greps for this). On client work this is not
  hygiene, it is the difference between a test and a data-protection incident;
- **asserts the artifact, not the report** — read back what the stub actually received
  (addresses, argument values, files written), never the handler's own success string.

**Gate:** smoke green offline, **and red when a handler is deliberately broken.** A smoke
that cannot fail is not a smoke.

### Phase 6 — Gate & publish

Publish snapshots the draft; `executeTool` only ever runs the published snapshot, so
drafts stay unreachable to agents.

**Gate:** every `high` danger tool carries `requiresApproval=1`; package description says
what Program X is and what the package does *not* cover; smoke committed alongside;
operator has seen the tool list.

### Phase 7 — Handover

For client delivery, `exporter.ts` client mode rewrites `{{secret:NAME}}` to
`${config:NAME}` and emits the config manifest. Secret **values** are never embedded in
either mode.

Ship with a **runbook**, not just an export:

- what to install, in order, with the exact commands;
- which config values they must supply, and where each comes from;
- how to verify the install worked — one read-only tool call with a known-good answer;
- what to do when it breaks: the three most likely failures and their fixes;
- who to contact, and what to send them (the call log excerpt, not a screenshot).

**Gate:** grep the export for every known secret value — zero hits. No `internal`
handlers. Manifest complete. **Someone who did not build it can install it from the
runbook alone.** If that has not been tested, the gate has not passed.

### Phase 8 — Enablement

The phase that decides whether the engagement was worth anything. A correct package that
employees use badly produces worse outcomes than no package, because it produces
confident wrong answers at speed.

Four artifacts, all short:

**1. The capability card — one page.** What Program X can now be asked to do, in the
users' vocabulary, not tool names. Three columns: *what you want*, *what to say*, *what
comes back*. This is the only document most users will ever read; if it is two pages, it
is too long.

**2. Prompt patterns — say this, not that.** Non-technical users under-specify. Show real
pairs:

```
✗ "update the vehicle"          → which vehicle? which field?
✓ "set VIN 1HG... to status SOLD"

✗ "scan these"                  → the model cannot see your desk
✓ "look up barcode 0847... and tell me the registration status"
```

Draw these from the actual verbs in the package. Six pairs is plenty.

**3. The boundary list — what it will NOT do.** Users build a mental model within a day,
and if it is wrong they either fear the tool or over-trust it. State plainly: what is
read-only, what asks for confirmation and why, what is outside the package entirely.
Naming the confirmation step as a *safety feature* converts the most common complaint
("why does it keep asking me") into a reassurance.

**4. The error table.** Every `ToolError` message the package can produce, what it means
in plain language, and what to do. The messages were written to be read by a model; this
table makes them readable by a person.

**Training format that works:** thirty minutes, live, on their real data with a
non-destructive verb. Have each person complete one real task themselves. Watching
someone else do it does not transfer.

**Gate:** a person who did not build the package completes **three real tasks unaided**,
using only the capability card. Anything less and the gate has not passed — fix the card
or fix the descriptions, then retest.

### Phase 9 — Operate

`execute.ts` writes one `webmcp_call_logs` row per call — success, validation failure and
handler error alike, with `redactArgs` applied. That log is the adoption telemetry, and
reading it is a scheduled activity, not an incident response.

Review at two weeks and again at two months:

| Signal | Reading | Fix |
|---|---|---|
| A tool is never called | users do not know it exists, or its description does not match how they ask | rewrite the description; add a capability-card row |
| A tool errors repeatedly on validation | the schema does not match how people phrase it | widen the schema or sharpen the parameter descriptions |
| One tool dominates | either it is the real job, or it is a catch-all doing too much | consider splitting |
| An approval is always granted | the danger level may be over-set — or people are rubber-stamping | ask which; both need different fixes |
| Calls stop entirely | something broke and nobody reported it | this is why you read logs on a schedule |

**Descriptions are the maintenance surface.** Most post-launch fixes are text, not code.
Budget for that, and price it.

**Gate:** every unused or erroring tool has a recorded decision — fixed, documented, or
deliberately removed.

---

## 4. Human checkpoints — PARK, do not spin

Consistent with INDEX.md's checkpoint convention, the wizard stops and waits at:

1. **Authorization (Phase 0)** — the right to integrate third-party software.
2. **Seam confirmation (end of Phase 1)** — a wrong seam wastes the whole build. Includes
   the S0 decision: are we willing to change Program X?
3. **Danger classification (Phase 3)** — only the operator knows what is expensive to get
   wrong in their setup. Never infer this.
4. **Bridge authorship (S4/S5/S7)** — running our code *inside* Program X is a materially
   larger commitment than binding tools.
5. **Publish (Phase 6)** — publishing makes tools reachable by agents.
6. **Enablement sign-off (Phase 8)** — the three-tasks-unaided test needs a real person.

Everything else runs unattended.

## 5. Abort conditions

Stop and report rather than degrade:

- **P0 hit** — a maintained MCP server already exists. Install it.
- **No right to integrate** — vendor terms forbid it, or the client cannot grant access.
- **S8 only** — no programmatic seam and none can be added. Synthetic input is a bespoke
  decision, not a wizard output.
- **Every requested verb unreachable** — the seam exists but does not cover the ask.
- **Credentials cannot be supplied** by anyone entitled to hold them.
- **Stability floor unmet with no alternative** — say so; let the operator decide whether
  a fragile integration is worth its recurring maintenance cost.

## 6. Record shapes

One row per wizard run:

```
TargetBrief   { target, version, os, ownership, environment, verbs[], users[], rules[], authorization }
SeamReport    { candidates[]: { seam, evidence[], scores{...}, lane }, recommended, abort? }
CapabilityMap { entries[]: { verb, status: reachable|compound|unreachable, address, args[], returns } }
ToolSpec      { name, description, inputSchema, danger, handlerKind, handlerConfig }
Enablement    { capabilityCard, promptPatterns[], boundaries[], errorTable[], signOff? }
RunState      { phase, gateResults[], parkedAt?, operatorDecisions[] }
```

`ToolSpec` is deliberately a superset of `ToolInput` — `danger` is the wizard's field and
maps to `requiresApproval` at Phase 6.

## 7. What this pipeline does not do

- It does not make Program X do things it cannot already do — unless we own it and choose
  to add them (S0).
- It does not choose the verbs.
- It does not classify danger.
- It does not decide that a fragile integration is acceptable.
- It does not decide whether we have the right to integrate someone else's software.

Those are the operator's, permanently. Everything else is the wizard's.
