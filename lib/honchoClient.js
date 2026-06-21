import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

const TIMEOUT_MS = 8000;

/**
 * @param {string} path — e.g. /v3/workspaces/hermes/conclusions
 * @param {{ method?: string, body?: unknown, searchParams?: Record<string, string> }} [opts]
 */
export async function honchoFetch(path, opts = {}) {
  const ep = getRuntimeEndpoints();
  const base = ep.honcho.replace(/\/$/, '');
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (opts.searchParams) {
    Object.entries(opts.searchParams).forEach(([k, v]) => {
      if (v != null && v !== '') url.searchParams.set(k, v);
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${ep.honchoApiKey}`,
    };
    if (opts.body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url.toString(), {
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
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    return { ok: res.ok, status: res.status, data, url: url.toString() };
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      status: null,
      error: e.name === 'AbortError' ? 'timeout' : e.message,
      url: url.toString(),
    };
  }
}

export async function honchoHealth() {
  const ep = getRuntimeEndpoints();
  const started = Date.now();
  const health = await honchoFetch('/health');
  if (health.ok) {
    return {
      configured: true,
      ok: true,
      status: health.status,
      url: ep.honcho,
      latencyMs: Date.now() - started,
      authenticated: true,
    };
  }

  const root = await honchoFetch('/');
  return {
    configured: true,
    ok: root.ok,
    status: root.status,
    url: ep.honcho,
    latencyMs: Date.now() - started,
    authenticated: root.ok,
    error: health.error || (!root.ok ? 'unreachable' : undefined),
  };
}

export async function honchoListWorkspaces() {
  return honchoFetch('/v3/workspaces');
}

export async function honchoListPeers(workspaceId) {
  const ep = getRuntimeEndpoints();
  const ws = workspaceId || ep.honchoWorkspace;
  return honchoFetch(`/v3/workspaces/${encodeURIComponent(ws)}/peers`);
}

export async function honchoListConclusions(options = {}) {
  const ep = getRuntimeEndpoints();
  const ws = options.workspaceId || ep.honchoWorkspace;
  const params = {};
  if (options.observerId) params.observer_id = options.observerId;
  if (options.observedId) params.observed_id = options.observedId;
  if (options.limit) params.limit = String(options.limit);

  const res = await honchoFetch(
    `/v3/workspaces/${encodeURIComponent(ws)}/conclusions`,
    { searchParams: params }
  );

  if (!res.ok) return res;

  const items = Array.isArray(res.data)
    ? res.data
    : res.data?.items || res.data?.conclusions || [];

  return { ...res, items };
}

export async function honchoCreatePeer(peerId, options = {}) {
  const ep = getRuntimeEndpoints();
  const ws = options.workspaceId || ep.honchoWorkspace;
  const body = {
    id: peerId,
    metadata: options.metadata || { label: options.label || peerId, harness: options.harness },
  };
  return honchoFetch(`/v3/workspaces/${encodeURIComponent(ws)}/peers`, {
    method: 'POST',
    body,
  });
}

export async function honchoGetOrCreatePeer(peerId, options = {}) {
  const ep = getRuntimeEndpoints();
  const ws = options.workspaceId || ep.honchoWorkspace;
  const create = await honchoCreatePeer(peerId, options);
  if (create.ok) return create;

  const getRes = await honchoFetch(
    `/v3/workspaces/${encodeURIComponent(ws)}/peers/${encodeURIComponent(peerId)}`
  );
  if (getRes.ok) return getRes;

  return honchoFetch(`/v3/workspaces/${encodeURIComponent(ws)}/peers/get_or_create`, {
    method: 'POST',
    body: { id: peerId, metadata: options.metadata },
  });
}
