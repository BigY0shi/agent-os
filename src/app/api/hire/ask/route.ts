import { getHireLead, addHireAnswer, LEADS_DIR } from "@/lib/hireDesk";
import { recordDeskQA, hireSubject } from "@/lib/deskMemory";
import { machineFor } from "@/lib/hireMachines";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { withSkills } from "@/lib/platformSkills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id, question } → ask Claude about this posting, append the answer to the
// lead. Mirrors /api/deals/ask, with the machine context added since "would the
// CS engine handle their Zendesk setup" is the typical question here.
export async function POST(req: Request) {
  const { id, question } = await req.json().catch(() => ({})) as { id?: string; question?: string };
  if (!id || !question?.trim()) return Response.json({ ok: false, error: "id and question required" }, { status: 400 });

  const lead = await getHireLead(id);
  if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
  const m = machineFor(lead.machineKey);

  const prompt =
    "You are helping a RevOps / automation consultant decide whether to pitch a productized machine to a company that is mid-hire for a role the machine covers. " +
    "Answer the operator's question concretely and concisely. If it's about an unfamiliar tool, API, or integration, " +
    "give a short crash-course answer with the single most important gotcha. Be honest about uncertainty — never bluff.\n\n" +
    `THE MACHINE: ${m.name} (${m.built ? "built" : "not built yet"}) — ${m.loop}\n\n` +
    `THE POSTING: ${lead.title}\n` +
    `Company: ${lead.company ?? "?"} · ${lead.employment ?? "?"} · Salary: ${lead.salary ?? "not published"}\n` +
    (lead.firmo && !lead.firmo.error
      ? `Company size: ${lead.firmo.employees ?? "?"} staff · ${lead.firmo.type ?? "?"}\n`
      : "") +
    `Description: ${(lead.desc || "").slice(0, 1500)}\n\n` +
    `QUESTION: ${question.trim()}`;

  try {
    // `--model` is required (a bare `claude -p` resolves a "default" alias that
    // errors), and the prompt goes over stdin since it embeds the job description.
    const r = await run("claude", ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()], { timeoutMs: 120_000, input: withSkills(prompt, "hire"), cwd: LEADS_DIR });
    if (!r.ok || !r.stdout.trim()) {
      return Response.json({ ok: false, error: r.stderr || "agent returned nothing" }, { status: 502 });
    }
    const answer = r.stdout.trim();
    await addHireAnswer(id, question.trim(), answer);
    void recordDeskQA("hire-engine", hireSubject(lead), question.trim(), answer);
    return Response.json({ ok: true, answer });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
