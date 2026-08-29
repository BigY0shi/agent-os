"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Loader2, Search } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { EntityTypes, type EntityNode, type EpisodicNode, type StatementNode } from "@/lib/v2/memory/types";
import EpisodeDetail from "./EpisodeDetail";
import { AspectBadge, EmptyState, Eyebrow, MEMORY_ACCENT, fmtAgo, fmtDate, inputStyle } from "./shared";

// ── EntityBrowser (SPEC-A A8.3) ──────────────────────────────────────────────
// GET /api/v2/memory/entities?q=&type= (q = entity-ns vector 0.65 + name LIKE)
// GET /api/v2/memory/entities/[id] → {entity, statements (incl invalidated —
// struck-through), episodes (valid_at DESC)}. Master list left, detail right.

interface Detail {
  entity: EntityNode;
  statements: StatementNode[];
  episodes: EpisodicNode[];
}

const TYPE_COLORS: Record<string, string> = {
  Person: "#ec4899", Organization: "#60a5fa", Place: "#34d399", Event: "#fde047",
  Project: "#fb923c", Task: "#f97316", Technology: "#22d3ee", Product: "#a855f7",
  Standard: "#a3e635", Concept: "#c084fc", Predicate: "#6b6478",
};

function TypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  const c = TYPE_COLORS[type] ?? "#9aa";
  return (
    <span className="inline-flex px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-[0.08em] shrink-0"
      style={{ color: c, background: `${c}14`, border: `1px solid ${c}44` }}>
      {type}
    </span>
  );
}

export default function EntityBrowser() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [entities, setEntities] = useState<EntityNode[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openEpisode, setOpenEpisode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (type) sp.set("type", type);
      sp.set("limit", "100");
      const r = await fetch(`/api/v2/memory/entities?${sp.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.entities)) { setEntities(j.entities as EntityNode[]); setFailed(false); }
    } catch { setFailed(true); }
  }, [q, type]);

  usePollWhileVisible(refresh, 5000, [q, type]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
    fetch(`/api/v2/memory/entities/${selectedId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.entity) setDetail(j as Detail); })
      .catch(() => { /* unreachable */ })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [selectedId]);

  const attrs = detail ? Object.entries(detail.entity.attributes ?? {}) : [];
  const currentStatements = detail?.statements.filter((s) => !s.invalidAt) ?? [];
  const invalidatedStatements = detail?.statements.filter((s) => s.invalidAt) ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_1.6fr] gap-4">
      {/* master list */}
      <div>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--fg-dimmer, #6b6478)" }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search entities (name + semantic)…"
              className="w-full h-8 rounded-lg pl-8 pr-3 text-[12px] outline-none"
              style={inputStyle}
            />
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-8 rounded-lg px-2 text-[12px] outline-none"
            style={inputStyle}
          >
            <option value="">all types</option>
            {EntityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {entities === null ? (
          <EmptyState title={failed ? "Feed unreachable" : "Loading entities…"} />
        ) : entities.length === 0 ? (
          <EmptyState icon={<Boxes size={22} />} title="No entities" hint="Entities appear as ingestion extracts people, orgs, tech and concepts from your episodes." />
        ) : (
          <div className="flex flex-col gap-1 max-h-[62vh] overflow-y-auto pr-1">
            {entities.map((e) => (
              <button
                key={e.uuid}
                onClick={() => setSelectedId(e.uuid)}
                className="flex items-center gap-2 text-left rounded-lg px-3 py-2 transition hover:brightness-125"
                style={{
                  border: `1px solid ${selectedId === e.uuid ? `${MEMORY_ACCENT}66` : "var(--panel-border, #2a2436)"}`,
                  background: selectedId === e.uuid ? `${MEMORY_ACCENT}0d` : "var(--panel, rgba(255,255,255,0.02))",
                }}
              >
                <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{e.name}</span>
                <span className="ml-auto"><TypeBadge type={e.type} /></span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* detail */}
      <div className="rounded-xl p-4 min-h-[300px]" style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}>
        {!selectedId ? (
          <EmptyState title="Select an entity" hint="Attributes, statements (current and previously-believed) and source episodes show here." />
        ) : detailLoading && !detail ? (
          <div className="flex items-center gap-2 py-8 justify-center text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>
            <Loader2 size={14} className="animate-spin" /> loading…
          </div>
        ) : detail ? (
          <>
            <div className="flex items-center gap-2.5 mb-1">
              <span className="text-[16px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>{detail.entity.name}</span>
              <TypeBadge type={detail.entity.type} />
            </div>
            <div className="font-mono text-[10px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              known since {fmtDate(detail.entity.createdAt)}
            </div>

            {attrs.length > 0 && (
              <div className="mb-5">
                <div className="mb-2"><Eyebrow>attributes</Eyebrow></div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {attrs.map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
                        <td className="py-1.5 pr-4 font-mono text-[11px] align-top whitespace-nowrap" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{k}</td>
                        <td className="py-1.5 break-all" style={{ color: "var(--fg, #e8e2f0)" }}>{typeof v === "string" ? v : JSON.stringify(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(currentStatements.length > 0 || invalidatedStatements.length > 0) && (
              <div className="mb-5">
                <div className="mb-2"><Eyebrow>statements</Eyebrow></div>
                <div className="flex flex-col gap-1.5">
                  {currentStatements.map((s) => (
                    <div key={s.uuid} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: "var(--fg, #e8e2f0)" }}>
                      <AspectBadge aspect={s.aspect} />
                      <span className="min-w-0">{s.fact}</span>
                    </div>
                  ))}
                  {invalidatedStatements.map((s) => (
                    <div key={s.uuid} className="flex items-start gap-2 text-[12px] leading-relaxed">
                      <AspectBadge aspect={s.aspect} struck />
                      <span className="min-w-0 line-through" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{s.fact}</span>
                      <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                        until {fmtDate(s.invalidAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.episodes.length > 0 && (
              <div>
                <div className="mb-2"><Eyebrow>episodes ({detail.episodes.length})</Eyebrow></div>
                <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto pr-1">
                  {detail.episodes.map((ep) => (
                    <button
                      key={ep.uuid}
                      onClick={() => setOpenEpisode(ep.uuid)}
                      className="text-left rounded-md px-2.5 py-1.5 transition hover:brightness-125"
                      style={{ border: "1px solid var(--panel-border, #2a2436)" }}
                    >
                      <span className="text-[11.5px] line-clamp-1" style={{ color: "var(--fg-dim, #9aa)" }}>{ep.content}</span>
                      <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{fmtAgo(ep.validAt)} · {ep.source}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState title="Couldn't load entity" />
        )}
      </div>

      {openEpisode && <EpisodeDetail episodeUuid={openEpisode} onClose={() => setOpenEpisode(null)} />}
    </div>
  );
}
