// Idea Engine — storage + schema enforcement + dossier rendering.
// Data lives in ~/.agentic-os/idea-engine/:
//   dossiers/<id>.json   the source of truth (IdeaDossier)
//   dossiers/<id>.md     the render (regenerable from JSON, free to delete)
//   runs/<id>.json       validation run status
//   runs/<id>.jsonl      per-seat transcript (append-only)
//   signals.json         radar raw signals (Phase 2)
//   candidates.json      radar candidate board (Phase 2)

import { readFile, writeFile, mkdir, readdir, appendFile, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  IDEA_SCHEMA_VERSION, type IdeaDossier, type Score, type Sourced, type ValidationRun,
} from "./ideaEngineTypes";

export const IDEA_DIR = path.join(os.homedir(), ".agentic-os", "idea-engine");
const DOSSIER_DIR = path.join(IDEA_DIR, "dossiers");
const RUNS_DIR = path.join(IDEA_DIR, "runs");

async function ensure(dir: string) { await mkdir(dir, { recursive: true }).catch(() => {}); }

// ---- invariant enforcement (recipe rules, in code not prose) --------------

/** A score without stored inputs is invalid — recipe invariant #3. */
export function sanitizeScore(s: Partial<Score> | undefined, method: string): Score {
  const scale: [number, number] = Array.isArray(s?.scale) && s!.scale.length === 2 ? s!.scale as [number, number] : [1, 10];
  const inputs = Array.isArray(s?.inputs) ? s!.inputs.filter((i) => i && i.name) : [];
  const raw = typeof s?.value === "number" ? s!.value : null;
  return {
    // No inputs → no score. Never let a bare number through.
    value: inputs.length && raw != null ? Math.max(scale[0], Math.min(scale[1], raw)) : null,
    scale, inputs,
    method: s?.method || method,
  };
}

/** Unsourced factual claims collapse to insufficient_evidence — invariant #1/#2. */
export function sanitizeSourced<T>(s: Partial<Sourced<T>> | undefined): Sourced<T> {
  const sources = Array.isArray(s?.sources)
    ? s!.sources.filter((x) => x && typeof x.url === "string" && x.url.startsWith("http"))
    : [];
  const hasValue = s?.value !== undefined && s?.value !== null && s?.value !== ("" as unknown);
  if (!hasValue) return { value: null, sources: [], confidence: "insufficient_evidence", method: s?.method };
  if (!sources.length) {
    // A numeric claim with no source is exactly what this module exists to refuse.
    const numeric = typeof s!.value === "number" || /\d/.test(String(s!.value));
    if (numeric) return { value: null, sources: [], confidence: "insufficient_evidence", method: s?.method ? `${s.method} (dropped: unsourced numeric)` : "dropped: unsourced numeric" };
    return { value: s!.value as T, sources: [], confidence: "low", method: s?.method };
  }
  const conf = s?.confidence && ["high", "medium", "low"].includes(s.confidence) ? s.confidence : "medium";
  return { value: s!.value as T, sources, confidence: conf, method: s?.method };
}

// ---- persistence ----------------------------------------------------------

export async function saveDossier(d: IdeaDossier): Promise<void> {
  await ensure(DOSSIER_DIR);
  d.schema_version = IDEA_SCHEMA_VERSION;
  await writeFile(path.join(DOSSIER_DIR, `${d.id}.json`), JSON.stringify(d, null, 1), "utf8");
  await writeFile(path.join(DOSSIER_DIR, `${d.id}.md`), renderDossier(d), "utf8");
}

export async function loadDossier(id: string): Promise<IdeaDossier | null> {
  try { return JSON.parse(await readFile(path.join(DOSSIER_DIR, `${id}.json`), "utf8")) as IdeaDossier; }
  catch { return null; }
}

export async function listDossiers(): Promise<Pick<IdeaDossier, "id" | "generated_at" | "identity" | "verdict" | "scores">[]> {
  await ensure(DOSSIER_DIR);
  const out: IdeaDossier[] = [];
  for (const f of (await readdir(DOSSIER_DIR).catch(() => [] as string[]))) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(await readFile(path.join(DOSSIER_DIR, f), "utf8")) as IdeaDossier); }
    catch { /* skip corrupt */ }
  }
  out.sort((a, b) => (b.generated_at || "").localeCompare(a.generated_at || ""));
  return out.map(({ id, generated_at, identity, verdict, scores }) => ({ id, generated_at, identity, verdict, scores }));
}

/** Remove a dossier from the archive by EXILING it (house rule: nothing is ever
 *  hard-deleted). Both the JSON and the rendered md move to .exile/<ts>/. */
export async function exileDossier(id: string): Promise<boolean> {
  const exDir = path.join(IDEA_DIR, ".exile", new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"));
  await ensure(exDir);
  let moved = false;
  for (const ext of [".json", ".md"]) {
    const from = path.join(DOSSIER_DIR, `${id}${ext}`);
    try { await rename(from, path.join(exDir, `${id}${ext}`)); moved = true; } catch { /* absent is fine */ }
  }
  return moved;
}

export function safeId(id: string): string | null {
  return /^[A-Za-z0-9-]{6,64}$/.test(id) ? id : null;
}

export async function saveRun(run: ValidationRun): Promise<void> {
  await ensure(RUNS_DIR);
  await writeFile(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 1), "utf8");
}

