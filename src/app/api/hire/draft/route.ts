import { getHireLead, listHireLeads, setHireOutreach } from "@/lib/hireDesk";
import { createGmailDrafts, defaultSubject, type DraftItem } from "@/lib/hireDraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST — create Gmail DRAFTS (never sends; the operator reviews + sends in Gmail).
//   { id, to?, subject? }  → draft one lead (to defaults to the Hunter contact email)
//   { all: true }          → draft every approved + pitched + emailed lead not yet drafted
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { id?: string; to?: string; subject?: string; all?: boolean };

  let items: DraftItem[] = [];

  if (body.all) {
    const leads = await listHireLeads();
    items = leads
      .filter((l) => l.status === "approved" && l.pitch && !l.outreach?.ok && (l.firmo?.email))
      .slice(0, 10)
      .map((l) => ({ ref: l.id, to: l.firmo!.email!, subject: defaultSubject(l.title), body: l.pitch! }));
    if (!items.length) {
      return Response.json({ ok: false, error: "Nothing to draft — needs approved leads with a pitch, a contact email, and no draft yet." }, { status: 400 });
    }
  } else {
    if (!body.id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
    const lead = await getHireLead(body.id);
    if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
    if (!lead.pitch?.trim()) return Response.json({ ok: false, error: "write the pitch first" }, { status: 400 });
    const to = (body.to || lead.firmo?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return Response.json({ ok: false, error: "No valid contact email — enrichment didn't find one; paste one in the To field." }, { status: 400 });
    }
    items = [{ ref: lead.id, to, subject: (body.subject || defaultSubject(lead.title)).slice(0, 150), body: lead.pitch }];
  }

  const results = await createGmailDrafts(items);

  // Record per-lead outcome so cards show the drafted state.
  for (const r of results) {
    const it = items.find((i) => i.ref === r.ref)!;
    await setHireOutreach(r.ref, { at: Date.now(), to: it.to, subject: it.subject, ok: r.ok, detail: r.ok ? undefined : r.detail });
  }

  const succeeded = results.filter((r) => r.ok).length;
  return Response.json({ ok: succeeded > 0, drafted: succeeded, failed: results.length - succeeded, results });
}
