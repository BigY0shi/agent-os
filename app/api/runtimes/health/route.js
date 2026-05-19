export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authorizeRead } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { checkRuntimes } from '@/lib/runtimeHealth';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const health = await checkRuntimes();
    return NextResponse.json(health);
  } catch (error) {
    console.error('Runtime health error:', error);
    return NextResponse.json({ error: 'Failed to check runtimes' }, { status: 500 });
  }
}
