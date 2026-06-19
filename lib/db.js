import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

/**
 * Persistence: sql.js keeps the DB in memory and rewrites `data/agent-os.db` on each mutation.
 * Safe for single-process deployments (e.g. one `next start` on a Pi). Do **not** run multiple
 * Node processes or serverless instances against the same file — use an external database instead.
 * @see docs/CODE_REVIEW_REMEDIATION_PLAN.md
 */

const DB_PATH = 'data/agent-os.db';
const DATA_DIR = 'data';

let cachedWrapper = null;
let SQL = null;

async function initializeSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

/**
 * Wraps a sql.js Database to provide a better-sqlite3-compatible API.
 * Routes can call db.prepare(sql).all(...params), .get(...params), .run(...params).
 */
class DbWrapper {
  constructor(rawDb) {
    this._db = rawDb;
  }

  prepare(sql) {
    const db = this._db;
    return {
      all(...params) {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const results = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
      get(...params) {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        let result = null;
        if (stmt.step()) {
          result = stmt.getAsObject();
        }
        stmt.free();
        return result;
      },
      run(...params) {
        db.run(sql, params);
        _saveRawDb(db);
        const lastIdResult = db.exec('SELECT last_insert_rowid() as id');
        const lastInsertRowid = lastIdResult.length > 0 ? lastIdResult[0].values[0][0] : 0;
        return { lastInsertRowid, changes: db.getRowsModified() };
      }
    };
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  run(sql, params) {
    this._db.run(sql, params);
    _saveRawDb(this._db);
  }
}

function _saveRawDb(db) {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

export async function getDb() {
  if (cachedWrapper) {
    return cachedWrapper;
  }

  await initializeSQL();

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  let rawDb;
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
    initSchema(rawDb);
    seedData(rawDb);
    _saveRawDb(rawDb);
  }

  migrateDb(rawDb);

  cachedWrapper = new DbWrapper(rawDb);
  return cachedWrapper;
}

export function saveDb(db) {
  _saveRawDb(db._db || db);
}

function migrationApplied(db, id) {
  try {
    const stmt = db.prepare('SELECT 1 AS ok FROM schema_migrations WHERE id = ?');
    stmt.bind([id]);
    const ok = stmt.step();
    stmt.free();
    return !!ok;
  } catch {
    return false;
  }
}

function markMigration(db, id) {
  const now = new Date().toISOString();
  try {
    db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [id, now]);
  } catch {
    // ignore duplicate
  }
  _saveRawDb(db);
}

/** Creates Agent OS extension tables if missing (safe on legacy DB files). */
function applyAgentOsExtensionSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      layer TEXT CHECK(layer IN ('working', 'mid', 'long', 'artifact')) NOT NULL,
      title TEXT,
      content TEXT,
      tags TEXT,
      agent_id INTEGER,
      team_id TEXT,
      sensitivity TEXT CHECK(sensitivity IN ('public', 'internal', 'confidential')) DEFAULT 'internal',
      status TEXT CHECK(status IN ('active', 'forgotten')) DEFAULT 'active',
      embedding_ref TEXT,
      promoted_at TEXT,
      forgotten_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_memory_id INTEGER NOT NULL,
      to_memory_id INTEGER NOT NULL,
      relation TEXT,
      created_at TEXT,
      FOREIGN KEY (from_memory_id) REFERENCES memory_entries(id),
      FOREIGN KEY (to_memory_id) REFERENCES memory_entries(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT,
      meta TEXT,
      FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      definition_json TEXT NOT NULL,
      status TEXT CHECK(status IN ('draft', 'active', 'archived')) DEFAULT 'draft',
      created_at TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_id INTEGER NOT NULL,
      status TEXT CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')) DEFAULT 'queued',
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at TEXT,
      finished_at TEXT,
      triggered_by TEXT,
      FOREIGN KEY (pipeline_id) REFERENCES pipelines(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      name TEXT NOT NULL,
      spec_json TEXT,
      risk_class TEXT,
      tests_checklist TEXT,
      status TEXT CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')) DEFAULT 'draft',
      created_at TEXT,
      resolved_at TEXT,
      resolver TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER,
      version TEXT NOT NULL,
      artifact_ref TEXT,
      notes TEXT,
      created_at TEXT,
      FOREIGN KEY (proposal_id) REFERENCES tool_proposals(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS safety_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      severity TEXT,
      kind TEXT,
      message TEXT NOT NULL,
      mitigation TEXT,
      status TEXT CHECK(status IN ('open', 'mitigated', 'overridden')) DEFAULT 'open',
      created_at TEXT,
      resolved_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      meta TEXT,
      created_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      priority INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('active', 'paused', 'done', 'cancelled')) DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_opinions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      claim TEXT NOT NULL,
      confidence REAL,
      evidence_memory_id INTEGER,
      status TEXT CHECK(status IN ('held', 'retracted')) DEFAULT 'held',
      created_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (evidence_memory_id) REFERENCES memory_entries(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS model_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT CHECK(kind IN ('api', 'cli')) NOT NULL DEFAULT 'api',
      label TEXT NOT NULL,
      base_url TEXT,
      default_model TEXT,
      api_key_env TEXT,
      config_json TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  _saveRawDb(db);
}

function migrateDecisionsWideTypesIfNeeded(db) {
  applyAgentOsExtensionSchema(db);
  if (migrationApplied(db, 'decisions_wide_types_v1')) {
    return;
  }

  let supportsNewTypes = true;
  try {
    db.run(
      `INSERT INTO decisions (agent_id, agent_name, section, action, type, status, details, created_at) VALUES (NULL, NULL, NULL, '__type_probe__', 'tool_publish', 'pending', '{}', datetime('now'))`
    );
    const ridRes = db.exec('SELECT last_insert_rowid() as id');
    const rid =
      ridRes.length > 0 && ridRes[0].values.length > 0 ? ridRes[0].values[0][0] : null;
    if (rid) {
      db.run('DELETE FROM decisions WHERE id = ?', [rid]);
    }
  } catch {
    supportsNewTypes = false;
  }

  if (supportsNewTypes) {
    markMigration(db, 'decisions_wide_types_v1');
    return;
  }

  db.run('DROP TABLE IF EXISTS decisions_wide_migration');

  db.run(`
    CREATE TABLE IF NOT EXISTS decisions_wide_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      section TEXT,
      action TEXT NOT NULL,
      type TEXT CHECK(type IN (
        'deployment', 'budget', 'content', 'config', 'outreach',
        'tool_publish', 'infra_change', 'model_change', 'data_access'
      )),
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')),
      details TEXT,
      created_at TEXT,
      resolved_at TEXT,
      resolver TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    INSERT INTO decisions_wide_migration (
      id, agent_id, agent_name, section, action, type, status, details, created_at, resolved_at, resolver
    )
    SELECT id, agent_id, agent_name, section, action, type, status, details, created_at, resolved_at, resolver
    FROM decisions
  `);

  db.run('DROP TABLE decisions');
  db.run('ALTER TABLE decisions_wide_migration RENAME TO decisions');
  _saveRawDb(db);
  markMigration(db, 'decisions_wide_types_v1');
}

function migrateDb(db) {
  const columnsToAdd = [
    { name: 'department', sql: 'ALTER TABLE agents ADD COLUMN department TEXT' },
    { name: 'goal', sql: 'ALTER TABLE agents ADD COLUMN goal TEXT' },
    { name: 'vibe', sql: 'ALTER TABLE agents ADD COLUMN vibe TEXT' },
    { name: 'system_prompt', sql: 'ALTER TABLE agents ADD COLUMN system_prompt TEXT' },
    { name: 'framework', sql: 'ALTER TABLE agents ADD COLUMN framework TEXT' },
    { name: 'memory_enabled', sql: 'ALTER TABLE agents ADD COLUMN memory_enabled INTEGER DEFAULT 0' },
    { name: 'agent_type', sql: 'ALTER TABLE agents ADD COLUMN agent_type TEXT DEFAULT \'worker\'' },
    { name: 'stage', sql: 'ALTER TABLE agents ADD COLUMN stage TEXT DEFAULT \'ideate\'' },
    { name: 'assigned_tools', sql: 'ALTER TABLE agents ADD COLUMN assigned_tools TEXT' },
    { name: 'assigned_skills', sql: 'ALTER TABLE agents ADD COLUMN assigned_skills TEXT' },
    { name: 'model_provider_id', sql: 'ALTER TABLE agents ADD COLUMN model_provider_id INTEGER' },
    { name: 'model_id', sql: 'ALTER TABLE agents ADD COLUMN model_id TEXT' },
  ];

  columnsToAdd.forEach(col => {
    try {
      db.run(col.sql);
      _saveRawDb(db);
    } catch (error) {
      // Column already exists, continue
    }
  });

  const skillColumns = [
    { name: 'tags', sql: "ALTER TABLE skills ADD COLUMN tags TEXT" },
    { name: 'io_schema', sql: "ALTER TABLE skills ADD COLUMN io_schema TEXT" },
    { name: 'required_tools', sql: "ALTER TABLE skills ADD COLUMN required_tools TEXT" }
  ];

  skillColumns.forEach(col => {
    try {
      db.run(col.sql);
      _saveRawDb(db);
    } catch {
      // exists
    }
  });

  applyAgentOsExtensionSchema(db);
  migrateDecisionsWideTypesIfNeeded(db);
  migrateModelProvidersSeedIfNeeded(db);
}

function migrateModelProvidersSeedIfNeeded(db) {
  if (migrationApplied(db, 'b3_model_providers_v1')) {
    return;
  }
  const now = new Date().toISOString();
  const seeds = [
    ['ollama-cloud', 'api', 'Ollama Cloud', 'https://ollama.com', 'llama3.3', 'OLLAMA_API_KEY'],
    ['ollama-local', 'api', 'Ollama (local LAN)', 'http://127.0.0.1:11434', 'llama3.3', null],
    ['anthropic', 'api', 'Anthropic', 'https://api.anthropic.com', 'claude-sonnet-4-20250514', 'ANTHROPIC_API_KEY'],
    ['openai', 'api', 'OpenAI', 'https://api.openai.com/v1', 'gpt-4.1', 'OPENAI_API_KEY'],
    ['google', 'api', 'Google Gemini', 'https://generativelanguage.googleapis.com', 'gemini-2.0-flash', 'GOOGLE_API_KEY'],
    ['openai-compatible', 'api', 'OpenAI-compatible', '', '', 'OPENAI_API_KEY'],
  ];
  seeds.forEach(([slug, kind, label, base_url, default_model, api_key_env]) => {
    try {
      db.run(
        `INSERT OR IGNORE INTO model_providers (slug, kind, label, base_url, default_model, api_key_env, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [slug, kind, label, base_url, default_model, api_key_env, now, now]
      );
    } catch {
      // ignore
    }
  });
  markMigration(db, 'b3_model_providers_v1');
  _saveRawDb(db);
}

function initSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      section TEXT,
      role TEXT,
      status TEXT CHECK(status IN ('active', 'running', 'idle', 'error', 'scheduled')),
      harness TEXT,
      config TEXT,
      tasks_today INTEGER DEFAULT 0,
      quality_score TEXT,
      cost_today REAL DEFAULT 0,
      created_at TEXT,
      department TEXT,
      goal TEXT,
      vibe TEXT,
      system_prompt TEXT,
      framework TEXT,
      memory_enabled INTEGER DEFAULT 0,
      agent_type TEXT DEFAULT 'worker',
      stage TEXT DEFAULT 'ideate',
      assigned_tools TEXT,
      assigned_skills TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      icon TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      agent_id INTEGER,
      type TEXT CHECK(type IN ('automation', 'research', 'content', 'code', 'data', 'custom')),
      status TEXT CHECK(status IN ('active', 'draft', 'testing', 'disabled')),
      trigger_keywords TEXT,
      file_path TEXT,
      version TEXT DEFAULT '1.0',
      last_run TEXT,
      run_count INTEGER DEFAULT 0,
      created_at TEXT,
      tags TEXT,
      io_schema TEXT,
      required_tools TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('mcp', 'api', 'cli', 'function', 'webhook')),
      description TEXT,
      endpoint TEXT,
      status TEXT CHECK(status IN ('connected', 'disconnected', 'error')),
      config TEXT,
      agent_id INTEGER,
      created_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT CHECK(status IN ('running', 'stopped', 'error')),
      transport TEXT,
      command TEXT,
      args TEXT,
      env TEXT,
      tools_count INTEGER DEFAULT 0,
      created_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      agent_id INTEGER,
      section TEXT,
      status TEXT CHECK(status IN ('backlog', 'in-progress', 'review', 'done', 'rejected')),
      priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      description TEXT,
      created_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      section TEXT,
      action TEXT NOT NULL,
      type TEXT CHECK(type IN (
        'deployment', 'budget', 'content', 'config', 'outreach',
        'tool_publish', 'infra_change', 'model_change', 'data_access'
      )),
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')),
      details TEXT,
      created_at TEXT,
      resolved_at TEXT,
      resolver TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  applyAgentOsExtensionSchema(db);

  db.run(`
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      title TEXT NOT NULL,
      type TEXT CHECK(type IN ('blog', 'ad', 'email', 'script', 'social', 'report', 'proposal', 'thread')),
      word_count INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('draft', 'review', 'approved', 'published', 'rejected')),
      preview TEXT,
      feedback_vote TEXT,
      feedback_tags TEXT,
      feedback_comment TEXT,
      created_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      section TEXT,
      title TEXT NOT NULL,
      content TEXT,
      read INTEGER DEFAULT 0,
      starred INTEGER DEFAULT 0,
      created_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      type TEXT,
      title TEXT NOT NULL,
      content TEXT,
      vote TEXT,
      tags TEXT,
      comment TEXT,
      created_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      type TEXT CHECK(type IN ('error', 'warning', 'info')),
      message TEXT NOT NULL,
      status TEXT CHECK(status IN ('active', 'resolved')),
      created_at TEXT,
      resolved_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      amount REAL,
      category TEXT CHECK(category IN ('api', 'compute', 'storage', 'other')),
      date TEXT,
      created_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);
}

function seedData(db) {
  const now = new Date().toISOString();

  const sections = [
    { id: 'ceo', name: 'CEO — Chief Executive', color: '#F59E0B', icon: 'crown' },
    { id: 'cto', name: 'CTO — Technology', color: '#3B82F6', icon: 'cpu' },
    { id: 'cmo', name: 'CMO — Marketing', color: '#EC4899', icon: 'megaphone' },
    { id: 'cfo', name: 'CFO — Finance', color: '#10B981', icon: 'dollar-sign' },
    { id: 'coo', name: 'COO — Operations', color: '#8B5CF6', icon: 'settings' },
    { id: 'cio', name: 'CIO — Information', color: '#06B6D4', icon: 'database' },
    { id: 'chro', name: 'CHRO — Human Resources', color: '#F97316', icon: 'users' }
  ];

  sections.forEach(s => {
    db.run('INSERT INTO sections (id, name, color, icon) VALUES (?, ?, ?, ?)', [s.id, s.name, s.color, s.icon]);
  });

  const agents = [
    { name: 'Content Agent', section: 'cmo', department: 'cmo', role: 'Content Creator', harness: 'claude-code', framework: 'claude-code', goal: 'Create engaging brand content', vibe: 'creative', system_prompt: 'You are a strategic content creator focused on brand voice consistency' },
    { name: 'Thumbnail Generator', section: 'cmo', department: 'cmo', role: 'Media Producer', harness: 'custom', framework: 'custom', goal: 'Generate eye-catching video thumbnails', vibe: 'visual', system_prompt: 'Design compelling thumbnails optimized for engagement' },
    { name: 'Research Agent', section: 'cto', department: 'cto', role: 'Research Analyst', harness: 'crewai', framework: 'crewai', goal: 'Conduct technical market analysis', vibe: 'analytical', system_prompt: 'Perform deep technical research and competitive analysis' },
    { name: 'Deploy Agent', section: 'cto', department: 'cto', role: 'DevOps Engineer', harness: 'langchain', framework: 'langchain', goal: 'Automate deployment pipelines', vibe: 'meticulous', system_prompt: 'Ensure safe and reliable infrastructure deployments' },
    { name: 'Marketing Manager', section: 'cmo', department: 'cmo', role: 'Marketing Lead', harness: 'claude-code', framework: 'claude-code', goal: 'Orchestrate marketing campaigns', vibe: 'strategic', system_prompt: 'Lead cross-functional marketing initiatives' },
    { name: 'SEO Specialist', section: 'cmo', department: 'cmo', role: 'SEO Expert', harness: 'openai-assistants', framework: 'openai-assistants', goal: 'Optimize search visibility', vibe: 'data-driven', system_prompt: 'Develop SEO strategies based on keyword research and performance data' },
    { name: 'Ad Copy Writer', section: 'cmo', department: 'cmo', role: 'Copywriter', harness: 'custom', framework: 'custom', goal: 'Write high-converting ad copy', vibe: 'persuasive', system_prompt: 'Create compelling copy that drives conversions' },
    { name: 'Data Analyst', section: 'cfo', department: 'cfo', role: 'Data Scientist', harness: 'langchain', framework: 'langchain', goal: 'Extract financial insights from data', vibe: 'analytical', system_prompt: 'Analyze financial metrics and provide actionable insights' },
    { name: 'Client Manager', section: 'coo', department: 'coo', role: 'Account Manager', harness: 'custom', framework: 'custom', goal: 'Maintain client relationships', vibe: 'professional', system_prompt: 'Ensure exceptional client satisfaction and retention' },
    { name: 'Video Editor', section: 'cmo', department: 'cmo', role: 'Video Producer', harness: 'crewai', framework: 'crewai', goal: 'Produce polished video content', vibe: 'creative', system_prompt: 'Create engaging video narratives' },
    { name: 'Email Marketer', section: 'cmo', department: 'cmo', role: 'Email Specialist', harness: 'claude-code', framework: 'claude-code', goal: 'Drive engagement through email', vibe: 'personalized', system_prompt: 'Craft targeted email campaigns with high open rates' },
    { name: 'Social Scheduler', section: 'cmo', department: 'cmo', role: 'Social Media Manager', harness: 'custom', framework: 'custom', goal: 'Manage social media calendars', vibe: 'timely', system_prompt: 'Optimize social posting schedules for maximum reach' },
    { name: 'Code Reviewer', section: 'cto', department: 'cto', role: 'QA Engineer', harness: 'autogen', framework: 'autogen', goal: 'Ensure code quality standards', vibe: 'meticulous', system_prompt: 'Review code with focus on security, performance, and maintainability' },
    { name: 'Bug Tracker', section: 'cto', department: 'cto', role: 'Support Engineer', harness: 'custom', framework: 'custom', goal: 'Track and resolve technical issues', vibe: 'responsive', system_prompt: 'Manage bug reports and coordinate fixes' },
    { name: 'Trend Analyzer', section: 'cfo', department: 'cfo', role: 'Trend Researcher', harness: 'langchain', framework: 'langchain', goal: 'Forecast market trends', vibe: 'predictive', system_prompt: 'Analyze market signals and predict financial trends' },
    { name: 'Budget Allocator', section: 'cfo', department: 'cfo', role: 'Finance Manager', harness: 'claude-code', framework: 'claude-code', goal: 'Optimize budget allocation', vibe: 'strategic', system_prompt: 'Allocate resources efficiently across departments' },
    { name: 'Competitor Monitor', section: 'cmo', department: 'cmo', role: 'Analyst', harness: 'custom', framework: 'custom', goal: 'Track competitor activity', vibe: 'vigilant', system_prompt: 'Monitor competitive landscape and identify threats' },
    { name: 'Invoice Generator', section: 'cfo', department: 'cfo', role: 'Billing Agent', harness: 'custom', framework: 'custom', goal: 'Automate billing workflows', vibe: 'accurate', system_prompt: 'Generate accurate invoices and track payments' },
    { name: 'Quality Assurance', section: 'cto', department: 'cto', role: 'QA Lead', harness: 'crewai', framework: 'crewai', goal: 'Ensure product quality', vibe: 'rigorous', system_prompt: 'Execute comprehensive quality assurance testing' },
    { name: 'Webinar Host', section: 'cmo', department: 'cmo', role: 'Event Manager', harness: 'custom', framework: 'custom', goal: 'Host engaging webinars', vibe: 'engaging', system_prompt: 'Conduct professional webinars and educational sessions' },
    { name: 'Pitch Writer', section: 'ceo', department: 'ceo', role: 'Sales Agent', harness: 'claude-code', framework: 'claude-code', goal: 'Create compelling pitches', vibe: 'persuasive', system_prompt: 'Develop winning pitch decks and sales narratives' },
    { name: 'Analytics Dashboard', section: 'cfo', department: 'cfo', role: 'BI Engineer', harness: 'langchain', framework: 'langchain', goal: 'Build business intelligence systems', vibe: 'insightful', system_prompt: 'Create dashboards that drive business decisions' },
    { name: 'Support Chatbot', section: 'chro', department: 'chro', role: 'Customer Service', harness: 'openai-assistants', framework: 'openai-assistants', goal: 'Provide instant customer support', vibe: 'helpful', system_prompt: 'Deliver empathetic and effective customer support' },
    { name: 'Compliance Monitor', section: 'cio', department: 'cio', role: 'Security Officer', harness: 'custom', framework: 'custom', goal: 'Ensure regulatory compliance', vibe: 'vigilant', system_prompt: 'Monitor compliance and security protocols' }
  ];

  const agentIds = [];
  agents.forEach((agent, i) => {
    const status = ['active', 'running', 'idle', 'idle', 'scheduled'][i % 5];
    const config = JSON.stringify({ max_tasks: 10, timeout: 3600 });
    const quality = ['A', 'A+', 'B+', 'A', 'A'][i % 5];
    const costToday = parseFloat((Math.random() * 50).toFixed(2));
    const assignedTools = JSON.stringify([]);
    const assignedSkills = JSON.stringify([]);

    db.run(
      'INSERT INTO agents (name, section, department, role, status, harness, framework, config, tasks_today, quality_score, cost_today, created_at, goal, vibe, system_prompt, memory_enabled, agent_type, stage, assigned_tools, assigned_skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [agent.name, agent.section, agent.department, agent.role, status, agent.harness, agent.framework, config, Math.floor(Math.random() * 8), quality, costToday, now, agent.goal, agent.vibe, agent.system_prompt, 0, 'worker', 'ideate', assignedTools, assignedSkills]
    );

    const result = db.exec('SELECT last_insert_rowid() as id');
    if (result.length > 0 && result[0].values.length > 0) {
      agentIds.push(result[0].values[0][0]);
    }
  });

  const skills = [
    { name: 'Content Writing', type: 'content', description: 'Professional content writing for blogs and articles' },
    { name: 'SEO Optimization', type: 'content', description: 'SEO keyword and metadata optimization' },
    { name: 'Trend Analysis', type: 'research', description: 'Market and social media trend analysis' },
    { name: 'Ad Copy Generation', type: 'content', description: 'High-converting ad copy creation' },
    { name: 'Client Outreach', type: 'automation', description: 'Automated outreach and follow-up' },
    { name: 'Code Deploy', type: 'code', description: 'Automated code deployment and CI/CD' },
    { name: 'Data Analysis', type: 'data', description: 'Statistical analysis and reporting' },
    { name: 'Social Scheduling', type: 'automation', description: 'Social media post scheduling' }
  ];

  skills.forEach((skill, i) => {
    const agentId = agentIds[i % agentIds.length];
    const triggerKeywords = JSON.stringify([skill.name.toLowerCase(), skill.type]);
    db.run(
      'INSERT INTO skills (name, description, agent_id, type, status, trigger_keywords, version, run_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [skill.name, skill.description, agentId, skill.type, 'active', triggerKeywords, '1.0', Math.floor(Math.random() * 100), now]
    );
  });

  const tools = [
    { name: 'GitHub API', type: 'api', description: 'GitHub repository management', endpoint: 'https://api.github.com' },
    { name: 'Slack Bot', type: 'api', description: 'Slack messaging integration', endpoint: 'https://slack.com/api' },
    { name: 'AWS CLI', type: 'cli', description: 'AWS command-line interface', endpoint: 'aws' },
    { name: 'Database Query', type: 'function', description: 'Database query execution', endpoint: 'db.query' },
    { name: 'Email Service', type: 'api', description: 'Email sending and templates', endpoint: 'https://api.sendgrid.com' },
    { name: 'Analytics Hook', type: 'webhook', description: 'Event tracking webhook', endpoint: 'https://analytics.example.com' }
  ];

  tools.forEach((tool, i) => {
    const agentId = agentIds[i % agentIds.length];
    const config = JSON.stringify({ timeout: 5000, retries: 3 });
    db.run(
      'INSERT INTO tools (name, type, description, endpoint, status, config, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [tool.name, tool.type, tool.description, tool.endpoint, 'connected', config, agentId, now]
    );
  });

  const mcpServers = [
    { name: 'filesystem', description: 'File system operations', transport: 'stdio', command: 'mcp-fs' },
    { name: 'web-search', description: 'Web search capabilities', transport: 'sse', command: 'mcp-search' },
    { name: 'database', description: 'Database query interface', transport: 'http', command: 'mcp-db' }
  ];

  mcpServers.forEach(server => {
    const args = JSON.stringify({ debug: false, timeout: 10000 });
    const env = JSON.stringify({ LOG_LEVEL: 'info' });
    db.run(
      'INSERT INTO mcp_servers (name, description, status, transport, command, args, env, tools_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [server.name, server.description, 'running', server.transport, server.command, args, env, Math.floor(Math.random() * 8) + 2, now]
    );
  });

  const taskStatuses = ['backlog', 'in-progress', 'review', 'done', 'rejected'];
  const taskPriorities = ['low', 'medium', 'high', 'urgent'];
  const taskTitles = [
    'Publish weekly blog post', 'Optimize ad campaign performance', 'Deploy hotfix for login bug',
    'Analyze Q1 market trends', 'Create social media content calendar', 'Review code for pull request #245',
    'Generate client invoice reports', 'Conduct competitor analysis', 'Update API documentation',
    'Schedule email newsletter', 'Fix database connection pooling', 'Prepare quarterly business review'
  ];

  taskTitles.forEach((title, i) => {
    const agentId = agentIds[i % agentIds.length];
    const section = sections[i % sections.length].id;
    const status = taskStatuses[i % taskStatuses.length];
    const priority = taskPriorities[i % taskPriorities.length];
    const completedAt = (status === 'done' || status === 'rejected') ? new Date(Date.now() - Math.random() * 86400000).toISOString() : null;
    db.run(
      'INSERT INTO tasks (title, agent_id, section, status, priority, description, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, agentId, section, status, priority, `Task description for: ${title}`, now, completedAt]
    );
  });

  const decisionTypes = ['deployment', 'budget', 'content', 'config', 'outreach'];
  const decisionActions = ['Accept job offer from Tech Corp', 'Push hotfix to production', 'Increase ad spend by 30%', 'Switch email provider', 'Launch outreach campaign'];
  const decisionStatuses = ['pending', 'approved', 'rejected', 'pending', 'approved'];

  decisionActions.forEach((action, i) => {
    const agentId = agentIds[i % agentIds.length];
    const agentName = agents[i % agents.length].name;
    const section = sections[i % sections.length].id;
    const status = decisionStatuses[i];
    const details = JSON.stringify({ priority: 'high', impact: 'high', cost: 5000 + i * 1000 });
    const resolvedAt = status !== 'pending' ? new Date(Date.now() - Math.random() * 86400000).toISOString() : null;
    const resolver = status !== 'pending' ? 'admin' : null;
    db.run(
      'INSERT INTO decisions (agent_id, agent_name, section, action, type, status, details, created_at, resolved_at, resolver) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [agentId, agentName, section, action, decisionTypes[i], status, details, now, resolvedAt, resolver]
    );
  });

  const contentTypes = ['blog', 'ad', 'email', 'script', 'social', 'report', 'proposal', 'thread'];
  const contentTitles = ['The Future of AI in Marketing', 'Black Friday Campaign', 'Monthly Newsletter', 'Product Demo Script', 'Twitter Thread on DevOps', 'Monthly Performance Report', 'Client Proposal Document', 'LinkedIn Article'];
  const contentStatuses = ['draft', 'review', 'approved', 'published', 'rejected'];

  contentTitles.forEach((title, i) => {
    const agentId = agentIds[i % agentIds.length];
    const agentName = agents[i % agents.length].name;
    const wordCount = Math.floor(Math.random() * 5000) + 500;
    const feedbackVote = ['thumbs-up', 'thumbs-down', 'neutral', null][Math.floor(Math.random() * 4)];
    db.run(
      'INSERT INTO content (agent_id, agent_name, title, type, word_count, status, preview, feedback_vote, feedback_tags, feedback_comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [agentId, agentName, title, contentTypes[i], wordCount, contentStatuses[i % contentStatuses.length], title, feedbackVote, JSON.stringify(['quality', 'engaging']), feedbackVote ? 'Great work!' : null, now]
    );
  });

  const reportTitles = ['Weekly Performance Summary', 'Social Media Analytics', 'Budget Utilization Report', 'Campaign Performance Metrics', 'Team Productivity Dashboard', 'Market Analysis Report'];

  reportTitles.forEach((title, i) => {
    const agentId = agentIds[i % agentIds.length];
    const agentName = agents[i % agents.length].name;
    const section = sections[i % sections.length].id;
    db.run(
      'INSERT INTO reports (agent_id, agent_name, section, title, content, read, starred, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [agentId, agentName, section, title, `Detailed report content for ${title}`, Math.random() > 0.5 ? 1 : 0, Math.random() > 0.7 ? 1 : 0, now]
    );
  });

  const outputTypes = ['data', 'analysis', 'recommendation', 'summary', 'insight', 'report'];
  const outputTitles = ['Conversion Rate Analysis', 'Customer Segmentation Data', 'Trend Forecast Report', 'Optimization Recommendations', 'Performance Insights', 'Budget Allocation Analysis', 'A/B Test Results', 'Competitor Benchmark', 'Revenue Projection', 'Market Opportunity Assessment'];

  outputTitles.forEach((title, i) => {
    const agentId = agentIds[i % agentIds.length];
    const agentName = agents[i % agents.length].name;
    const vote = ['up', 'down', 'neutral', null][Math.floor(Math.random() * 4)];
    db.run(
      'INSERT INTO outputs (agent_id, agent_name, type, title, content, vote, tags, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [agentId, agentName, outputTypes[i % outputTypes.length], title, `Output content: ${title}`, vote, JSON.stringify(['important', 'actionable']), vote ? 'Excellent analysis' : null, now]
    );
  });

  const alertMessages = ['API rate limit exceeded for GitHub', 'Database connection timeout', 'Scheduled task completed successfully'];
  const alertTypes = ['error', 'warning', 'info'];

  alertMessages.forEach((message, i) => {
    const agentId = agentIds[i % agentIds.length];
    const agentName = agents[i % agents.length].name;
    const status = i === 0 ? 'active' : 'resolved';
    const resolvedAt = status === 'resolved' ? new Date(Date.now() - 3600000).toISOString() : null;
    db.run(
      'INSERT INTO alerts (agent_id, agent_name, type, message, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [agentId, agentName, alertTypes[i], message, status, now, resolvedAt]
    );
  });

  const costCategories = ['api', 'compute', 'storage', 'other'];
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const agentId = agentIds[i % agentIds.length];
    const agentName = agents[i % agents.length].name;
    const amount = parseFloat((Math.random() * 100).toFixed(2));
    const daysAgo = Math.floor(i / 2);
    const date = new Date(today.getTime() - daysAgo * 86400000).toISOString().split('T')[0];
    db.run(
      'INSERT INTO cost_entries (agent_id, agent_name, amount, category, date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [agentId, agentName, amount, costCategories[i % costCategories.length], date, new Date(today.getTime() - daysAgo * 86400000).toISOString()]
    );
  }

  const firstAgentId = agentIds[0];
  db.run(
    `INSERT INTO memory_entries (layer, title, content, tags, agent_id, team_id, sensitivity, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      'long',
      'Fleet bootstrap memory',
      'Shared Agent OS context: use /api/memory and /api/memory/retrieve for cross-agent recall.',
      JSON.stringify(['bootstrap', 'agent-os']),
      firstAgentId,
      'fleet',
      'internal',
      'active',
      now,
      now
    ]
  );

  const pipelineDef = JSON.stringify({
    version: 1,
    name: 'Sample content funnel',
    nodes: [{ id: 'step1', skillId: 1, inputs: { topic: '{{run.input.topic}}' } }],
    edges: []
  });
  db.run(
    `INSERT INTO pipelines (name, description, definition_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    ['Sample pipeline', 'Linear demo: one skill step', pipelineDef, 'draft', now, now]
  );

  db.run(
    `INSERT INTO agent_goals (agent_id, title, body, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    [
      firstAgentId,
      'Improve weekly content throughput',
      'Automate first drafts and route human review.',
      10,
      'active',
      now,
      now
    ]
  );

  db.run(
    `INSERT INTO audit_log (actor, action, resource_type, resource_id, meta, created_at) VALUES (?,?,?,?,?,?)`,
    ['system:seed', 'bootstrap', 'database', 'agent-os', JSON.stringify({ phase: 'seed' }), now]
  );
}
