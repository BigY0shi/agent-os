// SPEC-F K — client-safe Newsletter types.
//
// NO node imports (the agentsTypes.ts convention): components import from here,
// never from store.ts / sync.ts / parse.ts, which all pull node modules.

export const CADENCES = ["daily", "weekly", "monthly", "unknown"] as const;
export type Cadence = (typeof CADENCES)[number];

export const SUBSCRIPTION_STATUSES = ["active", "paused", "dead"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PARSE_STATUSES = ["pending", "parsed", "failed", "skipped"] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export function isCadence(v: unknown): v is Cadence {
  return typeof v === "string" && (CADENCES as readonly string[]).includes(v);
}
export function isSubscriptionStatus(v: unknown): v is SubscriptionStatus {
  return typeof v === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(v);
}
export function isParseStatus(v: unknown): v is ParseStatus {
  return typeof v === "string" && (PARSE_STATUSES as readonly string[]).includes(v);
}

export interface Subscription {
  id: string;
  name: string;
  topic: string | null;
  /** addy.io alias UUID. */
  aliasId: string | null;
  /** e.g. x7f2@<domain>.addy.io — the address the newsletter is signed up with. */
  aliasEmail: string | null;
  signupUrl: string | null;
  cadence: Cadence;
  status: SubscriptionStatus;
  createdAt: string;
  updatedAt: string | null;
}

export interface NewsletterEmail {
  id: string;
  gmailId: string;
  threadId: string | null;
  subscriptionId: string | null;
  fromAddr: string | null;
  /** Display name off the From header ("Stratechery"), when the sender set one.
   *  This is the source chip — see dedupe.sourceNameFor. */
  fromName: string | null;
  toAddr: string | null;
  subject: string | null;
  receivedAt: string;
  contentMd: string;
  parseStatus: ParseStatus;
  parseError: string | null;
  createdAt: string;
}

export interface Story {
  id: string;
  title: string;
  canonicalUrl: string | null;
  summary: string;
  topic: string | null;
  /** YYYY-MM-DD — the edition-date bucket, not an instant. */
  firstSeen: string;
  createdAt: string;
}

export interface StorySource {
  storyId: string;
  emailId: string;
  sourceName: string;
  itemUrl: string | null;
  itemTitle: string | null;
}

/** One extracted item from a newsletter email, before dedupe. */
export interface ExtractedItem {
  title: string;
  url?: string;
  summary: string;
}

/** SPEC-F §5 EditionDoc (K4.1 builds it; the shape is contracted here). */
export interface EditionDoc {
  date: string;
  builtAt: string;
  sections: Array<{
    topic: string;
    stories: Array<{
      id: string;
      title: string;
      url?: string;
      summary: string;
      sources: Array<{ name: string; url?: string }>;
    }>;
  }>;
  stats: { emails: number; stories: number; duplicatesMerged: number };
}

/** POST /api/newsletter/sync result (§5). */
export interface SyncRunResult {
  fetched: number;
  parsed: number;
  failed: number;
  skipped: number;
  newStories: number;
  merged: number;
  /**
   * Honest telemetry (K3.2): true when the embedder was unreachable, so dedupe
   * fell back to canonical-URL matching only for at least one item.
   */
  embedDegraded: boolean;
  watermark: string | null;
  /** Set when the run did nothing, with the reason (never a silent no-op). */
  reason?: string;
  ranAt: string;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  lastRun: SyncRunResult | null;
  running: boolean;
  gmailConfigured: boolean;
  addyConfigured: boolean;
}
