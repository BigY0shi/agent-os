import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  createHarness,
  exileHarness,
  listHarnesses,
  patchHarness,
  type HarnessDef,
  type HarnessKind,
} from "@/lib/v2/agents/harnesses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/v2/harnesses — seeds the 4 builtins lazily, lists non-exiled rows.
 *  ?includeExiled=1 shows exiled user rows too (library "show exiled" toggle). */
export async function GET(req: NextRequest) {
  ensureV2();
  try {
    const includeExiled = req.nextUrl.searchParams.get("includeExiled") === "1";
    return NextResponse.json({ harnesses: listHarnesses({ includeExiled }) }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

/** POST — create a user harness: { name, description?, kind?, definition }. */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    kind?: HarnessKind;
    definition?: HarnessDef;
  } | null;
  if (!body || typeof body.name !== "string" || !body.definition) {
    return NextResponse.json({ error: "name and definition are required" }, { status: 400, ...noStore });
  }
  try {
    const res = createHarness({
      name: body.name,
      description: body.description,
      kind: body.kind,
      definition: body.definition,
    });
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400, ...noStore });
    return NextResponse.json({ harness: res }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

/** PATCH — { id, name?, description?, kind?, definition? }. Builtins are
 *  editable (never deletable). */
export async function PATCH(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    name?: string;
    description?: string;
    kind?: HarnessKind;
    definition?: HarnessDef;
  } | null;
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400, ...noStore });
  try {
    const res = patchHarness(body.id, body);
    if ("error" in res) {
      const status = res.error === "harness not found" ? 404 : 400;
      return NextResponse.json({ error: res.error }, { status, ...noStore });
    }
    return NextResponse.json({ harness: res }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

/** DELETE — { id }. Exile-not-drop: user rows get {exiled:true} in the
 *  definition JSON (the row stays); builtin rows refuse. */
export async function DELETE(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400, ...noStore });
  try {
    const res = exileHarness(body.id);
    if ("error" in res) {
      const status = res.error === "harness not found" ? 404 : 409;
      return NextResponse.json({ error: res.error }, { status, ...noStore });
    }
    return NextResponse.json({ ok: true }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
