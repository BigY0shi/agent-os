"use client";

// S16 MCP tab (_design/jarvis-v3-plan.md): the MCP servers Jarvis can reach.
//   Installed  - Jarvis's own external servers (switch on/off, retire, restore) and his
//                built-in `agentos` tools.
//   Elsewhere  - what Claude Code and Hermes have installed, read-only, for reference.
//   Available  - the Hermes catalogue; "Add to Jarvis" opens the wizard prefilled.
//   Wizard     - source and transport -> connection and secrets -> review. Servers are
//                added switched OFF; turning one on is a separate, explained act.
// Secret values are write-only: they go into the POST and never come back.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, Plus, RefreshCw, RotateCcw, Archive, ShieldAlert, X, ChevronLeft, ChevronRight } from "lucide-react";

interface JServer { name: string; transport: "http" | "stdio"; url?: string; command?: string; args?: string[]; headerNames: string[]; envNames: string[]; enabled: boolean; source: string; description?: string; updatedAt: string; retiredAt?: string }
interface Other { name: string; transport: string; url?: string; command?: string; enabled?: boolean }
interface Overview {
  jarvis: JServer[]; retired: JServer[];
  builtin: { name: string; tools: string[]; note: string };
  claudeCode: Other[]; claudeCodeError: string | null;
  hermes: Other[]; hermesError: string | null;
}
interface CatalogEntry { name: string; status: string; description: string; source?: string; authType?: string; transportType?: string }
interface Manifest { name: string; description?: string; source?: string; transportType?: string; authType?: string; envVars: { name: string; prompt: string; secret?: boolean; required?: boolean }[]; bootstrap?: string[]; installUrl?: string }

const API = "/api/v2/jarvis/mcp";
async function call<T>(init?: RequestInit, qs = ""): Promise<T> {
  const r = await fetch(API + qs, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `request failed (${r.status})`);
  return j as T;
}
const post = <T,>(body: unknown) => call<T>({ method: "POST", body: JSON.stringify(body) });

type Section = "installed" | "elsewhere" | "available";

