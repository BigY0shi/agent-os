import {
  getActiveRuleTexts as memoryGetActiveRuleTexts,
  listRules,
  createRule,
  updateRule,
  getRule,
} from "../memory/rules";
import type { IntegrationRuleRow } from "./types";

/**
 * SPEC-D G2.7 — integration user rules. Per CONVENTIONS §1.7 the rows live in
 * SPEC-A's `ingestion_rules` table with `source = <integration account id>`
 * (SPEC-D §2's own ingestion_rules DDL is void); this module is the
 * account-scoped view over it plus the deterministic pre-filter half of
 * decision 7 ("rules enforced twice").
 *
 * NOTHING_TO_REMEMBER convention (consumed by Memory V2's normalize prompt —
 * SPEC-A A2.8 already injects getActiveRuleTexts(source) into
 * <ingestion_rules>): the prompt instructs the model to apply these rules to
 * the incoming content and, if the content does NOT satisfy them, to respond
 * with the literal token NOTHING_TO_REMEMBER instead of a normalized episode —
 * the pipeline then drops the item. Rule TEXT should therefore be written as
 * imperative filters ("Only remember emails about invoices", "Ignore
 * newsletters"). The deterministic pre-filter below is the belt to that
 * LLM-braces (weak models fail silently on prompt-only enforcement).
 */

export interface PreFilter {
  include?: string[]; // regex sources; when present, at least ONE must match or the activity is rejected
  exclude?: string[]; // regex sources; any match rejects the activity
}

export interface ActivePreFilter {
  ruleId: string;
  ruleName: string | null;
  filter: PreFilter;
}

/**
 * The single cross-spec seam (CONVENTIONS §1.7): formatted active rule texts
 * for one integration account (global NULL-source rules included) — injected
 * into the Memory V2 normalize prompt. null when no rules apply.
 */
export function getActiveRuleTexts(accountId: string): string | null {
  return memoryGetActiveRuleTexts(accountId);
}

/** Rules owned by this account (source = accountId), for the §5.5 CRUD UI. */
export function listAccountRules(accountId: string): IntegrationRuleRow[] {
  return listRules({ source: accountId })
    .filter((r) => r.source === accountId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      text: r.text,
      preFilter: parsePreFilter(r.preFilterJson),
      isActive: r.isActive,
      createdAt: r.createdAt,
    }));
}

export function createAccountRule(
  accountId: string,
  input: { name?: string; text: string; preFilter?: PreFilter; isActive?: boolean },
): IntegrationRuleRow {
  const rule = createRule({
    text: input.text,
    name: input.name ?? null,
    source: accountId,
    preFilterJson: input.preFilter ? JSON.stringify(input.preFilter) : null,
    isActive: input.isActive,
  });
  return listAccountRules(accountId).find((r) => r.id === rule.id)!;
}

export function updateAccountRule(
  accountId: string,
  id: string,
  patch: { name?: string; text?: string; preFilter?: PreFilter | null; isActive?: boolean },
): IntegrationRuleRow {
  const existing = getRule(id);
  if (!existing || existing.source !== accountId) {
    throw new Error(`rule ${id} not found on this account`);
  }
  updateRule(id, {
    name: patch.name,
    text: patch.text,
    preFilterJson:
      patch.preFilter === undefined
        ? undefined
        : patch.preFilter === null
          ? null
          : JSON.stringify(patch.preFilter),
    isActive: patch.isActive,
  });
  return listAccountRules(accountId).find((r) => r.id === id)!;
}

/** Rules are never deleted (house rule) — DELETE deactivates. */
export function deactivateAccountRule(accountId: string, id: string): void {
  const existing = getRule(id);
  if (!existing || existing.source !== accountId) {
    throw new Error(`rule ${id} not found on this account`);
  }
  updateRule(id, { isActive: false });
}

// ─── Deterministic pre-filter (decision 7, applied at activity creation) ─────

/** Active pre-filters for an account: its own rules + global NULL-source rules. */
export function getActivePreFilters(accountId: string): ActivePreFilter[] {
  return listRules({ source: accountId, activeOnly: true })
    .filter((r) => r.preFilterJson)
    .map((r) => ({
      ruleId: r.id,
      ruleName: r.name,
      filter: parsePreFilter(r.preFilterJson) ?? {},
    }))
    .filter((f) => (f.filter.include?.length ?? 0) + (f.filter.exclude?.length ?? 0) > 0);
}

/**
 * Apply pre-filters to activity text. Rejection reasons name the rule +
 * pattern so the Activity tab can explain WHY (SPEC-D §6.1). Semantics per
 * rule: any `exclude` match rejects; a non-empty `include` list with zero
 * matches rejects. Invalid regexes are skipped with a loud warn (a typo in a
 * rule must not silently reject everything).
 */
export function applyPreFilters(
  text: string,
  filters: ActivePreFilter[],
): { rejected: boolean; reason?: string } {
  for (const { ruleId, ruleName, filter } of filters) {
    const label = ruleName || ruleId;
    for (const pattern of filter.exclude ?? []) {
      const re = compile(pattern, label);
      if (re?.test(text)) {
        return { rejected: true, reason: `rule '${label}' exclude /${pattern}/ matched` };
      }
    }
    const includes = (filter.include ?? []).filter((p) => compile(p, label));
    if (includes.length > 0 && !includes.some((p) => compile(p, label)!.test(text))) {
      return { rejected: true, reason: `rule '${label}' include patterns did not match` };
    }
  }
  return { rejected: false };
}

function parsePreFilter(json: string | null): PreFilter | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as PreFilter;
    return {
      ...(Array.isArray(parsed.include) ? { include: parsed.include.map(String) } : {}),
      ...(Array.isArray(parsed.exclude) ? { exclude: parsed.exclude.map(String) } : {}),
    };
  } catch {
    return null;
  }
}

function compile(pattern: string, ruleLabel: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch (err) {
    console.warn(`[integrations/rules] rule '${ruleLabel}' has an invalid regex /${pattern}/:`, err);
    return null;
  }
}
