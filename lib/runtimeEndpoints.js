/**
 * Proxmox LXC runtime URLs — override via env on Pi/server deploy.
 */
export function getRuntimeEndpoints() {
  return {
    hermesUi:
      process.env.AGENT_OS_HERMES_UI_URL?.trim() || 'http://192.168.0.168:3000',
    hermesGateway:
      process.env.AGENT_OS_HERMES_GATEWAY_URL?.trim() ||
      'http://192.168.0.168:8642',
    honcho: process.env.AGENT_OS_HONCHO_URL?.trim() || 'http://192.168.0.99:8000',
    honchoApiKey:
      process.env.AGENT_OS_HONCHO_API_KEY?.trim() || 'local-dev',
    honchoWorkspace:
      process.env.AGENT_OS_HONCHO_WORKSPACE?.trim() || 'hermes',
    honchoUserPeer:
      process.env.AGENT_OS_HONCHO_USER_PEER?.trim() || 'yoshi',
    honchoAiPeer:
      process.env.AGENT_OS_HONCHO_AI_PEER?.trim() || 'hermes',
    openclaw: process.env.AGENT_OS_OPENCLAW_GATEWAY_URL?.trim() || '',
  };
}

/** @param {string} framework */
export function hermesUiUrlForAgent(framework) {
  const ep = getRuntimeEndpoints();
  if (framework === 'hermes-workspace' || framework === 'hermes-agent') {
    return ep.hermesUi;
  }
  return null;
}
