import { NextResponse } from 'next/server';

/**
 * @param {{ ok: boolean, status?: number, error?: string }} gate
 */
export function jsonAuthError(gate) {
  return NextResponse.json({ error: gate.error || 'Unauthorized' }, { status: gate.status || 401 });
}
