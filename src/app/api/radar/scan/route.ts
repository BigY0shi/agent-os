import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "@/lib/config";
import { gatherNews } from "@/lib/newsRadar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE NEWS RADAR — multi-agent, multi-source. It fans out research SCOUTS (your installed
// CLI agents — Codex / Cursor / Hermes / Claude — each browsing a different beat of sources
// with its own web tools), then a MANAGER merges + ranks their findings into a JSON array
// of "signals". We cache the latest, save a per-day history file, and auto-log each sweep to
// your Obsidian "AI News" folder. No X/Grok dependency. (See lib/newsRadar.ts for the fan-out.)

const RADAR_DIR = path.join(os.homedir(), ".agentic-os", "radar");
const HISTORY_DIR = path.join(RADAR_DIR, "history");
const LATEST = path.join(RADAR_DIR, "latest.json");
const STATUS = path.join(RADAR_DIR, "status.json");
const VAULT_AI_NEWS = config.vaultRoot ? path.join(config.vaultRoot, "AI News") : ""; // the user's own vault

export interface Signal {
  headline: string; why_now: string; angle: string; format: string;
  heat: number; posted: string; freshness: string; category: string;
  post_count: string; url: string; handle: string; sources: string[]; hook: string;
}

function extractRaw(raw: string): unknown[] {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("["); const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try { const arr = JSON.parse(s.slice(start, end + 1)); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

// Clickable link for a signal: any real article URL. We reject X/Twitter SEARCH & explore
// pages (never send the user to a bare search) but keep a real article/permalink of any kind.
function articleLink(url: string): string {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return "";
  if (/(?:x|twitter)\.com\/(?:search|explore)/i.test(u)) return "";
  return u.slice(0, 400);
}

function normalize(arr: unknown[]): Signal[] {
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof (x as Record<string, unknown>).headline === "string")
    .map((x) => ({
      headline: String(x.headline || "").slice(0, 120),
      why_now: String(x.why_now || "").slice(0, 500),
      angle: String(x.angle || "").slice(0, 300),
      format: String(x.format || "Video"),
      heat: Math.max(1, Math.min(100, Math.round(Number(x.heat) || 50))),
      posted: String(x.posted || x.freshness || "today").slice(0, 60),
      freshness: String(x.freshness || "today").slice(0, 40),
      category: String(x.category || "Agents"),
      post_count: String(x.post_count || "").slice(0, 40),
      handle: String(x.handle || "").replace(/^@/, "").slice(0, 60),
      url: articleLink(String(x.url || "")),
      sources: Array.isArray(x.sources) ? x.sources.slice(0, 3).map((v) => String(v).slice(0, 160)) : [],
      hook: String(x.hook || "").slice(0, 300),
    }));
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function obsidianBlock(signals: Signal[], when: Date): string {
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const lines = [`\n## Sweep · ${time}\n`];
  signals.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.headline}`);
    lines.push(`*${s.post_count ? s.post_count + " · " : ""}heat ${s.heat} · ${s.category} · ${s.posted}*`);
    lines.push(`${s.why_now}`);
    lines.push(`- **Your angle:** ${s.angle}`);
    lines.push(`- **Source (X):** ${s.url}${s.handle ? ` — @${s.handle}` : ""}`);
    if (s.hook) lines.push(`- **Hook:** "${s.hook}"`);
    lines.push("");
  });
  return lines.join("\n");
}

async function persist(signals: Signal[], scannedAt: string, meta?: { scouts?: string[]; merger?: string }) {
  const when = new Date(scannedAt);
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const payload = { ok: true, scannedAt, day, signals, scouts: meta?.scouts || [], merger: meta?.merger || "" };
  // latest + per-day history
  try {
    await mkdir(HISTORY_DIR, { recursive: true });
    await writeFile(LATEST, JSON.stringify(payload, null, 2), "utf8");
    await writeFile(path.join(HISTORY_DIR, `${day}.json`), JSON.stringify(payload, null, 2), "utf8");
  } catch { /* best effort */ }
  // Obsidian AI News/<date>.md — append a timestamped block per sweep (only if a vault is connected)
  if (VAULT_AI_NEWS) try {
    await mkdir(VAULT_AI_NEWS, { recursive: true });
    const file = path.join(VAULT_AI_NEWS, `${day}.md`);
    const block = obsidianBlock(signals, when);
    if (existsSync(file)) {
      await appendFile(file, block, "utf8");
    } else {
      const niceDay = when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const header = `# AI News — ${niceDay}\n\n> Auto-logged by The Radar (Agent OS) — what was breaking on X + the web, each sweep appended below.\n`;
      await writeFile(file, header + block, "utf8");
    }
  } catch { /* vault logging is best-effort */ }
  return payload;
}

interface SweepStatus { running: boolean; startedAt?: string; endedAt?: string; phase?: string; error?: string; scannedAt?: string; scouts?: string[]; merger?: string }

async function readStatus(): Promise<SweepStatus> {
  try { return JSON.parse(await readFile(STATUS, "utf8")); } catch { return { running: false }; }
}
async function writeStatus(s: SweepStatus) {
  try { await mkdir(RADAR_DIR, { recursive: true }); await writeFile(STATUS, JSON.stringify(s), "utf8"); } catch { /* best effort */ }
}

// The actual sweep. Runs UN-AWAITED from POST so the HTTP call returns instantly (fire-and-forget).
// On this long-lived launchd Node server the promise keeps running after the response closes; it
// writes latest.json + history + Obsidian when done and flips the status file back to idle.
async function runSweep(merger: string): Promise<void> {
  const startedAt = new Date().toISOString();
  await writeStatus({ running: true, startedAt, phase: "Sending the scouts across the newswires…" });
  try {
    const { rawJson, scouts, merger: usedMerger, found } = await gatherNews(new Date(), merger);
    const signals = normalize(extractRaw(rawJson));
    if (!signals.length) {
      const error = found === 0
        ? "The scouts came back empty — none of your agents could reach the web. Check that Claude / Codex / Cursor are signed in."
        : "The merge produced no usable signals — try again in a moment.";
      await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), error, scouts });
      return;
    }
    const payload = await persist(signals, new Date().toISOString(), { scouts, merger: usedMerger });
    await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), scannedAt: payload.scannedAt, scouts, merger: usedMerger });
  } catch (e) {
    await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), error: String((e as Error)?.message || e).slice(0, 240) });
  }
}

// POST — kick a sweep and return immediately. If one is already in flight, just report that.
export async function POST(req: Request) {
  const st = await readStatus();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() < 430_000) {
    return Response.json({ ok: true, status: "running", startedAt: st.startedAt });
  }
  const body = await req.json().catch(() => ({}));
  const merger = body?.merger === "ollama" ? "ollama" : "claude";
  const startedAt = new Date().toISOString();
  await writeStatus({ running: true, startedAt, phase: "Gathering the scouts…" });
  void runSweep(merger); // fire-and-forget
  return Response.json({ ok: true, status: "started", startedAt });
}

// GET — poll for sweep status (the UI watches this, then loads /api/radar/latest when idle).
// Self-heal: if a run was marked running but is older than the cap (e.g. the dev server
// restarted mid-sweep), report it as not-running so the UI stops waiting forever.
export async function GET() {
  const st = await readStatus();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() > 430_000) {
    const healed = { ...st, running: false, error: st.error || "The last sweep was interrupted — try again." };
    await writeStatus(healed);
    return Response.json(healed);
  }
  return Response.json(st);
}
