import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getPackage,
  listTools,
  listVersions,
  updatePackage,
  deleteDraftPackage,
  archivePackage,
  listCallLogs,
  WebmcpError,
} from "@/lib/v2/webmcp/store";
import { listPackageSecretNames } from "@/lib/v2/webmcp/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/** :id accepts a package uuid OR its slug. */

/**
 * GET /api/v2/webmcp/packages/[id] → { package, tools, versions, secretNames,
 * recentLogs }. Secret VALUES never appear anywhere — names only ("configured ✓").
 */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const pkg = getPackage((await ctx.params).id);
  if (!pkg) return NextResponse.json({ error: "package not found" }, { status: 404, ...noStore });
  return NextResponse.json(
    {
      package: pkg,
      tools: listTools(pkg.id),
      versions: listVersions(pkg.id),
      secretNames: listPackageSecretNames(pkg.slug),
      recentLogs: listCallLogs({ packageSlug: pkg.slug, limit: 20 }),
    },
    noStore,
  );
}

/** PATCH /api/v2/webmcp/packages/[id] { name?, description?, icon? } → { package }. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  try {
    const pkg = updatePackage((await ctx.params).id, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      icon: typeof body.icon === "string" ? body.icon : undefined,
    });
    return NextResponse.json({ package: pkg }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}

/**
 * DELETE /api/v2/webmcp/packages/[id] — draft-only hard delete (exile bundle
 * verified on disk first); a PUBLISHED package is ARCHIVED instead (tools
 * unregister from the hub, rows stay). Archived → 409.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  ensureV2();
  const pkg = getPackage((await ctx.params).id);
  if (!pkg) return NextResponse.json({ error: "package not found" }, { status: 404, ...noStore });
  try {
    if (pkg.status === "draft") {
      const { exiledTo } = deleteDraftPackage(pkg.id);
      return NextResponse.json({ ok: true, deleted: true, exiledTo }, noStore);
    }
    if (pkg.status === "published") {
      const archived = archivePackage(pkg.id);
      return NextResponse.json({ ok: true, archived: true, package: archived }, noStore);
    }
    return NextResponse.json({ error: "package is already archived" }, { status: 409, ...noStore });
  } catch (err) {
    return errResponse(err);
  }
}
