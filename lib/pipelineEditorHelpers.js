/**
 * Client-safe helpers for pipeline editor UI.
 * Validation: use validatePipelineDefinition from lib/pipelineValidate.js
 */

/** @param {string | object | null | undefined} raw */
export function parsePipelineDefinition(raw) {
  if (!raw) {
    return { version: 1, name: '', nodes: [], edges: [] };
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { version: 1, name: '', nodes: [], edges: [] };
    }
  }
  return raw;
}

/** @param {Array<{ id: string }>} nodes */
export function nextNodeId(nodes) {
  let n = nodes.length + 1;
  const ids = new Set(nodes.map((x) => x.id));
  while (ids.has(`step${n}`)) n += 1;
  return `step${n}`;
}

/** Linear edges from ordered nodes */
export function linearEdgesFromNodes(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id, port: 'default' });
  }
  return edges;
}

/** @param {object} def */
export function definitionForSave(def, { useAdvancedEdges }) {
  const nodes = def.nodes || [];
  const edges = useAdvancedEdges ? def.edges || [] : linearEdgesFromNodes(nodes);
  return {
    version: def.version || 1,
    name: def.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      skillId: Number(n.skillId),
      skillName: n.skillName,
      inputs: n.inputs || {},
      notes: n.notes,
    })),
    edges,
  };
}

/** @param {unknown} inputs */
export function inputsToString(inputs) {
  if (inputs == null || inputs === '') return '{}';
  if (typeof inputs === 'string') return inputs;
  try {
    return JSON.stringify(inputs, null, 2);
  } catch {
    return '{}';
  }
}

/** @param {string} str */
export function parseInputsJson(str) {
  const t = (str || '').trim();
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** @param {Array<{ id: number | string, name?: string }>} skills */
export function skillLabel(skills, skillId) {
  const s = skills.find((x) => String(x.id) === String(skillId));
  return s ? `#${s.id} — ${s.name}` : `#${skillId}`;
}
