"use client";

// ── RabbitSettings — the /rabbit gear ───────────────────────────────────────
// Two halves. CONNECTION: what to type into the R1's "local" screen (base URL,
// and a key only if "Require API key" is on), read from the cookie-gated
// /api/rabbit/setup — the only route that returns the key. The key is the
// owner's own text (or a generated short one). KNOBS: every settings.rabbit.*
// key, all read server side at request time, so a change applies to the next
// turn with no restart.

import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, RefreshCw, Check } from "lucide-react";
import QRCode from "qrcode";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { MODELS, RABBIT_PERSONA } from "@/lib/v2/rabbit/openai";
import { RABBIT_ACCENT } from "./shared";

interface RabbitCfg {
  enabled?: boolean;
  requireKey?: boolean;
  defaultModel?: string;
  persona?: string;
  historyTurns?: number;
  sessionGapMinutes?: number;
  retentionDays?: number;
  mastermindAgents?: string[];
  mastermindSequential?: boolean;
  publicBaseUrl?: string;
}

interface RoomAgentChip { id: string; name: string; color: string }
const DEFAULT_PANEL = ["claude", "codex", "cursor"];

interface SetupInfo {
  secret: string;
  baseUrl: string;
  chatUrl: string;
  models: string[];
  requireKey: boolean;
}

const clampInt = (raw: string, fallback: number, min: number, max: number) =>
  Math.min(Math.max(parseInt(raw, 10) || fallback, min), max);

const btnStyle: React.CSSProperties = {
  border: "1px solid var(--panel-border, #2a2436)",
  background: "var(--panel, rgba(255,255,255,0.02))",
  color: "var(--fg-dim, #9aa)",
};

