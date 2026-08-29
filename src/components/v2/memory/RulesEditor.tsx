"use client";

import { useCallback, useState } from "react";
import { Check, Loader2, Plus, ScrollText, X } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { EmptyState, MEMORY_ACCENT, inputStyle } from "./shared";

// ── RulesEditor (SPEC-A A8.4 / A2.8) ─────────────────────────────────────────
// ingestion_rules over /api/v2/memory/rules (GET / POST / PATCH). Free-text
// rules are injected into the normalize prompt for their source (blank source
// = every source). Rules are never deleted — deactivate instead.

interface Rule {
  id: string;
  name: string | null;
  text: string;
  source: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function RulesEditor() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftSource, setDraftSource] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "new" or rule id
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/memory/rules", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.rules)) { setRules(j.rules as Rule[]); setFailed(false); }
    } catch { setFailed(true); }
  }, []);

  usePollWhileVisible(refresh, 5000, []);

  async function addRule() {
    if (!draftText.trim()) { setErr("rule text is required"); return; }
    setBusy("new"); setErr(null);
    try {
      const r = await fetch("/api/v2/memory/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: draftText.trim(),
          name: draftName.trim() || null,
          source: draftSource.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error ?? `save failed (${r.status})`); return; }
      setAdding(false); setDraftText(""); setDraftName(""); setDraftSource("");
      await refresh();
    } catch { setErr("server unreachable"); }
    finally { setBusy(null); }
  }

  async function setActive(rule: Rule, isActive: boolean) {
    setBusy(rule.id); setErr(null);
    try {
      const r = await fetch("/api/v2/memory/rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rule.id, isActive }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j?.error ?? `update failed (${r.status})`); }
      await refresh();
    } catch { setErr("server unreachable"); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Plain-language rules injected into ingestion (e.g. “never remember anything about testing”). Never deleted — deactivate instead.
        </span>
        {!adding && (
          <button onClick={() => { setAdding(true); setErr(null); }}
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11.5px] font-medium shrink-0"
            style={{ border: `1px solid ${MEMORY_ACCENT}55`, color: MEMORY_ACCENT }}>
            <Plus size={12} /> New rule
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg p-3 mb-3" style={{ border: `1px solid ${MEMORY_ACCENT}44`, background: "var(--panel, rgba(255,255,255,0.02))" }}>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={2}
            placeholder="The rule, in plain language…"
            className="w-full rounded-md p-2 text-[12px] leading-relaxed outline-none resize-y mb-2"
            style={inputStyle}
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="name (optional)"
              className="h-7 w-[160px] rounded-md px-2 text-[11.5px] outline-none" style={inputStyle} />
            <input value={draftSource} onChange={(e) => setDraftSource(e.target.value)} placeholder="source (blank = all)"
              className="h-7 w-[160px] rounded-md px-2 text-[11.5px] outline-none" style={inputStyle} />
            <button onClick={addRule} disabled={busy === "new"}
              className="ml-auto inline-flex items-center gap-1 px-3 h-7 rounded-md text-[11.5px] font-semibold disabled:opacity-50"
              style={{ background: MEMORY_ACCENT, color: "#04222a" }}>
              {busy === "new" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Add
            </button>
            <button onClick={() => setAdding(false)} className="p-1.5 rounded-md"
              style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }} aria-label="Cancel">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {err && <div className="mb-2 text-[11px]" style={{ color: "#f87171" }}>{err}</div>}

      {rules === null ? (
        <EmptyState title={failed ? "Feed unreachable" : "Loading rules…"} />
      ) : rules.length === 0 && !adding ? (
        <EmptyState icon={<ScrollText size={20} />} title="No ingestion rules" hint="Rules steer or veto what gets remembered, per source or globally." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-start gap-3 rounded-lg px-3 py-2"
              style={{
                border: "1px solid var(--panel-border, #2a2436)",
                background: "var(--panel, rgba(255,255,255,0.02))",
                opacity: rule.isActive ? 1 : 0.55,
              }}>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] leading-relaxed" style={{ color: "var(--fg, #e8e2f0)" }}>{rule.text}</div>
                <div className="font-mono text-[9.5px] mt-0.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {rule.name ? `${rule.name} · ` : ""}{rule.source ?? "all sources"}
                </div>
              </div>
              <label className="inline-flex items-center gap-1.5 text-[10.5px] cursor-pointer select-none shrink-0 mt-0.5"
                style={{ color: "var(--fg-dim, #9aa)" }}>
                <input type="checkbox" checked={rule.isActive} disabled={busy === rule.id}
                  onChange={(e) => void setActive(rule, e.target.checked)}
                  style={{ accentColor: MEMORY_ACCENT }} />
                active
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
