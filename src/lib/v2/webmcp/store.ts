import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { getDb, tx } from "../db";
import { uuid, now } from "../ids";
import { emit } from "../events";
import { registerAction, unregisterAction } from "../mcp/registry";
import { readSettings } from "../../settings";
import { validateInputSchema, assertObjectSchema, jsonSchemaToZod } from "./schema";
import { WebmcpSpecSchema, type WebmcpSpec } from "./types";

/**
 * SPEC-C D1/D2 — WebMCP package store.
 *
 * Model (draft-vs-published drift rule, SPEC-C §8.10):
 *  - webmcp_tools rows are the DRAFT WORKING SET, freely editable at any time
 *    (also while the package is published — those edits shape the NEXT publish);
 *  - published behavior comes ONLY from the frozen snapshot in
 *    webmcp_package_versions at current_version;
 *  - publish is the promotion gate: validate → snapshot → bump version →
 *    register each tool on the F4 Action registry as `<slug>/<toolName>`
 *    (CONVENTIONS §3); archive unregisters. Exact-advertised-tool-name
 *    invariant: the stored tool name IS the dispatched name — the only
 *    namespacing is the registry key's `<slug>/` prefix.
 */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const TOOL_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
export const HANDLER_KINDS = ["internal", "http", "js"] as const;
export type HandlerKind = (typeof HANDLER_KINDS)[number];
export type PackageStatus = "draft" | "published" | "archived";

export class WebmcpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Types + row mapping
// ---------------------------------------------------------------------------

