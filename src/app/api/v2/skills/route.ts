import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { SkillError, createSkill, listSkills } from "@/lib/v2/skills/store";

// SPEC-B B7 — V2 policy skills (v2_skills). NOTE: deliberately at /api/v2/skills;
// the legacy /api/skills route (file-based platformSkills listing) is untouched.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errorResponse(err: unknown) {
  if (err instanceof SkillError) {
    return NextResponse.json({ error: err.message }, { status: err.status, ...noStore });
  }
  throw err;
}

/** GET → { skills } (archived rows hidden; ?all=1 includes them). */
export async function GET(req: NextRequest) {
  ensureV2();
  const includeArchived = req.nextUrl.searchParams.get("all") === "1";
  return NextResponse.json({ skills: listSkills({ includeArchived }) }, noStore);
}

/** POST { title, description?, policyMd?, isActive? } → 201 { skill }. */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string") {
    return NextResponse.json({ error: "body must carry a string 'title'" }, { status: 400, ...noStore });
  }
  try {
    const skill = createSkill({
      title: body.title,
      description: typeof body.description === "string" ? body.description : undefined,
      policyMd: typeof body.policyMd === "string" ? body.policyMd : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return NextResponse.json({ skill }, { status: 201, ...noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
