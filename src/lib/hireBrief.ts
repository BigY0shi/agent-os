// Hire Engine — shared brief + pitch generation. Extracted from the per-lead
// routes so the batch jobs (hireBatch.ts) and the drawer buttons run the SAME
// prompts through the SAME parsing; the routes are now thin wrappers.
// Prompts are verbatim from the original routes — behavior-neutral extraction.

import { LEADS_DIR, type HireBrief, type HireLead } from "./hireDesk";
import { machineFor } from "./hireMachines";
import { run } from "./runner";
import { CLAUDE_MODEL } from "./config";
import { claudeBuilderArgs } from "./agentPowers";

/**
 * Strip em/en dashes from outgoing copy.
 *
 * Telling the model "no em dashes" in the prompt is NOT sufficient — verified: it
 * returned "Hi — I saw your opening" anyway. Since this text goes to a real prospect
 * and em dashes are the single loudest AI tell, enforce it in code rather than trust.
 */
export function deDash(s: string): string {
  return s
    // Ranges FIRST — "$40k–60k" or "10–20 tickets" must not become "10, 20".
    .replace(/(\d[\d,.$kKmM]*)\s*[—–]\s*(?=[\d$])/g, "$1-")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function claudeJson(prompt: string, timeoutMs: number): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const r = await run(
    "claude",
    ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()],
    { timeoutMs, input: prompt, cwd: LEADS_DIR },
  );
  const out = (r.stdout || "").trim();
  if (!r.ok || !out) return { ok: false, error: r.stderr?.slice(-200) || "agent returned nothing" };
  // Agents wrap JSON in fences or preamble often enough that hard-failing would
  // make this feel broken. Take the outermost object.
  const mm = out.match(/\{[\s\S]*\}/);
  if (!mm) return { ok: false, error: "agent did not return JSON" };
  try { return { ok: true, data: JSON.parse(mm[0]) as Record<string, unknown> }; }
  catch { return { ok: false, error: "malformed JSON from agent" }; }
}

// Stage-1 triage rides the cheap tier — verified to resolve on the CLI 2026-07-28.
const TRIAGE_MODEL = "claude-haiku-4-5";
const TRIAGE_CHUNK = 12;

/**
 * Cheap batched pursue/skip triage over many leads at once — the funnel's first
 * stage, so the expensive full brief (opus) only runs on listings worth pursuing.
 * One haiku call judges TRIAGE_CHUNK postings; ~12x cheaper and faster than
 * briefing everything.
 */
export async function triageHireLeads(leads: HireLead[]): Promise<Record<string, { pursue: boolean; reason: string }>> {
  const out: Record<string, { pursue: boolean; reason: string }> = {};

  for (let i = 0; i < leads.length; i += TRIAGE_CHUNK) {
    const chunk = leads.slice(i, i + TRIAGE_CHUNK);
    const digests = chunk.map((l) => {
      const m = machineFor(l.machineKey);
      return `id: ${l.id}\nmachine: ${m.name} (${m.built ? "built" : "not built"}) · coverage score ${l.coverage}/5\n` +
        `role: ${l.title} @ ${l.company ?? "?"} · ${l.employment ?? "?"} · salary ${l.salary ?? "unpublished"}\n` +
        `posting: ${(l.desc || "").replace(/\s+/g, " ").slice(0, 600)}`;
    }).join("\n\n---\n\n");

    const prompt =
      "You triage job postings for a RevOps / automation consultancy that sells productized machines to companies mid-hire " +
      "(the machine AUGMENTS the hire: drafts everything, the human approves). For each posting below, decide: is this worth " +
      "a full analysis and outreach (pursue), or not (skip)?\n\n" +
      "PURSUE when the machine credibly covers a large share of the role's actual duties and the company looks like it could buy a $1.5-2.5k augmentation.\n" +
      "SKIP when the role is mostly judgment/relationship work the machine can't draft, the posting is an agency/staffing repost, the org is obviously enterprise-scale, or the listing is too vague to assess.\n" +
      "Be selective — a false pursue wastes an expensive analysis, a false skip is recoverable (the human can overrule).\n\n" +
      "Return ONLY a minified JSON array, no prose, no code fences, one entry per posting:\n" +
      '[{"id":"...","pursue":true,"reason":"one plain sentence"}]\n\n' +
      digests;

    const r = await run(
      "claude",
      ["-p", "--model", TRIAGE_MODEL, "--output-format", "text", ...claudeBuilderArgs()],
      { timeoutMs: 120_000, input: prompt, cwd: LEADS_DIR },
    );
    const raw = (r.stdout || "").trim();
    const mm = raw.match(/\[[\s\S]*\]/);
    if (!mm) continue; // a failed chunk stays un-triaged and is retried next pass
    try {
      const arr = JSON.parse(mm[0]) as { id?: string; pursue?: boolean; reason?: string }[];
      const valid = new Set(chunk.map((l) => l.id));
      for (const v of arr) {
        if (v.id && valid.has(v.id) && typeof v.pursue === "boolean") {
          out[v.id] = { pursue: v.pursue, reason: String(v.reason ?? "").slice(0, 300) };
        }
      }
    } catch { /* malformed chunk — retried next pass */ }
  }
  return out;
}

