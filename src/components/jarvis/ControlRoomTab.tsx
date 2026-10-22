"use client";

// S15 Control Room (_design/jarvis-v3-plan.md): monitor and manage everything from one
// tab. Status (host + local services + plain-words checks), the skills and workflows
// of EVERY module as one switchable matrix, Claude Code plugins, measured insights,
// and the settings of every module (secrets masked; they never reach this page).
// Every number here is read from a live source at load time; nothing is estimated.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Loader2, Check, X, Search, ChevronDown, ChevronRight, Save } from "lucide-react";
import { MODULES, SKILL_WIRED, getModule } from "@/lib/moduleRegistry";

type Section = "status" | "matrix" | "plugins" | "insights" | "settings";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `${url} failed (${r.status})`);
  return j as T;
}
const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;
const dur = (ms: number | null) => (ms == null ? "–" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`);
const ago = (t: number | string | null) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round((Date.now() - (typeof t === "string" ? Date.parse(t) : t)) / 1000));
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function ControlRoomTab() {
  const [section, setSection] = useState<Section>("status");
  return (
    <div className="space-y-4" data-control-room>
      <div role="tablist" aria-label="Control Room sections" className="glass-tabs">
        {([
          ["status", "Status"], ["matrix", "Skills & workflows"], ["plugins", "Plugins"], ["insights", "Insights"], ["settings", "Settings"],
        ] as [Section, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={section === k} onClick={() => setSection(k)} className="glass-tab">{label}</button>
        ))}
      </div>
      {section === "status" && <StatusSection />}
      {section === "matrix" && <MatrixSection />}
      {section === "plugins" && <PluginsSection />}
      {section === "insights" && <InsightsSection />}
      {section === "settings" && <SettingsSection />}
    </div>
  );
}

// ── Status ────────────────────────────────────────────────────────────────────
interface Health {
  host: { hostname: string; platform: string; release: string; uptimeSec: number; cpu: { percent: number; perCore: number[]; cores: number; model: string };
    memory: { totalBytes: number; freeBytes: number; usedPercent: number }; disks: { mount: string; totalBytes: number; freeBytes: number; usedPercent: number }[];
    loadavg: [number, number, number] | null; sampledAt: string };
  services: { id: string; name: string; url: string | null; state: "ok" | "down" | "not-configured"; ms: number | null; detail: string; optional?: boolean }[];
  checks: { id: string; label: string; ok: boolean; detail: string }[];
  clear: number; total: number; status: "optimal" | "strain" | "needs-a-look";
}
const STATUS_WORD: Record<Health["status"], [string, string]> = {
  optimal: ["Optimal", "#34d399"], strain: ["Under strain", "#fbbf24"], "needs-a-look": ["Needs a look", "#f87171"],
};

function Bar({ pct, tint = "#8b5cf6" }: { pct: number; tint?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full glass-inset" aria-hidden>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: `linear-gradient(90deg, ${tint}, #3b95ff)` }} />
    </div>
  );
}

