"use client";

// SPEC-F J1.1 — the campaign detail page: header, tab bar, Overview, and (S32)
// the Calendar / Board / Assets / Metrics tabs, every one of them computed
// from the campaign file through src/lib/v2/marketing/campaignViews.ts.
// Board moves go through the existing POST /api/marketing/item actions; a move
// the API cannot express bounces with the reason in a toast. Metrics shows no
// number that is not counted from stored rows; the engagement slot says there
// is no source rather than pretending.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Megaphone } from "lucide-react";
import {
  STATUSES,
  CHANNELS,
  bucketItemsByDay,
  boardMove,
  campaignAssets,
  campaignMetrics,
  dayKey,
  monthCells,
  NO_ENGAGEMENT_SOURCE,
  type Channel,
  type ItemStatus,
  type ViewItem,
} from "@/lib/v2/marketing/campaignViews";

type Business = "payloadsco" | "launchworks" | "cobalt";

interface Campaign {
  slug: string;
  title: string;
  business: Business;
  goal: string;
  angle?: string;
  channels: Channel[];
  status: string;
  plan?: string;
  items: ViewItem[];
  created: string;
  color?: string;
}

const BUSINESS_LABEL: Record<Business, string> = {
  payloadsco: "PayloadsCO",
  launchworks: "Launchworks / Deal Desk",
  cobalt: "Cobalt Research Supply",
};

const CHANNEL_LABEL: Record<Channel, string> = {
  youtube: "YouTube",
  "short-video": "Short video",
  "text-post": "Text post",
  blog: "Blog",
};

/** Status colours: the hub's calendar legend (approved and scheduled share green). */
const STATUS_COLOR: Record<ItemStatus, string> = {
  idea: "#64748b", drafted: "#fbbf24", approved: "#34d399", scheduled: "#34d399", published: "#ec4899",
};

const TABS = ["Overview", "Calendar", "Board", "Assets", "Metrics"] as const;
type Tab = (typeof TABS)[number];

const panel = {
  background: "var(--panel, rgba(255,255,255,0.03))",
  borderColor: "var(--panel-border, rgba(255,255,255,0.08))",
};

function todayKey(): string {
  const n = new Date();
  return dayKey(n.getFullYear(), n.getMonth(), n.getDate());
}