/** Generate the analysis block (summary / why / approach / crash course) for one lead. */
export async function generateHireBrief(lead: HireLead): Promise<HireBrief | { error: string }> {
  const m = machineFor(lead.machineKey);
  const f = lead.firmo;
  const firmoLine = f && !f.error
    ? `Company size (looked up): ${f.employees ?? "unknown"} staff · ${f.type ?? "unknown"} · verdict ${f.fit ?? "unknown"} (${f.fitWhy ?? ""})`
    : "Company size: not looked up — do not guess at headcount or maturity.";

  const prompt =
    "You are the analyst for a RevOps / automation consultancy that sells productized machines to companies mid-hire. " +
    "The offer AUGMENTS the person they are hiring (draft-not-send, the hire approves everything), never replaces them.\n" +
    "Assess the job posting below against the machine and return ONLY minified JSON — no prose, no code fences — with EXACTLY these keys:\n" +
    '{"summary":"...","why":"...","approach":"...","crashCourse":"..."}\n\n' +
    "summary     — 1–2 sentences: what this company is hiring for and what the role actually does day to day, in plain language.\n" +
    "why         — 1–2 sentences: why the machine is (or honestly is not) a credible augmentation for THIS role at THIS company.\n" +
    "approach    — 3–5 short bullets separated by newlines: how we would deploy the machine for them, from their public material to the hire approving drafts.\n" +
    "crashCourse — 2–4 sentences on any unfamiliar tool/stack named in the posting and the single biggest gotcha. Empty string if nothing is unfamiliar.\n\n" +
    "Be concrete and honest. If the role is a poor fit for the machine, say so plainly in `why` — a false positive costs more than a skipped lead.\n\n" +
    `THE MACHINE: ${m.name} (${m.built ? "built" : "NOT built yet — never claim it exists"})\n` +
    `What it does: ${m.loop}\n` +
    `Coverage: ${m.coverage}\n` +
    `Price: ${m.price}, optionally ${m.retainer}\n\n` +
    `THE POSTING\n` +
    `Company: ${lead.company ?? "unknown"} · Role: ${lead.title}\n` +
    `Employment: ${lead.employment ?? "?"} · Location: ${lead.location ?? "?"} · Salary: ${lead.salary ?? "not published"}\n` +
    `${firmoLine}\n` +
    `Description: ${(lead.desc || "").slice(0, 4000)}`;

  const res = await claudeJson(prompt, 180_000);
  if (!res.ok) return { error: res.error };

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const brief: HireBrief = {
    summary: str(res.data.summary), why: str(res.data.why),
    approach: str(res.data.approach), crashCourse: str(res.data.crashCourse),
  };
  if (!brief.summary && !brief.why) return { error: "the agent returned no usable brief" };
  return brief;
}

