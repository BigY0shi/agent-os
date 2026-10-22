"use client";

// S13 Sessions (_design/jarvis-v3-plan.md): every Jarvis conversation, searchable by
// title and message text, with resume (Console or overlay), rename, archive, restore.
// Archive has always been a soft flag; restore makes that reversible from here.
// Every number on this tab is counted from the store; nothing is estimated.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Archive, ArchiveRestore, Pencil, MessageSquare, PanelRightOpen, Loader2, Check, X, Glasses } from "lucide-react";
import { consoleResumeHref, resumeInOverlay } from "@/lib/v2/jarvis/resume";

type Scope = "live" | "archived" | "all";
interface Row {
  id: string;
  title: string;
  channel: "overlay" | "page";
  origin: "glasses" | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  messageCount: number;
  snippet: string | null;
  lastMessageAt: string | null;
}
interface Msg { role: "user" | "assistant" | "system"; content: string; toolCalls?: { name: string; summary: string; ok: boolean }[] | null; createdAt: string }
interface Counts { live: number; archived: number; messages: number }

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SessionsTab() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("live");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async (query: string, sc: Scope) => {
    const my = ++reqRef.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/v2/jarvis/conversations?scope=${sc}&q=${encodeURIComponent(query)}&limit=150`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (my !== reqRef.current) return;
      if (!r.ok) { setErr(j.error ?? `list failed (${r.status})`); return; }
      setErr(null);
      setRows(j.conversations ?? []);
      setCounts(j.counts ?? null);
    } catch (e) {
      if (my === reqRef.current) setErr(String(e));
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, []);

  // Debounced search; scope changes load at once.
  useEffect(() => {
    const t = setTimeout(() => void load(q, scope), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, scope, load]);

  const selected = useMemo(() => rows?.find((r) => r.id === sel) ?? null, [rows, sel]);

  useEffect(() => {
    if (!sel) { setMsgs(null); return; }
    let live = true;
    setMsgs(null); setDetailErr(null);
    (async () => {
      const r = await fetch(`/api/v2/jarvis/conversations/${encodeURIComponent(sel)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      if (!r.ok) { setDetailErr(j.error ?? `load failed (${r.status})`); return; }
      setMsgs(j.messages ?? []);
    })().catch((e) => { if (live) setDetailErr(String(e)); });
    return () => { live = false; };
  }, [sel]);

  const act = async (fn: () => Promise<Response>) => {
    setBusy(true);
    try {
      const r = await fn();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      await load(q, scope);
    } catch (e) {
      setDetailErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const archive = (id: string) => act(() => fetch(`/api/v2/jarvis/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }));
  const restore = (id: string) => act(() => fetch(`/api/v2/jarvis/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: false }),
  }));
  const rename = async (id: string, title: string) => {
    if (!title.trim()) { setRenaming(null); return; }
    await act(() => fetch(`/api/v2/jarvis/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    }));
    setRenaming(null);
  };

  return (
    <div className="space-y-4" data-jarvis-sessions>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {([
          ["Live sessions", counts?.live],
          ["Archived", counts?.archived],
          ["Messages kept", counts?.messages],
        ] as [string, number | undefined][]).map(([k, v]) => (
          <div key={k} className="glass px-5 py-4">
            <div className="glass-eyebrow">{k}</div>
            <div className="type-figure mt-1 text-[30px] leading-none">{v ?? "–"}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="glass-inset flex min-w-[260px] flex-1 items-center gap-2 px-3 py-2">
          <Search size={14} className="text-[var(--fg-dimmer)]" aria-hidden />
          <span className="sr-only">Search sessions</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles and everything said"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-dimmer)]"
            aria-label="Search sessions"
          />
          {loading && <Loader2 size={13} className="animate-spin text-[var(--fg-dimmer)]" aria-label="Searching" />}
        </label>
        <div role="tablist" aria-label="Which sessions" className="glass-tabs">
          {(["live", "archived", "all"] as Scope[]).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className="glass-tab capitalize">
              {s}
            </button>
          ))}
        </div>
      </div>

      {err && <p role="alert" className="text-[13px] text-red-300">Could not list sessions: {err}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <ul className="glass max-h-[640px] overflow-y-auto p-2" aria-label="Sessions">
          {rows === null && !err && <li className="px-3 py-6 text-[13px] text-[var(--fg-dimmer)]">Loading…</li>}
          {rows?.length === 0 && (
            <li className="px-3 py-6 text-[13px] text-[var(--fg-dimmer)]">
              {q ? `Nothing matches "${q}".` : scope === "archived" ? "Nothing archived." : "No sessions yet. Talk to Jarvis and they appear here."}
            </li>
          )}
          {rows?.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSel(r.id)}
                aria-current={sel === r.id ? "true" : undefined}
                aria-label={`Open ${r.title || "untitled"}`}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.04] ${sel === r.id ? "bg-white/[0.06]" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] text-[var(--fg)]">{r.title || "(untitled)"}</span>
                  {r.origin === "glasses" && <Glasses size={12} className="shrink-0 text-[var(--fg-dimmer)]" aria-label="from the glasses" />}
                  {r.archivedAt && <span className="shrink-0 rounded px-1.5 text-[10px] text-[var(--fg-dimmer)] glass-inset">archived</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[var(--fg-dimmer)]">
                  <span className="type-figure">{r.messageCount} msg</span>
                  <span>{r.channel}</span>
                  <span>{ago(r.lastMessageAt ?? r.updatedAt)}</span>
                </div>
                {r.snippet && <div className="mt-1 line-clamp-2 text-[11.5px] text-[var(--fg-dim)]">{r.snippet}</div>}
              </button>
            </li>
          ))}
        </ul>

        <section className="glass-strong min-h-[420px] p-5" aria-label="Session detail">
          {!selected && <div className="grid h-full place-items-center text-[13px] text-[var(--fg-dimmer)]">Pick a session to read it or pick it back up.</div>}
          {selected && (
            <div className="flex h-full flex-col gap-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {renaming === selected.id ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("title"); void rename(selected.id, String(v ?? "")); }}
                    >
                      <input name="title" defaultValue={selected.title} autoFocus maxLength={80} aria-label="Session title" className="glass-inset rounded-lg px-2.5 py-1.5 text-[15px] outline-none" />
                      <button type="submit" aria-label="Save title" className="rounded-lg p-1.5 hover:bg-white/5"><Check size={15} /></button>
                      <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)} className="rounded-lg p-1.5 hover:bg-white/5"><X size={15} /></button>
                    </form>
                  ) : (
                    <h2 className="type-display truncate text-[20px]">{selected.title || "(untitled)"}</h2>
                  )}
                  <div className="mt-1 text-[11.5px] text-[var(--fg-dimmer)]">
                    Started {new Date(selected.createdAt).toLocaleString()} · last activity {ago(selected.lastMessageAt ?? selected.updatedAt)} · {selected.messageCount} messages · {selected.channel}
                    {selected.origin ? ` · ${selected.origin}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !!selected.archivedAt} onClick={() => router.push(consoleResumeHref(selected.id))}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40" title={selected.archivedAt ? "Restore it first" : "Continue in the Console"}>
                    <MessageSquare size={13} /> Resume in Console
                  </button>
                  <button type="button" disabled={busy || !!selected.archivedAt} onClick={() => resumeInOverlay(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40" title={selected.archivedAt ? "Restore it first" : "Continue in the floating overlay, on any page"}>
                    <PanelRightOpen size={13} /> Resume in overlay
                  </button>
                  <button type="button" disabled={busy} onClick={() => setRenaming(selected.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40">
                    <Pencil size={13} /> Rename
                  </button>
                  {selected.archivedAt ? (
                    <button type="button" disabled={busy} onClick={() => void restore(selected.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40">
                      <ArchiveRestore size={13} /> Restore
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void archive(selected.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40" title="Archive hides it; nothing is deleted and Restore brings it back">
                      <Archive size={13} /> Archive
                    </button>
                  )}
                </div>
              </header>
              {detailErr && <p role="alert" className="text-[13px] text-red-300">{detailErr}</p>}
              <ol className="glass-inset flex-1 space-y-3 overflow-y-auto p-4" aria-label="Transcript">
                {msgs === null && !detailErr && <li className="text-[13px] text-[var(--fg-dimmer)]">Loading…</li>}
                {msgs?.length === 0 && <li className="text-[13px] text-[var(--fg-dimmer)]">This session has no messages.</li>}
                {msgs?.map((m, i) => (
                  <li key={i} className="text-[13px] leading-relaxed">
                    <div className="glass-eyebrow" style={{ color: m.role === "user" ? "var(--fg-dim)" : m.role === "assistant" ? "#a78bfa" : "var(--fg-dimmer)" }}>
                      {m.role === "user" ? "You" : m.role === "assistant" ? "Jarvis" : "System"} · {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    {m.toolCalls?.map((t, k) => (
                      <div key={k} className="type-figure mt-0.5 text-[11px] text-[var(--fg-dimmer)]">
                        {t.ok ? "ran" : "failed"} {t.name}{t.summary ? `: ${t.summary}` : ""}
                      </div>
                    ))}
                    <div className={`mt-0.5 whitespace-pre-wrap ${m.role === "system" ? "text-[var(--fg-dimmer)]" : "text-[var(--fg)]"}`}>{m.content}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
