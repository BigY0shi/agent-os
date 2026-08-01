// Idea Engine — the validation council. Cross-lineage per the orchestration
// doctrine, and per spec invariant #5 the KILL seat runs on a different lineage
// (codex/OpenAI) than the research seats (claude) and the sizing seat (kimi),
// so the validator never grades its own homework.
//
// Seat flow:
//   painMiner + marketMapper   (claude, web-capable builder posture)  — parallel
//   sizingAnalyst              (kimi, evidence-only, no web)
//   killPass                   (codex — different lineage, adversarial)
//   judge                      (claude, sees the kill case before scoring)
//   writer                     (claude opus-tier, assembles the dossier)
//
// Every seat's raw output is JSONL-logged. A failed seat degrades the run and
// is recorded in provenance.degraded_seats — output is omitted, never faked.

import { randomUUID } from "node:crypto";
import { run } from "./runner";
import { cliComplete } from "./loopEngine";
import { seatComplete, resolveKimiModel } from "./brainstorm";
import { claudeBuilderArgs } from "./agentPowers";
import { readSettings } from "./settings";
import { CLAUDE_MODEL } from "./config";
import {
  IDEA_SCHEMA_VERSION, type IdeaDossier, type PainEvidence, type Competitor,
  type Sourced, type ValidationRun, type SeatName,
} from "./ideaEngineTypes";
import { IDEA_DIR, logSeat, sanitizeScore, sanitizeSourced, saveDossier, saveRun } from "./ideaEngine";
import { patchCandidate } from "./ideaRadar";

const g = globalThis as unknown as { __ideaRuns?: Map<string, ValidationRun> };
const RUNS: Map<string, ValidationRun> = (g.__ideaRuns ??= new Map());

export function liveRun(id: string): ValidationRun | undefined { return RUNS.get(id); }
export function anyRunning(): boolean {
  for (const r of RUNS.values()) if (r.status === "running") return true;
  return false;
}
/** The in-flight run, if any — lets the UI resume its live panel after a page
 *  reload, and surface daily-loop runs the page never started itself. */
export function activeRun(): ValidationRun | null {
  for (const r of RUNS.values()) if (r.status === "running") return r;
  return null;
}

/** Cancel a running council. Frees the one-at-a-time lock immediately; seats
 *  already in flight die on their own CLI timeouts (they can't publish — every
 *  stage boundary in execute() re-checks the status before proceeding). */
export async function cancelValidation(id: string): Promise<boolean> {
  const r = RUNS.get(id);
  if (!r || r.status !== "running") return false;
  r.status = "error";
  r.error = "cancelled by user";
  r.endedAt = Date.now();
  await saveRun(r);
  if (r.candidateId) await patchCandidate(r.candidateId, { status: "new" }).catch(() => {});
  return true;
}

function models() {
  const s = readSettings().ideaEngine;
  return {
    research: (s.researchModel || "").trim() || "claude-sonnet-5",
    writer: (s.writerModel || "").trim() || CLAUDE_MODEL,
    kimi: (s.kimiModel || "").trim() || undefined,
  };
}

/** claude with web tools (builder posture) returning raw text. */
async function claudeWeb(model: string, prompt: string, timeoutMs: number): Promise<string> {
  const r = await run(
    "claude",
    ["-p", "--model", model, "--output-format", "text", ...claudeBuilderArgs()],
    { timeoutMs, input: prompt, cwd: IDEA_DIR },
  );
  const out = (r.stdout || "").trim();
  if (!r.ok || !out) throw new Error(r.stderr?.slice(-200) || "claude returned nothing");
  return out;
}

function extractJson<T>(raw: string): T {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in output");
  return JSON.parse(m[0]) as T;
}

const EVIDENCE_RULES =
  "HARD RULES: Only claim what you can point to. Every URL must be one you actually loaded. " +
  "Never invent statistics, market sizes, prices, or quotes. If you cannot verify something, " +
  "omit it or mark it insufficient_evidence — an honest gap beats a fluent fabrication.";

// ---- seat prompts ---------------------------------------------------------

