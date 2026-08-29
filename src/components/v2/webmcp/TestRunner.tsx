"use client";

// SPEC-C D3.4 — the Test tab: pick a tool, fill args (auto-form from the
// input schema; raw-JSON fallback), POST /test → result + captured logs[] +
// durationMs. Runs the DRAFT working set (works before the first publish).

import { useMemo, useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { WEBMCP_ACCENT, KindBadge, EmptyState, inputStyle, monoStyle, type ToolRow } from "./shared";

interface TestResult {
  ok: boolean;
  output: string;
  error?: string;
  durationMs: number;
  logs?: string[];
}

interface PropSpec {
  name: string;
  type: string;
  description?: string;
  enum?: string[];
  required: boolean;
}

function propsOf(tool: ToolRow): PropSpec[] | null {
  const schema = tool.inputSchema ?? {};
  const props = schema.properties;
  if (props === undefined) return [];
  if (typeof props !== "object" || props === null || Array.isArray(props)) return null;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
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

export default function TestRunner({ slug, tools }: { slug: string; tools: ToolRow[] }) {
  const [toolName, setToolName] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [rawMode, setRawMode] = useState(false);
  const [rawArgs, setRawArgs] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tool = tools.find((t) => t.name === toolName) ?? null;
  const props = useMemo(() => (tool ? propsOf(tool) : []), [tool]);
  const formUsable = props !== null;

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

  const run = async () => {
    if (!tool) return;
    const args = buildArgs();
    if (typeof args === "string") {
      setError(args);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${slug}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName: tool.name, args }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setResult(j as TestResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (tools.length === 0) {
    return <EmptyState title="No tools to test" hint="Add a tool in the Tools tab first — the Test tab runs the draft working set." />;
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "220px 1fr" }}>
      <div className="flex flex-col gap-1.5">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => { setToolName(t.name); setResult(null); setError(null); setFieldValues({}); setRawMode(false); setRawArgs("{}"); }}
            className="text-left rounded-lg px-2.5 py-2 transition min-w-0"
            style={{
              border: `1px solid ${toolName === t.name ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}`,
              background: toolName === t.name ? `${WEBMCP_ACCENT}0f` : "var(--panel, rgba(255,255,255,0.02))",
            }}
          >
            <span className="font-mono text-[11.5px] block truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{t.name}</span>
            <div className="mt-1"><KindBadge kind={t.handlerKind} /></div>
          </button>
        ))}
      </div>

      {!tool ? (
        <EmptyState title="Pick a tool" hint="Args are generated from the tool's input schema; results show output, captured logs and duration." />
      ) : (
        <div className="min-w-0">
          <div className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--fg-dim, #9aa)" }}>
            {tool.description || <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>(no description)</span>}
            {tool.requiresApproval && (
              <span className="ml-2 text-[10.5px]" style={{ color: "#fbbf24" }}>
                requires approval on the published lane — the Test tab bypasses (you are the human)
              </span>
            )}
          </div>

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
                      inputMode={p.type === "string" ? undefined : "numeric"}
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
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
              style={{ border: `1px solid ${WEBMCP_ACCENT}66`, background: `${WEBMCP_ACCENT}18`, color: WEBMCP_ACCENT }}
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run (draft)
            </button>
            {formUsable && (props ?? []).length > 0 && (
              <button
                onClick={() => setRawMode((m) => !m)}
                className="text-[10.5px] font-mono underline decoration-dotted"
                style={{ color: WEBMCP_ACCENT }}
              >
                {rawMode ? "→ form" : "→ raw JSON"}
              </button>
            )}
            {error && <span className="text-[11.5px]" style={{ color: "#f87171" }}>{error}</span>}
          </div>

          {result && (
            <div className="mt-4 rounded-xl p-3" style={{ border: `1px solid ${result.ok ? "#34d39944" : "#f8717144"}` }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: result.ok ? "#34d399" : "#f87171" }}>
                  {result.ok ? "ok" : "failed"}
                </span>
                <span className="font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{result.durationMs}ms</span>
              </div>
              {result.error && (
                <pre className="text-[11.5px] whitespace-pre-wrap break-words mb-2" style={{ ...monoStyle, color: "#f87171" }}>{result.error}</pre>
              )}
              {result.output && (
                <pre className="text-[11.5px] whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto" style={{ ...monoStyle, color: "var(--fg, #e8e2f0)" }}>
                  {result.output}
                </pre>
              )}
              {result.logs && result.logs.length > 0 && (
                <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
                  <span className="block mb-1 font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    console
                  </span>
                  {result.logs.map((l, i) => (
                    <div key={i} className="font-mono text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
