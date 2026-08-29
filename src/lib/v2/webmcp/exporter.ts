import path from "node:path";
import fs from "node:fs";
import { webmcpDir } from "./secrets";
import { getPackage, getPublishedSnapshot, WebmcpError, type SnapshotTool, type WebmcpSnapshot } from "./store";
import { CONFIG_NAME_RE, type SpecConfigField, type WebmcpSpec } from "./types";

/**
 * SPEC-C D5.1 — standalone package exporter (client-onboarding mode).
 *
 * exportPackage(slug, {mode}) generates
 *   <exportRoot>/<slug>/{index.mjs, package.json, README.md}
 * from the CURRENT PUBLISHED SNAPSHOT (never drafts; loud 409 if the package
 * has never been published). The generated index.mjs implements the upstream
 * integration contract (run(IntegrationEventPayload) switch over
 * SPEC/GET_TOOLS/CALL_TOOL) plus an IntegrationCLI-shaped subcommand entry
 * (spec / get-tools / call-tool, NDJSON Message lines to stdout) so
 * `node index.mjs get-tools --config {}` works with zero dependencies.
 *
 * Handler lanes in the export:
 *  - 'http'     → the {{arg:*}} / secret-ref template interpolation is inlined
 *                 self-contained in the file;
 *  - 'js'       → the authored code is inlined as a real async function;
 *  - 'internal' → a stub that throws "internal actions are not exportable"
 *                 (README lists the stubbed tools).
 *
 * Secrets: VALUES ARE NEVER EMBEDDED in either mode — this module never even
 * reads the secrets file. The export resolves credentials from its --config
 * JSON at runtime:
 *  - mode 'internal': handler templates keep their {{secret:NAME}} refs and
 *    resolve NAME from --config;
 *  - mode 'client':   every {{secret:NAME}} ref is rewritten to a
 *    ${config:NAME} placeholder and the config manifest (spec_json manifest
 *    fields + every secret name referenced by handlers) is emitted into the
 *    export's spec + README.
 *
 * Export root: <webmcpDir()>/exports (i.e. ~/.agentic-os/webmcp/exports, and
 * automatically redirected wherever AGENTIC_OS_WEBMCP_DIR points during smoke
 * runs) — or an explicit opts.exportRoot. An existing export dir is EXILED to
 * <exportRoot>/.exile/<stamp>-<slug>/ before writing (never deleted).
 */

export type ExportMode = "internal" | "client";
export const EXPORT_MODES: readonly ExportMode[] = ["internal", "client"] as const;

export interface ExportResult {
  path: string;
  mode: ExportMode;
  version: number;
  files: string[];
  /** internal-handler tools emitted as throwing stubs. */
  stubbedTools: string[];
  /** config keys the export expects at runtime (manifest ∪ referenced secrets). */
  configNames: string[];
  /** where a pre-existing export dir was moved, if any. */
  exiledPrevious?: string;
}

