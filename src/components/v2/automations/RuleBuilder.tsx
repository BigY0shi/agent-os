"use client";

// ── RuleBuilder (SPEC-D G5.3 §6.3) — three sentence-fragment sections ────────
// WHEN: trigger picker (known connector/system events + custom event string)
// IF:   condition rows [field · op · value] (op whitelist from the API)
// THEN: action rows [kind → kind-specific fields]; run_tool shows account+tool
//       pickers and an argsTemplate JSON editor with the {{payload.*}} hint;
//       a destructive-annotated tool surfaces the RED confirm checkbox — the
//       route 422s without it (G5.4 save gate) and the error renders here.
// Footer: [Test with sample payload] → POST /api/v2/automations/test (dry-run,
// never executes) · [Save].

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, FlaskConical, Plus, Trash2, AlertTriangle } from "lucide-react";
import type {
  AutomationAction,
  AutomationRule,
  ConditionResult,
  RuleCondition,
} from "@/lib/v2/automations/types";
import { inputStyle, panelStyle, monoStyle, type ToolInfo } from "../integrations/shared";
import { AUTOMATIONS_ACCENT, type AvailableMeta } from "./AutomationsView";

interface AccountOption {
  id: string;
  slug: string;
  label: string;
}

interface TestOutcome {
  matched: boolean;
  conditions: ConditionResult[];
  wouldRun: Array<{ kind: string; tool?: string }>;
}

const CUSTOM = "__custom__";

