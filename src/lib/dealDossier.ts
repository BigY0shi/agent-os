// Building the dossier: the "understand the listing" pass that runs before the
// "write the proposal" pass.
//
// The owner's diagnosis was right. Before this, the proposal route received the notes,
// the card Q&A, the brief and the full listing simultaneously and had to reconcile all
// of it while also producing copy, on every regeneration. This does the reconciling
// once and writes down a settled account: the client's explicit asks, how we answer
// each, the phrase we must open with, and the honest gaps.
//
// The extracted asks are the real prize. Once the questions are a list rather than
// prose buried at the bottom of a 12,000-character posting, "did the draft answer
// them?" becomes something that can be checked (see likelyMissedAsks).
import { run } from "@/lib/runner";
import { claudeModel } from "@/lib/claudeModel";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { readSettings } from "@/lib/settings";
import { withSkills } from "@/lib/platformSkills";
import { LEADS_DIR, type Deal } from "@/lib/upworkDesk";
import { listingText, dossierInputHash, type Dossier, type DossierAsk } from "@/lib/dealDeskControl";

/** Gear-configurable, like the screen model; blank uses the configured Claude model. */
export function dossierModel(): string {
  const m = readSettings().deals?.dossierModel;
  return typeof m === "string" && m.trim() ? m.trim() : claudeModel();
}

/** The inputs a dossier is built from, in the shape the hash expects. */
export function dossierInputs(deal: Deal) {
  return {
    description: deal.description ?? "",
    notes: deal.notes ?? "",
    answers: (deal.answers ?? []).filter((a) => a && a.q && a.a).map((a) => ({ q: a.q, a: a.a })),
    summary: deal.summary ?? "",
    why: deal.why ?? "",
    approach: deal.approach ?? "",
    crashCourse: deal.crashCourse ?? "",
  };
}

export function dossierPrompt(deal: Deal): string {
  const inputs = dossierInputs(deal);
  const qa = inputs.answers.map((a) => `Q: ${a.q}\nA: ${a.a}`).join("\n\n");
  const brief = [
    inputs.summary ? `What they want: ${inputs.summary}` : "",
    inputs.why ? `Our angle: ${inputs.why}` : "",
    inputs.approach ? `Delivery approach:\n${inputs.approach}` : "",
    inputs.crashCourse ? `Stack notes and gotchas: ${inputs.crashCourse}` : "",
  ].filter(Boolean).join("\n");

  return (
    "You are preparing the ground for an Upwork proposal from a RevOps / automation " +
    "consultant (Launchworks Dynamics). You are NOT writing the proposal. You are " +
    "producing the account the writer will work from.\n\n" +
    "Return ONLY minified JSON, no prose and no code fences, with EXACTLY these keys:\n" +
    '{"asks":[{"ask":"...","answer":"..."}],"openWith":null,"position":"...","gaps":["..."]}\n\n' +
    "asks     - EVERY explicit question or application instruction the listing gives. " +
    "Quote the client's own wording where you can. Look hard at the END of the listing: " +
    "sections like \"To Apply\", \"How to Apply\" and \"When applying\" are where these live. " +
    "If the listing genuinely asks for nothing, return an empty array rather than " +
    "inventing plausible questions.\n" +
    "asks[].answer - how we answer that ask, drawn ONLY from the material below. Use null " +
    "when nothing on hand answers it. A null is useful; a guess is not.\n" +
    "openWith - the exact word or phrase the listing demands the application start with, " +
    "or null if it demands none. Do not invent one.\n" +
    "position - 2-3 sentences: our angle on this listing, reconciling the operator's notes " +
    "and answers with the brief. Where they conflict, the operator wins.\n" +
    "gaps     - what the client asked for that the material does not answer, so the " +
    "operator can fill it in. Empty array if there are none.\n\n" +
    "Never invent a credential, a client name, a metric, a rate or an availability. An " +
    "honest gap is worth more than a plausible fabrication.\n\n" +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} ${deal.experienceLevel ?? ""}\n` +
    `Full description, read all of it:\n${listingText(inputs.description)}\n\n` +
    (inputs.notes ? `THE OPERATOR'S NOTES (ground truth):\n${inputs.notes}\n\n` : "") +
    (qa ? `THE Q&A HELD ON THIS CARD (ground truth, outranks the brief):\n${qa}\n\n` : "") +
    (brief ? `OUR ANALYST'S BRIEF:\n${brief}\n` : "")
  );
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Parse a dossier response. Returns null unless the shape is usable, because a
 * half-parsed dossier would silently narrow what the proposal writer is told the
 * client asked for - worse than having no dossier at all.
 */
export function parseDossier(out: string): Omit<Dossier, "at" | "inputHash" | "model"> | null {
  const text = String(out || "").trim();
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]); } catch { return null; }

  if (!Array.isArray(parsed.asks)) return null;
  const asks: DossierAsk[] = [];
  for (const raw of parsed.asks) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const ask = str(r.ask);
    if (!ask) continue;
    const answer = str(r.answer);
    asks.push({ ask, answer: answer || null });
  }

  const position = str(parsed.position);
  // An empty asks list is legitimate (plenty of listings ask for nothing), but a
  // response with neither asks nor a position did not understand the listing.
  if (!asks.length && !position) return null;

  const openWith = str(parsed.openWith) || null;
  const gaps = Array.isArray(parsed.gaps)
    ? parsed.gaps.map((g) => str(g)).filter(Boolean)
    : [];

  return { asks, openWith, position, gaps };
}

/** Returns null on any failure; the caller persists nothing and the card stays without one. */
export async function generateDossier(deal: Deal, signal?: AbortSignal): Promise<Dossier | null> {
  const model = dossierModel();
  const r = await run(
    "claude",
    ["-p", "--model", model, "--output-format", "text", ...claudeBuilderArgs()],
    { timeoutMs: 180_000, input: withSkills(dossierPrompt(deal), "deals"), cwd: LEADS_DIR, signal },
  );
  if (!r.ok) return null;
  const parsed = parseDossier(r.stdout || "");
  if (!parsed) return null;
  return {
    ...parsed,
    at: Date.now(),
    model,
    inputHash: dossierInputHash(dossierInputs(deal)),
  };
}

/** The dossier rendered for the proposal prompt. */
export function dossierBlock(d: Dossier): string {
  const asks = d.asks.length
    ? d.asks.map((a, i) => `${i + 1}. THEY ASK: ${a.ask}\n   WE ANSWER: ${a.answer ?? "(nothing on hand answers this - do not invent one)"}`).join("\n")
    : "(the listing asks for nothing specific)";
  return [
    d.openWith ? `THE PROPOSAL MUST OPEN WITH THIS EXACT PHRASE: ${d.openWith}` : "",
    `OUR POSITION: ${d.position}`,
    "",
    "EVERY ASK IN THIS LISTING, AND OUR ANSWER. The draft must address all of them:",
    asks,
    d.gaps.length ? `\nUNANSWERED BY OUR MATERIAL - say something honest or ask, never invent:\n${d.gaps.map((g) => `- ${g}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}
