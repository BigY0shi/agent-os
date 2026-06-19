export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { appendAuditLog } from '@/lib/audit';
import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const agent_id = searchParams.get('agent_id');
    let sql = 'SELECT * FROM runtime_instances WHERE 1=1';
    const params = [];
    if (agent_id) {
      sql += ' AND agent_id = ?';
      params.push(Number(agent_id));
    }
    sql += ' ORDER BY last_heartbeat_at DESC';
    const rows = db.prepare(sql).all(...params);
    return NextResponse.json(rows || []);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'agent-runtime');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const body = await request.json();
    const agentId = body.agent_id != null ? Number(body.agent_id) : null;
    const runtimeType = body.runtime_type || body.framework || 'unknown';
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    }

    const ep = getRuntimeEndpoints();
    const now = new Date().toISOString();
    const status = body.status || 'online';
    const db = await getDb();

    const existing = db
      .prepare('SELECT id FROM runtime_instances WHERE agent_id = ? AND runtime_type = ?')
      .get(agentId, runtimeType);

    const uiUrl = body.ui_url || (runtimeType.includes('hermes') ? ep.hermesUi : null);
    const gatewayUrl = body.gateway_url || (runtimeType.includes('hermes') ? ep.hermesGateway : null);

    if (existing) {
      db.prepare(
        `UPDATE runtime_instances SET last_heartbeat_at = ?, last_status = ?, ui_url = COALESCE(?, ui_url),
         gateway_url = COALESCE(?, gateway_url), meta_json = ?, updated_at = ? WHERE id = ?`
      ).run(
        now,
        status,
        uiUrl,
        gatewayUrl,
        body.meta ? JSON.stringify(body.meta) : null,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO runtime_instances (agent_id, runtime_type, ui_url, gateway_url, honcho_workspace, honcho_peer_id, last_heartbeat_at, last_status, meta_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        agentId,
        runtimeType,
        uiUrl,
        gatewayUrl,
        body.honcho_workspace || ep.honchoWorkspace,
        body.honcho_peer_id || null,
        now,
        status,
        body.meta ? JSON.stringify(body.meta) : null,
        now,
        now
      );
    }

    if (status === 'online' || status === 'running') {
      db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(
        status === 'running' ? 'running' : 'active',
        agentId
      );
    }

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'runtime.heartbeat',
      resource_type: 'agent',
      resource_id: agentId,
      meta: { runtime_type: runtimeType, status },
    });

    return NextResponse.json({ ok: true, agent_id: agentId, runtime_type: runtimeType, at: now });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
