import { setStatus, setNotes, setNeedsInfo, setEditedPitch, type DealStatus } from "@/lib/upworkDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id, action: "status"|"notes"|"needsInfo"|"editPitch", value }
export async function POST(req: Request) {
  const { id, action, value } = await req.json().catch(() => ({})) as {
    id?: string; action?: string; value?: unknown;
  };
  if (!id || !action) return Response.json({ ok: false, error: "id and action required" }, { status: 400 });

  try {
    let state;
    switch (action) {
      case "status": state = await setStatus(id, value as DealStatus); break;
      case "notes": state = await setNotes(id, String(value ?? "")); break;
      case "needsInfo": state = await setNeedsInfo(id, !!value); break;
      case "editPitch": state = await setEditedPitch(id, String(value ?? "")); break;
      default: return Response.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
    return Response.json({ ok: true, id, state });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
