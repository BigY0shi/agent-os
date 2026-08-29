// SPEC-F K2.1 — GET the subscription directory / POST "subscribe with alias".
//
// POST creates a REAL addy.io alias first and only then persists the row: a
// subscription whose alias silently failed to create would be a newsletter
// signed up to an address that does not exist. A non-2xx from addy is LOUD
// (§5: 502 { error: "addy.io: …" }); an unconfigured key is a 412 naming the
// config PATH — never the value (the value is not obtainable in this process).
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { AddyError, aliasDescription, createAlias } from "@/lib/v2/newsletter/addy";
import { addyConfigured, addyDomain, configPath, gmailConfigured } from "@/lib/v2/newsletter/config";
import { createSubscription, latestEmailAt, listSubscriptions } from "@/lib/v2/newsletter/store";
import { isCadence } from "@/lib/v2/newsletter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/newsletter/subscriptions
 * → { subscriptions, addyConfigured, gmailConfigured, addyDomain, configPath, lastEmailAt }
 *
 * `lastEmailAt` is ADDITIVE to §5: the §6 manager table shows a "last-seen
 * email" column derived from newsletter_emails, and the contract had nothing to
 * render it from. One MAX() per subscription, never an N+1 of detail fetches.
 * A subscription with no mail yet is `null` — the table prints "—", never a
 * fabricated date.
 */
export async function GET() {
  ensureV2();
  try {
    const subscriptions = listSubscriptions();
    const lastEmailAt: Record<string, string | null> = {};
    for (const s of subscriptions) lastEmailAt[s.id] = latestEmailAt(s.id);
    return NextResponse.json(
      {
        subscriptions,
        lastEmailAt,
        addyConfigured: addyConfigured(),
        gmailConfigured: gmailConfigured(),
        addyDomain: addyDomain(),
        // Safe to render: the PATH is a hint, the key is not readable here.
        configPath: configPath(),
      },
      noStore,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

interface CreateBody {
  name?: unknown;
  topic?: unknown;
  signupUrl?: unknown;
  cadence?: unknown;
}

/** POST /api/newsletter/subscriptions — creates the addy alias, then the row. */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as CreateBody | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400, ...noStore });
  }
  const topic = typeof body?.topic === "string" && body.topic.trim() ? body.topic.trim() : null;
  const signupUrl =
    typeof body?.signupUrl === "string" && body.signupUrl.trim() ? body.signupUrl.trim() : null;
  if (signupUrl && !/^https?:\/\//i.test(signupUrl)) {
    return NextResponse.json({ error: "signupUrl must be http(s)" }, { status: 400, ...noStore });
  }
  const cadence = isCadence(body?.cadence) ? body.cadence : "unknown";

  try {
    const domain = addyDomain();
    const alias = await createAlias({
      description: aliasDescription(name),
      ...(domain ? { domain } : {}),
    });
    const subscription = createSubscription({
      name,
      topic,
      signupUrl,
      cadence,
      aliasId: alias.id,
      aliasEmail: alias.email,
    });
    return NextResponse.json({ subscription }, noStore);
  } catch (err) {
    if (err instanceof AddyError) {
      // 412 = "you have not configured addy" (the message names the path);
      // anything else from addy is an upstream failure → 502, verbatim (§5).
      const status = err.status === 412 ? 412 : 502;
      return NextResponse.json({ error: err.message }, { status, ...noStore });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
