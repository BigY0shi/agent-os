import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

const PUSH_TIMEOUT_MS = 12000;

/** Gateway paths tried in order when pushing a bundle. */
const HERMES_PUSH_PATHS = [
  '/api/agent-os/bundle',
  '/agent-os/bundle',
  '/api/bundle',
  '/bundle',
];

const OPENCLAW_PUSH_PATHS = [
  '/api/agent-os/bundle',
  '/agent-os/bundle',
  '/api/bundle/import',
  '/bundle',
];

/**
 * @param {string} baseUrl
 * @param {string[]} paths
 * @param {object} payload
 * @param {{ headers?: Record<string, string> }} [opts]
 */
async function tryPushPaths(baseUrl, paths, payload, opts = {}) {
  if (!baseUrl) {
    return { ok: false, error: 'gateway not configured', attempts: [] };
  }

  const base = baseUrl.replace(/\/$/, '');
  const urlsToTry = [];
  if (opts.customPushUrl) urlsToTry.push(opts.customPushUrl);
  for (const path of paths) {
    urlsToTry.push(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  }

  const attempts = [];
  for (const url of urlsToTry) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      attempts.push({ url, status: res.status, ok: res.ok });
      if (res.ok || res.status === 201 || res.status === 204) {
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        return { ok: true, url, status: res.status, data, attempts };
      }
    } catch (e) {
      clearTimeout(timer);
      attempts.push({ url, error: e.name === 'AbortError' ? 'timeout' : e.message });
    }
  }

  return { ok: false, attempts, error: 'no gateway endpoint accepted bundle' };
}

/**
 * Push bundle JSON to Hermes or OpenClaw gateway (best-effort HTTP).
 * @param {{ manifest: object, files: Record<string, string> }} bundle
 * @param {'hermes'|'openclaw'} target
 */
export async function pushBundleToGateway(bundle, target = 'hermes') {
  const ep = getRuntimeEndpoints();
  const payload = {
    version: bundle.manifest?.version ?? 1,
    generated_at: bundle.manifest?.generated_at,
    source: 'agent-os-dashboard',
    manifest: bundle.manifest,
    files: bundle.files,
  };

  if (target === 'openclaw') {
    const auth = process.env.AGENT_OS_OPENCLAW_API_KEY?.trim();
    return tryPushPaths(
      ep.openclaw,
      OPENCLAW_PUSH_PATHS,
      payload,
      {
        customPushUrl: process.env.AGENT_OS_OPENCLAW_PUSH_URL?.trim() || null,
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      }
    );
  }

  const auth = process.env.AGENT_OS_HERMES_GATEWAY_TOKEN?.trim();
  return tryPushPaths(
    ep.hermesGateway,
    HERMES_PUSH_PATHS,
    payload,
    {
      customPushUrl: process.env.AGENT_OS_HERMES_PUSH_URL?.trim() || null,
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    }
  );
}

/** Operator rsync/scp hint when HTTP push is unavailable. */
export function buildDeployHints(target = 'hermes') {
  const ep = getRuntimeEndpoints();
  const host = target === 'openclaw'
    ? (ep.openclaw ? new URL(ep.openclaw).hostname : '<openclaw-ip>')
    : '192.168.0.168';

  const remotePath = target === 'openclaw'
    ? '~/.openclaw/agent-os-bundle/'
    : '~/.hermes/agent-os-bundle/';

  return {
    pullOnRuntime: `AGENT_OS_URL=http://<agent-os-host>:3000 node scripts/harness-pull-bundle.mjs --out ${remotePath.replace('~', '$HOME')}`,
    rsyncHint: `# export bundle JSON to ./bundle/ then:\nrsync -avz ./bundle/ user@${host}:${remotePath}`,
    cronExample: '*/5 * * * * AGENT_OS_URL=http://192.168.0.x:3000 node /opt/agent-os/scripts/harness-pull-bundle.mjs',
    targetHost: host,
    remotePath,
  };
}
