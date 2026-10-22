import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function readFirst(names: string[]): string {
  for (const p of names) {
    try {
      const v = readFileSync(p, "utf8").trim();
      if (v) return v;
    } catch {
      /* try next */
    }
  }
  return "";
}

// The app's own version is package.json, which `npm run version:bump` maintains
// (AGENTS.md rule 18). VERSION is a separate, inherited artifact: the upstream
// pack's release stamp, last written by the Phase-0 baseline snapshot. It was
// previously rendered as "build <date>", which asserted a 2026-06-24 build of an
// app that had moved ten minor versions past it. It is reported as `pack` now so
// the label can say what it actually is, and null when the file is absent.
export function GET() {
  let version = "";
  try {
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    version = String(JSON.parse(raw).version || "").trim();
  } catch {
    /* fall through to unknown */
  }

  const pack = readFirst([
    path.join(process.cwd(), "VERSION"),
    path.join(process.cwd(), "..", "VERSION"),
  ]);

  return NextResponse.json({ version: version || "unknown", pack: pack || null });
}
