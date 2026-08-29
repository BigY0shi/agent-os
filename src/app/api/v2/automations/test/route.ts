import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  AutomationError,
  evalConditions,
  getRule,
  validateRuleInput,
} from "@/lib/v2/automations/engine";
import type { AutomationAction } from "@/lib/v2/automations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * SPEC-D §5.7 — POST /api/v2/automations/test { ruleId | rule, samplePayload }
 * → dry-run: { matched, conditions, wouldRun } WITHOUT executing any action
 * (the builder's "Test with sample payload" panel). Accepts an inline `rule`
 * so unsaved builder state can be tested; the destructive-confirm save gate is
 * skipped here because nothing executes.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });

  let rule: {
    triggerSlug: string;
    triggerEvent: string;
    conditions: ReturnType<typeof validateRuleInput>["conditions"];
    actions: AutomationAction[];
  };
  try {
    if (typeof body.ruleId === "string" && body.ruleId) {
      const stored = getRule(body.ruleId);
      if (!stored) return NextResponse.json({ error: "rule not found" }, { status: 404, ...noStore });
      rule = stored;
    } else if (body.rule && typeof body.rule === "object") {
      const validated = validateRuleInput(body.rule as Record<string, unknown>, {
        skipDestructiveGate: true, // dry-run never executes
      });
      rule = {
        triggerSlug: validated.triggerSlug ?? "system",
        triggerEvent: validated.triggerEvent,
        conditions: validated.conditions ?? [],
        actions: validated.actions,
      };
    } else {
      return NextResponse.json({ error: "provide 'ruleId' or an inline 'rule'" }, { status: 400, ...noStore });
    }
  } catch (err) {
    if (err instanceof AutomationError) {
      return NextResponse.json({ error: err.message }, { status: err.status, ...noStore });
    }
    throw err;
  }

  const samplePayload =
    body.samplePayload && typeof body.samplePayload === "object" && !Array.isArray(body.samplePayload)
      ? (body.samplePayload as Record<string, unknown>)
      : {};
  // Same context shape the engine builds for a live activity fire.
  const ctx: Record<string, unknown> = {
    event: rule.triggerEvent,
    text: typeof samplePayload.text === "string" ? samplePayload.text : "",
    payload: samplePayload,
    account: { slug: rule.triggerSlug },
  };

  const { pass, results } = evalConditions(rule.conditions ?? [], ctx);
  return NextResponse.json(
    {
      matched: pass,
      conditions: results,
      wouldRun: pass
        ? rule.actions.map((a) => ({
            kind: a.kind,
            ...(a.kind === "run_tool" ? { tool: a.tool, accountId: a.accountId } : {}),
          }))
        : [],
    },
    noStore,
  );
}
