import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadSession, saveSession } from "@/lib/brainstorm";
import { AGENTIC_DIR, VAULT_AVAILABLE, appendMemory, todayISO } from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id } → accept the session's working brief: write it to the Obsidian
// vault as a project-brief note and mark the session accepted.
//
// This exists because the council's chair kept OFFERING to persist the brief —
// an ability it doesn't have (typing "yes" just ran a steer round). Persistence
// is a button, not a conversation.

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "brief";
}

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const session = await loadSession(id);
  if (!session) return Response.json({ ok: false, error: "session not found" }, { status: 404 });
  if (!session.brief?.trim()) return Response.json({ ok: false, error: "this session has no brief yet" }, { status: 400 });
  if (!VAULT_AVAILABLE) {
    return Response.json({ ok: false, error: "No Obsidian vault configured (vaultRoot in ~/.agentic-os/config.json)." }, { status: 503 });
  }

  const dir = path.join(AGENTIC_DIR, "Project Briefs");
  await mkdir(dir, { recursive: true });
  const day = todayISO();
  const file = path.join(dir, `${day} ${slug(session.topic)}.md`);

  const note =
    `---\ntags: [project-brief, brainstorm, agentic-os]\ndate: ${day}\ntopic: "${session.topic.replace(/"/g, "'").slice(0, 200)}"\nsession: ${session.id}\nkimiSeat: ${session.kimiModel ?? "n/a"}\n---\n\n` +
    `# 💡 ${session.topic.slice(0, 120)}\n\n` +
    `> Accepted from the Brainstorm council (Claude + Codex + Kimi) on ${day}. ` +
    `Full transcript lives in the dashboard session.\n\n` +
    session.brief.trim() + "\n";

  try {
    await writeFile(file, note, "utf8");
  } catch (e) {
    return Response.json({ ok: false, error: `vault write failed: ${(e as Error).message}` }, { status: 500 });
  }

  const notePath = path.join("Agentic OS", "Project Briefs", path.basename(file));
  session.accepted = { at: Date.now(), notePath };
  await saveSession(session);

  // Leave a trail in the daily memory stream too (that's what downstream memory
  // ingestion watches) — best-effort, the note is the source of truth.
  await appendMemory({
    agent: "system", kind: "note",
    text: `Accepted Brainstorm project brief: "${session.topic.slice(0, 120)}" → ${notePath}`,
  }).catch(() => {});

  return Response.json({ ok: true, notePath, accepted: session.accepted });
}
