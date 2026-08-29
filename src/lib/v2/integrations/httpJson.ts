/**
 * SPEC-D §3.1 — tiny fetch wrapper replacing upstream's axios for connector
 * HTTP calls. JSON in/out, error → Error with status + response text (so the
 * runtime's soft-error path surfaces something readable). No retries, no
 * magic — connectors add their own semantics.
 */

export interface HttpJsonOptions {
  method?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  body?: unknown; // JSON-encoded unless a string is passed verbatim
  timeoutMs?: number; // default 30s
}

export async function httpJson<T = unknown>(
  url: string,
  opts: HttpJsonOptions = {},
): Promise<T> {
  const full = opts.baseUrl ? new URL(url, opts.baseUrl).toString() : url;
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(opts.body !== undefined && typeof opts.body !== "string"
      ? { "content-type": "application/json" }
      : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(full, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${opts.method ?? "GET"} ${full}: ${text.slice(0, 500)}`);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`HTTP ${res.status} ${full}: response is not JSON: ${text.slice(0, 200)}`);
  }
}
