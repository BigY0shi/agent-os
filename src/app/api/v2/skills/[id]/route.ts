import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { SkillError, archiveSkill, getSkill, updateSkill } from "@/lib/v2/skills/store";

// SPEC-B B7 — one policy skill. DELETE = soft-archive (archived_at stamp),
// never row destruction (house rule).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(err: unknown) {
  if (err instanceof SkillError) {
    return NextResponse.json({ error: err.message }, { status: err.status, ...noStore });
  }
  throw err;
}

export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  const skill = getSkill(id);
  if (!skill) return NextResponse.json({ error: "skill not found" }, { status: 404, ...noStore });
  return NextResponse.json({ skill }, noStore);
}

/** PATCH { title?, description?, policyMd?, isActive?, position? } → { skill }. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  try {
    const skill = updateSkill(id, {
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      policyMd: typeof body.policyMd === "string" ? body.policyMd : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      position: typeof body.position === "number" ? body.position : undefined,
    });
    return NextResponse.json({ skill }, noStore);
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE → soft-archive → { ok, skill } (row retained; drops out of lists + injection). */
export async function DELETE(_req: Request, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  try {
    const skill = archiveSkill(id);
    return NextResponse.json({ ok: true, skill }, noStore);
  } catch (err) {
    return errorResponse(err);
  }
}
