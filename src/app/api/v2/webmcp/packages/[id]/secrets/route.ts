import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getPackage, recordSecretRef, WebmcpError } from "@/lib/v2/webmcp/store";
import { setPackageSecret, listPackageSecretNames } from "@/lib/v2/webmcp/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * Secret VALUES live in ~/.agentic-os/webmcp/<slug>.secrets.json — never in
 * the DB, never echoed in any response. The API surface is names + "configured ✓".
 */

/** GET → { secrets: [{ name, configured: true }] } — names only. */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const pkg = getPackage((await ctx.params).id);
  if (!pkg) return NextResponse.json({ error: "package not found" }, { status: 404, ...noStore });
  return NextResponse.json(
    { secrets: listPackageSecretNames(pkg.slug).map((name) => ({ name, configured: true })) },
    noStore,
  );
}

/**
 * PUT { name, value } — writes the value to the package secrets file and
 * records the '{{secret:NAME}}' ref on the package row. Never echoes values.
 * → { ok, secrets: [{ name, configured }] }
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const pkg = getPackage((await ctx.params).id);
  if (!pkg) return NextResponse.json({ error: "package not found" }, { status: 404, ...noStore });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || typeof body.value !== "string" || !body.value) {
    return NextResponse.json({ error: "body needs { name, value }" }, { status: 400, ...noStore });
  }
  try {
    const names = setPackageSecret(pkg.slug, body.name, body.value);
    recordSecretRef(pkg.id, body.name);
    return NextResponse.json(
      { ok: true, secrets: names.map((name) => ({ name, configured: true })) },
      noStore,
    );
  } catch (err) {
    const status = err instanceof WebmcpError ? err.status : 400;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
