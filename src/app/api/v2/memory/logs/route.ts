import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";
import { retryQueueItem } from "@/lib/v2/memory/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

const STATUSES = new Set(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface QueueRow {
  id: string;
  status: string;
  stage: string | null;
  priority: number;
  source: string;
  title: string | null;
  session_id: string | null;
  graph_ids: string;
  label_ids: string;
  error: string | null;
  retry_count: number;
  created_at: string;
  processed_at: string | null;
  output: string | null;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** GET /api/v2/memory/logs — ingestion_queue rows (?status=&limit=), newest first. */
export async function GET(req: NextRequest) {
  ensureV2();
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status")?.toUpperCase();
  const limitRaw = parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const where = status && STATUSES.has(status) ? "WHERE status = ?" : "";
  const args = where ? [status, limit] : [limit];
  const rows = getDb()
    .prepare(
      `SELECT id, status, stage, priority, source, title, session_id, graph_ids,
              label_ids, error, retry_count, created_at, processed_at, output
       FROM ingestion_queue ${where}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...args) as QueueRow[];

  const logs = rows.map((r) => ({
    id: r.id,
    status: r.status,
    stage: r.stage,
    priority: r.priority,
    source: r.source,
    title: r.title,
    sessionId: r.session_id,
    graphIds: parseJsonArray(r.graph_ids),
    labelIds: parseJsonArray(r.label_ids),
    error: r.error,
    retryCount: r.retry_count,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    output: r.output,
  }));

  return NextResponse.json({ logs }, noStore);
}

/** POST /api/v2/memory/logs — {id, action: "retry"} re-enqueues a FAILED row. */
export async function POST(req: NextRequest) {
  ensureV2();
  try {
    const body = (await req.json()) as { id?: string; action?: string };
    if (!body?.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400, ...noStore });
    }
    if (body.action !== "retry") {
      return NextResponse.json(
        { error: "unsupported action (expected 'retry')" },
        { status: 400, ...noStore },
      );
    }
    const result = retryQueueItem(body.id);
    return NextResponse.json(result, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400, ...noStore },
    );
  }
}
