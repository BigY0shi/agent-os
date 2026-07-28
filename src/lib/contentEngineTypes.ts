// Client-safe types + constants for the Content Engine. Split from
// contentEngine.ts because that module imports node:fs and the "use client"
// component needs the CHANNELS value — same pattern as hireDeskColumns.ts.

export const CHANNELS = ["x", "linkedin", "youtube", "tiktok", "instagram", "blog", "reddit", "substack"] as const;
export type Channel = (typeof CHANNELS)[number];

export type ItemStatus = "planned" | "drafted" | "posted" | "skipped";

export interface Metrics {
  views?: number; likes?: number; comments?: number; shares?: number; clicks?: number;
  /** When the numbers were logged. */
  at?: number;
}

export interface Materials {
  /** The post copy itself (or the article/script body for long-form). */
  copy?: string;
  hashtags?: string;
  /** Prompt for the Thumbnails/image tooling. */
  imagePrompt?: string;
  /** Present for video-shaped formats. */
  videoScript?: string;
  /** Which model actually generated this ("codex" | "kimi" | "claude"). */
  by?: string;
  at?: number;
}

export interface ContentItem {
  id: string;
  /** ISO date (yyyy-mm-dd) the post is planned for. */
  date: string;
  channel: Channel;
  /** e.g. "thread", "short", "post", "article", "carousel" — planner's choice. */
  format: string;
  topic: string;
  hook: string;
  status: ItemStatus;
  materials: Materials | null;
  postedUrl: string | null;
  metrics: Metrics | null;
  notes: string;
  updatedAt: number;
}

export interface EngineState {
  /** What the operator told the planner — kept so replans stay consistent. */
  plan: { goals: string; channels: Channel[]; perWeek: number; weeks: number; at: number } | null;
  items: ContentItem[];
  /** Latest AI performance read. */
  insights: { text: string; at: number; by?: string } | null;
}
