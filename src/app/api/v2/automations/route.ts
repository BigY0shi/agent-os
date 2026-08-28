import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  AutomationError,
  createRule,
  deactivateRule,
  getRule,
  listRules,
  listTriggerOptions,
  updateRule,
  validateRuleInput,
} from "@/lib/v2/automations/engine";
import { ACTION_KINDS, CONDITION_OPS } from "@/lib/v2/automations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errorResponse(err: unknown) {
  if (err instanceof AutomationError) {
    return NextResponse.json({ error: err.message }, { status: err.status, ...noStore });
  }
  throw err;
}

/**
 * SPEC-D §5.7 — GET → { rules, available: { triggers, actionKinds, conditionOps } }.
 * Builder metadata rides along: known trigger events come from
 * listConnectors().spec.triggers + the system events; custom event strings are
 * allowed (the trigger field IS the event type).
 */
export async function GET() {
  ensureV2();
  return NextResponse.json(
    {
      rules: listRules(),
      available: {
        triggers: listTriggerOptions(),
        actionKinds: ACTION_KINDS,
        conditionOps: CONDITION_OPS,
      },
    },
    noStore,
  );
}

/** POST (create) — whitelist-validated; run_tool on a destructive tool without
 *  confirmDestructive → 422 (G5.4 save gate). */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  try {
    const input = validateRuleInput(body);
    const rule = createRule(input);
    return NextResponse.json({ rule }, { status: 201, ...noStore });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH { id, ...partial } — a partial carrying conditions/actions revalidates them. */
export async function PATCH(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "body must carry the rule 'id'" }, { status: 400, ...noStore });
  }
  const current = getRule(body.id);
  if (!current) return NextResponse.json({ error: "rule not found" }, { status: 404, ...noStore });
  try {
    // Validate the MERGED rule so a partial can never sneak past the whitelists
    // (e.g. adding an unconfirmed destructive run_tool via PATCH).
    const merged = validateRuleInput({
      name: body.name ?? current.name,
      triggerSlug: body.triggerSlug ?? current.triggerSlug,
      triggerEvent: body.triggerEvent ?? current.triggerEvent,
      conditions: body.conditions ?? current.conditions,
      actions: body.actions ?? current.actions,
      isActive: typeof body.isActive === "boolean" ? body.isActive : current.isActive,
    });
    const rule = updateRule(body.id, merged);
    return NextResponse.json({ rule }, noStore);
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE { id } → deactivate (rows retained — house rule). */
export async function DELETE(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "body must carry the rule 'id'" }, { status: 400, ...noStore });
  }
  try {
    if (!getRule(body.id)) return NextResponse.json({ error: "rule not found" }, { status: 404, ...noStore });
    const rule = deactivateRule(body.id);
    return NextResponse.json({ ok: true, rule }, noStore);
  } catch (err) {
    return errorResponse(err);
  }
}
