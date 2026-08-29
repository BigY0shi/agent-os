import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getPage,
  listPageComments,
  createPageComment,
  getPageComment,
  setCommentResolved,
} from "@/lib/v2/pages/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/v2/pages/[id]/comments → { comments } */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  if (!getPage(id)) return NextResponse.json({ error: "page not found" }, { status: 404, ...noStore });
  return NextResponse.json({ comments: listPageComments(id) }, noStore);
}

/**
 * POST /api/v2/pages/[id]/comments { bodyMd, anchorNodeId?, anchorTextNorm?,
 * author?='user' } → 201 { comment } — user-authored notes/replies (jarvis
 * rows come from the mention handler).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  if (!getPage(id)) return NextResponse.json({ error: "page not found" }, { status: 404, ...noStore });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const bodyMd = typeof body?.bodyMd === "string" ? body.bodyMd.trim() : "";
  if (!bodyMd) return NextResponse.json({ error: "bodyMd is required" }, { status: 400, ...noStore });
  const author = body?.author === "jarvis" ? "jarvis" : "user";

  const comment = createPageComment({
    pageId: id,
    bodyMd,
    author,
    anchorNodeId: typeof body?.anchorNodeId === "string" ? body.anchorNodeId : null,
    anchorTextNorm: typeof body?.anchorTextNorm === "string" ? body.anchorTextNorm : null,
  });
  return NextResponse.json({ comment }, { status: 201, ...noStore });
}

/** PATCH /api/v2/pages/[id]/comments { commentId, resolved } → { comment } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const commentId = typeof body?.commentId === "string" ? body.commentId : "";
  if (!commentId || typeof body?.resolved !== "boolean") {
    return NextResponse.json(
      { error: "body must be { commentId, resolved: boolean }" },
      { status: 400, ...noStore },
    );
  }
  const existing = getPageComment(commentId);
  if (!existing || existing.pageId !== id) {
    return NextResponse.json({ error: "comment not found" }, { status: 404, ...noStore });
  }
  const comment = setCommentResolved(commentId, body.resolved);
  return NextResponse.json({ comment }, noStore);
}
