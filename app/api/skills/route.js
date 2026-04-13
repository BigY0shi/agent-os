export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Unified route for skills, tools, and MCP servers
// Use ?resource=tools or ?resource=mcp-servers to switch resource type

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const resource = searchParams.get('resource');

    const db = await getDb();

    // --- Tools ---
    if (resource === 'tools') {
      const type = searchParams.get('type');
      const status = searchParams.get('status');
      const agentId = searchParams.get('agent_id');

      let query = 'SELECT * FROM tools WHERE 1=1';
      const params = [];

      if (type) { query += ' AND type = ?'; params.push(type); }
      if (status) { query += ' AND status = ?'; params.push(status); }
      if (agentId) { query += ' AND agent_id = ?'; params.push(agentId); }

      query += ' ORDER BY created_at DESC';
      const tools = db.prepare(query).all(...params);
      return NextResponse.json(tools);
    }

    // --- MCP Servers ---
    if (resource === 'mcp-servers') {
      const status = searchParams.get('status');
      let query = 'SELECT * FROM mcp_servers WHERE 1=1';
      const params = [];

      if (status) { query += ' AND status = ?'; params.push(status); }

      query += ' ORDER BY created_at DESC';
      const servers = db.prepare(query).all(...params);
      return NextResponse.json(servers);
    }

    // --- Skills (default) ---
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const agentId = searchParams.get('agent_id');

    let query = `
      SELECT s.*, a.name as agent_name
      FROM skills s
      LEFT JOIN agents a ON s.agent_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (type) { query += ' AND s.type = ?'; params.push(type); }
    if (status) { query += ' AND s.status = ?'; params.push(status); }
    if (agentId) { query += ' AND s.agent_id = ?'; params.push(agentId); }

    query += ' ORDER BY s.created_at DESC';
    const skills = db.prepare(query).all(...params);
    return NextResponse.json(skills);

  } catch (error) {
    console.error('Skills GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const resource = searchParams.get('resource');
    const body = await request.json();
    const db = await getDb();
    const now = new Date().toISOString();

    // --- Tools ---
    if (resource === 'tools') {
      const { name, type = 'api', description = '', endpoint = '', config = '{}', agent_id = null, status = 'connected' } = body;

      if (!name) {
        return NextResponse.json({ error: 'name is required' }, { status: 400 });
      }

      const result = db.prepare(
        'INSERT INTO tools (name, type, description, endpoint, status, config, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(name, type, description, endpoint, status, typeof config === 'string' ? config : JSON.stringify(config), agent_id, now);

      return NextResponse.json({
        id: result.lastInsertRowid, name, type, description, endpoint, status, config, agent_id, created_at: now
      }, { status: 201 });
    }

    // --- MCP Servers ---
    if (resource === 'mcp-servers') {
      const { name, description = '', transport = 'stdio', command = '', args = '[]', env = '{}', status = 'stopped' } = body;

      if (!name) {
        return NextResponse.json({ error: 'name is required' }, { status: 400 });
      }

      const result = db.prepare(
        'INSERT INTO mcp_servers (name, description, status, transport, command, args, env, tools_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(name, description, status, transport, command, typeof args === 'string' ? args : JSON.stringify(args), typeof env === 'string' ? env : JSON.stringify(env), 0, now);

      return NextResponse.json({
        id: result.lastInsertRowid, name, description, status, transport, command, args, env, tools_count: 0, created_at: now
      }, { status: 201 });
    }

    // --- Skills (default) ---
    const { name, description = '', type = 'custom', agent_id = null, trigger_keywords = '', file_path = '', version = '1.0', status = 'draft' } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const result = db.prepare(
      'INSERT INTO skills (name, description, agent_id, type, status, trigger_keywords, file_path, version, run_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(name, description, agent_id, type, status, trigger_keywords, file_path, version, 0, now);

    // Fetch agent_name for the response
    let agent_name = null;
    if (agent_id) {
      const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agent_id);
      if (agent) agent_name = agent.name;
    }

    return NextResponse.json({
      id: result.lastInsertRowid, name, description, type, agent_id, agent_name,
      trigger_keywords, file_path, version, status, run_count: 0, last_run: null, created_at: now
    }, { status: 201 });

  } catch (error) {
    console.error('Skills POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const resource = searchParams.get('resource');
    const body = await request.json();
    const db = await getDb();

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    // --- Tools ---
    if (resource === 'tools') {
      const fields = ['name', 'type', 'description', 'endpoint', 'status', 'config', 'agent_id'];
      const updates = [];
      const values = [];

      fields.forEach(f => {
        if (body[f] !== undefined) {
          updates.push(`${f} = ?`);
          values.push(f === 'config' && typeof body[f] !== 'string' ? JSON.stringify(body[f]) : body[f]);
        }
      });

      if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

      values.push(id);
      db.prepare(`UPDATE tools SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      const updated = db.prepare('SELECT * FROM tools WHERE id = ?').get(id);
      return NextResponse.json(updated);
    }

    // --- MCP Servers ---
    if (resource === 'mcp-servers') {
      const fields = ['name', 'description', 'status', 'transport', 'command', 'args', 'env', 'tools_count'];
      const updates = [];
      const values = [];

      fields.forEach(f => {
        if (body[f] !== undefined) {
          updates.push(`${f} = ?`);
          const val = body[f];
          values.push((f === 'args' || f === 'env') && typeof val !== 'string' ? JSON.stringify(val) : val);
        }
      });

      if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

      values.push(id);
      db.prepare(`UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      const updated = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
      return NextResponse.json(updated);
    }

    // --- Skills (default) ---
    const fields = ['name', 'description', 'type', 'agent_id', 'trigger_keywords', 'file_path', 'version', 'status'];
    const updates = [];
    const values = [];

    fields.forEach(f => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    });

    if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    values.push(id);
    db.prepare(`UPDATE skills SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(`
      SELECT s.*, a.name as agent_name
      FROM skills s
      LEFT JOIN agents a ON s.agent_id = a.id
      WHERE s.id = ?
    `).get(id);

    return NextResponse.json(updated);

  } catch (error) {
    console.error('Skills PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const resource = searchParams.get('resource');
    const db = await getDb();

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    // --- Tools ---
    if (resource === 'tools') {
      const existing = db.prepare('SELECT * FROM tools WHERE id = ?').get(id);
      if (!existing) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });

      db.prepare('DELETE FROM tools WHERE id = ?').run(id);
      return NextResponse.json({ success: true, id });
    }

    // --- MCP Servers ---
    if (resource === 'mcp-servers') {
      const existing = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
      if (!existing) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 });

      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      return NextResponse.json({ success: true, id });
    }

    // --- Skills (default) ---
    const existing = db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
    if (!existing) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return NextResponse.json({ success: true, id });

  } catch (error) {
    console.error('Skills DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
