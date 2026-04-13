export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const section = searchParams.get('section');
    const priority = searchParams.get('priority');
    const agentId = searchParams.get('agent_id');

    const db = await getDb();

    let query = `
      SELECT t.*, a.name as agent_name
      FROM tasks t
      LEFT JOIN agents a ON t.agent_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (status) { query += ' AND t.status = ?'; params.push(status); }
    if (section) { query += ' AND t.section = ?'; params.push(section); }
    if (priority) { query += ' AND t.priority = ?'; params.push(priority); }
    if (agentId) { query += ' AND t.agent_id = ?'; params.push(agentId); }

    query += ' ORDER BY t.created_at DESC';

    const tasks = db.prepare(query).all(...params);
    return NextResponse.json(tasks);

  } catch (error) {
    console.error('Tasks GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const db = await getDb();
    const now = new Date().toISOString();

    const {
      title,
      agent_id = null,
      section = '',
      status = 'backlog',
      priority = 'medium',
      description = ''
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const result = db.prepare(
      'INSERT INTO tasks (title, agent_id, section, status, priority, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(title, agent_id, section, status, priority, description, now);

    // Fetch agent_name for the response
    let agent_name = null;
    if (agent_id) {
      const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agent_id);
      if (agent) agent_name = agent.name;
    }

    return NextResponse.json({
      id: result.lastInsertRowid, title, agent_id, agent_name, section, status, priority, description, created_at: now
    }, { status: 201 });

  } catch (error) {
    console.error('Tasks POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const body = await request.json();
    const db = await getDb();

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const fields = ['title', 'agent_id', 'section', 'status', 'priority', 'description'];
    const updates = [];
    const values = [];

    fields.forEach(f => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    });

    // Auto-set completed_at when status changes to done or rejected
    if (body.status === 'done' || body.status === 'rejected') {
      updates.push('completed_at = ?');
      values.push(new Date().toISOString());
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(id);
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(`
      SELECT t.*, a.name as agent_name
      FROM tasks t
      LEFT JOIN agents a ON t.agent_id = a.id
      WHERE t.id = ?
    `).get(id);

    return NextResponse.json(updated);

  } catch (error) {
    console.error('Tasks PUT error:', error);
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

    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return NextResponse.json({ success: true, id });

  } catch (error) {
    console.error('Tasks DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
