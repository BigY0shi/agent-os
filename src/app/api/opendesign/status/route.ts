import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open Design's URL/ports are configurable (Open Design config menu → ~/.agentic-os/settings.json).
// We health-check the daemon (lighter + stays responsive while the web is busy generating).
// Defaults: web UI on :7456 (the iframe), daemon API on :7455.
export async function GET() {
  const od = readSettings().opendesign;
  const web = (od.webUrl || "http://127.0.0.1:7456").replace(/\/+$/, "");
  const daemon = (od.daemonUrl || "http://127.0.0.1:7455").replace(/\/+$/, "");

  let healthy = false;
  for (const probe of [`${daemon}/api/health`, `${daemon}/health`, web]) {
    try {
      const r = await fetch(probe, { signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (r.ok) { healthy = true; break; }
    } catch { /* try next probe */ }
  }
  return Response.json(
    { healthy, url: web, daemonUrl: daemon, canLaunch: !!od.launchCmd },
    { headers: { "cache-control": "no-store" } },
  );
}
