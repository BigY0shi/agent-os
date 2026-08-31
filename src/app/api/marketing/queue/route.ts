import { NextResponse } from "next/server";
import { approvalQueue } from "@/lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — every drafted item waiting at the human gate, across all campaigns.
export async function GET() {
  return NextResponse.json({ ok: true, queue: await approvalQueue() });
}
