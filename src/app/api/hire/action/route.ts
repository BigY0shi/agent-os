import { setHireStatus, setHireNotes, setHirePitch, getHireLead, HIRE_STATUSES, type HireStatus } from "@/lib/hireDesk";
import { isJudgmentStatus, recordDeskDecision, recordDeskBrief, hireSubject } from "@/lib/deskMemory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { action: "status" | "notes" | "pitch", id, value }
export async function POST(req: Request) {
  const { action, id, value } = await req.json().catch(() => ({})) as
    { action?: string; id?: string; value?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  try {
    if (action === "status") {
      if (!HIRE_STATUSES.includes(value as HireStatus)) {
        return Response.json({ ok: false, error: `unknown status "${value}"` }, { status: 400 });
      }
      const state = await setHireStatus(id, value as HireStatus);
      // A judgment call earns a memory episode; routine triage motion does not.
      // Gating first also means only a real decision pays for the getHireLead read.
      if (isJudgmentStatus("hire-engine", String(value))) {
        const lead = await getHireLead(id);
        if (lead) {
          const subject = hireSubject(lead);
          void recordDeskDecision("hire-engine", subject, String(value), lead.notes);
          if (value === "approved") void recordDeskBrief("hire-engine", subject, lead);
        }
      }
      return Response.json({ ok: true, state });
    }
    if (action === "notes") return Response.json({ ok: true, state: await setHireNotes(id, value ?? "") });
    // Manual edits to the outreach box — without this the drawer textarea silently
    // dropped every hand edit the moment it closed.
    if (action === "pitch") return Response.json({ ok: true, state: await setHirePitch(id, String(value ?? "").slice(0, 8000)) });
    return Response.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
