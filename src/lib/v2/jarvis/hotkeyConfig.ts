// S38 — the hotkey knobs the AutoHotkey helper and the page both read from the
// Jarvis gear (settings.jarvis.hotkey). One reader so the defaults live once.

import { readSettings } from "@/lib/settings";

export type HotkeyMode = "hold" | "open";

export const HOTKEY_DEFAULT_KEY = "F13";

/** Key + mode only: exactly what GET /api/jarvis/hotkey/config hands the helper. */
export function hotkeyConfig(): { key: string; mode: HotkeyMode } {
  const hk = readSettings().jarvis?.hotkey ?? {};
  const key = (typeof hk.key === "string" && hk.key.trim()) || HOTKEY_DEFAULT_KEY;
  const mode: HotkeyMode = hk.mode === "open" ? "open" : "hold";
  return { key: key.slice(0, 32), mode };
}
