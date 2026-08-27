"use client";

// SPEC-C D3.2 — Spec tab: edits the package's Spec-shaped metadata
// (webmcp_packages.spec_json, migration 032) — auth kind, schedule cron,
// mcp type, and the ${config:*} manifest (name/description/required per
// placeholder) consumed by D5 client-mode exports. Saved via
// PATCH /api/v2/webmcp/packages/[slug] { spec } (loud 400 on schema mismatch).

import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import type { SpecAuthKind, SpecConfigField, SpecMcpType, WebmcpSpec } from "@/lib/v2/webmcp/types";
import { WEBMCP_ACCENT, Eyebrow, inputStyle, monoStyle } from "./shared";

const AUTH_KINDS: { value: SpecAuthKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "api_key", label: "API key" },
  { value: "oauth2", label: "OAuth2" },
  { value: "mcp", label: "Remote MCP" },
];

const MCP_TYPES: { value: SpecMcpType; label: string }[] = [
  { value: "stdio", label: "stdio (CLI export)" },
  { value: "http", label: "http" },
];

interface ManifestRow extends SpecConfigField {
  _key: number;
}

let rowKey = 0;

function toRows(spec: WebmcpSpec | null | undefined): ManifestRow[] {
  return (spec?.configManifest ?? []).map((f) => ({ ...f, _key: ++rowKey }));
}

export default function SpecForm({
  slug,
  spec,
  readOnly,
  onChanged,
}: {
  slug: string;
  spec: WebmcpSpec | null | undefined;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [authKind, setAuthKind] = useState<SpecAuthKind>(spec?.authKind ?? "none");
  const [frequency, setFrequency] = useState(spec?.schedule?.frequency ?? "");
  const [mcpType, setMcpType] = useState<SpecMcpType>(spec?.mcpType ?? "stdio");
  const [rows, setRows] = useState<ManifestRow[]>(() => toRows(spec));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-seed the form when the package (or its server-side spec) changes and
  // the user has no unsaved edits.
  useEffect(() => {
    if (dirty) return;
    setAuthKind(spec?.authKind ?? "none");
    setFrequency(spec?.schedule?.frequency ?? "");
    setMcpType(spec?.mcpType ?? "stdio");
    setRows(toRows(spec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, JSON.stringify(spec ?? null)]);

  const touch = () => {
    setDirty(true);
    setSavedAt(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const next: WebmcpSpec = {
      authKind,
      mcpType,
      ...(frequency.trim() ? { schedule: { frequency: frequency.trim() } } : {}),
      ...(rows.length
        ? {
            configManifest: rows.map((r) => ({
              name: r.name.trim(),
              ...(r.description?.trim() ? { description: r.description.trim() } : {}),
              ...(r.required ? { required: true } : {}),
            })),
          }
        : {}),
    };
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setDirty(false);
      setSavedAt(Date.now());
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none" };

  return (
    <div className="flex flex-col gap-4 max-w-[640px]">
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Auth kind</Eyebrow>
          <select
            value={authKind}
            onChange={(e) => {
              setAuthKind(e.target.value as SpecAuthKind);
              touch();
            }}
            disabled={readOnly}
            className="rounded-lg px-2.5 h-8 text-[12px] outline-none"
            style={selectStyle}
          >
            {AUTH_KINDS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>MCP type</Eyebrow>
          <select
            value={mcpType}
            onChange={(e) => {
              setMcpType(e.target.value as SpecMcpType);
              touch();
            }}
            disabled={readOnly}
            className="rounded-lg px-2.5 h-8 text-[12px] outline-none"
            style={selectStyle}
          >
            {MCP_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <Eyebrow>Schedule (cron frequency, optional)</Eyebrow>
        <input
          value={frequency}
          onChange={(e) => {
            setFrequency(e.target.value);
            touch();
          }}
          disabled={readOnly}
          placeholder="*/15 * * * *"
          spellCheck={false}
          className="rounded-lg px-2.5 h-8 text-[12px] outline-none w-[240px]"
          style={{ ...inputStyle, ...monoStyle }}
        />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Eyebrow>Config manifest (client-mode exports)</Eyebrow>
          {!readOnly && (
            <button
              onClick={() => {
                setRows((r) => [...r, { name: "", description: "", required: true, _key: ++rowKey }]);
                touch();
              }}
              className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[10.5px] font-medium transition"
              style={{ border: `1px solid ${WEBMCP_ACCENT}55`, color: WEBMCP_ACCENT }}
            >
              <Plus size={11} /> Add field
            </button>
          )}
        </div>
        <div className="text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Each field becomes a <span style={monoStyle}>{"${config:NAME}"}</span> placeholder in client-mode
          exports; secret names referenced by handlers are added automatically at export time.
        </div>
        {rows.length === 0 && (
          <div className="text-[11.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>
            No declared config fields.
          </div>
        )}
        {rows.map((row, i) => (
          <div key={row._key} className="flex items-center gap-2">
            <input
              value={row.name}
              onChange={(e) => {
                const v = e.target.value;
                setRows((r) => r.map((x, xi) => (xi === i ? { ...x, name: v } : x)));
                touch();
              }}
              disabled={readOnly}
              placeholder="NAME"
              spellCheck={false}
              className="rounded-lg px-2.5 h-8 text-[12px] outline-none w-[170px]"
              style={{ ...inputStyle, ...monoStyle }}
            />
            <input
              value={row.description ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setRows((r) => r.map((x, xi) => (xi === i ? { ...x, description: v } : x)));
                touch();
              }}
              disabled={readOnly}
              placeholder="Description"
              className="rounded-lg px-2.5 h-8 text-[12px] outline-none flex-1 min-w-0"
              style={inputStyle}
            />
            <label
              className="inline-flex items-center gap-1.5 text-[11px] shrink-0"
              style={{ color: "var(--fg-dim, #9aa)" }}
            >
              <input
                type="checkbox"
                checked={row.required ?? false}
                onChange={(e) => {
                  const v = e.target.checked;
                  setRows((r) => r.map((x, xi) => (xi === i ? { ...x, required: v } : x)));
                  touch();
                }}
                disabled={readOnly}
              />
              required
            </label>
            {!readOnly && (
              <button
                onClick={() => {
                  setRows((r) => r.filter((_, xi) => xi !== i));
                  touch();
                }}
                title="Remove field"
                className="grid h-7 w-7 place-items-center rounded-md transition shrink-0"
                style={{ border: "1px solid #f8717155", color: "#f87171" }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || readOnly || !dirty}
          className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
          style={{ border: `1px solid ${WEBMCP_ACCENT}66`, background: `${WEBMCP_ACCENT}18`, color: WEBMCP_ACCENT }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save spec
        </button>
        {savedAt && !dirty && (
          <span className="text-[11px]" style={{ color: "#34d399" }}>
            Saved ✓
          </span>
        )}
        {error && <span className="text-[11.5px]" style={{ color: "#f87171" }}>{error}</span>}
      </div>
      <div className="text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        The spec is frozen into the snapshot on publish — exports read the published spec, not this draft.
      </div>
    </div>
  );
}
