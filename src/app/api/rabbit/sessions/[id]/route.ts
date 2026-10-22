// Rabbit R1 bridge — GET one session with its transcript; PATCH archive /
// restore / rename. Cookie-gated (proxy). Nothing here destroys a row.
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getSession, listMessages, renameSession, setArchived } from "@/lib/v2/rabbit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad session id" }, { status: 400, ...noStore });
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404, ...noStore });
  return NextResponse.json({ session, messages: listMessages(id) }, noStore);
}

/** PATCH { archived?: boolean; title?: string } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad session id" }, { status: 400, ...noStore });
  if (!getSession(id)) return NextResponse.json({ error: "session not found" }, { status: 404, ...noStore });
  let body: { archived?: unknown; title?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400, ...noStore }); }
  let session = getSession(id);
  if (typeof body.archived === "boolean") session = setArchived(id, body.archived);
  if (typeof body.title === "string" && body.title.trim()) session = renameSession(id, body.title);
  return NextResponse.json({ session }, noStore);
}
