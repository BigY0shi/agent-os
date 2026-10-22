import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureHotkeySecret, hotkeySecretPath } from "@/lib/v2/jarvis/hotkeySecret";
import { hotkeyConfig } from "@/lib/v2/jarvis/hotkeyConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPEC-C C2 — hotkey helper setup. Cookie-authed ONLY (normal proxy gate; NOT
// exempt). First GET generates + persists the secret (idempotent — subsequent
// GETs return the SAME secret); the response carries install instructions and
// the AHK v2 helper script content so the user can save/copy it anywhere.
// S38: the key and mode are no longer edited in the script; the helper reads
// them from /api/jarvis/hotkey/config, so the instructions point at the gear.

export async function GET() {
  const secret = ensureHotkeySecret();
  const secretPath = hotkeySecretPath();
  const { key, mode } = hotkeyConfig();

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
      key,
      mode,
      instructions: [
        "1. Install AutoHotkey v2 (https://www.autohotkey.com) — v2, not v1.",
        `2. The shared secret is already written to ${secretPath} — the script reads it from there at start.`,
        `3. Save the helper script (scripts/v2/jarvis-hotkey.ahk, content included in this response) anywhere, e.g. next to the secret file.`,
        `4. Double-click the .ahk to run it now. It reads the key (${key}) and mode (${mode === "hold" ? "hold to talk" : "press to open"}) from the Jarvis gear every 30 s, so change them in the gear, never in the script.`,
        "5. Auto-start: press Win+R, type shell:startup, Enter — then copy a SHORTCUT to the .ahk into that folder. No UAC needed.",
        "6. No F13 key? Map a spare key on a mini USB keyboard to F13..F24 with its vendor tool, or type a key name (CapsLock, F9) into the gear's Key field.",
        "7. The script assumes Agent OS on http://127.0.0.1:3737. Only if yours is elsewhere, edit the AppUrl line at the top of the script.",
      ],
      script,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
