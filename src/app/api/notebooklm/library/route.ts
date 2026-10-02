import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { AGENTIC_DIR } from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * Notebooks live under the CONFIGURED vault, not a guessed one.
 *
 * This used to hardcode ~/Documents/Obsidian Vault, which does not exist on
 * every machine - so mkdir -p happily created a phantom folder nobody opens and
 * every write landed there instead of the real vault. Falls back to
 * ~/.agentic-os/notebooks when no vault is configured, because a relative path
 * (what path.join("") yields) would write into the server's cwd.
 */
function notebooksDir(): string {
  return AGENTIC_DIR
    ? path.join(AGENTIC_DIR, "Notebooks")
    : path.join(os.homedir(), ".agentic-os", "notebooks");
}

const ASSETS_DIR = path.join(notebooksDir(), "_assets");

interface SavedAsset {
  name: string; path: string; relPath: string;
  bytes: number; mtime: number; notebook: string;
  kind: "audio" | "video" | "image" | "pdf" | "html" | "doc" | "other";
}

function kindFor(name: string): SavedAsset["kind"] {
  const ext = path.extname(name).toLowerCase();
  if (/\.(mp3|m4a|wav|ogg|aac|flac|opus)$/.test(ext)) return "audio";
  if (/\.(mp4|webm|mov|m4v)$/.test(ext)) return "video";
  if (/\.(png|jpg|jpeg|webp|gif|svg)$/.test(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (/\.(html?|md)$/.test(ext)) return "html";
  if (/\.(docx?|csv|json|txt)$/.test(ext)) return "doc";
  return "other";
}

async function listAssets(): Promise<SavedAsset[]> {
  if (!existsSync(ASSETS_DIR)) return [];
  const out: SavedAsset[] = [];
  try {
    const notebooks = await readdir(ASSETS_DIR, { withFileTypes: true });
    for (const nbDir of notebooks) {
      if (!nbDir.isDirectory()) continue;
      const nbPath = path.join(ASSETS_DIR, nbDir.name);
      const files = await readdir(nbPath).catch(() => []);
      for (const f of files) {
        if (f.startsWith(".")) continue;
        const full = path.join(nbPath, f);
        try {
          const s = await stat(full);
          if (!s.isFile()) continue;
          out.push({
            name: f, path: full, relPath: path.relative(ASSETS_DIR, full),
            bytes: s.size, mtime: s.mtimeMs, notebook: nbDir.name,
            kind: kindFor(f),
          });
        } catch {}
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
  } catch {}
  return out;
}

export async function GET() {
  const savedAssets = await listAssets();
  return NextResponse.json({ savedAssets, root: ASSETS_DIR });
}
