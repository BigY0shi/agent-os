// SPEC-F K3.1 — POST runs one incremental sync now; GET reports sync status.
import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { addyConfigured, gmailConfigured } from "@/lib/v2/newsletter/config";
import {
  STATE_LAST_RUN,
  STATE_LAST_SYNC,
  getState,
  getStateJson,
} from "@/lib/v2/newsletter/store";
import { NewsletterConfigError, isSyncRunning, syncOnce } from "@/lib/v2/newsletter/sync";
import { syncAgentMail } from "@/lib/v2/newsletter/agentmailSync";
import { agentmailConfigured, agentmailInbox } from "@/lib/v2/agentmail/config";
import type { SyncRunResult, SyncStatus } from "@/lib/v2/newsletter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/newsletter/sync → { lastSyncTime, lastRun, running, … } */
export async function GET() {
  ensureV2();
  try {
    const status: SyncStatus = {
      lastSyncTime: getState(STATE_LAST_SYNC),
      lastRun: getStateJson<SyncRunResult>(STATE_LAST_RUN),
      running: isSyncRunning(),
      gmailConfigured: gmailConfigured(),
      addyConfigured: addyConfigured(),
    };
    // The second transport (migration 063). Reported separately so the UI can
    // say WHICH path is live rather than a single opaque "configured".
    const extra = {
      agentmailConfigured: agentmailConfigured(),
      agentmailInbox: agentmailConfigured() ? agentmailInbox() : null,
    };
    return NextResponse.json({ ...status, ...extra }, noStore);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, ...noStore },
    );
  }
}

/** POST /api/newsletter/sync → runs one incremental sync. */
export async function POST() {
  ensureV2();
  try {
    // Gmail is the primary transport. When it is not connected, fall back to
    // the AgentMail inbox rather than 412-ing — the module's job is to collect
    // newsletters, and one working path is enough to do it. When NEITHER is
    // configured the original loud config error still surfaces.
    if (!gmailConfigured() && agentmailConfigured()) {
      const am = await syncAgentMail();
      return NextResponse.json({ ...am, transport: "agentmail" }, noStore);
    }
    const result = await syncOnce("manual");
    return NextResponse.json({ ...result, transport: "gmail" }, noStore);
  } catch (err) {
    // Configuration failures are LOUD and NAMED (SPEC-F §4 error split): the UI
    // must say what to connect, never show a quiet zero-fetch.
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof NewsletterConfigError ? 412 : 500;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