function painMinerPrompt(idea: string): string {
  return (
    "You are the PAIN EVIDENCE seat of an idea-validation council. Research the web for REAL evidence " +
    `that the following problem exists and hurts:\n\nIDEA: ${idea}\n\n` +
    "Search forums (Reddit, HN, niche communities), product reviews (G2/Capterra/app stores), and social posts. " +
    "Collect 5-10 pieces of evidence: direct quotes from real people describing the pain, workarounds they use, " +
    "or willingness to pay.\n\n" + EVIDENCE_RULES + "\n\n" +
    "Return ONLY minified JSON:\n" +
    '{"pain_evidence":[{"quote":"...","where":"r/sub or site name","url":"https://...","signal":"complaint|workaround|willingness_to_pay|frequency"}],' +
    '"pain_read":"2-3 sentences: how real and how frequent this pain appears to be, honestly"}'
  );
}

function marketMapperPrompt(idea: string): string {
  return (
    "You are the MARKET MAP seat of an idea-validation council. Research the current market for:\n\n" +
    `IDEA: ${idea}\n\n` +
    "Find: direct + adjacent competitors (with real URLs and published pricing when visible), positioning gaps, " +
    "and timing evidence (what changed recently that makes this newly possible or newly urgent).\n\n" + EVIDENCE_RULES + "\n\n" +
    "Return ONLY minified JSON:\n" +
    '{"competitors":[{"name":"...","url":"https://...","pricing":{"value":"$X/mo tier summary","sources":[{"url":"https://...","retrieved":"' +
    new Date().toISOString().slice(0, 10) +
    '"}],"confidence":"high|medium|low"},"positioning":"...","weakness":"..."}],' +
    '"gaps":["..."],' +
    '"why_now":{"value":"...","sources":[{"url":"https://..."}],"confidence":"high|medium|low"},' +
    '"trend_signals":[{"value":"...","sources":[{"url":"https://..."}],"confidence":"medium"}]}'
  );
}

function sizingPrompt(idea: string, evidence: string): string {
  return (
    "You are the SIZING seat of an idea-validation council. You have NO web access — you may ONLY reason from " +
    "the evidence pack below. Produce bottom-up market sizing statements for the idea, showing your method. " +
    "If the evidence does not support a number, return confidence \"insufficient_evidence\" with value null — " +
    "that is a correct and welcome answer. NEVER invent a number.\n\n" +
    `IDEA: ${idea}\n\nEVIDENCE PACK:\n${evidence.slice(0, 12000)}\n\n` +
    "Return ONLY minified JSON:\n" +
    '{"size_estimates":[{"value":"statement with the arithmetic shown" ,"sources":[{"url":"url from the evidence pack"}],"confidence":"medium|low|insufficient_evidence","method":"bottom-up: ..."}],' +
    '"sizing_read":"1-2 honest sentences on how confident the sizing can be"}'
  );
}

function killPrompt(idea: string, evidence: string): string {
  return (
    "You are the KILL-IT ADVERSARY on an idea-validation council. Your ONLY job is to make the strongest " +
    "honest case AGAINST this idea. Attack: demand (is the pain evidence cherry-picked or thin?), " +
    "competition (who crushes this and why), distribution (why nobody will find it), economics (why the " +
    "numbers don't work), and the evidence itself (flag any claim that is unfalsifiable or unsourced). " +
    "Do not be contrarian for sport — be the smartest skeptic in the room. If, despite real effort, the idea " +
    "survives, say what specifically survives and why.\n\n" +
    `IDEA: ${idea}\n\nTHE COUNCIL'S EVIDENCE SO FAR:\n${evidence.slice(0, 14000)}\n\n` +
    "Plain text, under 400 words."
  );
}

function judgePrompt(idea: string, evidence: string, killCase: string): string {
  return (
    "You are the VERDICT JUDGE of an idea-validation council. Score the idea and make the call. " +
    "You must weigh the kill case seriously — if you score against it, say why in the rationale. " +
    "Every score MUST list the concrete inputs it was computed from (evidence items, competitor facts, kill-case points). " +
    "A score you cannot back with inputs must be null.\n\n" +
    `IDEA: ${idea}\n\nEVIDENCE:\n${evidence.slice(0, 12000)}\n\nKILL CASE:\n${killCase.slice(0, 4000)}\n\n` +
    "Return ONLY minified JSON:\n" +
    '{"scores":{"opportunity":{"value":7,"scale":[1,10],"inputs":[{"name":"...","value":"..."}],"method":"..."},' +
    '"pain":{...},"timing":{...},"feasibility":{...},"moat":{...}},' +
    '"verdict":{"call":"build|watch|pass","rationale":"3-5 sentences citing the decisive inputs"}}'
  );
}

