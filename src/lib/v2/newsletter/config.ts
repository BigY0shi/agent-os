// SPEC-F K1.1 — the newsletter credential firewall.
//
// This module is the ONLY reader of ~/.agentic-os/newsletter/config.json, and
// it NEVER hands key material to a caller. Routes, the UI and the smokes get
// booleans (`addyConfigured()`, `gmailConfigured()`) and non-secret display
// strings (the base URL, the alias domain, the config path). The addy.io key
// leaves this module exactly once: inside the Authorization header that
// `addyFetch()` builds. There is no getter for it, so no route can leak one.
//
// CONVENTIONS §7 rewrites SPEC-F's K1 account story: there is ONE Gmail stack,
// SPEC-D's connector. The spec's `google` block here (clientId/clientSecret/
// refreshToken) and its parallel /api/newsletter/gmail/auth|callback pair are
// VOID. `gmailConfigured()` therefore asks the integrations store whether a
// usable gmail account exists — it does not read this file at all.
//
// CONVENTIONS §9.6: the key on disk transited chat and is worth rotating in the
// addy dashboard. Rotation is a one-file edit; nothing here caches it beyond a
// single call.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSettings } from "../../settings";
import { listAccounts } from "../integrations/store";

/** Test/smoke override, mirroring AGENTIC_OS_DB / AGENTIC_OS_ANYNOTES_DIR. */
export function newsletterDir(): string {
  const override = process.env.AGENTIC_OS_NEWSLETTER_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "newsletter");
}

/** The config path — safe to render in the UI ("key missing at <path>"). */
export function configPath(): string {
  return path.join(newsletterDir(), "config.json");
}

interface AddyBlock {
  baseUrl?: string;
  apiKey?: string;
  /** Alias domain (e.g. "yoshi.addy.io") — NOT a secret; used for the display hint. */
  domain?: string;
}

interface NewsletterConfigFile {
  addyio?: AddyBlock;
  // A `google` block may exist on disk from an earlier draft of the spec. It is
  // deliberately NOT typed or read here (CONVENTIONS §7 voids it).
  [k: string]: unknown;
}

/** Read + parse the config file. PRIVATE — never exported. */
function readConfigFile(): NewsletterConfigFile {
  const file = configPath();
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as NewsletterConfigFile;
  } catch (err) {
    // A malformed config is a LOUD condition, but it must not take a route
    // down: callers see `addyConfigured() === false` and the UI says so.
    console.error(
      `[newsletter/config] could not read ${file}:`,
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

const DEFAULT_ADDY_BASE = "https://app.addy.io/api/v1";

/** addy.io API base URL — non-secret, safe to display. */
export function addyBaseUrl(): string {
  const raw = readConfigFile().addyio?.baseUrl;
  const url = typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_ADDY_BASE;
  return url.replace(/\/+$/, "");
}

/**
 * The alias domain, for the Gmail addressing filter hint and the UI.
 * settings wins (rule 16: knobs live in the gear), config.json is the fallback.
 * Non-secret.
 */
export function addyDomain(): string {
  const fromSettings = readSettings().newsletter?.addyDomain;
  if (typeof fromSettings === "string" && fromSettings.trim()) return fromSettings.trim();
  const fromFile = readConfigFile().addyio?.domain;
  return typeof fromFile === "string" ? fromFile.trim() : "";
}

/** TRUE when an addy.io key is present. The value never leaves this module. */
export function addyConfigured(): boolean {
  const key = readConfigFile().addyio?.apiKey;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * TRUE when a usable Gmail account exists on SPEC-D's connector (CONVENTIONS
 * §7 — one Gmail stack). Honors `settings.newsletter.gmailAccountId` when set,
 * otherwise any active gmail account counts.
 */
export function gmailConfigured(): boolean {
  return newsletterGmailAccountId() !== null;
}

/**
 * Which integration account the newsletter syncs from. Explicit setting first
 * (rule 16), else the single active gmail account. Returns null when there is
 * none — the caller then fails LOUDLY rather than syncing from nowhere.
 */
export function newsletterGmailAccountId(): string | null {
  let accounts;
  try {
    accounts = listAccounts("gmail").filter((a) => a.isActive);
  } catch {
    // DB not open / migrations not run yet — "not configured" is the honest
    // answer, and it is what the status strip renders.
    return null;
  }
  const pinned = readSettings().newsletter?.gmailAccountId;
  if (typeof pinned === "string" && pinned.trim()) {
    const found = accounts.find((a) => a.id === pinned.trim());
    return found ? found.id : null;
  }
  return accounts.length > 0 ? accounts[0].id : null;
}

// ── the addy.io transport ────────────────────────────────────────────────────

export class AddyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AddyError";
    this.status = status;
  }
}

export type AddyTransport = (url: string, init: RequestInit) => Promise<Response>;

let transport: AddyTransport | null = null;

/**
 * Test seam: swap the outbound fetch for a stub so the smoke can exercise the
 * client (including its non-2xx error path) with ZERO live requests. Passing
 * null restores the real fetch.
 */
export function __setAddyTransportForTests(fn: AddyTransport | null): void {
  transport = fn;
}

/**
 * Authorized addy.io request. The key is injected HERE and nowhere else — it is
 * never returned, logged, or serialized. Non-2xx throws an AddyError carrying
 * the status and a body snippet (loud, per SPEC-F §5).
 */
export async function addyFetch(
  pathname: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  const key = readConfigFile().addyio?.apiKey;
  if (typeof key !== "string" || !key.trim()) {
    throw new AddyError(
      `addy.io is not configured — no addyio.apiKey at ${configPath()}`,
      412,
    );
  }
  const url = `${addyBaseUrl()}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const send = transport ?? fetch;
  const res = await send(url, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: {
      authorization: `Bearer ${key.trim()}`,
      "content-type": "application/json",
      accept: "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    // Body snippet only — an addy error body never echoes the key back, but the
    // slice keeps a surprise payload from flooding a log line either way.
    throw new AddyError(
      `addy.io: ${res.status} ${res.statusText || ""} ${text.slice(0, 300)}`.trim(),
      res.status,
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AddyError(`addy.io: ${res.status} response was not JSON: ${text.slice(0, 200)}`, res.status);
  }
}
