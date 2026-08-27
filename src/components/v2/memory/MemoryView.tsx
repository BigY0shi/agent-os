"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Boxes, Brain, FileText, Layers, ListOrdered, Plus, Tag, UserRound, X,
} from "lucide-react";
import ConfigMenu from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import EpisodeBrowser from "./EpisodeBrowser";
import EntityBrowser from "./EntityBrowser";
import AspectExplorer from "./AspectExplorer";
import LabelsManager from "./LabelsManager";
import IngestLogs from "./IngestLogs";
import ManualIngest from "./ManualIngest";
import PersonaPanel from "./PersonaPanel";
import RulesEditor from "./RulesEditor";
import MemorySettings from "./MemorySettings";
import { Eyebrow, MEMORY_ACCENT, fmtAgo, type LabelRow } from "./shared";

// ── MemoryView (SPEC-A A8.1) — the Memory V2 page shell ─────────────────────
// Tabs: Episodes | Entities | Aspects | Labels | Logs | Persona. Header stats
// strip from GET /api/v2/memory/stats (polled), ConfigMenu gear → MemorySettings.
// Labels are fetched once here and shared with EpisodeBrowser / LabelsManager /
// ManualIngest so the chips and pickers always agree.

type Tab = "episodes" | "entities" | "aspects" | "labels" | "logs" | "persona";

interface Stats {
  episodes: number;
  statements: number;
  entities: number;
  voiceAspects: number;
  labels: number;
  invalidated: number;
  queueDepth: number;
  lastIngestAt: string | null;
}

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "episodes", label: "Episodes", icon: <FileText size={13} /> },
  { key: "entities", label: "Entities", icon: <Boxes size={13} /> },
  { key: "aspects", label: "Aspects", icon: <Layers size={13} /> },
  { key: "labels", label: "Labels", icon: <Tag size={13} /> },
  { key: "logs", label: "Logs", icon: <ListOrdered size={13} /> },
  { key: "persona", label: "Persona", icon: <UserRound size={13} /> },
];

export default function MemoryView() {
  const [tab, setTab] = useState<Tab>("episodes");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [ingestOpen, setIngestOpen] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/memory/stats", { cache: "no-store" });
      const j = await r.json();
      if (typeof j?.episodes === "number") { setStats(j as Stats); setStatsFailed(false); }
    } catch { setStatsFailed(true); }
  }, []);

  const refreshLabels = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/memory/labels", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.labels)) setLabels(j.labels as LabelRow[]);
    } catch { /* offline */ }
  }, []);

  usePollWhileVisible(refreshStats, 5000, []);
  usePollWhileVisible(refreshLabels, 5000, []);

  const statCells: { label: string; value: number | string | null }[] = [
    { label: "episodes", value: stats?.episodes ?? null },
    { label: "statements", value: stats?.statements ?? null },
    { label: "entities", value: stats?.entities ?? null },
    { label: "voice", value: stats?.voiceAspects ?? null },
    { label: "labels", value: stats?.labels ?? null },
    { label: "invalidated", value: stats?.invalidated ?? null },
    { label: "queue", value: stats?.queueDepth ?? null },
  ];

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: `${MEMORY_ACCENT}14`, border: `1px solid ${MEMORY_ACCENT}44` }}>
            <Brain size={17} style={{ color: MEMORY_ACCENT }} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight leading-tight" style={{ color: "var(--fg, #e8e2f0)" }}>
              Memory
            </h1>
            <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {statsFailed && !stats
                ? "feed unreachable"
                : stats
                  ? `last ingest ${stats.lastIngestAt ? fmtAgo(stats.lastIngestAt) : "never"}`
                  : "loading…"}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setIngestOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition"
            style={{
              border: `1px solid ${ingestOpen ? MEMORY_ACCENT : `${MEMORY_ACCENT}55`}`,
              color: MEMORY_ACCENT,
              background: ingestOpen ? `${MEMORY_ACCENT}14` : "var(--panel, rgba(255,255,255,0.02))",
            }}
          >
            {ingestOpen ? <X size={13} /> : <Plus size={13} />} Add memory
          </button>
          <ConfigMenu title="Memory Settings" accent={MEMORY_ACCENT}>
            <MemorySettings />
          </ConfigMenu>
        </div>
      </div>

      {/* stats strip */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-4">
        {statCells.map((cell) => (
          <div key={cell.label} className="rounded-lg px-3 py-2"
            style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}>
            <Eyebrow>{cell.label}</Eyebrow>
            <div className="text-[17px] font-semibold tracking-tight leading-snug"
              style={{
                color: cell.value === null
                  ? "var(--fg-dimmer, #6b6478)"
                  : cell.label === "queue" && typeof cell.value === "number" && cell.value > 0
                    ? "#fbbf24"
                    : "var(--fg, #e8e2f0)",
              }}>
              {cell.value ?? "—"}
            </div>
          </div>
        ))}
      </div>

      {/* manual ingest drawer */}
      <AnimatePresence initial={false}>
        {ingestOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl p-4 mb-4"
              style={{ border: `1px solid ${MEMORY_ACCENT}33`, background: "var(--panel, rgba(255,255,255,0.02))" }}>
              <ManualIngest labels={labels} onQueued={() => { setTab("logs"); setIngestOpen(false); void refreshStats(); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="relative inline-flex items-center gap-1.5 px-3 h-9 text-[12.5px] font-medium whitespace-nowrap transition"
              style={{ color: active ? MEMORY_ACCENT : "var(--fg-dim, #9aa)" }}
            >
              {t.icon} {t.label}
              {t.key === "logs" && (stats?.queueDepth ?? 0) > 0 && (
                <span className="font-mono text-[9.5px] px-1 rounded" style={{ color: "#fbbf24", border: "1px solid #fbbf2444" }}>
                  {stats!.queueDepth}
                </span>
              )}
              {active && (
                <motion.span
                  layoutId="memory-tab-underline"
                  className="absolute left-1 right-1 -bottom-[1px] h-[2px] rounded-full"
                  style={{ background: MEMORY_ACCENT }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* tab body */}
      {tab === "episodes" && <EpisodeBrowser labels={labels} />}
      {tab === "entities" && <EntityBrowser />}
      {tab === "aspects" && <AspectExplorer />}
      {tab === "labels" && <LabelsManager labels={labels} onChanged={() => { void refreshLabels(); void refreshStats(); }} />}
      {tab === "logs" && (
        <div>
          <IngestLogs />
          <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
            <div className="mb-2"><Eyebrow>ingestion rules</Eyebrow></div>
            <RulesEditor />
          </div>
        </div>
      )}
      {tab === "persona" && <PersonaPanel />}
    </div>
  );
}
