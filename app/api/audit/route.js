export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireRole } from '@/lib/authz';

export async function GET(request) {
  const gate = requireRole(request, 'operator');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 500);
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
    return NextResponse.json(rows || []);
  } catch (error) {
    console.error('GET /api/audit error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
