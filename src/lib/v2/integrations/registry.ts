import type { ConnectorModule } from "./types";
import { testConnector } from "./connectors/_test";

/**
 * SPEC-D G2.2 — static connector registry (decision 1: in-process TS modules,
 * statically imported; no downloaded bundles, no spawned CLIs). Wave-1
 * connectors (gmail/notion/github/gcal/slack/buzz) register here in the G3
 * chunk. '_'-prefixed slugs are internal fixtures — the §5.1 list route hides
 * them unless ?all=1.
 */

const CONNECTORS: Record<string, ConnectorModule> = {
  _test: testConnector,
};

export function getConnector(slug: string): ConnectorModule | undefined {
  return CONNECTORS[slug];
}

export function listConnectors(opts: { includeHidden?: boolean } = {}): ConnectorModule[] {
  const all = Object.values(CONNECTORS);
  return opts.includeHidden ? all : all.filter((c) => !c.spec.slug.startsWith("_"));
}
