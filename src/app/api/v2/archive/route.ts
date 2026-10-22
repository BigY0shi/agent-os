import { listArchive, readArchiveDoc } from "@/lib/v2/archive/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/archive?q=&source=&fresh=1 -> { docs, total, bySource, errors }   (S24 Crew archive)
// GET /api/v2/archive?id=<doc id>        -> { doc }  the whole document with its metadata
// Read-only: every document is read in place from the store that holds it.
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const id = q.get("id");
    if (id) {
      const doc = await readArchiveDoc(id);
      return doc ? Response.json({ doc }, noStore) : Response.json({ error: "no such document" }, { status: 404, ...noStore });
    }
    return Response.json(await listArchive({ q: q.get("q") ?? undefined, source: q.get("source") ?? undefined, fresh: q.get("fresh") === "1" }), noStore);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });
  }
}
