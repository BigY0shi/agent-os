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
    return NextResponse.json(status, noStore);
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
    const result = await syncOnce("manual");
    return NextResponse.json(result, noStore);
  } catch (err) {
    // Configuration failures are LOUD and NAMED (SPEC-F §4 error split): the UI
    // must say what to connect, never show a quiet zero-fetch.
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof NewsletterConfigError ? 412 : 500;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
