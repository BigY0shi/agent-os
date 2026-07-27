import { setHireStatus, setHireNotes, HIRE_STATUSES, type HireStatus } from "@/lib/hireDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { action: "status" | "notes", id, value }
export async function POST(req: Request) {
  const { action, id, value } = await req.json().catch(() => ({})) as
    { action?: string; id?: string; value?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  try {
    if (action === "status") {
      if (!HIRE_STATUSES.includes(value as HireStatus)) {
        return Response.json({ ok: false, error: `unknown status "${value}"` }, { status: 400 });
      }
      return Response.json({ ok: true, state: await setHireStatus(id, value as HireStatus) });
    }
    if (action === "notes") return Response.json({ ok: true, state: await setHireNotes(id, value ?? "") });
    return Response.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
