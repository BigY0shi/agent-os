import { resolveUi } from "@/lib/v2/jarvis/uiRequests";
import type { UiResult } from "@/lib/v2/jarvis/uiProtocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Proxy authentication applies, plus an unguessable one-use command token.
  const raw = await req.text();
  if (raw.length > 120000) return Response.json({ error: "result too large" }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  if (!body || typeof body.id !== "string" || typeof body.token !== "string"
    || !body.result || typeof body.result.ok !== "boolean") {
    return Response.json({ error: "invalid UI result" }, { status: 400 });
  }
  const ok = resolveUi(body.id, body.token, body.result as UiResult);
  return Response.json({ ok }, { status: ok ? 200 : 410, headers: { "Cache-Control": "no-store" } });
}
