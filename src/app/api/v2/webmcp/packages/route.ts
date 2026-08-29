import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listPackages, createPackage, WebmcpError } from "@/lib/v2/webmcp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/** GET /api/v2/webmcp/packages → { packages } (with toolCount). */
export async function GET() {
  ensureV2();
  return NextResponse.json({ packages: listPackages() }, noStore);
}

/**
 * POST /api/v2/webmcp/packages { slug, name, description?, icon? }
 * → 201 { package } | 409 slug taken | 400 invalid slug.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.slug !== "string" || typeof body.name !== "string") {
    return NextResponse.json({ error: "body needs { slug, name }" }, { status: 400, ...noStore });
  }
  try {
    const pkg = createPackage({
      slug: body.slug,
      name: body.name,
      description: typeof body.description === "string" ? body.description : undefined,
      icon: typeof body.icon === "string" ? body.icon : undefined,
    });
    return NextResponse.json({ package: pkg }, { status: 201, ...noStore });
  } catch (err) {
    return errResponse(err);
  }
}
