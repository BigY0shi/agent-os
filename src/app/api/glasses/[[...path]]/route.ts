import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  GLASSES_MODEL_ID,
  GlassesError,
  askFromGlasses,
  completionResponse,
  errorResponse,
  glassesSettings,
  glassesTokenConfigured,
  noteGlassesRequest,
  parseCompletionRequest,
  verifyGlassesAuth,
} from "@/lib/v2/jarvis/glasses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Even Realities G2 custom agent (Even app → Settings → Even AI → Agent
// Configure → URL `https://<host>/api/glasses/v1`, Token from the Jarvis gear).
// OpenAI chat-completions shape, non-streaming. Proxy-exempt only when an
// Authorization header is present (src/proxy.ts); the token is validated here.
//
//   POST /api/glasses{,/v1,/v1/chat/completions,/chat/completions}
//        → 200 chat.completion | 400 bad body | 401 bad token | 403 lane off
//          | 502 Jarvis failed | 503 no token minted | 504 timeout
//   GET  /api/glasses{/v1}/models → the single model this lane serves
//
// Errors use the OpenAI error shape so the Even app has something to show.

const NO_STORE = { "Cache-Control": "no-store" };
const COMPLETION_PATHS = new Set(["", "/v1", "/v1/chat/completions", "/chat/completions"]);
const MODEL_PATHS = new Set(["/models", "/v1/models"]);

function subpath(req: Request): string {
  return new URL(req.url).pathname.replace(/^\/api\/glasses/, "").replace(/\/+$/, "");
}

function fail(err: GlassesError) {
  return NextResponse.json(errorResponse(err), { status: err.status, headers: NO_STORE });
}

/** Shared gate: token minted → token valid → lane enabled. */
function gate(req: Request): GlassesError | null {
  if (!glassesTokenConfigured()) {
    return new GlassesError(503, "No glasses token yet: generate one in Agent OS → Jarvis gear → Glasses.", "not_configured");
  }
  if (!verifyGlassesAuth(req.headers.get("authorization"))) {
    return new GlassesError(401, "Bad or missing token.", "authentication_error");
  }
  if (!glassesSettings().enabled) {
    return new GlassesError(403, "The glasses lane is switched off in Agent OS → Jarvis gear → Glasses.", "permission_error");
  }
  return null;
}

export async function GET(req: Request) {
  if (!MODEL_PATHS.has(subpath(req))) return fail(new GlassesError(404, "Not found.", "not_found"));
  const denied = gate(req);
  if (denied) return fail(denied);
  return NextResponse.json(
    { object: "list", data: [{ id: GLASSES_MODEL_ID, object: "model", owned_by: "agent-os" }] },
    { headers: NO_STORE },
  );
}

export async function POST(req: Request) {
  if (!COMPLETION_PATHS.has(subpath(req))) return fail(new GlassesError(404, "Not found.", "not_found"));
  const denied = gate(req);
  if (denied) {
    // Unauthenticated noise is not recorded — only the owner's own requests
    // move the settings-panel status.
    if (denied.status !== 401 && denied.status !== 503) noteGlassesRequest(denied.message);
    return fail(denied);
  }
  ensureV2();
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new GlassesError(400, "Body is not valid JSON.");
    }
    const { text, model } = parseCompletionRequest(body);
    const { answer } = await askFromGlasses(text, { signal: req.signal });
    noteGlassesRequest(null);
    return NextResponse.json(completionResponse(answer, model), { headers: NO_STORE });
  } catch (e) {
    const err =
      e instanceof GlassesError
        ? e
        : new GlassesError(500, e instanceof Error ? e.message.slice(0, 300) : "glasses lane failure", "server_error");
    noteGlassesRequest(err.message);
    return fail(err);
  }
}
