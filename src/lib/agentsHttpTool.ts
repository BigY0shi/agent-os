// Agents module — Phase 4: the direct-HTTP tier. Tasklet's highest-leverage
// integration path: a generic http_request tool + per-service markdown skill
// docs (skills/apis/*.md) that teach the agent how to call an API well.
//
// Secrets NEVER ride in prompts or transcripts: the agent writes
// {{secret:NAME}} placeholders in the url/headers/body and the server resolves
// them at request time from ~/.agentic-os/secrets.json (or process.env). The
// response the model sees never contains the resolved values.

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SECRETS_FILE = path.join(os.homedir(), ".agentic-os", "secrets.json");

async function readSecrets(): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(SECRETS_FILE, "utf8")) as Record<string, string>; }
  catch { return {}; }
}

const PLACEHOLDER = /\{\{secret:([A-Za-z0-9_.-]+)\}\}/g;

async function resolveSecrets(s: string): Promise<string> {
  if (!PLACEHOLDER.test(s)) return s;
  const secrets = await readSecrets();
  return s.replace(PLACEHOLDER, (_, name: string) => {
    const v = secrets[name] ?? process.env[name];
    if (v === undefined) throw new Error(`secret "${name}" not found in ${SECRETS_FILE} or env`);
    return v;
  });
}

/** URLs where a mutating call is functionally an outbound send / public post —
 *  the constitution treats these like any send tool, regardless of mode. */
export const SENSITIVE_HTTP_RE =
  /gmail\.googleapis\.com.*\/send|slack\.com\/api\/chat\.|api\.(twitter|x)\.com|graph\.facebook\.com|api\.linkedin\.com.*(share|post)|hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|api\.sendgrid\.com|api\.mailgun|api\.resend\.com|api\.stripe\.com/i;

export const HTTP_TOOL_NAME = "mcp__http__http_request";

export function makeHttpServer() {
  return createSdkMcpServer({
    name: "http",
    version: "1.0.0",
    tools: [
      tool(
        "http_request",
        "Call any HTTP API directly. Check ../skills/apis/*.md (relative to your workspace) for per-service instructions first. " +
        "Reference credentials as {{secret:NAME}} placeholders in url/headers/body — they resolve server-side and you never see the raw values.",
        {
          url: z.string().describe("Full URL, may contain {{secret:NAME}} placeholders"),
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
          headers: z.record(z.string(), z.string()).optional().describe("Header values may contain {{secret:NAME}}"),
          body: z.string().optional().describe("Raw request body (JSON string for JSON APIs), may contain {{secret:NAME}}"),
          timeoutMs: z.number().max(60_000).optional(),
        },
        async (args) => {
          try {
            const url = await resolveSecrets(args.url);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(args.headers ?? {})) headers[k] = await resolveSecrets(v);
            const body = args.body ? await resolveSecrets(args.body) : undefined;

            const res = await fetch(url, {
              method: args.method,
              headers,
              body: args.method === "GET" || args.method === "HEAD" ? undefined : body,
              signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
            });
            const text = (await res.text()).slice(0, 50_000);
            const ct = res.headers.get("content-type") ?? "";
            return { content: [{ type: "text" as const, text: `HTTP ${res.status} ${res.statusText} (${ct})\n\n${text}` }] };
          } catch (e) {
            return { content: [{ type: "text" as const, text: `REQUEST FAILED: ${String((e as Error)?.message || e)}` }], isError: true };
          }
        },
      ),
    ],
  });
}