export default function RuleBuilder({
  rule,
  available,
  onClose,
  onSaved,
}: {
  rule: AutomationRule | null;
  available: AvailableMeta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const knownKey = available.triggers.find(
    (t) => rule && t.slug === rule.triggerSlug && t.event === rule.triggerEvent,
  );
  const [triggerChoice, setTriggerChoice] = useState<string>(
    rule ? (knownKey ? `${knownKey.slug}|${knownKey.event}` : CUSTOM) : available.triggers.length ? `${available.triggers[0].slug}|${available.triggers[0].event}` : CUSTOM,
  );
  const [customSlug, setCustomSlug] = useState(rule && !knownKey ? rule.triggerSlug : "system");
  const [customEvent, setCustomEvent] = useState(rule && !knownKey ? rule.triggerEvent : "");
  const [conditions, setConditions] = useState<RuleCondition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(rule?.actions ?? [{ kind: "create_attention", titleTemplate: "" }]);
  const [samplePayload, setSamplePayload] = useState('{\n  "text": "example activity text"\n}');
  const [testResult, setTestResult] = useState<TestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Accounts for the run_tool picker (+ per-account tool lists, lazily).
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [toolsByAccount, setToolsByAccount] = useState<Record<string, ToolInfo[]>>({});
  useEffect(() => {
    fetch("/api/v2/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const out: AccountOption[] = [];
        for (const c of j?.connectors ?? []) {
          for (const a of c.accounts ?? []) {
            if (a.isActive) out.push({ id: a.id, slug: c.slug, label: `${c.name} · ${a.displayName ?? a.accountId}` });
          }
        }
        setAccounts(out);
      })
      .catch(() => {});
  }, []);
  const loadTools = useCallback(
    (accountId: string) => {
      if (!accountId || toolsByAccount[accountId]) return;
      fetch(`/api/v2/integrations/accounts/${accountId}/tools`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (Array.isArray(j?.tools)) setToolsByAccount((m) => ({ ...m, [accountId]: j.tools as ToolInfo[] }));
        })
        .catch(() => {});
    },
    [toolsByAccount],
  );
  useEffect(() => {
    for (const a of actions) if (a.kind === "run_tool" && a.accountId) loadTools(a.accountId);
  }, [actions, loadTools]);

  const trigger = useMemo(() => {
    if (triggerChoice === CUSTOM) return { slug: customSlug.trim() || "system", event: customEvent.trim() };
    const [slug, event] = triggerChoice.split("|");
    return { slug, event };
  }, [triggerChoice, customSlug, customEvent]);

  const rulePayload = () => ({
    name,
    triggerSlug: trigger.slug,
    triggerEvent: trigger.event,
    conditions,
    actions,
  });

  const runTest = async () => {
    setError(null);
    setTestResult(null);
    let payload: unknown;
    try {
      payload = JSON.parse(samplePayload || "{}");
    } catch {
      setError("Sample payload is not valid JSON");
      return;
    }
    const res = await fetch("/api/v2/automations/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule: rulePayload(), samplePayload: payload }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      setError(j?.error ?? `test failed (${res.status})`);
      return;
    }
    setTestResult(j as TestOutcome);
  };

  const saveRule = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/v2/automations", {
        method: rule ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rule ? { id: rule.id, ...rulePayload() } : rulePayload()),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError(j?.error ?? `save failed (${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-[720px] rounded-2xl p-5 flex flex-col gap-4 my-6"
        style={{ ...panelStyle, background: "var(--panel-solid, #14101c)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <div className="text-[14px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            {rule ? "Edit rule" : "New rule"}
          </div>
          <button onClick={onClose} className="ml-auto p-1 rounded-lg hover:bg-[rgba(255,255,255,0.05)]" style={{ color: "var(--fg-dim, #9aa)" }}>
            <X size={15} />
          </button>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rule name"
          className="rounded-lg px-3 h-9 text-[13px] outline-none"
          style={inputStyle}
        />

        {/* WHEN */}
        <Section label="When">
          <div className="flex flex-wrap gap-2">
            <select
              value={triggerChoice}
              onChange={(e) => setTriggerChoice(e.target.value)}
              className="rounded-lg px-2 h-8 text-[12px] outline-none min-w-[240px]"
              style={inputStyle}
            >
              {available.triggers.map((t) => (
                <option key={`${t.slug}|${t.event}`} value={`${t.slug}|${t.event}`}>
                  {t.label}
                </option>
              ))}
              <option value={CUSTOM}>Custom event…</option>
            </select>
            {triggerChoice === CUSTOM && (
              <>
                <input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="slug (or 'system')"
                  className="rounded-lg px-2 h-8 text-[12px] outline-none w-[140px]"
                  style={inputStyle}
                />
                <input
                  value={customEvent}
                  onChange={(e) => setCustomEvent(e.target.value)}
                  placeholder="event type (the trigger IS the event type)"
                  className="rounded-lg px-2 h-8 text-[12px] outline-none flex-1 min-w-[200px]"
                  style={inputStyle}
                />
              </>
            )}
          </div>
        </Section>

        {/* IF */}
        <Section label="If" hint="all conditions must pass · fields: text, payload.*, account.slug, event">
          <div className="flex flex-col gap-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={c.field}
                  onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                  placeholder="payload.subject"
                  className="rounded-lg px-2 h-8 text-[12px] outline-none w-[180px]"
                  style={{ ...inputStyle, ...monoStyle }}
                />
                <select
                  value={c.op}
                  onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as RuleCondition["op"] } : x)))}
                  className="rounded-lg px-2 h-8 text-[12px] outline-none"
                  style={inputStyle}
                >
                  {available.conditionOps.map((op) => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
                <input
                  value={c.value}
                  onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder="value"
                  className="rounded-lg px-2 h-8 text-[12px] outline-none flex-1"
                  style={inputStyle}
                />
                <button onClick={() => setConditions(conditions.filter((_, j) => j !== i))} className="p-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setConditions([...conditions, { field: "text", op: "contains", value: "" }])}
              className="self-start inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px]"
              style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
            >
              <Plus size={11} /> condition
            </button>
          </div>
        </Section>

        {/* THEN */}
        <Section label="Then" hint="templates: {{text}}, {{payload.*}}, {{account.slug}} — string substitution only">
          <div className="flex flex-col gap-3">
            {actions.map((a, i) => (
              <ActionRow
                key={i}
                action={a}
                accounts={accounts}
                tools={a.kind === "run_tool" ? toolsByAccount[a.accountId] ?? [] : []}
                onChange={(next) => setActions(actions.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setActions(actions.filter((_, j) => j !== i))}
              />
            ))}
            <button
              onClick={() => setActions([...actions, { kind: "create_attention", titleTemplate: "" }])}
              className="self-start inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px]"
              style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
            >
              <Plus size={11} /> action
            </button>
          </div>
        </Section>

        {/* TEST */}
        <Section label="Test" hint="dry-run against a sample payload — nothing executes">
          <div className="flex flex-col gap-2">
            <textarea
              value={samplePayload}
              onChange={(e) => setSamplePayload(e.target.value)}
              rows={3}
              className="rounded-lg px-3 py-2 text-[12px] outline-none resize-y"
              style={{ ...inputStyle, ...monoStyle }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={runTest}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11.5px] font-medium"
                style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
              >
                <FlaskConical size={12} /> Test with sample payload
              </button>
              {testResult && (
                <span className="text-[11.5px] font-semibold" style={{ color: testResult.matched ? "#34d399" : "#f87171" }}>
                  {testResult.matched ? `matched — would run: ${testResult.wouldRun.map((w) => w.tool ?? w.kind).join(", ") || "(no actions)"}` : "conditions did not match"}
                </span>
              )}
            </div>
            {testResult && testResult.conditions.length > 0 && (
              <div className="text-[10.5px] font-mono flex flex-col gap-0.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {testResult.conditions.map((c, i) => (
                  <div key={i}>
                    <span style={{ color: c.pass ? "#34d399" : "#f87171" }}>{c.pass ? "✓" : "✗"}</span>{" "}
                    {c.field} {c.op} '{c.value}' — actual: '{c.actual}'{c.error ? ` (${c.error})` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {error && (
          <div className="rounded-lg px-3 py-2 text-[11.5px]" style={{ border: "1px solid #f8717155", color: "#f87171" }}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 h-8 rounded-lg text-[12px]" style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
            Cancel
          </button>
          <button
            onClick={saveRule}
            disabled={saving}
            className="px-3 h-8 rounded-lg text-[12px] font-semibold disabled:opacity-50"
            style={{ border: `1px solid ${AUTOMATIONS_ACCENT}66`, color: AUTOMATIONS_ACCENT, background: `${AUTOMATIONS_ACCENT}12` }}
          >
            {saving ? "Saving…" : "Save rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: AUTOMATIONS_ACCENT }}>
          {label}
        </span>
        {hint && (
          <span className="text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function ActionRow({
  action,
  accounts,
  tools,
  onChange,
  onRemove,
}: {
  action: AutomationAction;
  accounts: AccountOption[];
  tools: ToolInfo[];
  onChange: (a: AutomationAction) => void;
  onRemove: () => void;
}) {
  const selectedTool = action.kind === "run_tool" ? tools.find((t) => t.name === action.tool) : undefined;
  const destructive = selectedTool?.annotations?.destructiveHint === true;
  // Local text buffer so typing invalid-intermediate JSON doesn't fight the
  // canonical stringify; the parsed object only sticks once it parses.
  const [argsText, setArgsText] = useState(() =>
    JSON.stringify(action.kind === "run_tool" ? action.argsTemplate ?? {} : {}, null, 2),
  );

  return (
    <div className="rounded-lg p-2.5 flex flex-col gap-2" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
      <div className="flex items-center gap-2">
        <select
          value={action.kind}
          onChange={(e) => {
            const kind = e.target.value as AutomationAction["kind"];
            if (kind === "create_attention") onChange({ kind, titleTemplate: "" });
            else if (kind === "create_task") onChange({ kind, titleTemplate: "" });
            else if (kind === "notify") onChange({ kind });
            else onChange({ kind: "run_tool", accountId: "", tool: "", argsTemplate: {} });
          }}
          className="rounded-lg px-2 h-8 text-[12px] outline-none"
          style={inputStyle}
        >
          <option value="create_attention">create_attention</option>
          <option value="create_task">create_task</option>
          <option value="notify">notify</option>
          <option value="run_tool">run_tool</option>
        </select>
        <button onClick={onRemove} className="ml-auto p-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          <Trash2 size={13} />
        </button>
      </div>

      {action.kind === "create_attention" && (
        <div className="flex flex-wrap gap-2">
          <select
            value={action.severity ?? "info"}
            onChange={(e) => onChange({ ...action, severity: e.target.value as "info" | "warn" | "urgent" })}
            className="rounded-lg px-2 h-8 text-[12px] outline-none"
            style={inputStyle}
          >
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="urgent">urgent</option>
          </select>
          <input
            value={action.titleTemplate}
            onChange={(e) => onChange({ ...action, titleTemplate: e.target.value })}
            placeholder="title template, e.g. Invoice from {{payload.from}}"
            className="rounded-lg px-2 h-8 text-[12px] outline-none flex-1 min-w-[220px]"
            style={inputStyle}
          />
          <input
            value={action.bodyTemplate ?? ""}
            onChange={(e) => onChange({ ...action, bodyTemplate: e.target.value || undefined })}
            placeholder="body template (optional)"
            className="rounded-lg px-2 h-8 text-[12px] outline-none flex-1 min-w-[220px]"
            style={inputStyle}
          />
        </div>
      )}

      {action.kind === "create_task" && (
        <div className="flex flex-wrap gap-2">
          <input
            value={action.titleTemplate}
            onChange={(e) => onChange({ ...action, titleTemplate: e.target.value })}
            placeholder="task title template"
            className="rounded-lg px-2 h-8 text-[12px] outline-none flex-1 min-w-[220px]"
            style={inputStyle}
          />
          <input
            value={action.descriptionTemplate ?? ""}
            onChange={(e) => onChange({ ...action, descriptionTemplate: e.target.value || undefined })}
            placeholder="description template (optional)"
            className="rounded-lg px-2 h-8 text-[12px] outline-none flex-1 min-w-[220px]"
            style={inputStyle}
          />
        </div>
      )}

      {action.kind === "notify" && (
        <div className="flex flex-wrap gap-2">
          <input
            value={action.eventType ?? ""}
            onChange={(e) => onChange({ ...action, eventType: e.target.value || undefined })}
            placeholder="event type (default automation.notify)"
            className="rounded-lg px-2 h-8 text-[12px] outline-none w-[240px]"
            style={{ ...inputStyle, ...monoStyle }}
          />
          <input
            value={action.messageTemplate ?? ""}
            onChange={(e) => onChange({ ...action, messageTemplate: e.target.value || undefined })}
            placeholder="message template"
            className="rounded-lg px-2 h-8 text-[12px] outline-none flex-1 min-w-[220px]"
            style={inputStyle}
          />
        </div>
      )}

      {action.kind === "run_tool" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={action.accountId}
              onChange={(e) => onChange({ ...action, accountId: e.target.value, tool: "" })}
              className="rounded-lg px-2 h-8 text-[12px] outline-none min-w-[220px]"
              style={inputStyle}
            >
              <option value="">account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            <select
              value={action.tool}
              onChange={(e) => onChange({ ...action, tool: e.target.value })}
              className="rounded-lg px-2 h-8 text-[12px] outline-none min-w-[220px]"
              style={{ ...inputStyle, ...monoStyle }}
            >
              <option value="">tool…</option>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                  {t.annotations?.destructiveHint ? " ⚠ destructive" : ""}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={argsText}
            onChange={(e) => {
              setArgsText(e.target.value);
              try {
                const parsed = JSON.parse(e.target.value);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  onChange({ ...action, argsTemplate: parsed as Record<string, unknown> });
                }
              } catch {
                /* keep last valid — the JSON must parse before it sticks */
              }
            }}
            rows={3}
            placeholder='{"text": "{{payload.subject}}"}'
            className="rounded-lg px-3 py-2 text-[11.5px] outline-none resize-y"
            style={{ ...inputStyle, ...monoStyle }}
            title="Args template — {{payload.*}} placeholders substitute at fire time"
          />
          {destructive && (
            <label
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11.5px] font-medium"
              style={{ border: "1px solid #f8717166", color: "#f87171", background: "#f871710d" }}
            >
              <input
                type="checkbox"
                checked={action.confirmDestructive === true}
                onChange={(e) => onChange({ ...action, confirmDestructive: e.target.checked })}
              />
              <AlertTriangle size={12} />
              I confirm this rule may run the destructive tool '{action.tool}' unattended — required to save (422 without it)
            </label>
          )}
        </div>
      )}
    </div>
  );
}
