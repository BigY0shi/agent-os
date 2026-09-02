"use client";

// SPEC-C C2.7 — the Jarvis voice/hotkey settings fields (rule 16: every knob in
// an in-app gear). Mounted inside ChatboxOverlay's gear panel; reusable from
// the /jarvis page gear too. Receives the SHARED settings instance from
// JarvisOmnipresence so a toggle takes effect in the open overlay immediately.

import { useEffect, useState } from "react";
import { KeyRound, ExternalLink } from "lucide-react";
import type { Settings } from "@/components/ConfigMenu";
import { VOICE_PROVIDERS } from "@/lib/v2/jarvis/useVoiceCapture";

const ACCENT = "#22d3ee";

interface JarvisVoiceSettings {
  provider?: string;
  ttsProvider?: string;
  autoSend?: boolean;
  pushToTalk?: boolean;
}
interface JarvisHotkeySettings {
  key?: string;
  enabled?: boolean;
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

  // Reply voice (TTS) + Voicebox studio. The profile list comes from the studio
  // itself; when it is down the select is empty and the reason is shown.
  const vb = ((settings as unknown as { voicebox?: { url?: string; profile?: string } })?.voicebox) ?? {};
  const ttsProvider = voice.ttsProvider ?? "voicebox";
  const [vbProfiles, setVbProfiles] = useState<{ id: string; name: string; engine: string | null }[]>([]);
  const [vbError, setVbError] = useState<string | null>(null);
  const [vbHealth, setVbHealth] = useState<{ modelLoaded: boolean; gpu: boolean; backend: string | null } | null>(null);
  const [vbUrlDraft, setVbUrlDraft] = useState(vb.url ?? "http://127.0.0.1:17493");
  useEffect(() => setVbUrlDraft(vb.url ?? "http://127.0.0.1:17493"), [vb.url]);
  useEffect(() => {
    let alive = true;
    fetch("/api/voicebox/profiles", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.ok) { setVbProfiles(j.profiles ?? []); setVbHealth(j.health ?? null); setVbError(null); }
        else { setVbProfiles([]); setVbError(j?.error || "Voicebox not answering"); }
      })
      .catch((e) => { if (alive) { setVbProfiles([]); setVbError(String(e)); } });
    return () => { alive = false; };
  }, [vb.url]);

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

      {/* ── Reply voice (what SPEAKS the answer) ── */}
      <div className="pt-2 border-t" style={{ borderColor: "var(--panel-border, #2a2436)" }}>
        <span className={label} style={{ color: ACCENT }}>Reply voice</span>
        <select
          className={field}
          value={ttsProvider}
          onChange={(e) => patchVoice({ ttsProvider: e.target.value })}
          disabled={saving}
        >
          <option value="voicebox">Voicebox (local studio, cloned voices)</option>
          <option value="local">Kokoro (local, port 8880)</option>
          <option value="elevenlabs">ElevenLabs</option>
          <option value="openai">OpenAI</option>
          <option value="auto">Auto: Kokoro, then ElevenLabs, then OpenAI</option>
        </select>
        {ttsProvider === "voicebox" && (
          <div className="mt-2 space-y-2">
            <select
              className={field}
              value={vb.profile ?? ""}
              onChange={(e) => save({ voicebox: { profile: e.target.value } } as unknown as Partial<Settings>)}
              disabled={saving || !vbProfiles.length}
            >
              <option value="">{vbProfiles.length ? `Studio default (${vbProfiles[0].name})` : "No profiles"}</option>
              {vbProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.engine ? ` · ${p.engine}` : ""}</option>
              ))}
            </select>
            {vbError ? (
              <div className="text-[11.5px]" style={{ color: "#fbbf24" }}>{vbError}</div>
            ) : vbHealth ? (
              <div className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                Studio {vbHealth.modelLoaded ? "model loaded" : "model not loaded yet (first speech loads it)"}
                {vbHealth.backend ? ` · ${vbHealth.backend}` : ""}{vbHealth.gpu ? " · GPU" : " · CPU"}
              </div>
            ) : null}
            <input
              className={field}
              value={vbUrlDraft}
              onChange={(e) => setVbUrlDraft(e.target.value)}
              onBlur={() => { if (vbUrlDraft !== (vb.url ?? "")) save({ voicebox: { url: vbUrlDraft } } as unknown as Partial<Settings>); }}
              placeholder="http://127.0.0.1:17493"
              spellCheck={false}
              disabled={saving}
              title="Voicebox studio URL. Loopback only; a remote host is refused."
            />
          </div>
        )}
      </div>

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
    </div>
  );
}
