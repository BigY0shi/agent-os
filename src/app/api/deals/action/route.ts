import { setStatus, setStatusBulk, setNotes, setNeedsInfo, setEditedPitch, getDeal, listDeals, VALID_STATUS, type DealStatus } from "@/lib/upworkDesk";
import { isJudgmentStatus, recordDeskDecision, recordDeskBrief, dealSubject } from "@/lib/deskMemory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id, action: "status"|"notes"|"needsInfo"|"editPitch", value }
// POST { action: "bulkStatus", ids: string[], value: DealStatus }   (S4 b: deny many at once)
export async function POST(req: Request) {
  const { id, ids, action, value } = await req.json().catch(() => ({})) as {
    id?: string; ids?: unknown; action?: string; value?: unknown;
  };
  if (!action) return Response.json({ ok: false, error: "action required" }, { status: 400 });

  try {
    if (action === "bulkStatus") {
      const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
      const status = String(value ?? "") as DealStatus;
      if (!list.length) return Response.json({ ok: false, error: "ids[] required" }, { status: 400 });
      if (!VALID_STATUS.includes(status)) return Response.json({ ok: false, error: `Invalid status: ${status}` }, { status: 400 });
      const written = await setStatusBulk(list, status);
      // A bulk deny is still a judgment the owner made card by card, so each one
      // earns its episode; refill's bulk DISMISS stays silent (that is triage).
      if (isJudgmentStatus("deal-desk", status)) {
        const deals = await listDeals();
        const byId = new Map(deals.map((d) => [d.id, d]));
        for (const did of written) {
          const deal = byId.get(did);
          if (deal) void recordDeskDecision("deal-desk", dealSubject(deal), status, deal.notes);
        }
      }
      return Response.json({ ok: true, ids: written, status });
    }

    if (!id) return Response.json({ ok: false, error: "id and action required" }, { status: 400 });
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
