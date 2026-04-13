export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const agentId = searchParams.get('agent_id');

    const db = await getDb();

    let query = `
      SELECT
        t.id,
        t.name,
        t.type,
        t.description,
        t.status,
        t.endpoint,
        t.config,
        t.agent_id,
        t.created_at
      FROM tools t
      WHERE 1=1
    `;

    const params = [];

    if (type) {
      query += ` AND t.type = ?`;
      params.push(type);
    }

    if (status) {
      query += ` AND t.status = ?`;
      params.push(status);
    }

    if (agentId) {
      query += ` AND t.agent_id = ?`;
      params.push(agentId);
    }

    query += ` ORDER BY t.created_at DESC`;

    const tools = db.prepare(query).all(...params);

    return NextResponse.json(tools);
  } catch (error) {
    console.error('Tools GET error:', error);
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
      name,
      type,
      description = '',
      endpoint = '',
      status = 'available',
      config = '{}',
      agent_id = null,
    } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'name and type are required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const result = db
      .prepare(
        `
      INSERT INTO tools (name, type, description, endpoint, status, config, agent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(name, type, description, endpoint, status, typeof config === 'string' ? config : JSON.stringify(config), agent_id, now);

    return NextResponse.json(
      {
        id: result.lastInsertRowid,
        name,
        type,
        description,
        endpoint,
        status,
        config,
        agent_id,
        created_at: now,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Tools POST error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const toolId = searchParams.get('id');

    if (!toolId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const body = await request.json();

    const { name, type, description, endpoint, status, config, agent_id } = body;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push(`name = ?`);
      values.push(name);
    }

    if (type !== undefined) {
      updates.push(`type = ?`);
      values.push(type);
    }

    if (description !== undefined) {
      updates.push(`description = ?`);
      values.push(description);
    }

    if (endpoint !== undefined) {
      updates.push(`endpoint = ?`);
      values.push(endpoint);
    }

    if (status !== undefined) {
      updates.push(`status = ?`);
      values.push(status);
    }

    if (config !== undefined) {
      updates.push(`config = ?`);
      values.push(typeof config === 'string' ? config : JSON.stringify(config));
    }

    if (agent_id !== undefined) {
      updates.push(`agent_id = ?`);
      values.push(agent_id);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(toolId);

    const query = `UPDATE tools SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...values);

    return NextResponse.json({
      id: toolId,
      name,
      type,
      description,
      endpoint,
      status,
      config,
      agent_id,
    });
  } catch (error) {
    console.error('Tools PUT error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const toolId = searchParams.get('id');

    if (!toolId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    db.prepare(`DELETE FROM tools WHERE id = ?`).run(toolId);

    return NextResponse.json({
      message: 'Tool deleted successfully',
      id: toolId,
    });
  } catch (error) {
    console.error('Tools DELETE error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
