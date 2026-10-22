// Rabbit R1 bridge — one-line request log that survives any launcher.
// `Start Agent OS.bat` runs `npm start` in the foreground, so console output
// lives in that window and is gone when it closes; the restart script
// redirects to ~/.agentic-os/agentos-server.log. Either way, this appends to
// ~/.agentic-os/rabbit.log as well, so "what did the device send" is always
// answerable. Shape only — never message content, never the key.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export function rabbitLogPath(): string {
  const override = process.env.AGENTIC_OS_RABBIT_LOG;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "rabbit.log");
}

export function rabbitLog(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(`[rabbit] ${line}`);
  try {
    const p = rabbitLogPath();
    mkdirSync(path.dirname(p), { recursive: true });
    appendFileSync(p, stamped + "\n", "utf8");
  } catch {
    /* logging must never break a reply */
  }
}
