import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";
import { scheduleTask } from "@/lib/v2/tasks/recurrence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/tasks/recalc — recompute every active schedule (SPEC-B B4.7):
 * called by the Tasks gear after settings.tasks.timezone changes so wall-clock
 * RRULEs re-resolve in the new zone. → { recalculated }.
 */
export async function POST() {
  ensureV2();
  const rows = getDb()
    .prepare("SELECT id FROM v2_tasks WHERE schedule IS NOT NULL AND is_active = 1")
    .all() as { id: string }[];
  let recalculated = 0;
  for (const r of rows) {
    try {
      if (scheduleTask(r.id)) recalculated++;
    } catch (err) {
      console.warn(`[v2/tasks] recalc failed for ${r.id}:`, err);
    }
  }
  return NextResponse.json({ recalculated, scheduled: rows.length }, noStore);
}
