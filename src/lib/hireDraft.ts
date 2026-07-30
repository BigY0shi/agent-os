// Hire Engine — Gmail DRAFT creation. The last link in the money loop: an
// approved, enriched, pitched lead becomes a draft in the operator's Gmail,
// reviewed and sent BY THE OPERATOR. Nothing here ever sends.
//
// Mechanism: the legacy python gmail_cli.py path doesn't exist on this box; the
// working Gmail channel is the Gmail MCP available to headless `claude -p`
// (verified connected in headless runs 2026-07-28). One claude session drafts a
// whole batch — MCP init is the expensive part, so per-lead calls would pay it
// N times. The body is passed under a strict verbatim protocol because a model
// WILL otherwise "improve" outreach copy.

import { run } from "./runner";
import { claudeBuilderArgs } from "./agentPowers";
import { LEADS_DIR } from "./hireDesk";
import { readSettings } from "./settings";

// Sonnet-tier default — verified to resolve on the CLI 2026-07-28. Tool use needs
// more competence than haiku; opus would be wasted on a clerical task. User-tunable
// from the Hire Engine gear (settings.hire.draftModel), read at call time.
function draftModel(): string {
  return (readSettings().hire.draftModel || "").trim() || "claude-sonnet-5";
}

export interface DraftItem {
  /** Caller's reference (lead id) — echoed back in the result protocol. */
  ref: string;
  to: string;
  subject: string;
  body: string;
}

export interface DraftResult { ref: string; ok: boolean; detail: string }

/**
 * Create Gmail DRAFTS for up to ~10 items in one claude session.
 * Returns one result per item; items the model never reported come back failed
 * (never silently dropped).
 */
export async function createGmailDrafts(items: DraftItem[]): Promise<DraftResult[]> {
  if (!items.length) return [];

  const blocks = items.map((it) => (
    `### ITEM ${it.ref}\n` +
    `TO: ${it.to}\n` +
    `SUBJECT: ${it.subject}\n` +
    `BODY-START\n${it.body.trim()}\nBODY-END`
  )).join("\n\n");

  const prompt =
    "You have Gmail tools available (MCP). For EACH item below, create a Gmail DRAFT — " +
    "NEVER send, never schedule, drafts only. Use the recipient, subject, and body EXACTLY as given: " +
    "the body between BODY-START and BODY-END must be used verbatim — no edits, no additions, no signature, " +
    "no formatting changes. These are pre-approved outreach texts; altering them is a failure.\n\n" +
    "If no Gmail draft tool is available, do not improvise with other tools — report failure.\n\n" +
    blocks +
    "\n\nWhen done, reply with ONLY one line per item, nothing else:\n" +
    "OK <ref>   — draft created\n" +
    "FAIL <ref>: <short reason>   — could not create\n";

  const r = await run(
    "claude",
    ["-p", "--model", draftModel(), "--output-format", "text", ...claudeBuilderArgs()],
    { timeoutMs: 420_000, input: prompt, cwd: LEADS_DIR },
  );

  const out = (r.stdout || "").trim();
  const results: DraftResult[] = [];
  const seen = new Set<string>();

  for (const line of out.split(/\r?\n/)) {
    const ok = line.match(/^OK\s+(\S+)/i);
    const fail = line.match(/^FAIL\s+(\S+):?\s*(.*)$/i);
    if (ok && items.some((it) => it.ref === ok[1])) {
      results.push({ ref: ok[1], ok: true, detail: "draft created" });
      seen.add(ok[1]);
    } else if (fail && items.some((it) => it.ref === fail[1])) {
      results.push({ ref: fail[1], ok: false, detail: (fail[2] || "failed").slice(0, 200) });
      seen.add(fail[1]);
    }
  }

  // Anything unreported is a failure — a draft we can't confirm doesn't count.
  for (const it of items) {
    if (!seen.has(it.ref)) {
      results.push({
        ref: it.ref, ok: false,
        detail: r.ok ? `no confirmation from the drafting run: ${out.slice(-160)}` : (r.stderr || "claude run failed").slice(-200),
      });
    }
  }
  return results;
}

/** Default subject — deliberately plain; the operator edits in Gmail if needed. */
export function defaultSubject(title: string): string {
  return `re: the ${title.slice(0, 80)} hire`;
}
