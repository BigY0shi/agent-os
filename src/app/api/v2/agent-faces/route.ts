// S35 Agent faces.
//   GET  /api/v2/agent-faces              -> { ok, detail, seeds }  (every stored "New shape" seed)
//   POST /api/v2/agent-faces { id, action: "reroll" | "reset" }
//                                         -> { ok, id, seed, mark }
// The mark itself is computed on the client from the seed (lib/agentFaces.ts); the
// response carries it too so a caller can show the result without re-deriving.

import { NextResponse } from "next/server";
import { isFaceId, readFaceDetail, readFaceSeeds, rerollFaceSeed, resetFaceSeed } from "@/lib/v2/agentFaces/seeds";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, detail: readFaceDetail(), seeds: readFaceSeeds() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { id?: unknown; action?: unknown } | null;
  if (!body || !isFaceId(body.id)) return NextResponse.json({ ok: false, error: "id must be 1-80 chars of letters, digits, '-', '_', '.', ':'" }, { status: 400 });
  if (body.action === "reroll") return NextResponse.json({ ok: true, id: body.id, ...rerollFaceSeed(body.id) });
  if (body.action === "reset") return NextResponse.json({ ok: true, id: body.id, ...resetFaceSeed(body.id) });
  return NextResponse.json({ ok: false, error: 'action must be "reroll" or "reset"' }, { status: 400 });
}
