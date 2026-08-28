"use client";

// SPEC-D G1 — Integrations settings gear (rule 16: every knob has an in-app
// gear). §6.1: callbackOrigin + syncEnabled master switch + per-definition
// clientId/clientSecret/webhookSecret (write-only password inputs → PATCH
// /api/v2/integrations/[slug]; only "configured ✓" booleans ever render).

import { useCallback, useEffect, useState } from "react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { INTEGRATIONS_ACCENT, inputStyle, type ConnectorInfo } from "./shared";

interface ConfiguredBooleans {
  clientId: boolean;
  clientSecret: boolean;
  webhookSecret: boolean;
}

export default function IntegrationsSettings({ connectors }: { connectors: ConnectorInfo[] }) {
  const { settings, saving, save } = useSettings();
  const [originDraft, setOriginDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const integrations = (settings?.integrations ?? {}) as {
    callbackOrigin?: string;
    syncEnabled?: boolean;
  };
  const syncEnabled = integrations.syncEnabled !== false;

  useEffect(() => {
    if (settings && originDraft === null) {
      setOriginDraft(integrations.callbackOrigin ?? "http://localhost:3000");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const saveOrigin = async () => {
    const callbackOrigin = (originDraft ?? "").trim().replace(/\/+$/, "") || "http://localhost:3000";
    setOriginDraft(callbackOrigin);
    await save({ integrations: { ...integrations, callbackOrigin } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  // ── per-definition secrets (write-only) ────────────────────────────────────
  const secretable = connectors.filter((c) => c.auth === "oauth2" || c.slug === "slack");
  const [defSlug, setDefSlug] = useState("");
  const [configured, setConfigured] = useState<ConfiguredBooleans | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [defMsg, setDefMsg] = useState<string | null>(null);

  const loadDef = useCallback(async (slug: string) => {
    setConfigured(null);
    setDefMsg(null);
    if (!slug) return;
    try {
      const res = await fetch(`/api/v2/integrations/${slug}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok) setConfigured(j.configured as ConfiguredBooleans);
    } catch {
      setDefMsg("could not load definition state");
    }
  }, []);

  useEffect(() => {
    loadDef(defSlug);
  }, [defSlug, loadDef]);

  const saveDef = async () => {
    if (!defSlug) return;
    const patch: Record<string, string> = {};
    if (clientId) patch.clientId = clientId;
    if (clientSecret) patch.clientSecret = clientSecret;
    if (webhookSecret) patch.webhookSecret = webhookSecret;
    if (Object.keys(patch).length === 0) {
      setDefMsg("nothing to save");
      return;
    }
    setDefMsg(null);
    try {
      const res = await fetch(`/api/v2/integrations/${defSlug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setConfigured(j.configured as ConfiguredBooleans);
      // Write-only: values never linger client-side after save.
      setClientId("");
      setClientSecret("");
      setWebhookSecret("");
      setDefMsg("saved ✓");
    } catch (e) {
      setDefMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const checkMark = (ok: boolean | undefined) => (ok ? "configured ✓" : "not set");

  return (
    <div>
      <Field
        label="OAuth callback origin"
        hint="Must exactly match the redirect URI registered with each provider (<origin>/api/v2/integrations/oauth/callback)."
      >
        <TextInput
          value={originDraft ?? ""}
          onChange={(e) => setOriginDraft(e.target.value)}
          placeholder="http://localhost:3000"
          spellCheck={false}
        />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={saveOrigin} accent={INTEGRATIONS_ACCENT} />

      <label className="mt-4 flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={syncEnabled}
          onChange={(e) => save({ integrations: { ...integrations, syncEnabled: e.target.checked } })}
          className="mt-[2px]"
          style={{ accentColor: INTEGRATIONS_ACCENT }}
        />
        <span>
          <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
            Scheduled sync enabled
          </span>
          <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Master kill switch for SCHEDULED account syncs. Manual &quot;Sync now&quot; always runs.
          </span>
        </span>
      </label>

      {/* per-definition secrets */}
      <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
        <span className="block mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--fg-dim, #9aa)" }}>
          Provider app credentials
        </span>
        <select
          value={defSlug}
          onChange={(e) => setDefSlug(e.target.value)}
          className="w-full rounded-lg px-2 h-8 text-[12.5px] outline-none mb-2"
          style={inputStyle}
        >
          <option value="">— pick a connector —</option>
          {secretable.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>

        {defSlug && (
          <div className="flex flex-col gap-2">
            <div>
              <span className="block mb-1 font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                clientId · {checkMark(configured?.clientId)}
              </span>
              <input
                type="password"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="leave blank to keep"
                className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none"
                style={inputStyle}
                autoComplete="off"
              />
            </div>
            <div>
              <span className="block mb-1 font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                clientSecret · {checkMark(configured?.clientSecret)}
              </span>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="leave blank to keep"
                className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none"
                style={inputStyle}
                autoComplete="off"
              />
            </div>
            <div>
              <span className="block mb-1 font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                webhookSecret {defSlug === "slack" ? "(Slack signing secret)" : ""} · {checkMark(configured?.webhookSecret)}
              </span>
              <input
                type="password"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="leave blank to keep"
                className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none"
                style={inputStyle}
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveDef}
                className="inline-flex items-center px-3 h-8 rounded-lg text-[12px] font-medium transition"
                style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
              >
                Save credentials
              </button>
              {defMsg && <span className="text-[11px]" style={{ color: defMsg === "saved ✓" ? INTEGRATIONS_ACCENT : "#f87171" }}>{defMsg}</span>}
            </div>
            <span className="text-[10px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              Values are write-only — stored encrypted server-side and never shown again.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
