"use client";

// SPEC-D G1 §6.1 — ConnectDialog: three auth lanes.
//   oauth2  → shows the redirectUri to paste into the provider console (copy
//             button), clientId/clientSecret password fields when the
//             definition is unconfigured (write-only PATCH), then [Authorize]
//             → POST /oauth/start → window.location = url.
//   api_key → fields auto-rendered from spec.auth.apiKey.fields (password
//             inputs) → POST /[slug]/connect.
//   local   → single [Connect] button (buzz).
// spec.uiHint renders above the fields (chunk-2 handoff: LAN caveat, "reuse
// Gmail app credentials", …). Connectors with BOTH oauth2 and an api-key path
// (notion) get a lane toggle.

import { useEffect, useState } from "react";
import { Copy, Check, X, Loader2, KeyRound, Globe } from "lucide-react";
import { INTEGRATIONS_ACCENT, connectorIcon, inputStyle, monoStyle, type ConnectorInfo } from "./shared";

export default function ConnectDialog({
  connector,
  onClose,
  onConnected,
}: {
  connector: ConnectorInfo;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [lane, setLane] = useState<"oauth2" | "api_key" | "local">(
    connector.auth === "oauth2" ? "oauth2" : connector.auth,
  );
  const [redirectUri, setRedirectUri] = useState("");
  const [configured, setConfigured] = useState<{ clientId: boolean; clientSecret: boolean } | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hasOauth = connector.auth === "oauth2";
  const hasApiKey = connector.hasApiKey || connector.auth === "api_key";
  const showLaneToggle = hasOauth && hasApiKey;

  useEffect(() => {
    if (!hasOauth) return;
    fetch(`/api/v2/integrations/${connector.slug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.redirectUri) setRedirectUri(j.redirectUri);
        if (j?.configured) setConfigured(j.configured);
      })
      .catch(() => {});
  }, [connector.slug, hasOauth]);

  const copyUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  const authorize = async () => {
    setBusy(true);
    setError(null);
    try {
      // Unconfigured definition: save the pasted app credentials first
      // (write-only — the inputs clear, only booleans come back).
      if (clientId || clientSecret) {
        const patch: Record<string, string> = {};
        if (clientId) patch.clientId = clientId;
        if (clientSecret) patch.clientSecret = clientSecret;
        const pres = await fetch(`/api/v2/integrations/${connector.slug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const pj = await pres.json();
        if (!pres.ok) throw new Error(pj?.error ?? `HTTP ${pres.status}`);
        setClientId("");
        setClientSecret("");
        setConfigured(pj.configured);
      }
      const res = await fetch("/api/v2/integrations/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: connector.slug, returnTo: "/integrations" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      window.location.href = j.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const connectDirect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/integrations/${connector.slug}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setFields({}); // credentials never linger client-side
      onConnected();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const needsAppCreds = configured !== null && (!configured.clientId || !configured.clientSecret);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-2xl p-5"
        style={{ border: `1px solid ${INTEGRATIONS_ACCENT}44`, background: "var(--panel-solid, #14101d)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <div
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: `${INTEGRATIONS_ACCENT}14`, border: `1px solid ${INTEGRATIONS_ACCENT}44`, color: INTEGRATIONS_ACCENT }}
          >
            {connectorIcon(connector.icon, 17)}
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>Connect {connector.name}</h2>
            <span className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{connector.slug}</span>
          </div>
          <button onClick={onClose} className="grid place-items-center w-7 h-7 rounded-md" style={{ color: "var(--fg-dim, #9aa)" }}>
            <X size={15} />
          </button>
        </div>

        {connector.uiHint && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{ border: "1px solid #fbbf2444", background: "#fbbf240d", color: "var(--fg-dim, #9aa)" }}
          >
            {connector.uiHint}
          </div>
        )}

        {showLaneToggle && (
          <div className="mb-3 flex gap-1.5">
            {(["oauth2", "api_key"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLane(l)}
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-medium transition"
                style={{
                  border: `1px solid ${lane === l ? INTEGRATIONS_ACCENT : "var(--panel-border, #2a2436)"}`,
                  color: lane === l ? INTEGRATIONS_ACCENT : "var(--fg-dim, #9aa)",
                  background: lane === l ? `${INTEGRATIONS_ACCENT}0f` : "transparent",
                }}
              >
                {l === "oauth2" ? <Globe size={12} /> : <KeyRound size={12} />}
                {l === "oauth2" ? "OAuth" : "API key"}
              </button>
            ))}
          </div>
        )}

        {lane === "oauth2" && hasOauth && (
          <div className="flex flex-col gap-2.5">
            <div>
              <span className="block mb-1 text-[11px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>
                Redirect URI — register this with the provider, verbatim
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={redirectUri || "…"}
                  className="flex-1 rounded-lg px-2.5 h-8 text-[11.5px] outline-none"
                  style={{ ...inputStyle, ...monoStyle }}
                />
                <button
                  onClick={copyUri}
                  title="Copy"
                  className="grid place-items-center w-8 h-8 rounded-lg"
                  style={{ border: `1px solid ${INTEGRATIONS_ACCENT}55`, color: INTEGRATIONS_ACCENT }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </div>

            {needsAppCreds && (
              <>
                <div>
                  <span className="block mb-1 text-[11px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>clientId</span>
                  <input
                    type="password"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    autoComplete="off"
                    className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <span className="block mb-1 text-[11px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>clientSecret</span>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    autoComplete="off"
                    className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none"
                    style={inputStyle}
                  />
                </div>
              </>
            )}
            {configured !== null && !needsAppCreds && (
              <span className="text-[10.5px]" style={{ color: INTEGRATIONS_ACCENT }}>App credentials configured ✓</span>
            )}

            <button
              onClick={authorize}
              disabled={busy}
              className="mt-1 inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-lg text-[12.5px] font-medium transition disabled:opacity-40"
              style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />} Authorize
            </button>
          </div>
        )}

        {lane === "api_key" && hasApiKey && (
          <div className="flex flex-col gap-2.5">
            {connector.authFields.map((f) => (
              <div key={f.name}>
                <span className="block mb-1 text-[11px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>
                  {f.label ?? f.name}
                </span>
                <input
                  type="password"
                  value={fields[f.name] ?? ""}
                  onChange={(e) => setFields((v) => ({ ...v, [f.name]: e.target.value }))}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none"
                  style={inputStyle}
                />
                {f.description && (
                  <span className="block mt-1 text-[10px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {f.description}
                  </span>
                )}
              </div>
            ))}
            <button
              onClick={connectDirect}
              disabled={busy}
              className="mt-1 inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-lg text-[12.5px] font-medium transition disabled:opacity-40"
              style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Connect
            </button>
          </div>
        )}

        {lane === "local" && (
          <button
            onClick={connectDirect}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-lg text-[12.5px] font-medium transition disabled:opacity-40 w-full"
            style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Connect
          </button>
        )}

        {error && <div className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "#f87171" }}>{error}</div>}
      </div>
    </div>
  );
}
