import { getDeal, setEditedPitch, setDossier, LEADS_DIR } from "@/lib/upworkDesk";
import { recordDeskPitch, dealSubject } from "@/lib/deskMemory";
import { run } from "@/lib/runner";
import { claudeModel } from "@/lib/claudeModel";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { withSkills } from "@/lib/platformSkills";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";
import {
  listingText, dossierInputHash, dossierIsStale, likelyMissedAsks, openWithViolated,
  type Dossier,
} from "@/lib/dealDeskControl";
import { generateDossier, dossierInputs, dossierBlock } from "@/lib/dealDossier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Delegating to worker agents costs wall-clock that a single pass didn't — the old
// 120s ceiling would now read as "agent returned nothing" on a working run. The
// dossier pass and a possible repair pass ride inside the same budget.
export const maxDuration = 600;

// POST { id } → generate a complete, submit-ready Upwork proposal for this deal.
//
// Two passes, deliberately. The dossier settles what the client actually asked and how
// we answer it; the writer then works from that account instead of reconciling the
// notes, the Q&A, the brief and 12k of listing while also producing copy. The extracted
// asks then make "did it answer them?" checkable, which no amount of prompt tuning
// would have given us.
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const found = await getDeal(id);
  if (!found) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });
  // Bound to a const so the null-narrowing survives into the closures below.
  const deal = found;
  const notes = (deal.notes || "").trim();
  const answers = (deal.answers || []).filter((a) => a && a.q && a.a);

  const briefBlock = [
    deal.summary ? `What they want: ${deal.summary}` : "",
    deal.why ? `Our angle: ${deal.why}` : "",
    deal.approach ? `Delivery approach:\n${deal.approach}` : "",
    deal.crashCourse ? `Stack notes and gotchas: ${deal.crashCourse}` : "",
  ].filter(Boolean).join("\n");

  function buildPrompt(dossier: Dossier | null): string {
    return (
      "You are an expert Upwork proposal writer for a RevOps / automation consultant (Launchworks Dynamics). " +
      "Write a COMPLETE, submit-ready Upwork proposal for the listing below.\n\n" +
      (dossier
        // With a dossier the asks are already extracted, so the writer is told what to
        // satisfy rather than asked to go find it.
        ? `THE PREPARED ACCOUNT OF THIS LISTING. Satisfy all of it:\n${dossierBlock(dossier)}\n\n`
        // Without one (the build failed), fall back to telling the writer to do the
        // extraction itself. Worse, but honest about what it has.
        : "BEFORE YOU WRITE, read the whole listing and pull out every instruction to applicants: " +
          "questions to answer, a word or phrase to open with, details to state (rate, availability, " +
          "timezone, tools used), anything under a heading like \"To Apply\" or \"When applying\". " +
          "These sit at the END of a listing. A proposal that ignores them is discarded.\n\n") +
      "RULES:\n" +
      "- Answer EVERY question and follow EVERY application instruction. This outranks the " +
      "length guidance: go longer if answering them takes longer.\n" +
      "- If an opening phrase is required, that phrase is the literal first thing you output.\n" +
      "- ~110-140 words when the listing asks for nothing of its own. Short wins — clients skim.\n" +
      "- Structure: (1) a diagnostic opener that proves you read THIS listing and names their specific problem — the FIRST sentence must hook, it's all the client sees in the preview; (2) one concrete, relevant proof point; (3) a tight how-I'd-approach-it in 2-3 short lines; (4) direct answers to their questions; (5) one specific question that invites a reply.\n" +
      "- Blunt, specific, no fluff. NO \"I'm passionate\", no generic bio, no listing every skill.\n" +
      "- Never invent a credential, a client name, a metric, or an availability. Where the " +
      "material does not cover something they asked, answer honestly from what IS here.\n" +
      "- Output ONLY the proposal text — no preamble, no headings, no signature, no word count.\n\n" +
      (notes ? `MUST INCLUDE — the operator's own notes; weave these in naturally, they are important:\n${notes}\n\n` : "") +
      (answers.length ? `THE OPERATOR'S OWN ANSWERS about this listing. Ground truth: where this conflicts with anything else, it WINS:\n${answers.map((a) => `Q: ${a.q}\nA: ${a.a}`).join("\n\n")}\n\n` : "") +
      `LISTING: ${deal.title}\n` +
      `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""} · client ${deal.clientCountry ?? "?"}, $${deal.clientTotalSpent ?? "?"} spent, ${deal.clientRating ?? "?"}★\n` +
      `Full description — read all of it, the application instructions are usually at the bottom:\n${listingText(deal.description)}\n\n` +
      (briefBlock ? `OUR ANALYST'S BRIEF on this listing:\n${briefBlock}\n\n` : "") +
      "Raw material to draw from (don't copy verbatim):\n" +
      `- Opener draft: ${deal.pitch || ""}`
    );
  }

  // Registered as a module run (roadmap S2 backlog): a proposal takes minutes
  // with orchestrate on, and the owner reads other cards meanwhile. STOP kills
  // the claude child (runner.ts killTree on ctx.signal). Same await, same codes.
  const moduleRun = startModuleRun(
    { module: "deals", label: `Proposal: ${deal.title}`, href: "/deals" },
    async (ctx) => {
      // -- pass 1: the account -------------------------------------------------
      // A dossier built before the owner added a note would anchor the draft to
      // superseded material, so staleness is checked against the inputs, not age.
      const hash = dossierInputHash(dossierInputs(deal));
      let dossier: Dossier | null =
        deal.dossier && !dossierIsStale(deal.dossier, hash) ? deal.dossier : null;
      if (dossier) {
        ctx.log(`reusing the dossier (${dossier.asks.length} asks)`);
      } else {
        ctx.log(deal.dossier ? "the dossier is stale, rebuilding it" : "building the dossier");
        dossier = await generateDossier(deal, ctx.signal);
        if (dossier) {
          await setDossier(id, dossier);
          ctx.log(`dossier: ${dossier.asks.length} asks, ${dossier.gaps.length} gaps${dossier.openWith ? `, must open with "${dossier.openWith}"` : ""}`);
        } else {
          // Loud, not silent: the writer is about to work without the account.
          ctx.log("dossier build failed; writing from the raw material instead");
        }
      }
      if (ctx.signal.aborted) throw new Error("stopped before the proposal was written");

      // -- pass 2: the draft ---------------------------------------------------
      // `--model` is required (a bare `claude -p` resolves a "default" alias that
      // errors), and the prompt goes over stdin since it embeds the listing + pitch.
      // Rooted in LEADS_DIR with tools unlocked, so a proposal can be grounded in the
      // real corpus — prior winning pitches, the portfolio, contacts. orchestrate is on:
      // a proposal is research + positioning + copy, which is worth splitting across
      // agents rather than one model doing all three passes alone.
      const write = async (input: string) => {
        const r = await run("claude", ["-p", "--model", claudeModel(), "--output-format", "text", ...claudeBuilderArgs({ orchestrate: true })], { timeoutMs: 300_000, input: withSkills(input, "deals"), cwd: LEADS_DIR, signal: ctx.signal });
        if (!r.ok || !r.stdout.trim()) throw new HttpError(502, r.stderr || "agent returned nothing");
        return r.stdout.trim();
      };
      let proposal = await write(buildPrompt(dossier));

      // -- pass 3, only when needed: the repair --------------------------------
      // The check is a heuristic over term overlap and is treated as one: it can say
      // "this looks unaddressed", never "this is covered". One bounded repair attempt,
      // then the remaining misses are REPORTED rather than quietly accepted.
      let missed = likelyMissedAsks(proposal, dossier);
      let openBad = openWithViolated(proposal, dossier);
      if (dossier && (missed.length || openBad) && !ctx.signal.aborted) {
        ctx.log(`revising: ${missed.length} ask(s) look unaddressed${openBad ? ", opening phrase missing" : ""}`);
        proposal = await write(
          "Revise the Upwork proposal below. Keep everything that already works; change only what is needed.\n\n" +
          (openBad && dossier.openWith ? `IT MUST OPEN WITH THIS EXACT PHRASE, as the literal first words: ${dossier.openWith}\n\n` : "") +
          (missed.length ? `THESE ASKS FROM THE CLIENT LOOK UNANSWERED. Answer each one explicitly:\n${missed.map((a, i) => `${i + 1}. ${a.ask}\n   Our answer: ${a.answer ?? "(nothing on hand answers this - say something honest or ask them, do not invent)"}`).join("\n")}\n\n` : "") +
          "Output ONLY the revised proposal text.\n\n" +
          `THE FULL ACCOUNT OF THE LISTING:\n${dossierBlock(dossier)}\n\n` +
          `CURRENT DRAFT:\n${proposal}`,
        );
        missed = likelyMissedAsks(proposal, dossier);
        openBad = openWithViolated(proposal, dossier);
      }

      if (ctx.signal.aborted) throw new Error("stopped before the proposal was saved");
      await setEditedPitch(id, proposal);
      // Hooked here rather than in setEditedPitch, which the drawer also calls on
      // every hand edit - one episode per generation, not per keystroke save.
      void recordDeskPitch("deal-desk", dealSubject(deal), proposal);
      ctx.log(`proposal saved (${proposal.split(/\s+/).length} words)`);
      if (missed.length) ctx.log(`still looks light on ${missed.length} ask(s) - worth a read before sending`);
      return { proposal, dossier, missed: missed.map((a) => a.ask), openBad };
    },
    {
      summarize: (out) => ({
        id,
        words: out.proposal.split(/\s+/).length,
        usedNotes: !!notes,
        usedAnswers: answers.length,
        asks: out.dossier?.asks.length ?? 0,
        unaddressed: out.missed.length,
      }),
    },
  );
  try {
    const out = await moduleRun.promise;
    return Response.json({
      ok: true,
      proposal: out.proposal,
      usedNotes: !!notes,
      usedAnswers: answers.length,
      dossier: out.dossier,
      // Surfaced rather than swallowed: the operator decides whether a flagged ask
      // really is unanswered, because the check cannot prove either way.
      unaddressed: out.missed,
      openWithMissing: out.openBad,
      runId: moduleRun.id,
    });
  } catch (e) {
    return runErrorResponse(e, moduleRun.id);
  }
}
