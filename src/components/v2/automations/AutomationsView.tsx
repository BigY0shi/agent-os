"use client";

// ── AutomationsView (SPEC-D G5.3 §6.3) — the /automations page shell ─────────
// Header (engine on/off chip · gear) → RuleList (sentence rendering per rule:
// "When [Gmail · message received] if [text contains 'invoice'] then [Create
// attention (urgent)]") → RuleBuilder / RunsDrawer overlays.
// V2 idiom: usePollWhileVisible, ConfigMenu gear (rule 16), muted-neobrutalist
// atoms shared with the integrations components.

import { useCallback, useState } from "react";
import { Zap, Plus, Power, PencilLine, History } from "lucide-react";
import ConfigMenu, { useSettings } from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import type {
  AutomationAction,
  AutomationRule,
  RuleCondition,
  TriggerOption,
} from "@/lib/v2/automations/types";
import { EmptyState, StatusChip, fmtAgo, panelStyle } from "../integrations/shared";
import RuleBuilder from "./RuleBuilder";
import RunsDrawer from "./RunsDrawer";

export const AUTOMATIONS_ACCENT = "#fcd34d";

export interface AvailableMeta {
  triggers: TriggerOption[];
  actionKinds: readonly string[];
  conditionOps: readonly string[];
}

const OP_LABEL: Record<string, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "starts with",
  regex: "matches",
  gt: ">",
  lt: "<",
};

export function conditionSentence(c: RuleCondition): string {
  return `${c.field} ${OP_LABEL[c.op] ?? c.op} '${c.value}'`;
}

export function actionSentence(a: AutomationAction): string {
  switch (a.kind) {
    case "create_attention":
      return `Create attention (${a.severity ?? "info"})`;
    case "create_task":
      return "Create task";
    case "notify":
      return `Notify${a.eventType ? ` (${a.eventType})` : ""}`;
    case "run_tool":
      return `Run ${a.tool}`;
    default:
      return (a as AutomationAction).kind;
  }
}

export default function AutomationsView() {
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [available, setAvailable] = useState<AvailableMeta>({ triggers: [], actionKinds: [], conditionOps: [] });
  const [failed, setFailed] = useState(false);
  const [builder, setBuilder] = useState<{ rule: AutomationRule | null } | null>(null);
  const [runsFor, setRunsFor] = useState<AutomationRule | null>(null);
  const { settings, save } = useSettings();

  const automationsSettings = (settings?.automations ?? {}) as { enabled?: boolean };
  const engineEnabled = automationsSettings.enabled !== false;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/automations", { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.rules)) {
        setRules(j.rules as AutomationRule[]);
        if (j.available) setAvailable(j.available as AvailableMeta);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  usePollWhileVisible(refresh, 10000, []);

  useJarvisPageContext({
    route: "/automations",
    title: "Automations",
    summary: `Automations — ${rules?.length ?? 0} rule(s), ${(rules ?? []).filter((r) => r.isActive).length} active. Engine ${engineEnabled ? "on" : "OFF"}.`,
  });

  const toggleActive = async (rule: AutomationRule) => {
    await fetch("/api/v2/automations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: rule.id, isActive: !rule.isActive }),
    }).catch(() => {});
    void refresh();
  };

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: `${AUTOMATIONS_ACCENT}14`, border: `1px solid ${AUTOMATIONS_ACCENT}44` }}
          >
            <Zap size={17} style={{ color: AUTOMATIONS_ACCENT }} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight leading-tight" style={{ color: "var(--fg, #e8e2f0)" }}>
              Automations
            </h1>
            <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {failed && !rules
                ? "feed unreachable"
                : rules
                  ? `${rules.length} rule${rules.length === 1 ? "" : "s"} · ${rules.filter((r) => r.isActive).length} active`
                  : "loading…"}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => save({ automations: { ...automationsSettings, enabled: !engineEnabled } })}
            title="Kill switch: when off, no rule fires (dry-run tests still work)"
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11.5px] font-medium transition"
            style={{
              border: `1px solid ${engineEnabled ? `${AUTOMATIONS_ACCENT}66` : "var(--panel-border, #2a2436)"}`,
              color: engineEnabled ? AUTOMATIONS_ACCENT : "var(--fg-dimmer, #6b6478)",
              background: engineEnabled ? `${AUTOMATIONS_ACCENT}0f` : "transparent",
            }}
          >
            <Power size={12} /> engine {engineEnabled ? "on" : "off"}
          </button>
          <button
            onClick={() => setBuilder({ rule: null })}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11.5px] font-semibold transition"
            style={{ border: `1px solid ${AUTOMATIONS_ACCENT}66`, color: AUTOMATIONS_ACCENT, background: `${AUTOMATIONS_ACCENT}12` }}
          >
            <Plus size={12} /> New rule
          </button>
          <ConfigMenu title="Automations Settings" accent={AUTOMATIONS_ACCENT}>
            <AutomationsSettingsPanel />
          </ConfigMenu>
        </div>
      </div>

      {/* rule list */}
      {!rules ? (
        <EmptyState icon={<Zap size={22} />} title="Loading rules…" />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Zap size={22} />}
          title="No automation rules yet"
          hint="When [a Gmail message arrives] if [text contains 'invoice'] then [create an attention item]. Build the first one with New rule."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              triggers={available.triggers}
              onToggle={() => toggleActive(rule)}
              onEdit={() => setBuilder({ rule })}
              onRuns={() => setRunsFor(rule)}
            />
          ))}
        </div>
      )}

      {builder && (
        <RuleBuilder
          rule={builder.rule}
          available={available}
          onClose={() => setBuilder(null)}
          onSaved={() => {
            setBuilder(null);
            void refresh();
          }}
        />
      )}
      {runsFor && <RunsDrawer rule={runsFor} onClose={() => setRunsFor(null)} />}
    </div>
  );
}

