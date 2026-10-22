import { countVersions, listSources } from "@/lib/v2/files/agentFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/files -> { sources, counts }   (S28 Files: every agent and its allow-listed files)
export async function GET() {
  try {
    const sources = listSources();
    const files = sources.flatMap((s) => s.files);
    return Response.json({
      sources,
      counts: {
        agents: sources.length,
        files: files.length,
        lastChanged: files.length ? Math.max(...files.map((f) => f.mtimeMs)) : null,
        versionsKept: countVersions(),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
