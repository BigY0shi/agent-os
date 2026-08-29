import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getAccount } from "@/lib/v2/integrations/store";
import {
  listAccountRules,
  createAccountRule,
  updateAccountRule,
  deactivateAccountRule,
  type PreFilter,
} from "@/lib/v2/integrations/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

function parsePreFilterBody(v: unknown): PreFilter | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "object") return undefined;
  const obj = v as Record<string, unknown>;
  const include = Array.isArray(obj.include) ? (obj.include as unknown[]).map(String) : undefined;
  const exclude = Array.isArray(obj.exclude) ? (obj.exclude as unknown[]).map(String) : undefined;
  return { ...(include ? { include } : {}), ...(exclude ? { exclude } : {}) };
}

async function requireAccount(ctx: Ctx): Promise<string | NextResponse> {
  const { id } = await ctx.params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "account not found" }, { status: 404, ...noStore });
  }
  return id;
}

/** GET → { rules } (§5.5) — rules owned by this account. */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const id = await requireAccount(ctx);
  if (id instanceof NextResponse) return id;
  return NextResponse.json({ rules: listAccountRules(id) }, noStore);
}

/** POST { name?, text, preFilter?, isActive? } → { rule } (§5.5). */
export async function POST(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const id = await requireAccount(ctx);
  if (id instanceof NextResponse) return id;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "body needs { text }" }, { status: 400, ...noStore });
  }
  try {
    const rule = createAccountRule(id, {
      text: body.text,
      name: typeof body.name === "string" ? body.name : undefined,
      preFilter: parsePreFilterBody(body.preFilter) ?? undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return NextResponse.json({ rule }, { status: 201, ...noStore });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400, ...noStore });
  }
}

/** PATCH { id, name?, text?, preFilter?, isActive? } → { rule } (§5.5). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const id = await requireAccount(ctx);
  if (id instanceof NextResponse) return id;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "body needs { id }" }, { status: 400, ...noStore });
  }
  try {
    const rule = updateAccountRule(id, body.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      text: typeof body.text === "string" ? body.text : undefined,
      preFilter: parsePreFilterBody(body.preFilter),
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return NextResponse.json({ rule }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}

/** DELETE { id } → deactivates (is_active=0), NEVER deletes (§5.5). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const id = await requireAccount(ctx);
  if (id instanceof NextResponse) return id;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "body needs { id }" }, { status: 400, ...noStore });
  }
  try {
    deactivateAccountRule(id, body.id);
    return NextResponse.json({ ok: true }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
