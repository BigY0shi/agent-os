import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  IntegrationError,
  getAccount,
  patchAccountSettings,
  setAccountActive,
  setAccountDisplayName,
  toAccountSummary,
} from "@/lib/v2/integrations/store";
import {
  ensureAccountSyncJob,
  removeAccountSyncJob,
} from "@/lib/v2/integrations/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

function errResponse(err: unknown) {
  const status = err instanceof IntegrationError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/** GET → { account: AccountSummary } (no secrets, ever). */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const account = getAccount((await ctx.params).id);
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404, ...noStore });
  return NextResponse.json({ account: toAccountSummary(account) }, noStore);
}

/**
 * PATCH { autoActivityRead?, triggersEnabled?, displayName?, isActive? }
 * (§5.3). Schedule job reconciled after every change.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  try {
    if (!getAccount(id)) {
      return NextResponse.json({ error: "account not found" }, { status: 404, ...noStore });
    }
    const settingsPatch: Record<string, unknown> = {};
    if ("autoActivityRead" in body) {
      if (typeof body.autoActivityRead !== "boolean") throw new IntegrationError("autoActivityRead must be a boolean");
      settingsPatch.autoActivityRead = body.autoActivityRead;
    }
    if ("triggersEnabled" in body) {
      if (typeof body.triggersEnabled !== "boolean") throw new IntegrationError("triggersEnabled must be a boolean");
      settingsPatch.triggersEnabled = body.triggersEnabled;
    }
    if (Object.keys(settingsPatch).length > 0) patchAccountSettings(id, settingsPatch);
    if ("displayName" in body) {
      if (typeof body.displayName !== "string") throw new IntegrationError("displayName must be a string");
      setAccountDisplayName(id, body.displayName);
    }
    if ("isActive" in body) {
      if (typeof body.isActive !== "boolean") throw new IntegrationError("isActive must be a boolean");
      setAccountActive(id, body.isActive);
    }
    const account = getAccount(id)!;
    ensureAccountSyncJob(account);
    return NextResponse.json({ account: toAccountSummary(account) }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}

/**
 * DELETE = deactivate (is_active=0, schedule unregistered). NEVER hard-deletes
 * — rows retained, exile-equivalent (§5.3).
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  try {
    const account = setAccountActive(id, false);
    removeAccountSyncJob(id);
    return NextResponse.json({ ok: true, account: toAccountSummary(account) }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}
