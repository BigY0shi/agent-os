import { slugify } from '@/lib/slugify';

const DEPARTMENTS = {
  ceo: 'CEO', cto: 'CTO', cmo: 'CMO', cfo: 'CFO', coo: 'COO', cio: 'CIO', chro: 'CHRO',
};

const FRAMEWORK_LABELS = {
  'hermes-workspace': 'Hermes Workspace',
  openclaw: 'OpenClaw',
  'claude-code': 'Claude Code',
  crewai: 'CrewAI',
  langchain: 'LangChain',
  autogen: 'AutoGen',
  'openai-assistants': 'OpenAI Assistants',
  custom: 'Custom',
};

function generateAgentMd(agent, tools = [], skills = []) {
  const dept = DEPARTMENTS[agent.department] || agent.department?.toUpperCase() || '—';
  const fw = FRAMEWORK_LABELS[agent.framework] || agent.framework || '—';
  return `# Agent: ${agent.name}

## Identity
- **Role:** ${agent.role || '—'}
- **Department:** ${dept}
- **Type:** ${agent.agent_type === 'manager' ? 'Manager' : 'Worker'}
- **Framework:** ${fw}

## Goal
${agent.goal || '_No goal defined_'}

## Personality & Vibe
${agent.vibe || '_No vibe defined_'}

## System Prompt
${agent.system_prompt || '_No system prompt defined_'}

## Assigned Tools
${tools.length > 0 ? tools.map((t) => `- ${t.name}`).join('\n') : '_None assigned_'}

## Assigned Skills
${skills.length > 0 ? skills.map((s) => `- ${s.name}`).join('\n') : '_None assigned_'}

## Configuration
- **Memory:** ${agent.memory_enabled ? 'Enabled' : 'Disabled'}
- **Runtime:** ${fw}
- **Model provider id:** ${agent.model_provider_id ?? '—'}
- **Model id:** ${agent.model_id || '—'}
- **Stage:** ${(agent.stage || 'ideate').charAt(0).toUpperCase() + (agent.stage || 'ideate').slice(1)}
- **Status:** ${(agent.status || 'idle').charAt(0).toUpperCase() + (agent.status || 'idle').slice(1)}
`;
}

function generateSkillMd(skill) {
  const kebab = slugify(skill.name);
  return `---
name: ${kebab}
description: ${skill.description || 'No description'}
---

# ${skill.name}

${skill.description || '_No description_'}

## Process Steps
${skill.process_steps || '_No process steps defined_'}

## Guidelines & Constraints
${skill.guidelines || '_No guidelines defined_'}

## Trigger Keywords
${skill.trigger_keywords || '_None_'}
`;
}

function parseJsonIds(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Build harness bundle manifest + file map from SQLite.
 * @param {import('sql.js').Database} db
 * @param {{ agentIds?: number[], includePipelines?: boolean }} options
 */
export function buildHarnessBundle(db, options = {}) {
  const now = new Date().toISOString();
  const files = {};
  const manifest = {
    version: 1,
    generated_at: now,
    source: 'agent-os-dashboard',
    agents: [],
    skills: [],
    pipelines: [],
  };

  let agents = db.prepare('SELECT * FROM agents ORDER BY id').all();
  if (options.agentIds?.length) {
    const idSet = new Set(options.agentIds.map(Number));
    agents = agents.filter((a) => idSet.has(a.id));
  }

  const allSkills = db.prepare('SELECT * FROM skills').all();
  const allTools = db.prepare('SELECT * FROM tools').all();
  const skillById = Object.fromEntries(allSkills.map((s) => [s.id, s]));
  const toolById = Object.fromEntries(allTools.map((t) => [t.id, t]));

  const skillIdsUsed = new Set();

  for (const agent of agents) {
    const slug = slugify(agent.name);
    const toolIds = parseJsonIds(agent.assigned_tools);
    const skillIds = parseJsonIds(agent.assigned_skills);
    const tools = toolIds.map((id) => toolById[id]).filter(Boolean);
    const skills = skillIds.map((id) => skillById[id]).filter(Boolean);
    skillIds.forEach((id) => skillIdsUsed.add(id));

    const path = `agents/${slug}/AGENT.md`;
    files[path] = generateAgentMd(agent, tools, skills);
    manifest.agents.push({ id: agent.id, slug, path, framework: agent.framework });
  }

  for (const skill of allSkills) {
    if (options.agentIds?.length && !skillIdsUsed.has(skill.id)) continue;
    const slug = slugify(skill.name);
    const path = `skills/${slug}-SKILL.md`;
    files[path] = generateSkillMd(skill);
    manifest.skills.push({ id: skill.id, slug, path });
  }

  if (options.includePipelines !== false) {
    const pipelines = db.prepare("SELECT * FROM pipelines WHERE status != 'archived'").all();
    for (const p of pipelines) {
      const path = `pipelines/${p.id}-${slugify(p.name)}.json`;
      let definition = {};
      try {
        definition = JSON.parse(p.definition_json || '{}');
      } catch {
        definition = {};
      }
      files[path] = JSON.stringify(
        {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          definition,
        },
        null,
        2
      );
      manifest.pipelines.push({ id: p.id, path });
    }
  }

  files['manifest.json'] = JSON.stringify(manifest, null, 2);

  return { manifest, files };
}
