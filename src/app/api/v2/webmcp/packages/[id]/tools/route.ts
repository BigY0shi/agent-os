import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getPackage,
  listTools,
  addTool,
  updateTool,
  removeTool,
  HANDLER_KINDS,
  WebmcpError,
  type HandlerKind,
  type ToolInput,
} from "@/lib/v2/webmcp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/**
 * Tool CRUD edits the DRAFT working set — a published package's live snapshot
 * is untouched until the next publish (SPEC-C §8.10). Archived packages → 409.
 */

function pickPatch(body: Record<string, unknown>): Partial<ToolInput> {
  return {
    name: typeof body.newName === "string" ? body.newName : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    inputSchema:
      body.inputSchema && (typeof body.inputSchema === "object" || typeof body.inputSchema === "string")
        ? (body.inputSchema as Record<string, unknown> | string)
        : undefined,
    handlerKind:
      typeof body.handlerKind === "string" && (HANDLER_KINDS as readonly string[]).includes(body.handlerKind)
        ? (body.handlerKind as HandlerKind)
        : undefined,
    handlerConfig:
      body.handlerConfig && typeof body.handlerConfig === "object"
        ? (body.handlerConfig as Record<string, unknown>)
        : undefined,
    requiresApproval: typeof body.requiresApproval === "boolean" ? body.requiresApproval : undefined,
    position: typeof body.position === "number" ? body.position : undefined,
  };
}

/** GET /api/v2/webmcp/packages/[id]/tools → { tools }. */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const pkg = getPackage((await ctx.params).id);
  if (!pkg) return NextResponse.json({ error: "package not found" }, { status: 404, ...noStore });
  return NextResponse.json({ tools: listTools(pkg.id) }, noStore);
}

/**
 * POST — add a tool: { name, description?, inputSchema?, handlerKind,
 * handlerConfig?, requiresApproval?, position? } → 201 { tool } | 409 name taken.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || typeof body.handlerKind !== "string") {
    return NextResponse.json({ error: "body needs { name, handlerKind }" }, { status: 400, ...noStore });
  }
  try {
    const tool = addTool((await ctx.params).id, {
      ...pickPatch(body),
      name: body.name,
      handlerKind: body.handlerKind as HandlerKind,
    } as ToolInput);
    return NextResponse.json({ tool }, { status: 201, ...noStore });
  } catch (err) {
    return errResponse(err);
  }
}

/** PATCH — update a tool: { name, ...patch (newName renames) } → { tool }. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string") {
    return NextResponse.json({ error: "body needs { name } (the tool to update)" }, { status: 400, ...noStore });
  }
  try {
    const tool = updateTool((await ctx.params).id, body.name, pickPatch(body));
    return NextResponse.json({ tool }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}

/** DELETE ?name=<toolName> — remove from the draft working set. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "?name= is required" }, { status: 400, ...noStore });
  try {
    removeTool((await ctx.params).id, name);
    return NextResponse.json({ ok: true }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}
