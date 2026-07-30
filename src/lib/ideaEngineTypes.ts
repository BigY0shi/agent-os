// Idea Engine — client-safe types + constants. NO node imports (this file is
// imported by client components — the HIRE_COLUMNS lesson). Server logic lives
// in ideaEngine.ts / ideaValidation.ts / ideaRadar.ts.
//
// The schema encodes the extraction-recipe invariants:
//   - every factual leaf is a Sourced<T> envelope (zero unsourced numerics)
//   - "insufficient_evidence" is a first-class confidence state
//   - every score stores the inputs it was computed from
//   - schema_version is additive-only after v1

export const IDEA_SCHEMA_VERSION = 1;

export type Confidence = "high" | "medium" | "low" | "insufficient_evidence";

export interface SourceRef {
  url: string;
  retrieved: string;          // ISO-8601
  excerpt?: string;           // short locator quote, not wholesale copying
}

/** Provenance envelope for any factual claim. value === null with
 *  confidence "insufficient_evidence" is a VALID, honest state. */
export interface Sourced<T = string> {
  value: T | null;
  sources: SourceRef[];
  confidence: Confidence;
  method?: string;            // how the value was derived
}

/** A score is invalid without its inputs — enforced at write time. */
export interface Score {
  value: number | null;
  scale: [number, number];    // e.g. [1, 10]
  inputs: { name: string; value: string }[];
  method: string;
}

export interface PainEvidence {
  quote: string;
  where: string;              // "r/smallbusiness", "G2 review of X", ...
  url: string;
  signal: "complaint" | "workaround" | "willingness_to_pay" | "frequency";
}

export interface Competitor {
  name: string;
  url?: string;
  pricing?: Sourced<string>;
  positioning?: string;
  weakness?: string;
}

export interface IdeaDossier {
  schema_version: number;
  id: string;
  generated_at: string;
  identity: {
    title: string;
    one_liner: string;
    category: string;
    tags: string[];
  };
  opportunity: {
    problem: string;
    avatar: string;
    pain_evidence: PainEvidence[];
    why_now: Sourced<string>;
    trend_signals: Sourced<string>[];
  };
  market: {
    size_estimates: Sourced<string>[];
    competitors: Competitor[];
    gaps: string[];
    moat_potential: string;
  };
  business: {
    model: string;
    pricing_anchor: Sourced<string>;
    value_ladder: string[];
    channels: string[];
    first_customers: string;
  };
  execution: {
    mvp_scope: string;
    build_plan: string[];
    time_to_mvp: string;
    founder_fit_notes: string;
  };
  scores: {
    opportunity: Score;
    pain: Score;
    timing: Score;
    feasibility: Score;
    moat: Score;
  };
  verdict: {
    call: "build" | "watch" | "pass";
    rationale: string;
    kill_case_summary: string;
  };
  provenance: {
    model_seats: Record<string, string>;   // seat -> model that ACTUALLY ran
    run_ms: number;
    idea_input: string;                    // what the run was asked to validate
    signal_ids: string[];                  // radar signals that fed it (if any)
    degraded_seats: string[];              // seats that failed — recorded, never faked
  };
}

// ---- validation run -------------------------------------------------------

export type SeatName = "painMiner" | "marketMapper" | "sizingAnalyst" | "killPass" | "judge" | "writer";

export const SEAT_LABELS: Record<SeatName, string> = {
  painMiner: "Pain evidence",
  marketMapper: "Market map",
  sizingAnalyst: "Sizing",
  killPass: "Kill-it adversary",
  judge: "Verdict judge",
  writer: "Dossier writer",
};

export interface ValidationRun {
  id: string;
  idea: string;
  candidateId?: string;
  status: "running" | "done" | "error";
  /** seat -> pending | running | done | failed */
  seats: Record<string, string>;
  startedAt: number;
  endedAt?: number;
  dossierId?: string;
  error?: string;
}

// ---- radar (Phase 2 shapes, defined now so the board can render early) ----

export interface RawSignal {
  id: string;
  source: "gtrends" | "reddit" | "hn" | "producthunt" | "autocomplete" | "tavily";
  term: string;
  title?: string;
  url?: string;
  metrics: Record<string, number | string>;
  excerpt?: string;
  capturedAt: number;
}

export type CandidateStatus = "new" | "watching" | "validating" | "validated" | "parked";

export interface TrendCandidate {
  id: string;
  topic: string;
  thesis: string;
  status: CandidateStatus;
  signalIds: string[];
  scores: { momentum: Score; pain: Score; builders: Score };
  firstSeen: number;
  updatedAt: number;
  dossierId?: string;
}

export const CANDIDATE_COLUMNS: { key: CandidateStatus; label: string; accent: string }[] = [
  { key: "new", label: "New", accent: "#a855f7" },
  { key: "watching", label: "Watching", accent: "#22d3ee" },
  { key: "validating", label: "Validating", accent: "#fbbf24" },
  { key: "validated", label: "Validated", accent: "#34d399" },
  { key: "parked", label: "Parked", accent: "#5a5d80" },
];

export const VERDICT_META: Record<IdeaDossier["verdict"]["call"], { label: string; color: string }> = {
  build: { label: "BUILD", color: "#34d399" },
  watch: { label: "WATCH", color: "#fbbf24" },
  pass: { label: "PASS", color: "#f87171" },
};

export const CONFIDENCE_COLORS: Record<Confidence, string> = {
  high: "#34d399",
  medium: "#fbbf24",
  low: "#fb923c",
  insufficient_evidence: "#94a3b8",
};
