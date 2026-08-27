// Client-safe capability types. NO node imports in this file.

export type SlotKey = "exec" | "coding" | "files" | "browser";
export type FolderScope = "files" | "coding" | "exec";

export interface SlotManifestEntry {
  key: SlotKey;
  enabled: boolean;
  description: string;
  actions: string[];
}

export interface SlotResult {
  ok: boolean;
  output: string;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface GateDecision {
  allowed: boolean;
  reason?: string;
}

/** strict = MCP/external path: empty allowlist ⇒ deny-all, zero folders ⇒ deny
 *  (CONVENTIONS §9.1). Non-strict = in-app UI callers (permissive first-run). */
export interface GateOptions {
  strict?: boolean;
}
