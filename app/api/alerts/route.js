export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');

    const db = await getDb();

    let query = `
      SELECT
        id,
        agent_id,
        agent_name,
        type,
        message,
        status,
        created_at,
        resolved_at
      FROM alerts
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC`;

    const alerts = db.prepare(query).all(...params);

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error('Alerts GET error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alertId = searchParams.get('id');

    if (!alertId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const now = new Date().toISOString();

    db.prepare(`UPDATE alerts SET status = ?, resolved_at = ? WHERE id = ?`).run(
      'resolved',
      now,
      alertId
    );

    return NextResponse.json({
      id: alertId,
      status: 'resolved',
      resolved_at: now,
    });
  } catch (error) {
    console.error('Alerts PUT error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
