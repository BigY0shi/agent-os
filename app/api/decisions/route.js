export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { appendAuditLog } from '@/lib/audit';
import { applyModelChangeApproval } from '@/lib/modelChange';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');

    const db = await getDb();

    let query = 'SELECT * FROM decisions WHERE 1=1';
    const params = [];

    if (status && status !== 'all') { query += ' AND status = ?'; params.push(status); }
    if (type && type !== 'all') { query += ' AND type = ?'; params.push(type); }

    query += ' ORDER BY created_at DESC';

    const decisions = db.prepare(query).all(...params);
    return NextResponse.json(decisions);

  } catch (error) {
    console.error('Decisions GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'agent-runtime');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const body = await request.json();
    const db = await getDb();
    const now = new Date().toISOString();

    const {
      agent_id = null,
      agent_name = '',
      section = '',
      action,
      type = 'config',
      details = ''
    } = body;

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    const result = db.prepare(
      'INSERT INTO decisions (agent_id, agent_name, section, action, type, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(agent_id, agent_name, section, action, type, 'pending', typeof details === 'string' ? details : JSON.stringify(details), now);

    return NextResponse.json({
      id: result.lastInsertRowid, agent_id, agent_name, section, action, type,
      status: 'pending', details, created_at: now, resolved_at: null, resolver: null
    }, { status: 201 });

  } catch (error) {
    console.error('Decisions POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const action = searchParams.get('action');
    const body = await request.json();
    const db = await getDb();

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    // Handle approve/reject actions
    if (action === 'approve') {
      db.prepare('UPDATE decisions SET status = ?, resolved_at = ?, resolver = ? WHERE id = ?')
        .run('approved', now, body.resolver || 'Yoshi', id);

      if (existing.type === 'model_change') {
        const result = applyModelChangeApproval(db, existing, gate.ctx.actor);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
      }

      appendAuditLog(db, {
        actor: gate.ctx.actor,
        action: 'decision.approve',
        resource_type: 'decision',
        resource_id: id,
        meta: { type: existing.type },
      });
    } else if (action === 'reject') {
      db.prepare('UPDATE decisions SET status = ?, resolved_at = ?, resolver = ? WHERE id = ?')
        .run('rejected', now, body.resolver || 'Yoshi', id);
      appendAuditLog(db, {
        actor: gate.ctx.actor,
        action: 'decision.reject',
        resource_type: 'decision',
        resource_id: id,
        meta: { type: existing.type },
      });
    } else {
      // Generic update
      const fields = ['agent_id', 'agent_name', 'section', 'action', 'type', 'status', 'details'];
      const updates = [];
      const values = [];

      fields.forEach(f => {
        if (body[f] !== undefined) {
          updates.push(`${f} = ?`);
          values.push(f === 'details' && typeof body[f] !== 'string' ? JSON.stringify(body[f]) : body[f]);
        }
      });

      if (updates.length > 0) {
        values.push(id);
        db.prepare(`UPDATE decisions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
    }

    const updated = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    return NextResponse.json(updated);

  } catch (error) {
    console.error('Decisions PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const db = await getDb();

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM decisions WHERE id = ?').run(id);
    return NextResponse.json({ success: true, id });

  } catch (error) {
    console.error('Decisions DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
