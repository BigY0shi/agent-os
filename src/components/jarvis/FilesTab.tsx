"use client";

// S28 Files (_design/jarvis-v3-plan.md; owner: "a Files tab to view and EDIT files right
// in the OS"). Left: every agent. Middle: its files, grouped. Right: the editor. The
// server decides what can be opened (an allow-list per agent), masks secrets, keeps the
// previous version of every save, and refuses a save when the file changed since it was
// opened. Files that shape an agent open read-only until the owner says so.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Save, Loader2, FileText, RotateCcw, History, ShieldAlert } from "lucide-react";

type Group = "identity" | "memory" | "configuration" | "skills";
interface Entry { id: string; source: string; rel: string; name: string; group: Group; sensitive: boolean; format: string; size: number; mtimeMs: number }
interface Source { key: string; name: string; kind: string; rootLabel: string; files: Entry[]; error?: string }
interface Listing { sources: Source[]; counts: { agents: number; files: number; lastChanged: number | null; versionsKept: number } }
interface Opened { entry: Entry; content: string; hash: string; masked: number; versions: string[] }

const GROUPS: [Group, string][] = [["identity", "Identity"], ["memory", "Memory"], ["configuration", "Configuration"], ["skills", "Skills"]];
const ago = (t: number | null) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const kb = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

