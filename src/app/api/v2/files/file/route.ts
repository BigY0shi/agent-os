import { FilesError, listVersions, readFile, saveFile } from "@/lib/v2/files/agentFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v2/files/file?id=<source::rel>             -> { entry, content, hash, masked, versions }
// POST /api/v2/files/file { id, content, baseHash, confirm } -> { entry, hash, mtimeMs, versionKept }
//   409 { current, hash } when the file changed since it was read; 403 until a file that
//   shapes an agent is confirmed. Secret values in config files stay masked both ways.
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown) =>
  e instanceof FilesError
    ? Response.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status, ...noStore })
    : Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    const r = readFile(id);
    return Response.json({ ...r, versions: listVersions(id) }, noStore);
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "expected { id, content, baseHash, confirm }" }, { status: 400, ...noStore });
  try {
    const r = saveFile(body as Record<string, unknown>);
    return Response.json({ ...r, versions: listVersions(r.entry.id) }, noStore);
  } catch (e) { return fail(e); }
}
