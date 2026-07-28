import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ENGINE_DIR } from "@/lib/auditEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/audit/warroom?slug= → the generated client readout, straight from the engine's
// clients/<slug>/war-room.html. Served, never copied — the engine stays the only store.
export function GET(req: Request) {
  const slug = (new URL(req.url).searchParams.get("slug") ?? "").trim();
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return new Response("A valid client slug is required.", { status: 400 });
  }
  const file = path.join(ENGINE_DIR, "clients", slug, "war-room.html");
  if (!existsSync(file)) {
    return new Response(`No War Room readout for "${slug}" yet. Run distill, then warroom.`, { status: 404 });
  }
  return new Response(readFileSync(file, "utf8"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
