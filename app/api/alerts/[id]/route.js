export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';

export async function DELETE(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const db = await getDb();
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?`).run(now, id);

    return NextResponse.json({ id, status: 'resolved', resolved_at: now });
  } catch (error) {
    console.error('DELETE /api/alerts/[id] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
