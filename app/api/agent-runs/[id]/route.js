export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { appendAuditLog } from '@/lib/audit';

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

export async function PATCH(request, { params }) {
  const gate = authorizeWrite(request, 'agent-runtime');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const db = await getDb();
    const id = Number(params.id);
    const existing = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await request.json();
    const status = body.status ?? existing.status;
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE agent_runs SET status = ?, output_json = COALESCE(?, output_json), error = COALESCE(?, error),
       duration_ms = COALESCE(?, duration_ms), cost_usd = COALESCE(?, cost_usd),
       finished_at = COALESCE(?, finished_at) WHERE id = ?`
    ).run(
      status,
      body.output ? JSON.stringify(body.output) : body.output_json ?? null,
      body.error ?? null,
      body.duration_ms != null ? Number(body.duration_ms) : null,
      body.cost_usd != null ? Number(body.cost_usd) : null,
      (status === 'succeeded' || status === 'failed') ? now : null,
      id
    );

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'agent_run.update',
      resource_type: 'agent_run',
      resource_id: id,
      meta: { status },
    });

    if (body.cost_usd != null && Number(body.cost_usd) > 0) {
      db.prepare(
        'INSERT INTO cost_entries (agent_id, amount, category, description, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(existing.agent_id, Number(body.cost_usd), 'inference', `Run #${id}`, now);
    }

    return NextResponse.json(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
