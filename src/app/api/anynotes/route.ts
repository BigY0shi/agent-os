// SPEC-F I2.1 — GET list / POST capture.
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { captureUrl, saveScreenshot } from "@/lib/v2/anynotes/capture";
import { ingestNote } from "@/lib/v2/anynotes/ingest";
import { countsByStatus, createNote, listNotes } from "@/lib/v2/anynotes/store";
import { isNoteStatus, isNoteType, type Note, type NoteStatus } from "@/lib/v2/anynotes/types";
import { emit } from "@/lib/v2/events";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function defaultStatus(): NoteStatus {
  const s = readSettings().anynotes?.defaultStatus;
  return isNoteStatus(s) ? s : "inbox";
}

function cleanLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((l): l is string => typeof l === "string")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 24),
    ),
  );
}

/** GET /api/anynotes?status=&type=&label=&q=&limit=&before= */
export async function GET(req: NextRequest) {
  ensureV2();
  try {
    const sp = req.nextUrl.searchParams;
    const statusParam = sp.get("status");
    const typeParam = sp.get("type");
    const limitParam = sp.get("limit");
    const notes = listNotes({
      status: statusParam === "all" ? "all" : isNoteStatus(statusParam) ? statusParam : "inbox",
      type: isNoteType(typeParam) ? typeParam : undefined,
      label: sp.get("label") || undefined,
      q: sp.get("q") || undefined,
      limit: limitParam ? Number(limitParam) : undefined,
      before: sp.get("before") || undefined,
    });
    return NextResponse.json({ notes, counts: countsByStatus() }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

interface CaptureBody {
  url?: string;
  text?: string;
  imageBase64?: string;
  imageName?: string;
  title?: string;
  labels?: string[];
}

/**
 * POST /api/anynotes — exactly one of url | text | imageBase64.
 * 200 { note } on a clean capture; 422 { error, note } when extraction failed
 * but the degraded link-only note WAS saved (SPEC-F §5 contract).
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as CaptureBody | null;
  if (!body) return NextResponse.json({ error: "a JSON body is required" }, { status: 400, ...noStore });

  const provided = (["url", "text", "imageBase64"] as const).filter(
    (k) => typeof body[k] === "string" && (body[k] as string).trim(),
  );
  if (provided.length !== 1) {
    return NextResponse.json(
      { error: "provide exactly one of url, text or imageBase64" },
      { status: 400, ...noStore },
    );
  }

  const labels = cleanLabels(body.labels);
  const status = defaultStatus();

  try {
    let note: Note;
    let captureError: string | undefined;

    if (provided[0] === "url") {
      const url = body.url!.trim();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return NextResponse.json({ error: `not a URL: ${url}` }, { status: 400, ...noStore });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json(
          { error: `unsupported protocol ${parsed.protocol} — http(s) only` },
          { status: 400, ...noStore },
        );
      }
      const cap = await captureUrl(url);
      captureError = cap.error;
      note = createNote({
        type: cap.type,
        url,
        title: body.title?.trim() || cap.title,
        author: cap.author,
        site: cap.site,
        contentMd: cap.contentMd,
        thumbUrl: cap.thumbUrl,
        status,
        labels,
        meta: cap.meta,
      });
    } else if (provided[0] === "imageBase64") {
      // saveScreenshot throws on malformed input — that is a 400, not a
      // degraded note (SPEC-F §4: config/caller errors are loud).
      let saved: { mediaPath: string; bytes: number };
      try {
        saved = saveScreenshot(body.imageBase64!);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 400, ...noStore });
      }
      note = createNote({
        type: "screenshot",
        title: body.title?.trim() || body.imageName?.trim() || "Screenshot",
        contentMd: "",
        mediaPath: saved.mediaPath,
        status,
        labels,
        meta: { captureMode: "user", bytes: saved.bytes, ...(body.imageName ? { originalName: body.imageName } : {}) },
      });
    } else {
      const text = body.text!.trim();
      note = createNote({
        type: "text",
        title: body.title?.trim() || text.split("\n")[0].slice(0, 120),
        contentMd: text,
        status,
        labels,
        meta: { captureMode: "user" },
      });
    }

    emit("anynote.captured", { id: note.id, type: note.type, title: note.title }, "anynotes");
    // Ingest is additive and slow-ish; never block the capture response on it.
    void ingestNote(note);

    if (captureError) {
      return NextResponse.json(
        { error: `extraction failed: ${captureError}`, note },
        { status: 422, ...noStore },
      );
    }
    return NextResponse.json({ note }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