export interface WebmcpPackage {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  status: PackageStatus;
  currentVersion: number;
  /** name → '{{secret:NAME}}' refs only — values live in the secrets file. */
  secretRefs: Record<string, string>;
  /** Spec-shaped metadata (migration 032); null until authored in the Spec tab. */
  spec: WebmcpSpec | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebmcpTool {
  id: string;
  packageId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handlerKind: HandlerKind;
  handlerConfig: Record<string, unknown>;
  requiresApproval: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handlerKind: HandlerKind;
  handlerConfig: Record<string, unknown>;
  requiresApproval: boolean;
  position: number;
}

export interface WebmcpSnapshot {
  package: {
    id: string;
    slug: string;
    name: string;
    description: string;
    icon: string;
    version: number;
    /** Frozen spec at publish time (absent on pre-032 snapshots). */
    spec?: WebmcpSpec | null;
  };
  tools: SnapshotTool[];
}

export interface PackageVersion {
  id: string;
  packageId: string;
  version: number;
  snapshot: WebmcpSnapshot;
  publishedAt: string;
}

interface PackageRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  status: string;
  current_version: number;
  secrets_json: string;
  spec_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ToolRow {
  id: string;
  package_id: string;
  name: string;
  description: string;
  input_schema_json: string;
  handler_kind: string;
  handler_config_json: string;
  requires_approval: number;
  position: number;
  created_at: string;
  updated_at: string;
}

function safeObj(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseSpec(specJson: string | null): WebmcpSpec | null {
  if (!specJson) return null;
  try {
    const parsed = WebmcpSpecSchema.safeParse(JSON.parse(specJson));
    return parsed.success ? (parsed.data as WebmcpSpec) : null;
  } catch {
    return null;
  }
}

function rowToPackage(r: PackageRow): WebmcpPackage {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    icon: r.icon,
    status: r.status as PackageStatus,
    currentVersion: r.current_version,
    secretRefs: safeObj(r.secrets_json) as Record<string, string>,
    spec: parseSpec(r.spec_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToTool(r: ToolRow): WebmcpTool {
  return {
    id: r.id,
    packageId: r.package_id,
    name: r.name,
    description: r.description,
    inputSchema: safeObj(r.input_schema_json),
    handlerKind: r.handler_kind as HandlerKind,
    handlerConfig: safeObj(r.handler_config_json),
    requiresApproval: r.requires_approval === 1,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function getPackageRow(idOrSlug: string): PackageRow | undefined {
  return getDb()
    .prepare("SELECT * FROM webmcp_packages WHERE id = ? OR slug = ?")
    .get(idOrSlug, idOrSlug) as PackageRow | undefined;
}

/** Accepts a package uuid OR slug (the routes' [id] segment takes either). */
export function getPackage(idOrSlug: string): WebmcpPackage | undefined {
  const row = getPackageRow(idOrSlug);
  return row ? rowToPackage(row) : undefined;
}

export function listPackages(): (WebmcpPackage & { toolCount: number })[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM webmcp_tools t WHERE t.package_id = p.id) AS tool_count
       FROM webmcp_packages p ORDER BY p.updated_at DESC`,
    )
    .all() as (PackageRow & { tool_count: number })[];
  return rows.map((r) => ({ ...rowToPackage(r), toolCount: r.tool_count }));
}

export function listTools(packageId: string): WebmcpTool[] {
  const rows = getDb()
    .prepare("SELECT * FROM webmcp_tools WHERE package_id = ? ORDER BY position, created_at")
    .all(packageId) as ToolRow[];
  return rows.map(rowToTool);
}

export function getTool(packageId: string, name: string): WebmcpTool | undefined {
  const row = getDb()
    .prepare("SELECT * FROM webmcp_tools WHERE package_id = ? AND name = ?")
    .get(packageId, name) as ToolRow | undefined;
  return row ? rowToTool(row) : undefined;
}

// ---------------------------------------------------------------------------
// Package CRUD
// ---------------------------------------------------------------------------

export interface CreatePackageInput {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
}

export function createPackage(input: CreatePackageInput): WebmcpPackage {
  const slug = String(input.slug ?? "").trim();
  if (!SLUG_RE.test(slug)) {
    throw new WebmcpError(`invalid slug '${slug}' (expected ${SLUG_RE.source})`);
  }
  if (getPackageRow(slug)) throw new WebmcpError(`slug '${slug}' is taken`, 409);
  const name = String(input.name ?? "").trim() || slug;
  const id = uuid();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO webmcp_packages(id, slug, name, description, icon, status, current_version, secrets_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', 0, '{}', ?, ?)`,
    )
    .run(id, slug, name, input.description ?? "", input.icon ?? "", ts, ts);
  return getPackage(id)!;
}

export interface UpdatePackageInput {
  name?: string;
  description?: string;
  icon?: string;
}

export function updatePackage(idOrSlug: string, patch: UpdatePackageInput): WebmcpPackage {
  const row = getPackageRow(idOrSlug);
  if (!row) throw new WebmcpError("package not found", 404);
  if (row.status === "archived") throw new WebmcpError("archived packages are read-only", 409);
  getDb()
    .prepare(
      "UPDATE webmcp_packages SET name = ?, description = ?, icon = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      typeof patch.name === "string" && patch.name.trim() ? patch.name.trim() : row.name,
      typeof patch.description === "string" ? patch.description : row.description,
      typeof patch.icon === "string" ? patch.icon : row.icon,
      now(),
      row.id,
    );
  return getPackage(row.id)!;
}

/** Record a secret NAME ref on the package row (value goes to the secrets file). */
export function recordSecretRef(idOrSlug: string, name: string): WebmcpPackage {
  const row = getPackageRow(idOrSlug);
  if (!row) throw new WebmcpError("package not found", 404);
  const refs = safeObj(row.secrets_json) as Record<string, string>;
  refs[name] = `{{secret:${name}}}`;
  getDb()
    .prepare("UPDATE webmcp_packages SET secrets_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(refs), now(), row.id);
  return getPackage(row.id)!;
}

/**
 * Write the package spec (spec_json, migration 032). `null` clears it.
 * Loudly validates against WebmcpSpecSchema — unknown keys / wrong types throw
 * a 400-shaped WebmcpError (the PATCH route surfaces the zod message verbatim).
 */
export function setPackageSpec(idOrSlug: string, spec: unknown): WebmcpPackage {
  const row = getPackageRow(idOrSlug);
  if (!row) throw new WebmcpError("package not found", 404);
  if (row.status === "archived") throw new WebmcpError("archived packages are read-only", 409);
  let specJson: string | null = null;
  if (spec !== null && spec !== undefined) {
    const parsed = WebmcpSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new WebmcpError(`invalid spec: ${parsed.error.message}`, 400);
    }
    specJson = JSON.stringify(parsed.data);
  }
  getDb()
    .prepare("UPDATE webmcp_packages SET spec_json = ?, updated_at = ? WHERE id = ?")
    .run(specJson, now(), row.id);
  return getPackage(row.id)!;
}

/**
 * Draft-only hard removal, exile-pattern: the full bundle (package + tools +
 * versions) is written to ~/.agentic-os/.exile/webmcp/ and VERIFIED on disk
 * before any row is touched. Published packages must be archived instead.
 */
export function deleteDraftPackage(idOrSlug: string): { exiledTo: string } {
  const row = getPackageRow(idOrSlug);
  if (!row) throw new WebmcpError("package not found", 404);
  if (row.status !== "draft") {
    throw new WebmcpError("only draft packages can be deleted — archive published packages instead", 409);
  }
  const bundle = {
    exiledAt: now(),
    package: row,
    tools: getDb().prepare("SELECT * FROM webmcp_tools WHERE package_id = ?").all(row.id),
    versions: getDb().prepare("SELECT * FROM webmcp_package_versions WHERE package_id = ?").all(row.id),
  };
  const dir = path.join(os.homedir(), ".agentic-os", ".exile", "webmcp");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now().slice(0, 19).replace(/[:T]/g, "-");
  const file = path.join(dir, `${stamp}-${row.slug}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2), "utf8");
  if (!fs.existsSync(file)) throw new WebmcpError("exile bundle write failed — aborting delete", 500);

  tx((db) => {
    db.prepare("DELETE FROM webmcp_package_versions WHERE package_id = ?").run(row.id);
    db.prepare("DELETE FROM webmcp_tools WHERE package_id = ?").run(row.id);
    db.prepare("DELETE FROM webmcp_packages WHERE id = ?").run(row.id);
  });
  return { exiledTo: file };
}

// ---------------------------------------------------------------------------
// Tool CRUD (the draft working set)
// ---------------------------------------------------------------------------

export interface ToolInput {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown> | string;
  handlerKind: HandlerKind;
  handlerConfig?: Record<string, unknown>;
  requiresApproval?: boolean;
  position?: number;
}

function normalizeSchema(inputSchema: ToolInput["inputSchema"]): string {
  if (inputSchema === undefined) return '{"type":"object","properties":{}}';
  const raw = typeof inputSchema === "string" ? inputSchema : JSON.stringify(inputSchema);
  validateInputSchema(raw); // throws on non-object / non-JSON
  return raw;
}

function assertJsAllowed(kind: HandlerKind): void {
  if (kind !== "js") return;
  const allow = readSettings().webmcp?.allowJsHandlers;
  if (allow === false) {
    throw new WebmcpError("'js' handlers are disabled (settings.webmcp.allowJsHandlers)", 403);
  }
}

export function addTool(packageIdOrSlug: string, input: ToolInput): WebmcpTool {
  const pkg = getPackageRow(packageIdOrSlug);
  if (!pkg) throw new WebmcpError("package not found", 404);
  if (pkg.status === "archived") throw new WebmcpError("archived packages are read-only", 409);
  const name = String(input.name ?? "").trim();
  if (!TOOL_NAME_RE.test(name)) {
    throw new WebmcpError(`invalid tool name '${name}' (expected ${TOOL_NAME_RE.source})`);
  }
  if (!HANDLER_KINDS.includes(input.handlerKind)) {
    throw new WebmcpError(`invalid handler kind '${String(input.handlerKind)}'`);
  }
  assertJsAllowed(input.handlerKind);
  if (getTool(pkg.id, name)) throw new WebmcpError(`tool '${name}' already exists in '${pkg.slug}'`, 409);

  const id = uuid();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO webmcp_tools(id, package_id, name, description, input_schema_json, handler_kind,
         handler_config_json, requires_approval, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      pkg.id,
      name,
      input.description ?? "",
      normalizeSchema(input.inputSchema),
      input.handlerKind,
      JSON.stringify(input.handlerConfig ?? {}),
      input.requiresApproval ? 1 : 0,
      input.position ?? 0,
      ts,
      ts,
    );
  getDb().prepare("UPDATE webmcp_packages SET updated_at = ? WHERE id = ?").run(ts, pkg.id);
  return getTool(pkg.id, name)!;
}

export function updateTool(
  packageIdOrSlug: string,
  name: string,
  patch: Partial<ToolInput>,
): WebmcpTool {
  const pkg = getPackageRow(packageIdOrSlug);
  if (!pkg) throw new WebmcpError("package not found", 404);
  if (pkg.status === "archived") throw new WebmcpError("archived packages are read-only", 409);
  const existing = getTool(pkg.id, name);
  if (!existing) throw new WebmcpError(`tool '${name}' not found`, 404);

  let nextName = existing.name;
  if (typeof patch.name === "string" && patch.name.trim() && patch.name.trim() !== existing.name) {
    nextName = patch.name.trim();
    if (!TOOL_NAME_RE.test(nextName)) throw new WebmcpError(`invalid tool name '${nextName}'`);
    if (getTool(pkg.id, nextName)) throw new WebmcpError(`tool '${nextName}' already exists`, 409);
  }
  const kind = patch.handlerKind ?? existing.handlerKind;
  if (!HANDLER_KINDS.includes(kind)) throw new WebmcpError(`invalid handler kind '${String(kind)}'`);
  assertJsAllowed(kind);

  getDb()
    .prepare(
      `UPDATE webmcp_tools SET name = ?, description = ?, input_schema_json = ?, handler_kind = ?,
         handler_config_json = ?, requires_approval = ?, position = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      nextName,
      patch.description ?? existing.description,
      patch.inputSchema !== undefined ? normalizeSchema(patch.inputSchema) : JSON.stringify(existing.inputSchema),
      kind,
      patch.handlerConfig !== undefined ? JSON.stringify(patch.handlerConfig) : JSON.stringify(existing.handlerConfig),
      (patch.requiresApproval ?? existing.requiresApproval) ? 1 : 0,
      patch.position ?? existing.position,
      now(),
      existing.id,
    );
  getDb().prepare("UPDATE webmcp_packages SET updated_at = ? WHERE id = ?").run(now(), pkg.id);
  return getTool(pkg.id, nextName)!;
}

/** Removes a tool from the DRAFT working set (published snapshot untouched until republish). */
export function removeTool(packageIdOrSlug: string, name: string): void {
  const pkg = getPackageRow(packageIdOrSlug);
  if (!pkg) throw new WebmcpError("package not found", 404);
  if (pkg.status === "archived") throw new WebmcpError("archived packages are read-only", 409);
  const existing = getTool(pkg.id, name);
  if (!existing) throw new WebmcpError(`tool '${name}' not found`, 404);
  getDb().prepare("DELETE FROM webmcp_tools WHERE id = ?").run(existing.id);
  getDb().prepare("UPDATE webmcp_packages SET updated_at = ? WHERE id = ?").run(now(), pkg.id);
}

// ---------------------------------------------------------------------------
// Versions / snapshots
// ---------------------------------------------------------------------------

export function listVersions(packageId: string): { id: string; version: number; publishedAt: string }[] {
  return getDb()
    .prepare(
      "SELECT id, version, published_at AS publishedAt FROM webmcp_package_versions WHERE package_id = ? ORDER BY version DESC",
    )
    .all(packageId) as { id: string; version: number; publishedAt: string }[];
}

export function getSnapshot(packageId: string, version: number): WebmcpSnapshot | undefined {
  const row = getDb()
    .prepare("SELECT snapshot_json FROM webmcp_package_versions WHERE package_id = ? AND version = ?")
    .get(packageId, version) as { snapshot_json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.snapshot_json) as WebmcpSnapshot;
  } catch {
    return undefined;
  }
}

/** The snapshot that is live on the hub/registry (current_version of a published package). */
export function getPublishedSnapshot(idOrSlug: string): WebmcpSnapshot | undefined {
  const row = getPackageRow(idOrSlug);
  if (!row || row.status !== "published") return undefined;
  return getSnapshot(row.id, row.current_version);
}

// ---------------------------------------------------------------------------
// F4 registry integration (CONVENTIONS §3)
// ---------------------------------------------------------------------------

function actionKey(slug: string, toolName: string): string {
  return `${slug}/${toolName}`;
}

/** Register every tool of a snapshot as `<slug>/<toolName>` on the F4 registry. */
export function registerSnapshot(snapshot: WebmcpSnapshot): void {
  const slug = snapshot.package.slug;
  for (const tool of snapshot.tools) {
    const toolName = tool.name; // exact-advertised-name invariant
    unregisterAction(actionKey(slug, toolName)); // unregister-then-register (republish)
    registerAction({
      key: actionKey(slug, toolName),
      module: "webmcp",
      description: `[${slug}] ${tool.description || toolName}`,
      inputSchema: jsonSchemaToZod(tool.inputSchema),
      requiresApproval: tool.requiresApproval,
      handler: async (args, ctx) => {
        // Lazy import breaks the store↔execute module cycle.
        const { executeTool } = await import("./execute");
        const r = await executeTool(slug, toolName, args, {
          source: ctx.source,
          interactive: !ctx.strict,
          strict: ctx.strict,
        });
        return { ok: r.ok, output: r.output, error: r.error, meta: { durationMs: r.durationMs } };
      },
    });
  }
}

function unregisterSnapshot(snapshot: WebmcpSnapshot | undefined, slug: string): void {
  if (!snapshot) return;
  for (const tool of snapshot.tools) unregisterAction(actionKey(slug, tool.name));
}

// ---------------------------------------------------------------------------
// Publish / archive / boot re-registration
// ---------------------------------------------------------------------------

/**
 * Promotion gate: validates (≥1 tool, object schemas, unique names — the DB
 * UNIQUE already enforces names, re-checked for belt+braces), freezes the
 * working set into webmcp_package_versions, bumps current_version, flips
 * status to published, then swaps the registry registrations.
 */
export function publishPackage(idOrSlug: string): { package: WebmcpPackage; version: number } {
  const row = getPackageRow(idOrSlug);
  if (!row) throw new WebmcpError("package not found", 404);
  if (row.status === "archived") throw new WebmcpError("archived packages cannot be published", 409);

  const tools = listTools(row.id);
  if (tools.length === 0) throw new WebmcpError("cannot publish a package with no tools");
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new WebmcpError(`duplicate tool name '${t.name}'`);
    seen.add(t.name);
    assertObjectSchema(t.inputSchema, t.name); // execute_action args are OBJECTS (CONVENTIONS §3)
    if (t.handlerKind === "internal" && typeof t.handlerConfig.actionKey !== "string") {
      throw new WebmcpError(`tool '${t.name}': internal handler needs handlerConfig.actionKey`);
    }
    if (t.handlerKind === "http" && typeof t.handlerConfig.url !== "string") {
      throw new WebmcpError(`tool '${t.name}': http handler needs handlerConfig.url`);
    }
    if (t.handlerKind === "js" && typeof t.handlerConfig.code !== "string") {
      throw new WebmcpError(`tool '${t.name}': js handler needs handlerConfig.code`);
    }
  }

  const previous = row.status === "published" ? getSnapshot(row.id, row.current_version) : undefined;
  const version = row.current_version + 1;
  const snapshot: WebmcpSnapshot = {
    package: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      icon: row.icon,
      version,
      spec: parseSpec(row.spec_json),
    },
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      handlerKind: t.handlerKind,
      handlerConfig: t.handlerConfig,
      requiresApproval: t.requiresApproval,
      position: t.position,
    })),
  };

  const ts = now();
  tx((db) => {
    db.prepare(
      "INSERT INTO webmcp_package_versions(id, package_id, version, snapshot_json, published_at) VALUES (?, ?, ?, ?, ?)",
    ).run(uuid(), row.id, version, JSON.stringify(snapshot), ts);
    db.prepare(
      "UPDATE webmcp_packages SET status = 'published', current_version = ?, updated_at = ? WHERE id = ?",
    ).run(version, ts, row.id);
  });

  // Registry swap AFTER the DB commit: drop tools removed since the previous
  // snapshot, then register the new set (register overwrites survivors).
  unregisterSnapshot(previous, row.slug);
  registerSnapshot(snapshot);
  emit("webmcp.published", { slug: row.slug, version, tools: snapshot.tools.map((t) => t.name) }, "webmcp");
  return { package: getPackage(row.id)!, version };
}

