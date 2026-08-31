// AgentMail credential firewall — the same shape as the newsletter's addy
// config (SPEC-F K1.1), for the same reason.
//
// This module is the ONLY reader of ~/.agentic-os/agentmail/config.json and it
// never hands key material to a caller. Routes, UI and smokes get booleans
// (`agentmailConfigured()`) and non-secret strings (the inbox address, the
// config path). The key leaves exactly once, inside the Authorization header
// that `agentmailFetch()` builds. There is no getter for it, so no route can
// leak one.
//
// The inbox was claimed 2026-08-31 (launchworks@agentmail.to). Sending is no
// longer restricted to one recipient, which is precisely why the firewall
// matters more than it did while the account could only mail its owner.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The one host the key may ever travel to. Enforced in code, not just docs. */
export const AGENTMAIL_HOST = "api.agentmail.to";
export const AGENTMAIL_BASE = `https://${AGENTMAIL_HOST}/v0`;

/** Test override, mirroring AGENTIC_OS_NEWSLETTER_DIR. */
export function agentmailDir(): string {
  const override = process.env.AGENTIC_OS_AGENTMAIL_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "agentmail");
}

/** Safe to render in the UI ("key missing at <path>"). */
export function configPath(): string {
  return path.join(agentmailDir(), "config.json");
}

interface AgentMailConfigFile {
  api_key?: string;
  inbox_id?: string;
  organization_id?: string;
  [k: string]: unknown;
}

/**
 * PRIVATE — never exported.
 *
 * Tolerates a UTF-8 BOM: PowerShell's `Set-Content -Encoding utf8` writes one,
 * which is not legal JSON. The file is written by a human at a shell, so
 * assuming a clean byte stream would be optimistic.
 */
function readConfigFile(): AgentMailConfigFile {
  const file = configPath();
  try {
    if (!fs.existsSync(file)) return {};
    let raw = fs.readFileSync(file, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as AgentMailConfigFile;
  } catch (err) {
    // Loud, but never fatal: callers see agentmailConfigured() === false.
    console.error(
      `[agentmail/config] could not read ${file}:`,
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

export function agentmailConfigured(): boolean {
  const c = readConfigFile();
  return Boolean(c.api_key?.trim() && c.inbox_id?.trim());
}

/** The inbox ADDRESS — not a secret; it is the from-address on every send. */
export function agentmailInbox(): string {
  return readConfigFile().inbox_id?.trim() ?? "";
}

export class AgentMailError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AgentMailError";
  }
}

type Transport = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;
let transportForTests: Transport | null = null;

/** Smokes swap the transport so no test ever reaches the network. */
export function __setAgentMailTransportForTests(t: Transport | null): void {
  transportForTests = t;
}

/**
 * The ONLY place the API key is read, and the only place it is sent.
 *
 * The host assertion is deliberate belt-and-braces: agentmail's own
 * instructions say "never send your API key to any domain other than
 * api.agentmail.to", but instructions in a document are not enforcement. A
 * caller that passes a full URL elsewhere throws before any header is built.
 */
export async function agentmailFetch(
  endpoint: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const c = readConfigFile();
  const key = c.api_key?.trim();
  if (!key || !c.inbox_id?.trim()) {
    throw new AgentMailError(`agentmail is not configured — add api_key + inbox_id to ${configPath()}`, 412);
  }

  const url = endpoint.startsWith("http") ? endpoint : `${AGENTMAIL_BASE}${endpoint}`;
  if (new URL(url).host !== AGENTMAIL_HOST) {
    throw new AgentMailError(`refusing to send credentials to ${new URL(url).host}`, 400);
  }

  const method = init.method ?? "GET";
  const send = transportForTests ?? ((u, i) => fetch(u, i as RequestInit));
  const res = await send(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    // Verbatim snippet, like the addy client: "agentmail: 401 …" tells you
    // exactly what to fix. The key is never in the request echo.
    throw new AgentMailError(`agentmail: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`, res.status);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AgentMailError(`agentmail: unparseable response — ${text.slice(0, 200)}`, 502);
  }
}
