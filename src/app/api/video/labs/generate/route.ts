import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { readSettings } from "@/lib/settings";
import { studioDirs, PREVIEW_BUCKET } from "@/lib/hermesStudio";
import { mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// B-roll generation on the user's OWN backends (no grok/minimax, no API key):
//   • "eidolon" → POST the prompt to the user's local Eidolon LTX/WAN Studio endpoint
//   • "cli"     → drive a chosen CLI agent through its Higgsfield skill/MCP
// Clips land in the Hermes video bucket (~/.hermes/videos) and serve via the existing
// preview route, exactly like the MiniMax/Grok path — so the timeline embeds them the same way.

const VIDEO_EXT = /\.(mp4|webm|mov|gif)$/i;

async function newestVideoSince(dir: string, sinceMs: number): Promise<string | null> {
  try {
    const files = await readdir(dir);
    let best: { name: string; mtime: number } | null = null;
    for (const f of files) {
      if (!VIDEO_EXT.test(f)) continue;
      try {
        const s = await stat(path.join(dir, f));
        if (s.mtimeMs >= sinceMs && (!best || s.mtimeMs > best.mtime)) best = { name: f, mtime: s.mtimeMs };
      } catch { /* skip */ }
    }
    return best?.name ?? null;
  } catch { return null; }
}

function previewUrl(name: string): string {
  return `/api/video/preview/${PREVIEW_BUCKET.video}/${encodeURIComponent(name)}`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  if (prompt.length > 2000) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  const v = readSettings().video;
  const backend = body.provider === "cli" || body.provider === "eidolon" ? body.provider : (v.backend || "eidolon");
  const dir = studioDirs().video;
  if (!existsSync(dir)) { try { await mkdir(dir, { recursive: true }); } catch {} }
  const t0 = Date.now();

  // ── CLI agent + Higgsfield ────────────────────────────────────────────────
  if (backend === "cli") {
    const agent = v.agent || "claude";
    const name = `labs-${t0}.mp4`;
    const target = path.join(dir, name);
    const instruction =
      `Use your Higgsfield skill/MCP (or whatever video-generation tool you have) to create a short b-roll video clip for this prompt:\n"${prompt}"\n\n` +
      `Save the resulting video file to EXACTLY this absolute path: ${target}\n` +
      `When the file is saved, reply with only: DONE`;
    let res;
    try {
      // run() validates the agent name; unsupported agents throw a clear error.
      res = await run(agent as Parameters<typeof run>[0], cliArgs(agent, instruction).args, { timeoutMs: 280_000, input: cliArgs(agent, instruction).input });
    } catch (e) {
      return NextResponse.json({ error: `CLI backend (${agent}): ${String(e)}` }, { status: 502 });
    }
    const found = (existsSync(target) && name) || (await newestVideoSince(dir, t0));
    if (found) return NextResponse.json({ ok: true, status: "done", provider: "cli", name: found, url: previewUrl(found) });
    return NextResponse.json({
      error: `${agent} didn't produce a clip via Higgsfield. Make sure ${agent} has the Higgsfield skill/MCP enabled.`,
      detail: (res?.stdout || res?.stderr || "").slice(-400),
    }, { status: 502 });
  }

  // ── Eidolon LTX/WAN Studio (your local Pinokio app) ───────────────────────
  const endpoint = (v.eidolonUrl || v.comfyUrl || "").trim().replace(/\/+$/, "");
  if (!endpoint) {
    return NextResponse.json({ error: "No Eidolon/ComfyUI endpoint set. Open Video settings (gear) and add your Eidolon LTX/WAN Studio URL." }, { status: 400 });
  }
  try {
    const r = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, model: v.model || "ltx" }),
      signal: AbortSignal.timeout(280_000),
    });
    const ct = r.headers.get("content-type") || "";
    // Direct video bytes back
    if (/video\//.test(ct)) {
      const buf = Buffer.from(await r.arrayBuffer());
      const name = `labs-${t0}.mp4`;
      await writeFile(path.join(dir, name), buf);
      return NextResponse.json({ ok: true, status: "done", provider: "eidolon", name, url: previewUrl(name) });
    }
    // JSON with a clip URL somewhere — download it
    const j = await r.json().catch(() => null);
    const clipUrl = pickUrl(j);
    if (clipUrl) {
      const cr = await fetch(clipUrl, { signal: AbortSignal.timeout(120_000) });
      if (cr.ok) {
        const buf = Buffer.from(await cr.arrayBuffer());
        const name = `labs-${t0}.mp4`;
        await writeFile(path.join(dir, name), buf);
        return NextResponse.json({ ok: true, status: "done", provider: "eidolon", name, url: previewUrl(name) });
      }
    }
    return NextResponse.json({
      error: "Eidolon endpoint responded but no video was found. Its API shape may differ — point Video settings at the endpoint that returns a clip URL or video bytes.",
      detail: typeof j === "object" ? JSON.stringify(j).slice(0, 400) : String(j).slice(0, 400),
    }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't reach Eidolon at ${endpoint}: ${String(e).slice(0, 200)}` }, { status: 502 });
  }
}

// Best-effort extraction of a clip URL from an unknown JSON response shape.
function pickUrl(j: unknown): string | null {
  if (!j || typeof j !== "object") return null;
  const obj = j as Record<string, unknown>;
  for (const k of ["url", "video", "videoUrl", "output", "file", "result"]) {
    const val = obj[k];
    if (typeof val === "string" && /^https?:\/\//.test(val)) return val;
    if (Array.isArray(val) && typeof val[0] === "string" && /^https?:\/\//.test(val[0])) return val[0];
  }
  return null;
}

// One-shot print-mode args per CLI agent (mirrors lib/loopEngine.ts cliComplete).
function cliArgs(agent: string, prompt: string): { args: string[]; input?: string } {
  switch (agent) {
    case "claude":  return { args: ["-p", "--output-format", "text"], input: prompt };
    case "codex":   return { args: ["exec", "--skip-git-repo-check", "--ignore-user-config", prompt] };
    case "cursor":  return { args: ["-p", prompt, "--output-format", "text", "--force", "--trust"] };
    case "pi":      return { args: ["-p", prompt, "--mode", "text", "--no-session", "--no-context-files"] };
    case "hermes":  return { args: ["-z", prompt, "--yolo", "--accept-hooks"] };
    default:        return { args: ["-p", prompt] };
  }
}
