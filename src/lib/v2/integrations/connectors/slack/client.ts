/**
 * SPEC-D G3.6 — the Slack Web API client. Every method is a form-encoded POST
 * to https://slack.com/api/<method> with the bot token as a Bearer header
 * (form encoding works for EVERY Web API method; JSON is only accepted by
 * some). Slack's failure mode is HTTP 200 + {ok:false, error} — slackApi
 * throws Error(<slack error>) on that so the runtime's SOFT path renders
 * `Error: <slack error>`.
 *
 * TEST SEAM (googleClient precedent): __setSlackMockForTests swaps the
 * transport; smoke-connectors-wave1 drives auth.test / history / post offline.
 */

export type SlackTransport = (
  method: string,
  payload: Record<string, unknown>,
  token: string,
) => Promise<Record<string, unknown>>;

let mockTransport: SlackTransport | null = null;

/** Test-only: inject a fake transport (null to clear). */
export function __setSlackMockForTests(t: SlackTransport | null): void {
  mockTransport = t;
}

async function defaultTransport(
  method: string,
  payload: Record<string, unknown>,
  token: string,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Slack ${method} returned non-JSON (HTTP ${res.status})`);
  }
}

/** One Slack Web API call; throws Error(<slack error>) when ok !== true. */
export async function slackApi<T extends Record<string, unknown> = Record<string, unknown>>(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const transport = mockTransport ?? defaultTransport;
  const data = await transport(method, payload, token);
  if (data.ok !== true) {
    throw new Error(String(data.error ?? `Slack ${method} failed`));
  }
  return data as T;
}
