import { getDeal, addAnswer, LEADS_DIR } from "@/lib/upworkDesk";
import { recordDeskQA, dealSubject } from "@/lib/deskMemory";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { withSkills } from "@/lib/platformSkills";
import { listingText } from "@/lib/dealDeskControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id, question } → ask Claude about this listing, append the answer to the deal.
export async function POST(req: Request) {
  const { id, question } = await req.json().catch(() => ({})) as { id?: string; question?: string };
  if (!id || !question?.trim()) return Response.json({ ok: false, error: "id and question required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });

  // Every question used to be a cold start: the prompt was rebuilt from the listing and
  // the one question, and `deal.answers` - the conversation already held on this very
  // card - was never passed in. So the assistant had no idea what it had just said, and
  // a follow-up like "what about the second one?" had nothing to resolve against.
  const priorQA = (deal.answers || []).filter((a) => a && a.q && a.a);
  const history = priorQA.length
    ? `THE CONVERSATION SO FAR on this listing, oldest first. Treat it as your own memory: do not repeat an answer you already gave, and resolve references like "that" or "the second one" against it.\n\n${
        priorQA.map((a) => `Q: ${a.q}\nA: ${a.a}`).join("\n\n")}\n\n`
    : "";

  const prompt =
    "You are helping a RevOps / automation consultant decide on and prepare an Upwork proposal. " +
    "Answer the operator's question concretely and concisely. If it's about an unfamiliar tool, API, or integration, " +
    "give a short crash-course answer with the single most important gotcha. Be honest about uncertainty — never bluff.\n\n" +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""}\n` +
    `Tags: ${(deal.tags || []).join(", ")}\n` +
    // The old 1500-char slice cut the tail, which is where "To Apply" instructions live,
    // so "what are they asking applicants for?" was unanswerable from the prompt.
    `Full description:\n${listingText(deal.description)}\n\n` +
    history +
    `QUESTION: ${question.trim()}`;

  try {
    // `--model` is required (a bare `claude -p` resolves a "default" alias that
    // errors), and the prompt goes over stdin since it embeds the job description.
    // Rooted in LEADS_DIR with tools unlocked so it can actually open the corpus it
    // is being asked about (board.json, contacts, prior pitches) instead of
    // answering from the 1500 chars we paste in. No orchestrate: this is a single
    // question, not a build.
    const r = await run("claude", ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()], { timeoutMs: 120_000, input: withSkills(prompt, "deals"), cwd: LEADS_DIR });
    if (!r.ok || !r.stdout.trim()) {
      return Response.json({ ok: false, error: r.stderr || "agent returned nothing" }, { status: 502 });
    }
    const answer = r.stdout.trim();
    await addAnswer(id, question.trim(), answer);
    void recordDeskQA("deal-desk", dealSubject(deal), question.trim(), answer);
    return Response.json({ ok: true, answer });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
