export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get('enabled') === 'true';
    let sql = 'SELECT id, slug, kind, label, base_url, default_model, api_key_env, config_json, enabled, created_at, updated_at FROM model_providers WHERE 1=1';
    if (enabledOnly) sql += ' AND enabled = 1';
    sql += ' ORDER BY label ASC';
    const rows = db.prepare(sql).all();
    return NextResponse.json(rows || []);
  } catch (error) {
    console.error('GET /api/model-providers error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const body = await request.json();
    const slug = (body.slug || '').trim();
    const label = (body.label || '').trim();
    if (!slug || !label) {
      return NextResponse.json({ error: 'slug and label required' }, { status: 400 });
    }
    const kind = body.kind === 'cli' ? 'cli' : 'api';
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO model_providers (slug, kind, label, base_url, default_model, api_key_env, config_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        slug,
        kind,
        label,
        body.base_url || '',
        body.default_model || '',
        body.api_key_env || null,
        body.config_json ? JSON.stringify(body.config_json) : null,
        body.enabled === false ? 0 : 1,
        now,
        now
      );

    const id = result.lastInsertRowid;
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'model_provider.create',
      resource_type: 'model_provider',
      resource_id: id,
      meta: { slug },
    });

    const row = db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('POST /api/model-providers error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
