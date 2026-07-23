import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { readSettings } from "@/lib/settings";
import { writeFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Thumbnail generation on a CLI agent's image skill/MCP (no OpenAI key). The chosen agent
// generates the thumbnails into a temp dir; we read them back and return data URLs in the
// SAME shape as /api/thumbnails/generate so the Thumbnails UI renders them unchanged.

const IMG_EXT = /\.(png|jpe?g|webp)$/i;

function dataUrlToBuf(dataUrl: string): { buf: Buffer; ext: string } | null {
  const m = dataUrl.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) return null;
  return { buf: Buffer.from(m[2], "base64"), ext: m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase() };
}

// One-shot print-mode args per CLI agent (mirrors lib/loopEngine.ts cliComplete).
function cliArgs(agent: string, prompt: string): { args: string[]; input?: string } {
  switch (agent) {
    case "claude":  return { args: ["-p", "--output-format", "text", "--dangerously-skip-permissions"], input: prompt };
    case "codex":   return { args: ["exec", "--full-auto", "--skip-git-repo-check", "--ignore-user-config", prompt] };
    case "cursor":  return { args: ["-p", prompt, "--output-format", "text", "--force", "--trust"] };
    case "pi":      return { args: ["-p", prompt, "--mode", "text", "--no-session", "--no-context-files"] };
    case "hermes":  return { args: ["-z", prompt, "--yolo", "--accept-hooks"] };
    default:        return { args: ["-p", prompt] };
  }
}

export async function POST(req: Request) {
  let body: { images?: string[]; image?: string; instructions?: string; count?: number; agent?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const instructions = (body.instructions || "").trim();
  const count = Math.min(4, Math.max(1, Number(body.count) || 3));
  const imageList = (Array.isArray(body.images) ? body.images : body.image ? [body.image] : []).filter(Boolean).slice(0, 6);
  if (!instructions && !imageList.length) return NextResponse.json({ error: "Add a reference image or some instructions." }, { status: 400 });

  const agent = (typeof body.agent === "string" ? body.agent.replace(/^cli:/, "") : "") || readSettings().thumbnails.agent || "claude";

  const work = path.join(tmpdir(), `thumb-cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const out = path.join(work, "out");
  await mkdir(out, { recursive: true });

  // Drop any reference images so the agent can use them.
  const refPaths: string[] = [];
  for (let i = 0; i < imageList.length; i++) {
    const dec = dataUrlToBuf(imageList[i]);
    if (dec) { const p = path.join(work, `ref${i}.${dec.ext}`); await writeFile(p, dec.buf); refPaths.push(p); }
  }

  const prompt =
    `Create ${count} YouTube thumbnail image${count === 1 ? "" : "s"} (1280x720, eye-catching, bold, high-contrast) using your image-generation skill/MCP.\n` +
    `Brief: ${instructions || "(design from the reference image)"}\n` +
    (refPaths.length ? `Reference image(s) to draw from: ${refPaths.join(", ")}\n` : "") +
    `Save the finished thumbnails as PNG files into EXACTLY this directory: ${out}\n` +
    `Name them thumb-1.png … thumb-${count}.png. When all files are saved, reply with only: DONE`;

  let stderr = "";
  try {
    const { args, input } = cliArgs(agent, prompt);
    const res = await run(agent as Parameters<typeof run>[0], args, { timeoutMs: 285_000, input, cwd: work });
    stderr = res.stderr || "";
  } catch (e) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    return NextResponse.json({ error: `Thumbnails CLI backend (${agent}): ${String(e).slice(0, 200)}` }, { status: 502 });
  }

  let produced: string[] = [];
  try { produced = (await readdir(out)).filter((f) => IMG_EXT.test(f)).sort(); } catch { /* none */ }
  if (!produced.length) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    return NextResponse.json({
      error: `${agent} didn't produce any thumbnails. Make sure ${agent} has an image-generation skill/MCP enabled (e.g. Higgsfield / an image MCP).`,
      detail: stderr.slice(-300),
    }, { status: 502 });
  }

  const images: string[] = [];
  for (const f of produced.slice(0, count)) {
    try {
      const buf = await readFile(path.join(out, f));
      const ext = path.extname(f).slice(1).toLowerCase() === "jpg" ? "jpeg" : path.extname(f).slice(1).toLowerCase();
      images.push(`data:image/${ext};base64,${buf.toString("base64")}`);
    } catch { /* skip */ }
  }
  await rm(work, { recursive: true, force: true }).catch(() => {});

  if (!images.length) return NextResponse.json({ error: "Saved files couldn't be read back." }, { status: 502 });
  return NextResponse.json({ ok: true, images, provider: `cli:${agent}`, savedTo: null });
}
