import { NextResponse } from "next/server";
import { listPersonas, writePersona, BUSINESSES, type Persona, type Business } from "@/lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personas are MODEL-AGNOSTIC editable data (AGENTS.md rule 17): the in-app editor
// reads/writes them here; the drafting engine injects them into whichever agent runs.
export async function GET() {
  return NextResponse.json({ ok: true, personas: await listPersonas() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const p = body.persona as Partial<Persona> | undefined;
  if (!p || !p.id || !/^[a-z0-9-]{1,40}$/.test(String(p.id))) {
    return NextResponse.json({ ok: false, error: "bad persona id" }, { status: 400 });
  }
  const business = BUSINESSES.some((b) => b.id === p.business) ? (p.business as Business) : (p.id as Business);
  const clean: Persona = {
    id: String(p.id),
    name: String(p.name || p.id).slice(0, 80),
    business,
    audience: String(p.audience || "").slice(0, 500),
    tone: String(p.tone || "").slice(0, 500),
    rules: (Array.isArray(p.rules) ? p.rules : []).map((r) => String(r).slice(0, 200)).slice(0, 12),
    banned: (Array.isArray(p.banned) ? p.banned : []).map((b) => String(b).slice(0, 120)).slice(0, 16),
    cta: String(p.cta || "").slice(0, 300),
    examples: p.examples ? String(p.examples).slice(0, 2000) : undefined,
  };
  await writePersona(clean);
  return NextResponse.json({ ok: true, personas: await listPersonas() });
}
