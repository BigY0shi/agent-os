import { getDeal, addAnswer } from "@/lib/upworkDesk";
import { run } from "@/lib/runner";

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
    const r = await run("claude", ["-p", prompt], { timeoutMs: 120_000 });
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
