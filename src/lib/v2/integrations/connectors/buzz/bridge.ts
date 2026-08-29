import * as realBridge from "../../../../buzzBridge";
import type { BuzzChannel, BuzzMessage } from "../../../../buzzBridge";

/**
 * SPEC-D G3.7 — the Buzz bridge seam. The connector NEVER talks to buzz.exe /
 * the Nostr relay directly: everything goes through this injectable facade over
 * the existing src/lib/buzzBridge.ts (chunk-3 brief: "tools wrapping buzzBridge
 * post/read/list"). __setBuzzBridgeForTests swaps the whole surface so
 * smoke-connectors-wave1 runs offline against a stub — never the real relay.
 */

export interface BuzzBridgeLike {
  buzzAvailable(): boolean;
  bridgePubkey(): string;
  listChannels(): Promise<BuzzChannel[]>;
  resolveChannel(nameOrId?: string): Promise<string>;
  sendMessage(channel: string, content: string): Promise<{ eventId: string }>;
  getMessages(
    channel: string,
    opts?: { since?: number; limit?: number },
  ): Promise<BuzzMessage[]>;
  displayNames(): Promise<Map<string, string>>;
}

let mock: BuzzBridgeLike | null = null;

/** Test-only: inject a stub bridge (null to clear). */
export function __setBuzzBridgeForTests(m: BuzzBridgeLike | null): void {
  mock = m;
}

export function bridge(): BuzzBridgeLike {
  return mock ?? (realBridge as BuzzBridgeLike);
}

export type { BuzzChannel, BuzzMessage };
