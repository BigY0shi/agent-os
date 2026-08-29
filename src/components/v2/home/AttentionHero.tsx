"use client";

// ── AttentionHero + attention widget internals (SPEC-D H4.2, §6.7) ──────────
// ONE component serves both surfaces (§6.6 "same component, hero prop"):
//   <AttentionHero />                     — full-width band for Overview (H1.1
//                                           mounts it in chunk 2; standalone here)
//   <AttentionPanel maxItems minSeverity/> — the 'attention' grid widget body
// Data: GET /api/v2/attention (H4.1 route — severity-sorted open items,
// muteKinds already excluded server-side, collector health). Done/dismiss via
// PATCH {id, action}. Collector-health footnote per the honest-metrics rule.

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, Check, ShieldCheck, X } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { groupBySeverity, SEVERITY_RANK } from "@/lib/v2/widgets/types";
import { fmtAgo } from "../integrations/shared";

export const ATTENTION_ACCENT = "#fda4af";

/** Wire shapes of GET /api/v2/attention (see src/app/api/v2/attention/route.ts). */
export interface AttentionItemWire {
  id: string;
  dedupeKey: string;
  kind: string;
  severity: "info" | "warn" | "urgent";
  title: string;
  body: string | null;
  route: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollectorWire {
  name: string;
  ok: boolean;
  lastRunAt: string | null;
  unavailableReason?: string;
}

const SEVERITY_COLORS: Record<AttentionItemWire["severity"], string> = {
  urgent: "#f87171",
  warn: "#fbbf24",
  info: "#9ca3af",
};

const SEVERITY_TITLES: Record<AttentionItemWire["severity"], string> = {
  urgent: "Urgent",
  warn: "Warnings",
  info: "FYI",
};

export function AttentionPanel({
  hero = false,
  maxItems,
  minSeverity,
}: {
  hero?: boolean;
  maxItems?: number;
  minSeverity?: string;
}) {
  const [items, setItems] = useState<AttentionItemWire[] | null>(null);
  const [collectors, setCollectors] = useState<CollectorWire[]>([]);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/attention", { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.items)) {
        setItems(j.items as AttentionItemWire[]);
        setCollectors(Array.isArray(j?.collectors) ? (j.collectors as CollectorWire[]) : []);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  usePollWhileVisible(refresh, 30_000, []);

  const resolve = async (id: string, action: "done" | "dismiss") => {
    setBusyId(id);
    try {
      await fetch("/api/v2/attention", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
    } catch {
      /* refresh below shows the truth either way */
    } finally {
      setBusyId(null);
      void refresh();
    }
  };

  const minRank = SEVERITY_RANK[minSeverity ?? "info"] ?? 0;
  const visible = (items ?? [])
    .filter((i) => (SEVERITY_RANK[i.severity] ?? 0) >= minRank)
    .slice(0, maxItems && maxItems > 0 ? maxItems : undefined);
  const groups = groupBySeverity(visible);
  const broken = collectors.filter((c) => !c.ok);

  if (items === null) {
    return (
      <div className="font-mono text-[11px] py-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        {failed ? "attention feed unreachable" : "loading…"}
      </div>
    );
  }

  if (visible.length === 0) {
    // Hero collapses to the thin "All clear" band (§6.4); the widget gets a
    // normal empty state.
    return (
      <div>
        <div
          className="flex items-center gap-2 rounded-lg px-3"
          style={{
            height: hero ? 34 : 64,
            border: "1px solid #34d39944",
            background: "#34d3990d",
            color: "var(--fg-dim, #9aa)",
            fontSize: 12,
          }}
        >
          <ShieldCheck size={14} style={{ color: "#34d399" }} />
          All clear — nothing needs your attention.
        </div>
        <CollectorFootnote broken={broken} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {(["urgent", "warn", "info"] as const).map((sev) => {
        const group = groups[sev];
        if (group.length === 0) return null;
        return (
          <div key={sev}>
            <div
              className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
              style={{ color: SEVERITY_COLORS[sev] }}
            >
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: 99, background: SEVERITY_COLORS[sev] }}
              />
              {SEVERITY_TITLES[sev]} · {group.length}
            </div>
            <div className="flex flex-col gap-1.5">
              {group.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2"
                  style={{
                    border: `1px solid ${SEVERITY_COLORS[sev]}33`,
                    background: "var(--panel, rgba(255,255,255,0.02))",
                    opacity: busyId === item.id ? 0.5 : 1,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="truncate text-[13px] font-medium"
                        style={{ color: "var(--fg, #e8e2f0)" }}
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      <span
                        className="shrink-0 font-mono text-[10px]"
                        style={{ color: "var(--fg-dimmer, #6b6478)" }}
                      >
                        {item.kind} · {fmtAgo(item.createdAt)}
                      </span>
                    </div>
                    {item.body ? (
                      <div
                        className="truncate text-[11px]"
                        style={{ color: "var(--fg-dim, #9aa)" }}
                        title={item.body}
                      >
                        {item.body}
                      </div>
                    ) : null}
                  </div>
                  {item.route ? (
                    <Link
                      href={item.route}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-mono text-[11px]"
                      style={{
                        border: `1px solid ${SEVERITY_COLORS[sev]}55`,
                        color: SEVERITY_COLORS[sev],
                      }}
                      title={`Go to ${item.route}`}
                    >
                      Go <ArrowRight size={11} />
                    </Link>
                  ) : null}
                  <button
                    onClick={() => void resolve(item.id, "done")}
                    disabled={busyId === item.id}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md"
                    style={{ border: "1px solid #34d39955", color: "#34d399" }}
                    title="Done — handled this occurrence"
                    aria-label={`Mark '${item.title}' done`}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => void resolve(item.id, "dismiss")}
                    disabled={busyId === item.id}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md"
                    style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
                    title="Dismiss — stop telling me about this"
                    aria-label={`Dismiss '${item.title}'`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <CollectorFootnote broken={broken} />
    </div>
  );
}

/** Honest-metrics footnote (§6.7): name any collector that can't read its source. */
function CollectorFootnote({ broken }: { broken: CollectorWire[] }) {
  if (broken.length === 0) return null;
  return (
    <div className="font-mono text-[10px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
      {broken.map((c) => (
        <div key={c.name}>
          ⚠ collector '{c.name}' unavailable{c.unavailableReason ? `: ${c.unavailableReason}` : ""}
        </div>
      ))}
    </div>
  );
}

/**
 * The full-width Overview band (H4.2). NOT mounted anywhere yet — H1.1
 * (chunk 2) places it atop Overview; built standalone so that chunk only
 * positions it.
 */
export default function AttentionHero() {
  return (
    <section aria-label="Needs my attention">
      <div
        className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
        style={{ color: ATTENTION_ACCENT }}
      >
        <BellRing size={12} /> Needs my attention
      </div>
      <AttentionPanel hero />
    </section>
  );
}
