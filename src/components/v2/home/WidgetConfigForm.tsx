"use client";

// ── WidgetConfigForm (SPEC-D §6.5, H2.2) ────────────────────────────────────
// Auto-renders a widget's registry configSchema into a per-cell config form:
//   input          → text field
//   select         → option select
//   toggle         → checkbox
//   account-select → select over the CONNECTED accounts of field.connector
//                    (fetched from GET /api/v2/integrations at render time —
//                    a static schema can't know accounts; H3.3 calendar is the
//                    first consumer). Saves into cell.config via onSave.

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import type { WidgetConfigField, WidgetDef } from "@/lib/v2/widgets/types";

interface AccountOption {
  value: string;
  label: string;
}

/** slug → connected active accounts; undefined = still loading, null = fetch failed. */
function useConnectorAccounts(
  slugs: string[],
): Partial<Record<string, AccountOption[] | null>> {
  const [bySlug, setBySlug] = useState<Record<string, AccountOption[] | null>>({});
  const key = slugs.join(",");

  useEffect(() => {
    if (slugs.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v2/integrations", { cache: "no-store" });
        const j = (await res.json()) as {
          connectors?: Array<{
            slug: string;
            accounts?: Array<{ id: string; accountId: string; displayName: string | null; isActive: boolean }>;
          }>;
        };
        if (cancelled) return;
        const next: Record<string, AccountOption[] | null> = {};
        for (const slug of slugs) {
          const connector = (j.connectors ?? []).find((c) => c.slug === slug);
          next[slug] = (connector?.accounts ?? [])
            .filter((a) => a.isActive)
            .map((a) => ({ value: a.id, label: a.displayName || a.accountId }));
        }
        setBySlug(next);
      } catch {
        if (!cancelled) setBySlug(Object.fromEntries(slugs.map((s) => [s, null])));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return bySlug;
}

const fieldStyle: React.CSSProperties = {
  border: "1px solid var(--panel-border, #2a2436)",
  background: "var(--panel, rgba(255,255,255,0.02))",
  color: "var(--fg, #e8e2f0)",
};

export default function WidgetConfigForm({
  def,
  config,
  onSave,
  onCancel,
}: {
  def: WidgetDef;
  config: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const schema = useMemo(() => def.configSchema ?? [], [def.configSchema]);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seeded: Record<string, unknown> = {};
    for (const f of schema) {
      seeded[f.key] = config[f.key] ?? f.default ?? (f.type === "toggle" ? false : "");
    }
    return seeded;
  });

  const accountSlugs = useMemo(
    () =>
      [...new Set(schema.filter((f) => f.type === "account-select" && f.connector).map((f) => f.connector!))],
    [schema],
  );
  const accountsBySlug = useConnectorAccounts(accountSlugs);

  const set = (key: string, v: unknown) => setValues((cur) => ({ ...cur, [key]: v }));

  const renderField = (field: WidgetConfigField) => {
    const value = values[field.key];
    switch (field.type) {
      case "toggle":
        return (
          <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => set(field.key, e.target.checked)}
            />
            {field.label}
          </label>
        );
      case "select":
        return (
          <select
            value={typeof value === "string" ? value : String(value ?? "")}
            onChange={(e) => set(field.key, e.target.value)}
            className="h-8 w-full rounded-md px-2 text-[12px]"
            style={fieldStyle}
            aria-label={field.label}
          >
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "account-select": {
        const accounts = field.connector ? accountsBySlug[field.connector] : [];
        if (accounts === null) {
          return (
            <div className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              accounts unreachable — is the server up?
            </div>
          );
        }
        if (accounts === undefined) {
          return (
            <div className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              loading accounts…
            </div>
          );
        }
        if (accounts.length === 0) {
          // Honest empty state: no fake options, point at /integrations.
          return (
            <div className="font-mono text-[11px]" style={{ color: "#fbbf24" }}>
              no connected '{field.connector}' account — {field.placeholder || "connect one on /integrations"}
            </div>
          );
        }
        return (
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set(field.key, e.target.value)}
            className="h-8 w-full rounded-md px-2 text-[12px]"
            style={fieldStyle}
            aria-label={field.label}
          >
            <option value="">— pick an account —</option>
            {accounts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      }
      default:
        return (
          <input
            type="text"
            value={typeof value === "string" ? value : String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(e) => set(field.key, e.target.value)}
            className="h-8 w-full rounded-md px-2 font-mono text-[12px]"
            style={fieldStyle}
            aria-label={field.label}
          />
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-label={`Configure ${def.title}`}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl p-4"
        style={{
          border: "1px solid var(--panel-border, #2a2436)",
          background: "var(--panel-solid, #17121f)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--fg-dim, #9aa)" }}>
          Configure · {def.title}
        </div>

        <div className="flex flex-col gap-3">
          {schema.map((field) => (
            <div key={field.key}>
              {field.type !== "toggle" ? (
                <div className="mb-1 text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
                  {field.label}
                  {field.required ? <span style={{ color: "#f87171" }}> *</span> : null}
                </div>
              ) : null}
              {renderField(field)}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11px]"
            style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
          >
            <X size={12} /> Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(values)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11px]"
            style={{ border: "1px solid #34d39955", color: "#34d399" }}
          >
            <Check size={12} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
