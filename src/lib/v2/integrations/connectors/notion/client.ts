/**
 * SPEC-D G3.3 — the Notion HTTP client (axios→fetch per §4: "axios client →
 * httpJson"; hand-rolled rather than the bare httpJson helper because the
 * upstream error-swallow shape needs the Notion error `message` field and the
 * offline smoke needs a transport seam).
 *
 * - Notion-Version header is a CONST on every request (chunk-3 handoff).
 * - Errors mirror upstream's `error.response?.data?.message || error.message`:
 *   a non-2xx response throws `new Error(<notion message>)`, which the
 *   runtime's SOFT path renders as `Error: <notion message>` — byte-equal to
 *   upstream's swallowed `Error: ...` tool text (decision 6 split preserved).
 *
 * TEST SEAM (googleClient precedent, chunk-2 handoff): __setNotionMockForTests
 * swaps the transport for a fake that receives {method, url, headers, body} —
 * smoke-connectors-wave1 asserts the Notion-Version header on every captured
 * request. Default transport is fetch.
 */

export const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";

export interface NotionRequestShape {
  method: string;
  url: string; // full URL incl. query
  headers: Record<string, string>;
  body?: unknown; // JSON-encodable
}

export type NotionTransport = (
  req: NotionRequestShape,
) => Promise<{ status: number; data: unknown }>;

let mockTransport: NotionTransport | null = null;

/** Test-only: inject a fake transport (null to clear). */
export function __setNotionMockForTests(t: NotionTransport | null): void {
  mockTransport = t;
}

function extractNotionError(status: number, data: unknown): string {
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  return `Notion API error (HTTP ${status})`;
}

async function defaultTransport(req: NotionRequestShape): Promise<{ status: number; data: unknown }> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/**
 * One Notion API request. `accessToken` comes from the account config
 * (`access_token`); path is relative to /v1. Throws Error(<message>) on any
 * non-2xx (upstream swallow shape — see header).
 */
export async function notionRequest<T = Record<string, unknown>>(
  accessToken: string,
  method: string,
  path: string,
  opts: { body?: unknown; params?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(NOTION_BASE + path);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "notion-version": NOTION_VERSION,
    accept: "application/json",
    ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
  };
  const transport = mockTransport ?? defaultTransport;
  const { status, data } = await transport({
    method,
    url: url.toString(),
    headers,
    body: opts.body,
  });
  if (status < 200 || status >= 300) {
    throw new Error(extractNotionError(status, data));
  }
  return data as T;
}
