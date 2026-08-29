"use client";

import { useCallback, useState } from "react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import type { V2Event } from "@/lib/v2/eventTypes";

// ── EventFeed (SPEC-A F2.4) ──────────────────────────────────────────────────
// Compact type-colored dot list over GET /api/v2/events. First mounted in the
// Memory gear's System section (A8.6); reused by the Homepage later (H).

const TYPE_COLORS: [prefix: string, color: string][] = [
  ["memory.", "#22d3ee"],
  ["job.", "#fbbf24"],
  ["task.", "#a855f7"],
  ["mcp.", "#34d399"],
  ["attention.", "#f87171"],
];

function colorFor(type: string): string {
  for (const [prefix, color] of TYPE_COLORS) {
    if (type.startsWith(prefix)) return color;
  }
  return "#9aa";
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export default function EventFeed({
  limit = 30,
  intervalMs = 5000,
  maxHeight = 260,
}: { limit?: number; intervalMs?: number; maxHeight?: number }) {
  const [events, setEvents] = useState<V2Event[] | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/v2/events?limit=${limit}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.events)) { setEvents(j.events as V2Event[]); setFailed(false); }
    } catch { setFailed(true); }
  }, [limit]);

  usePollWhileVisible(refresh, intervalMs, [limit]);

  if (failed && !events) {
    return <div className="text-[11px] py-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>event feed unreachable</div>;
  }
  if (!events) {
    return <div className="text-[11px] py-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>loading events…</div>;
  }
  if (events.length === 0) {
    return <div className="text-[11px] py-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>no events yet</div>;
  }

  return (
    <div className="overflow-y-auto pr-1" style={{ maxHeight }}>
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-2 py-[3px] min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorFor(e.type) }} />
          <span className="font-mono text-[10.5px] truncate" style={{ color: "var(--fg-dim, #9aa)" }} title={JSON.stringify(e.payload)}>
            {e.type}
          </span>
          {e.source && (
            <span className="font-mono text-[10px] truncate shrink-0 max-w-[120px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {e.source}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            {ago(e.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}
