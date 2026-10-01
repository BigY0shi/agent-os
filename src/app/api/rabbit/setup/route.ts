import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { ensureRabbitSecret, rotateRabbitSecret, setRabbitSecret, secretProblem, rabbitSecretPath } from "@/lib/v2/rabbit/secret";
import { MODELS, DEFAULT_MODEL_ID } from "@/lib/v2/rabbit/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rabbit R1 bridge — /api/rabbit/setup (cookie-gated by the normal proxy).
//   GET  → what to type into the R1's "local" screen. Mints a short key on the
//          first call (idempotent after) so one exists the moment "Require API
//          key" is switched on. This is the ONE door the key leaves through.
//   POST { action: "set", secret }  → the owner's own key (validated)
//   POST { action: "rotate" }       → a fresh generated key
//   Both answer with the same payload as GET.

function payload(req: Request, secret: string) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "127.0.0.1:3737";
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const baseUrl = `${proto}://${host}/api/rabbit/v1`;
  const requireKey = readSettings().rabbit?.requireKey === true;
  return {
    configured: true,
    requireKey,
    secret,
    secretPath: rabbitSecretPath(),
    baseUrl,
    chatUrl: `${baseUrl}/chat/completions`,
    modelsUrl: `${baseUrl}/models`,
    defaultModel: DEFAULT_MODEL_ID,
    models: MODELS.map((m) => m.id),
    instructions: [
      `Endpoint / base URL: ${baseUrl}`,
      requireKey ? `API key: ${secret}` : "API key: none (Require API key is off) — pick the R1's no-key option",
      `Model: ${DEFAULT_MODEL_ID} (or any of: ${MODELS.map((m) => m.id).join(", ")})`,
      "The URL is whatever host you opened Agent OS at — the LAN address on home Wi-Fi, the Tailscale address elsewhere.",
    ],
  };
}

const noStore = { headers: { "cache-control": "no-store" } };

export async function GET(req: Request) {
  return NextResponse.json(payload(req, ensureRabbitSecret()), noStore);
}

export async function POST(req: Request) {
  let body: { action?: unknown; secret?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* fallthrough */ }
  if (body.action === "rotate") return NextResponse.json(payload(req, rotateRabbitSecret()), noStore);
  if (body.action === "set") {
    const problem = secretProblem(body.secret);
    if (problem) return NextResponse.json({ error: problem }, { status: 400, ...noStore });
    return NextResponse.json(payload(req, setRabbitSecret(body.secret as string)), noStore);
  }
  return NextResponse.json({ error: 'Unknown action — expected { action: "set", secret } or { action: "rotate" }.' }, { status: 400, ...noStore });
}
