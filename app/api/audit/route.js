export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead } from '@/lib/authz';

export async function GET(request) {
  const gate = authorizeRead(request, 'operator', { allowAnonymousViewer: false });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 500);
    const resource_type = searchParams.get('resource_type');
    const resource_id = searchParams.get('resource_id');
    const action = searchParams.get('action');

    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];
    if (resource_type) {
      sql += ' AND resource_type = ?';
      params.push(resource_type);
    }
    if (resource_id) {
      sql += ' AND resource_id = ?';
      params.push(String(resource_id));
    }
    if (action) {
      sql += ' AND action LIKE ?';
      params.push(`%${action}%`);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return NextResponse.json(rows || []);
  } catch (error) {
    console.error('GET /api/audit error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
