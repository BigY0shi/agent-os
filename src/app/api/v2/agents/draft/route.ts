import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { cliComplete } from "@/lib/loopEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/agents/draft { idea } → { draft } — the ForgeWizard's "Draft
 * with AI" (SPEC-E F4.1 step 1): turns freeform ideation notes into a tight
 * system.md scaffold via the user's default CLI agent (settings.defaultAgent,
 * cliComplete). Rule 11: any failure (unwired CLI, timeout, empty output)
 * returns a LOUD error naming the provider — never a silent fallback.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { idea?: string } | null;
  const idea = body?.idea?.trim();
  if (!idea) return NextResponse.json({ error: "idea text is required" }, { status: 400, ...noStore });

  const agent = readSettings().defaultAgent || "claude";
  const prompt =
    "Turn the following agent idea into standing instructions (a system.md) for a reusable background agent. " +
    "Be concrete: what to check each run, what good output looks like, where to leave results. " +
    "Reply with ONLY the instructions text, no preamble.\n\nIDEA:\n" + idea.slice(0, 4000);

  try {
    const draft = (await cliComplete(agent, prompt, { timeoutMs: 120_000 })).trim();
    if (!draft) {
      return NextResponse.json({ error: `provider cli:${agent} returned empty output` }, { status: 502, ...noStore });
    }
    return NextResponse.json({ draft }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `provider cli:${agent} failed: ${message}` }, { status: 502, ...noStore });
  }
}
