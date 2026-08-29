"use client";

// SPEC-C D3 — Secrets panel: names + "configured ✓" ONLY. Values are written
// via PUT { name, value } to ~/.agentic-os/webmcp/<slug>.secrets.json and
// NEVER round-trip to the client — the input clears on save and nothing here
// ever renders a stored value.

import { useState } from "react";
import { Check, KeyRound, Loader2, Plus } from "lucide-react";
import { WEBMCP_ACCENT, inputStyle, monoStyle } from "./shared";

export default function SecretsPanel({
  slug,
  secretNames,
  onChanged,
}: {
  slug: string;
  secretNames: string[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const put = async () => {
    const n = name.trim();
    if (!n || !value) {
      setError("both name and value are required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${slug}/secrets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, value }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setValue(""); // the value never lingers client-side
      setName("");
      setSavedName(n);
      setTimeout(() => setSavedName(null), 2500);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="text-[11px] leading-relaxed mb-3" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Referenced from http handlers as <span style={monoStyle}>{"{{secret:NAME}}"}</span> and resolved
        server-side at call time. Values live only in{" "}
        <span style={monoStyle}>~/.agentic-os/webmcp/{slug}.secrets.json</span> — never in the DB, never in
        API responses, redacted out of call logs.
      </div>

      {secretNames.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {secretNames.map((n) => (
            <div
              key={n}
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
            >
              <KeyRound size={12} style={{ color: WEBMCP_ACCENT }} />
              <span className="font-mono text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>{n}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: "#34d399" }}>
                <Check size={12} /> configured
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1.4fr auto" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="SECRET_NAME"
          spellCheck={false}
          className="rounded-lg px-2.5 h-8 text-[12px] outline-none"
          style={{ ...inputStyle, ...monoStyle }}
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type="password"
          placeholder="value (write-only — never shown again)"
          autoComplete="off"
          className="rounded-lg px-2.5 h-8 text-[12px] outline-none"
          style={inputStyle}
        />
        <button
          onClick={put}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
          style={{ border: `1px solid ${WEBMCP_ACCENT}66`, background: `${WEBMCP_ACCENT}18`, color: WEBMCP_ACCENT }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Set
        </button>
      </div>
      {error && <div className="mt-2 text-[11.5px]" style={{ color: "#f87171" }}>{error}</div>}
      {savedName && (
        <div className="mt-2 text-[11.5px]" style={{ color: "#34d399" }}>
          &apos;{savedName}&apos; configured ✓ (value stored server-side only)
        </div>
      )}
    </div>
  );
}
