// SPEC-F I2.1 — serves saved screenshots out of ~/.agentic-os/anynotes/media/.
//
// Path guard follows the existing kanbanWorkspace pattern: a strict filename
// regex FIRST (so `..%2f`, `..\`, absolute paths and anything with a separator
// never reach the filesystem), then path.resolve + a prefix check against the
// media root as the second, independent gate. A rejected name is a 400 — the
// caller sent something malformed — not a 404, which would leak whether a file
// with that name exists.
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { mediaFilePath } from "@/lib/v2/anynotes/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const abs = mediaFilePath(file);
  if (!abs) {
    return NextResponse.json(
      { error: "bad media filename" },
      { status: 400, headers: noStore },
    );
  }
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: noStore });
    }
    const bytes = fs.readFileSync(abs);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
        "content-length": String(stat.size),
        // Media files are content-addressed by a random id and never rewritten,
        // but they are private to this box — no shared/CDN caching.
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: noStore });
  }
}