function StatusSection() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setH(await getJson<Health>("/api/control/health")); setErr(null); } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (err && !h) return <p role="alert" className="text-[13px] text-red-300">Could not read health: {err}</p>;
  if (!h) return <p className="text-[13px] text-[var(--fg-dimmer)]">Measuring…</p>;
  const [word, tint] = STATUS_WORD[h.status];
  return (
    <div className="space-y-4">
      <section className="glass-strong flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <div className="glass-eyebrow">Overall</div>
          <div className="type-display mt-1 text-[30px] leading-none" style={{ color: tint }}>{word}</div>
          <div className="mt-2 text-[12.5px] text-[var(--fg-dim)]">{h.clear} of {h.total} checks clear · {h.host.hostname} · {h.host.platform} · up {Math.round(h.host.uptimeSec / 3600)} h</div>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Measure again
        </button>
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="glass px-5 py-4">
          <div className="glass-eyebrow">Processor</div>
          <div className="type-figure mt-1 text-[28px] leading-none">{h.host.cpu.percent}%</div>
          <div className="mt-1 truncate text-[11px] text-[var(--fg-dimmer)]" title={h.host.cpu.model}>{h.host.cpu.cores} cores · {h.host.cpu.model}</div>
          <div className="mt-3 grid grid-cols-8 gap-1" aria-label="Per-core load">
            {h.host.cpu.perCore.map((p, i) => (
              <div key={i} className="h-8 rounded glass-inset flex items-end overflow-hidden" title={`core ${i}: ${p}%`}>
                <div className="w-full" style={{ height: `${Math.max(4, p)}%`, background: "linear-gradient(180deg,#3b95ff,#8b5cf6)" }} />
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-[var(--fg-dimmer)]">
            Load average: {h.host.loadavg ? h.host.loadavg.map((x) => x.toFixed(2)).join(" / ") : "not available on Windows"}
          </div>
        </div>
        <div className="glass px-5 py-4">
          <div className="glass-eyebrow">Memory</div>
          <div className="type-figure mt-1 text-[28px] leading-none">{h.host.memory.usedPercent}%</div>
          <div className="mt-1 text-[11px] text-[var(--fg-dimmer)]">{gb(h.host.memory.totalBytes - h.host.memory.freeBytes)} used of {gb(h.host.memory.totalBytes)}</div>
          <div className="mt-3"><Bar pct={h.host.memory.usedPercent} /></div>
        </div>
        <div className="glass px-5 py-4">
          <div className="glass-eyebrow">Storage</div>
          {h.host.disks.map((d) => (
            <div key={d.mount} className="mt-2">
              <div className="flex justify-between text-[12px]"><span className="type-figure">{d.mount}</span><span className="text-[var(--fg-dim)]">{gb(d.freeBytes)} free</span></div>
              <div className="mt-1"><Bar pct={d.usedPercent} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="glass px-5 py-4" aria-label="Local services">
          <div className="glass-eyebrow mb-2">Local services</div>
          <ul className="space-y-1.5">
            {h.services.map((s) => (
              <li key={s.id} className="flex items-center gap-3 text-[13px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.state === "ok" ? "#34d399" : s.state === "down" ? (s.optional ? "#6b7280" : "#f87171") : "#6b7280" }} aria-hidden />
                <span className="flex-1">{s.name}{s.optional && <span className="ml-1 text-[11px] text-[var(--fg-dimmer)]">(optional)</span>}</span>
                <span className="type-figure text-[11.5px] text-[var(--fg-dim)]">{s.state === "ok" ? `${s.ms} ms` : s.state === "down" ? s.detail : s.detail}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass px-5 py-4" aria-label="Checks">
          <div className="glass-eyebrow mb-2">Checks</div>
          <ul className="space-y-1.5">
            {h.checks.map((c) => (
              <li key={c.id} className="flex items-center gap-3 text-[13px]">
                {c.ok ? <Check size={14} className="shrink-0 text-emerald-300" aria-label="clear" /> : <X size={14} className="shrink-0 text-red-300" aria-label="failing" />}
                <span className="flex-1">{c.label}</span>
                <span className="text-[11.5px] text-[var(--fg-dim)]">{c.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-[11px] text-[var(--fg-dimmer)]">Measured {ago(h.host.sampledAt)}; refreshes every 15 s while this tab is visible.</p>
    </div>
  );
}

// ── Skills & workflows matrix ─────────────────────────────────────────────────
interface SkillsRes { installed: { name: string; description: string }[]; active: { global: string[]; modules: Record<string, string[]> } }
interface WorkflowsRes { workflows: { id: string; name: string }[]; active: { global: string[]; modules: Record<string, string[]> } }

function MatrixSection() {
  const [kind, setKind] = useState<"skill" | "workflow">("skill");
  const [skills, setSkills] = useState<SkillsRes | null>(null);
  const [wfs, setWfs] = useState<WorkflowsRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([getJson<SkillsRes>("/api/skills"), getJson<WorkflowsRes>("/api/workflows")]);
      setSkills(s); setWfs(w); setErr(null);
    } catch (e) { setErr(String((e as Error).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cols = kind === "skill" ? (skills?.installed.map((s) => ({ id: s.name, label: s.name })) ?? []) : (wfs?.workflows.map((w) => ({ id: w.id, label: w.name })) ?? []);
  const active = kind === "skill" ? skills?.active : wfs?.active;
  const rows = useMemo(() => MODULES.filter((m) => !q || m.label.toLowerCase().includes(q.toLowerCase()) || m.id.includes(q.toLowerCase())), [q]);

  const toggle = async (module: string, name: string, on: boolean, scope: "module" | "global" = "module") => {
    const key = `${module}:${name}:${scope}`;
    setBusy(key); setErr(null);
    try {
      const r = await fetch("/api/modules/kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module, kind, name, active: on, scope }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      await load();
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Kind" className="glass-tabs">
          <button type="button" role="tab" aria-selected={kind === "skill"} onClick={() => setKind("skill")} className="glass-tab">Skills</button>
          <button type="button" role="tab" aria-selected={kind === "workflow"} onClick={() => setKind("workflow")} className="glass-tab">Workflows</button>
        </div>
        <label className="glass-inset flex min-w-[220px] items-center gap-2 px-3 py-2">
          <Search size={14} aria-hidden className="text-[var(--fg-dimmer)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter modules" aria-label="Filter modules" className="w-full bg-transparent text-[13px] outline-none" />
        </label>
        <span className="text-[11.5px] text-[var(--fg-dimmer)]">
          {SKILL_WIRED.length} of {MODULES.length} modules read skills today; the rest save the setting and apply it once wired. Add new ones from any module&rsquo;s Skills &amp; workflows button.
        </span>
      </div>
      {err && <p role="alert" className="text-[12.5px] text-red-300">{err}</p>}
      {!active ? <p className="text-[13px] text-[var(--fg-dimmer)]">Loading…</p> : cols.length === 0 ? (
        <p className="text-[13px] text-[var(--fg-dimmer)]">No {kind}s yet.</p>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="text-left">
                <th className="sticky left-0 z-10 bg-[rgba(12,14,22,0.92)] px-3 py-2 font-medium">Module</th>
                {cols.map((c) => <th key={c.id} className="px-2 py-2 font-medium"><span className="type-figure text-[11.5px]">{c.label}</span></th>)}
              </tr>
              <tr className="text-left text-[11px] text-[var(--fg-dimmer)]">
                <th className="sticky left-0 z-10 bg-[rgba(12,14,22,0.92)] px-3 pb-2 font-normal">Everywhere</th>
                {cols.map((c) => {
                  const on = active.global.includes(c.id);
                  return (
                    <th key={c.id} className="px-2 pb-2">
                      <input type="checkbox" checked={on} disabled={busy !== null} onChange={(e) => void toggle("mission-control", c.id, e.target.checked, "global")} aria-label={`${c.label} on for every module`} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-white/5">
                  <th scope="row" className="sticky left-0 z-10 bg-[rgba(12,14,22,0.92)] px-3 py-1.5 text-left font-normal">
                    <Link href={m.route} className="hover:underline">{m.label}</Link>
                    {kind === "skill" && !m.readsSkills && <span className="ml-2 text-[10px] text-[var(--fg-dimmer)]">not wired</span>}
                  </th>
                  {cols.map((c) => {
                    const on = (active.modules[m.id] ?? []).includes(c.id);
                    return (
                      <td key={c.id} className="px-2 py-1.5">
                        <input type="checkbox" checked={on} disabled={busy !== null} onChange={(e) => void toggle(m.id, c.id, e.target.checked)} aria-label={`${c.label} on for ${m.label}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Plugins ───────────────────────────────────────────────────────────────────
function PluginsSection() {
  const [list, setList] = useState<{ id: string; name: string; marketplace: string; enabled: boolean }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    try { setList((await getJson<{ plugins: { id: string; name: string; marketplace: string; enabled: boolean }[] }>("/api/control/plugins")).plugins); setErr(null); }
    catch (e) { setErr(String((e as Error).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/control/plugins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setNote(`${id} ${enabled ? "enabled" : "disabled"}. It takes effect in your next Claude Code session. Previous settings kept at ${j.backup}.`);
      await load();
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };
  const shown = (list ?? []).filter((p) => !q || p.id.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-[var(--fg-dim)]">
        Claude Code plugins. They apply to every Claude Code session, not to one module, and a change takes effect in the next session. Each change keeps a copy of the previous settings.
      </p>
      <label className="glass-inset flex max-w-[360px] items-center gap-2 px-3 py-2">
        <Search size={14} aria-hidden className="text-[var(--fg-dimmer)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter plugins" aria-label="Filter plugins" className="w-full bg-transparent text-[13px] outline-none" />
      </label>
      {err && <p role="alert" className="text-[12.5px] text-red-300">{err}</p>}
      {note && <p role="status" className="text-[12.5px] text-emerald-300">{note}</p>}
      {!list && !err && <p className="text-[13px] text-[var(--fg-dimmer)]">Loading…</p>}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {shown.map((p) => (
          <li key={p.id} className="glass flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{p.name}</div>
              <div className="truncate text-[11px] text-[var(--fg-dimmer)]">{p.marketplace}</div>
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-[var(--fg-dim)]">
              <input type="checkbox" checked={p.enabled} disabled={busy !== null} onChange={(e) => void toggle(p.id, e.target.checked)} aria-label={`${p.id} enabled`} />
              {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : p.enabled ? "on" : "off"}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Insights ──────────────────────────────────────────────────────────────────
interface Insights {
  window: { runsKept: number; note: string };
  runs: { running: number; finished: number; done: number; failed: number; stopped: number;
    byModule: { module: string; total: number; last24h: number; last7d: number; done: number; error: number; stopped: number; lost: number; running: number; avgMs: number | null; lastAt: number }[] };
  agents: { entries: { agentId: string; name: string; status: string; detail?: string; since: number }[]; error: string | null };
  jarvis: { live: number; archived: number; messages: number } | null;
  skills: { global: string[]; modules: { module: string; count: number; readsSkills: boolean }[]; wiredModules: number; totalModules: number };
  workflows: { total: number; global: number; modules: { module: string; count: number }[] };
}

function InsightsSection() {
  const [d, setD] = useState<Insights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getJson<Insights>("/api/control/insights").then(setD).catch((e) => setErr(String((e as Error).message))); }, []);
  if (err) return <p role="alert" className="text-[13px] text-red-300">Could not read insights: {err}</p>;
  if (!d) return <p className="text-[13px] text-[var(--fg-dimmer)]">Loading…</p>;
  const tiles: [string, number | string][] = [
    ["Running now", d.runs.running], ["Finished (kept)", d.runs.finished], ["Done", d.runs.done], ["Failed", d.runs.failed], ["Stopped", d.runs.stopped],
    ["Jarvis sessions", d.jarvis ? d.jarvis.live : "–"], ["Jarvis messages", d.jarvis ? d.jarvis.messages : "–"], ["Workflows", d.workflows.total],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className="glass px-4 py-3">
            <div className="glass-eyebrow">{k}</div>
            <div className="type-figure mt-1 text-[24px] leading-none">{v}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--fg-dimmer)]">Runs: {d.window.note} ({d.window.runsKept} kept now), so these are recent activity, not all-time totals.</p>
      <section className="glass overflow-x-auto" aria-label="Runs by module">
        <table className="w-full min-w-[620px] text-[12.5px]">
          <thead><tr className="text-left text-[11px] text-[var(--fg-dimmer)]">
            {["Module", "24 h", "7 d", "Done", "Failed", "Stopped", "Avg time", "Last"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {d.runs.byModule.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-[var(--fg-dimmer)]">No runs recorded yet.</td></tr>}
            {d.runs.byModule.map((m) => (
              <tr key={m.module} className="border-t border-white/5">
                <td className="px-3 py-1.5">{getModule(m.module)?.label ?? m.module}</td>
                <td className="type-figure px-3">{m.last24h}</td><td className="type-figure px-3">{m.last7d}</td>
                <td className="type-figure px-3">{m.done}</td><td className="type-figure px-3">{m.error + m.lost}</td><td className="type-figure px-3">{m.stopped}</td>
                <td className="type-figure px-3">{dur(m.avgMs)}</td><td className="px-3 text-[var(--fg-dim)]">{ago(m.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="glass px-5 py-4" aria-label="Agents">
          <div className="glass-eyebrow mb-2">Agents</div>
          {d.agents.error && <p className="text-[12px] text-red-300">{d.agents.error}</p>}
          {d.agents.entries.length === 0 && !d.agents.error && <p className="text-[12.5px] text-[var(--fg-dimmer)]">No agents configured.</p>}
          <ul className="space-y-1.5">
            {d.agents.entries.map((a) => (
              <li key={a.agentId} className="flex items-center gap-3 text-[13px]">
                <span className="flex-1">{a.name}</span>
                <span className="text-[11.5px] text-[var(--fg-dim)]">{a.status}{a.detail ? `: ${a.detail}` : ""} · since {ago(a.since)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass px-5 py-4" aria-label="Skills in use">
          <div className="glass-eyebrow mb-2">Skills in use</div>
          <p className="text-[12.5px] text-[var(--fg-dim)]">On everywhere: {d.skills.global.length ? d.skills.global.join(", ") : "none"}.</p>
          <ul className="mt-2 space-y-1 text-[12.5px]">
            {d.skills.modules.map((m) => (
              <li key={m.module} className="flex justify-between"><span>{getModule(m.module)?.label ?? m.module}</span><span className="text-[var(--fg-dim)]">{m.count} on{m.readsSkills ? "" : " (not wired yet)"}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-[var(--fg-dimmer)]">{d.skills.wiredModules} of {d.skills.totalModules} modules read skills today.</p>
        </section>
      </div>
    </div>
  );
}

// ── Settings (every module; secrets masked) ───────────────────────────────────
function SettingsSection() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => { getJson<{ settings: Record<string, unknown> }>("/api/control/settings").then((j) => setSettings(j.settings)).catch((e) => setErr(String((e as Error).message))); }, []);
  const keys = useMemo(() => Object.keys(settings ?? {}).filter((k) => !q || k.toLowerCase().includes(q.toLowerCase())).sort(), [settings, q]);

  const openKey = (k: string) => {
    if (open === k) { setOpen(null); return; }
    setOpen(k); setMsg(null); setDraft(JSON.stringify(settings?.[k], null, 2));
  };
  const save = async (k: string) => {
    let value: unknown;
    try { value = JSON.parse(draft); } catch (e) { setMsg({ ok: false, text: `Not valid JSON: ${(e as Error).message}` }); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/control/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setSettings(j.settings); setDraft(JSON.stringify(j.settings[k], null, 2));
      setMsg({ ok: true, text: `${k} saved. It takes effect on the next request; no restart needed.` });
    } catch (e) { setMsg({ ok: false, text: String((e as Error).message) }); } finally { setSaving(false); }
  };

  if (err) return <p role="alert" className="text-[13px] text-red-300">Could not read settings: {err}</p>;
  if (!settings) return <p className="text-[13px] text-[var(--fg-dimmer)]">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-[var(--fg-dim)]">
        Every module&rsquo;s settings. Keys and secrets show as ******** and stay as they are unless you type a new value in their place. Each module&rsquo;s own gear is still the friendlier editor; this is the full view.
      </p>
      <label className="glass-inset flex max-w-[360px] items-center gap-2 px-3 py-2">
        <Search size={14} aria-hidden className="text-[var(--fg-dimmer)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter settings blocks" aria-label="Filter settings blocks" className="w-full bg-transparent text-[13px] outline-none" />
      </label>
      <ul className="space-y-2">
        {keys.map((k) => {
          const mod = getModule(k);
          const v = settings[k];
          const summary = v && typeof v === "object" ? `${Array.isArray(v) ? v.length : Object.keys(v as object).length} ${Array.isArray(v) ? "items" : "fields"}` : String(v);
          return (
            <li key={k} className="glass">
              <button type="button" onClick={() => openKey(k)} aria-expanded={open === k} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
                {open === k ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="type-figure text-[13px]">{k}</span>
                <span className="text-[11.5px] text-[var(--fg-dimmer)]">{summary}</span>
                {mod && <Link href={mod.route} onClick={(e) => e.stopPropagation()} className="ml-auto text-[11.5px] text-[var(--fg-dim)] hover:underline">Open {mod.label}</Link>}
              </button>
              {open === k && (
                <div className="space-y-2 px-4 pb-4">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} rows={Math.min(24, Math.max(4, draft.split("\n").length + 1))} aria-label={`${k} settings JSON`} className="type-figure w-full resize-y rounded-xl p-3 text-[12px] outline-none glass-inset" />
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => void save(k)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] glass disabled:opacity-50">
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save {k}
                    </button>
                    {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12px] ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</span>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
