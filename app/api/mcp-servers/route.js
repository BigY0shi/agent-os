export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const db = await getDb();

    const servers = db
      .prepare(
        `
      SELECT
        id,
        name,
        description,
        status,
        transport,
        command,
        args,
        env,
        tools_count,
        created_at
      FROM mcp_servers
      ORDER BY created_at DESC
    `
      )
      .all();

    return NextResponse.json(servers);
  } catch (error) {
    console.error('MCP servers GET error:', error);
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
      description = '',
      transport = 'stdio',
      command = '',
      args = '[]',
      env = '{}',
      status = 'stopped',
      tools_count = 0,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const result = db
      .prepare(
        `
      INSERT INTO mcp_servers (name, description, status, transport, command, args, env, tools_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(name, description, status, transport, command, typeof args === 'string' ? args : JSON.stringify(args), typeof env === 'string' ? env : JSON.stringify(env), tools_count, now);

    return NextResponse.json(
      {
        id: result.lastInsertRowid,
        name,
        description,
        status,
        transport,
        command,
        args,
        env,
        tools_count,
        created_at: now,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('MCP servers POST error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('id');
    const action = searchParams.get('action');

    if (!serverId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Handle start/stop action
    if (action === 'start' || action === 'stop') {
      const newStatus = action === 'start' ? 'running' : 'stopped';

      db.prepare(`UPDATE mcp_servers SET status = ? WHERE id = ?`).run(
        newStatus,
        serverId
      );

      return NextResponse.json({
        id: serverId,
        status: newStatus,
      });
    }

    // Handle general update
    const body = await request.json();
    const { name, description, transport, command, args, env, status, tools_count } = body;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push(`name = ?`);
      values.push(name);
    }

    if (description !== undefined) {
      updates.push(`description = ?`);
      values.push(description);
    }

    if (transport !== undefined) {
      updates.push(`transport = ?`);
      values.push(transport);
    }

    if (command !== undefined) {
      updates.push(`command = ?`);
      values.push(command);
    }

    if (args !== undefined) {
      updates.push(`args = ?`);
      values.push(typeof args === 'string' ? args : JSON.stringify(args));
    }

    if (env !== undefined) {
      updates.push(`env = ?`);
      values.push(typeof env === 'string' ? env : JSON.stringify(env));
    }

    if (status !== undefined) {
      updates.push(`status = ?`);
      values.push(status);
    }

    if (tools_count !== undefined) {
      updates.push(`tools_count = ?`);
      values.push(tools_count);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(serverId);

    const query = `UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...values);

    return NextResponse.json({
      id: serverId,
      name,
      description,
      transport,
      command,
      args,
      env,
      status,
      tools_count,
    });
  } catch (error) {
    console.error('MCP servers PUT error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('id');

    if (!serverId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    db.prepare(`DELETE FROM mcp_servers WHERE id = ?`).run(serverId);

    return NextResponse.json({
      message: 'MCP server deleted successfully',
      id: serverId,
    });
  } catch (error) {
    console.error('MCP servers DELETE error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
