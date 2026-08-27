"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Inbox, Search } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import type { EpisodicNode } from "@/lib/v2/memory/types";
import EpisodeDetail from "./EpisodeDetail";
import {
  EmptyState, Eyebrow, LabelChip, MEMORY_ACCENT, fmtAgo, fmtDate, inputStyle,
  type LabelRow,
} from "./shared";

// ── EpisodeBrowser (SPEC-A A8.2) ─────────────────────────────────────────────
// GET /api/v2/memory/episodes?label=&sessionId=&endUserId=&source=&from=&to=&q=
//   &limit=&offset= → {episodes, total} (valid_at DESC). Label chips come from
// the parent (MemoryView fetches /labels once for all tabs).

const PAGE = 50;

interface Filters {
  label: string | null;
  source: string;
  sessionId: string;
  endUserId: string;
  from: string;
  to: string;
  q: string;
}

const EMPTY_FILTERS: Filters = { label: null, source: "", sessionId: "", endUserId: "", from: "", to: "", q: "" };

export default function EpisodeBrowser({ labels }: { labels: LabelRow[] }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [offset, setOffset] = useState(0);
  const [episodes, setEpisodes] = useState<EpisodicNode[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [openUuid, setOpenUuid] = useState<string | null>(null);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.label) sp.set("label", filters.label);
    if (filters.source.trim()) sp.set("source", filters.source.trim());
    if (filters.sessionId.trim()) sp.set("sessionId", filters.sessionId.trim());
    if (filters.endUserId.trim()) sp.set("endUserId", filters.endUserId.trim());
    if (filters.from) sp.set("from", new Date(filters.from).toISOString());
    if (filters.to) sp.set("to", new Date(`${filters.to}T23:59:59`).toISOString());
    if (filters.q.trim()) sp.set("q", filters.q.trim());
    sp.set("limit", String(PAGE));
    sp.set("offset", String(offset));
    return sp.toString();
  }, [filters, offset]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/v2/memory/episodes?${query}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.episodes)) {
        setEpisodes(j.episodes as EpisodicNode[]);
        setTotal(typeof j.total === "number" ? j.total : 0);
        setFailed(false);
      }
    } catch { setFailed(true); }
  }, [query]);

  usePollWhileVisible(refresh, 5000, [query]);

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const setF = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setOffset(0); };
  const activeFilterCount =
    (filters.label ? 1 : 0) +
    [filters.source, filters.sessionId, filters.endUserId, filters.from, filters.to].filter((v) => v.trim() !== "").length;

  return (
    <div>
      {/* toolbar: text search + filter toggle + paging */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-[420px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--fg-dimmer, #6b6478)" }} />
          <input
            value={filters.q}
            onChange={(e) => setF({ q: e.target.value })}
            placeholder="Search episode text…"
            className="w-full h-8 rounded-lg pl-8 pr-3 text-[12px] outline-none"
            style={inputStyle}
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium"
          style={{
            border: `1px solid ${showFilters || activeFilterCount ? `${MEMORY_ACCENT}55` : "var(--panel-border, #2a2436)"}`,
            color: showFilters || activeFilterCount ? MEMORY_ACCENT : "var(--fg-dim, #9aa)",
            background: "var(--panel, rgba(255,255,255,0.02))",
          }}
        >
          <Filter size={13} /> Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
        </button>
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {total > 0 ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : failed ? "feed unreachable" : `${total} episodes`}
          <button
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
            className="p-1 rounded disabled:opacity-30 hover:opacity-80"
            style={{ color: "var(--fg-dim, #9aa)" }}
            aria-label="Previous page"
          ><ChevronLeft size={14} /></button>
          <button
            disabled={offset + PAGE >= total}
            onClick={() => setOffset((o) => o + PAGE)}
            className="p-1 rounded disabled:opacity-30 hover:opacity-80"
            style={{ color: "var(--fg-dim, #9aa)" }}
            aria-label="Next page"
          ><ChevronRight size={14} /></button>
        </div>
      </div>

      {/* label chips (always visible when labels exist) */}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {labels.map((l) => (
            <LabelChip
              key={l.id}
              label={l}
              active={filters.label === l.id}
              onClick={() => setF({ label: filters.label === l.id ? null : l.id })}
            />
          ))}
        </div>
      )}

      {/* expanded filters */}
      {showFilters && (
        <div
          className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 rounded-lg p-3"
          style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
        >
          {([
            ["source", "source", "e.g. manual, mcp:claude-code"],
            ["sessionId", "session", "session uuid"],
            ["endUserId", "end user", "counterparty id"],
          ] as const).map(([key, label, ph]) => (
            <label key={key} className="block">
              <Eyebrow>{label}</Eyebrow>
              <input
                value={filters[key]}
                onChange={(e) => setF({ [key]: e.target.value } as Partial<Filters>)}
                placeholder={ph}
                className="mt-1 w-full h-7 rounded-md px-2 text-[11.5px] outline-none"
                style={inputStyle}
              />
            </label>
          ))}
          <label className="block">
            <Eyebrow>from</Eyebrow>
            <input type="date" value={filters.from} onChange={(e) => setF({ from: e.target.value })}
              className="mt-1 w-full h-7 rounded-md px-2 text-[11.5px] outline-none" style={inputStyle} />
          </label>
          <label className="block">
            <Eyebrow>to</Eyebrow>
            <input type="date" value={filters.to} onChange={(e) => setF({ to: e.target.value })}
              className="mt-1 w-full h-7 rounded-md px-2 text-[11.5px] outline-none" style={inputStyle} />
          </label>
        </div>
      )}

      {/* list */}
      {episodes === null ? (
        <EmptyState title={failed ? "Feed unreachable" : "Loading episodes…"} />
      ) : episodes.length === 0 ? (
        <EmptyState
          icon={<Inbox size={22} />}
          title={activeFilterCount || filters.q ? "No episodes match these filters" : "No episodes yet"}
          hint="Ingest a memory manually (Add memory), point an agent at the MCP endpoint, or run the legacy migration."
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {episodes.map((ep) => (
            <button
              key={ep.uuid}
              onClick={() => setOpenUuid(ep.uuid)}
              className="text-left rounded-lg px-3 py-2.5 transition hover:brightness-125"
              style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
            >
              <div className="text-[12.5px] leading-relaxed line-clamp-2" style={{ color: "var(--fg, #e8e2f0)" }}>
                {ep.content}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                <span title={fmtDate(ep.validAt)}>{fmtAgo(ep.validAt)}</span>
                <span>{ep.source}</span>
                {ep.endUserId && <span>@{ep.endUserId}</span>}
                {ep.type && ep.type !== "CONVERSATION" && <span>{ep.type}</span>}
                <span className="flex items-center gap-1">
                  {ep.labelIds.map((id) => {
                    const l = labelById.get(id);
                    return l ? (
                      <span key={id} className="inline-flex items-center gap-1" style={{ color: l.color }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: l.color }} />{l.name}
                      </span>
                    ) : null;
                  })}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {openUuid && (
        <EpisodeDetail
          episodeUuid={openUuid}
          onClose={() => setOpenUuid(null)}
          onExiled={() => { void refresh(); }}
        />
      )}
    </div>
  );
}
