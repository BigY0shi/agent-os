import { NextResponse } from "next/server";
import { uniqueSlug, writeItem, PIPELINE_AVAILABLE, type PipelineItem } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loosely-structured capture: a core idea + optional goal / details / type hint. The
// extras fold into the idea text so the classifier + planner get richer context; a bare
// idea still works exactly like before.
export async function POST(req: Request) {
  if (!PIPELINE_AVAILABLE) return NextResponse.json({ ok: false, error: "Vault not configured." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const core = String(body.idea || "").trim();
  if (!core) return NextResponse.json({ ok: false, error: "Empty idea." }, { status: 400 });
  const goal = String(body.goal || "").trim();
  const details = String(body.details || "").trim();
  const typeHint = String(body.typeHint || "").trim();

  const parts = [core];
  if (goal) parts.push(`\n**Goal / what does done look like:** ${goal}`);
  if (details) parts.push(`\n**Details / constraints / links:** ${details}`);
  if (typeHint && typeHint !== "auto") parts.push(`\n_(The user thinks this is most likely a **${typeHint}**.)_`);
  const idea = parts.join("\n");

  const title = core.split("\n")[0].slice(0, 80);
  const slug = await uniqueSlug(title);
  const item: PipelineItem = { slug, title, stage: "inbox", created: new Date().toISOString(), idea };
  await writeItem(item);
  return NextResponse.json({ ok: true, slug });
}
