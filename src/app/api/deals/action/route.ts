import { setStatus, setNotes, setNeedsInfo, setEditedPitch, getDeal, type DealStatus } from "@/lib/upworkDesk";
import { isJudgmentStatus, recordDeskDecision, recordDeskBrief, dealSubject } from "@/lib/deskMemory";

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
      case "status": {
        state = await setStatus(id, value as DealStatus);
        // A judgment call earns a memory episode; routine triage motion does not.
        // Gating on that first also means only a real decision pays for the board
        // read that getDeal costs.
        if (isJudgmentStatus("deal-desk", String(value))) {
          const deal = await getDeal(id);
          if (deal) {
            const subject = dealSubject(deal);
            void recordDeskDecision("deal-desk", subject, String(value), deal.notes);
            // The assessment is kept for a lead we committed to, and only then.
            if (value === "approved") void recordDeskBrief("deal-desk", subject, deal);
          }
        }
        break;
      }
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
