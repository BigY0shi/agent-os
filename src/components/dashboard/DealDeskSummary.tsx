"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader } from "@/components/ui/SectionHeader";

// Replaces the old fleet roster on the home screen. Shows the real Upwork Deal
// Desk pipeline from /api/deals/list (reads board.json from the scraper). The
// number that matters for the morning glance is "ready to send" — deals waiting
// on your approval to go out. All counts are real; empty state is honest.

interface DealLite {
  status: string;
}
interface Column {
  key: string;
  label: string;
  accent: string;
}

export function DealDeskSummary() {
  const [deals, setDeals] = useState<DealLite[] | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/deals/list", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j && j.ok) {
          setDeals(Array.isArray(j.deals) ? j.deals : []);
          setColumns(Array.isArray(j.columns) ? j.columns : []);
        } else {
          setDeals([]);
        }
      })
      .catch(() => {
        if (alive) setDeals([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const total = deals?.length ?? 0;
  const countFor = (k: string) => (deals ?? []).filter((d) => d.status === k).length;
  const ready = countFor("ready");

  return (
    <GlassCard hudCorners className="flex h-full flex-col">
      <SectionHeader
        eyebrow="DEAL DESK"
        title="Deals in flight"
        hint={deals === null ? "loading…" : `${total} on the board`}
        right={
          <Link
            href="/deals"
            className="flex items-center gap-0.5 font-mono text-[10.5px] uppercase tracking-widest text-[var(--color-neon)] hover:underline"
          >
            Open <ChevronRight className="h-3 w-3" />
          </Link>
        }
      />

      {deals === null ? (
        <div className="mt-4 grid flex-1 place-items-center font-mono text-[11px] text-[var(--color-ink-faint)]">
          loading pipeline…
        </div>
      ) : total === 0 ? (
        <div className="mt-4 grid flex-1 place-items-center rounded-xl border border-dashed border-[var(--color-border)] px-4 text-center font-mono text-[11px] text-[var(--color-ink-faint)]">
          No deals on the board yet.
          <br />
          Run the Upwork scraper to populate it.
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col justify-between gap-4">
          {/* the action number: ready to send */}
          <Link
            href="/deals"
            className="rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.25)] p-4 transition hover:border-[var(--color-neon)]/40"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
              Ready to send
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={
                  ready > 0
                    ? "text-3xl font-semibold text-[var(--color-neon)]"
                    : "text-3xl font-semibold text-[var(--color-ink-faint)]"
                }
              >
                {ready}
              </span>
              <span className="text-xs text-[var(--color-ink-dim)]">
                {ready > 0 ? "awaiting your approval" : "nothing queued"}
              </span>
            </div>
          </Link>

          {/* pipeline column counts */}
          <div className="flex flex-col gap-1.5">
            {columns.map((c) => {
              const n = countFor(c.key);
              return (
                <div
                  key={c.key}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[rgba(255,255,255,0.01)] px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-[13px] text-[var(--color-ink-dim)]">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: c.accent }}
                    />
                    {c.label}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-[var(--color-ink)]">
                    {n}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
