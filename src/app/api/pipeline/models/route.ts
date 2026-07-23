import { NextResponse } from "next/server";
import { ollamaModels } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pipeline/models?url=<optional> → installed Ollama models on THIS machine
// (or the given host). Runs server-side, so a LAN device hitting this still queries the
// server's own Ollama. Powers the model dropdown in Pipeline settings. Never 500s — a
// down/empty Ollama returns an empty list + a human hint instead of throwing.
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url")?.trim() || undefined;
  try {
    const models = await ollamaModels(url, req.signal);
    return NextResponse.json({ ok: true, models }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, models: [], error: `Can't reach Ollama${url ? ` at ${url}` : ""}. Open the Ollama app or run \`ollama serve\`. (${String(e).slice(0, 120)})` },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
