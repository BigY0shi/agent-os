/**
 * Validates pipeline definition_json per docs/agent-os/SKILL_PIPELINE_SPEC.md
 * @param {unknown} def
 * @returns {{ ok: true, def: object } | { ok: false, error: string }}
 */
export function validatePipelineDefinition(def) {
  if (!def || typeof def !== 'object') {
    return { ok: false, error: 'definition must be an object' };
  }
  const nodes = def.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, error: 'nodes must be a non-empty array' };
  }
  const ids = new Set();
  for (const n of nodes) {
    if (!n || typeof n !== 'object') return { ok: false, error: 'each node must be an object' };
    if (!n.id || typeof n.id !== 'string') return { ok: false, error: 'each node requires string id' };
    if (ids.has(n.id)) return { ok: false, error: `duplicate node id: ${n.id}` };
    ids.add(n.id);
    if (n.skillId == null || Number.isNaN(Number(n.skillId))) {
      return { ok: false, error: `node ${n.id} requires numeric skillId` };
    }
  }

  const edges = Array.isArray(def.edges) ? def.edges : [];
  for (const e of edges) {
    if (!e || typeof e !== 'object') return { ok: false, error: 'each edge must be an object' };
    if (!e.from || !e.to) return { ok: false, error: 'each edge requires from and to' };
    if (!ids.has(e.from) || !ids.has(e.to)) return { ok: false, error: `edge references unknown node: ${e.from} -> ${e.to}` };
  }

  if (edges.length > 0) {
    const adj = new Map();
    for (const id of ids) adj.set(id, []);
    for (const e of edges) {
      adj.get(e.from).push(e.to);
    }
    const visited = new Set();
    const recStack = new Set();

    function dfs(u) {
      visited.add(u);
      recStack.add(u);
      for (const v of adj.get(u) || []) {
        if (!visited.has(v)) {
          if (dfs(v)) return true;
        } else if (recStack.has(v)) {
          return true;
        }
      }
      recStack.delete(u);
      return false;
    }

    for (const id of ids) {
      if (!visited.has(id) && dfs(id)) {
        return { ok: false, error: 'pipeline graph contains a cycle' };
      }
    }
  }

  return { ok: true, def };
}