const SECRET_REF_RE = /\{\{\s*secret:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function defaultExportRoot(): string {
  return path.join(webmcpDir(), "exports");
}

/** Every secret NAME referenced by the snapshot's http/js handler configs. */
function referencedSecretNames(tools: SnapshotTool[]): string[] {
  const names = new Set<string>();
  for (const t of tools) {
    const serialized = JSON.stringify(t.handlerConfig ?? {});
    for (const m of serialized.matchAll(SECRET_REF_RE)) names.add(m[1]);
  }
  return [...names].sort();
}

/** Build the merged config manifest: spec fields first, then bare referenced secrets. */
function buildConfigManifest(spec: WebmcpSpec | null, tools: SnapshotTool[]): SpecConfigField[] {
  const manifest: SpecConfigField[] = [];
  const seen = new Set<string>();
  for (const f of spec?.configManifest ?? []) {
    if (!CONFIG_NAME_RE.test(f.name) || seen.has(f.name)) continue;
    seen.add(f.name);
    manifest.push({ name: f.name, description: f.description, required: f.required });
  }
  for (const name of referencedSecretNames(tools)) {
    if (seen.has(name)) continue;
    seen.add(name);
    manifest.push({ name, description: "Secret referenced by a tool handler.", required: true });
  }
  return manifest;
}

/** mode 'client': rewrite {{secret:NAME}} → ${config:NAME} in a handler config. */
function clientizeHandlerConfig(config: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(config ?? {});
  // Replacement text contains no JSON-significant characters — safe on the wire form.
  const rewritten = serialized.replace(SECRET_REF_RE, (_m, name: string) => "${config:" + name + "}");
  return JSON.parse(rewritten) as Record<string, unknown>;
}

/** Compile-check authored js code so we never emit a syntactically broken export. */
function assertJsCompiles(toolName: string, code: string): void {
  try {
    // AsyncFunction ctor — the export inlines the code as an async fn body.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => unknown;
    new AsyncFunction("args", "console", code);
  } catch (err) {
    throw new WebmcpError(
      `tool '${toolName}': js handler code does not compile — fix it and republish before exporting (${err instanceof Error ? err.message : String(err)})`,
      400,
    );
  }
}

// ---------------------------------------------------------------------------
// index.mjs generation
// ---------------------------------------------------------------------------

function generateIndexMjs(
  snapshot: WebmcpSnapshot,
  mode: ExportMode,
  manifest: SpecConfigField[],
): string {
  const pkg = snapshot.package;
  const spec = pkg.spec ?? null;
  const specConst = {
    name: pkg.name,
    key: pkg.slug,
    description: pkg.description,
    icon: pkg.icon,
    version: pkg.version,
    mode,
    authKind: spec?.authKind ?? "none",
    schedule: spec?.schedule ?? undefined,
    mcpType: spec?.mcpType ?? "stdio",
    configManifest: manifest,
  };

  const toolConsts = snapshot.tools.map((t) => {
    const handlerConfig =
      t.handlerKind === "js"
        ? { timeoutMs: (t.handlerConfig as { timeoutMs?: number }).timeoutMs } // code lives in JS_HANDLERS
        : mode === "client"
          ? clientizeHandlerConfig(t.handlerConfig)
          : t.handlerConfig;
    return {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      requiresApproval: t.requiresApproval,
      handlerKind: t.handlerKind,
      handlerConfig,
    };
  });

  const jsHandlerEntries = snapshot.tools
    .filter((t) => t.handlerKind === "js")
    .map((t) => {
      const code = String((t.handlerConfig as { code?: string }).code ?? "");
      assertJsCompiles(t.name, code);
      return `  ${JSON.stringify(t.name)}: async (args) => { "use strict";\n${code}\n  },`;
    })
    .join("\n");

  const header = [
    `#!/usr/bin/env node`,
    `// Generated by Agent OS WebMCP exporter — package '${pkg.slug}' v${pkg.version}, mode '${mode}'.`,
    `// Self-contained (no dependencies). Implements the integration contract:`,
    `//   run(eventPayload) over SPEC / GET_TOOLS / CALL_TOOL, and the CLI entry`,
    `//   spec | get-tools | call-tool (NDJSON Message lines on stdout).`,
    `// Credentials are NEVER embedded: pass them at runtime via --config '{"NAME":"value"}'.`,
    ``,
  ].join("\n");

  // NOTE: the runtime body is a raw string (no template interpolation) so the
  // generated file can contain \${config:NAME} and {{secret:NAME}} literals safely.
  const runtime = String.raw`
const SPEC = __SPEC__;
const TOOLS = __TOOLS__;
const MODE = __MODE__;

const JS_HANDLERS = {
__JS_HANDLERS__
};

// ── placeholder interpolation (self-contained) ──────────────────────────────
// {{arg:x}} / {{args.x}}  → tool-call arguments
// {{secret:NAME}}         → --config (mode 'internal')
// ${"$"}{config:NAME}          → --config (mode 'client')
const ARG_RE = /\{\{\s*args?[.:]([A-Za-z0-9_]+)\s*\}\}/g;
const SECRET_RE = /\{\{\s*secret:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const CONFIG_RE = /\$\{\s*config:([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;

function interpolate(template, args, config) {
  const fromConfig = (name) => {
    const v = config?.[name];
    if (v === undefined) {
      throw new Error(
        "config value '" + name + "' is missing — pass it via --config '{\"" + name + "\":\"...\"}'",
      );
    }
    return String(v);
  };
  return template
    .replace(SECRET_RE, (_m, name) => fromConfig(name))
    .replace(CONFIG_RE, (_m, name) => fromConfig(name))
    .replace(ARG_RE, (_m, name) => {
      const v = args?.[name];
      return v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    });
}

function interpolateDeep(value, args, config) {
  if (typeof value === "string") return interpolate(value, args, config);
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, args, config));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateDeep(v, args, config);
    return out;
  }
  return value;
}

// ── handler dispatch ────────────────────────────────────────────────────────

async function callHttp(tool, args, config) {
  const cfg = tool.handlerConfig ?? {};
  if (!cfg.url) throw new Error("http handler has no url");
  const url = interpolate(cfg.url, args, config);
  const method = (cfg.method ?? "GET").toUpperCase();
  const headers = {};
  for (const [k, v] of Object.entries(cfg.headers ?? {})) {
    headers[k] = interpolate(String(v), args, config);
  }
  let body;
  if (cfg.bodyTemplate !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof cfg.bodyTemplate === "string") {
      body = interpolate(cfg.bodyTemplate, args, config);
    } else {
      body = JSON.stringify(interpolateDeep(cfg.bodyTemplate, args, config));
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
        headers["content-type"] = "application/json";
      }
    }
  }
  const timeoutMs = typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0 ? cfg.timeoutMs : 15000;
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText + ": " + text.slice(0, 1024));
  return text;
}

async function callTool(name, args, config) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error("unknown tool '" + name + "' (see get-tools)");
  switch (tool.handlerKind) {
    case "http":
      return await callHttp(tool, args ?? {}, config ?? {});
    case "js": {
      const fn = JS_HANDLERS[name];
      if (!fn) throw new Error("js handler for '" + name + "' is missing from this export");
      const value = await fn(Object.freeze(structuredClone(args ?? {})));
      return value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    }
    case "internal":
      throw new Error(
        "internal actions are not exportable — tool '" +
          name +
          "' is a stub in this export (it calls an Agent OS internal action and only runs inside Agent OS)",
      );
    default:
      throw new Error("unknown handler kind '" + tool.handlerKind + "'");
  }
}

// ── run(eventPayload) — the upstream integration contract ───────────────────

export async function run(eventPayload) {
  switch (eventPayload.event) {
    case "spec":
      return [{ type: "spec", data: SPEC }];
    case "get-tools":
      return [
        {
          type: "tools",
          data: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            requiresApproval: t.requiresApproval,
          })),
        },
      ];
    case "call-tool": {
      const { name, arguments: args } = eventPayload.eventBody ?? {};
      const text = await callTool(name, args, eventPayload.config);
      return [{ type: "tool_result", data: { content: [{ type: "text", text }], isError: false } }];
    }
    default:
      return [{ type: "error", data: { message: "unsupported event '" + eventPayload.event + "'" } }];
  }
}

// ── IntegrationCLI-shaped entry (spec | get-tools | call-tool) ──────────────

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      flags[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    }
  }
  return flags;
}

function parseJsonFlag(flags, key, fallback) {
  const raw = flags[key];
  if (raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("--" + key + " is not valid JSON");
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  let payload;
  switch (command) {
    case "spec":
      payload = { event: "spec", eventBody: {} };
      break;
    case "get-tools":
      payload = { event: "get-tools", eventBody: {}, config: parseJsonFlag(flags, "config", {}) };
      break;
    case "call-tool":
      payload = {
        event: "call-tool",
        eventBody: {
          name: flags["tool-name"] ?? "",
          arguments: parseJsonFlag(flags, "tool-arguments", {}),
        },
        config: parseJsonFlag(flags, "config", {}),
      };
      break;
    default:
      console.error(
        "usage: node index.mjs <spec|get-tools|call-tool> [--config '{}'] [--tool-name <name>] [--tool-arguments '{}']",
      );
      process.exit(2);
  }
  try {
    const messages = await run(payload);
    for (const message of messages) console.log(JSON.stringify(message)); // NDJSON
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ type: "error", data: { message } }));
    process.exit(1);
  }
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
`;

  // Replacer FUNCTIONS: the injected JSON may contain '$' sequences ($&, $' …)
  // that a string replacement would mangle (client-mode ${config:*} refs!).
  return (
    header +
    runtime
      .replace("__SPEC__", () => JSON.stringify(specConst, null, 2))
      .replace("__TOOLS__", () => JSON.stringify(toolConsts, null, 2))
      .replace("__MODE__", () => JSON.stringify(mode))
      .replace("__JS_HANDLERS__", () => jsHandlerEntries)
  );
}

// ---------------------------------------------------------------------------
// README.md + package.json generation
// ---------------------------------------------------------------------------

function generateReadme(
  snapshot: WebmcpSnapshot,
  mode: ExportMode,
  manifest: SpecConfigField[],
  stubbedTools: string[],
): string {
  const pkg = snapshot.package;
  const lines: string[] = [
    `# webmcp-${pkg.slug}`,
    ``,
    pkg.description || `Exported Agent OS WebMCP package '${pkg.slug}'.`,
    ``,
    `- Exported from published snapshot **v${pkg.version}** in **${mode}** mode.`,
    `- Self-contained ESM — no npm install needed; requires Node 18+.`,
    `- Credential values are **never embedded** in this export. Everything the`,
    `  package needs at runtime is passed via \`--config\` JSON.`,
    ``,
    `## Usage`,
    ``,
    "```sh",
    `node index.mjs spec`,
    `node index.mjs get-tools --config '{}'`,
    `node index.mjs call-tool --config '{}' --tool-name <name> --tool-arguments '{"key":"value"}'`,
    "```",
    ``,
    `Output is NDJSON: one \`{ "type": ..., "data": ... }\` message per line`,
    `(types: spec | tools | tool_result | error). The module also exports`,
    `\`run(eventPayload)\` implementing the integration event contract`,
    `(events: spec, get-tools, call-tool).`,
    ``,
  ];

  lines.push(`## Config`);
  lines.push(``);
  if (manifest.length === 0) {
    lines.push(`This package needs no config values — pass \`--config '{}'\`.`);
  } else {
    if (mode === "client") {
      lines.push(
        `Handler templates reference these values as \`\${config:NAME}\` placeholders,`,
        `resolved at runtime from \`--config\`:`,
      );
    } else {
      lines.push(
        `Handler templates keep their \`{{secret:NAME}}\` references; the export`,
        `resolves each NAME from \`--config\` at runtime:`,
      );
    }
    lines.push(``, `| Name | Required | Description |`, `|---|---|---|`);
    for (const f of manifest) {
      lines.push(`| \`${f.name}\` | ${f.required ? "yes" : "no"} | ${f.description ?? ""} |`);
    }
  }
  lines.push(``);

  lines.push(`## Tools`);
  lines.push(``);
  for (const t of snapshot.tools) {
    const stub = stubbedTools.includes(t.name) ? " — **STUB: not runnable in this export**" : "";
    lines.push(`- \`${t.name}\` (${t.handlerKind})${t.description ? ` — ${t.description}` : ""}${stub}`);
  }
  lines.push(``);
  if (stubbedTools.length > 0) {
    lines.push(
      `## Stubbed tools`,
      ``,
      `These tools use Agent OS **internal** actions and are not exportable —`,
      `calling them throws \`internal actions are not exportable\`:`,
      ``,
      ...stubbedTools.map((n) => `- \`${n}\``),
      ``,
    );
  }
  return lines.join("\n");
}

function generatePackageJson(snapshot: WebmcpSnapshot): string {
  return (
    JSON.stringify(
      {
        name: `webmcp-${snapshot.package.slug}`,
        // Published versions are integers (chunk-2 decision); npm needs semver → vN ⇒ N.0.0.
        version: `${snapshot.package.version}.0.0`,
        description: snapshot.package.description || undefined,
        type: "module",
        private: true,
        main: "index.mjs",
      },
      null,
      2,
    ) + "\n"
  );
}

// ---------------------------------------------------------------------------
// exportPackage
// ---------------------------------------------------------------------------

export interface ExportOptions {
  mode: ExportMode;
  /** Override the export root (tests). Default <webmcpDir()>/exports. */
  exportRoot?: string;
}

export function exportPackage(idOrSlug: string, opts: ExportOptions): ExportResult {
  if (!EXPORT_MODES.includes(opts.mode)) {
    throw new WebmcpError(`unknown export mode '${String(opts.mode)}' (expected 'internal' | 'client')`, 400);
  }
  const pkg = getPackage(idOrSlug);
  if (!pkg) throw new WebmcpError("package not found", 404);
  if (pkg.status === "archived") {
    throw new WebmcpError("archived packages are read-only and cannot be exported", 409);
  }
  const snapshot = getPublishedSnapshot(pkg.slug);
  if (!snapshot) {
    throw new WebmcpError(
      `package '${pkg.slug}' has never been published — publish first (exports come from the published snapshot, never drafts)`,
      409,
    );
  }

  const manifest = buildConfigManifest(snapshot.package.spec ?? pkg.spec, snapshot.tools);
  const stubbedTools = snapshot.tools.filter((t) => t.handlerKind === "internal").map((t) => t.name);

  const indexMjs = generateIndexMjs(snapshot, opts.mode, manifest);
  const readme = generateReadme(snapshot, opts.mode, manifest, stubbedTools);
  const packageJson = generatePackageJson(snapshot);

  const exportRoot = opts.exportRoot?.trim() || defaultExportRoot();
  const dir = path.join(exportRoot, pkg.slug);
  let exiledPrevious: string | undefined;
  if (fs.existsSync(dir)) {
    // Exile-never-delete: move the previous export aside before writing.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const exileDir = path.join(exportRoot, ".exile");
    fs.mkdirSync(exileDir, { recursive: true });
    exiledPrevious = path.join(exileDir, `${stamp}-${pkg.slug}`);
    fs.renameSync(dir, exiledPrevious);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.mjs"), indexMjs, "utf8");
  fs.writeFileSync(path.join(dir, "package.json"), packageJson, "utf8");
  fs.writeFileSync(path.join(dir, "README.md"), readme, "utf8");

  return {
    path: dir,
    mode: opts.mode,
    version: snapshot.package.version,
    files: ["index.mjs", "package.json", "README.md"],
    stubbedTools,
    configNames: manifest.map((f) => f.name),
    exiledPrevious,
  };
}
