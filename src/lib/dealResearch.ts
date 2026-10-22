// The research pass behind "More info needed" (roadmap S4 e).
//
// Before this, the flag painted a yellow cone on the card and fired no task. Now
// it kicks off three steps as ONE module run and reports back on the card:
//
//   enrich     the gated Upwork visit (S4 d): proposals / payment verified /
//              hire rate. Skipped, in words, for a feed lead (no Upwork page)
//              or when no cookie is saved; a login wall flags the card and the
//              pass carries on, because the other two steps do not need Upwork.
//   brief      summary / why / approach / crash course (lib/dealBrief.ts).
//   questions  the open questions we would need answered before bidding, each
//              with the best answer the listing supports or an honest "unknown,
//              ask the client"; saved as Q&A entries on the card.
//
// Every model or browser call is a seam (opts) so the smoke runs the pass with
// fakes and no network. State goes to the card through setResearch() as the
// pass moves: running, then done / error / stopped with a note in words.
import { run } from "@/lib/runner";
import { claudeModel } from "@/lib/claudeModel";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { withSkills } from "@/lib/platformSkills";
import { generateBrief } from "@/lib/dealBrief";
import { runEnrichment, type EnrichOutcome } from "@/lib/dealEnrich";
import { recordDeskQA, dealSubject } from "@/lib/deskMemory";
import { LEADS_DIR, addAnswer, setBrief, setResearch, type Brief, type Deal } from "@/lib/upworkDesk";

export type ResearchStep = "enrich" | "brief" | "questions";
export const RESEARCH_STEPS: ResearchStep[] = ["enrich", "brief", "questions"];

export interface ResearchOutcome {
  steps: ResearchStep[];
  enrich: "done" | "skipped: feed lead" | "skipped: no cookie" | "login wall" | "captcha" | "failed" | "not requested";
  brief: "done" | "no usable brief" | "not requested";
  questions: number | "not requested" | "no usable answer";
  note: string;
}

export interface ResearchOpts {
  steps?: ResearchStep[];
  cookie?: string;
  signal?: AbortSignal;
  runId?: string;
  log?: (text: string) => void;
  progress?: (n: number, total: number) => void;
  /** Seams for the smoke. */
  enrichFn?: (deal: Deal, signal?: AbortSignal) => Promise<EnrichOutcome>;
  briefFn?: (deal: Deal, signal?: AbortSignal) => Promise<Brief | null>;
  askFn?: (prompt: string, signal?: AbortSignal) => Promise<string>;
}

