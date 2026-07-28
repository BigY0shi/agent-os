import { readEngine } from "@/lib/contentEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → the whole engine state (plan, items, insights).
export async function GET() {
  return Response.json({ ok: true, state: await readEngine() });
}
