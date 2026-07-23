"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Bars } from "@/components/ui/Bars";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffffffff) / 0xffffffff;
  };
}

function genSeries(seed = 7) {
  const r = rng(seed);
  const out: number[] = [];
  let v = 40;
  for (let i = 0; i < 60; i++) {
    v += (r() - 0.45) * 18;
    v = Math.max(8, Math.min(96, v));
    out.push(Math.round(v));
  }
  return out;
}

export function TelemetryPanel() {
  const [series, setSeries] = useState<number[]>(() => genSeries(13));
  const [highlightIdx, setHighlightIdx] = useState<number | undefined>();

  useEffect(() => {
    const timer = setInterval(() => {
      setSeries((prev) => {
        const next = [...prev.slice(1)];
        const last = prev[prev.length - 1];
        let v = last + (Math.random() - 0.46) * 16;
        v = Math.max(8, Math.min(96, v));
        next.push(Math.round(v));
        return next;
      });
    }, 1800);
    return () => clearInterval(timer);
  }, []);

  const avg = Math.round(series.reduce((a, b) => a + b, 0) / series.length);
  const peak = Math.max(...series);

  return (
    <GlassCard hudCorners className="flex h-full flex-col justify-between">
      <div>
        <SectionHeader
          eyebrow="TELEMETRY"
          title="Engine load"
          hint="Simulated runtime execution load"
          right={
            <div className="flex items-center gap-4 text-right font-mono">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
                  AVG LOAD
                </div>
                <div className="text-sm font-semibold text-[var(--color-neon)]">
                  {avg}%
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
                  PEAK
                </div>
                <div className="text-sm font-semibold text-[var(--color-ink)]">
                  {peak}%
                </div>
              </div>
            </div>
          }
        />
      </div>

      <div
        className="relative my-4 flex items-end justify-center rounded-lg border border-[var(--color-border)] bg-[rgba(0,0,0,0.25)] p-3"
        onMouseLeave={() => setHighlightIdx(undefined)}
      >
        <Bars
          data={series}
          height={82}
          highlightIndex={highlightIdx}
        />

        {/* transparent interactive overlays over each bar */}
        <div className="absolute inset-0 flex items-end gap-[3px] p-3">
          {series.map((v, i) => (
            <div
              key={i}
              className="h-full flex-1 cursor-crosshair"
              style={{ width: 6 }}
              onMouseEnter={() => setHighlightIdx(i)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-[var(--color-ink-dim)]">
        <span className="font-mono">t-60s</span>
        <span className="font-mono">
          {highlightIdx !== undefined ? (
            <span className="text-[var(--color-neon)]">
              val: {series[highlightIdx]}% at t-{60 - highlightIdx}s
            </span>
          ) : (
            "Hover bars to inspect"
          )}
        </span>
        <span className="font-mono">now</span>
      </div>
    </GlassCard>
  );
}
