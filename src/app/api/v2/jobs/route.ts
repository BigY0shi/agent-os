import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listJobs, scheduleJob, setJobEnabled, removeJob } from "@/lib/v2/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

export async function GET() {
  ensureV2();
  return NextResponse.json({ jobs: listJobs() }, noStore);
}

export async function POST(req: NextRequest) {
  ensureV2();
  try {
    const body = await req.json();
    if (!body?.kind || !body?.name || (!body?.rrule && !body?.runAt)) {
      return NextResponse.json(
        { error: "kind, name and one of rrule|runAt are required" },
        { status: 400, ...noStore },
      );
    }
    const job = scheduleJob({
      id: body.id,
      kind: body.kind,
      name: body.name,
      rrule: body.rrule,
      runAt: body.runAt,
      payload: body.payload,
      enabled: body.enabled,
    });
    return NextResponse.json({ job }, { status: 201, ...noStore });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400, ...noStore });
  }
}

export async function PATCH(req: NextRequest) {
  ensureV2();
  const body = await req.json();
  if (!body?.id) {
    return NextResponse.json({ error: "id required" }, { status: 400, ...noStore });
  }
  if (body.remove === true) {
    removeJob(body.id);
    return NextResponse.json({ ok: true }, noStore);
  }
  if (typeof body.enabled === "boolean") {
    setJobEnabled(body.id, body.enabled);
    return NextResponse.json({ ok: true }, noStore);
  }
  return NextResponse.json(
    { error: "nothing to do (enabled or remove expected)" },
    { status: 400, ...noStore },
  );
}
