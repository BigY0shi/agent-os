import { on } from "../events";
import { readSettings } from "../../settings";
import { upsertByDedupeKey, normalizeSeverity } from "./store";
import { runCollectorsOnce } from "./collectors";

/**
 * SPEC-D H4.1 — ensureAttention(): boot-wired (boot.ts ensureV2) singleton.
 *
 *  1. Generic 'attention.flag' bridge (CONVENTIONS §5 payload
 *     {kind, severity, title, route, dedupeKey}) → upsertByDedupeKey. This
 *     instantly lands the EXISTING emitters (webmcp approvals, task engine)
 *     without bespoke collectors.
 *  2. 60s pull-collector tick (settings.attention.pollMs override), unref'd on
 *     globalThis so smokes and shutdown are never held open.
 */

declare global {
  // eslint-disable-next-line no-var
  var __agentosAttention:
    | { timer: ReturnType<typeof setInterval> | null; unsubscribe: (() => void) | null }
    | undefined;
}

function state() {
  if (!globalThis.__agentosAttention) {
    globalThis.__agentosAttention = { timer: null, unsubscribe: null };
  }
  return globalThis.__agentosAttention;
}

export function ensureAttention(): void {
  const s = state();
  if (s.unsubscribe) return;

  s.unsubscribe = on("attention.flag", (event) => {
    const p = event.payload as Record<string, unknown>;
    const dedupeKey = typeof p.dedupeKey === "string" ? p.dedupeKey.trim() : "";
    const kind = typeof p.kind === "string" ? p.kind.trim() : "";
    const title = typeof p.title === "string" ? p.title.trim() : "";
    if (!dedupeKey || !kind || !title) {
      console.warn("[v2/attention] attention.flag missing kind/title/dedupeKey — ignored:", p);
      return;
    }
    try {
      upsertByDedupeKey({
        dedupeKey,
        kind,
        title,
        severity: normalizeSeverity(p.severity),
        route: typeof p.route === "string" ? p.route : null,
        payload: p,
        source: event.source ?? "event",
      });
    } catch (err) {
      console.error("[v2/attention] attention.flag upsert failed:", err);
    }
  });

  const pollMs = Math.max(5_000, readSettings().attention?.pollMs ?? 60_000);
  s.timer = setInterval(() => {
    void runCollectorsOnce().catch((err) =>
      console.error("[v2/attention] collector tick failed:", err),
    );
  }, pollMs);
  if (typeof s.timer === "object" && "unref" in s.timer) s.timer.unref();
  // First pass shortly after boot (don't block register()).
  setTimeout(() => {
    void runCollectorsOnce().catch((err) =>
      console.error("[v2/attention] boot collector pass failed:", err),
    );
  }, 3_000).unref?.();
}

/** Smoke teardown: stop the tick + drop the bus subscription. */
export function stopAttentionForTests(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.unsubscribe?.();
  globalThis.__agentosAttention = undefined;
}

export { upsertByDedupeKey, autoResolve, markDone, dismissItem, listItems } from "./store";
export { runCollectorsOnce, getCollectorHealth, __setAgentsSourceForTests } from "./collectors";
