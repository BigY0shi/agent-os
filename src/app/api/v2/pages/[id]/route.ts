import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getPage,
  savePage,
  RevConflictError,
  type PageDocNode,
} from "@/lib/v2/pages/store";
import { processPageSave } from "@/lib/v2/pages/butler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/v2/pages/[id] → { page } */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  const page = getPage(id);
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404, ...noStore });
  return NextResponse.json({ page }, noStore);
}

/**
 * PUT /api/v2/pages/[id] { docJson, rev } — optimistic-lock save (SPEC-B §1.1).
 *   stale rev → 409 { error, current: { docJson, rev } } — client refetches.
 *   200 → butler processing runs: `[ ]` task binding SYNCHRONOUS (taskUuid/
 *   displayId attrs written back — response carries the updated doc), @jarvis
 *   mention scan DEBOUNCED (settings.scratchpad.mentionDebounceSec).
 *   → { rev, docJson, docChanged, bound, mentionsQueued }
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { docJson?: unknown; rev?: unknown }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }
  const rev = typeof body.rev === "number" ? body.rev : NaN;
  const docJson = body.docJson;
  if (!Number.isInteger(rev) || rev < 0 || !docJson || typeof docJson !== "object") {
    return NextResponse.json(
      { error: "body must be { docJson: <TipTap JSON>, rev: <integer> }" },
      { status: 400, ...noStore },
    );
  }

  try {
    savePage({ id, docJson: docJson as PageDocNode, rev });
  } catch (err) {
    if (err instanceof RevConflictError) {
      return NextResponse.json(
        { error: err.message, current: err.current },
        { status: 409, ...noStore },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 500, ...noStore },
    );
  }

  try {
    const res = processPageSave(id);
    return NextResponse.json(
      {
        rev: res.page.rev,
        docJson: res.page.doc,
        docChanged: res.docChanged,
        bound: res.bound,
        mentionsQueued: res.mentionsQueued,
      },
      noStore,
    );
  } catch (err) {
    // Save landed; butler failure must not look like a lost write.
    console.warn(`[v2/pages] butler processing failed for ${id}:`, err);
    const page = getPage(id)!;
    return NextResponse.json(
      { rev: page.rev, docJson: page.doc, docChanged: false, bound: [], mentionsQueued: 0 },
      noStore,
    );
  }
}
