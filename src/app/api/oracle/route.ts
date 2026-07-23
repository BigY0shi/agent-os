import { NextResponse } from "next/server";
import { consultOracle, saveConsultation, readConsultations } from "@/lib/oracle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET — the seeker's past consultations (newest first), for the history rail.
export async function GET() {
  const items = await readConsultations();
  return NextResponse.json({ ok: true, items });
}

// POST { question, agent? } — consult the sage. Runs the chosen CLI agent autonomously,
// returns the prose counsel, and appends it to the rolling log.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const question = String(body.question || "").slice(0, 2000).trim();
  const agent = body.agent ? String(body.agent) : undefined;
  if (!question) return NextResponse.json({ ok: false, error: "Ask the Oracle something first." }, { status: 400 });

  try {
    const answer = await consultOracle(question, agent);
    const at = new Date().toISOString();
    await saveConsultation({ at, question, answer, agent: agent || "claude" });
    return NextResponse.json({ ok: true, answer, at });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 240) }, { status: 502 });
  }
}
