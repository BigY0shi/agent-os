import { getDeal, setBrief, LEADS_DIR } from "@/lib/upworkDesk";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → generate the analysis block (summary / why / approach / crash course)
// for a deal that has none.
//
// Upwork leads get these from the offline pitch pass (pitch.mjs → pitches.json).
// RemoteOK and WWR leads never went through it, so their cards were permanently
// blank where Upwork cards showed real analysis. This is the on-demand equivalent,
// and it works for any source.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });

  const prompt =
    "You are the analyst for a RevOps / automation consultancy triaging inbound job leads.\n" +
    "Assess the listing below and return ONLY minified JSON — no prose, no code fences — with EXACTLY these keys:\n" +
    '{"summary":"...","why":"...","approach":"...","crashCourse":"..."}\n\n' +
    "summary     — 1–2 sentences: what the client actually wants, in plain language.\n" +
    "why         — 1–2 sentences: why we are a credible fit, or honestly why we are not.\n" +
    "approach    — 3–5 short bullets separated by newlines: how we would deliver it.\n" +
    "crashCourse — 2–4 sentences on any unfamiliar tool/API named here, and the single biggest gotcha. Empty string if nothing is unfamiliar.\n\n" +
    "Be concrete and honest. If the listing is thin or a poor fit, say so plainly in `why` — a false positive costs more than a skipped lead.\n\n" +
    `SOURCE: ${deal.source || "upwork"}\n` +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""}\n` +
    `Tags: ${(deal.tags || []).join(", ")}\n` +
    `Description: ${(deal.description || "").slice(0, 4000)}`;

  try {
    const r = await run(
      "claude",
      ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()],
      { timeoutMs: 300_000, input: prompt, cwd: LEADS_DIR },
    );
    const out = (r.stdout || "").trim();
    if (!r.ok || !out) {
      return Response.json({ ok: false, error: r.stderr || "agent returned nothing" }, { status: 502 });
    }

    // Agents wrap JSON in fences or preamble often enough that hard-failing on it
    // would make this feel broken. Take the outermost object and parse that.
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return Response.json({ ok: false, error: "agent did not return JSON" }, { status: 502 });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(m[0]); }
    catch { return Response.json({ ok: false, error: "agent returned malformed JSON" }, { status: 502 }); }

    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const brief = {
      summary: str(parsed.summary), why: str(parsed.why),
      approach: str(parsed.approach), crashCourse: str(parsed.crashCourse),
    };
    if (!brief.summary && !brief.why) {
      return Response.json({ ok: false, error: "agent returned an empty brief" }, { status: 502 });
    }

    await setBrief(id, brief);
    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
