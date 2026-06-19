export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function GET(request, { params }) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const id = Number(params.id);
    const row = db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const id = Number(params.id);
    const existing = db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await request.json();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE model_providers SET label = ?, base_url = ?, default_model = ?, api_key_env = ?, enabled = ?, updated_at = ? WHERE id = ?`
    ).run(
      body.label ?? existing.label,
      body.base_url ?? existing.base_url,
      body.default_model ?? existing.default_model,
      body.api_key_env !== undefined ? body.api_key_env : existing.api_key_env,
      body.enabled === false ? 0 : body.enabled === true ? 1 : existing.enabled,
      now,
      id
    );

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'model_provider.update',
      resource_type: 'model_provider',
      resource_id: id,
    });

    return NextResponse.json(db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const db = await getDb();
  const id = Number(params.id);
  const row = db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id);
  if (!row?.base_url) {
    return NextResponse.json({ ok: false, error: 'no base_url configured' });
  }

  const base = row.base_url.replace(/\/$/, '');
  const paths = ['/health', '/api/tags', '/v1/models', '/'];
  for (const path of paths) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base}${path}`, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(t);
      if (res.status >= 200 && res.status < 500) {
        return NextResponse.json({ ok: res.ok, status: res.status, path, provider_id: id });
      }
    } catch {
      // try next
    }
  }
  return NextResponse.json({ ok: false, provider_id: id, error: 'unreachable' });
}
