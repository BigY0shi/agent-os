export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';

export async function PATCH(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const db = await getDb();
    const slug = params.slug;
    const body = await request.json();
    const host = db.prepare('SELECT * FROM honcho_hosts WHERE slug = ?').get(slug);
    if (!host) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE honcho_hosts SET enabled = ?, ai_peer = COALESCE(?, ai_peer), updated_at = ? WHERE slug = ?`
    ).run(
      body.enabled != null ? (body.enabled ? 1 : 0) : host.enabled,
      body.ai_peer ?? null,
      now,
      slug
    );

    return NextResponse.json(db.prepare('SELECT * FROM honcho_hosts WHERE slug = ?').get(slug));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
