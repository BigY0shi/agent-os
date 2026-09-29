"use client";

// S14 (_design/jarvis-v3-plan.md): the Skills & Workflows pop-up, on every module.
// Mounted once in the TopBar. It resolves the current module from the URL when it
// opens (Jarvis tabs are their own modules), lists every skill and workflow with
// whether it is on HERE and on EVERYWHERE, switches them per module, runs a workflow
// in place, and creates new ones. A module whose agent calls do not read skills yet
// says so instead of pretending a toggle does something.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, Search, Play, Loader2, Plus, Globe, Copy, Check } from "lucide-react";
import { moduleForPath, SKILL_WIRED, type ModuleEntry } from "@/lib/moduleRegistry";

type SkillSource = "agentos" | "claude" | "skilldb";
const SOURCE_LABEL: Record<SkillSource, string> = { agentos: "Agent OS", claude: "Claude Code", skilldb: "SkillDB" };
interface KitSkill { name: string; description: string; source?: SkillSource; activeHere: boolean; activeGlobal: boolean }
interface KitWorkflow { id: string; name: string; description: string; inputLabel?: string; agent: string; activeHere: boolean; activeGlobal: boolean }
interface Kit { module: ModuleEntry; skills: KitSkill[]; workflows: KitWorkflow[] }
type Tab = "workflows" | "skills" | "new";

