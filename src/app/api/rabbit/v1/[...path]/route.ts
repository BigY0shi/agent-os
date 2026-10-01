// Rabbit R1 bridge — catch-all for /api/rabbit/v1/<anything we don't serve>.
// A device that calls an OpenAI path this bridge lacks (responses, embeddings,
// audio, …) used to get Next's HTML 404 and show "something went wrong" with
// no trace. Now the path is logged to ~/.agentic-os/rabbit.log and the client
// gets an OpenAI-shaped 404 naming what IS served.
import { NextRequest, NextResponse } from "next/server";
import { rabbitLog } from "@/lib/v2/rabbit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function unsupported(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const p = "/" + (path ?? []).join("/");
  rabbitLog(`404 unsupported ${req.method} /v1${p}`);
  return NextResponse.json(
    {
      error: {
        message: `Unsupported endpoint ${req.method} /v1${p}. This bridge serves POST /v1/chat/completions and GET /v1/models only.`,
        type: "invalid_request_error",
        code: "unsupported_endpoint",
      },
    },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export const GET = unsupported;
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
