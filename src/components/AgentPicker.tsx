"use client";

import { useEffect, useState } from "react";

export interface AgentEntry {
  id: string;
  label: string;
  kind: "cli" | "http" | "local";
  installed: boolean;
  note?: string;
}

// Shared source of truth for every "pick an agent" dropdown across the Self modules.
export function useInstalledAgents() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/agents/list", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive) setAgents(Array.isArray(j.agents) ? j.agents : []); })
      .catch(() => { /* offline */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { agents, loading, installed: agents.filter((a) => a.installed) };
}

interface AgentPickerProps {
  value: string;
  onChange: (id: string) => void;
  /** Restrict to these kinds (default: all). e.g. ["cli"] to hide Ollama Cloud. */
  kinds?: Array<"cli" | "http" | "local">;
  /** Restrict to specific agent ids. */
  includeIds?: string[];
  /** Only show agents detected on this machine (default true). */
  onlyInstalled?: boolean;
  /** Extra non-agent options shown first, e.g. {id:"local",label:"Local · offline"}. */
  extraOptions?: Array<{ id: string; label: string }>;
  disabled?: boolean;
  className?: string;
  label?: string;
  accent?: string;
}

// A styled <select> of the user's CLI agents. Same look/feel as the existing module selects.
export default function AgentPicker({
  value, onChange, kinds, includeIds, onlyInstalled = true, extraOptions = [], disabled, className, label, accent = "#2dd4bf",
}: AgentPickerProps) {
  const { agents, loading } = useInstalledAgents();
  const shown = agents.filter((a) => (!kinds || kinds.includes(a.kind)) && (!includeIds || includeIds.includes(a.id)) && (!onlyInstalled || a.installed));

  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {label && <span className="text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        className="text-[12.5px] rounded-md px-2.5 py-1.5 outline-none max-w-[260px]"
        style={{ background: "var(--bg, #0b0713)", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" }}
        title={loading ? "Loading agents…" : "Pick one of your CLI agents"}
      >
        {extraOptions.length > 0 && (
          <optgroup label="Options">
            {extraOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </optgroup>
        )}
        <optgroup label="Your CLI agents — no API key">
          {shown.length === 0 && <option value="" disabled>{loading ? "Loading…" : "No agents detected"}</option>}
          {shown.map((a) => (
            <option key={a.id} value={a.id}>{a.label}{a.kind === "http" ? " (cloud)" : ""}</option>
          ))}
        </optgroup>
        {/* keep a stale saved value visible even if not currently installed */}
        {value && ![...extraOptions.map((o) => o.id), ...shown.map((a) => a.id)].includes(value) && (
          <option value={value}>{value} (not detected)</option>
        )}
      </select>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: accent, opacity: 0.0 }} />
    </div>
  );
}
