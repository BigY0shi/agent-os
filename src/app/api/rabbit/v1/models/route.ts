import { ensureV2 } from "@/lib/v2/boot";
import { readSettings } from "@/lib/settings";
import { rabbitAuthFailure } from "@/lib/v2/rabbit/secret";
import { modelsJson } from "@/lib/v2/rabbit/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rabbit R1 bridge — GET /api/rabbit/v1/models (OpenAI `list models` shape).
// Same auth as chat/completions: bearer or x-api-key, validated here.
export async function GET(req: Request) {
  ensureV2();
  const cfg = readSettings().rabbit ?? {};
  if (cfg.enabled === false) {
    return Response.json({ error: { message: "Rabbit bridge is switched off in Agent OS.", type: "server_error" } }, { status: 503 });
  }
  const denied = rabbitAuthFailure(req, cfg.requireKey === true);
  if (denied) return denied;
  return Response.json(modelsJson(), { headers: { "cache-control": "no-store" } });
}
