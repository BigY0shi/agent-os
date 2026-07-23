import { NextResponse } from "next/server";
import { gatherDigest, type DigestItem } from "@/lib/newsDigest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A rolling log of past briefings so the history rail can recall them.
const NEWS_DIR = path.join(os.homedir(), ".agentic-os", "news");
const LOG = path.join(NEWS_DIR, "log.json");

interface Briefing { at: string; topic: string; overview: string; items: DigestItem[]; scouts: string[]; merger: string; }

async function readLog(): Promise<Briefing[]> {
  try { const j = JSON.parse(await readFile(LOG, "utf8")); return Array.isArray(j?.items) ? j.items : []; } catch { return []; }
}
async function saveLog(b: Briefing): Promise<void> {
  try {
    const items = [b, ...(await readLog())].slice(0, 40);
    await mkdir(NEWS_DIR, { recursive: true });
    await writeFile(LOG, JSON.stringify({ items }, null, 2), "utf8");
  } catch { /* best effort — a failed log write must not break the briefing */ }
}

// GET — past briefings (newest first).
export async function GET() {
  return NextResponse.json({ ok: true, items: await readLog() });
}

// POST { topic, merger? } — search + summarize what's new on any topic.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || "").slice(0, 300).trim();
  const merger = body?.merger === "ollama" ? "ollama" : "claude";
  if (!topic) return NextResponse.json({ ok: false, error: "Ask what's new about something first." }, { status: 400 });

  try {
    const { overview, items, scouts, merger: used, found } = await gatherDigest(topic, merger);
    if (!overview && !items.length) {
      return NextResponse.json({ ok: false, error: found === 0 ? "The scouts couldn't reach the web — check that Claude / Codex / Cursor are signed in." : "Couldn't pull together a briefing — try rephrasing." }, { status: 502 });
    }
    const at = new Date().toISOString();
    await saveLog({ at, topic, overview, items, scouts, merger: used });
    return NextResponse.json({ ok: true, topic, overview, items, scouts, merger: used, at });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 240) }, { status: 502 });
  }
}
