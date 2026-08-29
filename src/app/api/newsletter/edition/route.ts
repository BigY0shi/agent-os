// SPEC-F K4.1 — GET ?date= (default latest) / POST (re)build.
//
// POST is NOT force-by-default. SPEC-F §5's one-liner says "POST → force
// (re)build", but K4.1's own verify demands "second POST without force →
// returns existing (same builtAt)". The verify is the more specific contract
// and the safer default (a rebuild would rewrite an edition someone is reading),
// so force is an explicit `{force:true}` body flag.
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { buildEdition } from "@/lib/v2/newsletter/edition";
import { getEdition, listEditionDates } from "@/lib/v2/newsletter/store";
import type { EditionDoc } from "@/lib/v2/newsletter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/newsletter/edition?date=YYYY-MM-DD → { edition, dates } */
export async function GET(req: NextRequest) {
  ensureV2();
  const dateParam = req.nextUrl.searchParams.get("date");
  if (dateParam && !DATE_RE.test(dateParam)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, ...noStore });
  }
  try {
    const dates = listEditionDates();
    const date = dateParam ?? dates[0] ?? null;
    const row = date ? getEdition(date) : null;
    const edition = (row?.content as EditionDoc | null) ?? null;
    return NextResponse.json({ edition, dates }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

/** POST /api/newsletter/edition  body: { date?, force? } → { edition, … } */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { date?: unknown; force?: unknown } | null;
  const date = typeof body?.date === "string" ? body.date.trim() : undefined;
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, ...noStore });
  }
  try {
    const result = await buildEdition(date, { force: body?.force === true });
    // `classification`/`classificationError` are honest telemetry, not noise:
    // 'fallback' means the model call failed and the topic ladder ran, and the
    // reader renders that as a visible warning rather than a normal edition.
    return NextResponse.json(result, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
