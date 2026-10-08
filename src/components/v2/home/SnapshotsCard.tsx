"use client";

// S37 Snapshots card on Mission Control > Health. Shows the last snapshot (from its own
// manifest), the scheduled job's last and next run (from the scheduler row), the folder,
// and what is left out; "Snapshot now" takes one; the gear holds every knob (rule 16):
// cadence, folder, keep-last-N, include secrets. Unknown renders as unknown.

import { useCallback, useEffect, useState } from "react";
import { Camera, Loader2, Settings2 } from "lucide-react";

type Cadence = "weekly" | "biweekly" | "monthly" | "off";
const CADENCE_LABEL: Record<Cadence, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", off: "Off" };

interface Summary { name: string; dir: string; createdAt: string; reason: "schedule" | "manual"; totalBytes: number; fileCount: number; includeSecrets: boolean; secretsLeftOut: number; agentOsVersion: string | null }
interface Status {
  settings: { cadence: Cadence; dir: string; keep: number; includeSecrets: boolean };
  source: string;
  root: string | null;
  rootError: string | null;
  running: boolean;
  job: null | { enabled: boolean; rrule: string | null; nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null };
  latest: Summary | null;
  snapshots: Summary[];
  exiled: { stamp: string; names: string[] }[];
  leavesOut: { always: string[]; secrets: string[] };
}

const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "unknown");

