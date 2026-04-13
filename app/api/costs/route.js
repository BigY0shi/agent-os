export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = searchParams.get('days');

    const db = await getDb();

    let query = `
      SELECT
        date,
        ROUND(SUM(CAST(amount AS REAL)), 2) as total_cost,
        COUNT(*) as transaction_count
      FROM cost_entries
      WHERE 1=1
    `;

    const params = [];

    if (days) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      query += ` AND date >= ?`;
      params.push(startDate.toISOString().split('T')[0]);
    }

    query += ` GROUP BY date ORDER BY date DESC`;

    const costs = db.prepare(query).all(...params);

    return NextResponse.json({ costs });
  } catch (error) {
    console.error('Costs GET error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