/** Unregister all published tools + flip status to archived (never delete). */
export function archivePackage(idOrSlug: string): WebmcpPackage {
  const row = getPackageRow(idOrSlug);
  if (!row) throw new WebmcpError("package not found", 404);
  if (row.status === "archived") return getPackage(row.id)!;
  const snapshot = row.status === "published" ? getSnapshot(row.id, row.current_version) : undefined;
  getDb()
    .prepare("UPDATE webmcp_packages SET status = 'archived', updated_at = ? WHERE id = ?")
    .run(now(), row.id);
  unregisterSnapshot(snapshot, row.slug);
  emit("webmcp.archived", { slug: row.slug }, "webmcp");
  return getPackage(row.id)!;
}

/**
 * Boot-time re-registration of ALL published packages' current snapshots
 * (registry lives on globalThis and is empty after a restart). Idempotent —
 * wired into boot.ts ensureV2().
 */
export function loadPublishedIntoRegistry(): number {
  const rows = getDb()
    .prepare("SELECT id, slug, current_version FROM webmcp_packages WHERE status = 'published'")
    .all() as { id: string; slug: string; current_version: number }[];
  let registered = 0;
  for (const r of rows) {
    const snapshot = getSnapshot(r.id, r.current_version);
    if (!snapshot) {
      console.error(`[webmcp] published package '${r.slug}' has no snapshot v${r.current_version} — skipped`);
      continue;
    }
    registerSnapshot(snapshot);
    registered += snapshot.tools.length;
  }
  return registered;
}