export async function loadRun(id: string): Promise<ValidationRun | null> {
  try { return JSON.parse(await readFile(path.join(RUNS_DIR, `${id}.json`), "utf8")) as ValidationRun; }
  catch { return null; }
}

export async function logSeat(runId: string, seat: string, entry: Record<string, unknown>): Promise<void> {
  await ensure(RUNS_DIR);
  await appendFile(path.join(RUNS_DIR, `${runId}.jsonl`), JSON.stringify({ seat, at: Date.now(), ...entry }) + "\n", "utf8");
}

// ---- rendering ------------------------------------------------------------

function srcFoot(s: Sourced<unknown>): string {
  if (s.confidence === "insufficient_evidence" || s.value == null) return "_insufficient evidence — no number invented_";
  const cites = s.sources.map((x, i) => `[${i + 1}](${x.url})`).join(" ");
  return `${String(s.value)}${cites ? ` ${cites}` : ""} _(${s.confidence}${s.method ? ` · ${s.method}` : ""})_`;
}

function scoreLine(name: string, s: Score): string {
  if (s.value == null) return `| ${name} | — | no valid inputs |`;
  return `| ${name} | **${s.value}**/${s.scale[1]} | ${s.inputs.map((i) => `${i.name}: ${i.value}`).join(" · ")} |`;
}

export function renderDossier(d: IdeaDossier): string {
  const L: string[] = [];
  L.push(`# ${d.identity.title}`);
  L.push(`\n> ${d.identity.one_liner}\n`);
  L.push(`**Verdict: ${d.verdict.call.toUpperCase()}** — ${d.verdict.rationale}\n`);
  L.push(`Category: ${d.identity.category} · Tags: ${d.identity.tags.join(", ")} · Generated ${d.generated_at.slice(0, 10)} · schema v${d.schema_version}\n`);

  L.push(`## Scores\n`);
  L.push(`| Axis | Score | Inputs |`);
  L.push(`|---|---|---|`);
  for (const [k, v] of Object.entries(d.scores)) L.push(scoreLine(k, v));

  L.push(`\n## The Opportunity\n`);
  L.push(`**Problem.** ${d.opportunity.problem}\n`);
  L.push(`**Who has it.** ${d.opportunity.avatar}\n`);
  L.push(`**Why now.** ${srcFoot(d.opportunity.why_now)}\n`);
  if (d.opportunity.trend_signals.length) {
    L.push(`**Trend signals:**`);
    for (const t of d.opportunity.trend_signals) L.push(`- ${srcFoot(t)}`);
  }
  if (d.opportunity.pain_evidence.length) {
    L.push(`\n**Pain evidence (real quotes):**`);
    for (const p of d.opportunity.pain_evidence) L.push(`- "${p.quote}" — ${p.where} ([source](${p.url})) _${p.signal}_`);
  }

  L.push(`\n## Market\n`);
  if (d.market.size_estimates.length) {
    L.push(`**Sizing:**`);
    for (const s of d.market.size_estimates) L.push(`- ${srcFoot(s)}`);
  }
  if (d.market.competitors.length) {
    L.push(`\n**Competitors:**`);
    for (const c of d.market.competitors) {
      L.push(`- **${c.name}**${c.url ? ` ([site](${c.url}))` : ""}${c.positioning ? ` — ${c.positioning}` : ""}${c.pricing ? ` · pricing: ${srcFoot(c.pricing)}` : ""}${c.weakness ? ` · weakness: ${c.weakness}` : ""}`);
    }
  }
  if (d.market.gaps.length) L.push(`\n**Gaps:** ${d.market.gaps.map((g) => `\n- ${g}`).join("")}`);
  L.push(`\n**Moat potential.** ${d.market.moat_potential}\n`);

  L.push(`## Business\n`);
  L.push(`**Model.** ${d.business.model}\n`);
  L.push(`**Pricing anchor.** ${srcFoot(d.business.pricing_anchor)}\n`);
  if (d.business.value_ladder.length) L.push(`**Value ladder:** ${d.business.value_ladder.map((v) => `\n- ${v}`).join("")}\n`);
  L.push(`**Channels.** ${d.business.channels.join(" · ")}\n`);
  L.push(`**First customers.** ${d.business.first_customers}\n`);

  L.push(`## Execution\n`);
  L.push(`**MVP scope.** ${d.execution.mvp_scope}\n`);
  if (d.execution.build_plan.length) L.push(`**Build plan:** ${d.execution.build_plan.map((s, i) => `\n${i + 1}. ${s}`).join("")}\n`);
  L.push(`**Time to MVP.** ${d.execution.time_to_mvp}\n`);
  L.push(`**Founder fit.** ${d.execution.founder_fit_notes}\n`);

  L.push(`## The Case Against (kill pass)\n`);
  L.push(`${d.verdict.kill_case_summary}\n`);

  L.push(`---\n`);
  L.push(`_Seats: ${Object.entries(d.provenance.model_seats).map(([s, m]) => `${s}=${m}`).join(" · ")}_`);
  if (d.provenance.degraded_seats.length) L.push(`\n_Degraded seats (failed, output omitted — never faked): ${d.provenance.degraded_seats.join(", ")}_`);
  L.push(`\n_Run: ${Math.round(d.provenance.run_ms / 1000)}s · input: "${d.provenance.idea_input.slice(0, 140)}"_`);
  return L.join("\n");
}
