/**
 * SPEC-D G3.4 — the GitHub REST v3 client (pattern-only per §4: "we write lean
 * fetch-based tools against REST v3"; hand-rolled rather than httpJson because
 * the notifications sync needs response HEADERS (Last-Modified) and a 304
 * pass-through, which httpJson can't surface).
 *
 * TEST SEAM (googleClient precedent): __setGithubMockForTests swaps the
 * transport; smoke-connectors-wave1 asserts the If-Modified-Since header and
 * drives the 304 empty-run path offline.
 */

export const GITHUB_API = "https://api.github.com";

export interface GithubRequestShape {
  method: string;
  url: string; // full URL incl. query
  headers: Record<string, string>;
  body?: unknown;
}

export interface GithubResponseShape {
  status: number;
  headers: Record<string, string>; // lower-cased keys
  data: unknown;
}

export type GithubTransport = (req: GithubRequestShape) => Promise<GithubResponseShape>;

let mockTransport: GithubTransport | null = null;

/** Test-only: inject a fake transport (null to clear). */
export function __setGithubMockForTests(t: GithubTransport | null): void {
  mockTransport = t;
}

async function defaultTransport(req: GithubRequestShape): Promise<GithubResponseShape> {
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
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: res.status, headers, data };
}

function extractGithubError(status: number, data: unknown): string {
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return `${(data as { message: string }).message} (HTTP ${status})`;
  }
  return `GitHub API error (HTTP ${status})`;
}

/**
 * One GitHub REST v3 request. Throws Error(<message>) on any non-2xx UNLESS
 * the status is in `allowStatuses` (the notifications 304 path). Returns the
 * full {status, headers, data} so sync can read Last-Modified.
 */
export async function githubRequest(
  token: string,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    params?: Record<string, string | undefined>;
    headers?: Record<string, string>;
    allowStatuses?: number[];
  } = {},
): Promise<GithubResponseShape> {
  const url = new URL(GITHUB_API + path);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "agent-os-integrations", // GitHub REQUIRES a User-Agent
    ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(opts.headers ?? {}),
  };
  const transport = mockTransport ?? defaultTransport;
  const res = await transport({ method, url: url.toString(), headers, body: opts.body });
  const allowed = opts.allowStatuses ?? [];
  if ((res.status < 200 || res.status >= 300) && !allowed.includes(res.status)) {
    throw new Error(extractGithubError(res.status, res.data));
  }
  return res;
}
