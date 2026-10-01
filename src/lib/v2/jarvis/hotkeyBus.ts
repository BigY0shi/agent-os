// SPEC-C C2 (C0.3): in-process hotkey bus on globalThis. The AHK helper's POST
// fires it; /api/jarvis/hotkey/stream SSE subscribers receive it. Deliberately
// DB-free (no events-table write, no ensureV2) — a hotkey press must work even
// before the v2 boot path has run, and the smoke drives it without a DB.
//
// The subscriber count here is the HOTKEY STREAM's own count (NOT the shared
// /api/v2/events sseSubscriberCount) — the helper uses it to decide whether to
// open a browser tab (subscribers === 0 → nobody is listening → open a tab).
//
// S38: events carry an `action`. The push-to-talk helper sends "down" when the
// key goes down and "up" when it is released; "press" is the pre-S38 single
// event (press-to-open mode, or an old helper that sends no action at all).

export type HotkeyAction = "press" | "down" | "up";
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = ["press", "down", "up"] as const;

export interface HotkeyEvent {
  type: "hotkey";
  ts: string; // ISO
  action: HotkeyAction;
  key?: string; // which physical key the helper reported (informational)
}

type HotkeySubscriber = (ev: HotkeyEvent) => void;

interface HotkeyBus {
  subscribers: Set<HotkeySubscriber>;
  lastFireAt: string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __jarvisHotkeyBus: HotkeyBus | undefined;
}

function bus(): HotkeyBus {
  if (!globalThis.__jarvisHotkeyBus) {
    globalThis.__jarvisHotkeyBus = { subscribers: new Set(), lastFireAt: null };
  }
  return globalThis.__jarvisHotkeyBus;
}

/** Subscribe (SSE stream route). Returns unsubscribe. */
export function subscribeHotkey(fn: HotkeySubscriber): () => void {
  const b = bus();
  b.subscribers.add(fn);
  return () => b.subscribers.delete(fn);
}

export function isHotkeyAction(v: unknown): v is HotkeyAction {
  return typeof v === "string" && (HOTKEY_ACTIONS as readonly string[]).includes(v);
}

/** Fire a hotkey event to every connected stream. Returns the event. */
export function fireHotkey(key?: string, action: HotkeyAction = "press"): HotkeyEvent {
  const b = bus();
  const ev: HotkeyEvent = { type: "hotkey", ts: new Date().toISOString(), action, ...(key ? { key } : {}) };
  b.lastFireAt = ev.ts;
  for (const fn of b.subscribers) {
    try {
      fn(ev);
    } catch {
      /* dead subscriber — cleaned up on its own unsubscribe */
    }
  }
  return ev;
}

/** Live hotkey-stream subscriber count (the helper's open-a-tab signal). */
export function hotkeySubscriberCount(): number {
  return bus().subscribers.size;
}

/** Last fire timestamp (settings-panel "helper alive" indicator). */
export function hotkeyLastFireAt(): string | null {
  return bus().lastFireAt;
}
