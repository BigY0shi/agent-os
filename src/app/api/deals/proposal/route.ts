import { getDeal, setEditedPitch } from "@/lib/upworkDesk";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id } → generate a complete, submit-ready Upwork proposal for this deal, weaving in
// the operator's own Notes, and save it into the editable proposal box (editedPitch).
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });
  const notes = (deal.notes || "").trim();

  const prompt =
    "You are an expert Upwork proposal writer for a RevOps / automation consultant (Launchworks Dynamics). " +
    "Write a COMPLETE, submit-ready Upwork proposal for the listing below.\n\n" +
    "RULES:\n" +
    "- ~110-140 words. Short wins — clients skim.\n" +
    "- Structure: (1) a diagnostic opener that proves you read THIS listing and names their specific problem — the FIRST sentence must hook, it's all the client sees in the preview; (2) one concrete, relevant proof point; (3) a tight how-I'd-approach-it in 2-3 short lines; (4) one specific question that invites a reply.\n" +
    "- Blunt, specific, no fluff. NO \"I'm passionate\", no generic bio, no listing every skill.\n" +
    "- Output ONLY the proposal text — no preamble, no headings, no signature, no word count.\n\n" +
    (notes ? `MUST INCLUDE — the operator's own notes; weave these in naturally, they are important:\n${notes}\n\n` : "") +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""} · client ${deal.clientCountry ?? "?"}, $${deal.clientTotalSpent ?? "?"} spent, ${deal.clientRating ?? "?"}★\n` +
    `Description: ${(deal.description || "").slice(0, 1500)}\n\n` +
    "Raw material to draw from (don't copy verbatim):\n" +
    `- Angle: ${deal.summary || ""}\n` +
    `- Opener draft: ${deal.pitch || ""}\n` +
    `- Approach: ${deal.approach || ""}`;

  try {
    // `--model` is required (a bare `claude -p` resolves a "default" alias that
    // errors), and the prompt goes over stdin since it embeds the listing + pitch.
    const r = await run("claude", ["-p", "--model", CLAUDE_MODEL, "--output-format", "text"], { timeoutMs: 120_000, input: prompt });
    if (!r.ok || !r.stdout.trim()) {
      return Response.json({ ok: false, error: r.stderr || "agent returned nothing" }, { status: 502 });
    }
    const proposal = r.stdout.trim();
    await setEditedPitch(id, proposal);
    return Response.json({ ok: true, proposal, usedNotes: !!notes });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
