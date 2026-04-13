export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
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
    } else if (action === 'reject') {
      db.prepare('UPDATE decisions SET status = ?, resolved_at = ?, resolver = ? WHERE id = ?')
        .run('rejected', now, body.resolver || 'Yoshi', id);
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
