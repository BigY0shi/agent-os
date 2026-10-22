"use client";

// ── RabbitView — the /rabbit page shell ─────────────────────────────────────
// header (live / active / archived chips + gear) → live strip (turns the
// claude child is answering right now) → two panes: session list (search +
// status tabs) and the selected transcript (archive / restore / rename).
// Polls GET /api/rabbit/sessions every 4s through usePollWhileVisible; the
// selected transcript polls too, so a turn in flight fills in as it lands.
// Counts come from the route's server-computed `counts`, never re-derived.

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Bot, Pencil, Rabbit, Radio, Search, User } from "lucide-react";
import ConfigMenu from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import type { RabbitMessage, RabbitSession, SessionFilter } from "@/lib/v2/rabbit/store";
import type { LiveTurn } from "@/lib/v2/rabbit/live";
import { EmptyState, StatusChip, fmtAgo, inputStyle, panelStyle } from "../integrations/shared";
import RabbitSettings from "./RabbitSettings";
import { RABBIT_ACCENT, SESSION_COLORS } from "./shared";

interface ListResponse {
  sessions: RabbitSession[];
  counts: { active: number; archived: number };
  live: LiveTurn[];
}
interface DetailResponse { session: RabbitSession; messages: RabbitMessage[] }

const FILTERS: Array<{ id: SessionFilter; label: string }> = [
  { id: "active", label: "Active" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];

export default function RabbitView() {
  const [sessions, setSessions] = useState<RabbitSession[] | null>(null);
  const [counts, setCounts] = useState({ active: 0, archived: 0 });
  const [live, setLive] = useState<LiveTurn[]>([]);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<SessionFilter>("active");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const sp = new URLSearchParams({ status, limit: "200" });
    if (q.trim()) sp.set("q", q.trim());
    try {
      const res = await fetch(`/api/rabbit/sessions?${sp.toString()}`, { cache: "no-store" });
      const j = (await res.json()) as Partial<ListResponse>;
      if (Array.isArray(j.sessions)) {
        setSessions(j.sessions);
        if (j.counts) setCounts(j.counts);
        setLive(Array.isArray(j.live) ? j.live : []);
        setFailed(false);
      } else setFailed(true);
    } catch { setFailed(true); }
  }, [status, q]);
  usePollWhileVisible(refresh, 4000, [refresh]);
  useEffect(() => { void refresh(); }, [refresh]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); return; }
    try {
      const res = await fetch(`/api/rabbit/sessions/${selectedId}`, { cache: "no-store" });
      if (!res.ok) { setDetail(null); return; }
      setDetail((await res.json()) as DetailResponse);
    } catch { /* keep the last good transcript */ }
  }, [selectedId]);
  usePollWhileVisible(loadDetail, 4000, [loadDetail]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function patchSession(id: string, body: { archived?: boolean; title?: string }) {
    setBusy(true);
    try {
      await fetch(`/api/rabbit/sessions/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await Promise.all([refresh(), loadDetail()]);
    } finally { setBusy(false); }
  }

  async function archiveIdle() {
    let days = 30;
    try {
      const j = (await (await fetch("/api/settings", { cache: "no-store" })).json()) as { settings?: { rabbit?: { retentionDays?: number } } };
      if (typeof j.settings?.rabbit?.retentionDays === "number") days = j.settings.rabbit.retentionDays;
    } catch { /* default */ }
    if (!window.confirm(`Archive every active session idle for more than ${days} day${days === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/rabbit/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archiveIdle", days }) });
      const j = (await r.json()) as { archived?: number; error?: string };
      setNotice(j.error ? `Archive failed: ${j.error}` : `Archived ${j.archived ?? 0} session${j.archived === 1 ? "" : "s"}.`);
      setTimeout(() => setNotice(null), 3000);
      await refresh();
    } finally { setBusy(false); }
  }

  function rename(s: RabbitSession) {
    const title = window.prompt("Session title", s.title);
    if (title && title.trim() && title.trim() !== s.title) void patchSession(s.id, { title: title.trim() });
  }

  const selected = detail?.session ?? null;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
          <Rabbit size={18} style={{ color: RABBIT_ACCENT }} /> Rabbit R1
        </div>
        <div className="flex items-center gap-1.5">
          <StatusChip color={SESSION_COLORS.live}>{live.length} live</StatusChip>
          <StatusChip color={SESSION_COLORS.active}>{counts.active} active</StatusChip>
          <StatusChip color={SESSION_COLORS.archived}>{counts.archived} archived</StatusChip>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {notice && <span className="text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>{notice}</span>}
          <button
            onClick={() => void archiveIdle()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium disabled:opacity-50"
            style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))", color: "var(--fg-dim, #9aa)" }}
          >
            <Archive size={13} /> Archive idle
          </button>
          <ConfigMenu title="Rabbit R1 settings" accent={RABBIT_ACCENT}>
            <RabbitSettings />
          </ConfigMenu>
        </div>
      </div>

      {failed && (
        <div className="text-[12px] rounded-md px-3 py-2" style={{ background: "rgba(248,113,113,0.1)", color: "#f87171" }}>
          Could not reach /api/rabbit/sessions — is the server up?
        </div>
      )}

      {/* live strip */}
      {live.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.sessionId)}
              className="text-left rounded-lg p-3"
              style={{ ...panelStyle, borderColor: `${SESSION_COLORS.live}66` }}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: SESSION_COLORS.live }}>
                <Radio size={12} className="animate-pulse" /> answering · {t.model} · {fmtAgo(t.startedAt)}
              </div>
              <div className="mt-1 text-[12.5px] line-clamp-2" style={{ color: "var(--fg, #e8e2f0)" }}>{t.preview || "…"}</div>
            </button>
          ))}
        </div>
      )}

      {/* panes */}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="rounded-lg p-3 space-y-2" style={panelStyle}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--fg-dimmer, #6b6478)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and transcripts" className="w-full pl-8 text-[12.5px] rounded-md py-1.5 pr-2.5 outline-none" style={inputStyle} />
          </div>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatus(f.id)}
                className="px-2.5 h-7 rounded-md text-[11.5px] font-medium"
                style={{
                  background: status === f.id ? `${RABBIT_ACCENT}22` : "transparent",
                  color: status === f.id ? RABBIT_ACCENT : "var(--fg-dim, #9aa)",
                  border: `1px solid ${status === f.id ? RABBIT_ACCENT + "66" : "var(--panel-border, #2a2436)"}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="space-y-1 max-h-[65vh] overflow-y-auto pr-1">
            {sessions === null ? (
              <div className="text-[12px] py-6 text-center" style={{ color: "var(--fg-dimmer, #6b6478)" }}>Loading…</div>
            ) : sessions.length === 0 ? (
              <EmptyState icon={<Rabbit size={18} />} title="No sessions yet" hint="Point the R1 at the endpoint in the gear and ask it something." />
            ) : (
              sessions.map((s) => {
                const isSel = s.id === selectedId;
                const isLive = live.some((t) => t.sessionId === s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="w-full text-left rounded-md px-2.5 py-2"
                    style={{
                      background: isSel ? `${RABBIT_ACCENT}18` : "transparent",
                      border: `1px solid ${isSel ? RABBIT_ACCENT + "55" : "transparent"}`,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {isLive && <Radio size={11} className="animate-pulse shrink-0" style={{ color: SESSION_COLORS.live }} />}
                      <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{s.title}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] flex items-center gap-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                      <span>{s.messageCount / 2} turn{s.messageCount === 2 ? "" : "s"}</span>
                      <span>·</span>
                      <span>{fmtAgo(s.updatedAt)}</span>
                      {s.archivedAt && <StatusChip color={SESSION_COLORS.archived}>archived</StatusChip>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-lg p-4 min-h-[50vh]" style={panelStyle}>
          {!selected ? (
            <EmptyState icon={<Bot size={18} />} title="Pick a session" hint="Transcripts show every exchange the R1 had through this bridge." />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[14px] font-semibold truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{selected.title}</h2>
                    <button title="Rename" onClick={() => rename(selected)} className="shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}><Pencil size={13} /></button>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {selected.model} · started {fmtAgo(selected.createdAt)} · last {fmtAgo(selected.updatedAt)}
                    {selected.inputTokens + selected.outputTokens > 0 && ` · ${selected.inputTokens} in / ${selected.outputTokens} out tokens`}
                    {selected.client && ` · ${selected.client}`}
                  </div>
                </div>
                <button
                  onClick={() => void patchSession(selected.id, { archived: !selected.archivedAt })}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium disabled:opacity-50"
                  style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))", color: "var(--fg-dim, #9aa)" }}
                >
                  {selected.archivedAt ? <><ArchiveRestore size={13} /> Restore</> : <><Archive size={13} /> Archive</>}
                </button>
              </div>

              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                {(detail?.messages ?? []).map((m) => {
                  const isUser = m.role === "user";
                  return (
                    <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap"
                        style={{
                          background: isUser ? `${RABBIT_ACCENT}1a` : "var(--panel, rgba(255,255,255,0.03))",
                          border: `1px solid ${m.error ? "#f8717166" : isUser ? RABBIT_ACCENT + "44" : "var(--panel-border, #2a2436)"}`,
                          color: "var(--fg, #e8e2f0)",
                        }}
                      >
                        <div className="flex items-center gap-1.5 text-[10.5px] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                          {isUser ? <User size={11} /> : <Bot size={11} />}
                          {isUser ? "R1" : (m.model ?? "assistant")} · {fmtAgo(m.createdAt)}
                          {typeof m.durationMs === "number" && !isUser && ` · ${(m.durationMs / 1000).toFixed(1)}s`}
                          {m.error && <span style={{ color: "#f87171" }}>· error</span>}
                        </div>
                        {m.content}
                      </div>
                    </div>
                  );
                })}
                {live.filter((t) => t.sessionId === selected.id).map((t) => (
                  <div key={t.id} className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-[12.5px]" style={{ border: `1px dashed ${SESSION_COLORS.live}88`, color: "var(--fg-dim, #9aa)" }}>
                      <span className="inline-flex items-center gap-1.5"><Radio size={11} className="animate-pulse" style={{ color: SESSION_COLORS.live }} /> answering “{t.preview}”…</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
