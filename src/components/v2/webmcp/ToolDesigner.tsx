"use client";

// SPEC-C D3.3 — the Tools editor: name / description / params schema (row
// builder ⇄ raw JSON toggle) / handler kind (internal|http|js) + per-kind
// config / requires-approval. Edits the DRAFT working set — a published
// package's live snapshot is untouched until the next publish (§8.10).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Save, Loader2, ShieldAlert } from "lucide-react";
import {
  WEBMCP_ACCENT,
  KindBadge,
  EmptyState,
  inputStyle,
  monoStyle,
  type ToolRow,
} from "./shared";

type FieldType = "string" | "number" | "integer" | "boolean";

interface SchemaRow {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  enumCsv: string; // string-type only; comma-separated
}

interface Draft {
  originalName: string | null; // null = new tool
  name: string;
  description: string;
  handlerKind: "internal" | "http" | "js";
  requiresApproval: boolean;
  // schema
  rawMode: boolean;
  rows: SchemaRow[];
  rawSchema: string;
  // handler configs (kept separately so switching kinds doesn't lose edits)
  actionKey: string;
  httpUrl: string;
  httpMethod: string;
  httpHeaders: string; // JSON object text
  httpBody: string; // JSON text (object or string template)
  jsCode: string;
}

function rowsToSchema(rows: SchemaRow[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const r of rows) {
    if (!r.name.trim()) continue;
    const prop: Record<string, unknown> = { type: r.type };
    if (r.description.trim()) prop.description = r.description.trim();
    if (r.type === "string" && r.enumCsv.trim()) {
      prop.enum = r.enumCsv.split(",").map((s) => s.trim()).filter(Boolean);
    }
    properties[r.name.trim()] = prop;
    if (r.required) required.push(r.name.trim());
  }
  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length) schema.required = required;
  return schema;
}

