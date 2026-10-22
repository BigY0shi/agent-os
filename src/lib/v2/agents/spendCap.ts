// Per-run spend ceiling, in dollars and in tokens.
//
// The gap this closes: agentsRuntime RECORDED total_cost_usd and never checked
// it, and discarded the SDK's token usage entirely. Harness loops were bounded
// by iteration count (1-50), which bounds how many times a loop runs but not
// how much any one iteration costs. A single long iteration, or fifty
// expensive ones, had no ceiling at all.
//
// Deliberately switchable OFF. A long-horizon run is a legitimate thing to
// want, and a cap that cannot be lifted becomes a cap people work around by
// disabling something more important. Off is a real setting, not a loophole.

/** A limit <= 0 means that dimension is unbounded; `enabled: false` means both are. */
export interface SpendLimits {
  enabled: boolean;
  maxUsd: number;
  maxTokens: number;
}

export interface SpendUsage {
  usd: number;
  tokens: number;
}

export const DEFAULT_SPEND_LIMITS: SpendLimits = {
  enabled: true,
  // Conservative enough to stop a runaway before it hurts, high enough that an
  // ordinary run never meets it. A cap that trips on normal work gets switched
  // off permanently on day two, which leaves nothing guarding day three.
  maxUsd: 5,
  maxTokens: 2_000_000,
};

/**
 * Total tokens from an SDK result's `usage`.
 *
 * Sums input, output, and both cache buckets, because cache reads are billed
 * and a cap that ignored them would undercount the expensive case it exists to
 * catch. Every field is guarded: the SDK's usage shape is versioned and a
 * missing key must read as zero rather than NaN, which would silently disable
 * the comparison downstream.
 */
export function tokensFrom(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === "number" && Number.isFinite(u[k]) ? (u[k] as number) : 0);
  return (
    n("input_tokens") +
    n("output_tokens") +
    n("cache_read_input_tokens") +
    n("cache_creation_input_tokens")
  );
}

export interface SpendVerdict {
  over: boolean;
  /** Present when over. Written to be shown to a human verbatim. */
  reason?: string;
  /** Which ceiling tripped, for the UI and the audit line. */
  dimension?: "usd" | "tokens";
}

/**
 * Has this run spent enough to stop?
 *
 * Checked at the harness loop boundary, so a run that trips the ceiling keeps
 * the work it already produced and reports why it stopped, rather than throwing
 * away a partial result. That mirrors how the iteration cap already behaves:
 * "stopping honestly" beats failing.
 */
export function evaluateSpend(usage: SpendUsage, limits: SpendLimits): SpendVerdict {
  if (!limits.enabled) return { over: false };

  if (limits.maxUsd > 0 && usage.usd >= limits.maxUsd) {
    return {
      over: true,
      dimension: "usd",
      reason:
        `Spend ceiling reached: $${usage.usd.toFixed(2)} of $${limits.maxUsd.toFixed(2)} for this run. ` +
        `Stopping here rather than continuing. Raise or switch off the ceiling in Agents settings ` +
        `if this run is meant to be long-horizon.`,
    };
  }

  if (limits.maxTokens > 0 && usage.tokens >= limits.maxTokens) {
    return {
      over: true,
      dimension: "tokens",
      reason:
        `Token ceiling reached: ${usage.tokens.toLocaleString()} of ${limits.maxTokens.toLocaleString()} ` +
        `for this run. Stopping here rather than continuing. Raise or switch off the ceiling in Agents ` +
        `settings if this run is meant to be long-horizon.`,
    };
  }

  return { over: false };
}

/** Normalise whatever is in settings into usable limits. */
export function limitsFrom(raw: unknown): SpendLimits {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SPEND_LIMITS };
  const r = raw as Record<string, unknown>;
  const num = (k: string, fallback: number) =>
    typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : fallback;
  return {
    // Absent reads as ON. An install that has never opened the setting should
    // be capped, not uncapped.
    enabled: r.enabled !== false,
    maxUsd: num("maxUsd", DEFAULT_SPEND_LIMITS.maxUsd),
    maxTokens: num("maxTokens", DEFAULT_SPEND_LIMITS.maxTokens),
  };
}
