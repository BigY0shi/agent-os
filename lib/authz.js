/**
 * RBAC for Agent OS control-plane APIs.
 *
 * AGENT_OS_API_KEYS: JSON map { "token": "admin"|"operator"|"agent-runtime"|"viewer" }
 * - When unset/empty: all requests run as admin (local dev).
 * - When set: writes require a valid token; reads default to anonymous viewer for dashboard UX.
 *
 * AGENT_OS_REQUIRE_API_KEY_FOR_READ=true — require token for all GETs as well.
 *
 * @see docs/CODE_REVIEW_REMEDIATION_PLAN.md
 */

const ROLE_ORDER = {
  admin: 4,
  operator: 3,
  'agent-runtime': 2,
  viewer: 1,
};

export function isKeysConfigured() {
  const raw = process.env.AGENT_OS_API_KEYS;
  return !!(raw && raw.trim() !== '');
}

export function extractToken(request) {
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const key = request.headers.get('x-api-key');
  return key ? key.trim() : null;
}

/** Resolved identity (never null role when ok). */
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

export function roleMeets(role, minRole) {
  const have = ROLE_ORDER[role] || 0;
  const need = ROLE_ORDER[minRole] || 1;
  return have >= need;
}

/**
 * Read path: supports anonymous viewer when keys are configured (unless strict read).
 * @param {'viewer'|'agent-runtime'|'operator'|'admin'} minRole
 * @param {{ allowAnonymousViewer?: boolean }} [options] — default true unless AGENT_OS_REQUIRE_API_KEY_FOR_READ or options false
 */
export function authorizeRead(request, minRole = 'viewer', options = {}) {
  if (!isKeysConfigured()) {
    return { ok: true, ctx: { role: 'admin', actor: 'dev:local' } };
  }

  const strictRead = process.env.AGENT_OS_REQUIRE_API_KEY_FOR_READ === 'true';
  const allowAnonymous =
    options.allowAnonymousViewer !== false && !strictRead;

  const ctx = getAuthContext(request);

  if (ctx.role) {
    if (roleMeets(ctx.role, minRole)) {
      return { ok: true, ctx };
    }
    return { ok: false, status: 403, error: 'Forbidden', ctx };
  }

  if (!allowAnonymous || !roleMeets('viewer', minRole)) {
    return { ok: false, status: 401, error: 'API key required', ctx };
  }

  return { ok: true, ctx: { role: 'viewer', actor: 'anonymous' } };
}

/**
 * Mutations: always require a real token when keys are configured.
 * @param {'viewer'|'agent-runtime'|'operator'|'admin'} [minRole]
 */
export function authorizeWrite(request, minRole = 'operator') {
  if (!isKeysConfigured()) {
    return { ok: true, ctx: { role: 'admin', actor: 'dev:local' } };
  }

  const ctx = getAuthContext(request);
  if (!ctx.role) {
    return { ok: false, status: 401, error: 'API key required', ctx };
  }
  if (!roleMeets(ctx.role, minRole)) {
    return { ok: false, status: 403, error: 'Forbidden', ctx };
  }
  return { ok: true, ctx };
}

/**
 * @deprecated Prefer authorizeRead / authorizeWrite. Kept for narrow routes that required key even for read.
 */
export function requireRole(request, minRole) {
  if (!isKeysConfigured()) {
    return { ok: true, ctx: { role: 'admin', actor: 'dev:local' } };
  }
  const ctx = getAuthContext(request);
  if (!ctx.role) {
    return { ok: false, status: 401, error: 'API key required', ctx };
  }
  if (!roleMeets(ctx.role, minRole)) {
    return { ok: false, status: 403, error: 'Forbidden', ctx };
  }
  return { ok: true, ctx };
}