export function SnapshotsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"now" | "save" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  const [form, setForm] = useState<{ cadence: Cadence; dir: string; keep: string; includeSecrets: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/snapshots", { cache: "no-store" });
      const j = (await r.json()) as Status & { ok: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setStatus(j);
      setErr(null);
      if (!form) setForm({ cadence: j.settings.cadence, dir: j.settings.dir, keep: String(j.settings.keep), includeSecrets: j.settings.includeSecrets });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [form]);

  useEffect(() => { void load(); }, [load]);

  const snapshotNow = async () => {
    setBusy("now"); setNotice(null); setErr(null);
    try {
      const r = await fetch("/api/v2/snapshots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "now" }) });
      const j = (await r.json()) as Status & { ok: boolean; error?: string; snapshot?: Summary; moved?: string[] };
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setStatus(j);
      setNotice(`Snapshot ${j.snapshot?.name} written: ${j.snapshot?.fileCount} files, ${size(j.snapshot?.totalBytes ?? 0)}${j.moved?.length ? `; moved ${j.moved.length} older snapshot${j.moved.length === 1 ? "" : "s"} to .exile` : ""}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const save = async () => {
    if (!form) return;
    setBusy("save"); setNotice(null); setErr(null);
    try {
      const r = await fetch("/api/v2/snapshots", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cadence: form.cadence, dir: form.dir, keep: Number(form.keep), includeSecrets: form.includeSecrets }) });
      const j = (await r.json()) as Status & { ok: boolean; error?: string | null; pruned?: string[] };
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setStatus(j);
      setNotice(`Saved. ${j.settings.cadence === "off" ? "Scheduled snapshots are off." : `Next scheduled snapshot ${when(j.job?.nextRunAt)}.`}${j.pruned?.length ? ` Moved ${j.pruned.length} older snapshot${j.pruned.length === 1 ? "" : "s"} to .exile.` : ""}`);
      setGear(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const s = status;
  const latest = s?.latest ?? null;
  const job = s?.job ?? null;
  return (
    <section className="glass px-5 py-4" data-snapshots-card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="glass-eyebrow">Snapshots</div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => void snapshotNow()} disabled={busy !== null || !s || !!s.rootError || s.running} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring disabled:opacity-50">
            {busy === "now" || s?.running ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} {busy === "now" || s?.running ? "Taking a snapshot…" : "Snapshot now"}
          </button>
          <button type="button" onClick={() => setGear((g) => !g)} aria-pressed={gear} aria-label="Configure snapshots" title="Configure" className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] ${gear ? "glass neon-ring" : "glass"}`}>
            <Settings2 size={13} /> Configure
          </button>
        </div>
      </div>

      {err && <p role="alert" className="mt-2 text-[12px] text-red-300">{err}</p>}
      {notice && <p className="mt-2 text-[12px] text-emerald-300">{notice}</p>}
      {!s && !err && <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">Reading snapshots…</p>}

      {s && (
        <dl className="mt-2 grid grid-cols-[120px_1fr] gap-y-1 text-[12px]">
          <dt className="text-[var(--fg-dimmer)]">Last snapshot</dt>
          <dd>{latest ? <>{when(latest.createdAt)} <span className="text-[var(--fg-dim)]">({latest.reason === "manual" ? "by hand" : "scheduled"}, {latest.fileCount} files, {size(latest.totalBytes)}{latest.includeSecrets ? ", secrets included" : latest.secretsLeftOut ? `, ${latest.secretsLeftOut} secret file${latest.secretsLeftOut === 1 ? "" : "s"} left out` : ""})</span></> : <span className="text-[var(--fg-dim)]">none yet</span>}</dd>
          <dt className="text-[var(--fg-dimmer)]">Schedule</dt>
          <dd>{CADENCE_LABEL[s.settings.cadence]}{s.settings.cadence !== "off" && (job ? (job.enabled ? <span className="text-[var(--fg-dim)]"> · next {when(job.nextRunAt)}</span> : <span className="text-amber-300"> · held in Standing orders until the next sync</span>) : <span className="text-[var(--fg-dim)]"> · next run unknown (job not registered in this process)</span>)}</dd>
          <dt className="text-[var(--fg-dimmer)]">Last scheduled run</dt>
          <dd>{job?.lastRunAt ? <>{when(job.lastRunAt)} <span style={{ color: job.lastStatus === "ok" ? "#34d399" : "#f87171" }}>{job.lastStatus ?? "unknown"}</span>{job.lastError ? <span className="text-[11px] text-red-300"> {job.lastError}</span> : null}</> : <span className="text-[var(--fg-dim)]">not yet</span>}</dd>
          <dt className="text-[var(--fg-dimmer)]">Folder</dt>
          <dd className="truncate" title={s.root ?? s.rootError ?? ""}>{s.root ?? <span className="text-red-300">{s.rootError}</span>}{s.root ? <span className="text-[var(--fg-dim)]"> · {s.snapshots.length} kept of {s.settings.keep}{s.exiled.length ? `, ${s.exiled.reduce((n, e) => n + e.names.length, 0)} in .exile` : ""}</span> : null}</dd>
        </dl>
      )}

      {gear && form && s && (
        <form className="mt-3 grid gap-3 rounded-xl p-3 glass-inset" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Snapshot settings">
          <label className="grid gap-1 text-[12px]">
            <span className="text-[var(--fg-dim)]">Cadence</span>
            <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value as Cadence })} className="rounded-lg bg-transparent px-2 py-1 glass text-[12px]">
              {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => <option key={c} value={c} className="bg-slate-900">{CADENCE_LABEL[c]}</option>)}
            </select>
            <span className="text-[10.5px] text-[var(--fg-dimmer)]">Weekly and every 2 weeks run Sunday 04:00; monthly runs on the 1st at 04:00. The job also shows in Jarvis &gt; Standing orders.</span>
          </label>
          <label className="grid gap-1 text-[12px]">
            <span className="text-[var(--fg-dim)]">Snapshot folder</span>
            <input value={form.dir} onChange={(e) => setForm({ ...form, dir: e.target.value })} placeholder={`${s.source.replace(/[\\/]\.agentic-os$/, "")}${s.source.includes("\\") ? "\\" : "/"}AgentOS-snapshots (default)`} className="rounded-lg bg-transparent px-2 py-1 glass text-[12px]" />
            <span className="text-[10.5px] text-[var(--fg-dimmer)]">Must be outside {s.source}. Empty uses the default.</span>
          </label>
          <label className="grid gap-1 text-[12px]">
            <span className="text-[var(--fg-dim)]">Keep last</span>
            <input type="number" min={1} max={200} value={form.keep} onChange={(e) => setForm({ ...form, keep: e.target.value })} className="w-24 rounded-lg bg-transparent px-2 py-1 glass text-[12px]" />
            <span className="text-[10.5px] text-[var(--fg-dimmer)]">Older snapshots are moved to the folder&apos;s .exile, never deleted.</span>
          </label>
          <label className="flex items-start gap-2 text-[12px]">
            <input type="checkbox" checked={form.includeSecrets} onChange={(e) => setForm({ ...form, includeSecrets: e.target.checked })} className="mt-0.5" />
            <span>
              <span>Include secrets</span>
              <span className="block text-[10.5px] text-[var(--fg-dimmer)]">Off: these stay out of every snapshot: {s.leavesOut.secrets.length ? s.leavesOut.secrets.join("; ") : "secrets.json, session-secret.json, principals.json, agentos.key, *.env, *.secret, *.token, browser-profiles/, the secret fields of settings.json and config.json"}. On: the snapshot folder holds your keys in plain files.</span>
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring disabled:opacity-50">{busy === "save" ? <Loader2 size={13} className="animate-spin" /> : null} Save</button>
            <button type="button" onClick={() => { setGear(false); setForm({ cadence: s.settings.cadence, dir: s.settings.dir, keep: String(s.settings.keep), includeSecrets: s.settings.includeSecrets }); }} className="rounded-xl px-3 py-1.5 text-[12px] glass">Cancel</button>
          </div>
        </form>
      )}

      {s && (
        <div className="mt-2 text-[10px] text-[var(--fg-dimmer)]">
          Each snapshot holds a backup-API copy of the database, the state folder, a manifest with sizes and hashes, and restore.ps1. Always left out: {s.leavesOut.always.join("; ")}.
        </div>
      )}
    </section>
  );
}
