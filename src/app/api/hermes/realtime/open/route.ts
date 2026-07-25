import { NextResponse } from "next/server";
import { launchTarget } from "@/lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/realtime/open  { target }  → { ok }
// Opens a website (https URL) or an installed app by name. The target is validated
// here (no shell is used → no injection) and launched via the cross-platform helper.
// This used to spawn the macOS-only `open`, so it failed on every request on Windows.
// Used by the Realtime butler's function-calling so it can actually act, not just talk.
async function runOpen(target: string): Promise<boolean> {
  const t = (target || "").trim();
  const looksUrl = /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t);
  if (looksUrl) {
    const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    if (!/^https?:\/\/[\w.\-/?=&%#~+:@]+$/i.test(url)) return false;
    return launchTarget(url, { isUrl: true });
  }
  if (!/^[\w .'&\-]{1,40}$/.test(t)) return false; // app name only
  return launchTarget(t, { isUrl: false });
}

export async function POST(req: Request) {
  const { target } = await req.json().catch(() => ({ target: "" }));
  if (typeof target !== "string" || !target.trim()) return NextResponse.json({ ok: false, error: "missing target" }, { status: 400 });
  const ok = await runOpen(target);
  return NextResponse.json({ ok, target });
}
