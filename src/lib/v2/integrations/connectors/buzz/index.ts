import type { AccountCreate, ConnectorModule, SetupInput, ToolResult } from "../../types";
import { bridge } from "./bridge";
import { buzzSpec } from "./spec";
import { getBuzzTools, callBuzzTool } from "./tools";
import { buzzSync } from "./sync";

/**
 * SPEC-D G3.7 — the Buzz connector module. LOCAL auth: setup() takes no
 * fields; it verifies the bridge (buzz.exe + ~/.agentic-os/buzz.env) exists
 * and identifies the account by the bridge's public key. The private key
 * stays where it already lives (buzz.env, read by buzzBridge server-side) —
 * the sealed account config deliberately stores NO secret.
 */

async function setup(_input: SetupInput): Promise<AccountCreate> {
  const b = bridge();
  if (!b.buzzAvailable()) {
    // Plain Error → the /connect route's 422 with this text (connector-side
    // validation failure, not a caller contract violation).
    throw new Error(
      "Buzz bridge isn't configured — needs buzz.exe installed and ~/.agentic-os/buzz.env with BUZZ_PRIVATE_KEY.",
    );
  }
  const pubkey = b.bridgePubkey();
  return {
    accountId: pubkey || "buzz-bridge",
    displayName: `Buzz (bridge ${pubkey ? pubkey.slice(0, 8) : "local"})`,
    config: {}, // key stays in buzz.env — nothing to seal
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return callBuzzTool(name, args);
}

export const buzzConnector: ConnectorModule = {
  spec: buzzSpec,
  setup,
  getTools: getBuzzTools,
  callTool,
  sync: buzzSync,
};
