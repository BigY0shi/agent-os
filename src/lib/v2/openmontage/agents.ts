// Is this CLI agent on the box? lib/config.ts resolves the bins at server start;
// an id it does not know is simply "not installed", never a throw.
import { isAgentInstalled } from "@/lib/config";

export function agentInstalled(agent: string): boolean {
  try { return isAgentInstalled(agent as Parameters<typeof isAgentInstalled>[0]); } catch { return false; }
}