/** null = not representable as rows (nested/array/oneOf…) → force raw mode. */
function schemaToRows(schema: Record<string, unknown>): SchemaRow[] | null {
  if (schema.type !== "object" && schema.type !== undefined) return null;
  const props = schema.properties;
  if (props !== undefined && (typeof props !== "object" || props === null || Array.isArray(props))) return null;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const rows: SchemaRow[] = [];
  for (const [name, raw] of Object.entries((props ?? {}) as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    const t = p.type;
    if (t !== "string" && t !== "number" && t !== "integer" && t !== "boolean") return null;
    const extra = Object.keys(p).filter((k) => !["type", "description", "enum"].includes(k));
    if (extra.length > 0) return null;
    if (p.enum !== undefined && (t !== "string" || !Array.isArray(p.enum) || p.enum.some((v) => typeof v !== "string"))) return null;
    rows.push({
      name,
      type: t as FieldType,
      required: required.has(name),
      description: typeof p.description === "string" ? p.description : "",
      enumCsv: Array.isArray(p.enum) ? (p.enum as string[]).join(", ") : "",
    });
  }
  return rows;
}

function draftFromTool(t: ToolRow | null): Draft {
  const cfg = (t?.handlerConfig ?? {}) as Record<string, unknown>;
  const schema = t?.inputSchema ?? { type: "object", properties: {} };
  const rows = schemaToRows(schema);
  return {
    originalName: t?.name ?? null,
    name: t?.name ?? "",
    description: t?.description ?? "",
    handlerKind: t?.handlerKind ?? "js",
    requiresApproval: t?.requiresApproval ?? false,
    rawMode: rows === null,
    rows: rows ?? [],
    rawSchema: JSON.stringify(schema, null, 2),
    actionKey: typeof cfg.actionKey === "string" ? cfg.actionKey : "",
    httpUrl: typeof cfg.url === "string" ? cfg.url : "",
    httpMethod: typeof cfg.method === "string" ? cfg.method : "GET",
    httpHeaders: cfg.headers ? JSON.stringify(cfg.headers, null, 2) : "",
    httpBody:
      cfg.bodyTemplate === undefined
        ? ""
        : typeof cfg.bodyTemplate === "string"
          ? cfg.bodyTemplate
          : JSON.stringify(cfg.bodyTemplate, null, 2),
    jsCode: typeof cfg.code === "string" ? cfg.code : 'return { ok: true, args };',
  };
}

export default function ToolDesigner({
  slug,
  tools,
  allowJsHandlers,
  readOnly,
  onChanged,
}: {
  slug: string;
  tools: ToolRow[];
  allowJsHandlers: boolean;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Re-seed the editor when the selected tool disappears (deleted elsewhere).
  useEffect(() => {
    if (draft?.originalName && !tools.some((t) => t.name === draft.originalName)) setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools]);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }, []);

  const schemaPreview = useMemo(() => {
    if (!draft) return null;
    if (!draft.rawMode) return JSON.stringify(rowsToSchema(draft.rows));
    try {
      JSON.parse(draft.rawSchema);
      return draft.rawSchema;
    } catch {
      return null;
    }
  }, [draft]);

  const buildBody = useCallback((): Record<string, unknown> | string => {
    if (!draft) return "no draft";
    const name = draft.name.trim();
    if (!name) return "tool name is required";
    let inputSchema: Record<string, unknown>;
    if (draft.rawMode) {
      try {
        inputSchema = JSON.parse(draft.rawSchema);
      } catch {
        return "params schema is not valid JSON";
      }
    } else {
      inputSchema = rowsToSchema(draft.rows);
    }
    let handlerConfig: Record<string, unknown>;
    if (draft.handlerKind === "internal") {
      if (!draft.actionKey.trim()) return "internal handler needs an action key";
      handlerConfig = { actionKey: draft.actionKey.trim() };
    } else if (draft.handlerKind === "http") {
      if (!draft.httpUrl.trim()) return "http handler needs a URL";
      handlerConfig = { url: draft.httpUrl.trim(), method: draft.httpMethod };
      if (draft.httpHeaders.trim()) {
        try {
          handlerConfig.headers = JSON.parse(draft.httpHeaders);
        } catch {
          return "headers must be a JSON object";
        }
      }
      if (draft.httpBody.trim()) {
        try {
          handlerConfig.bodyTemplate = JSON.parse(draft.httpBody);
        } catch {
          handlerConfig.bodyTemplate = draft.httpBody; // string template is legal
        }
      }
    } else {
      if (!draft.jsCode.trim()) return "js handler needs code";
      handlerConfig = { code: draft.jsCode };
    }
    return {
      description: draft.description,
      inputSchema,
      handlerKind: draft.handlerKind,
      handlerConfig,
      requiresApproval: draft.requiresApproval,
    };
  }, [draft]);

  const saveTool = useCallback(async () => {
    if (!draft) return;
    const body = buildBody();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const isNew = draft.originalName === null;
      const res = await fetch(`/api/v2/webmcp/packages/${slug}/tools`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isNew
            ? { ...body, name: draft.name.trim() }
            : { ...body, name: draft.originalName, newName: draft.name.trim() !== draft.originalName ? draft.name.trim() : undefined },
        ),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setNotice(isNew ? "tool added to the draft set" : "tool saved (draft set — publish to go live)");
      setDraft(draftFromTool(j.tool as ToolRow));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, buildBody, slug, onChanged]);

  const deleteTool = useCallback(async () => {
    if (!draft?.originalName) return;
    if (!window.confirm(`Remove tool '${draft.originalName}' from the draft set? (The published snapshot keeps it until the next publish.)`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${slug}/tools?name=${encodeURIComponent(draft.originalName)}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setDraft(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, slug, onChanged]);

  const label = (text: string) => (
    <span className="block mb-1 text-[11px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>{text}</span>
  );

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "220px 1fr" }}>
      {/* tool list */}
      <div className="flex flex-col gap-1.5 min-w-0">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => { setDraft(draftFromTool(t)); setError(null); setNotice(null); }}
            className="text-left rounded-lg px-2.5 py-2 transition min-w-0"
            style={{
              border: `1px solid ${draft?.originalName === t.name ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}`,
              background: draft?.originalName === t.name ? `${WEBMCP_ACCENT}0f` : "var(--panel, rgba(255,255,255,0.02))",
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[11.5px] truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{t.name}</span>
              {t.requiresApproval && <ShieldAlert size={11} className="shrink-0" style={{ color: "#fbbf24" }} />}
            </div>
            <div className="mt-1"><KindBadge kind={t.handlerKind} /></div>
          </button>
        ))}
        {!readOnly && (
          <button
            onClick={() => { setDraft(draftFromTool(null)); setError(null); setNotice(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium transition"
            style={{ border: `1px dashed ${WEBMCP_ACCENT}66`, color: WEBMCP_ACCENT }}
          >
            <Plus size={13} /> New tool
          </button>
        )}
      </div>

      {/* editor */}
      {!draft ? (
        <EmptyState
          title={tools.length ? "Select a tool to edit" : "No tools yet"}
          hint="Tools edit the DRAFT working set. Publishing freezes a snapshot and puts it on the hub."
        />
      ) : (
        <div className="min-w-0">
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              {label("Tool name (exact advertised name)")}
              <input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                disabled={readOnly}
                placeholder="my_tool"
                className="w-full rounded-lg px-2.5 h-8 text-[12.5px] outline-none"
                style={{ ...inputStyle, ...monoStyle }}
              />
            </div>
            <div>
              {label("Handler kind")}
              <div className="flex items-center gap-1.5">
                {(["internal", "http", "js"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => set("handlerKind", k)}
                    disabled={readOnly || (k === "js" && !allowJsHandlers)}
                    title={k === "js" && !allowJsHandlers ? "disabled by settings.webmcp.allowJsHandlers" : undefined}
                    className="px-2.5 h-8 rounded-lg text-[11.5px] font-medium transition disabled:opacity-35"
                    style={{
                      border: `1px solid ${draft.handlerKind === k ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}`,
                      color: draft.handlerKind === k ? WEBMCP_ACCENT : "var(--fg-dim, #9aa)",
                      background: draft.handlerKind === k ? `${WEBMCP_ACCENT}14` : "transparent",
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3">
            {label("Description (what agents read to pick this tool)")}
            <textarea
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              disabled={readOnly}
              rows={2}
              className="w-full rounded-lg px-2.5 py-2 text-[12.5px] outline-none resize-y"
              style={inputStyle}
            />
          </div>

          {/* params schema */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              {label("Params (JSON Schema — top-level object)")}
              <button
                onClick={() => {
                  if (draft.rawMode) {
                    let rows: SchemaRow[] | null = null;
                    try { rows = schemaToRows(JSON.parse(draft.rawSchema)); } catch { rows = null; }
                    if (rows === null) { setError("schema is too complex (or invalid JSON) for the row builder — stay in raw mode"); return; }
                    setDraft({ ...draft, rawMode: false, rows });
                  } else {
                    setDraft({ ...draft, rawMode: true, rawSchema: JSON.stringify(rowsToSchema(draft.rows), null, 2) });
                  }
                }}
                className="text-[10.5px] font-mono underline decoration-dotted"
                style={{ color: WEBMCP_ACCENT }}
              >
                {draft.rawMode ? "→ field rows" : "→ raw JSON"}
              </button>
            </div>
            {draft.rawMode ? (
              <textarea
                value={draft.rawSchema}
                onChange={(e) => set("rawSchema", e.target.value)}
                disabled={readOnly}
                rows={7}
                spellCheck={false}
                className="w-full rounded-lg px-2.5 py-2 text-[11.5px] outline-none resize-y"
                style={{ ...inputStyle, ...monoStyle }}
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {draft.rows.map((r, i) => (
                  <div key={i} className="grid items-center gap-1.5" style={{ gridTemplateColumns: "1fr 92px 1.4fr 1fr auto auto" }}>
                    <input value={r.name} placeholder="field" disabled={readOnly}
                      onChange={(e) => set("rows", draft.rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      className="rounded-lg px-2 h-7 text-[11.5px] outline-none" style={{ ...inputStyle, ...monoStyle }} />
                    <select value={r.type} disabled={readOnly}
                      onChange={(e) => set("rows", draft.rows.map((x, j) => (j === i ? { ...x, type: e.target.value as FieldType } : x)))}
                      className="rounded-lg px-1.5 h-7 text-[11.5px] outline-none" style={inputStyle}>
                      {(["string", "number", "integer", "boolean"] as const).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input value={r.description} placeholder="description" disabled={readOnly}
                      onChange={(e) => set("rows", draft.rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                      className="rounded-lg px-2 h-7 text-[11.5px] outline-none" style={inputStyle} />
                    <input value={r.enumCsv} placeholder={r.type === "string" ? "enum a, b (opt.)" : "—"} disabled={readOnly || r.type !== "string"}
                      onChange={(e) => set("rows", draft.rows.map((x, j) => (j === i ? { ...x, enumCsv: e.target.value } : x)))}
                      className="rounded-lg px-2 h-7 text-[11.5px] outline-none disabled:opacity-35" style={{ ...inputStyle, ...monoStyle }} />
                    <label className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>
                      <input type="checkbox" checked={r.required} disabled={readOnly} style={{ accentColor: WEBMCP_ACCENT }}
                        onChange={(e) => set("rows", draft.rows.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                      req
                    </label>
                    <button onClick={() => set("rows", draft.rows.filter((_, j) => j !== i))} disabled={readOnly}
                      className="p-1 rounded transition hover:bg-white/5" style={{ color: "var(--fg-dimmer, #6b6478)" }} title="Remove field">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {!readOnly && (
                  <button
                    onClick={() => set("rows", [...draft.rows, { name: "", type: "string", required: false, description: "", enumCsv: "" }])}
                    className="self-start inline-flex items-center gap-1 text-[11px] font-medium mt-0.5"
                    style={{ color: WEBMCP_ACCENT }}
                  >
                    <Plus size={12} /> Add field
                  </button>
                )}
              </div>
            )}
          </div>

          {/* handler config */}
          <div className="mt-3 rounded-xl p-3" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
            {draft.handlerKind === "internal" && (
              <div>
                {label("Action key (F4 registry, e.g. tasks_create / exec_command / <slug>/<tool>)")}
                <input value={draft.actionKey} disabled={readOnly}
                  onChange={(e) => set("actionKey", e.target.value)}
                  placeholder="tasks_create"
                  className="w-full rounded-lg px-2.5 h-8 text-[12.5px] outline-none" style={{ ...inputStyle, ...monoStyle }} />
              </div>
            )}
            {draft.handlerKind === "http" && (
              <div className="flex flex-col gap-2.5">
                <div className="grid gap-2" style={{ gridTemplateColumns: "110px 1fr" }}>
                  <div>
                    {label("Method")}
                    <select value={draft.httpMethod} disabled={readOnly} onChange={(e) => set("httpMethod", e.target.value)}
                      className="w-full rounded-lg px-1.5 h-8 text-[12px] outline-none" style={inputStyle}>
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    {label("URL ({{args.X}} + {{secret:NAME}} templates)")}
                    <input value={draft.httpUrl} disabled={readOnly} onChange={(e) => set("httpUrl", e.target.value)}
                      placeholder="https://api.example.com/v1/{{args.path}}"
                      className="w-full rounded-lg px-2.5 h-8 text-[12.5px] outline-none" style={{ ...inputStyle, ...monoStyle }} />
                  </div>
                </div>
                <div>
                  {label('Headers (JSON object, e.g. {"authorization": "Bearer {{secret:TOKEN}}"})')}
                  <textarea value={draft.httpHeaders} disabled={readOnly} onChange={(e) => set("httpHeaders", e.target.value)}
                    rows={3} spellCheck={false}
                    className="w-full rounded-lg px-2.5 py-2 text-[11.5px] outline-none resize-y" style={{ ...inputStyle, ...monoStyle }} />
                </div>
                <div>
                  {label("Body template (JSON or raw string; skipped for GET/HEAD)")}
                  <textarea value={draft.httpBody} disabled={readOnly} onChange={(e) => set("httpBody", e.target.value)}
                    rows={3} spellCheck={false}
                    className="w-full rounded-lg px-2.5 py-2 text-[11.5px] outline-none resize-y" style={{ ...inputStyle, ...monoStyle }} />
                </div>
              </div>
            )}
            {draft.handlerKind === "js" && (
              <div>
                {label("Async function body — `args` in scope; `return` the result. No fetch/process/require (use the http kind for network). Runs with server privileges.")}
                <textarea value={draft.jsCode} disabled={readOnly} onChange={(e) => set("jsCode", e.target.value)}
                  rows={9} spellCheck={false}
                  className="w-full rounded-lg px-2.5 py-2 text-[12px] leading-relaxed outline-none resize-y"
                  style={{ ...inputStyle, ...monoStyle }} />
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer select-none" style={{ color: "var(--fg-dim, #9aa)" }}>
              <input type="checkbox" checked={draft.requiresApproval} disabled={readOnly}
                onChange={(e) => set("requiresApproval", e.target.checked)} style={{ accentColor: "#fbbf24" }} />
              requires human approval (destructive/state-changing)
            </label>
            <div className="ml-auto flex items-center gap-2">
              {draft.originalName && !readOnly && (
                <button onClick={deleteTool} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
                  style={{ border: "1px solid #f8717155", color: "#f87171" }}>
                  <Trash2 size={12} /> Remove
                </button>
              )}
              {!readOnly && (
                <button onClick={saveTool} disabled={busy || !schemaPreview}
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
                  style={{ border: `1px solid ${WEBMCP_ACCENT}66`, background: `${WEBMCP_ACCENT}18`, color: WEBMCP_ACCENT }}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {draft.originalName ? "Save tool" : "Add tool"}
                </button>
              )}
            </div>
          </div>
          {error && <div className="mt-2 text-[11.5px]" style={{ color: "#f87171" }}>{error}</div>}
          {notice && <div className="mt-2 text-[11.5px]" style={{ color: "#34d399" }}>{notice}</div>}
        </div>
      )}
    </div>
  );
}
