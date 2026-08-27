import { randomUUID } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

/** UTC ISO-8601 timestamp. The ONLY sanctioned timestamp format in agentos.db —
 *  lexical order == chronological order. Never store epoch ms in a column. */
export function now(): string {
  return new Date().toISOString();
}