/** Write the "augment the hire" outreach for one posting. Returns the cleaned pitch + internal read. */
export async function generateHirePitch(lead: HireLead): Promise<{ pitch: string; read?: string } | { error: string }> {
  const m = machineFor(lead.machineKey);

  const salaryLine = lead.salaryNum
    ? `They have published a salary of roughly $${lead.salaryNum.toLocaleString()}. Anchor against it — the machine is a fraction of one year of that role.`
    : "No salary is published. Do NOT invent one; anchor on the cost of the role generally, or on time rather than money.";

  const f = lead.firmo;
  const firmoLine = f && !f.error
    ? `COMPANY SIZE (looked up, treat as reliable)\n` +
      `Domain: ${f.domain ?? "?"} · Headcount: ${f.employees ?? "unknown"} · Type: ${f.type ?? "unknown"}` +
      `${f.foundedYear ? ` · Founded ${f.foundedYear}` : ""}\n` +
      `Verdict: ${f.fit ?? "unknown"} — ${f.fitWhy ?? ""}\n` +
      (f.fit === "poor"
        ? "Because the verdict is POOR, say so in `read` and recommend skipping. Still write the pitch, but keep it short and do not oversell.\n"
        : "")
    : "COMPANY SIZE: not looked up. Do NOT guess at their headcount or maturity in the pitch.\n";

  const builtLine = m.built
    ? "This machine IS BUILT and deployable — say so plainly, and offer a demo built from their own public material."
    : `This machine is NOT built yet. Do NOT claim it exists. Pitch it as a build we would do with them as the first client in this category, and be honest that they would be first.`;

  const prompt =
    "You write short, plain, human B2B outreach for a RevOps / automation consultancy. " +
    "No hype, no em dashes, no 'I hope this finds you well', no bullet lists of features.\n\n" +
    "CONTEXT — a company has posted a job opening for a role that one of our productized machines already covers most of. " +
    "The offer is to AUGMENT the person they hire, never to replace them. The hire still owns the judgment; the machine does the repetitive part and drafts everything for their approval. " +
    "Nothing ever reaches a customer unapproved. That framing is the entire de-risk and must be explicit.\n\n" +
    `THE MACHINE: ${m.name}\n` +
    `What it does: ${m.loop}\n` +
    `How much of the role it covers: ${m.coverage}\n` +
    `Price: ${m.price}, optionally ${m.retainer}\n` +
    `${builtLine}\n\n` +
    `THE POSTING\n` +
    `Company: ${lead.company ?? "unknown"}\n` +
    `Role: ${lead.title}\n` +
    `Employment: ${lead.employment ?? "?"} · Location: ${lead.location ?? "?"}\n` +
    `${salaryLine}\n` +
    `Description: ${(lead.desc || "").slice(0, 2500)}\n\n` +
    firmoLine + "\n" +
    "Return ONLY minified JSON, no code fences, with EXACTLY these keys:\n" +
    '{"read":"...","pitch":"..."}\n\n' +
    "read  — 2–3 sentences for ME, not the prospect: which parts of THIS posting the machine actually covers, which parts it does not, and whether this is genuinely worth sending. If it is a poor fit, say so plainly; a false positive costs more than a skipped lead.\n" +
    "pitch — the outreach itself, 90–130 words, addressed to the hiring manager. Reference a specific duty quoted from their posting so it cannot read as a mass mail. State the machine by name. Make the augment-not-replace framing explicit. End with one low-friction ask (a short demo built from their own public docs), not a calendar link.";

  const res = await claudeJson(prompt, 300_000);
  if (!res.ok) return { error: res.error };

  const pitch = typeof res.data.pitch === "string" ? res.data.pitch.trim() : "";
  if (!pitch) return { error: "agent returned an empty pitch" };
  const read = typeof res.data.read === "string" && res.data.read.trim() ? res.data.read.trim() : undefined;
  return { pitch: deDash(pitch), read };
}
