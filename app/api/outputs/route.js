export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');

    const db = await getDb();

    let query = `
      SELECT
        o.id,
        o.agent_id,
        o.agent_name,
        o.type,
        o.title,
        o.content,
        o.vote,
        o.tags,
        o.comment,
        o.created_at
      FROM outputs o
    `;

    const params = [];

    if (agentId) {
      query += ` WHERE o.agent_id = ?`;
      params.push(agentId);
    }

    query += ` ORDER BY o.created_at DESC`;

    const outputs = db.prepare(query).all(...params);

    return NextResponse.json({ outputs });
  } catch (error) {
    console.error('Outputs GET error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();

    const {
      agent_id,
      agent_name,
      type,
      title,
      content,
      vote = 0,
      tags = '[]',
      comment = '',
    } = body;

    if (!agent_id || !agent_name) {
      return NextResponse.json(
        { error: 'agent_id and agent_name are required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const result = db
      .prepare(
        `
      INSERT INTO outputs (agent_id, agent_name, type, title, content, vote, tags, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(agent_id, agent_name, type || '', title || '', content || '', vote, typeof tags === 'string' ? tags : JSON.stringify(tags), comment, now);

    return NextResponse.json(
      {
        id: result.lastInsertRowid,
        agent_id,
        agent_name,
        type,
        title,
        content,
        vote,
        tags,
        comment,
        created_at: now,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Outputs POST error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const outputId = searchParams.get('id');

    if (!outputId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const body = await request.json();

    const { vote, comment, tags } = body;

    const updates = [];
    const values = [];

    if (vote !== undefined) {
      updates.push(`vote = ?`);
      values.push(vote);
    }

    if (comment !== undefined) {
      updates.push(`comment = ?`);
      values.push(comment);
    }

    if (tags !== undefined) {
      updates.push(`tags = ?`);
      values.push(typeof tags === 'string' ? tags : JSON.stringify(tags));
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(outputId);

    const query = `UPDATE outputs SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...values);

    return NextResponse.json({
      id: outputId,
      vote,
      comment,
      tags,
    });
  } catch (error) {
    console.error('Outputs PUT error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
