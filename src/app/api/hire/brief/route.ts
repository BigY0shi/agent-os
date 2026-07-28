import { getHireLead, setHireBrief, LEADS_DIR, type HireBrief } from "@/lib/hireDesk";
import { machineFor } from "@/lib/hireMachines";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → generate the analysis block (summary / why / approach / crash course)
// for ONE hire lead. Mirrors /api/deals/brief: hire.mjs only scrapes, nothing
// pre-pitches these leads, so without this every card is a bare posting.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const lead = await getHireLead(id);
  if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
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

  try {
    const r = await run(
      "claude",
      ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()],
      { timeoutMs: 180_000, input: prompt, cwd: LEADS_DIR },
    );
    const out = (r.stdout || "").trim();
    if (!r.ok || !out) {
      return Response.json({ ok: false, error: r.stderr?.slice(-200) || "agent returned nothing" }, { status: 502 });
    }
    // Agents wrap JSON in fences or preamble often enough that hard-failing would
    // make this feel broken. Take the outermost object.
    const mm = out.match(/\{[\s\S]*\}/);
    if (!mm) return Response.json({ ok: false, error: "agent did not return JSON" }, { status: 502 });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(mm[0]); } catch { return Response.json({ ok: false, error: "malformed JSON from agent" }, { status: 502 }); }

    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const brief: HireBrief = {
      summary: str(parsed.summary), why: str(parsed.why),
      approach: str(parsed.approach), crashCourse: str(parsed.crashCourse),
    };
    if (!brief.summary && !brief.why) {
      return Response.json({ ok: false, error: "the agent returned no usable brief" }, { status: 502 });
    }
    await setHireBrief(id, brief);
    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