function Toggle({ on, label, onChange, disabled, small }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative shrink-0 rounded-full transition disabled:opacity-40 ${small ? "h-4 w-7" : "h-5 w-9"}`}
      style={{ background: on ? "linear-gradient(135deg,#8b5cf6,#3b95ff)" : "rgba(255,255,255,0.1)", boxShadow: "inset 1px 1px 3px rgba(0,0,0,0.4)" }}
    >
      <span
        className={`absolute top-0.5 rounded-full bg-white transition-all ${small ? "h-3 w-3" : "h-4 w-4"}`}
        style={{ left: on ? (small ? 14 : 18) : 2 }}
      />
    </button>
  );
}

export default function ModuleKit() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mod, setMod] = useState<ModuleEntry | null>(null);
  const [kit, setKit] = useState<Kit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("workflows");
  const [q, setQ] = useState("");
  const [runOpen, setRunOpen] = useState<string | null>(null);
  const [runInput, setRunInput] = useState("");
  const [runState, setRunState] = useState<{ id: string; status: "running" | "done" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [src, setSrc] = useState<SkillSource | "all" | "on">("all");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const resolve = useCallback(() => moduleForPath(pathname ?? "/", typeof window === "undefined" ? "" : window.location.search), [pathname]);

  const load = useCallback(async (m: ModuleEntry) => {
    setErr(null);
    try {
      const r = await fetch(`/api/modules/kit?module=${encodeURIComponent(m.id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setKit(j as Kit);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
  }, []);

  // Count badge on the trigger follows the page.
  useEffect(() => { const m = resolve(); setMod(m); if (m) void load(m); else setKit(null); }, [resolve, load]);

  const openKit = () => {
    const m = resolve();
    setMod(m); setOpen(true); setRunOpen(null); setRunState(null); setQ("");
    if (m) void load(m);
    setTimeout(() => searchRef.current?.focus(), 30);
  };
  const close = useCallback(() => { setOpen(false); setTimeout(() => triggerRef.current?.focus(), 0); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  const toggle = async (kind: "skill" | "workflow", name: string, active: boolean, scope: "module" | "global" = "module") => {
    if (!mod) return;
    setBusy(`${kind}:${name}:${scope}`); setErr(null);
    try {
      const r = await fetch("/api/modules/kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: mod.id, kind, name, active, scope }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setKit(j as Kit);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };

  const run = async (wf: KitWorkflow) => {
    if (!mod) return;
    setRunState({ id: wf.id, status: "running", text: "" }); setCopied(false);
    try {
      const r = await fetch(`/api/workflows/${encodeURIComponent(wf.id)}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: mod.id, input: runInput }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.stopped ? "Stopped from the runs tray." : j.error ?? `failed (${r.status})`);
      setRunState({ id: wf.id, status: "done", text: j.output });
    } catch (e) { setRunState({ id: wf.id, status: "error", text: String((e as Error).message ?? e) }); }
  };

  const needle = q.trim().toLowerCase();
  const match = (a: string, b: string) => !needle || a.toLowerCase().includes(needle) || b.toLowerCase().includes(needle);
  const workflows = useMemo(() => (kit?.workflows ?? []).filter((w) => match(w.name, w.description)), [kit, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const skills = useMemo(() => (kit?.skills ?? []).filter((s) =>
    match(s.name, s.description) && (src === "all" || (src === "on" ? s.activeHere || s.activeGlobal : (s.source ?? "agentos") === src)),
  ), [kit, needle, src]); // eslint-disable-line react-hooks/exhaustive-deps
  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of kit?.skills ?? []) { const k = s.source ?? "agentos"; c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [kit]);
  const onHere = (kit?.workflows.filter((w) => w.activeHere || w.activeGlobal).length ?? 0) + (kit?.skills.filter((s) => s.activeHere || s.activeGlobal).length ?? 0);

  if (!mod) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openKit}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-[12px] glass"
        title={`Skills and workflows for ${mod.label}`}
        data-module-kit-trigger={mod.id}
      >
        <Sparkles size={13} aria-hidden />
        Skills &amp; workflows
        {kit && <span className="type-figure rounded-md px-1.5 text-[11px] glass-inset" aria-label={`${onHere} on for this module`}>{onHere}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[96] grid place-items-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={close} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label={`Skills and workflows for ${mod.label}`} className="glass-strong relative flex max-h-[86vh] w-full max-w-[780px] flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, rgba(22,19,34,0.97), rgba(10,9,18,0.97))" }}>
            <header className="flex items-start justify-between gap-3 px-6 pt-5">
              <div>
                <div className="glass-eyebrow">Skills &amp; workflows</div>
                <h2 className="type-display mt-1 text-[24px] leading-tight">{mod.label}</h2>
                <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">Switch what this module uses, run a workflow, or add a new one.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1.5 hover:bg-white/5"><X size={16} /></button>
            </header>

            {!mod.readsSkills && (
              <p className="mx-6 mt-3 rounded-xl px-3 py-2 text-[12px] glass-inset" style={{ color: "#fbbf24" }} role="note">
                {mod.label}&rsquo;s agent calls do not read skills yet, so skills switched on here are saved but have no effect until it is wired.
                Workflows run fine from here. Modules that read skills today: {SKILL_WIRED.length}.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
              <label className="glass-inset flex min-w-[220px] flex-1 items-center gap-2 px-3 py-2">
                <Search size={14} aria-hidden className="text-[var(--fg-dimmer)]" />
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Research, planning, content..." aria-label="Search skills and workflows" className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-dimmer)]" />
              </label>
              <div role="tablist" aria-label="Kind" className="glass-tabs">
                {(["workflows", "skills", "new"] as Tab[]).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="glass-tab capitalize">
                    {t === "new" ? <span className="inline-flex items-center gap-1"><Plus size={12} />New</span> : t}
                    {t === "workflows" && kit && <span className="ml-1 opacity-60">{kit.workflows.length}</span>}
                    {t === "skills" && kit && <span className="ml-1 opacity-60">{kit.skills.length}</span>}
                  </button>
                ))}
              </div>
            </div>

            {err && <p role="alert" className="mx-6 mt-3 text-[12.5px] text-red-300">{err}</p>}

            <div className="mt-4 flex-1 overflow-y-auto px-6 pb-6">
              {!kit && !err && <p className="text-[13px] text-[var(--fg-dimmer)]">Loading…</p>}

              {kit && tab === "workflows" && (
                <ul className="space-y-2" aria-label="Workflows">
                  {workflows.length === 0 && <li className="text-[13px] text-[var(--fg-dimmer)]">{q ? "No workflow matches." : "No workflows yet. Add one under New."}</li>}
                  {workflows.map((w) => (
                    <li key={w.id} className="glass px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[13.5px]">
                            {w.name}
                            {w.activeGlobal && <span className="inline-flex items-center gap-1 rounded px-1.5 text-[10px] glass-inset text-[var(--fg-dimmer)]"><Globe size={10} />everywhere</span>}
                          </div>
                          {w.description && <div className="mt-0.5 text-[12px] text-[var(--fg-dim)]">{w.description}</div>}
                          <div className="mt-1 text-[11px] text-[var(--fg-dimmer)]">Runs on {w.agent}{w.inputLabel ? ` · asks for: ${w.inputLabel}` : ""}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Toggle on={w.activeHere} label={`${w.name}: on for ${mod.label}`} disabled={busy !== null} onChange={(v) => void toggle("workflow", w.id, v)} />
                          <button type="button" onClick={() => { setRunOpen(runOpen === w.id ? null : w.id); setRunInput(""); setRunState(null); }} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] glass" aria-expanded={runOpen === w.id}>
                            <Play size={12} /> Run
                          </button>
                        </div>
                      </div>
                      {runOpen === w.id && (
                        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void run(w); }}>
                          {w.inputLabel && (
                            <label className="block text-[12px] text-[var(--fg-dim)]">
                              {w.inputLabel}
                              <textarea value={runInput} onChange={(e) => setRunInput(e.target.value)} rows={4} required className="mt-1 w-full resize-y rounded-xl px-3 py-2 text-[13px] outline-none glass-inset" />
                            </label>
                          )}
                          <button type="submit" disabled={runState?.status === "running"} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] glass disabled:opacity-50">
                            {runState?.id === w.id && runState.status === "running" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                            {runState?.id === w.id && runState.status === "running" ? `Running on ${w.agent}; it is also in the runs tray` : `Run ${w.name}`}
                          </button>
                          {runState?.id === w.id && runState.status === "error" && <p role="alert" className="text-[12.5px] text-red-300">{runState.text}</p>}
                          {runState?.id === w.id && runState.status === "done" && (
                            <div className="relative">
                              <button type="button" onClick={() => { void navigator.clipboard?.writeText(runState.text); setCopied(true); }} className="absolute right-2 top-2 rounded p-1 hover:bg-white/5" aria-label="Copy result">
                                {copied ? <Check size={13} /> : <Copy size={13} />}
                              </button>
                              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl p-3 pr-9 text-[12.5px] leading-relaxed glass-inset">{runState.text}</pre>
                            </div>
                          )}
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {kit && tab === "skills" && (
                <div role="group" aria-label="Filter skills by source" className="mb-3 flex flex-wrap gap-1.5">
                  {(["all", "on", "agentos", "claude", "skilldb"] as const).filter((k) => k === "all" || k === "on" || sourceCounts[k]).map((k) => (
                    <button key={k} type="button" aria-pressed={src === k} onClick={() => setSrc(k)}
                      className={`rounded-lg px-2.5 py-1 text-[11.5px] ${src === k ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`}>
                      {k === "all" ? "All" : k === "on" ? "On" : SOURCE_LABEL[k]}
                      <span className="ml-1 opacity-60">{k === "all" ? kit.skills.length : k === "on" ? kit.skills.filter((s) => s.activeHere || s.activeGlobal).length : sourceCounts[k]}</span>
                    </button>
                  ))}
                </div>
              )}
              {kit && tab === "skills" && (
                <ul className="space-y-2" aria-label="Skills">
                  {skills.length === 0 && <li className="text-[13px] text-[var(--fg-dimmer)]">{q ? "No skill matches." : "No skills installed. Add one under New."}</li>}
                  {skills.map((s) => (
                    <li key={s.name} className="glass flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="type-figure text-[13px]">{s.name}</span>
                          <span className="rounded px-1.5 text-[10px] glass-inset text-[var(--fg-dimmer)]">{SOURCE_LABEL[s.source ?? "agentos"]}</span>
                        </div>
                        {s.description && <div className="mt-0.5 text-[12px] text-[var(--fg-dim)]">{s.description}</div>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-2 text-[11px] text-[var(--fg-dim)]">
                          here
                          <Toggle on={s.activeHere} label={`${s.name}: on for ${mod.label}`} disabled={busy !== null} onChange={(v) => void toggle("skill", s.name, v)} />
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[var(--fg-dimmer)]">
                          everywhere
                          <Toggle small on={s.activeGlobal} label={`${s.name}: on for every module`} disabled={busy !== null} onChange={(v) => void toggle("skill", s.name, v, "global")} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {tab === "new" && <NewForms module={mod} onCreated={() => { if (mod) void load(mod); }} />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NewForms({ module, onCreated }: { module: ModuleEntry; onCreated: () => void }) {
  const [kind, setKind] = useState<"workflow" | "skill">("workflow");
  const [agents, setAgents] = useState<{ id: string; label: string; installed: boolean }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/agents/list", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const list = (Array.isArray(j) ? j : j.agents ?? []) as { id: string; label: string; kind?: string; installed: boolean }[];
      setAgents(list.filter((a) => a.kind === undefined || a.kind === "cli"));
    }).catch(() => setAgents([]));
  }, []);

  const submit = async (form: HTMLFormElement) => {
    const f = new FormData(form);
    const onHere = f.get("onHere") === "on";
    setSaving(true); setMsg(null);
    try {
      const payload = kind === "workflow"
        ? { name: f.get("name"), description: f.get("description"), prompt: f.get("prompt"), inputLabel: f.get("inputLabel") || undefined, agent: f.get("agent") || "claude" }
        : { name: f.get("name"), description: f.get("description"), body: f.get("body") };
      const r = await fetch(kind === "workflow" ? "/api/workflows" : "/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      const name = kind === "workflow" ? j.workflow.id : j.skill.name;
      if (onHere) {
        const t = await fetch("/api/modules/kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: module.id, kind, name, active: true }) });
        if (!t.ok) throw new Error(`created, but switching it on for ${module.label} failed: ${(await t.json().catch(() => ({}))).error ?? t.status}`);
      }
      setMsg({ ok: true, text: `${kind === "workflow" ? "Workflow" : "Skill"} "${name}" created${onHere ? ` and on for ${module.label}` : ""}.` });
      form.reset();
      onCreated();
    } catch (e) { setMsg({ ok: false, text: String((e as Error).message ?? e) }); }
    finally { setSaving(false); }
  };

  const field = "mt-1 w-full rounded-xl px-3 py-2 text-[13px] outline-none glass-inset";
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="What to add" className="glass-tabs">
        <button type="button" role="tab" aria-selected={kind === "workflow"} onClick={() => setKind("workflow")} className="glass-tab">Workflow</button>
        <button type="button" role="tab" aria-selected={kind === "skill"} onClick={() => setKind("skill")} className="glass-tab">Skill</button>
      </div>
      <p className="text-[12px] text-[var(--fg-dim)]">
        {kind === "workflow"
          ? "A workflow is a saved prompt you run with one click. Put {{input}} where the text you type at run time should go."
          : "A skill is a standing instruction the module's agent follows on every call (a SKILL.md in your skills folder)."}
      </p>
      <form key={kind} className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
        <label className="block text-[12px] text-[var(--fg-dim)]">Name{kind === "skill" ? " (lowercase-with-hyphens)" : ""}
          <input name="name" required maxLength={kind === "skill" ? 64 : 60} pattern={kind === "skill" ? "[a-z0-9]+(-[a-z0-9]+)*" : undefined} className={field} />
        </label>
        <label className="block text-[12px] text-[var(--fg-dim)]">Description
          <input name="description" required={kind === "skill"} maxLength={300} className={field} />
        </label>
        {kind === "workflow" ? (
          <>
            <label className="block text-[12px] text-[var(--fg-dim)]">Prompt
              <textarea name="prompt" required rows={5} maxLength={20000} className={field} placeholder="Draft a LinkedIn post about {{input}}. Plain voice, no em dashes." />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-[12px] text-[var(--fg-dim)]">Ask for input (optional label)
                <input name="inputLabel" maxLength={80} className={field} placeholder="Topic" />
              </label>
              <label className="block text-[12px] text-[var(--fg-dim)]">Runs on
                <select name="agent" className={field} defaultValue="claude">
                  {(agents.length ? agents : [{ id: "claude", label: "Claude", installed: true }]).map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.installed}>{a.label}{a.installed ? "" : " (not installed)"}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        ) : (
          <label className="block text-[12px] text-[var(--fg-dim)]">Instructions
            <textarea name="body" required rows={7} maxLength={24000} className={field} placeholder="When writing for this module, always..." />
          </label>
        )}
        <label className="flex items-center gap-2 text-[12px] text-[var(--fg-dim)]">
          <input type="checkbox" name="onHere" defaultChecked /> Switch it on for {module.label}
        </label>
        <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] glass disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create {kind}
        </button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
      </form>
    </div>
  );
}
