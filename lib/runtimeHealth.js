import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

const PROBE_MS = 4000;

/**
 * @param {string} baseUrl
 * @param {string[]} paths
 */
export async function probeUrl(baseUrl, paths = ['/health', '/']) {
  if (!baseUrl) {
    return { configured: false, ok: false };
  }
  const base = baseUrl.replace(/\/$/, '');
  const started = Date.now();

  for (const path of paths) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      return {
        configured: true,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        path,
        url: base,
        latencyMs: Date.now() - started,
      };
    } catch {
      clearTimeout(timer);
    }
  }

  return {
    configured: true,
    ok: false,
    status: null,
    url: base,
    latencyMs: Date.now() - started,
    error: 'unreachable',
  };
}

/** @returns {Promise<Record<string, object>>} */
export async function checkRuntimes() {
  const ep = getRuntimeEndpoints();

  const [hermesWorkspace, hermesGateway, honcho, openclaw] = await Promise.all([
    probeUrl(ep.hermesUi, ['/']),
    probeUrl(ep.hermesGateway, ['/health', '/']),
    probeUrl(ep.honcho, ['/health']),
    ep.openclaw ? probeUrl(ep.openclaw, ['/health', '/']) : Promise.resolve({ configured: false, ok: false }),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    endpoints: ep,
    services: {
      hermesWorkspace: { id: 'hermes-workspace', label: 'Hermes Workspace', ...hermesWorkspace },
      hermesGateway: { id: 'hermes-gateway', label: 'Hermes Gateway', ...hermesGateway },
      honcho: { id: 'honcho', label: 'Honcho', ...honcho },
      openclaw: { id: 'openclaw', label: 'OpenClaw', ...openclaw },
    },
  };
}
