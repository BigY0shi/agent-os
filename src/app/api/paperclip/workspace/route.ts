export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detects the user's OWN Paperclip workspace at runtime so the dashboard never
// hardcodes someone else's company/prefix. Paperclip routes by issue prefix
// (e.g. localhost:3100/LAU/issues), so we read it live from Paperclip's API.
const PAPERCLIP = process.env.PAPERCLIP_API || "http://localhost:3100/api";

interface Company { id: string; name?: string; issuePrefix?: string }

export async function GET() {
  // Explicit env overrides win (multi-company setups can pin one).
  const envCompany = process.env.PAPERCLIP_COMPANY;
  const envPrefix = process.env.PAPERCLIP_PREFIX;
  if (envCompany && envPrefix) {
    return Response.json({ ok: true, companyId: envCompany, prefix: envPrefix, source: "env" });
  }
  try {
    const r = await fetch(`${PAPERCLIP}/companies`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!r.ok) return Response.json({ ok: false, error: `Paperclip HTTP ${r.status}` });
    const companies = (await r.json()) as Company[];
    const c = Array.isArray(companies) ? companies.find((x) => x.id === envCompany) ?? companies[0] : null;
    if (!c) return Response.json({ ok: false, error: "No Paperclip company found — finish onboarding first." });
    return Response.json({ ok: true, companyId: c.id, prefix: c.issuePrefix || "", name: c.name || "", source: "detected" });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
