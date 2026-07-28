"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";

// Client brief editor for the Audit Console — same behavior as the standalone console's
// Intake.tsx: fields render from the engine's BRIEF_FIELDS (served by /api/audit/intake),
// save never blocks, and the run-gate verdict (missing / vague) is shown honestly.

interface BriefField { label: string; required: boolean; note?: string }
interface IntakeCheck { ok: boolean; missing: string[]; vague: string[] }

const STRUCTURED = new Set(["funnel_metrics", "channel_history"]);
const LISTS = new Set(["known_competitors", "martech_stack", "active_channels", "analytics_access"]);
const TALL = new Set(["ideal_customer", "campaign_objective"]);
const OPTIONAL_MODULES = ["1A", "3A", "3B"] as const;

const toText = (key: string, v: unknown): string => {
  if (v == null) return "";
  if (STRUCTURED.has(key)) return typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
  if (Array.isArray(v)) return v.join("\n");
  return String(v);
};

const fromText = (key: string, s: string): unknown => {
  const t = s.trim();
  if (STRUCTURED.has(key)) {
    if (!t) return "";
    try { return JSON.parse(t); } catch { return t; }   // saved as text; validation flags it vague
  }
  if (LISTS.has(key)) return t ? t.split("\n").map((x) => x.trim()).filter(Boolean) : [];
  return t;
};

