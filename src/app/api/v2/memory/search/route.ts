import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { searchV2 } from "@/lib/v2/memory/search/index";
import type { SearchV2Options } from "@/lib/v2/memory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.map(String).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

/**
 * POST /api/v2/memory/search (SPEC-A §5.2)
 * {query, limit?, maxEpisodes?, tokenBudget?, labelIds?, endUserIds?,
 *  startTime?, endTime?, structured?} → {markdown} or RecallResult.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400, ...noStore });
  }

  const options: SearchV2Options = {
    limit: typeof body.limit === "number" ? body.limit : undefined,
    maxEpisodes: typeof body.maxEpisodes === "number" ? body.maxEpisodes : undefined,
    tokenBudget: typeof body.tokenBudget === "number" ? body.tokenBudget : undefined,
    labelIds: strArray(body.labelIds),
    endUserIds: strArray(body.endUserIds),
    agentId: typeof body.agentId === "string" ? body.agentId : undefined,
    startTime: typeof body.startTime === "string" ? body.startTime : undefined,
    endTime: typeof body.endTime === "string" ? body.endTime : undefined,
    structured: body.structured === true,
    source: typeof body.source === "string" ? body.source : "api",
  };

  try {
    const result = await searchV2(query, options);
    if (options.structured) return NextResponse.json(result, noStore);
    return NextResponse.json({ markdown: result }, noStore);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, ...noStore },
    );
  }
}
