// Rabbit R1 Creation — GET /api/rabbit/v1/agentos/sessions/<id>: one transcript.
// Key REQUIRED regardless of settings.rabbit.requireKey (see ../route.ts).
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { rabbitAuthFailure } from "@/lib/v2/rabbit/secret";
import { getSession, listMessages } from "@/lib/v2/rabbit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const denied = rabbitAuthFailure(req, true);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad session id" }, { status: 400, ...noStore });
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404, ...noStore });
  const messages = listMessages(id, 200).map((m) => ({ role: m.role, content: m.content, model: m.model, error: m.error, at: m.createdAt }));
  return NextResponse.json({ session: { id: session.id, title: session.title, model: session.model, updatedAt: session.updatedAt }, messages }, noStore);
}
