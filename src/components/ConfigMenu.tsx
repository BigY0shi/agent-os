"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Settings as Gear, X, Check, Loader2 } from "lucide-react";

// Minimal client mirror of lib/settings.ts Settings — kept loose so modules can read/write
// any subtree without this file having to know every field.
export type Settings = Record<string, unknown> & {
  defaultAgent?: string;
  loop?: { builder?: string; judge?: string; judgeFallback?: "none" | "ollama-cloud"; ollamaModel?: string; maxRounds?: number; builderTimeoutSec?: number; judgeTimeoutSec?: number };
  seo?: { sites?: Array<{ label: string; url: string; deployCmd?: string; dir?: string }>; brand?: string; author?: string; audience?: string; agent?: string };
  leads?: { agent?: string; dataProvider?: "ai" | "agent" | "tavily" | "perplexity" | "firecrawl" | "apify"; tavilyKey?: string; perplexityKey?: string; firecrawlKey?: string; apifyToken?: string; apifyActor?: string };
  video?: { backend?: "eidolon" | "cli"; eidolonUrl?: string; comfyUrl?: string; model?: "ltx" | "wan"; agent?: string };
  music?: { backend?: "key" | "cookie"; sunoApiKey?: string; sunoCookie?: string; sunoBaseUrl?: string };
  opendesign?: { webUrl?: string; daemonUrl?: string; launchCmd?: string; stopCmd?: string; installPath?: string };
  paperclip?: { url?: string };
  games?: { agent?: string };
  thumbnails?: { agent?: string; backend?: "cli" | "gpt-image" };
  notebook?: { agent?: string; nlmBin?: string; notebookId?: string };
  kanban?: { agent?: string; board?: string };
  pipeline?: { provider?: "ollama" | "cli" | "minimax"; model?: string; ollamaUrl?: string; agent?: string; minimaxKey?: string };
};

// Shared settings hook. `save(patch)` deep-merges server-side and returns the merged result.
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const j = await r.json();
      if (j?.settings) setSettings(j.settings as Settings);
    } catch { /* offline */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (patch: Partial<Settings>) => {
    setSaving(true);
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (j?.settings) { setSettings(j.settings as Settings); return j.settings as Settings; }
    } catch { /* offline */ } finally { setSaving(false); }
    return null;
  }, []);

  return { settings, loading, saving, save, reload };
}

interface ConfigMenuProps {
  title?: string;
  accent?: string;
  /** Render-prop body. Gets the current settings + a saver; render your fields. */
  children: ReactNode;
  /** Optional label next to the gear. */
  buttonLabel?: string;
}

// A small gear button that opens a right-side slide-over. The module supplies the fields
// as children (typically driven by useSettings()). This is the reusable "config menu" shell.
export default function ConfigMenu({ title = "Settings", accent = "#2dd4bf", children, buttonLabel }: ConfigMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={title}
        className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition"
        style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))", color: "var(--fg-dim, #9aa)" }}
      >
        <Gear size={14} style={{ color: accent }} /> {buttonLabel ?? "Configure"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div ref={ref} className="relative h-full w-full max-w-[420px] overflow-y-auto p-5 shadow-2xl"
            style={{ background: "var(--bg, #0b0713)", borderLeft: `1px solid ${accent}55` }}>
            <div className="flex items-center justify-between mb-4">
              <div className="inline-flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
                <Gear size={15} style={{ color: accent }} /> {title}
              </div>
              <button onClick={() => setOpen(false)} className="text-[var(--fg-dimmer,#6b6478)] hover:text-[var(--fg,#e8e2f0)]"><X size={16} /></button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

// Small presentational helpers modules can use inside a ConfigMenu for consistency.
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block mb-3.5">
      <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--fg, #e8e2f0)" }}>{label}</span>
      {hint && <span className="block text-[10.5px] mb-1.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{hint}</span>}
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none ${props.className ?? ""}`}
      style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)", ...(props.style || {}) }}
    />
  );
}

export function SaveBar({ saving, saved, onSave, accent = "#2dd4bf" }: { saving: boolean; saved: boolean; onSave: () => void; accent?: string }) {
  return (
    <button onClick={onSave} disabled={saving}
      className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-[13px] font-semibold disabled:opacity-50 mt-1"
      style={{ background: accent, color: "#04221c" }}>
      {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
      {saving ? "Saving…" : saved ? "Saved" : "Save"}
    </button>
  );
}
