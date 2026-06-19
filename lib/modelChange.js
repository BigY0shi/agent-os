import { appendAuditLog } from '@/lib/audit';

/** @param {unknown} details */
export function parseDecisionDetails(details) {
  if (!details) return {};
  if (typeof details === 'object') return details;
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
}

/**
 * Apply approved model_change decision to agents table.
 */
export function applyModelChangeApproval(db, decision, actor) {
  const d = parseDecisionDetails(decision.details);
  const agentId = d.agent_id ?? decision.agent_id;
  if (!agentId) {
    return { ok: false, error: 'agent_id required in decision details' };
  }

  const toModel = d.to_model;
  if (!toModel) {
    return { ok: false, error: 'to_model required in decision details' };
  }

  let providerId = d.to_provider_id ?? null;
  if (!providerId && d.to_provider) {
    const row = db.prepare('SELECT id FROM model_providers WHERE slug = ?').get(d.to_provider);
    providerId = row?.id ?? null;
  }

  db.prepare('UPDATE agents SET model_provider_id = ?, model_id = ? WHERE id = ?').run(
    providerId,
    toModel,
    Number(agentId)
  );

  appendAuditLog(db, {
    actor,
    action: 'model.change',
    resource_type: 'agent',
    resource_id: agentId,
    meta: {
      from_model: d.from_model,
      to_model: toModel,
      to_provider: d.to_provider,
      to_provider_id: providerId,
      decision_id: decision.id,
    },
  });

  return { ok: true, agent_id: agentId };
}
