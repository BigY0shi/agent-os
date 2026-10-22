import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { storeAttachment, AttachmentRefused, attachmentMaxBytes } from "@/lib/v2/jarvis/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * S34 — POST multipart { file } → { attachment: { id, name, mime, bytes } }.
 * The file is checked by magic bytes (png/jpeg/webp) and against the size cap
 * from the Jarvis gear; a refusal answers 413 (size) or 415 (type) with the
 * reason in `error`. The stored id is what the next ask carries in `attachments`.
 * GET → { maxBytes } so the overlay can say the cap before uploading.
 */
export async function GET() {
  ensureV2();
  return NextResponse.json({ maxBytes: attachmentMaxBytes() }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  ensureV2();
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data with a `file` field" }, { status: 400, headers: NO_STORE });
  }
  const file = fd.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing `file`" }, { status: 400, headers: NO_STORE });
  }
  // Refuse by declared size before buffering: a 200 MB upload should not be read in full to be told no.
  const max = attachmentMaxBytes();
  if (file.size > max) {
    return NextResponse.json(
      { error: `too large: ${(file.size / 1024 / 1024).toFixed(2)} MB, the cap is ${(max / 1024 / 1024).toFixed(2)} MB (Jarvis gear > Attachment size cap)` },
      { status: 413, headers: NO_STORE },
    );
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const attachment = storeAttachment({ name: file.name, bytes });
    return NextResponse.json({ attachment }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AttachmentRefused) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 300) : "attachment failed" }, { status: 500, headers: NO_STORE });
  }
}
