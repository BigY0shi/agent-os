import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

const TIMEOUT_MS = 6000;

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [opts]
 */
async function openclawFetch(baseUrl, path, opts = {}) {
  if (!baseUrl) return { ok: false, configured: false, error: 'not configured' };
  const base = baseUrl.replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const auth = process.env.AGENT_OS_OPENCLAW_API_KEY?.trim();
  const headers = {
    Accept: 'application/json',
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    ...(opts.headers || {}),
  };
  if (opts.body) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    }
    return { ok: res.ok, status: res.status, data, url, configured: true };
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      configured: true,
      error: e.name === 'AbortError' ? 'timeout' : e.message,
      url,
    };
  }
}

export async function openclawHealth() {
  const ep = getRuntimeEndpoints();
  if (!ep.openclaw) {
    return { configured: false, ok: false };
  }
  const started = Date.now();
  for (const path of ['/health', '/api/health', '/']) {
    const res = await openclawFetch(ep.openclaw, path);
    if (res.ok) {
      return {
        configured: true,
        ok: true,
        status: res.status,
        path,
        url: ep.openclaw,
        latencyMs: Date.now() - started,
      };
    }
  }
  return {
    configured: true,
    ok: false,
    url: ep.openclaw,
    latencyMs: Date.now() - started,
    error: 'unreachable',
  };
}

/** Best-effort list agents/sessions from OpenClaw gateway. */
export async function openclawListAgents() {
  const ep = getRuntimeEndpoints();
  for (const path of ['/api/agents', '/agents', '/api/sessions']) {
    const res = await openclawFetch(ep.openclaw, path);
    if (res.ok && res.data) {
      const items = Array.isArray(res.data)
        ? res.data
        : res.data.items || res.data.agents || res.data.sessions || [];
      return { ...res, items };
    }
  }
  return { ok: false, items: [], error: 'no agent list endpoint' };
}
