import { getDeal, addAnswer, LEADS_DIR } from "@/lib/upworkDesk";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id, question } → ask Claude about this listing, append the answer to the deal.
export async function POST(req: Request) {
  const { id, question } = await req.json().catch(() => ({})) as { id?: string; question?: string };
  if (!id || !question?.trim()) return Response.json({ ok: false, error: "id and question required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });

  const prompt =
    "You are helping a RevOps / automation consultant decide on and prepare an Upwork proposal. " +
    "Answer the operator's question concretely and concisely. If it's about an unfamiliar tool, API, or integration, " +
    "give a short crash-course answer with the single most important gotcha. Be honest about uncertainty — never bluff.\n\n" +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""}\n` +
    `Tags: ${(deal.tags || []).join(", ")}\n` +
    `Description: ${(deal.description || "").slice(0, 1500)}\n\n` +
    `QUESTION: ${question.trim()}`;

  try {
    // `--model` is required (a bare `claude -p` resolves a "default" alias that
    // errors), and the prompt goes over stdin since it embeds the job description.
    // Rooted in LEADS_DIR with tools unlocked so it can actually open the corpus it
    // is being asked about (board.json, contacts, prior pitches) instead of
    // answering from the 1500 chars we paste in. No orchestrate: this is a single
    // question, not a build.
    const r = await run("claude", ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()], { timeoutMs: 120_000, input: prompt, cwd: LEADS_DIR });
    if (!r.ok || !r.stdout.trim()) {
      return Response.json({ ok: false, error: r.stderr || "agent returned nothing" }, { status: 502 });
    }
    const answer = r.stdout.trim();
    await addAnswer(id, question.trim(), answer);
    return Response.json({ ok: true, answer });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