// ---------------------------------------------------------------------------
// Call logs
// ---------------------------------------------------------------------------

export interface CallLogRow {
  id: string;
  packageSlug: string;
  toolName: string;
  source: string;
  argsJson: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

/** args must ALREADY be redacted (redactArgs) — this only caps to 4KB. */
export function writeCallLog(entry: {
  packageSlug: string;
  toolName: string;
  source: string;
  redactedArgs: unknown;
  ok: boolean;
  error?: string;
  durationMs: number;
}): void {
  let argsJson = "{}";
  try {
    argsJson = JSON.stringify(entry.redactedArgs ?? {});
  } catch {
    argsJson = '"[unserializable]"';
  }
  if (argsJson.length > 4096) argsJson = argsJson.slice(0, 4093) + "..."; // 4KB cap (may truncate JSON)
  getDb()
    .prepare(
      `INSERT INTO webmcp_call_logs(id, package_slug, tool_name, source, args_json, ok, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuid(),
      entry.packageSlug,
      entry.toolName,
      entry.source,
      argsJson,
      entry.ok ? 1 : 0,
      entry.error ?? null,
      Math.max(0, Math.round(entry.durationMs)),
      now(),
    );
}

export function listCallLogs(filter: { packageSlug?: string; toolName?: string; source?: string; limit?: number; before?: string } = {}): CallLogRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.packageSlug) {
    where.push("package_slug = ?");
    args.push(filter.packageSlug);
  }
  if (filter.toolName) {
    where.push("tool_name = ?");
    args.push(filter.toolName);
  }
  if (filter.source) {
    where.push("source = ?");
    args.push(filter.source);
  }
  if (filter.before) {
    // Cursor paging (SPEC §5 /logs): strictly-older-than the last row seen.
    where.push("created_at < ?");
    args.push(filter.before);
  }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT id, package_slug, tool_name, source, args_json, ok, error, duration_ms, created_at
       FROM webmcp_call_logs ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...args, limit) as Array<{
    id: string;
    package_slug: string;
    tool_name: string;
    source: string;
    args_json: string;
    ok: number;
    error: string | null;
    duration_ms: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    packageSlug: r.package_slug,
    toolName: r.tool_name,
    source: r.source,
    argsJson: r.args_json,
    ok: r.ok === 1,
    error: r.error,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  }));
}