export default function McpTab() {
  const [section, setSection] = useState<Section>("installed");
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wizard, setWizard] = useState<Partial<Draft> | null>(null);
  const [confirmOn, setConfirmOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await call<Overview>()); setErr(null); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (action: string, name: string) => {
    setBusy(`${action}:${name}`);
    try { await post({ action, name }); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); setConfirmOn(null); }
  };

  return (
    <div className="space-y-4" data-mcp-tab>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="MCP sections" className="glass-tabs">
          {([["installed", "Installed"], ["elsewhere", "Claude Code & Hermes"], ["available", "Available"]] as [Section, string][]).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={section === k} onClick={() => setSection(k)} className="glass-tab">{label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass"><RefreshCw size={13} /> Reload</button>
          <button type="button" onClick={() => setWizard({})} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring"><Plus size={13} /> Add a server</button>
        </div>
      </div>
      {err && <p role="alert" className="text-[13px] text-red-300">{err}</p>}
      {!data && !err && <p className="text-[13px] text-[var(--fg-dimmer)]">Reading…</p>}

      {data && section === "installed" && (
        <div className="space-y-3">
          <section className="glass px-5 py-4">
            <div className="glass-eyebrow">Built in · {data.builtin.name}</div>
            <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">{data.builtin.note}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.builtin.tools.map((t) => <span key={t} className="rounded-md px-2 py-0.5 font-mono text-[11px] glass-inset">{t}</span>)}
            </div>
          </section>

          {data.jarvis.length === 0 && (
            <p className="text-[13px] text-[var(--fg-dimmer)]">No external servers installed for Jarvis yet. Add one, or pick one from Available.</p>
          )}
          {data.jarvis.map((s) => (
            <section key={s.name} className="glass px-5 py-4" data-mcp-server={s.name}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Plug size={14} /><span className="font-semibold">{s.name}</span>
                    <span className="rounded px-1.5 py-0.5 text-[10.5px] glass-inset">{s.transport}</span>
                    <span className="text-[11px] text-[var(--fg-dimmer)]">from {s.source}</span></div>
                  <div className="mt-1 truncate font-mono text-[11.5px] text-[var(--fg-dim)]">{s.transport === "http" ? s.url : [s.command, ...(s.args ?? [])].join(" ")}</div>
                  {s.description && <div className="mt-1 text-[12px] text-[var(--fg-dim)]">{s.description}</div>}
                  {(s.headerNames.length > 0 || s.envNames.length > 0) && (
                    <div className="mt-1 text-[11px] text-[var(--fg-dimmer)]">Secrets set: {[...s.headerNames, ...s.envNames].join(", ")} (values never shown)</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" role="switch" aria-checked={s.enabled} aria-label={`${s.enabled ? "Turn off" : "Turn on"} ${s.name}`}
                    disabled={busy !== null}
                    onClick={() => (s.enabled ? void act("disable", s.name) : setConfirmOn(s.name))}
                    className={`relative h-6 w-11 rounded-full transition-colors ${s.enabled ? "bg-[#3b95ff]" : "glass-inset"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${s.enabled ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                  <button type="button" title="Retire (kept, can be restored)" disabled={busy !== null} onClick={() => void act("retire", s.name)} className="rounded-lg p-1.5 glass"><Archive size={13} /></button>
                </div>
              </div>
              {confirmOn === s.name && (
                <div role="alertdialog" aria-label={`Turn on ${s.name}`} className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-[12.5px]">
                  <div className="flex items-center gap-2 font-semibold text-amber-300"><ShieldAlert size={14} /> Before you turn this on</div>
                  <p className="mt-1 text-[var(--fg-dim)]">Jarvis will be able to call every tool this server offers. Those tools do not pass through his own capability gates or the Human-Gate, so a server that can send, buy or delete can do it on his say-so. They are blocked on any turn that has read integration content (email, pages, files), and his tools stay under their own rules. It takes effect on his next turn.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => void act("enable", s.name)} className="rounded-lg px-3 py-1 text-[12px] glass neon-ring">{busy ? <Loader2 size={12} className="animate-spin" /> : "Turn it on"}</button>
                    <button type="button" onClick={() => setConfirmOn(null)} className="rounded-lg px-3 py-1 text-[12px] glass">Cancel</button>
                  </div>
                </div>
              )}
            </section>
          ))}

          {data.retired.length > 0 && (
            <section className="glass-frost px-5 py-4">
              <div className="glass-eyebrow">Retired</div>
              {data.retired.map((s) => (
                <div key={s.name + s.retiredAt} className="mt-2 flex items-center justify-between gap-3 text-[12.5px]">
                  <span><span className="font-semibold">{s.name}</span> <span className="text-[var(--fg-dimmer)]">retired {s.retiredAt?.slice(0, 10)}</span></span>
                  <button type="button" disabled={busy !== null} onClick={() => void act("restore", s.name)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] glass"><RotateCcw size={12} /> Restore (off)</button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {data && section === "elsewhere" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <OtherList title="Claude Code (user scope)" rows={data.claudeCode} error={data.claudeCodeError} />
          <OtherList title="Hermes" rows={data.hermes} error={data.hermesError} />
        </div>
      )}

      {section === "available" && <Available onAdd={(d) => setWizard(d)} installed={new Set(data?.jarvis.map((s) => s.name) ?? [])} />}

      {wizard && <Wizard initial={wizard} onClose={() => setWizard(null)} onAdded={() => { setWizard(null); setSection("installed"); void load(); }} />}
    </div>
  );
}

function OtherList({ title, rows, error }: { title: string; rows: Other[]; error: string | null }) {
  return (
    <section className="glass px-5 py-4">
      <div className="glass-eyebrow">{title} · read-only</div>
      {error && <p role="alert" className="mt-2 text-[12px] text-red-300">{error}</p>}
      {!error && rows.length === 0 && <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">None installed.</p>}
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.name} className="text-[12.5px]">
            <span className="font-semibold">{r.name}</span> <span className="rounded px-1.5 py-0.5 text-[10.5px] glass-inset">{r.transport}</span>
            {r.enabled === false && <span className="ml-1 text-[11px] text-[var(--fg-dimmer)]">off</span>}
            <div className="truncate font-mono text-[11px] text-[var(--fg-dimmer)]">{r.url ?? r.command ?? ""}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Available({ onAdd, installed }: { onAdd: (d: Partial<Draft>) => void; installed: Set<string> }) {
  const [rows, setRows] = useState<CatalogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    call<{ catalog: CatalogEntry[]; error?: string }>(undefined, "?catalog=1")
      .then((j) => { setRows(j.catalog); setErr(j.error ?? null); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  const add = async (c: CatalogEntry) => {
    setOpening(c.name);
    let m: Manifest | null = null;
    try { m = (await call<{ manifest: Manifest }>(undefined, `?manifest=${encodeURIComponent(c.name)}`)).manifest; } catch { m = null; }
    setOpening(null);
    onAdd({
      name: c.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40),
      transport: (m?.transportType ?? c.transportType) === "http" ? "http" : "stdio",
      description: m?.description ?? c.description,
      source: `hermes-catalog:${c.name}`,
      secrets: (m?.envVars ?? []).map((v) => ({ key: v.name, value: "", hint: v.prompt })),
      notes: [m?.source ? `Upstream: ${m.source}` : "", m?.bootstrap?.length ? `Hermes bootstraps it with: ${m.bootstrap.join(" && ")}` : "", m?.installUrl ? `Install from: ${m.installUrl}` : ""].filter(Boolean),
    });
  };
  if (err && !rows?.length) return <p role="alert" className="text-[13px] text-red-300">{err}</p>;
  if (!rows) return <p className="text-[13px] text-[var(--fg-dimmer)]">Reading the Hermes catalogue…</p>;
  if (rows.length === 0) return <p className="text-[13px] text-[var(--fg-dimmer)]">The Hermes catalogue is empty.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((c) => (
        <section key={c.name} className="glass flex flex-col px-5 py-4">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold">{c.name}</span>
            <span className="text-[10.5px] text-[var(--fg-dimmer)]">{[c.transportType, c.authType].filter(Boolean).join(" · ")}</span></div>
          <p className="mt-1 flex-1 text-[12px] text-[var(--fg-dim)]">{c.description}</p>
          <button type="button" disabled={installed.has(c.name) || opening !== null} onClick={() => void add(c)}
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-50">
            {opening === c.name ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}{installed.has(c.name) ? "Installed" : "Add to Jarvis"}
          </button>
        </section>
      ))}
    </div>
  );
}

// ── Wizard ───────────────────────────────────────────────────────────────────
interface Draft { name: string; transport: "http" | "stdio"; description: string; source: string; url: string; command: string; args: string; secrets: { key: string; value: string; hint?: string }[]; notes: string[] }
const blank: Draft = { name: "", transport: "http", description: "", source: "custom", url: "", command: "", args: "", secrets: [], notes: [] };

function Wizard({ initial, onClose, onAdded }: { initial: Partial<Draft>; onClose: () => void; onAdded: () => void }) {
  const [d, setD] = useState<Draft>({ ...blank, ...initial });
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const secretWord = d.transport === "http" ? "Header" : "Environment variable";
  const filled = d.secrets.filter((s) => s.key.trim());

  const submit = async () => {
    setBusy(true); setErr(null);
    const map = Object.fromEntries(filled.map((s) => [s.key.trim(), s.value]));
    const body = d.transport === "http"
      ? { action: "add", name: d.name.trim(), transport: "http", url: d.url.trim(), headers: map, description: d.description, source: d.source }
      : { action: "add", name: d.name.trim(), transport: "stdio", command: d.command.trim(), args: d.args.split("\n").map((a) => a.trim()).filter(Boolean), env: map, description: d.description, source: d.source };
    try { await post(body); onAdded(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const input = "w-full rounded-lg px-3 py-2 text-[13px] glass-inset outline-none focus:ring-1 focus:ring-[#3b95ff]";
  return (
    <div role="dialog" aria-modal="true" aria-label="Add an MCP server" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="glass-strong w-full max-w-lg px-6 py-5">
        <div className="flex items-center justify-between">
          <div><div className="glass-eyebrow">Step {step + 1} of 3</div>
            <div className="type-display mt-1 text-[18px]">{["Source and transport", "Connection", "Review"][step]}</div></div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 glass"><X size={14} /></button>
        </div>

        <div className="mt-4 space-y-3 text-[13px]">
          {step === 0 && (<>
            <label className="block">Name <span className="text-[11px] text-[var(--fg-dimmer)]">(lowercase, digits, hyphens)</span>
              <input className={input} value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
            <fieldset className="flex gap-2"><legend className="mb-1">Transport</legend>
              {(["http", "stdio"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={d.transport === t} onClick={() => set("transport", t)}
                  className={`rounded-lg px-3 py-1.5 text-[12px] glass ${d.transport === t ? "neon-ring" : ""}`}>{t === "http" ? "HTTP (a URL)" : "stdio (a program)"}</button>
              ))}
            </fieldset>
            <label className="block">What it is for <input className={input} value={d.description} onChange={(e) => set("description", e.target.value)} /></label>
            {d.notes.map((n) => <p key={n} className="text-[11.5px] text-[var(--fg-dimmer)]">{n}</p>)}
          </>)}

          {step === 1 && (<>
            {d.transport === "http"
              ? <label className="block">URL <input className={input} value={d.url} placeholder="https://…" onChange={(e) => set("url", e.target.value)} /></label>
              : (<>
                <label className="block">Program <input className={input} value={d.command} placeholder="npx, uvx, a full path…" onChange={(e) => set("command", e.target.value)} /></label>
                <label className="block">Arguments, one per line <textarea className={input} rows={3} value={d.args} onChange={(e) => set("args", e.target.value)} /></label>
              </>)}
            <div>
              <div className="mb-1">{secretWord}s <span className="text-[11px] text-[var(--fg-dimmer)]">(values are stored for Jarvis only and never shown again)</span></div>
              {d.secrets.map((s, i) => (
                <div key={i} className="mb-1.5 flex gap-1.5">
                  <input className={input} aria-label={`${secretWord} name`} placeholder="name" value={s.key} onChange={(e) => set("secrets", d.secrets.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                  <input className={input} aria-label={`${secretWord} value`} type="password" autoComplete="off" placeholder={s.hint ?? "value"} value={s.value} onChange={(e) => set("secrets", d.secrets.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <button type="button" aria-label="Remove" onClick={() => set("secrets", d.secrets.filter((_, j) => j !== i))} className="rounded-lg px-2 glass"><X size={12} /></button>
                </div>
              ))}
              <button type="button" onClick={() => set("secrets", [...d.secrets, { key: "", value: "" }])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] glass"><Plus size={11} /> Add {secretWord.toLowerCase()}</button>
            </div>
          </>)}

          {step === 2 && (
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
              <dt className="text-[var(--fg-dimmer)]">Name</dt><dd>{d.name}</dd>
              <dt className="text-[var(--fg-dimmer)]">Transport</dt><dd>{d.transport}</dd>
              <dt className="text-[var(--fg-dimmer)]">{d.transport === "http" ? "URL" : "Runs"}</dt>
              <dd className="break-all font-mono text-[11.5px]">{d.transport === "http" ? d.url : [d.command, ...d.args.split("\n").filter(Boolean)].join(" ")}</dd>
              <dt className="text-[var(--fg-dimmer)]">{secretWord}s</dt>
              <dd>{filled.length ? filled.map((s) => `${s.key.trim()} (${s.value ? "set" : "empty"})`).join(", ") : "none"}</dd>
              <dt className="text-[var(--fg-dimmer)]">Starts</dt><dd>switched off; turn it on from Installed</dd>
            </dl>
          )}
          {err && <p role="alert" className="text-[12px] text-red-300">{err}</p>}
        </div>

        <div className="mt-5 flex justify-between">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40"><ChevronLeft size={13} /> Back</button>
          {step < 2
            ? <button type="button" onClick={() => setStep(step + 1)} disabled={step === 0 && !d.name.trim()} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring disabled:opacity-40">Next <ChevronRight size={13} /></button>
            : <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring">{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add to Jarvis</button>}
        </div>
      </div>
    </div>
  );
}
