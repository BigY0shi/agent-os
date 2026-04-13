export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const section = searchParams.get('section');
    const department = searchParams.get('department');
    const harness = searchParams.get('harness');
    const framework = searchParams.get('framework');

    let query = 'SELECT * FROM agents WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (section) {
      query += ' AND (section = ? OR department = ?)';
      params.push(section, section);
    }

    if (department) {
      query += ' AND (department = ? OR section = ?)';
      params.push(department, department);
    }

    if (harness || framework) {
      query += ' AND (harness = ? OR framework = ?)';
      const fw = framework || harness;
      params.push(fw, fw);
    }

    query += ' ORDER BY created_at DESC';

    const agents = db.prepare(query).all(...params);

    return NextResponse.json(agents || []);
  } catch (error) {
    console.error('GET /api/agents error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json();

    const {
      name,
      section,
      department,
      role,
      harness,
      framework,
      status = 'idle',
      config = '{}',
      goal,
      vibe,
      system_prompt,
      memory_enabled = 0,
      agent_type = 'worker',
      stage = 'ideate',
      assigned_tools = '[]',
      assigned_skills = '[]',
    } = body;

    // Validate required fields - name and department are required
    const finalDepartment = department || section;
    const finalSection = section || department;

    if (!name || !finalDepartment) {
      return NextResponse.json(
        { error: 'name and department are required' },
        { status: 400 }
      );
    }

    const stmt = db.prepare(`
      INSERT INTO agents (name, section, department, role, harness, framework, status, config, created_at, goal, vibe, system_prompt, memory_enabled, agent_type, stage, assigned_tools, assigned_skills)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      finalSection,
      finalDepartment,
      role || '',
      harness || (framework || 'custom'),
      framework || (harness || 'custom'),
      status,
      typeof config === 'string' ? config : JSON.stringify(config),
      goal || '',
      vibe || '',
      system_prompt || '',
      memory_enabled ? 1 : 0,
      agent_type,
      stage,
      typeof assigned_tools === 'string' ? assigned_tools : JSON.stringify(assigned_tools),
      typeof assigned_skills === 'string' ? assigned_skills : JSON.stringify(assigned_skills)
    );

    const newAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(result.lastInsertRowid);

    return NextResponse.json(newAgent, { status: 201 });
  } catch (error) {
    console.error('POST /api/agents error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    const body = await request.json();

    // Get current agent to merge updates
    const currentAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    if (!currentAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const updates = {
      name: body.name !== undefined ? body.name : currentAgent.name,
      section: body.section !== undefined ? body.section : (body.department !== undefined ? body.department : currentAgent.section),
      department: body.department !== undefined ? body.department : (body.section !== undefined ? body.section : currentAgent.department),
      role: body.role !== undefined ? body.role : currentAgent.role,
      harness: body.harness !== undefined ? body.harness : (body.framework !== undefined ? body.framework : currentAgent.harness),
      framework: body.framework !== undefined ? body.framework : (body.harness !== undefined ? body.harness : currentAgent.framework),
      status: body.status !== undefined ? body.status : currentAgent.status,
      config: body.config !== undefined ? body.config : currentAgent.config,
      goal: body.goal !== undefined ? body.goal : currentAgent.goal,
      vibe: body.vibe !== undefined ? body.vibe : currentAgent.vibe,
      system_prompt: body.system_prompt !== undefined ? body.system_prompt : currentAgent.system_prompt,
      memory_enabled: body.memory_enabled !== undefined ? (body.memory_enabled ? 1 : 0) : currentAgent.memory_enabled,
      agent_type: body.agent_type !== undefined ? body.agent_type : currentAgent.agent_type,
      stage: body.stage !== undefined ? body.stage : currentAgent.stage,
      assigned_tools: body.assigned_tools !== undefined ? (typeof body.assigned_tools === 'string' ? body.assigned_tools : JSON.stringify(body.assigned_tools)) : currentAgent.assigned_tools,
      assigned_skills: body.assigned_skills !== undefined ? (typeof body.assigned_skills === 'string' ? body.assigned_skills : JSON.stringify(body.assigned_skills)) : currentAgent.assigned_skills,
    };

    const stmt = db.prepare(`
      UPDATE agents
      SET name = ?, section = ?, department = ?, role = ?, harness = ?, framework = ?, status = ?, config = ?, goal = ?, vibe = ?, system_prompt = ?, memory_enabled = ?, agent_type = ?, stage = ?, assigned_tools = ?, assigned_skills = ?
      WHERE id = ?
    `);

    stmt.run(
      updates.name,
      updates.section,
      updates.department,
      updates.role,
      updates.harness,
      updates.framework,
      updates.status,
      typeof updates.config === 'string' ? updates.config : JSON.stringify(updates.config),
      updates.goal,
      updates.vibe,
      updates.system_prompt,
      updates.memory_enabled,
      updates.agent_type,
      updates.stage,
      updates.assigned_tools,
      updates.assigned_skills,
      id
    );

    const updatedAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);

    return NextResponse.json(updatedAgent);
  } catch (error) {
    console.error('PUT /api/agents error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
    }

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Delete related outputs first
    db.prepare('DELETE FROM outputs WHERE agent_id = ?').run(id);

    // Delete the agent
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('DELETE /api/agents error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
