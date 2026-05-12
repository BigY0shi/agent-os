export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const agentId = searchParams.get('agent_id');

    const db = await getDb();

    let query = 'SELECT * FROM content WHERE 1=1';
    const params = [];

    if (type && type !== 'all') { query += ' AND type = ?'; params.push(type); }
    if (status && status !== 'all') { query += ' AND status = ?'; params.push(status); }
    if (agentId) { query += ' AND agent_id = ?'; params.push(agentId); }

    query += ' ORDER BY created_at DESC';

    const content = db.prepare(query).all(...params);
    return NextResponse.json(content);

  } catch (error) {
    console.error('Content GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const body = await request.json();
    const db = await getDb();
    const now = new Date().toISOString();

    const {
      agent_id = null,
      agent_name = '',
      title,
      type = 'blog',
      word_count = 0,
      status = 'draft',
      preview = '',
      preview_text = ''
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const previewContent = preview || preview_text || '';

    const result = db.prepare(
      'INSERT INTO content (agent_id, agent_name, title, type, word_count, status, preview, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(agent_id, agent_name, title, type, word_count, status, previewContent, now);

    return NextResponse.json({
      id: result.lastInsertRowid, agent_id, agent_name, title, type,
      word_count, status, preview: previewContent, created_at: now
    }, { status: 201 });

  } catch (error) {
    console.error('Content POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const body = await request.json();
    const db = await getDb();

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM content WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    const fields = ['agent_id', 'agent_name', 'title', 'type', 'word_count', 'status', 'preview', 'feedback_vote', 'feedback_tags', 'feedback_comment'];
    const updates = [];
    const values = [];

    fields.forEach(f => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(f === 'feedback_tags' && typeof body[f] !== 'string' ? JSON.stringify(body[f]) : body[f]);
      }
    });

    // Support preview_text as alias for preview
    if (body.preview_text !== undefined && body.preview === undefined) {
      updates.push('preview = ?');
      values.push(body.preview_text);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(id);
    db.prepare(`UPDATE content SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM content WHERE id = ?').get(id);
    return NextResponse.json(updated);

  } catch (error) {
    console.error('Content PUT error:', error);
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

    const existing = db.prepare('SELECT * FROM content WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM content WHERE id = ?').run(id);
    return NextResponse.json({ success: true, id });

  } catch (error) {
    console.error('Content DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
