"use client";

// SPEC-D G1 §6.1 — the AccountDetail Rules tab: user-rule CRUD over
// /accounts/[id]/rules. "Rules filter what gets remembered from this account"
// (§6.1 explainer). Advanced: include/exclude regex pre-filters (comma
// lists). DELETE deactivates — never destroys (house rule).

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { INTEGRATIONS_ACCENT, EmptyState, inputStyle, monoStyle, panelStyle, type RuleInfo } from "./shared";

export default function RulesTab({ accountId }: { accountId: string }) {
  const [rules, setRules] = useState<RuleInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${accountId}/rules`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && Array.isArray(j?.rules)) setRules(j.rules as RuleInfo[]);
    } catch {
      setRules([]);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const splitList = (s: string): string[] | undefined => {
    const items = s.split(",").map((x) => x.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  };

  const create = async () => {
    if (!text.trim()) {
      setError("rule text is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const preInclude = splitList(include);
      const preExclude = splitList(exclude);
      const res = await fetch(`/api/v2/integrations/accounts/${accountId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          text: text.trim(),
          ...(preInclude || preExclude
            ? { preFilter: { ...(preInclude ? { include: preInclude } : {}), ...(preExclude ? { exclude: preExclude } : {}) } }
            : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setName("");
      setText("");
      setInclude("");
      setExclude("");
      setFormOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (rule: RuleInfo) => {
    await fetch(`/api/v2/integrations/accounts/${accountId}/rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, isActive: !rule.isActive }),
    }).catch(() => {});
    refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Rules filter what gets remembered from this account — written as imperative filters
          (&quot;Only remember emails about invoices&quot;), enforced in the memory prompt AND by the
          optional regex pre-filters.
        </span>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="shrink-0 ml-3 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px] font-medium transition"
          style={{ border: `1px solid ${INTEGRATIONS_ACCENT}55`, color: INTEGRATIONS_ACCENT }}
        >
          <Plus size={12} /> Add rule
        </button>
      </div>

      {formOpen && (
        <div className="mb-3 rounded-xl p-3 flex flex-col gap-2" style={{ border: `1px solid ${INTEGRATIONS_ACCENT}44` }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="rounded-lg px-2.5 h-8 text-[12px] outline-none"
            style={inputStyle}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Rule text, e.g. "Only remember emails about invoices or contracts"'
            rows={2}
            className="rounded-lg px-2.5 py-2 text-[12px] outline-none resize-y"
            style={inputStyle}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={include}
              onChange={(e) => setInclude(e.target.value)}
              placeholder="include regex, comma-sep (advanced)"
              spellCheck={false}
              className="rounded-lg px-2.5 h-8 text-[11px] outline-none"
              style={{ ...inputStyle, ...monoStyle }}
            />
            <input
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              placeholder="exclude regex, comma-sep (advanced)"
              spellCheck={false}
              className="rounded-lg px-2.5 h-8 text-[11px] outline-none"
              style={{ ...inputStyle, ...monoStyle }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={create}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
              style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Save rule
            </button>
            {error && <span className="text-[11.5px]" style={{ color: "#f87171" }}>{error}</span>}
          </div>
        </div>
      )}

      {rules === null ? (
        <EmptyState title="Loading rules…" />
      ) : rules.length === 0 ? (
        <EmptyState title="No rules yet" hint="Everything synced from this account is offered to memory. Add a rule to narrow what gets remembered." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {rules.map((r) => (
            <div key={r.id} className="rounded-lg px-3 py-2 flex items-start gap-3" style={panelStyle}>
              <label className="mt-[2px] shrink-0 cursor-pointer" title={r.isActive ? "Deactivate" : "Activate"}>
                <input
                  type="checkbox"
                  checked={r.isActive}
                  onChange={() => toggleActive(r)}
                  style={{ accentColor: INTEGRATIONS_ACCENT }}
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="text-[12px]" style={{ color: r.isActive ? "var(--fg, #e8e2f0)" : "var(--fg-dimmer, #6b6478)" }}>
                  {r.name && <span className="font-medium mr-1.5">{r.name}:</span>}
                  {r.text}
                </div>
                {r.preFilter && (
                  <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {r.preFilter.include?.length ? `include: ${r.preFilter.include.join(", ")}` : ""}
                    {r.preFilter.include?.length && r.preFilter.exclude?.length ? " · " : ""}
                    {r.preFilter.exclude?.length ? `exclude: ${r.preFilter.exclude.join(", ")}` : ""}
                  </div>
                )}
              </div>
              {!r.isActive && (
                <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#9ca3af" }}>
                  inactive
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
