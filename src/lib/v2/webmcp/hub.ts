import { listPackages, getPublishedSnapshot, type WebmcpSnapshot } from "./store";
import { executeTool, type ExecuteResult } from "./execute";
import { selectActionNames } from "./actionSelection";

/**
 * SPEC-C D3 hub contract — the seam the C3 brain (and F4's route, indirectly
 * through the Action registry) consumes. Thin wrappers over store/execute;
 * published snapshots only. Also exposed as globalThis.__agentosMcpHub so the
 * Jarvis in-process SDK MCP server can reach it without an import cycle.
 *
 * Tool-name invariant (§8.7): the callable name is exactly the advertised tool
 * name; the `<slug>/` prefix exists only in the registry key / hub addressing.
 */

export interface HubPackageSummary {
  slug: string;
  name: string;
  description: string;
  icon: string;
  version: number;
  toolCount: number;
}

export interface HubToolSchema {
  package: string; // slug
  name: string; // exact advertised tool name
  description: string;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
}

export function listPublishedPackages(): HubPackageSummary[] {
  return listPackages()
    .filter((p) => p.status === "published")
    .map((p) => {
      const snapshot = getPublishedSnapshot(p.slug);
      return {
        slug: p.slug,
        name: p.name,
        description: p.description,
        icon: p.icon,
        version: p.currentVersion,
        toolCount: snapshot?.tools.length ?? 0,
      };
    });
}

function snapshotTools(snapshot: WebmcpSnapshot): HubToolSchema[] {
  return snapshot.tools.map((t) => ({
    package: snapshot.package.slug,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    requiresApproval: t.requiresApproval,
  }));
}

/**
 * Sync enumeration of published tool schemas ('all' | undefined = every
 * published package). No filtering — this is the brain's tool-advertising path
 * (buildJarvisToolHandlers is sync) and the base set every filter starts from.
 */
export function listPublishedToolSchemas(slugOrAll?: string): HubToolSchema[] {
  const slugs =
    !slugOrAll || slugOrAll === "all"
      ? listPublishedPackages().map((p) => p.slug)
      : [slugOrAll];
  const tools: HubToolSchema[] = [];
  for (const slug of slugs) {
    const snapshot = getPublishedSnapshot(slug);
    if (snapshot) tools.push(...snapshotTools(snapshot));
  }
  return tools;
}

/** The keyword scorer — D1.5's fallback path (settings.webmcp.llmGetActions off). */
function keywordFilter(tools: HubToolSchema[], intentFilter: string): HubToolSchema[] {
  const terms = intentFilter
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  const scored = tools
    .map((t) => {
      const hay = `${t.package} ${t.name} ${t.description}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (hay.includes(term)) score += t.name.toLowerCase().includes(term) ? 3 : 1;
      }
      return { t, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    console.error(`[webmcp/hub] intent filter '${intentFilter}' matched nothing — returning ALL tools`);
    return tools;
  }
  return scored.map((s) => s.t);
}

/**
 * SPEC-C D1.5 — tool schemas for one published package ('all' | undefined =
 * every published package), intent-filtered through the ported
 * ACTION_SELECTION prompt (provider-routed modelCall, low tier, temp 0.3).
 * JSON-parse failure / LLM error / nothing-valid → ALL tools + loud
 * console.error (never silently narrow, handled in selectActionNames).
 * settings.webmcp.llmGetActions=false → the keyword scorer fallback.
 */
export async function getActions(slugOrAll?: string, intentFilter?: string): Promise<HubToolSchema[]> {
  const tools = listPublishedToolSchemas(slugOrAll);
  const intent = intentFilter?.trim();
  if (!intent) return tools;

  const outcome = await selectActionNames(
    intent,
    tools.map((t) => ({
      name: t.name,
      description: `[${t.package}] ${t.description}`,
      inputSchema: t.inputSchema,
      scope: t.package,
    })),
  );
  if (outcome.mode === "off") return keywordFilter(tools, intent);
  if (outcome.mode === "all") return tools; // loud log already emitted
  // LLM order preserved (dependency ordering contract).
  const byName = new Map(tools.map((t) => [t.name, t]));
  return outcome.names.map((n) => byName.get(n)!).filter(Boolean);
}

export function executeAction(
  slug: string,
  tool: string,
  args: Record<string, unknown>,
  opts: { source: string; interactive?: boolean; strict?: boolean; conversationId?: string | null },
): Promise<ExecuteResult> {
  return executeTool(slug, tool, args, {
    source: opts.source,
    interactive: opts.interactive ?? false,
    strict: opts.strict ?? false,
    conversationId: opts.conversationId ?? null,
  });
}

// ---------------------------------------------------------------------------
// The globalThis seam (SPEC-C §5) for the C3 brain's in-process MCP server.
// ---------------------------------------------------------------------------

export interface AgentosMcpHub {
  listPublishedPackages: typeof listPublishedPackages;
  getActions: typeof getActions;
  executeAction: typeof executeAction;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosMcpHub: AgentosMcpHub | undefined;
}

/** Idempotent — called from boot.ts ensureV2(). */
export function installHubSeam(): void {
  globalThis.__agentosMcpHub = { listPublishedPackages, getActions, executeAction };
}

// Installing at import time is also safe (pure function refs, no DB access),
// so any importer gets the seam even before boot.
installHubSeam();
