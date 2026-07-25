import { roomAgents } from "@/lib/agentRoom";
import { assignPersonas, personaCount, personaLabel, occupationLabel } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/room/personas?agents=claude,codex[&seed=<chatId>]
// → { ok, count, personas: { <agentId>: { name, label, occupation, age, location, summary } } }
//
// Draws a distinct random Nemotron persona for each agent, for a "New chat with
// Personas" round. The client keeps the map for the life of that chat and posts it
// back with each message, so the cast stays put. Pass a seed to make it reproducible.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = (url.searchParams.get("agents") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const seed = url.searchParams.get("seed") || undefined;

  const known = new Set(roomAgents().map((a) => a.id));
  const ids = (requested.length ? requested : [...known]).filter((id) => known.has(id));
  if (!ids.length) return Response.json({ ok: false, error: "no valid agent ids", personas: {} }, { status: 400 });

  const assigned = assignPersonas(ids, seed);
  // Only send what the UI needs — the full prompt text stays server-side.
  const personas: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(assigned)) {
    personas[id] = {
      name: p.n,
      label: personaLabel(p),
      occupation: occupationLabel(p),
      age: p.a ?? null,
      location: p.l ?? null,
      summary: p.p,
    };
  }
  return Response.json({ ok: true, count: personaCount(), personas });
}
