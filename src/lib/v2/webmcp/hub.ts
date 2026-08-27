import { listPackages, getPublishedSnapshot, type WebmcpSnapshot } from "./store";
import { executeTool, type ExecuteResult } from "./execute";

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
 * Tool schemas for one published package ('all' | undefined = every published
 * package). intentFilter applies the same keyword scoring as F4 searchActions
 * (the LLM-filtered selection is a chunk-3 concern); no matches → ALL tools
 * (parse-failure→all-tools rule) with a loud log.
 */
export function getActions(slugOrAll?: string, intentFilter?: string): HubToolSchema[] {
  const slugs =
    !slugOrAll || slugOrAll === "all"
      ? listPublishedPackages().map((p) => p.slug)
      : [slugOrAll];
  const tools: HubToolSchema[] = [];
  for (const slug of slugs) {
    const snapshot = getPublishedSnapshot(slug);
    if (snapshot) tools.push(...snapshotTools(snapshot));
  }
  if (!intentFilter?.trim()) return tools;

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

export function executeAction(
  slug: string,
  tool: string,
  args: Record<string, unknown>,
  opts: { source: string; interactive?: boolean; strict?: boolean },
): Promise<ExecuteResult> {
  return executeTool(slug, tool, args, {
    source: opts.source,
    interactive: opts.interactive ?? false,
    strict: opts.strict ?? false,
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
