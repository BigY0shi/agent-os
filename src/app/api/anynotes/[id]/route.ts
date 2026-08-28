// SPEC-F I2.1 — GET one (with thread) / PATCH (status, labels, title) /
// DELETE → EXILE (the row and its thread move to the *_exile tables; nothing is
// destroyed — house rule).
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { exileNote, getNote, listReplies, patchNote } from "@/lib/v2/anynotes/store";
import { isNoteStatus } from "@/lib/v2/anynotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** Note ids are 12-char lowercase alnum (store.shortId). Anything else is a
 *  malformed request, not a 404 — and it never reaches a query. */
const ID_RE = /^[a-z0-9]{4,32}$/;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad note id" }, { status: 400, ...noStore });
  try {
    const note = getNote(id);
    if (!note) return NextResponse.json({ error: "note not found" }, { status: 404, ...noStore });
    return NextResponse.json({ note, replies: listReplies(id) }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad note id" }, { status: 400, ...noStore });

  const body = (await req.json().catch(() => null)) as {
    status?: unknown;
    labels?: unknown;
    title?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "a JSON body is required" }, { status: 400, ...noStore });

  const patch: { status?: "inbox" | "kept" | "archived"; labels?: string[]; title?: string } = {};
  if (body.status !== undefined) {
    if (!isNoteStatus(body.status)) {
      return NextResponse.json(
        { error: "status must be inbox, kept or archived" },
        { status: 400, ...noStore },
      );
    }
    patch.status = body.status;
  }
  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels) || body.labels.some((l) => typeof l !== "string")) {
      return NextResponse.json({ error: "labels must be a string[]" }, { status: 400, ...noStore });
    }
    patch.labels = Array.from(
      new Set((body.labels as string[]).map((l) => l.trim()).filter(Boolean).slice(0, 24)),
    );
  }
  if (body.title !== undefined) {
    if (typeof body.title !== "string") {
      return NextResponse.json({ error: "title must be a string" }, { status: 400, ...noStore });
    }
    patch.title = body.title.trim().slice(0, 500);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "nothing to patch — send status, labels or title" },
      { status: 400, ...noStore },
    );
  }

  try {
    const note = patchNote(id, patch);
    if (!note) return NextResponse.json({ error: "note not found" }, { status: 404, ...noStore });
    return NextResponse.json({ note }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad note id" }, { status: 400, ...noStore });
  try {
    const ok = exileNote(id);
    if (!ok) return NextResponse.json({ error: "note not found" }, { status: 404, ...noStore });
    return NextResponse.json({ ok: true, exiled: true }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
