import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "agentos_session";

// POST → clears the session cookie (sign out).
export async function POST() {
  const c = await cookies();
  c.delete(COOKIE);
  return Response.json({ ok: true });
}
