import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { ensureV2 } from "@/lib/v2/boot";
import { addToQueue, type IngestBody } from "@/lib/v2/memory/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** POST /api/v2/memory/ingest — enqueue an episode (SPEC-A §5.2). 202 {queueId}. */
export async function POST(req: NextRequest) {
  ensureV2();
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }
  try {
    const { queueId } = addToQueue(body);
    return NextResponse.json({ queueId }, { status: 202, ...noStore });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          error: err.issues
            .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
            .join("; "),
        },
        { status: 400, ...noStore },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400, ...noStore },
    );
  }
}