function writerPrompt(idea: string, packs: Record<string, string>): string {
  return (
    "You are the DOSSIER WRITER. Assemble a complete idea dossier as JSON from the council outputs below. " +
    "PRESERVE all source URLs exactly. NEVER add a number, price, or statistic that is not in the packs — " +
    "use null values with confidence insufficient_evidence for gaps. Free-prose fields (problem, avatar, model, " +
    "mvp_scope, build_plan...) you write yourself from the evidence, concretely and plainly, no hype. " +
    "The operator is a solo RevOps/automation consultant (Launchworks) — write founder_fit_notes for THAT founder.\n\n" +
    `IDEA: ${idea}\n\n` +
    Object.entries(packs).map(([k, v]) => `── ${k.toUpperCase()} ──\n${v.slice(0, 9000)}`).join("\n\n") +
    "\n\nReturn ONLY minified JSON with EXACTLY these keys:\n" +
    '{"identity":{"title":"...","one_liner":"...","category":"...","tags":["..."]},' +
    '"opportunity":{"problem":"...","avatar":"...","why_now":{sourced},"trend_signals":[{sourced}]},' +
    '"market":{"gaps":["..."],"moat_potential":"..."},' +
    '"business":{"model":"...","pricing_anchor":{sourced},"value_ladder":["..."],"channels":["..."],"first_customers":"..."},' +
    '"execution":{"mvp_scope":"...","build_plan":["..."],"time_to_mvp":"...","founder_fit_notes":"..."},' +
    '"kill_case_summary":"3-4 sentence honest summary of the strongest case against"}\n' +
    'where {sourced} = {"value":...,"sources":[{"url":"..."}],"confidence":"high|medium|low|insufficient_evidence","method":"..."}'
  );
}

// ---- the run --------------------------------------------------------------

export async function startValidation(idea: string, candidateId?: string): Promise<{ runId: string } | { error: string }> {
  if (!idea.trim()) return { error: "idea required" };
  if (anyRunning()) return { error: "a validation run is already in progress" };

  const runObj: ValidationRun = {
    id: randomUUID().slice(0, 12),
    idea: idea.trim(),
    candidateId,
    status: "running",
    seats: { painMiner: "pending", marketMapper: "pending", sizingAnalyst: "pending", killPass: "pending", judge: "pending", writer: "pending" },
    startedAt: Date.now(),
  };
  RUNS.set(runObj.id, runObj);
  await saveRun(runObj);
  if (candidateId) await patchCandidate(candidateId, { status: "validating" }).catch(() => {});

  void execute(runObj).catch(async (e) => {
    runObj.status = "error";
    runObj.error = String((e as Error)?.message || e);
    runObj.endedAt = Date.now();
    await saveRun(runObj);
    if (candidateId) await patchCandidate(candidateId, { status: "new" }).catch(() => {});
  });

  return { runId: runObj.id };
}

async function seatWrap<T>(runObj: ValidationRun, seat: SeatName, fn: () => Promise<T>): Promise<T | null> {
  runObj.seats[seat] = "running";
  await saveRun(runObj);
  try {
    const out = await fn();
    runObj.seats[seat] = "done";
    await saveRun(runObj);
    await logSeat(runObj.id, seat, { ok: true, out: typeof out === "string" ? (out as string).slice(0, 20000) : out });
    return out;
  } catch (e) {
    runObj.seats[seat] = "failed";
    await saveRun(runObj);
    await logSeat(runObj.id, seat, { ok: false, error: String((e as Error)?.message || e) });
    return null;
  }
}

