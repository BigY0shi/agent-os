export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { appendAuditLog } from '@/lib/audit';

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const agent_id = searchParams.get('agent_id');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

    let sql = 'SELECT * FROM agent_runs WHERE 1=1';
    const params = [];
    if (agent_id) {
      sql += ' AND agent_id = ?';
      params.push(Number(agent_id));
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    return NextResponse.json(db.prepare(sql).all(...params) || []);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'agent-runtime');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const body = await request.json();
    const agentId = Number(body.agent_id);
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    }

    const status = body.status || 'queued';
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
    }

    const db = await getDb();
    const now = new Date().toISOString();
    const result = db.prepare(
      `INSERT INTO agent_runs (agent_id, runtime_type, status, input_json, output_json, error, duration_ms, cost_usd, started_at, finished_at, triggered_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agentId,
      body.runtime_type || null,
      status,
      body.input ? JSON.stringify(body.input) : body.input_json || null,
      body.output ? JSON.stringify(body.output) : body.output_json || null,
      body.error || null,
      body.duration_ms != null ? Number(body.duration_ms) : null,
      body.cost_usd != null ? Number(body.cost_usd) : null,
      body.started_at || (status !== 'queued' ? now : null),
      body.finished_at || (status === 'succeeded' || status === 'failed' ? now : null),
      body.triggered_by || gate.ctx.actor,
      now
    );

    const id = result.lastInsertRowid;
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'agent_run.create',
      resource_type: 'agent_run',
      resource_id: id,
      meta: { agent_id: agentId, status },
    });

    if (body.cost_usd != null && Number(body.cost_usd) > 0) {
      db.prepare(
        'INSERT INTO cost_entries (agent_id, amount, category, description, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(agentId, Number(body.cost_usd), body.cost_category || 'inference', body.cost_description || 'Agent run', now);
    }

    return NextResponse.json(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
