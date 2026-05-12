export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

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