export default function AuditBrief({ slug, onClose }: { slug: string; onClose: (saved: boolean) => void }) {
  const [fields, setFields] = useState<Record<string, BriefField> | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<{ audit_passes: string; optional_modules: string[] }>({ audit_passes: "", optional_modules: [] });
  const [check, setCheck] = useState<IntakeCheck | null>(null);
  const [jsonErr, setJsonErr] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch(`/api/audit/intake?slug=${encodeURIComponent(slug)}`)).json() as {
          ok: boolean; error?: string; intake?: Record<string, unknown>; check?: IntakeCheck; fields?: Record<string, BriefField>;
        };
        if (!j.ok || !j.fields) { setErr(j.error || "Could not load the brief"); return; }
        setFields(j.fields);
        const t: Record<string, string> = {};
        for (const key of Object.keys(j.fields)) t[key] = toText(key, j.intake?.[key]);
        setText(t);
        setExtra({
          audit_passes: j.intake?.audit_passes ? String(j.intake.audit_passes) : "",
          optional_modules: Array.isArray(j.intake?.optional_modules) ? j.intake.optional_modules as string[] : [],
        });
        setCheck(j.check ?? null);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [slug]);

  function edit(key: string, value: string) {
    setText((t) => ({ ...t, [key]: value }));
    if (STRUCTURED.has(key)) {
      let bad = false;
      if (value.trim()) { try { JSON.parse(value); } catch { bad = true; } }
      setJsonErr((j) => ({ ...j, [key]: bad }));
    }
  }

  async function save() {
    if (!fields) return;
    setBusy(true); setErr("");
    try {
      const intake: Record<string, unknown> = {};
      for (const key of Object.keys(fields)) intake[key] = fromText(key, text[key] ?? "");
      const passes = parseInt(extra.audit_passes, 10);
      if (Number.isInteger(passes) && passes >= 1) intake.audit_passes = passes;
      intake.optional_modules = extra.optional_modules;
      const j = await (await fetch("/api/audit/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, intake }),
      })).json() as { ok: boolean; error?: string; check?: IntakeCheck };
      if (!j.ok) setErr(j.error || "Save failed");
      else { setCheck(j.check ?? null); setSavedOnce(true); }
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  if (err && !fields) return <div className="panel p-4 text-[13px]" style={{ color: "#f87171" }}>{err}</div>;
  if (!fields) return <div className="flex items-center gap-2 text-white/50 text-[13px]"><Loader2 size={14} className="animate-spin" /> Loading the brief…</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => onClose(savedOnce)}
          className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md border border-white/10 text-white/60 hover:text-white/90 transition">
          <ArrowLeft size={12} /> Back
        </button>
        <span className="font-medium text-[14px]">Client brief · <span className="font-mono text-white/50">{slug}</span></span>
        <button disabled={busy} onClick={() => void save()}
          className="ml-auto inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition disabled:opacity-40">
          <Save size={12} /> {busy ? "Saving…" : "Save brief"}
        </button>
      </div>

      {check && (
        <div className="panel p-3 mb-4 text-[13px]">
          {check.ok ? (
            <span style={{ color: "#34d399" }}>Brief is complete. Ready to run.</span>
          ) : (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Not ready yet — the run gate will hold</div>
              {check.missing.length > 0 && <div className="text-white/70">Missing: <span className="font-mono text-white/40">{check.missing.join(", ")}</span></div>}
              {check.vague.length > 0 && <div className="text-white/70">Placeholder text: <span className="font-mono text-white/40">{check.vague.join(", ")}</span></div>}
            </div>
          )}
        </div>
      )}
      {err && <div className="panel p-3 mb-4 text-[13px]" style={{ color: "#f87171" }}>{err}</div>}

      <div className="grid gap-3">
        {Object.entries(fields).map(([key, f]) => {
          const flagged = check ? check.missing.includes(key) || check.vague.includes(key) : false;
          return (
            <div className="panel p-3" key={key} style={flagged ? { borderColor: "rgba(251,191,36,0.5)" } : undefined}>
              <div className="text-[10px] uppercase tracking-wider mb-1"
                style={{ color: flagged ? "#fbbf24" : "rgba(255,255,255,0.4)" }}>
                {f.label}{f.required ? "" : " · optional"}
              </div>
              {f.note && <p className="text-[11px] text-white/35 mb-2 mt-0">{f.note}</p>}
              <textarea
                value={text[key] ?? ""}
                onChange={(e) => edit(key, e.target.value)}
                rows={STRUCTURED.has(key) ? 7 : LISTS.has(key) ? 3 : TALL.has(key) ? 4 : 2}
                spellCheck={false}
                className="w-full bg-black/30 rounded px-3 py-2 text-[13px] outline-none resize-y"
                style={{ border: `1px solid ${jsonErr[key] ? "rgba(248,113,113,0.6)" : "rgba(255,255,255,0.1)"}`, color: "inherit", font: "inherit" }}
              />
              {STRUCTURED.has(key) && (
                <p className="text-[10px] mt-1 mb-0" style={{ color: jsonErr[key] ? "#f87171" : "rgba(255,255,255,0.3)" }}>
                  {jsonErr[key] ? "Not valid JSON yet — it will save as text and be flagged." : "JSON. The agents read this as structured data."}
                </p>
              )}
              {LISTS.has(key) && <p className="text-[10px] text-white/30 mt-1 mb-0">One per line.</p>}
            </div>
          );
        })}
      </div>

      <div className="panel p-3 mt-3">
        <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Run defaults · optional</div>
        <div className="flex items-center gap-3 flex-wrap text-[13px]">
          <span className="text-white/60">Ensemble passes</span>
          <input type="number" min={1} max={6} value={extra.audit_passes} placeholder="3"
            onChange={(e) => setExtra((x) => ({ ...x, audit_passes: e.target.value }))}
            className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 outline-none focus:border-emerald-500/60" />
          <span className="text-white/60 ml-2">Optional modules</span>
          {OPTIONAL_MODULES.map((m) => (
            <label key={m} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={extra.optional_modules.includes(m)}
                onChange={(e) => setExtra((x) => ({
                  ...x,
                  optional_modules: e.target.checked ? [...x.optional_modules, m] : x.optional_modules.filter((v) => v !== m),
                }))} />
              {m}
            </label>
          ))}
          <span className="text-[11px] text-white/35">1A lead harvest · 3A deployment · 3B creative</span>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button disabled={busy} onClick={() => void save()}
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition disabled:opacity-40">
          <Save size={12} /> {busy ? "Saving…" : "Save brief"}
        </button>
        <button onClick={() => onClose(savedOnce)}
          className="text-[12px] px-3 py-1.5 rounded-md border border-white/10 text-white/60 hover:text-white/90 transition">
          Done
        </button>
      </div>
    </div>
  );
}
