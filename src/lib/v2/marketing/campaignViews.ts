// S32 - the campaign page's Calendar / Board / Assets / Metrics, computed from
// the campaign file ONLY. CLIENT-SAFE: no node imports, so CampaignDetail.tsx
// and the smoke share one implementation. Nothing here estimates anything: a
// number that cannot be computed from stored rows is not a number here.

export type Channel = "youtube" | "short-video" | "text-post" | "blog";
export type ItemStatus = "idea" | "drafted" | "approved" | "scheduled" | "published";

export interface ViewItem {
  id: string;
  channel: Channel;
  platform?: string;
  title: string;
  brief?: string;
  draft?: string;
  status: ItemStatus;
  scheduledFor?: string;
  publishedUrl?: string;
  publishedAt?: string;
  updated?: string;
}

export const STATUSES: readonly ItemStatus[] = ["idea", "drafted", "approved", "scheduled", "published"];
export const CHANNELS: readonly Channel[] = ["youtube", "short-video", "text-post", "blog"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day an item sits on: its scheduled date, else the day it was marked
 *  published (items published before publishedAt existed have neither). */
export function itemDay(item: Pick<ViewItem, "scheduledFor" | "publishedAt">): string | null {
  if (item.scheduledFor && DAY.test(item.scheduledFor)) return item.scheduledFor;
  if (item.publishedAt && /^\d{4}-\d{2}-\d{2}T/.test(item.publishedAt)) return item.publishedAt.slice(0, 10);
  return null;
}

/** Calendar buckets: dated items by day, undated listed apart. */
export function bucketItemsByDay<T extends ViewItem>(items: readonly T[]): { byDay: Map<string, T[]>; undated: T[] } {
  const byDay = new Map<string, T[]>();
  const undated: T[] = [];
  for (const it of items) {
    const day = itemDay(it);
    if (!day) { undated.push(it); continue; }
    const arr = byDay.get(day);
    if (arr) arr.push(it); else byDay.set(day, [it]);
  }
  return { byDay, undated };
}

/** Month grid cells, Monday-first, padded to whole weeks (null = blank). */
export function monthCells(year: number, month0: number): Array<number | null> {
  const lead = (new Date(year, month0, 1).getDay() + 6) % 7;
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function dayKey(year: number, month0: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month0 + 1)}-${p(day)}`;
}

// ── Board ───────────────────────────────────────────────────────────────────

export type BoardAction = "approve" | "unapprove" | "published";

/**
 * Translate a drag from one column to another into the existing item API
 * (POST /api/marketing/item), or refuse with the reason. The board invents no
 * transition the API does not have: an idea becomes drafted only by drafting,
 * and 'scheduled' is 'approved with a date', so it needs the date first.
 */
export function boardMove(item: Pick<ViewItem, "status" | "draft" | "scheduledFor">, target: ItemStatus):
  | { ok: true; action: BoardAction; note?: string }
  | { ok: false; reason: string } {
  const from = item.status;
  if (from === target) return { ok: false, reason: "already there" };
  switch (target) {
    case "idea":
      if (item.draft) return { ok: false, reason: "an item with a draft cannot go back to idea; unapprove sends it to drafted" };
      return { ok: true, action: "unapprove" };
    case "drafted":
      if (from === "idea") return { ok: false, reason: "needs a draft first: use Draft it in the hub" };
      return { ok: true, action: "unapprove" };
    case "approved":
      if (from === "idea") return { ok: false, reason: "needs a draft first: use Draft it in the hub" };
      if (from === "published") return { ok: false, reason: "a published item cannot be un-published; unapprove sends it to drafted" };
      if (from === "scheduled") return { ok: false, reason: "a dated item stays in scheduled; clear its date in the hub to move it" };
      if (item.scheduledFor) return { ok: true, action: "approve", note: "it has a date, so it lands in scheduled" };
      return { ok: true, action: "approve" };
    case "scheduled":
      if (from === "idea") return { ok: false, reason: "needs a draft first: use Draft it in the hub" };
      if (from === "published") return { ok: false, reason: "a published item cannot be un-published; unapprove sends it to drafted" };
      if (!item.scheduledFor) return { ok: false, reason: "set a date first (the date picker in the campaign drawer)" };
      if (from === "approved") return { ok: true, action: "approve" };
      return { ok: true, action: "approve" };
    case "published":
      if (from !== "approved" && from !== "scheduled") return { ok: false, reason: "only approved items can be marked published" };
      return { ok: true, action: "published" };
  }
}

// ── Assets ──────────────────────────────────────────────────────────────────

export interface CampaignAssets {
  /** Each produced draft: the text asset the campaign actually holds. */
  drafts: Array<{ id: string; title: string; channel: Channel; platform?: string; status: ItemStatus; chars: number; words: number; updated?: string }>;
  /** Published links the owner stored with Mark published. */
  links: Array<{ id: string; title: string; url: string; publishedAt?: string }>;
  /** Items with nothing produced yet. */
  undrafted: number;
}

export function campaignAssets(items: readonly ViewItem[]): CampaignAssets {
  const drafts: CampaignAssets["drafts"] = [];
  const links: CampaignAssets["links"] = [];
  let undrafted = 0;
  for (const it of items) {
    if (it.draft && it.draft.trim()) {
      const t = it.draft.trim();
      drafts.push({ id: it.id, title: it.title, channel: it.channel, platform: it.platform, status: it.status, chars: t.length, words: t.split(/\s+/).filter(Boolean).length, updated: it.updated });
    } else {
      undrafted += 1;
    }
    if (it.publishedUrl) links.push({ id: it.id, title: it.title, url: it.publishedUrl, publishedAt: it.publishedAt });
  }
  return { drafts, links, undrafted };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface CampaignMetrics {
  total: number;
  byStatus: Record<ItemStatus, number>;
  byChannel: Record<Channel, number>;
  /** Published per ISO week, from publishedAt; keys "YYYY-Www", ascending. */
  publishedPerWeek: Array<{ week: string; count: number }>;
  /** Published items that carry no publishedAt (marked before S32); never guessed into a week. */
  publishedUndated: number;
  /** scheduledFor before `today` and not yet published. */
  overdue: number;
  /** Not published and no scheduled date. */
  unscheduled: number;
  awaitingApproval: number;
  drafted: number;
}

/** ISO-8601 week label for a YYYY-MM-DD day. */
export function isoWeek(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function campaignMetrics(items: readonly ViewItem[], today: string): CampaignMetrics {
  const byStatus: Record<ItemStatus, number> = { idea: 0, drafted: 0, approved: 0, scheduled: 0, published: 0 };
  const byChannel: Record<Channel, number> = { youtube: 0, "short-video": 0, "text-post": 0, blog: 0 };
  const weeks = new Map<string, number>();
  let publishedUndated = 0;
  let overdue = 0;
  let unscheduled = 0;
  let drafted = 0;
  for (const it of items) {
    if (it.status in byStatus) byStatus[it.status] += 1;
    if (it.channel in byChannel) byChannel[it.channel] += 1;
    if (it.draft && it.draft.trim()) drafted += 1;
    if (it.status === "published") {
      const day = it.publishedAt && /^\d{4}-\d{2}-\d{2}T/.test(it.publishedAt) ? it.publishedAt.slice(0, 10) : null;
      if (day) { const w = isoWeek(day); weeks.set(w, (weeks.get(w) ?? 0) + 1); } else publishedUndated += 1;
      continue;
    }
    if (it.scheduledFor && DAY.test(it.scheduledFor)) {
      if (it.scheduledFor < today) overdue += 1;
    } else {
      unscheduled += 1;
    }
  }
  return {
    total: items.length,
    byStatus,
    byChannel,
    publishedPerWeek: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count })),
    publishedUndated,
    overdue,
    unscheduled,
    awaitingApproval: byStatus.drafted,
    drafted,
  };
}

/** The honest sentence for the engagement slot: nothing is posted from the hub,
 *  so there is no source for views, clicks or replies. */
export const NO_ENGAGEMENT_SOURCE =
  "No engagement data: nothing is posted from the hub, so there is no source for views, clicks or replies. Only counts from the stored items are shown.";
