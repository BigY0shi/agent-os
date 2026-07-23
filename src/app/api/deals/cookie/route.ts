import { saveUpworkCookie, cookieStatus } from "@/lib/upworkAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, ...cookieStatus() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const { cookie } = await req.json().catch(() => ({})) as { cookie?: string };
  const r = saveUpworkCookie(String(cookie ?? ""));
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 400 });
  return Response.json({ ok: true, ...cookieStatus() });
}
