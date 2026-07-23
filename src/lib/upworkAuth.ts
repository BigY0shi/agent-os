// upworkAuth.ts — store/read the user's Upwork session cookie (a secret), used
// ONLY by the v2 authenticated enrichment. Written to the active Hermes profile
// .env (same place other OS secrets live, mode 600); never returned to the browser.

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HERMES_DIR = path.join(os.homedir(), ".hermes");
const NAME = "UPWORK_COOKIE";

function activeProfile(): string {
  try {
    const p = readFileSync(path.join(HERMES_DIR, "active_profile"), "utf8").trim();
    if (p) return p;
  } catch { /* ignore */ }
  return process.env.HERMES_PROFILE || "main";
}
function envFilePath(): string {
  return path.join(HERMES_DIR, "profiles", activeProfile(), ".env");
}

export function readUpworkCookie(): string {
  try {
    const line = readFileSync(envFilePath(), "utf8").split("\n").find((l) => l.startsWith(`${NAME}=`));
    if (line) {
      const v = line.slice(NAME.length + 1).replace(/^["']|["']$/g, "").trim();
      if (v) return v;
    }
  } catch { /* ignore */ }
  return process.env[NAME]?.trim() || "";
}

export function saveUpworkCookie(cookie: string): { ok: boolean; error?: string } {
  const c = String(cookie || "").trim();
  if (c.length < 20 || !c.includes("=")) return { ok: false, error: "That doesn't look like a cookie string." };
  try {
    const file = envFilePath();
    mkdirSync(path.dirname(file), { recursive: true });
    let lines: string[] = [];
    try { lines = readFileSync(file, "utf8").split("\n"); } catch { /* new file */ }
    const oneLine = c.replace(/\s*\n\s*/g, " "); // collapse to a single env line
    const val = `${NAME}=${oneLine}`;
    const i = lines.findIndex((l) => l.startsWith(`${NAME}=`));
    if (i >= 0) lines[i] = val; else lines.push(val);
    writeFileSync(file, lines.join("\n").replace(/\n+$/, "") + "\n", "utf8");
    try { chmodSync(file, 0o600); } catch { /* best-effort on non-posix */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function cookieStatus(): { set: boolean; hint: string } {
  const c = readUpworkCookie();
  return { set: !!c, hint: c ? `saved · ${c.length} chars` : "" };
}
