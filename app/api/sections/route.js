export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const db = await getDb();

    const sections = db
      .prepare(
        `
      SELECT
        id,
        name,
        color,
        icon
      FROM sections
      ORDER BY name ASC
    `
      )
      .all();

    return NextResponse.json({ sections });
  } catch (error) {
    console.error('Sections GET error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
