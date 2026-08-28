// SPEC-E F3.1 — the harness library. Harnesses are DATA (rule 17): plain
// HarnessDef JSON in the `harnesses` table (migration 051), edited in-app,
// injected at run start into WHICHEVER provider the agent selected — never
// baked into provider-specific prompt code. DELETE = {exiled:true} inside the
// definition JSON; rows are never dropped (house rule). Builtins are seeded
// idempotently and are editable-but-not-deletable.

import { getDb } from "../db";
import type { AgentDef, AgentPersona } from "../../agentsTypes";

export type HarnessKind = "loop" | "oneshot" | "council" | "custom";

/** The `definition` column (SPEC-E §5.2) — pure data, editable in HarnessLibrary. */
export interface HarnessDef {
  /** Prepended to the agent's system.md at run start. */
  systemPreamble: string;
  /** Ralph-style iterate-until-done. stopWhen is a completion MARKER: the loop
   *  stops when the assistant's turn result contains this exact substring. */
  loop?: { maxIterations: number; stopWhen: string; reviewPrompt?: string };
  /** Feat-loop-style sequential phases; gate "approval" parks the run on the
   *  existing approval queue before the phase's prompt is sent. */
  phases?: { name: string; prompt: string; gate?: "approval" | "none" }[];
  pollCadenceSec?: number;
  notes?: string;
  /** Exile flag (soft delete) — list() filters these; the row stays. */
  exiled?: boolean;
}

