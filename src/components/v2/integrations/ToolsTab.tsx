"use client";

// SPEC-D G1 §6.1 — the AccountDetail Tools tab: searchable tool list from
// GET /accounts/[id]/tools, expandable JSON Schema, [Try] → args auto-form
// (TestRunner pattern) → POST /accounts/[id]/call.
//
// Destructive gate (chunk-3 brief): destructiveHint-annotated tools show an
// inline CONFIRM step before invoking — nothing is sent until the user
// explicitly confirms. This is the lightweight stand-in for G4.3's two-phase
// EmailToolUi/DestructiveToolGate (next chunk); the seam is exactly here:
// replace the inline confirm block with <DestructiveToolGate> when it lands.

import { useEffect, useMemo, useState } from "react";
import { Play, Loader2, Search, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import { INTEGRATIONS_ACCENT, EmptyState, inputStyle, monoStyle, type ToolInfo } from "./shared";

interface PropSpec {
  name: string;
  type: string;
  description?: string;
  enum?: string[];
  required: boolean;
}

function propsOf(tool: ToolInfo): PropSpec[] | null {
  const schema = tool.inputSchema ?? {};
  const props = (schema as Record<string, unknown>).properties;
  if (props === undefined) return [];
  if (typeof props !== "object" || props === null || Array.isArray(props)) return null;
  const required = new Set(
    Array.isArray((schema as Record<string, unknown>).required)
      ? ((schema as Record<string, unknown>).required as string[])
      : [],
  );
  const out: PropSpec[] = [];
  for (const [name, raw] of Object.entries(props as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    const t = typeof p.type === "string" ? p.type : "unknown";
    if (!["string", "number", "integer", "boolean"].includes(t)) return null; // arrays/objects → raw mode
    out.push({
      name,
      type: t,
      description: typeof p.description === "string" ? p.description : undefined,
      enum: Array.isArray(p.enum) && p.enum.every((v) => typeof v === "string") ? (p.enum as string[]) : undefined,
      required: required.has(name),
    });
  }
  return out;
}

interface CallResult {
  result: { text: string; isError?: boolean };
  durationMs: number;
}

export default function ToolsTab({ accountId }: { accountId: string }) {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [rawMode, setRawMode] = useState(false);
  const [rawArgs, setRawArgs] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Destructive gate: args are staged here, the call fires only on Confirm.
  const [pendingConfirm, setPendingConfirm] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`/api/v2/integrations/accounts/${accountId}/tools`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTools(Array.isArray(j?.tools) ? (j.tools as ToolInfo[]) : []))
      .catch(() => setTools([]));
  }, [accountId]);

  const filtered = useMemo(
    () =>
      (tools ?? []).filter(
        (t) =>
          !query ||
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.description.toLowerCase().includes(query.toLowerCase()),
      ),
    [tools, query],
  );

  const tool = (tools ?? []).find((t) => t.name === selected) ?? null;
  const props = useMemo(() => (tool ? propsOf(tool) : []), [tool]);
  const formUsable = props !== null;
  const destructive = tool?.annotations?.destructiveHint === true;

  const buildArgs = (): Record<string, unknown> | string => {
    if (rawMode || !formUsable) {
      try {
        const v = JSON.parse(rawArgs);
        if (typeof v !== "object" || v === null || Array.isArray(v)) return "args must be a JSON object";
        return v as Record<string, unknown>;
      } catch {
        return "args are not valid JSON";
      }
    }
    const args: Record<string, unknown> = {};
    for (const p of props ?? []) {
      const raw = fieldValues[p.name];
      if (raw === undefined || raw === "") {
        if (p.required && p.type !== "boolean") return `'${p.name}' is required`;
        if (p.type === "boolean" && p.required) args[p.name] = false;
        continue;
      }
      if (p.type === "number" || p.type === "integer") {
        const n = Number(raw);
        if (!Number.isFinite(n)) return `'${p.name}' must be a number`;
        args[p.name] = p.type === "integer" ? Math.round(n) : n;
      } else if (p.type === "boolean") {
        args[p.name] = raw === "true";
      } else {
        args[p.name] = raw;
      }
    }
    return args;
  };

  const invoke = async (args: Record<string, unknown>) => {
    if (!tool) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${accountId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.name, args, source: "ui" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setResult(j as CallResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setPendingConfirm(null);
    }
  };

  const tryTool = () => {
    const args = buildArgs();
    if (typeof args === "string") {
      setError(args);
      return;
    }
    setError(null);
    if (destructive) {
      // Destructive-annotated → confirm step BEFORE any call leaves the browser.
      setPendingConfirm(args);
      return;
    }
    void invoke(args);
  };

  if (tools === null) return <EmptyState title="Loading tools…" />;
  if (tools.length === 0) return <EmptyState title="This connector advertises no tools" />;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "240px 1fr" }}>
      <div className="min-w-0">
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--fg-dimmer, #6b6478)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tools…"
            className="w-full rounded-lg pl-7 pr-2.5 h-8 text-[12px] outline-none"
            style={inputStyle}
          />
        </div>
        <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto">
          {filtered.map((t) => (
            <button
              key={t.name}
              onClick={() => {
                setSelected(t.name);
                setResult(null);
                setError(null);
                setFieldValues({});
                setRawMode(false);
                setRawArgs("{}");
                setPendingConfirm(null);
                setSchemaOpen(false);
              }}
              className="text-left rounded-lg px-2.5 py-2 transition min-w-0"
              style={{
                border: `1px solid ${selected === t.name ? INTEGRATIONS_ACCENT : "var(--panel-border, #2a2436)"}`,
                background: selected === t.name ? `${INTEGRATIONS_ACCENT}0f` : "var(--panel, rgba(255,255,255,0.02))",
              }}
            >
              <span className="font-mono text-[11.5px] block truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{t.name}</span>
              <div className="mt-1 flex items-center gap-1.5">
                {t.annotations?.readOnlyHint && (
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#60a5fa" }}>read</span>
                )}
                {t.annotations?.destructiveHint && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#fbbf24" }}>
                    <ShieldAlert size={9} /> destructive
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {!tool ? (
        <EmptyState title="Pick a tool" hint="[Try] builds args from the tool's input schema and invokes it on this account. Destructive tools ask for confirmation first." />
      ) : (
        <div className="min-w-0">
          <div className="text-[11.5px] leading-relaxed mb-2 whitespace-pre-wrap max-h-[140px] overflow-y-auto" style={{ color: "var(--fg-dim, #9aa)" }}>
            {tool.description || "(no description)"}
          </div>

          <button
            onClick={() => setSchemaOpen((v) => !v)}
            className="mb-2 inline-flex items-center gap-1 text-[10.5px] font-mono"
            style={{ color: INTEGRATIONS_ACCENT }}
          >
            {schemaOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} input schema
          </button>
          {schemaOpen && (
            <pre
              className="mb-3 rounded-lg p-2.5 text-[10.5px] max-h-[200px] overflow-auto"
              style={{ ...inputStyle, ...monoStyle, color: "var(--fg-dim, #9aa)" }}
            >
              {JSON.stringify(tool.inputSchema, null, 2)}
            </pre>
          )}

          {formUsable && (props ?? []).length > 0 && !rawMode ? (
            <div className="flex flex-col gap-2.5">
              {(props ?? []).map((p) => (
                <div key={p.name}>
                  <span className="block mb-1 font-mono text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
                    {p.name}
                    {p.required && <span style={{ color: "#fbbf24" }}> *</span>}
                    {p.description && <span className="ml-2 font-sans text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{p.description}</span>}
                  </span>
                  {p.enum ? (
                    <select
                      value={fieldValues[p.name] ?? ""}
                      onChange={(e) => setFieldValues((v) => ({ ...v, [p.name]: e.target.value }))}
                      className="w-full rounded-lg px-2 h-8 text-[12.5px] outline-none"
                      style={inputStyle}
                    >
                      <option value="">—</option>
                      {p.enum.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : p.type === "boolean" ? (
                    <select
                      value={fieldValues[p.name] ?? ""}
                      onChange={(e) => setFieldValues((v) => ({ ...v, [p.name]: e.target.value }))}
                      className="w-full rounded-lg px-2 h-8 text-[12.5px] outline-none"
                      style={inputStyle}
                    >
                      <option value="">—</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      value={fieldValues[p.name] ?? ""}
                      onChange={(e) => setFieldValues((v) => ({ ...v, [p.name]: e.target.value }))}
                      className="w-full rounded-lg px-2.5 h-8 text-[12.5px] outline-none"
                      style={{ ...inputStyle, ...(p.type === "string" ? {} : monoStyle) }}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <span className="block mb-1 text-[11px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>
                Args (JSON object{formUsable ? "" : " — schema too complex for the auto-form"})
              </span>
              <textarea
                value={rawArgs}
                onChange={(e) => setRawArgs(e.target.value)}
                rows={5}
                spellCheck={false}
                className="w-full rounded-lg px-2.5 py-2 text-[11.5px] outline-none resize-y"
                style={{ ...inputStyle, ...monoStyle }}
              />
            </div>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={tryTool}
              disabled={running || pendingConfirm !== null}
              className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
              style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Try
            </button>
            {formUsable && (props ?? []).length > 0 && (
              <button
                onClick={() => setRawMode((m) => !m)}
                className="text-[10.5px] font-mono underline decoration-dotted"
                style={{ color: INTEGRATIONS_ACCENT }}
              >
                {rawMode ? "→ form" : "→ raw JSON"}
              </button>
            )}
            {error && <span className="text-[11.5px]" style={{ color: "#f87171" }}>{error}</span>}
          </div>

          {/* Destructive confirm step — the G4.3 DestructiveToolGate seam. */}
          {pendingConfirm !== null && (
            <div className="mt-3 rounded-xl p-3" style={{ border: "1px solid #fbbf2466", background: "#fbbf240d" }}>
              <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-semibold" style={{ color: "#fbbf24" }}>
                <ShieldAlert size={13} /> This tool is destructive — confirm to run
              </div>
              <pre className="text-[10.5px] max-h-[140px] overflow-auto mb-2" style={{ ...monoStyle, color: "var(--fg-dim, #9aa)" }}>
                {JSON.stringify(pendingConfirm, null, 2)}
              </pre>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void invoke(pendingConfirm)}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
                  style={{ border: "1px solid #fbbf2466", background: "#fbbf2418", color: "#fbbf24" }}
                >
                  {running ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />} Confirm &amp; run
                </button>
                <button
                  onClick={() => setPendingConfirm(null)}
                  className="px-3 h-8 rounded-lg text-[12px] transition"
                  style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-xl p-3" style={{ border: `1px solid ${result.result.isError ? "#f8717144" : "#34d39944"}` }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: result.result.isError ? "#f87171" : "#34d399" }}>
                  {result.result.isError ? "error" : "ok"}
                </span>
                <span className="font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{result.durationMs}ms</span>
              </div>
              <pre className="text-[11.5px] whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto" style={{ ...monoStyle, color: result.result.isError ? "#f87171" : "var(--fg, #e8e2f0)" }}>
                {result.result.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