async function execute(runObj: ValidationRun): Promise<void> {
  const m = models();
  const idea = runObj.idea;
  const degraded: string[] = [];
  const seatsUsed: Record<string, string> = {};

  // Research legs — parallel, both web-capable claude.
  const [painRaw, marketRaw] = await Promise.all([
    seatWrap(runObj, "painMiner", () => claudeWeb(m.research, painMinerPrompt(idea), 480_000)),
    seatWrap(runObj, "marketMapper", () => claudeWeb(m.research, marketMapperPrompt(idea), 480_000)),
  ]);
  seatsUsed.painMiner = m.research; seatsUsed.marketMapper = m.research;
  if (!painRaw) degraded.push("painMiner");
  if (!marketRaw) degraded.push("marketMapper");

  interface PainOut { pain_evidence?: PainEvidence[]; pain_read?: string }
  interface MarketOut { competitors?: Competitor[]; gaps?: string[]; why_now?: Sourced; trend_signals?: Sourced[] }
  let pain: PainOut = {}; let market: MarketOut = {};
  try { if (painRaw) pain = extractJson<PainOut>(painRaw); } catch { degraded.push("painMiner:parse"); }
  try { if (marketRaw) market = extractJson<MarketOut>(marketRaw); } catch { degraded.push("marketMapper:parse"); }

  if (runObj.status !== "running") return; // cancelled mid-research

  const evidencePack =
    `PAIN EVIDENCE:\n${JSON.stringify(pain, null, 1)}\n\nMARKET MAP:\n${JSON.stringify(market, null, 1)}`;

  // Sizing — kimi, evidence-only. Falls back to codex if Ollama is unreachable.
  interface SizingOut { size_estimates?: Sourced[]; sizing_read?: string }
  let sizing: SizingOut = {};
  const sizingRaw = await seatWrap(runObj, "sizingAnalyst", async () => {
    try {
      const kimiModel = await resolveKimiModel(m.kimi);
      seatsUsed.sizingAnalyst = kimiModel;
      return await seatComplete("kimi", sizingPrompt(idea, evidencePack), kimiModel);
    } catch {
      seatsUsed.sizingAnalyst = "codex (kimi unreachable)";
      return await cliComplete("codex", sizingPrompt(idea, evidencePack), { timeoutMs: 240_000 });
    }
  });
  if (!sizingRaw) degraded.push("sizingAnalyst");
  try { if (sizingRaw) sizing = extractJson<SizingOut>(sizingRaw); } catch { degraded.push("sizingAnalyst:parse"); }

  if (runObj.status !== "running") return; // cancelled during sizing

  // Kill pass — codex, MUST be a different lineage (spec invariant #5).
  const killCase = await seatWrap(runObj, "killPass", () =>
    cliComplete("codex", killPrompt(idea, evidencePack + `\n\nSIZING:\n${JSON.stringify(sizing)}`), { timeoutMs: 300_000 }));
  seatsUsed.killPass = "codex";
  if (!killCase) degraded.push("killPass");

  // Judge — claude, kill case in hand.
  interface JudgeOut { scores?: Record<string, Partial<import("./ideaEngineTypes").Score>>; verdict?: { call?: string; rationale?: string } }
  let judge: JudgeOut = {};
  const judgeRaw = await seatWrap(runObj, "judge", () =>
    claudeWeb(m.research, judgePrompt(idea, evidencePack + `\n\nSIZING:\n${JSON.stringify(sizing)}`, killCase || "(kill seat failed — treat absence of a kill case as a WEAKNESS of this run, not strength of the idea)"), 300_000));
  seatsUsed.judge = m.research;
  if (!judgeRaw) degraded.push("judge");
  try { if (judgeRaw) judge = extractJson<JudgeOut>(judgeRaw); } catch { degraded.push("judge:parse"); }

  if (runObj.status !== "running") return; // cancelled before the writer

  // Writer — assembles the dossier.
  interface WriterOut {
    identity?: IdeaDossier["identity"];
    opportunity?: { problem?: string; avatar?: string; why_now?: Sourced; trend_signals?: Sourced[] };
    market?: { gaps?: string[]; moat_potential?: string };
    business?: Partial<IdeaDossier["business"]>;
    execution?: Partial<IdeaDossier["execution"]>;
    kill_case_summary?: string;
  }
  const writerRaw = await seatWrap(runObj, "writer", () =>
    claudeWeb(m.writer, writerPrompt(idea, {
      pain: JSON.stringify(pain), market: JSON.stringify(market),
      sizing: JSON.stringify(sizing), kill: killCase || "(unavailable)",
      judge: JSON.stringify(judge),
    }), 480_000));
  seatsUsed.writer = m.writer;
  if (runObj.status !== "running") return; // cancelled during the writer
  if (!writerRaw) {
    runObj.status = "error";
    runObj.error = "writer seat failed — no dossier";
    runObj.endedAt = Date.now();
    await saveRun(runObj);
    if (runObj.candidateId) await patchCandidate(runObj.candidateId, { status: "new" }).catch(() => {});
    return;
  }
  let w: WriterOut = {};
  try { w = extractJson<WriterOut>(writerRaw); } catch {
    runObj.status = "error"; runObj.error = "writer returned unparseable output"; runObj.endedAt = Date.now();
    await saveRun(runObj);
    if (runObj.candidateId) await patchCandidate(runObj.candidateId, { status: "new" }).catch(() => {});
    return;
  }

  // Assemble + ENFORCE invariants in code (sanitizers drop unsourced numerics
  // and inputless scores regardless of what any model claimed).
  const call = ["build", "watch", "pass"].includes(judge.verdict?.call ?? "") ? judge.verdict!.call as "build" | "watch" | "pass" : "watch";
  const dossier: IdeaDossier = {
    schema_version: IDEA_SCHEMA_VERSION,
    id: runObj.id,
    generated_at: new Date().toISOString(),
    identity: {
      title: w.identity?.title || idea.slice(0, 80),
      one_liner: w.identity?.one_liner || "",
      category: w.identity?.category || "uncategorized",
      tags: Array.isArray(w.identity?.tags) ? w.identity!.tags.slice(0, 8) : [],
    },
    opportunity: {
      problem: w.opportunity?.problem || "",
      avatar: w.opportunity?.avatar || "",
      pain_evidence: (pain.pain_evidence || []).filter((p) => p?.quote && p?.url).slice(0, 12),
      why_now: sanitizeSourced(w.opportunity?.why_now ?? market.why_now),
      trend_signals: (w.opportunity?.trend_signals ?? market.trend_signals ?? []).map((t) => sanitizeSourced(t)).slice(0, 8),
    },
    market: {
      size_estimates: (sizing.size_estimates || []).map((s) => sanitizeSourced(s)).slice(0, 5),
      competitors: (market.competitors || []).filter((c) => c?.name).map((c) => ({
        ...c, pricing: c.pricing ? sanitizeSourced(c.pricing) : undefined,
      })).slice(0, 10),
      gaps: (w.market?.gaps ?? market.gaps ?? []).slice(0, 8),
      moat_potential: w.market?.moat_potential || "",
    },
    business: {
      model: w.business?.model || "",
      pricing_anchor: sanitizeSourced(w.business?.pricing_anchor),
      value_ladder: Array.isArray(w.business?.value_ladder) ? w.business!.value_ladder!.slice(0, 6) : [],
      channels: Array.isArray(w.business?.channels) ? w.business!.channels!.slice(0, 8) : [],
      first_customers: w.business?.first_customers || "",
    },
    execution: {
      mvp_scope: w.execution?.mvp_scope || "",
      build_plan: Array.isArray(w.execution?.build_plan) ? w.execution!.build_plan!.slice(0, 10) : [],
      time_to_mvp: w.execution?.time_to_mvp || "",
      founder_fit_notes: w.execution?.founder_fit_notes || "",
    },
    scores: {
      opportunity: sanitizeScore(judge.scores?.opportunity, "judge"),
      pain: sanitizeScore(judge.scores?.pain, "judge"),
      timing: sanitizeScore(judge.scores?.timing, "judge"),
      feasibility: sanitizeScore(judge.scores?.feasibility, "judge"),
      moat: sanitizeScore(judge.scores?.moat, "judge"),
    },
    verdict: {
      call,
      rationale: judge.verdict?.rationale || "judge seat degraded — verdict defaulted to watch",
      kill_case_summary: w.kill_case_summary || (killCase ? killCase.slice(0, 600) : "kill seat unavailable this run"),
    },
    provenance: {
      model_seats: seatsUsed,
      run_ms: Date.now() - runObj.startedAt,
      idea_input: idea,
      signal_ids: [],
      degraded_seats: degraded,
    },
  };

  if (runObj.status !== "running") return; // cancelled during assembly — don't publish
  await saveDossier(dossier);
  runObj.status = "done";
  runObj.dossierId = dossier.id;
  runObj.endedAt = Date.now();
  await saveRun(runObj);
  // Candidate-originated runs (manual "Validate ↑" or the daily loop) mark the
  // board entry validated here, so the daily picker never re-spends on it.
  if (runObj.candidateId) await patchCandidate(runObj.candidateId, { status: "validated", dossierId: dossier.id }).catch(() => {});
}
