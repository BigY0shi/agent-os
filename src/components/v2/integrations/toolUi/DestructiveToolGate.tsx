"use client";

// SPEC-D G4.3 — the generic two-phase gate for destructiveHint-annotated
// integration tools (upstream email-tool-ui pattern-only port, §4):
//   phase 1: EDITABLE form of the staged args (per-field inputs when every
//            value is primitive, JSON editor otherwise) → explicit
//            [Send] / [Decline];
//   phase 2: result view (ok/error + duration + text) → [Close].
// Decline NEVER calls — it only invokes onDecline (the parent clears its
// staged state; no request leaves the browser). The parent (ToolsTab) owns
// the actual POST via onSend.

import { useMemo, useState } from "react";
import { Loader2, ShieldAlert, X } from "lucide-react";
import { inputStyle, monoStyle } from "../shared";

export interface DestructiveGateResult {
  result: { text: string; isError?: boolean };
  durationMs: number;
}

export interface DestructiveToolGateProps {
  toolName: string;
  /** Args staged by the parent's [Try] — the editable starting point. */
  initialArgs: Record<string, unknown>;
  running: boolean;
  /** Non-null once the send round-tripped — switches the gate to the result view. */
  result: DestructiveGateResult | null;
  onSend: (args: Record<string, unknown>) => void;
  /** Decline/close — clears the staged call. MUST NOT send anything. */
  onDecline: () => void;
}

const AMBER = "#fbbf24";

export function GateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl p-3" style={{ border: `1px solid ${AMBER}66`, background: `${AMBER}0d` }}>
      {children}
    </div>
  );
}

export function GateHeader({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-semibold" style={{ color: AMBER }}>
      <ShieldAlert size={13} /> {text}
    </div>
  );
}

export function GateButtons({
  running,
  sendLabel,
  onSend,
  onDecline,
}: {
  running: boolean;
  sendLabel: string;
  onSend: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <button
        onClick={onSend}
        disabled={running}
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
        style={{ border: `1px solid ${AMBER}66`, background: `${AMBER}18`, color: AMBER }}
      >
        {running ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />} {sendLabel}
      </button>
      <button
        onClick={onDecline}
        disabled={running}
        className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-[12px] transition disabled:opacity-40"
        style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
      >
        <X size={12} /> Decline
      </button>
    </div>
  );
}

/** Phase-2 result view shared with EmailToolUi. */
export function GateResultView({
  result,
  onClose,
}: {
  result: DestructiveGateResult;
  onClose: () => void;
}) {
  const isError = result.result.isError === true;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: isError ? "#f87171" : "#34d399" }}
        >
          {isError ? "error" : "sent"}
        </span>
        <span className="font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {result.durationMs}ms
        </span>
      </div>
      <pre
        className="text-[11.5px] whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto mb-2"
        style={{ ...monoStyle, color: isError ? "#f87171" : "var(--fg, #e8e2f0)" }}
      >
        {result.result.text}
      </pre>
      <button
        onClick={onClose}
        className="px-3 h-8 rounded-lg text-[12px] transition"
        style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
      >
        Close
      </button>
    </div>
  );
}

const isPrimitive = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export default function DestructiveToolGate({
  toolName,
  initialArgs,
  running,
  result,
  onSend,
  onDecline,
}: DestructiveToolGateProps) {
  const entries = useMemo(() => Object.entries(initialArgs), [initialArgs]);
  const formUsable = entries.length > 0 && entries.every(([, v]) => isPrimitive(v));

  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(entries.filter(([, v]) => isPrimitive(v)).map(([k, v]) => [k, String(v)])),
  );
  const [rawJson, setRawJson] = useState(() => JSON.stringify(initialArgs, null, 2));
  const [localError, setLocalError] = useState<string | null>(null);

  const send = () => {
    if (formUsable) {
      const args: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        const raw = fields[k] ?? String(v);
        if (typeof v === "number") {
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            setLocalError(`'${k}' must be a number`);
            return;
          }
          args[k] = n;
        } else if (typeof v === "boolean") {
          args[k] = raw === "true";
        } else {
          args[k] = raw;
        }
      }
      setLocalError(null);
      onSend(args);
      return;
    }
    try {
      const v = JSON.parse(rawJson);
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        setLocalError("args must be a JSON object");
        return;
      }
      setLocalError(null);
      onSend(v as Record<string, unknown>);
    } catch {
      setLocalError("args are not valid JSON");
    }
  };

  return (
    <GateFrame>
      {result ? (
        <>
          <GateHeader text={`${toolName} — result`} />
          <GateResultView result={result} onClose={onDecline} />
        </>
      ) : (
        <>
          <GateHeader text={`'${toolName}' is destructive — review and edit before sending`} />
          {formUsable ? (
            <div className="flex flex-col gap-2">
              {entries.map(([k, v]) => (
                <div key={k}>
                  <span className="block mb-1 font-mono text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
                    {k}
                  </span>
                  {typeof v === "boolean" ? (
                    <select
                      value={fields[k] ?? String(v)}
                      onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                      className="w-full rounded-lg px-2 h-8 text-[12.5px] outline-none"
                      style={inputStyle}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      value={fields[k] ?? String(v)}
                      onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                      className="w-full rounded-lg px-2.5 h-8 text-[12.5px] outline-none"
                      style={{ ...inputStyle, ...(typeof v === "number" ? monoStyle : {}) }}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full rounded-lg px-2.5 py-2 text-[11.5px] outline-none resize-y"
              style={{ ...inputStyle, ...monoStyle }}
            />
          )}
          {localError && (
            <div className="mt-1.5 text-[11.5px]" style={{ color: "#f87171" }}>
              {localError}
            </div>
          )}
          <GateButtons running={running} sendLabel="Send" onSend={send} onDecline={onDecline} />
        </>
      )}
    </GateFrame>
  );
}