export default function CampaignDetail({ slug }: { slug: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/marketing/campaigns/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (res.status === 404) { setNotFound(true); setCampaign(null); return; }
      const j = (await res.json()) as { campaign?: Campaign };
      if (j.campaign) { setCampaign(j.campaign); setNotFound(false); }
    } catch {
      // A fetch that never landed is not a missing campaign — leave the 404
      // panel alone and let the empty state below say the load failed.
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  /** Board move: translate, post the existing action, reload from the file. */
  const moveItem = useCallback(async (item: ViewItem, target: ItemStatus) => {
    if (!campaign) return;
    const verdict = boardMove(item, target);
    if (!verdict.ok) { showToast(`Not moved: ${verdict.reason}`); return; }
    try {
      const res = await fetch("/api/marketing/item", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: campaign.slug, itemId: item.id, action: verdict.action }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; campaign?: Campaign };
      if (!res.ok || !j.ok) { showToast(`Move failed: ${j.error ?? `HTTP ${res.status}`}`); return; }
      if (j.campaign) setCampaign(j.campaign);
      if (verdict.note) showToast(`Moved (${verdict.note}).`);
    } catch {
      showToast("Move failed: the request did not reach the server.");
    }
  }, [campaign, showToast]);

  const accent = campaign?.color ?? "#ec4899";

  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center gap-2 text-[13px]" style={{ color: "var(--fg-dimmer)" }}>
        <Loader2 size={14} className="animate-spin" /> Loading campaign…
      </div>
    );
  }

  if (notFound || !campaign) {
    return (
      <div className="px-6 py-8 max-w-[900px]">
        <BackLink />
        <div className="mt-4 rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: "var(--panel-border)" }}>
          <Megaphone size={26} className="mx-auto mb-3" style={{ color: "var(--fg-dimmer)" }} />
          <div className="text-[14px] mb-1" style={{ color: "var(--fg)" }}>
            {notFound ? "No campaign with that name" : "Could not load this campaign"}
          </div>
          <div className="text-[12.5px]" style={{ color: "var(--fg-dimmer)" }}>
            {notFound
              ? <>Nothing is stored under <code>{slug}</code>. It may have been exiled.</>
              : "The request did not reach the server. Try again."}
          </div>
        </div>
      </div>
    );
  }

  const counts = campaign.items.reduce<Record<string, number>>((a, i) => ((a[i.status] = (a[i.status] ?? 0) + 1), a), {});

  return (
    <div className="px-6 py-5 max-w-[1200px]">
      <BackLink />

      <div className="mt-3 mb-4 flex items-start gap-3">
        <span className="mt-1.5 h-3 w-3 rounded-full flex-none" style={{ background: accent }} aria-hidden />
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold leading-tight" style={{ color: "var(--fg)" }}>{campaign.title}</h1>
          <div className="text-[12px] mt-1" style={{ color: "var(--fg-dimmer)" }}>
            {BUSINESS_LABEL[campaign.business] ?? campaign.business} · {campaign.status} · {campaign.items.length} item
            {campaign.items.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b mb-5" style={{ borderColor: "var(--panel-border)" }} role="tablist" aria-label="Campaign views">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}
            className="px-3 h-9 text-[12.5px] rounded-t-md transition"
            style={{
              color: tab === t ? "var(--fg)" : "var(--fg-dimmer)",
              borderBottom: tab === t ? `2px solid ${accent}` : "2px solid transparent",
            }}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-4">
          <div className="rounded-xl border p-4" style={panel}>
            <div className="text-[11px] font-mono uppercase tracking-widest mb-2" style={{ color: accent }}>Goal</div>
            <p className="text-[13.5px] m-0" style={{ color: "var(--fg)" }}>{campaign.goal}</p>
            {campaign.angle && (
              <>
                <div className="text-[11px] font-mono uppercase tracking-widest mt-4 mb-2" style={{ color: accent }}>Angle</div>
                <p className="text-[13.5px] m-0" style={{ color: "var(--fg-dim)" }}>{campaign.angle}</p>
              </>
            )}
          </div>

          <div className="rounded-xl border p-4" style={panel}>
            <div className="text-[11px] font-mono uppercase tracking-widest mb-2" style={{ color: accent }}>Plan</div>
            {campaign.plan ? (
              // Rendered as preformatted text, not parsed markdown: the plan is
              // model output, and this shell is not the place to introduce an
              // HTML renderer for it.
              <pre className="text-[12.5px] whitespace-pre-wrap font-sans m-0" style={{ color: "var(--fg-dim)" }}>
                {campaign.plan}
              </pre>
            ) : (
              <p className="text-[12.5px] m-0" style={{ color: "var(--fg-dimmer)" }}>
                No plan yet — run the planning council from the hub.
              </p>
            )}
          </div>

          {campaign.items.length > 0 && (
            <div className="rounded-xl border p-4" style={panel}>
              <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={{ color: accent }}>Items by status</div>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((st) => (
                  <span key={st} className="text-[12px] px-2.5 py-1 rounded-md border"
                    style={{ ...panel, color: counts[st] ? "var(--fg)" : "var(--fg-dimmer)" }}>
                    {st} <b style={{ fontVariantNumeric: "tabular-nums" }}>{counts[st] ?? 0}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "Calendar" && <CalendarTab items={campaign.items} accent={accent} />}
      {tab === "Board" && <BoardTab items={campaign.items} accent={accent} onMove={moveItem} />}
      {tab === "Assets" && <AssetsTab items={campaign.items} accent={accent} onCopied={() => showToast("Draft copied.")} />}
      {tab === "Metrics" && <MetricsTab items={campaign.items} accent={accent} />}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            role="status"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-3.5 py-2 rounded-lg text-[12.5px] font-medium"
            style={{ background: "var(--panel-solid, #17121f)", border: `1px solid ${accent}55`, color: "var(--fg, #e8e2f0)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/marketing" className="inline-flex items-center gap-1.5 text-[12.5px] hover:underline"
      style={{ color: "var(--fg-dimmer)" }}>
      <ArrowLeft size={13} /> Marketing Hub
    </Link>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-[12.5px]"
      style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}>
      {children}
    </div>
  );
}

function ItemChip({ item, onDragStart, draggable }: { item: ViewItem; draggable?: boolean; onDragStart?: () => void }) {
  const color = STATUS_COLOR[item.status];
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      title={`${item.title} (${item.status}${item.platform ? ` · ${item.platform}` : ""})`}
      className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-left"
      style={{ background: `${color}14`, border: `1px solid ${color}44`, color, cursor: draggable ? "grab" : "default" }}
    >
      <span className="font-mono text-[9px] uppercase shrink-0" style={{ opacity: 0.8 }}>{CHANNEL_LABEL[item.channel] ?? item.channel}</span>
      <span className="flex-1 min-w-0 truncate text-[11px]">{item.title}</span>
      {item.status === "published" && <Check size={10} className="shrink-0" />}
    </div>
  );
}

// ── Calendar: this campaign's items on a month grid by their day ─────────────

function CalendarTab({ items, accent }: { items: ViewItem[]; accent: string }) {
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const { byDay, undated } = useMemo(() => bucketItemsByDay(items), [items]);
  const cells = monthCells(ym.y, ym.m);
  const tKey = todayKey();
  const monthCount = cells.reduce<number>((n, d) => n + (d ? (byDay.get(dayKey(ym.y, ym.m, d))?.length ?? 0) : 0), 0);
  const shift = (delta: number) => setYm(({ y, m }) => { const t = new Date(y, m + delta, 1); return { y: t.getFullYear(), m: t.getMonth() }; });

  if (items.length === 0) {
    return <EmptyState>No items yet: plan the campaign from the hub and its pieces land here by date.</EmptyState>;
  }

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button onClick={() => shift(-1)} title="Previous month" className="p-1.5 rounded-lg border" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
          <ChevronLeft size={14} />
        </button>
        <div className="text-[14px] font-semibold min-w-[150px] text-center" style={{ color: "var(--fg)" }}>
          {new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </div>
        <button onClick={() => shift(1)} title="Next month" className="p-1.5 rounded-lg border" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
          <ChevronRight size={14} />
        </button>
        <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}
          className="px-2.5 py-1 rounded-lg border text-[11.5px] font-semibold" style={{ borderColor: `${accent}66`, color: accent }}>
          Today
        </button>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {[["idea", STATUS_COLOR.idea], ["drafted", STATUS_COLOR.drafted], ["approved / scheduled", STATUS_COLOR.approved], ["published", STATUS_COLOR.published]].map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
              <span aria-hidden className="rounded-full shrink-0" style={{ width: 7, height: 7, background: color }} /> {label}
            </span>
          ))}
        </div>
      </div>

      {monthCount === 0 && <div className="text-[11.5px] mb-2" style={{ color: "var(--fg-dimmer)" }}>nothing dated this month</div>}

      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-[10px] uppercase tracking-widest text-center py-1" style={{ color: "var(--fg-dimmer)" }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          const key = day ? dayKey(ym.y, ym.m, day) : `blank-${i}`;
          const isToday = !!day && key === tKey;
          const dayItems = day ? byDay.get(key) ?? [] : [];
          return (
            <div key={key} className="rounded-lg border p-1 min-h-[88px] flex flex-col gap-1"
              style={{ borderColor: isToday ? accent : "var(--panel-border)", background: day ? "rgba(255,255,255,0.015)" : "transparent", opacity: day ? 1 : 0.35 }}>
              {day && (
                <div className="text-[10px] font-mono px-0.5" style={{ color: isToday ? accent : "var(--fg-dimmer)", fontWeight: isToday ? 700 : 400 }}>{day}</div>
              )}
              {dayItems.map((it) => <ItemChip key={it.id} item={it} />)}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border p-3 mt-4" style={panel}>
        <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--fg-dimmer)" }}>
          Undated · {undated.length} {undated.length === 0 ? "(every item has a date)" : "(no scheduled date and not yet marked published; set one from the campaign drawer)"}
        </div>
        {undated.length > 0 && (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {undated.map((it) => <ItemChip key={it.id} item={it} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Board: columns by status, drag a card to change it through the item API ──

function BoardTab({ items, accent, onMove }: { items: ViewItem[]; accent: string; onMove: (item: ViewItem, target: ItemStatus) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ItemStatus | null>(null);

  if (items.length === 0) {
    return <EmptyState>No items yet: plan the campaign from the hub and its pieces land here by status.</EmptyState>;
  }

  return (
    <div className="pb-6">
      <div className="text-[11px] mb-3" style={{ color: "var(--fg-dimmer)" }}>
        Drag a card to another column: approve, unapprove or mark published through the campaign item API. A move the API cannot make bounces with the reason.
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        {STATUSES.map((st) => {
          const col = items.filter((i) => i.status === st);
          const color = STATUS_COLOR[st];
          return (
            <div key={st}
              onDragEnter={() => setOverCol(st)}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
              onDrop={() => {
                const it = dragId ? items.find((i) => i.id === dragId) : null;
                setDragId(null); setOverCol(null);
                if (it) onMove(it, st);
              }}
              className="rounded-xl border p-2 min-h-[160px] flex flex-col gap-1.5"
              style={{ ...panel, borderColor: overCol === st && dragId ? accent : panel.borderColor }}
              aria-label={`${st} column`}>
              <div className="flex items-center justify-between px-0.5 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color }}>{st}</span>
                <span className="text-[10px] font-mono" style={{ color: "var(--fg-dimmer)", fontVariantNumeric: "tabular-nums" }}>{col.length}</span>
              </div>
              {col.length === 0 ? (
                <div className="text-[10.5px] px-0.5" style={{ color: "var(--fg-dimmer)" }}>none</div>
              ) : (
                col.map((it) => (
                  <div key={it.id} style={{ opacity: dragId === it.id ? 0.4 : 1 }} onDragEnd={() => { setDragId(null); setOverCol(null); }}>
                    <ItemChip item={it} draggable onDragStart={() => setDragId(it.id)} />
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Assets: what the campaign file actually holds ───────────────────────────

function AssetsTab({ items, accent, onCopied }: { items: ViewItem[]; accent: string; onCopied: () => void }) {
  const assets = useMemo(() => campaignAssets(items), [items]);
  const [open, setOpen] = useState<string | null>(null);

  if (assets.drafts.length === 0 && assets.links.length === 0) {
    return (
      <EmptyState>
        No assets yet: a piece&apos;s draft appears here once it is drafted, and its link once it is marked published.
        {assets.undrafted > 0 ? ` ${assets.undrafted} item${assets.undrafted === 1 ? "" : "s"} still undrafted.` : ""}
        {" "}This store holds text and links only; there are no file uploads.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="rounded-xl border p-4" style={panel}>
        <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={{ color: accent }}>
          Drafts · {assets.drafts.length}{assets.undrafted > 0 ? ` (${assets.undrafted} undrafted)` : ""}
        </div>
        {assets.drafts.length === 0 ? (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No drafts yet.</div>
        ) : (
          <div className="space-y-2">
            {assets.drafts.map((d) => {
              const item = items.find((i) => i.id === d.id);
              const isOpen = open === d.id;
              return (
                <div key={d.id} className="rounded-lg border p-2.5" style={panel}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[9px] uppercase" style={{ color: STATUS_COLOR[d.status] }}>{d.status}</span>
                    <span className="text-[12.5px] font-medium min-w-0 truncate" style={{ color: "var(--fg)" }}>{d.title}</span>
                    <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--fg-dimmer)", fontVariantNumeric: "tabular-nums" }}>
                      {CHANNEL_LABEL[d.channel]}{d.platform ? ` · ${d.platform}` : ""} · {d.words} words · {d.chars} chars
                    </span>
                    <button type="button" onClick={() => setOpen(isOpen ? null : d.id)}
                      className="text-[11px] px-2 py-0.5 rounded-md border" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
                      {isOpen ? "Hide" : "Show"}
                    </button>
                    <button type="button"
                      onClick={() => { if (item?.draft) void navigator.clipboard?.writeText(item.draft).then(onCopied).catch(() => {}); }}
                      className="text-[11px] px-2 py-0.5 rounded-md border" style={{ borderColor: `${accent}66`, color: accent }}>
                      Copy
                    </button>
                  </div>
                  {isOpen && item?.draft && (
                    <pre className="text-[12px] whitespace-pre-wrap font-sans mt-2 mb-0 max-h-[360px] overflow-auto" style={{ color: "var(--fg-dim)" }}>{item.draft}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border p-4" style={panel}>
        <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={{ color: accent }}>Published links · {assets.links.length}</div>
        {assets.links.length === 0 ? (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No published links stored yet (Mark published with a URL in the hub).</div>
        ) : (
          <ul className="m-0 p-0 list-none space-y-1.5">
            {assets.links.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-[12.5px]">
                <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline min-w-0 truncate" style={{ color: accent }}>
                  <ExternalLink size={11} /> {l.title}
                </a>
                <span className="font-mono text-[10px] truncate" style={{ color: "var(--fg-dimmer)" }}>{l.url}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>This store holds text and links only; there are no file uploads.</div>
    </div>
  );
}

// ── Metrics: only what the stored rows can count ────────────────────────────

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={panel} title={hint}>
      <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>{label}</div>
      <div className="text-[18px] font-semibold" style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function MetricsTab({ items, accent }: { items: ViewItem[]; accent: string }) {
  const m = useMemo(() => campaignMetrics(items, todayKey()), [items]);

  if (items.length === 0) {
    return <EmptyState>No items yet, so nothing to count. Plan the campaign from the hub.</EmptyState>;
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        <Stat label="Items" value={m.total} />
        <Stat label="Drafted" value={m.drafted} hint="Items with a draft, whatever their status" />
        <Stat label="Awaiting approval" value={m.awaitingApproval} hint="Status drafted" />
        <Stat label="Published" value={m.byStatus.published} />
        <Stat label="Overdue" value={m.overdue} hint="Scheduled date before today and not published" />
        <Stat label="Unscheduled" value={m.unscheduled} hint="Not published and no scheduled date" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-4" style={panel}>
          <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={{ color: accent }}>By status</div>
          {STATUSES.map((st) => (
            <div key={st} className="flex items-center justify-between text-[12.5px] py-0.5">
              <span style={{ color: STATUS_COLOR[st] }}>{st}</span>
              <span style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{m.byStatus[st]}</span>
            </div>
          ))}
        </div>
        <div className="rounded-xl border p-4" style={panel}>
          <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={{ color: accent }}>By channel</div>
          {CHANNELS.map((ch) => (
            <div key={ch} className="flex items-center justify-between text-[12.5px] py-0.5">
              <span style={{ color: "var(--fg-dim)" }}>{CHANNEL_LABEL[ch]}</span>
              <span style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{m.byChannel[ch]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border p-4" style={panel}>
        <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={{ color: accent }}>Published per week</div>
        {m.publishedPerWeek.length === 0 ? (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>
            {m.byStatus.published === 0 ? "Nothing published yet." : "No dated publications yet."}
          </div>
        ) : (
          m.publishedPerWeek.map((w) => (
            <div key={w.week} className="flex items-center justify-between text-[12.5px] py-0.5">
              <span className="font-mono" style={{ color: "var(--fg-dim)" }}>{w.week}</span>
              <span style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{w.count}</span>
            </div>
          ))
        )}
        {m.publishedUndated > 0 && (
          <div className="text-[11px] mt-2" style={{ color: "var(--fg-dimmer)" }}>
            {m.publishedUndated} published item{m.publishedUndated === 1 ? "" : "s"} carr{m.publishedUndated === 1 ? "ies" : "y"} no publish date (marked before dates were recorded), so {m.publishedUndated === 1 ? "it is" : "they are"} not placed in a week.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-dashed p-4 text-[12px]" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}>
        {NO_ENGAGEMENT_SOURCE}
      </div>
    </div>
  );
}
