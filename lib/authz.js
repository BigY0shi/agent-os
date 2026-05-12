/**
 * Lightweight RBAC for Agent OS control-plane APIs.
 * Set AGENT_OS_API_KEYS to a JSON map of { "token": "role" } to require keys in production.
 * If unset or empty, requests run as admin (local dev default).
 */

const ROLE_ORDER = {
  admin: 4,
  operator: 3,
  'agent-runtime': 2,
  viewer: 1,
};

export function extractToken(request) {
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const key = request.headers.get('x-api-key');
  return key ? key.trim() : null;
}

export function getAuthContext(request) {
  const token = extractToken(request);
  const raw = process.env.AGENT_OS_API_KEYS;

  if (!raw || raw.trim() === '') {
    return { role: 'admin', actor: 'dev:local', token: null };
  }

  let map = {};
  try {
    map = JSON.parse(raw);
  } catch {
    map = {};
  }

  if (token && map[token]) {
    return { role: map[token], actor: `api_key:${token.slice(0, 8)}`, token };
  }

  return { role: null, actor: 'anonymous', token: null };
}

/**
 * @param {import('next/server').NextRequest} request
 * @param {'viewer'|'agent-runtime'|'operator'|'admin'} minRole
 */
export function requireRole(request, minRole) {
  const ctx = getAuthContext(request);
  const keysConfigured = !!(process.env.AGENT_OS_API_KEYS && process.env.AGENT_OS_API_KEYS.trim() !== '');

  if (keysConfigured && !ctx.role) {
    return { ok: false, status: 401, error: 'API key required', ctx };
  }

  const effective = ctx.role || 'viewer';
  const need = ROLE_ORDER[minRole] || 1;
  const have = ROLE_ORDER[effective] || 0;

  if (have < need) {
    return { ok: false, status: 403, error: 'Forbidden', ctx: { ...ctx, role: effective } };
  }

  return { ok: true, ctx: { ...ctx, role: effective } };
}