export default function RabbitSettings() {
  const { settings, saving, save } = useSettings();
  const rabbit = (settings?.rabbit ?? {}) as RabbitCfg;

  const [persona, setPersona] = useState<string | null>(null);
  const [turns, setTurns] = useState<string | null>(null);
  const [gap, setGap] = useState<string | null>(null);
  const [retention, setRetention] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  // R1 Creation install: the QR the R1 camera scans carries {title,url,...};
  // the url includes the key so the device stores it and never asks for typing.
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const installBase = (publicUrl ?? rabbit.publicBaseUrl ?? "").trim().replace(/\/+$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  // public/ files are served at their exact path (no directory index in Next).
  const installUrl = installBase && setup ? `${installBase}/rabbit-creation/index.html?key=${encodeURIComponent(setup.secret)}` : "";
  // rabbit's own QR generator (creations-sdk/qr) always ships an iconUrl; an
  // empty one was a difference from the reference the device may not tolerate.
  const iconUrl = installBase ? `${installBase}/rabbit-creation/icon.png` : "";
  useEffect(() => {
    if (!installUrl) { setQr(null); return; }
    const payload = JSON.stringify({ title: "Agent OS", url: installUrl, description: "Talk to your PC's agents from the R1", iconUrl, themeColor: "#ff7a1a" });
    let cancelled = false;
    QRCode.toDataURL(payload, { margin: 1, width: 220, color: { dark: "#000000", light: "#ffffff" } })
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [installUrl, iconUrl]);

  const [roster, setRoster] = useState<RoomAgentChip[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const panel = Array.isArray(rabbit.mastermindAgents) ? rabbit.mastermindAgents : DEFAULT_PANEL;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/room", { cache: "no-store" });
        const j = (await r.json()) as { agents?: RoomAgentChip[]; error?: string };
        if (cancelled) return;
        if (!r.ok || !Array.isArray(j.agents)) setRosterError(j.error ?? `room answered ${r.status}`);
        else setRoster(j.agents.map((a) => ({ id: a.id, name: a.name, color: a.color })));
      } catch (e) {
        if (!cancelled) setRosterError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (persona === null) setPersona(rabbit.persona ?? "");
    if (turns === null) setTurns(String(rabbit.historyTurns ?? 24));
    if (gap === null) setGap(String(rabbit.sessionGapMinutes ?? 120));
    if (retention === null) setRetention(String(rabbit.retentionDays ?? 30));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/rabbit/setup", { cache: "no-store" });
        const j = (await r.json()) as Partial<SetupInfo> & { error?: string };
        if (cancelled) return;
        if (!r.ok || !j.secret) setSetupError(j.error ?? `setup answered ${r.status}`);
        else { setSetup(j as SetupInfo); setKeyDraft(j.secret); }
      } catch (e) {
        if (!cancelled) setSetupError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 1200); } catch { /* clipboard blocked over plain http */ }
  }

  async function postSetup(body: Record<string, unknown>) {
    setKeyBusy(true);
    setKeyMsg(null);
    try {
      const r = await fetch("/api/rabbit/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as Partial<SetupInfo> & { error?: string };
      if (!r.ok || !j.secret) { setKeyMsg(j.error ?? `setup answered ${r.status}`); return; }
      setSetup(j as SetupInfo);
      setKeyDraft(j.secret);
      setKeyMsg(body.action === "rotate" ? "New key generated." : "Key saved.");
      setTimeout(() => setKeyMsg(null), 2000);
    } finally { setKeyBusy(false); }
  }

  async function saveAll() {
    await save({
      rabbit: {
        ...rabbit,
        persona: (persona ?? "").trim(),
        historyTurns: clampInt(turns ?? "24", 24, 0, 200),
        sessionGapMinutes: clampInt(gap ?? "120", 120, 1, 10_080),
        retentionDays: clampInt(retention ?? "30", 30, 0, 3650),
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const enabled = rabbit.enabled !== false;
  const requireKey = rabbit.requireKey === true;
  const keyDirty = setup !== null && keyDraft !== null && keyDraft.trim() !== setup.secret;

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: RABBIT_ACCENT }}>Connection</div>
      {setupError && (
        <div className="text-[12px] mb-3 rounded-md px-2.5 py-2" style={{ background: "rgba(248,113,113,0.1)", color: "#f87171" }}>
          Could not read the connection details: {setupError}
        </div>
      )}
      <Field label="Endpoint (base URL)" hint="Paste this into the R1's local-endpoint field. It is the address you opened Agent OS at — LAN on home Wi-Fi, Tailscale elsewhere.">
        <div className="flex items-center gap-1.5">
          <TextInput readOnly value={setup?.baseUrl ?? ""} placeholder="loading…" />
          <IconBtn title="Copy" onClick={() => setup && copy("url", setup.baseUrl)} active={copied === "url"} />
        </div>
      </Field>
      <Field label="Require API key" hint="OFF: the R1 connects with its 'no key' option, and so can anyone else who can reach this address on your network. ON: the key below must be sent as the API key.">
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim, #9aa)" }}>
          <input
            type="checkbox"
            checked={requireKey}
            disabled={!settings}
            onChange={(e) => void save({ rabbit: { ...rabbit, requireKey: e.target.checked } })}
            style={{ accentColor: RABBIT_ACCENT }}
          />
          Ask the R1 for an API key
        </label>
      </Field>
      <Field label="API key" hint={requireKey ? "Type your own (4+ characters, no spaces) and Save, or Generate a short random one. Then put the same text in the R1's API-key field." : "Not used while 'Require API key' is off. Set one anyway so it is ready the day you switch it on."}>
        <div className="flex items-center gap-1.5">
          <TextInput
            type={reveal ? "text" : "password"}
            value={keyDraft ?? ""}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="loading…"
            autoComplete="off"
            spellCheck={false}
            style={{ fontFamily: "ui-monospace, monospace" }}
          />
          <IconBtn title={reveal ? "Hide" : "Reveal"} onClick={() => setReveal((v) => !v)} icon={reveal ? <EyeOff size={13} /> : <Eye size={13} />} />
          <IconBtn title="Copy" onClick={() => setup && copy("key", setup.secret)} active={copied === "key"} />
          <IconBtn title="Generate a short random key" onClick={() => void postSetup({ action: "rotate" })} icon={<RefreshCw size={13} className={keyBusy ? "animate-spin" : ""} />} />
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            disabled={!keyDirty || keyBusy}
            onClick={() => void postSetup({ action: "set", secret: (keyDraft ?? "").trim() })}
            className="px-3 h-8 rounded-md text-[12px] font-semibold disabled:opacity-40"
            style={{ background: RABBIT_ACCENT, color: "#2a1200" }}
          >
            Save key
          </button>
          {keyMsg && <span className="text-[11.5px]" style={{ color: keyMsg.endsWith(".") ? "var(--fg-dim, #9aa)" : "#f87171" }}>{keyMsg}</span>}
        </div>
      </Field>

      <div className="text-[11px] font-semibold uppercase tracking-wide mt-5 mb-2" style={{ color: RABBIT_ACCENT }}>Bridge</div>
      <Field label="Bridge enabled" hint="OFF answers every R1 request with 503 — a kill switch that needs no restart.">
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim, #9aa)" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!settings}
            onChange={(e) => void save({ rabbit: { ...rabbit, enabled: e.target.checked } })}
            style={{ accentColor: RABBIT_ACCENT }}
          />
          Serve /api/rabbit/v1 to the R1
        </label>
      </Field>
      <Field label="Default model" hint='What the R1 gets when it sends no model or "agentos-claude". Any other id in the list can be picked on the device itself.'>
        <select
          value={rabbit.defaultModel ?? "agentos-claude"}
          disabled={!settings}
          onChange={(e) => void save({ rabbit: { ...rabbit, defaultModel: e.target.value } })}
          className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
          style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" }}
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.id} — {m.note}</option>)}
        </select>
      </Field>
      <Field label="Persona (system prompt)" hint="Prefix for every turn. Leave empty for the built-in R1 persona (plain spoken sentences, no markdown).">
        <textarea
          value={persona ?? ""}
          onChange={(e) => setPersona(e.target.value)}
          placeholder={RABBIT_PERSONA}
          rows={4}
          className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none resize-y"
          style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" }}
        />
      </Field>
      <Field label="History turns" hint="Prior turns packed into each claude -p call (the CLI is stateless per call). 0 = no memory.">
        <TextInput type="number" min={0} max={200} value={turns ?? ""} onChange={(e) => setTurns(e.target.value)} />
      </Field>
      <Field label="Session gap (minutes)" hint="A reply echoed back after longer than this starts a new session instead of continuing the old one.">
        <TextInput type="number" min={1} max={10080} value={gap ?? ""} onChange={(e) => setGap(e.target.value)} />
      </Field>
      <Field label="Archive idle after (days)" hint='Threshold for the "Archive idle" button on the page. 0 archives every active session that is not mid-turn.'>
        <TextInput type="number" min={0} max={3650} value={retention ?? ""} onChange={(e) => setRetention(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={() => void saveAll()} accent={RABBIT_ACCENT} />

      <div className="text-[11px] font-semibold uppercase tracking-wide mt-5 mb-2" style={{ color: RABBIT_ACCENT }}>Mastermind panel</div>
      <Field label="Who answers" hint='Pick model "agentos-mastermind" on the R1 and these room agents answer as a panel, each in its own voice. @mention one in a message to hear only that one. Requests for device functions still go to Claude.'>
        {roster === null ? (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{rosterError ? `Could not load the room roster: ${rosterError}` : "loading roster…"}</div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {roster.map((a) => {
              const on = panel.includes(a.id);
              return (
                <label key={a.id} className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim, #9aa)" }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!settings}
                    onChange={(e) => {
                      const next = e.target.checked ? [...panel, a.id] : panel.filter((x) => x !== a.id);
                      void save({ rabbit: { ...rabbit, mastermindAgents: roster.filter((r) => next.includes(r.id)).map((r) => r.id) } });
                    }}
                    style={{ accentColor: a.color }}
                  />
                  <span style={{ color: a.color }}>●</span> {a.name}
                </label>
              );
            })}
          </div>
        )}
      </Field>
      <Field label="Round order" hint="Sequential = each agent sees what the previous one said (the real roundtable), but the reply takes N× longer. Parallel = everyone answers at once, about the speed of a single reply.">
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim, #9aa)" }}>
          <input
            type="checkbox"
            checked={rabbit.mastermindSequential !== false}
            disabled={!settings}
            onChange={(e) => void save({ rabbit: { ...rabbit, mastermindSequential: e.target.checked } })}
            style={{ accentColor: RABBIT_ACCENT }}
          />
          Agents build on each other (sequential)
        </label>
      </Field>

      <div className="text-[11px] font-semibold uppercase tracking-wide mt-5 mb-2" style={{ color: RABBIT_ACCENT }}>R1 Creation</div>
      <Field label="Public address of this box" hint="Where the R1 reaches Agent OS from anywhere — a tailscale funnel or other HTTPS front (e.g. https://desktop.hair-halfmoon.ts.net). Leave empty to use the address you opened this page at.">
        <div className="flex items-center gap-1.5">
          <TextInput value={publicUrl ?? rabbit.publicBaseUrl ?? ""} onChange={(e) => setPublicUrl(e.target.value)} placeholder={typeof window !== "undefined" ? window.location.origin : "https://…"} />
          <button
            type="button"
            disabled={publicUrl === null || saving}
            onClick={() => void save({ rabbit: { ...rabbit, publicBaseUrl: (publicUrl ?? "").trim().replace(/\/+$/, "") } }).then(() => setPublicUrl(null))}
            className="shrink-0 px-3 h-8 rounded-md text-[12px] font-semibold disabled:opacity-40"
            style={{ background: RABBIT_ACCENT, color: "#2a1200" }}
          >
            Save
          </button>
        </div>
      </Field>
      <Field label="Install on the R1" hint='On the R1 open the camera and scan this code; the Creation installs with the API key baked in (nothing to type). "Require API key" must be ON for a public address.'>
        {qr ? (
          <div className="flex flex-col items-center gap-2 rounded-md p-2" style={{ background: "#fff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Install QR for the Agent OS R1 Creation" width={220} height={220} />
          </div>
        ) : (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>QR appears once the key has loaded.</div>
        )}
        <div className="flex items-center gap-1.5 mt-2">
          <TextInput readOnly value={installUrl} style={{ fontFamily: "ui-monospace, monospace" }} />
          <IconBtn title="Copy install URL" onClick={() => installUrl && copy("install", installUrl)} active={copied === "install"} />
        </div>
        {!requireKey && installUrl && !/^https?:\/\/(localhost|127\.|192\.168\.|10\.)/.test(installUrl) && (
          <div className="text-[11.5px] mt-1.5" style={{ color: "#f87171" }}>This address is not a private LAN address and "Require API key" is off — anyone who finds it can use your subscriptions. Switch the key on.</div>
        )}
      </Field>
    </div>
  );
}

function IconBtn({ title, onClick, icon, active }: { title: string; onClick: () => void; icon?: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md transition"
      style={{ ...btnStyle, color: active ? RABBIT_ACCENT : btnStyle.color }}
    >
      {active ? <Check size={13} /> : (icon ?? <Copy size={13} />)}
    </button>
  );
}
