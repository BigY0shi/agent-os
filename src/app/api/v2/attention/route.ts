import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { readSettings } from "@/lib/settings";
import {
  AttentionError,
  dismissItem,
  listItems,
  markDone,
  type AttentionStatus,
} from "@/lib/v2/attention/store";
import { getCollectorHealth } from "@/lib/v2/attention/collectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * SPEC-D §5.8 — GET /api/v2/attention?status=open → { items, collectors }.
 * Items come back sorted urgent → warn → info (newest first within severity);
 * settings.attention.muteKinds are excluded. Collector health follows the
 * honest-metrics rule (a collector that can't read its source says so).
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const statusParam = req.nextUrl.searchParams.get("status") ?? "open";
  const status = (["open", "done", "dismissed"] as const).includes(statusParam as AttentionStatus)
    ? (statusParam as AttentionStatus)
    : statusParam === "all"
      ? undefined
      : "open";
  const muteKinds = readSettings().attention?.muteKinds ?? [];
  const items = listItems({ status, excludeKinds: muteKinds });
  return NextResponse.json({ items, collectors: getCollectorHealth() }, noStore);
}

/** PATCH { id, action: 'done'|'dismiss' } → { ok, item }. */
export async function PATCH(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "body must be { id, action: 'done'|'dismiss' }" }, { status: 400, ...noStore });
  }
  if (body.action !== "done" && body.action !== "dismiss") {
    return NextResponse.json({ error: "action must be 'done' or 'dismiss'" }, { status: 400, ...noStore });
  }
  try {
    const item = body.action === "done" ? markDone(body.id) : dismissItem(body.id);
    return NextResponse.json({ ok: true, item }, noStore);
  } catch (err) {
    if (err instanceof AttentionError) {
      return NextResponse.json({ error: err.message }, { status: err.status, ...noStore });
    }
    throw err;
  }
}