export interface HarnessRow {
  id: string;
  name: string;
  description: string;
  kind: HarnessKind;
  definition: HarnessDef;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

const KINDS: readonly HarnessKind[] = ["loop", "oneshot", "council", "custom"];

interface DbRow {
  id: string;
  name: string;
  description: string;
  kind: string;
  definition: string;
  builtin: number;
  created_at: string;
  updated_at: string;
}

function fromDb(r: DbRow): HarnessRow {
  let def: HarnessDef;
  try {
    def = JSON.parse(r.definition) as HarnessDef;
  } catch {
    def = { systemPreamble: "", notes: "[unparseable definition JSON]" };
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kind: (KINDS as readonly string[]).includes(r.kind) ? (r.kind as HarnessKind) : "custom",
    definition: def,
    builtin: r.builtin === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Shape-validate a HarnessDef (used by POST/PATCH and the library editor).
 *  Returns an error string or null. */
export function validateHarnessDef(def: unknown): string | null {
  if (!def || typeof def !== "object" || Array.isArray(def)) return "definition must be an object";
  const d = def as Record<string, unknown>;
  if (typeof d.systemPreamble !== "string") return "definition.systemPreamble must be a string";
  if (d.loop !== undefined) {
    const l = d.loop as Record<string, unknown>;
    if (!l || typeof l !== "object") return "definition.loop must be an object";
    if (typeof l.maxIterations !== "number" || l.maxIterations < 1 || l.maxIterations > 50)
      return "definition.loop.maxIterations must be 1-50";
    if (typeof l.stopWhen !== "string" || !l.stopWhen.trim())
      return "definition.loop.stopWhen must be a non-empty marker string";
    if (l.reviewPrompt !== undefined && typeof l.reviewPrompt !== "string")
      return "definition.loop.reviewPrompt must be a string";
  }
  if (d.phases !== undefined) {
    if (!Array.isArray(d.phases) || d.phases.length === 0) return "definition.phases must be a non-empty array";
    for (const p of d.phases as Record<string, unknown>[]) {
      if (!p || typeof p.name !== "string" || !p.name.trim()) return "each phase needs a name";
      if (typeof p.prompt !== "string" || !p.prompt.trim()) return "each phase needs a prompt";
      if (p.gate !== undefined && p.gate !== "approval" && p.gate !== "none")
        return "phase.gate must be 'approval' or 'none'";
    }
  }
  if (d.loop && d.phases) return "a harness is loop OR phases, not both";
  return null;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listHarnesses(opts: { includeExiled?: boolean } = {}): HarnessRow[] {
  seedBuiltins();
  const rows = getDb()
    .prepare("SELECT * FROM harnesses ORDER BY builtin DESC, name COLLATE NOCASE")
    .all() as DbRow[];
  const all = rows.map(fromDb);
  return opts.includeExiled ? all : all.filter((h) => h.definition.exiled !== true);
}

export function getHarness(id: string): HarnessRow | null {
  const row = getDb().prepare("SELECT * FROM harnesses WHERE id = ?").get(id) as DbRow | undefined;
  return row ? fromDb(row) : null;
}

function kebab(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "harness";
}

export function createHarness(input: {
  name: string;
  description?: string;
  kind?: HarnessKind;
  definition: HarnessDef;
}): HarnessRow | { error: string } {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { error: "name is required" };
  const kind: HarnessKind = KINDS.includes(input.kind as HarnessKind) ? (input.kind as HarnessKind) : "custom";
  const bad = validateHarnessDef(input.definition);
  if (bad) return { error: bad };

  const db = getDb();
  let id = kebab(name);
  if (db.prepare("SELECT 1 FROM harnesses WHERE id = ?").get(id)) {
    id = `${id}-${Date.now().toString(36)}`;
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO harnesses (id, name, description, kind, definition, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, name, String(input.description ?? "").slice(0, 400), kind, JSON.stringify(input.definition), now, now);
  return getHarness(id)!;
}

export function patchHarness(
  id: string,
  patch: { name?: string; description?: string; kind?: HarnessKind; definition?: HarnessDef },
): HarnessRow | { error: string } {
  const existing = getHarness(id);
  if (!existing) return { error: "harness not found" };
  const name = typeof patch.name === "string" && patch.name.trim() ? patch.name.trim().slice(0, 80) : existing.name;
  const description = typeof patch.description === "string" ? patch.description.slice(0, 400) : existing.description;
  const kind: HarnessKind = KINDS.includes(patch.kind as HarnessKind) ? (patch.kind as HarnessKind) : existing.kind;
  let definition = existing.definition;
  if (patch.definition !== undefined) {
    const bad = validateHarnessDef(patch.definition);
    if (bad) return { error: bad };
    // The exile flag is managed ONLY through exileHarness — a definition edit
    // can't sneak a builtin into (or out of) exile.
    definition = { ...patch.definition, ...(existing.definition.exiled ? { exiled: true } : {}) };
    if (existing.builtin) delete definition.exiled;
  }
  getDb()
    .prepare("UPDATE harnesses SET name=?, description=?, kind=?, definition=?, updated_at=? WHERE id=?")
    .run(name, description, kind, JSON.stringify(definition), new Date().toISOString(), id);
  return getHarness(id)!;
}

/** DELETE semantics: builtin rows refuse; user rows get {exiled:true} in the
 *  definition JSON. Rows are NEVER dropped. */
export function exileHarness(id: string): { ok: true } | { error: string } {
  const existing = getHarness(id);
  if (!existing) return { error: "harness not found" };
  if (existing.builtin) return { error: "builtin harnesses cannot be exiled — edit or copy them instead" };
  const definition: HarnessDef = { ...existing.definition, exiled: true };
  getDb()
    .prepare("UPDATE harnesses SET definition=?, updated_at=? WHERE id=?")
    .run(JSON.stringify(definition), new Date().toISOString(), id);
  return { ok: true };
}

// ── Builtin seeds (SPEC-E §5.2) ──────────────────────────────────────────────
// Distilled from the same-named FILE skills (~/.claude/skills/{ralph-harness,
// fable-harness,feat-loop}/SKILL.md): the operating rules are copied into
// systemPreamble/phases as plain text — no skill-file references at runtime.

const SEEDS: Array<Omit<HarnessRow, "builtin" | "createdAt" | "updatedAt">> = [
  {
    id: "oneshot-plain",
    name: "Oneshot (plain)",
    kind: "oneshot",
    description: "No harness scaffolding — one prompt, one run. Today's default behavior.",
    definition: {
      systemPreamble: "",
      notes: "Empty preamble on purpose: identical to a plain single run.",
    },
  },
  {
    id: "ralph-loop",
    name: "Ralph loop",
    kind: "loop",
    description:
      "Iterate-until-done with self-review between iterations (distilled from the ralph-harness skill).",
    definition: {
      systemPreamble:
        "OPERATING HARNESS — Ralph loop.\n" +
        "- Work exactly ONE concrete item per iteration; never scatter across several.\n" +
        "- State lives in your files, not in your head: before acting, re-read your own notes/artifacts; after acting, record what changed and what is still failing.\n" +
        "- Evidence first: never claim something works without checking it this iteration. A claim you cannot point to a check for is not done.\n" +
        "- Keep the workspace consistent: finish or cleanly note every partial change before ending an iteration.\n" +
        "- If you are blocked on something only the user can do, say exactly what and stop — do not spin.\n" +
        'When the WHOLE task is genuinely complete and verified, include the exact marker "LOOP-COMPLETE" in your reply. Never emit it early.',
      loop: {
        maxIterations: 10,
        stopWhen: "LOOP-COMPLETE",
        reviewPrompt:
          "Review your last iteration adversarially: what did you actually verify, what is still failing or unchecked? " +
          'Pick the ONE next item and work it. If everything is complete and verified, reply including "LOOP-COMPLETE".',
      },
      notes: "Distilled from ~/.claude/skills/ralph-harness (one-feature-per-session, files-as-state, stall-honesty).",
    },
  },
  {
    id: "fable-harness",
    name: "Fable harness",
    kind: "loop",
    description:
      "Ralph loop with the Fable contract discipline: init ritual, one feature per cycle, close-out ritual, explicit human-verify pauses (distilled from the fable-harness skill).",
    definition: {
      systemPreamble:
        "OPERATING HARNESS — Fable contract.\n" +
        "- Session initialization ritual: read your standing instructions and memory/notes FIRST, identify the single next failing/open item, then work only that.\n" +
        "- Contract discipline: never rewrite acceptance criteria or scope mid-run — you may only progress an item, append notes/evidence, or flag it blocked.\n" +
        "- Close-out ritual every cycle: state what changed, the evidence it works, and what the next session should pick up.\n" +
        '- If a step needs the USER to verify by hand (UI checks, external accounts), write a numbered checklist under the heading "AWAITING USER VERIFY" and stop — that pause is a feature, not a failure.\n' +
        '- If truly blocked, write a "BLOCKED:" line naming the blocker and stop.\n' +
        'When every item is complete and verified, include the exact marker "HARNESS-COMPLETE" in your reply. Never emit it early.',
      loop: {
        maxIterations: 8,
        stopWhen: "HARNESS-COMPLETE",
        reviewPrompt:
          "Run the close-out ritual for the last cycle (what changed, evidence, next pickup), then start the next cycle on the single next open item. " +
          'If an AWAITING USER VERIFY or BLOCKED pause applies, write it and stop. If everything is complete and verified, reply including "HARNESS-COMPLETE".',
      },
      notes: "Distilled from ~/.claude/skills/fable-harness (init ritual, one-feature-per-cycle, close-out, pause markers).",
    },
  },
  {
    id: "feat-loop",
    name: "Feat loop",
    kind: "custom",
    description:
      "Plan → build → verify phases with an approval gate before build (distilled from the feat-loop skill's recon → diagnose → fix → verify cycle).",
    definition: {
      systemPreamble:
        "OPERATING HARNESS — Feat loop (phased).\n" +
        "- Recon before touching anything: establish the CURRENT state with real checks and capture the actual outputs/exit results — no assumptions from memory.\n" +
        "- Diagnose from evidence: name the root cause and point at the artifact that shows it.\n" +
        "- Fix to clean: the standard is zero errors AND zero warnings, not \"probably fine\".\n" +
        "- Finish with a breadcrumb: a short record linking what was wrong, what changed, and how it was verified.",
      phases: [
        {
          name: "plan",
          prompt:
            "PHASE 1 — PLAN. Recon the current state with real checks, diagnose the root cause from evidence, and produce a short numbered plan: exact changes, files, and how each will be verified. Do NOT make changes yet.",
          gate: "none",
        },
        {
          name: "build",
          prompt:
            "PHASE 2 — BUILD. Execute the approved plan exactly. Fix to zero errors and zero warnings. Note any deviation from the plan and why.",
          gate: "approval",
        },
        {
          name: "verify",
          prompt:
            "PHASE 3 — VERIFY. Re-run the checks from the plan and report each result honestly (pass/fail with the actual output). Finish with a breadcrumb summary: problem → change → verification.",
          gate: "none",
        },
      ],
      notes: "Distilled from ~/.claude/skills/feat-loop (recon → diagnose → fix(0/0) → marker → breadcrumb).",
    },
  },
];

/** Idempotent by id (INSERT OR IGNORE): user edits to seeded rows survive. */
export function seedBuiltins(): void {
  const db = getDb();
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO harnesses (id, name, description, kind, definition, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  for (const s of SEEDS) {
    ins.run(s.id, s.name, s.description, s.kind, JSON.stringify(s.definition), now, now);
  }
}

// ── Render (F3.2 injection) ──────────────────────────────────────────────────

/** The ONLY persona-record→prompt site (rule 17, jarvisPersona pattern). */
export function renderPersonaBlock(persona: AgentPersona | undefined): string {
  if (!persona) return "";
  const lines = [
    `WRITING PERSONA — "${persona.name}".`,
    `Voice rules: ${persona.voiceRules}`,
  ];
  if (persona.audience) lines.push(`Audience: ${persona.audience}`);
  if (persona.bannedPhrases?.length) lines.push(`Banned phrases (never use): ${persona.bannedPhrases.join(" · ")}`);
  if (persona.ctaStyle) lines.push(`CTA style: ${persona.ctaStyle}`);
  return lines.join("\n");
}

/**
 * renderHarness = persona block + harness systemPreamble + system.md
 * (SPEC-E §5.2). One function, additive, provider-agnostic — the SDK path and
 * the cli/ollama path inject the SAME rendered text.
 */
export function renderHarness(
  def: Pick<AgentDef, "name" | "persona">,
  harness: HarnessRow | null,
  systemMd: string,
): string {
  const parts: string[] = [];
  const persona = renderPersonaBlock(def.persona);
  if (persona) parts.push(persona);
  const preamble = harness?.definition.systemPreamble?.trim();
  if (preamble) parts.push(preamble);
  if (systemMd.trim()) parts.push(systemMd.trim());
  return parts.join("\n\n");
}
