import { getDeal, setEditedPitch, LEADS_DIR } from "@/lib/upworkDesk";
import { recordDeskPitch, dealSubject } from "@/lib/deskMemory";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { withSkills } from "@/lib/platformSkills";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";
import { listingText } from "@/lib/dealDeskControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Delegating to worker agents costs wall-clock that a single pass didn't — the old
// 120s ceiling would now read as "agent returned nothing" on a working run.
export const maxDuration = 600;

// POST { id } → generate a complete, submit-ready Upwork proposal for this deal, grounded
// in the operator's Notes, the Q&A held on the card, and the analyst's brief, and save it
// into the editable proposal box (editedPitch).
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });
  const notes = (deal.notes || "").trim();

  // The Q&A held on this card. These are the operator's own words about THIS listing,
  // so they outrank anything the model would infer from the description.
  const answers = (deal.answers || []).filter((a) => a && a.q && a.a);
  const answerBlock = answers.map((a) => `Q: ${a.q}\nA: ${a.a}`).join("\n\n");

  // The analyst's brief on this listing, when one has been generated. The proposal used
  // to get only `summary` and `approach` as loose "raw material"; `why` and crashCourse
  // (the stack gotchas) never reached it at all.
  const briefBlock = [
    deal.summary ? `What they want: ${deal.summary}` : "",
    deal.why ? `Our angle: ${deal.why}` : "",
    deal.approach ? `Delivery approach:\n${deal.approach}` : "",
    deal.crashCourse ? `Stack notes and gotchas: ${deal.crashCourse}` : "",
  ].filter(Boolean).join("\n");

  const prompt =
    "You are an expert Upwork proposal writer for a RevOps / automation consultant (Launchworks Dynamics). " +
    "Write a COMPLETE, submit-ready Upwork proposal for the listing below.\n\n" +
    "BEFORE YOU WRITE, read the whole listing and pull out every instruction to applicants: " +
    "questions to answer, a word or phrase to open with, details to state (rate, availability, " +
    "timezone, tools used), anything asked for under a heading like \"To Apply\", \"How to Apply\" " +
    "or \"When applying\". These sit at the END of a listing. A proposal that ignores them is " +
    "discarded no matter how good the rest of it is.\n\n" +
    "RULES:\n" +
    "- Answer EVERY question and follow EVERY application instruction the listing gives. " +
    "This outranks the length guidance: go longer if answering them takes longer.\n" +
    "- If the listing asks you to open with a specific word or phrase, that phrase is the " +
    "literal first thing in your output.\n" +
    "- ~110-140 words when the listing asks for nothing of its own. Short wins — clients skim.\n" +
    "- Structure: (1) a diagnostic opener that proves you read THIS listing and names their specific problem — the FIRST sentence must hook, it's all the client sees in the preview; (2) one concrete, relevant proof point; (3) a tight how-I'd-approach-it in 2-3 short lines; (4) direct answers to their questions; (5) one specific question that invites a reply.\n" +
    "- Blunt, specific, no fluff. NO \"I'm passionate\", no generic bio, no listing every skill.\n" +
    "- Never invent a credential, a client name, a metric, or an availability. If they ask for " +
    "something the material below does not cover, answer plainly from what IS here rather than " +
    "inventing a detail.\n" +
    "- Output ONLY the proposal text — no preamble, no headings, no signature, no word count.\n\n" +
    (notes ? `MUST INCLUDE — the operator's own notes; weave these in naturally, they are important:\n${notes}\n\n` : "") +
    (answerBlock ? `THE OPERATOR'S OWN ANSWERS about this listing, from the Q&A on the card. This is ground truth: where it conflicts with anything else here it WINS, and any listing question it covers must be answered its way:\n${answerBlock}\n\n` : "") +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""} · client ${deal.clientCountry ?? "?"}, $${deal.clientTotalSpent ?? "?"} spent, ${deal.clientRating ?? "?"}★\n` +
    `Full description — read all of it, the application instructions are usually at the bottom:\n${listingText(deal.description || "")}\n\n` +
    (briefBlock ? `OUR ANALYST'S BRIEF on this listing:\n${briefBlock}\n\n` : "") +
    "Raw material to draw from (don't copy verbatim):\n" +
    `- Opener draft: ${deal.pitch || ""}`;

  // Registered as a module run (roadmap S2 backlog): a proposal takes minutes
  // with orchestrate on, and the owner reads other cards meanwhile. STOP kills
  // the claude child (runner.ts killTree on ctx.signal). Same await, same codes.
  const moduleRun = startModuleRun(
    { module: "deals", label: `Proposal: ${deal.title}`, href: "/deals" },
    async (ctx) => {
      const grounding = [
        notes ? "the operator's notes" : "",
        answers.length ? `${answers.length} Q&A answer${answers.length === 1 ? "" : "s"}` : "",
        briefBlock ? "the brief" : "",
      ].filter(Boolean);
      ctx.log(`writing the proposal${grounding.length ? ` with ${grounding.join(", ")}` : ""}`);
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
    { summarize: (p) => ({ id, words: p.split(/\s+/).length, usedNotes: !!notes, usedAnswers: answers.length, usedBrief: !!briefBlock }) },
  );
  try {
    const proposal = await moduleRun.promise;
    return Response.json({ ok: true, proposal, usedNotes: !!notes, usedAnswers: answers.length, usedBrief: !!briefBlock, runId: moduleRun.id });
  } catch (e) {
    return runErrorResponse(e, moduleRun.id);
  }
}