export default function FilesTab() {
  const [list, setList] = useState<Listing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [srcKey, setSrcKey] = useState<string | null>(null);
  const [file, setFile] = useState<Opened | null>(null);
  const [text, setText] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [conflict, setConflict] = useState<{ current: string; hash: string; mine: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/files", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setList(j); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!srcKey && list?.sources.length) setSrcKey(list.sources[0].key); }, [list, srcKey]);

  const dirty = !!file && text !== file.content;
  const src = list?.sources.find((s) => s.key === srcKey) ?? null;

  const open = async (e: Entry) => {
    if (dirty && !window.confirm("You have unsaved changes. Open another file and drop them?")) return;
    setMsg(null); setConflict(null); setBusy(true);
    try {
      const r = await fetch(`/api/v2/files/file?id=${encodeURIComponent(e.id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setFile(j); setText(j.content); setUnlocked(!j.entry.sensitive); setGateOpen(j.entry.sensitive);
    } catch (e2) { setMsg({ ok: false, text: (e2 as Error).message }); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/v2/files/file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: file.entry.id, content: text, baseHash: file.hash, confirm: file.entry.sensitive && unlocked }) });
      const j = await res.json();
      if (res.status === 409) { setConflict({ current: j.current, hash: j.hash, mine: text }); setMsg({ ok: false, text: j.error }); return; }
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      setFile({ ...file, entry: j.entry, hash: j.hash, content: text, versions: j.versions });
      setMsg({ ok: true, text: j.versionKept ? "Saved. The previous version was kept." : "Nothing changed." });
      void load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  const grouped = useMemo(() => GROUPS.map(([g, label]) => [label, (src?.files ?? []).filter((f) => f.group === g)] as const).filter(([, fs]) => fs.length), [src]);
  const editable = !!file && (!file.entry.sensitive || unlocked);

  return (
    <div className="space-y-4" data-files-tab>
      <section className="glass-strong px-6 py-5">
        <div className="glass-eyebrow">Files</div>
        <h2 className="type-display mt-1 text-[26px] leading-tight">The files that shape your agents</h2>
        <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">Read and edit them where they live. Every save keeps the previous version; secrets stay masked.</p>
        {list && (
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {([["Agents", String(list.counts.agents)], ["Editable files", String(list.counts.files)], ["Last changed", ago(list.counts.lastChanged)], ["Versions kept", String(list.counts.versionsKept)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl px-3 py-2 glass-inset"><div className="text-[10.5px] text-[var(--fg-dimmer)]">{k}</div><div className="type-figure text-[20px] leading-none">{v}</div></div>
            ))}
          </div>
        )}
      </section>
      {err && <p role="alert" className="text-[13px] text-red-300">{err}</p>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_280px_1fr]">
        <nav className="glass px-3 py-3" aria-label="Agents">
          <div className="glass-eyebrow px-2">Agents</div>
          <ul className="mt-2 space-y-1">
            {(list?.sources ?? []).map((s) => (
              <li key={s.key}>
                <button type="button" aria-current={s.key === srcKey ? "true" : undefined} onClick={() => setSrcKey(s.key)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${s.key === srcKey ? "glass neon-ring" : "hover:bg-white/5"}`}>
                  <span className="truncate">{s.name}</span><span className="type-figure text-[11px] text-[var(--fg-dimmer)]">{s.files.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="glass px-3 py-3" aria-label="Files">
          <div className="glass-eyebrow px-2">{src?.name ?? "Files"}</div>
          {src && <div className="truncate px-2 font-mono text-[10px] text-[var(--fg-dimmer)]" title={src.rootLabel}>{src.rootLabel}</div>}
          {src?.error && <p className="px-2 pt-2 text-[11.5px] text-amber-300">{src.error}</p>}
          {src && src.files.length === 0 && !src.error && <p className="px-2 pt-2 text-[12px] text-[var(--fg-dimmer)]">No files to edit here.</p>}
          {grouped.map(([label, files]) => (
            <div key={label} className="mt-3">
              <div className="px-2 text-[10.5px] uppercase tracking-wider text-[var(--fg-dimmer)]">{label}</div>
              <ul className="mt-1 space-y-0.5">
                {files.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => void open(f)} aria-current={file?.entry.id === f.id ? "true" : undefined} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${file?.entry.id === f.id ? "glass neon-ring" : "hover:bg-white/5"}`}>
                      {f.sensitive ? <Lock size={12} className="shrink-0 text-amber-300" aria-label="shapes the agent" /> : <FileText size={12} className="shrink-0 opacity-60" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{f.rel}</span>
                      <span className="shrink-0 text-[10px] text-[var(--fg-dimmer)]">{ago(f.mtimeMs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="glass-strong flex min-h-[520px] flex-col px-5 py-4" aria-label="Editor">
          {!file && <div className="grid flex-1 place-items-center text-[12.5px] text-[var(--fg-dimmer)]">{busy ? <Loader2 size={16} className="animate-spin" /> : "Pick a file to read it."}</div>}
          {file && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[14px]">{file.entry.rel}</div>
                  <div className="text-[11px] text-[var(--fg-dimmer)]">{kb(file.entry.size)} · changed {ago(file.entry.mtimeMs)} · {file.entry.format}{file.entry.sensitive ? (unlocked ? " · unlocked for editing" : " · read only") : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  {dirty && <span className="text-[11px] text-amber-300">unsaved</span>}
                  {file.entry.sensitive && !unlocked && <button type="button" onClick={() => setGateOpen(true)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] glass"><Lock size={12} /> Edit…</button>}
                  <button type="button" disabled={!editable || !dirty || busy} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12px] glass neon-ring disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save</button>
                </div>
              </div>

              {gateOpen && (
                <div role="alertdialog" aria-label="This file shapes the agent" className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-[12.5px]">
                  <div className="flex items-center gap-2 font-semibold text-amber-300"><ShieldAlert size={14} /> This file shapes {src?.name ?? "the agent"}</div>
                  <p className="mt-1 text-[var(--fg-dim)]">What you change here changes how it behaves from its next run. The previous version is kept on every save.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => { setUnlocked(true); setGateOpen(false); }} className="rounded-lg px-3 py-1 text-[12px] glass neon-ring">I understand, let me edit</button>
                    <button type="button" onClick={() => { setUnlocked(false); setGateOpen(false); }} className="rounded-lg px-3 py-1 text-[12px] glass">Just read it</button>
                  </div>
                </div>
              )}
              {file.masked > 0 && <p className="mt-2 text-[11.5px] text-[var(--fg-dim)]">{file.masked} secret value{file.masked === 1 ? " is" : "s are"} masked as ********. Leave a mask as it is to keep the real value; type a new value to replace it.</p>}

              <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable} spellCheck={false} aria-label={`Contents of ${file.entry.rel}`}
                className={`mt-3 min-h-[360px] flex-1 resize-y rounded-xl p-3 font-mono text-[12px] leading-relaxed outline-none glass-inset ${editable ? "" : "opacity-80"}`} />

              {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[12px] ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
              {conflict && (
                <div className="mt-2 rounded-xl px-4 py-3 text-[12px] glass-inset">
                  <p className="text-[var(--fg-dim)]">Someone (or the agent) changed this file after you opened it. Your text is below so nothing is lost.</p>
                  <pre className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg p-2 font-mono text-[11px] glass">{conflict.mine}</pre>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(conflict.mine); }} className="rounded-lg px-3 py-1 text-[12px] glass">Copy my text</button>
                    <button type="button" onClick={() => { setFile({ ...file, content: conflict.current, hash: conflict.hash }); setText(conflict.current); setConflict(null); setMsg(null); }} className="inline-flex items-center gap-1 rounded-lg px-3 py-1 text-[12px] glass neon-ring"><RotateCcw size={12} /> Load the current file</button>
                  </div>
                </div>
              )}
              <details className="mt-2 text-[11.5px]">
                <summary className="inline-flex cursor-pointer items-center gap-1 text-[var(--fg-dim)]"><History size={12} /> Versions kept ({file.versions.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-4 font-mono text-[10.5px] text-[var(--fg-dimmer)]">
                  {file.versions.length === 0 && <li>None yet: the first save keeps one.</li>}
                  {file.versions.map((v) => <li key={v}>{v}</li>)}
                </ul>
              </details>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
