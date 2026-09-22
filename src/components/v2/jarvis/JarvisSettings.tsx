"use client";

// SPEC-C C2.7 — the Jarvis voice/hotkey settings fields (rule 16: every knob in
// an in-app gear). Mounted inside ChatboxOverlay's gear panel; reusable from
// the /jarvis page gear too. Receives the SHARED settings instance from
// JarvisOmnipresence so a toggle takes effect in the open overlay immediately.

import { useEffect, useState } from "react";
import { KeyRound, ExternalLink, Glasses, Copy } from "lucide-react";
import type { Settings } from "@/components/ConfigMenu";
import { VOICE_PROVIDERS } from "@/lib/v2/jarvis/useVoiceCapture";

const ACCENT = "#22d3ee";

interface JarvisVoiceSettings {
  provider?: string;
  autoSend?: boolean;
  pushToTalk?: boolean;
}
interface JarvisHotkeySettings {
  key?: string;
  enabled?: boolean;
}
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

export default function JarvisSettings({
  settings,
  save,
  saving,
}: {
  settings: Settings | null;
  save: (patch: Partial<Settings>) => Promise<Settings | null>;
  saving: boolean;
}) {
  const jarvis = (settings?.jarvis ?? {}) as {
    engine?: "sdk" | "cli";
    cliAgent?: string;
    voice?: JarvisVoiceSettings;
    hotkey?: JarvisHotkeySettings;
    glasses?: JarvisGlassesSettings;
  };
  const voice = jarvis.voice ?? {};
  const hotkey = jarvis.hotkey ?? {};
  const engine = jarvis.engine ?? "sdk";
  const cliAgent = jarvis.cliAgent ?? "claude";
  const provider = voice.provider ?? "webspeech";
  const autoSend = voice.autoSend ?? false;
  const pushToTalk = voice.pushToTalk ?? true;
  const hotkeyKey = hotkey.key ?? "F13";
  const hotkeyEnabled = hotkey.enabled ?? true;

  const [keyDraft, setKeyDraft] = useState(hotkeyKey);
  useEffect(() => setKeyDraft(hotkeyKey), [hotkeyKey]);

  // Helper secret status ("configured ✓" only — the secret itself is never rendered).
  const [helper, setHelper] = useState<{ configured: boolean; lastFireAt: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/jarvis/hotkey", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive) setHelper({ configured: !!j?.configured, lastFireAt: j?.lastFireAt ?? null });
      })
      .catch(() => {
        if (alive) setHelper(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const patchVoice = (p: Partial<JarvisVoiceSettings>) => save({ jarvis: { voice: p } } as Partial<Settings>);
  const patchHotkey = (p: Partial<JarvisHotkeySettings>) => save({ jarvis: { hotkey: p } } as Partial<Settings>);
  const patchGlasses = (p: Partial<JarvisGlassesSettings>) => save({ jarvis: { glasses: p } } as Partial<Settings>);

  // G2 glasses lane. Status carries no key material; a freshly minted token is
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

  const selected = VOICE_PROVIDERS.find((p) => p.id === provider);
  const selectedAvailability = selected ? selected.available() : true;

  const label = "block text-[11px] font-semibold uppercase tracking-wide mb-1";
  const field =
    "w-full bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border,#2a2436)] rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--panel-border-hot,#4a4456)] text-[var(--fg,#e8e2f0)]";

  return (
    <div className="space-y-4 text-[13px]" style={{ color: "var(--fg-dim, #9aa)" }}>
      {/* ── Brain engine (SPEC-C C3, rule 16) ── */}
      <div>
        <span className={label} style={{ color: ACCENT }}>Brain engine</span>
        <select
          className={field}
          value={engine}
          onChange={(e) => save({ jarvis: { engine: e.target.value } } as Partial<Settings>)}
          disabled={saving}
        >
          <option value="sdk">sdk — warm Claude session with tools (memory, tasks, navigate)</option>
          <option value="cli">cli — answer-only fallback (no tools)</option>
        </select>
        {engine === "cli" && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className={field}
              style={{ maxWidth: 160 }}
              defaultValue={cliAgent}
              disabled={saving}
              onBlur={(e) => {
                const v = e.target.value.trim() || "claude";
                if (v !== cliAgent) save({ jarvis: { cliAgent: v } } as Partial<Settings>);
              }}
              placeholder="claude"
            />
            <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              CLI agent (claude / codex / cursor / …) — answer-only, tools disabled
            </span>
          </div>
        )}
      </div>

      {/* ── Voice capture ── */}
      <div>
        <span className={label} style={{ color: ACCENT }}>Voice provider</span>
        <select
          className={field}
          value={provider}
          onChange={(e) => patchVoice({ provider: e.target.value })}
          disabled={saving}
        >
          {VOICE_PROVIDERS.map((p) => {
            const avail = p.available();
            return (
              <option key={p.id} value={p.id} disabled={avail !== true} title={avail === true ? p.label : avail}>
                {p.label}{avail === true ? "" : " — unavailable"}
              </option>
            );
          })}
        </select>
        {selectedAvailability !== true && (
          <div className="mt-1 text-[11.5px]" style={{ color: "#fbbf24" }} title={String(selectedAvailability)}>
            {String(selectedAvailability)}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={autoSend}
          disabled={saving}
          onChange={(e) => patchVoice({ autoSend: e.target.checked })}
        />
        <span>
          Auto-send on mic release
          <span className="block text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Default OFF — releasing the mic drops the transcript into the text box for review; Enter/Send dispatches.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={pushToTalk}
          disabled={saving}
          onChange={(e) => patchVoice({ pushToTalk: e.target.checked })}
        />
        <span>
          Hold-to-talk mic
          <span className="block text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            On = hold the mic button while speaking. Off = click once to start, click again to stop.
          </span>
        </span>
      </label>

      {/* ── Hotkey ── */}
      <div className="pt-2 border-t" style={{ borderColor: "var(--panel-border, #2a2436)" }}>
        <span className={label} style={{ color: ACCENT }}>
          <KeyRound size={12} className="inline mr-1" style={{ color: ACCENT }} />
          Hotkey
        </span>
        <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
          <input
            type="checkbox"
            checked={hotkeyEnabled}
            disabled={saving}
            onChange={(e) => patchHotkey({ enabled: e.target.checked })}
          />
          <span>In-app keybind (works when a tab is focused, even without the helper)</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            className={field}
            style={{ maxWidth: 140 }}
            value={keyDraft}
            disabled={saving}
            onChange={(e) => setKeyDraft(e.target.value)}
            onBlur={() => {
              const k = keyDraft.trim() || "F13";
              if (k !== hotkeyKey) patchHotkey({ key: k });
            }}
            placeholder="F13"
          />
          <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            KeyboardEvent.key value (F13…F24, F9, etc.)
          </span>
        </div>

        <div className="mt-3 text-[12px]">
          {helper === null ? (
            <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>helper status unavailable</span>
          ) : helper.configured ? (
            <span style={{ color: "#34d399" }}>
              helper secret configured ✓
              {helper.lastFireAt && (
                <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {" "}· last fire {new Date(helper.lastFireAt).toLocaleTimeString()}
                </span>
              )}
            </span>
          ) : (
            <span style={{ color: "#fbbf24" }}>no helper secret yet</span>
          )}
          <a
            href="/api/jarvis/hotkey/setup"
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex items-center gap-1 underline"
            style={{ color: ACCENT }}
            title="Generates the secret on first open + returns the AutoHotkey helper script and install steps"
          >
            OS-global helper install <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* ── Even Realities G2 glasses (custom agent lane, /api/glasses) ── */}
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
    </div>
  );
}
