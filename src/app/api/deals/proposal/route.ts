import { getDeal, setEditedPitch, LEADS_DIR } from "@/lib/upworkDesk";
import { recordDeskPitch, dealSubject } from "@/lib/deskMemory";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { withSkills } from "@/lib/platformSkills";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Delegating to worker agents costs wall-clock that a single pass didn't — the old
// 120s ceiling would now read as "agent returned nothing" on a working run.
export const maxDuration = 600;

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

  // Registered as a module run (roadmap S2 backlog): a proposal takes minutes
  // with orchestrate on, and the owner reads other cards meanwhile. STOP kills
  // the claude child (runner.ts killTree on ctx.signal). Same await, same codes.
  const moduleRun = startModuleRun(
    { module: "deals", label: `Proposal: ${deal.title}`, href: "/deals" },
    async (ctx) => {
      ctx.log(`writing the proposal${notes ? " with the operator's notes" : ""}`);
      // `--model` is required (a bare `claude -p` resolves a "default" alias that
      // errors), and the prompt goes over stdin since it embeds the listing + pitch.
      // Rooted in LEADS_DIR with tools unlocked, so a proposal can be grounded in the
      // real corpus — prior winning pitches, the portfolio, contacts. orchestrate is on:
      // a proposal is research + positioning + copy, which is worth splitting across
      // agents rather than one model doing all three passes alone.
      const r = await run("claude", ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs({ orchestrate: true })], { timeoutMs: 300_000, input: withSkills(prompt, "deals"), cwd: LEADS_DIR, signal: ctx.signal });
      if (!r.ok || !r.stdout.trim()) throw new HttpError(502, r.stderr || "agent returned nothing");
      const proposal = r.stdout.trim();
      if (ctx.signal.aborted) throw new Error("stopped before the proposal was saved");
      await setEditedPitch(id, proposal);
      // Hooked here rather than in setEditedPitch, which the drawer also calls on
      // every hand edit - one episode per generation, not per keystroke save.
      void recordDeskPitch("deal-desk", dealSubject(deal), proposal);
      ctx.log(`proposal saved (${proposal.split(/\s+/).length} words)`);
      return proposal;
    },
    { summarize: (p) => ({ id, words: p.split(/\s+/).length, usedNotes: !!notes }) },
  );
  try {
    const proposal = await moduleRun.promise;
    return Response.json({ ok: true, proposal, usedNotes: !!notes, runId: moduleRun.id });
  } catch (e) {
    return runErrorResponse(e, moduleRun.id);
  }
}