export function questionsPrompt(deal: Deal): string {
  return (
    "You are the analyst for a RevOps / automation consultancy deciding whether to bid on the job lead below. " +
    "List the OPEN QUESTIONS we would need answered before bidding (3 to 5), and for each give the best answer the listing itself supports. " +
    "If the listing does not say, answer exactly \"Unknown - ask the client.\" Never invent facts about the client.\n" +
    'Return ONLY minified JSON, no prose, no code fences: [{"q":"...","a":"..."}]\n\n' +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""}\n` +
    `Tags: ${(deal.tags || []).join(", ")}\n` +
    (deal.summary ? `Our summary so far: ${deal.summary}\n` : "") +
    (deal.notes ? `Operator notes: ${deal.notes.slice(0, 800)}\n` : "") +
    `Description: ${(deal.description || "").slice(0, 4000)}`
  );
}

/** Parse the questions JSON; tolerant of fences and preamble, strict on shape. */
export function parseQuestions(text: string): { q: string; a: string }[] {
  const m = String(text ?? "").match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({ q: typeof x?.q === "string" ? x.q.trim() : "", a: typeof x?.a === "string" ? x.a.trim() : "" }))
      .filter((x) => x.q && x.a)
      .slice(0, 6);
  } catch { return []; }
}

async function askClaude(prompt: string, signal?: AbortSignal): Promise<string> {
  const r = await run("claude", ["-p", "--model", claudeModel(), "--output-format", "text", ...claudeBuilderArgs()], {
    timeoutMs: 180_000, input: withSkills(prompt, "deals"), cwd: LEADS_DIR, signal,
  });
  if (!r.ok || !r.stdout.trim()) throw new Error(r.stderr || "agent returned nothing");
  return r.stdout.trim();
}

function stoppedError(): Error {
  const e = new Error("research stopped");
  e.name = "AbortError";
  return e;
}

export async function runResearch(deal: Deal, opts: ResearchOpts = {}): Promise<ResearchOutcome> {
  const steps = (opts.steps?.length ? opts.steps : RESEARCH_STEPS).filter((s, i, a) => RESEARCH_STEPS.includes(s) && a.indexOf(s) === i);
  const out: ResearchOutcome = { steps, enrich: "not requested", brief: "not requested", questions: "not requested", note: "" };
  await setResearch(deal.id, { status: "running", runId: opts.runId, steps });
  const bail = () => { if (opts.signal?.aborted) throw stoppedError(); };
  let n = 0;
  const total = steps.length;
  try {
    if (steps.includes("enrich")) {
      if (deal.source) { out.enrich = "skipped: feed lead"; opts.log?.("enrich skipped: a feed lead has no Upwork page"); }
      else if (!opts.cookie) { out.enrich = "skipped: no cookie"; opts.log?.("enrich skipped: no Upwork cookie saved"); }
      else {
        opts.log?.("enrich: visiting the listing logged in");
        const e = await (opts.enrichFn ? opts.enrichFn(deal, opts.signal) : runEnrichment([{ id: deal.id, url: deal.url }], { cookie: opts.cookie, signal: opts.signal, log: opts.log }));
        out.enrich = e.stopped === "login" ? "login wall" : e.stopped === "captcha" ? "captcha" : e.enriched ? "done" : "failed";
        opts.log?.(`enrich: ${out.enrich}`);
      }
      opts.progress?.(++n, total);
      bail();
    }
    if (steps.includes("brief")) {
      opts.log?.("brief: asking for summary / why / approach / crash course");
      const b = await (opts.briefFn ? opts.briefFn(deal, opts.signal) : generateBrief(deal, opts.signal));
      bail();
      if (b) { await setBrief(deal.id, b); out.brief = "done"; } else out.brief = "no usable brief";
      opts.log?.(`brief: ${out.brief}`);
      opts.progress?.(++n, total);
    }
    if (steps.includes("questions")) {
      opts.log?.("questions: what we would need to know before bidding");
      const text = await (opts.askFn ? opts.askFn(questionsPrompt(deal), opts.signal) : askClaude(questionsPrompt(deal), opts.signal));
      bail();
      const qa = parseQuestions(text);
      for (const { q, a } of qa) {
        await addAnswer(deal.id, q, a);
        void recordDeskQA("deal-desk", dealSubject(deal), q, a);
      }
      out.questions = qa.length ? qa.length : "no usable answer";
      opts.log?.(`questions: ${qa.length} saved`);
      opts.progress?.(++n, total);
    }
    out.note = [
      steps.includes("enrich") ? `enrich ${out.enrich}` : null,
      steps.includes("brief") ? `brief ${out.brief}` : null,
      steps.includes("questions") ? (typeof out.questions === "number" ? `${out.questions} question${out.questions === 1 ? "" : "s"}` : `questions: ${out.questions}`) : null,
    ].filter(Boolean).join(" · ");
    await setResearch(deal.id, { status: "done", runId: opts.runId, steps, note: out.note });
    return out;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const stopped = err.name === "AbortError" || !!opts.signal?.aborted;
    await setResearch(deal.id, { status: stopped ? "stopped" : "error", runId: opts.runId, steps, note: stopped ? "stopped by owner" : err.message.slice(0, 300) });
    throw err;
  }
}