function RuleRow({
  rule,
  triggers,
  onToggle,
  onEdit,
  onRuns,
}: {
  rule: AutomationRule;
  triggers: TriggerOption[];
  onToggle: () => void;
  onEdit: () => void;
  onRuns: () => void;
}) {
  const triggerLabel =
    triggers.find((t) => t.event === rule.triggerEvent && t.slug === rule.triggerSlug)?.label ??
    `${rule.triggerSlug} · ${rule.triggerEvent}`;

  return (
    <div className="rounded-xl px-3.5 py-3 flex flex-col gap-1.5" style={panelStyle}>
      <div className="flex items-center gap-2.5">
        <button
          onClick={onToggle}
          title={rule.isActive ? "Active — click to pause" : "Paused — click to activate"}
          className="w-8 h-4.5 rounded-full relative shrink-0 transition"
          style={{
            height: 18,
            background: rule.isActive ? `${AUTOMATIONS_ACCENT}44` : "var(--panel-border, #2a2436)",
            border: `1px solid ${rule.isActive ? `${AUTOMATIONS_ACCENT}88` : "var(--panel-border, #2a2436)"}`,
          }}
        >
          <span
            className="absolute top-[2px] w-3 h-3 rounded-full transition-all"
            style={{ left: rule.isActive ? 16 : 2, background: rule.isActive ? AUTOMATIONS_ACCENT : "#6b6478" }}
          />
        </button>
        <div className="text-[13px] font-semibold truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
          {rule.name}
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {rule.fireCount > 0 && (
            <StatusChip color={AUTOMATIONS_ACCENT}>
              {rule.fireCount}× {rule.lastFiredAt ? `· ${fmtAgo(rule.lastFiredAt)}` : ""}
            </StatusChip>
          )}
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] transition hover:bg-[rgba(255,255,255,0.04)]"
            style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
          >
            <PencilLine size={11} /> Edit
          </button>
          <button
            onClick={onRuns}
            className="inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] transition hover:bg-[rgba(255,255,255,0.04)]"
            style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
          >
            <History size={11} /> Runs
          </button>
        </div>
      </div>

      {/* sentence rendering (§6.3) */}
      <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--fg-dim, #9aa)" }}>
        <Fragmt label="When" text={triggerLabel} />
        {rule.conditions.length > 0 && (
          <Fragmt label="if" text={rule.conditions.map(conditionSentence).join(" and ")} />
        )}
        <Fragmt label="then" text={rule.actions.map(actionSentence).join(", ")} />
      </div>
    </div>
  );
}

function Fragmt({ label, text }: { label: string; text: string }) {
  return (
    <span className="mr-1.5">
      <span className="font-semibold" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        {label}{" "}
      </span>
      <span
        className="px-1.5 py-[1px] rounded-md"
        style={{ border: "1px solid var(--panel-border, #2a2436)", background: "rgba(255,255,255,0.02)" }}
      >
        {text}
      </span>
    </span>
  );
}

/** Rule-16 gear content: the automations.enabled kill switch lives in settings. */
function AutomationsSettingsPanel() {
  const { settings, save } = useSettings();
  const automationsSettings = (settings?.automations ?? {}) as { enabled?: boolean };
  const enabled = automationsSettings.enabled !== false;
  return (
    <div className="flex flex-col gap-3 text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>Engine enabled</span>
          <span className="block text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Kill switch — when off, no rule fires. Dry-run tests still work.
          </span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => save({ automations: { ...automationsSettings, enabled: e.target.checked } })}
        />
      </label>
      <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Rules are deterministic: conditions are whitelisted string ops and templates are
        {" {{payload.*}} "}substitution — no code runs from activity text. Destructive tools
        require the confirm checkbox on the rule before they can be saved or fired.
      </p>
    </div>
  );
}
