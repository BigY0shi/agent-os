import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { lineTime } from "@/lib/logTime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_DIRS = [
  { agent: "openclaw", dir: config.openclawLogs },
  { agent: "hermes", dir: config.hermesLogs },
];

// ts is the time the log line itself carries, or null when it carries none. Until
// 2026-09-29 every line got an invented time (the file's mtime minus 200 ms per line),
// which the timeline widgets showed as real (AGENTS.md "Never fabricate state").
// Lines still sort sensibly: by their own time where known, else by their file's
// mtime and their position in it, but that ordering key is never shown as a time.
interface Entry { ts: number | null; agent: string; text: string; level?: string; }
interface Sortable extends Entry { order: number; line: number }

async function tailFile(file: string, agent: string, max = 40): Promise<Sortable[]> {
  try {
    const data = await readFile(file, "utf8");
    const lines = data.split(/\r?\n/).filter(Boolean).slice(-max);
    const st = await stat(file);
    return lines.map((line, i) => {
      const ts = lineTime(line);
      return {
        ts,
        order: ts ?? st.mtimeMs,
        line: i,
        agent,
        text: line.length > 400 ? line.slice(0, 400) + "…" : line,
        level: /error|fail/i.test(line) ? "err" : /warn/i.test(line) ? "warn" : "info",
      };
    });
  } catch { return []; }
}

export async function GET() {
  const out: Sortable[] = [];
  for (const { agent, dir } of LOG_DIRS) {
    try {
      const items = await readdir(dir);
      const files = items.filter((f) => /\.log$/.test(f)).slice(0, 3);
      for (const f of files) {
        out.push(...(await tailFile(path.join(dir, f), agent, 20)));
      }
    } catch { /* ignore */ }
  }
  out.sort((a, b) => b.order - a.order || b.line - a.line);
  return NextResponse.json({ entries: out.slice(0, 80).map(({ order: _o, line: _l, ...e }) => e) }); // eslint-disable-line @typescript-eslint/no-unused-vars
}
