import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureHotkeySecret, hotkeySecretPath } from "@/lib/v2/jarvis/hotkeySecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPEC-C C2 — hotkey helper setup. Cookie-authed ONLY (normal proxy gate; NOT
// exempt). First GET generates + persists the secret (idempotent — subsequent
// GETs return the SAME secret); the response carries install instructions and
// the AHK v2 helper script content so the user can save/copy it anywhere.

export async function GET() {
  const secret = ensureHotkeySecret();
  const secretPath = hotkeySecretPath();

  // The canonical helper script ships in the repo; read it so the setup
  // response always matches what's on disk. Falls back to a pointer if the
  // file is missing (e.g. pruned deploy).
  const scriptRepoPath = path.join(process.cwd(), "scripts", "v2", "jarvis-hotkey.ahk");
  let script: string | null = null;
  try {
    script = readFileSync(scriptRepoPath, "utf8");
  } catch {
    script = null;
  }

  return NextResponse.json(
    {
      configured: true,
      secret,
      secretPath,
      scriptPath: scriptRepoPath,
      instructions: [
        "1. Install AutoHotkey v2 (https://www.autohotkey.com) — v2, not v1.",
        `2. The shared secret is already written to ${secretPath} — the script reads it from there at start.`,
        `3. Save the helper script (scripts/v2/jarvis-hotkey.ahk, content included in this response) anywhere, e.g. next to the secret file.`,
        "4. Double-click the .ahk to run it now. F13 (configurable at the top of the script) now opens the Jarvis chatbox from anywhere.",
        "5. Auto-start: press Win+R, type shell:startup, Enter — then copy a SHORTCUT to the .ahk into that folder. No UAC needed.",
        "6. No F13 key? Edit the Hotkey line at the top of the script — a commented CapsLock remap example is included.",
      ],
      script,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
