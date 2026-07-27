import { getHireLead, setHirePitch, LEADS_DIR } from "@/lib/hireDesk";
import { machineFor } from "@/lib/hireMachines";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * Strip em/en dashes from outgoing copy.
 *
 * Telling the model "no em dashes" in the prompt is NOT sufficient — verified: it
 * returned "Hi — I saw your opening" anyway. Since this text goes to a real prospect
 * and em dashes are the single loudest AI tell, enforce it in code rather than trust.
 *
 *   "10–20"  → "10-20"  (numeric range: a comma would read as two figures)
 *   " — "    → ", "     (parenthetical aside reads fine as a comma)
 *   "x—y"    → "x, y"
 */
function deDash(s: string): string {
  return s
    // Ranges FIRST — "$40k–60k" or "10–20 tickets" must not become "10, 20".
    .replace(/(\d[\d,.$kKmM]*)\s*[—–]\s*(?=[\d$])/g, "$1-")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",")     // collapse a comma we just doubled up
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// POST { id } → write the "augment the hire" outreach for one job posting.
//
// This is the whole point of the module. The prospect is mid-hire for a role that a
// machine already covers 70-80% of, so the message has to do three things at once:
// name the machine (it exists, this is not a bespoke build), anchor against the salary
// they are about to commit, and lead with draft-not-send so the "AI will email my
// customers garbage" objection never forms.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const lead = await getHireLead(id);
  if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
  const m = machineFor(lead.machineKey);

  const salaryLine = lead.salaryNum
    ? `They have published a salary of roughly $${lead.salaryNum.toLocaleString()}. Anchor against it — the machine is a fraction of one year of that role.`
    : "No salary is published. Do NOT invent one; anchor on the cost of the role generally, or on time rather than money.";

  // Firmographics only exist if the lead has been enriched. When they do they are the
  // single most decisive input: this offer lands with an SMB and is mis-sized for an
  // enterprise, and the model cannot infer that from a job posting alone.
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

  try {
    const r = await run(
      "claude",
      ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()],
      { timeoutMs: 300_000, input: prompt, cwd: LEADS_DIR },
    );
    const out = (r.stdout || "").trim();
    if (!r.ok || !out) {
      return Response.json({ ok: false, error: r.stderr?.slice(-200) || "agent returned nothing" }, { status: 502 });
    }
    const mm = out.match(/\{[\s\S]*\}/);
    if (!mm) return Response.json({ ok: false, error: "agent did not return JSON" }, { status: 502 });
    let parsed: { read?: string; pitch?: string };
    try { parsed = JSON.parse(mm[0]); } catch { return Response.json({ ok: false, error: "malformed JSON from agent" }, { status: 502 }); }
    if (!parsed.pitch?.trim()) return Response.json({ ok: false, error: "agent returned an empty pitch" }, { status: 502 });

    const clean = deDash(parsed.pitch.trim());
    await setHirePitch(id, clean, parsed.read?.trim());
    return Response.json({ ok: true, pitch: clean, read: parsed.read?.trim() ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
