import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getConfiguredProfiles,
  getMaxProfiles,
  createProfile,
  exileProfile,
  getBrowserExecutable,
  detectAvailableBrowsers,
} from "@/lib/v2/browser/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** SPEC-E §5.1 — GET /api/v2/browser/profiles. `detected` never includes
 *  Opera (E4.1 — Yoshi's daily browser stays isolated by construction). */
export async function GET() {
  ensureV2();
  return NextResponse.json(
    {
      profiles: getConfiguredProfiles(),
      max: getMaxProfiles(),
      browser: getBrowserExecutable(),
      detected: detectAvailableBrowsers(),
    },
    noStore,
  );
}

export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400, ...noStore });
  const r = createProfile(name);
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 400, ...noStore });
  return NextResponse.json({ ok: true }, noStore);
}

/** DELETE = EXILE (rule 1): the profile dir MOVES to
 *  browser-profiles/.exile/<stamp>_<name> — never fs.rm (diverges from
 *  upstream deleteProfile on purpose). */
export async function DELETE(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400, ...noStore });
  const r = exileProfile(name);
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 400, ...noStore });
  return NextResponse.json({ ok: true, exiledTo: r.exiledTo ?? null }, noStore);
}
