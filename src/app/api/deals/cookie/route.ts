import { saveUpworkCookie, cookieStatus } from "@/lib/upworkAuth";
import { setNeedsLogin } from "@/lib/upworkDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, ...cookieStatus() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const { cookie } = await req.json().catch(() => ({})) as { cookie?: string };
  const r = saveUpworkCookie(String(cookie ?? ""));
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 400 });
  // S4 (d): a fresh cookie is the owner saying "I logged back in". Clear every
  // needs-login flag so the banner goes and the next enrichment can try again;
  // if the session is still dead the run flags them once more.
  const cleared = await setNeedsLogin([], false);
  return Response.json({ ok: true, ...cookieStatus(), clearedNeedsLogin: cleared.length });
}
