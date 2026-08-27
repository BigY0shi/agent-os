import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { createRule, listRules, updateRule } from "@/lib/v2/memory/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/v2/memory/rules — ?source=&activeOnly= → {rules}. */
export async function GET(req: NextRequest) {
  ensureV2();
  const sp = req.nextUrl.searchParams;
  const rules = listRules({
    source: sp.get("source") ?? undefined,
    activeOnly: sp.get("activeOnly") === "true",
  });
  return NextResponse.json({ rules }, noStore);
}

/** POST /api/v2/memory/rules — {text, name?, source?, isActive?} → rule row. */
export async function POST(req: NextRequest) {
  ensureV2();
  try {
    const body = (await req.json()) as {
      text?: string;
      name?: string | null;
      source?: string | null;
      isActive?: boolean;
    };
    if (!body?.text || !body.text.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400, ...noStore });
    }
    const rule = createRule({
      text: body.text,
      name: body.name ?? null,
      source: body.source ?? null,
      isActive: body.isActive,
    });
    return NextResponse.json({ rule }, { status: 201, ...noStore });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400, ...noStore },
    );
  }
}

/** PATCH /api/v2/memory/rules — {id, text?, name?, source?, isActive?}.
 *  Rules are never deleted — deactivate with isActive:false. */
export async function PATCH(req: NextRequest) {
  ensureV2();
  try {
    const body = (await req.json()) as {
      id?: string;
      text?: string;
      name?: string | null;
      source?: string | null;
      isActive?: boolean;
    };
    if (!body?.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400, ...noStore });
    }
    const rule = updateRule(body.id, {
      text: body.text,
      name: body.name,
      source: body.source,
      isActive: body.isActive,
    });
    return NextResponse.json({ rule }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400, ...noStore },
    );
  }
}
