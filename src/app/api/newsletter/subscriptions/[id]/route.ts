// SPEC-F K2.1 — PATCH one subscription / DELETE → paused + alias deactivated.
//
// Pausing a subscription also turns its addy alias OFF, which is the whole
// point: the alias is the thing that keeps mail arriving. If addy refuses, the
// row is NOT flipped and the error is loud — a "paused" subscription whose
// alias is still live would keep filling the inbox silently.
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { AddyError, setAliasActive } from "@/lib/v2/newsletter/addy";
import { getSubscription, patchSubscription } from "@/lib/v2/newsletter/store";
import {
  isCadence,
  isSubscriptionStatus,
  type Cadence,
  type SubscriptionStatus,
} from "@/lib/v2/newsletter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };
/** store.shortId() ids: 12 lowercase alnum. Anything else never reaches a query. */
const ID_RE = /^[a-z0-9]{4,32}$/;

type Ctx = { params: Promise<{ id: string }> };

function addyStatus(err: AddyError): number {
  return err.status === 412 ? 412 : 502;
}

/**
 * Sync the addy alias to a target status. 'active' → alias on, 'paused'/'dead'
 * → alias off. No alias id (a row created before addy was configured) is a
 * no-op, not a failure.
 */
async function syncAlias(aliasId: string | null, status: SubscriptionStatus): Promise<void> {
  if (!aliasId) return;
  await setAliasActive(aliasId, status === "active");
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "bad subscription id" }, { status: 400, ...noStore });
  }
  const existing = getSubscription(id);
  if (!existing) {
    return NextResponse.json({ error: "subscription not found" }, { status: 404, ...noStore });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    topic?: unknown;
    cadence?: unknown;
    status?: unknown;
    signupUrl?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "a JSON body is required" }, { status: 400, ...noStore });
  }

  const patch: {
    name?: string;
    topic?: string | null;
    cadence?: Cadence;
    status?: SubscriptionStatus;
    signupUrl?: string | null;
  } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400, ...noStore });
    }
    patch.name = body.name.trim();
  }
  if (body.topic !== undefined) {
    if (body.topic !== null && typeof body.topic !== "string") {
      return NextResponse.json({ error: "topic must be a string or null" }, { status: 400, ...noStore });
    }
    patch.topic = typeof body.topic === "string" && body.topic.trim() ? body.topic.trim() : null;
  }
  if (body.signupUrl !== undefined) {
    if (body.signupUrl !== null && typeof body.signupUrl !== "string") {
      return NextResponse.json({ error: "signupUrl must be a string or null" }, { status: 400, ...noStore });
    }
    const url = typeof body.signupUrl === "string" ? body.signupUrl.trim() : "";
    if (url && !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "signupUrl must be http(s)" }, { status: 400, ...noStore });
    }
    patch.signupUrl = url || null;
  }
  if (body.cadence !== undefined) {
    if (!isCadence(body.cadence)) {
      return NextResponse.json(
        { error: "cadence must be daily, weekly, monthly or unknown" },
        { status: 400, ...noStore },
      );
    }
    patch.cadence = body.cadence;
  }
  if (body.status !== undefined) {
    if (!isSubscriptionStatus(body.status)) {
      return NextResponse.json(
        { error: "status must be active, paused or dead" },
        { status: 400, ...noStore },
      );
    }
    patch.status = body.status;
  }

  // The alias toggle runs BEFORE the row flips: if addy refuses, the stored
  // status keeps telling the truth about what is actually receiving mail.
  if (patch.status && patch.status !== existing.status) {
    try {
      await syncAlias(existing.aliasId, patch.status);
    } catch (err) {
      if (err instanceof AddyError) {
        return NextResponse.json(
          { error: `alias not toggled, status unchanged — ${err.message}` },
          { status: addyStatus(err), ...noStore },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `alias not toggled, status unchanged — ${message}` },
        { status: 502, ...noStore },
      );
    }
  }

  const subscription = patchSubscription(id, patch);
  return NextResponse.json({ subscription }, noStore);
}

/**
 * DELETE /api/newsletter/subscriptions/:id → paused + alias off (SPEC-F §3).
 * Nothing is destroyed: the row keeps its history, exactly like an exile.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "bad subscription id" }, { status: 400, ...noStore });
  }
  const existing = getSubscription(id);
  if (!existing) {
    return NextResponse.json({ error: "subscription not found" }, { status: 404, ...noStore });
  }
  try {
    await syncAlias(existing.aliasId, "paused");
  } catch (err) {
    if (err instanceof AddyError) {
      return NextResponse.json(
        { error: `alias not deactivated, subscription unchanged — ${err.message}` },
        { status: addyStatus(err), ...noStore },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `alias not deactivated, subscription unchanged — ${message}` },
      { status: 502, ...noStore },
    );
  }
  const subscription = patchSubscription(id, { status: "paused" });
  return NextResponse.json({ ok: true, subscription }, noStore);
}
