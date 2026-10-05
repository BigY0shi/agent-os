import { listInstalledSkills, createSkill, SkillError } from "@/lib/platformSkills";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/skills -> { installed: [{ name, description }], active: { global, modules } }
//      The run-launch drawer has fetched this since S3 and got a 404, so its skills
//      picker was always empty; this route closes that gap (S14).
// POST /api/skills { name, description, body } -> { skill } | 400 | 409
//      Creates ~/.agentic-os/skills/<name>/SKILL.md. Never overwrites.
export async function GET() {
  const s = readSettings().skills ?? {};
  return Response.json(
    { installed: listInstalledSkills(), active: { global: s.global ?? [], modules: s.modules ?? {} } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "expected JSON { name, description, body }" }, { status: 400 });
  try {
    return Response.json({ skill: createSkill(body as Record<string, unknown>) }, { status: 201 });
  } catch (e) {
    if (e instanceof SkillError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
