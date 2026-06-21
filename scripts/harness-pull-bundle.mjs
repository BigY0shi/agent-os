#!/usr/bin/env node
/**
 * Pull Agent OS harness bundle and write to disk (run on Hermes/OpenClaw LXC).
 *
 *   AGENT_OS_URL=http://192.168.0.x:3000 \
 *   AGENT_OS_API_KEY=optional-token \
 *   node scripts/harness-pull-bundle.mjs --out ~/.hermes/agent-os-bundle
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const agentIdx = args.indexOf('--agent-id');
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(process.env.HOME || '.', '.hermes', 'agent-os-bundle');
const agentId = agentIdx >= 0 ? args[agentIdx + 1] : null;

const base = (process.env.AGENT_OS_URL || 'http://localhost:3000').replace(/\/$/, '');
const token = process.env.AGENT_OS_API_KEY || process.env.AGENT_OS_API_TOKEN;

async function main() {
  const params = new URLSearchParams();
  if (agentId) params.set('agent_id', agentId);

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${base}/api/harness/bundle?${params.toString()}`;
  console.log(`Fetching ${url}`);

  const res = await fetch(url, { headers });
  const data = await res.json();
  if (!res.ok) {
    console.error('Pull failed:', data.error || res.status);
    process.exit(1);
  }

  const files = data.files || {};
  fs.mkdirSync(outDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const dest = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, 'utf8');
    console.log('  wrote', relPath);
  }

  console.log(`Bundle v${data.manifest?.version} → ${outDir} (${Object.keys(files).length} files)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
