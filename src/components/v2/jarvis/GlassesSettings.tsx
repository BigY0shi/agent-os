"use client";

// Jarvis gear → Glasses: the Even Realities G2 custom-agent lane (/api/glasses).
// Kept in its own file so JarvisSettings only mounts it (rule 16: every knob
// in the in-app gear). Receives the SHARED settings instance like its parent.

import { useEffect, useState } from "react";
import { Glasses, Copy } from "lucide-react";
import type { Settings } from "@/components/ConfigMenu";

const ACCENT = "#22d3ee";

interface JarvisGlassesSettings {
  enabled?: boolean;
  maxWords?: number;
  idleMinutes?: number;
  timeoutSeconds?: number;
}
interface GlassesLaneStatus {
  configured: boolean;
  lastRequestAt: string | null;
  lastError: string | null;
  path: string;
}

export default function GlassesSettings({
  settings,
  save,
  saving,
}: {
  settings: Settings | null;
  save: (patch: Partial<Settings>) => Promise<Settings | null>;
  saving: boolean;
}) {
  const jarvis = (settings?.jarvis ?? {}) as { glasses?: JarvisGlassesSettings };
  const patchGlasses = (p: Partial<JarvisGlassesSettings>) => save({ jarvis: { glasses: p } } as Partial<Settings>);

  // Status carries no key material; a freshly minted token is
  // held in component state only until the panel closes (it is never re-fetchable).
  const glasses = jarvis.glasses ?? {};
  const [glassesLane, setGlassesLane] = useState<GlassesLaneStatus | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [glassesBusy, setGlassesBusy] = useState(false);
  const [glassesErr, setGlassesErr] = useState<string | null>(null);
  const loadGlassesLane = () =>
    fetch("/api/v2/jarvis/glasses", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: GlassesLaneStatus) => setGlassesLane(j))
      .catch(() => setGlassesLane(null));
  useEffect(() => {
    loadGlassesLane();
  }, []);
  const glassesAction = async (method: "POST" | "DELETE") => {
    if (method === "POST" && glassesLane?.configured &&
      !window.confirm("Replace the current glasses token? The Even app stops working until you paste the new one.")) return;
    setGlassesBusy(true);
    setGlassesErr(null);
    try {
      const r = await fetch("/api/v2/jarvis/glasses", {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ action: "rotate" }) } : {}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setFreshToken(method === "POST" ? j.token : null);
      await loadGlassesLane();
    } catch (e) {
      setGlassesErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGlassesBusy(false);
    }
  };
  const field =
    "w-full bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border,#2a2436)] rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--panel-border-hot,#4a4456)] text-[var(--fg,#e8e2f0)]";
  const label = "block text-[11px] font-semibold uppercase tracking-wide mb-1";
  const numberField = (key: keyof Omit<JarvisGlassesSettings, "enabled">, value: number, hint: string) => (
    <label className="flex items-center gap-2">
      <input
        type="number"
        className={field}
        style={{ maxWidth: 90 }}
        defaultValue={value}
        disabled={saving}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v !== value) patchGlasses({ [key]: v });
        }}
      />
      <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{hint}</span>
    </label>
  );

  return (
    <div className="pt-2 border-t" style={{ borderColor: "var(--panel-border, #2a2436)" }}>
      <span className={label} style={{ color: ACCENT }}>
        <Glasses size={12} className="inline mr-1" style={{ color: ACCENT }} />
        Glasses (Even Realities G2)
      </span>
      <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
        <input
          type="checkbox"
          checked={glasses.enabled === true}
          disabled={saving}
          onChange={(e) => patchGlasses({ enabled: e.target.checked })}
        />
        <span>
          Answer the glasses
          <span className="block text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Off = the endpoint refuses every request (403), even with a valid token.
          </span>
        </span>
      </label>
      <div className="space-y-1.5 mb-3">
        {numberField("maxWords", glasses.maxWords ?? 60, "max words per reply (the lens fits ~15 short lines)")}
        {numberField("idleMinutes", glasses.idleMinutes ?? 10, "minutes of silence before a fresh conversation")}
        {numberField("timeoutSeconds", glasses.timeoutSeconds ?? 40, "seconds before giving up with a timeout error")}
      </div>

      <div className="text-[12px] space-y-1.5">
        <div>
          Even app → Settings → Even AI → Agent Configure. URL:{" "}
          <code className="text-[11.5px]" style={{ color: "var(--fg, #e8e2f0)" }}>
            https://&lt;your-tailscale-host&gt;{glassesLane?.path ?? "/api/glasses/v1"}
          </code>
          <span className="block text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            The app calls from your phone, so a private Tailscale HTTPS address works while the phone is on your tailnet.
          </span>
        </div>
        {glassesLane === null ? (
          <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>glasses status unavailable</span>
        ) : glassesLane.configured ? (
          <span style={{ color: "#34d399" }}>
            token configured ✓
            <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {" "}· last request {glassesLane.lastRequestAt ? new Date(glassesLane.lastRequestAt).toLocaleTimeString() : "none since server start"}
            </span>
          </span>
        ) : (
          <span style={{ color: "#fbbf24" }}>no token yet</span>
        )}
        {glassesLane?.lastError && (
          <div style={{ color: "#f87171" }}>last error: {glassesLane.lastError}</div>
        )}
        {freshToken && (
          <div className="rounded-lg p-2" style={{ background: "rgba(34,211,238,0.08)", border: `1px solid ${ACCENT}` }}>
            <div className="text-[11px] mb-1" style={{ color: ACCENT }}>
              Paste this into the Token field now. It is shown once and cannot be retrieved later.
            </div>
            <div className="flex items-center gap-2">
              <code className="text-[11.5px] break-all" style={{ color: "var(--fg, #e8e2f0)" }}>{freshToken}</code>
              <button
                type="button"
                className="shrink-0"
                title="Copy token"
                onClick={() => navigator.clipboard?.writeText(freshToken).catch(() => {})}
              >
                <Copy size={13} style={{ color: ACCENT }} />
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            className="underline"
            style={{ color: ACCENT }}
            disabled={glassesBusy}
            onClick={() => glassesAction("POST")}
          >
            {glassesLane?.configured ? "Replace token" : "Generate token"}
          </button>
          {glassesLane?.configured && (
            <button
              type="button"
              className="underline"
              style={{ color: "#f87171" }}
              disabled={glassesBusy}
              onClick={() => glassesAction("DELETE")}
            >
              Revoke
            </button>
          )}
        </div>
        {glassesErr && <div style={{ color: "#f87171" }}>{glassesErr}</div>}
      </div>
    </div>
  );
}
