'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus,
  ChevronLeft,
  Search,
  MessageSquare,
  Settings,
  Trash2,
  Activity,
  Download,
  Copy,
  Check,
  Crown,
  Cpu,
  Megaphone,
  DollarSign,
  Settings2,
  Database,
  Users,
  Brain,
  ExternalLink,
  Package,
} from 'lucide-react';
import Modal from '@/components/Modal';

const DEPARTMENTS = [
  { id: 'ceo', label: 'CEO', desc: 'Strategy, Vision, Leadership', color: '#F59E0B', icon: Crown },
  { id: 'cto', label: 'CTO', desc: 'Engineering, DevOps, Architecture', color: '#3B82F6', icon: Cpu },
  { id: 'cmo', label: 'CMO', desc: 'Content, Social, Campaigns, SEO', color: '#EC4899', icon: Megaphone },
  { id: 'cfo', label: 'CFO', desc: 'Budgets, Invoicing, Cost Analysis', color: '#10B981', icon: DollarSign },
  { id: 'coo', label: 'COO', desc: 'Workflows, Processes, Logistics', color: '#8B5CF6', icon: Settings2 },
  { id: 'cio', label: 'CIO', desc: 'Data, Analytics, Research', color: '#06B6D4', icon: Database },
  { id: 'chro', label: 'CHRO', desc: 'Team, Training, Culture', color: '#F97316', icon: Users },
];

const FRAMEWORKS = [
  { id: 'crewai', label: 'CrewAI' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'langchain', label: 'LangChain' },
  { id: 'autogen', label: 'AutoGen' },
  { id: 'openai-assistants', label: 'OpenAI Assistants' },
  { id: 'nemoclaw', label: 'Nemo Claw' },
  { id: 'hermes-workspace', label: 'Hermes Workspace' },
  { id: 'hermes-agent', label: 'Hermes Agent (legacy id)' },
  { id: 'custom', label: 'Custom' },
];

const VIBE_PRESETS = ['Analytical', 'Creative', 'Executive', 'Technical', 'Supportive', 'Assertive', 'Meticulous', 'Strategic'];
const STAGES = ['ideate', 'build', 'test', 'deploy', 'observe'];

const STAGE_COLORS = {
  ideate: 'bg-yellow-900/40 text-yellow-300 border-yellow-600/40',
  build: 'bg-blue-900/40 text-blue-300 border-blue-600/40',
  test: 'bg-purple-900/40 text-purple-300 border-purple-600/40',
  deploy: 'bg-green-900/40 text-green-300 border-green-600/40',
  observe: 'bg-cyan-900/40 text-cyan-300 border-cyan-600/40',
};

const getDeptColor = (deptId) => {
  const dept = DEPARTMENTS.find(d => d.id === deptId);
  return dept ? dept.color : '#666';
};

const getDeptLabel = (deptId) => {
  const dept = DEPARTMENTS.find(d => d.id === deptId);
  return dept ? dept.label : deptId?.toUpperCase() || '—';
};

const getFrameworkColor = (fw) => {
  const colors = {
    'claude-code': 'bg-blue-900 text-blue-200',
    crewai: 'bg-purple-900 text-purple-200',
    openclaw: 'bg-orange-900 text-orange-200',
    autogen: 'bg-indigo-900 text-indigo-200',
    langchain: 'bg-cyan-900 text-cyan-200',
    'openai-assistants': 'bg-emerald-900 text-emerald-200',
    nemoclaw: 'bg-yellow-900 text-yellow-200',
    'hermes-workspace': 'bg-rose-900 text-rose-200',
    'hermes-agent': 'bg-rose-900 text-rose-200',
    custom: 'bg-surface-700 text-surface-300',
  };
  return colors[fw] || colors.custom;
};

const getStatusColor = (status) => {
  const map = { active: 'status-active', running: 'status-running', idle: 'status-idle', error: 'status-error', scheduled: 'status-scheduled' };
  return map[status] || 'status-idle';
};

// Helper text component
function FieldHelper({ text }) {
  return <p className="text-xs text-surface-500 mt-1 leading-relaxed">{text}</p>;
}

// Generate AGENT.md content
function generateAgentMd(agent) {
  const tools = agent._tools || [];
  const skills = agent._skills || [];
  return `# Agent: ${agent.name}

## Identity
- **Role:** ${agent.role || '—'}
- **Department:** ${getDeptLabel(agent.department)}
- **Type:** ${agent.agent_type === 'manager' ? 'Manager' : 'Worker'}
- **Framework:** ${FRAMEWORKS.find(f => f.id === agent.framework)?.label || agent.framework || '—'}

## Goal
${agent.goal || '_No goal defined_'}

## Personality & Vibe
${agent.vibe || '_No vibe defined_'}

## System Prompt
${agent.system_prompt || '_No system prompt defined_'}

## Assigned Tools
${tools.length > 0 ? tools.map(t => `- ${t.name}`).join('\n') : '_None assigned_'}

## Assigned Skills
${skills.length > 0 ? skills.map(s => `- ${s.name}`).join('\n') : '_None assigned_'}

## Configuration
- **Memory:** ${agent.memory_enabled ? 'Enabled' : 'Disabled'}
- **Runtime:** ${FRAMEWORKS.find(f => f.id === agent.framework)?.label || agent.framework || '—'}
- **Model provider id:** ${agent.model_provider_id ?? '—'}
- **Model id:** ${agent.model_id || '—'}
- **Stage:** ${(agent.stage || 'ideate').charAt(0).toUpperCase() + (agent.stage || 'ideate').slice(1)}
- **Status:** ${(agent.status || 'idle').charAt(0).toUpperCase() + (agent.status || 'idle').slice(1)}
`;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [sections, setSections] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [allTools, setAllTools] = useState([]);
  const [allSkills, setAllSkills] = useState([]);
  const [modelProviders, setModelProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // View states
  const [view, setView] = useState('fleet');
  const [selectedAgent, setSelectedAgent] = useState(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [frameworkFilter, setFrameworkFilter] = useState('');

  // Detail view
  const [detailTab, setDetailTab] = useState('outputs');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});

  // Scaffold modal
  const [showScaffoldModal, setShowScaffoldModal] = useState(false);
  const [scaffoldForm, setScaffoldForm] = useState({
    name: '', role: '', department: '', goal: '', vibe: '', system_prompt: '',
    framework: 'crewai', assigned_tools: '[]', assigned_skills: '[]',
    memory_enabled: 0, agent_type: 'worker', stage: 'ideate', status: 'idle',
  });

  // Feedback
  const [expandedOutputId, setExpandedOutputId] = useState(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackTags, setFeedbackTags] = useState(new Set());

  // Export
  const [copied, setCopied] = useState(false);

  // Agent memory context (Phase B1)
  const [agentMemories, setAgentMemories] = useState([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [agentGoals, setAgentGoals] = useState([]);
  const [agentOpinions, setAgentOpinions] = useState([]);
  const [agentRuns, setAgentRuns] = useState([]);
  const [runtimeInstance, setRuntimeInstance] = useState(null);
  const [runtimeUrls, setRuntimeUrls] = useState({ hermesUi: 'http://192.168.0.168:3000', hermesGateway: 'http://192.168.0.168:8642' });

  const fetchAgentMemories = useCallback(async (agentId) => {
    if (!agentId) return;
    setMemoryLoading(true);
    try {
      const params = new URLSearchParams({
        agent_id: String(agentId),
        agent_only: 'true',
      });
      const res = await fetch(`/api/memory?${params.toString()}`);
      const data = await res.json();
      setAgentMemories(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setAgentMemories([]);
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  const fetchAgentGovernance = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const [gRes, oRes] = await Promise.all([
        fetch(`/api/agent-goals?agent_id=${agentId}`),
        fetch(`/api/agent-opinions?agent_id=${agentId}`),
      ]);
      const [g, o] = await Promise.all([gRes.json(), oRes.json()]);
      setAgentGoals(Array.isArray(g) ? g : []);
      setAgentOpinions(Array.isArray(o) ? o : []);
    } catch (e) {
      console.error(e);
      setAgentGoals([]);
      setAgentOpinions([]);
    }
  }, []);

  const fetchAgentRuntime = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const [runsRes, rtRes] = await Promise.all([
        fetch(`/api/agent-runs?agent_id=${agentId}&limit=20`),
        fetch(`/api/runtimes/heartbeat?agent_id=${agentId}`),
      ]);
      const [runs, rt] = await Promise.all([runsRes.json(), rtRes.json()]);
      setAgentRuns(Array.isArray(runs) ? runs : []);
      setRuntimeInstance(Array.isArray(rt) && rt.length ? rt[0] : null);
    } catch (e) {
      console.error(e);
      setAgentRuns([]);
      setRuntimeInstance(null);
    }
  }, []);

  useEffect(() => { fetchAgents(); fetchSections(); fetchToolsAndSkills(); fetch('/api/model-providers').then(r => r.json()).then(d => setModelProviders(Array.isArray(d) ? d : [])).catch(() => {}); fetch('/api/runtimes/health').then(r => r.json()).then(d => { if (d?.endpoints) setRuntimeUrls({ hermesUi: d.endpoints.hermesUi, hermesGateway: d.endpoints.hermesGateway }); }).catch(() => {}); }, []);
  useEffect(() => { if (selectedAgent) fetchOutputs(selectedAgent.id); }, [selectedAgent]);
  useEffect(() => {
    if (view === 'detail' && selectedAgent && detailTab === 'memory') {
      fetchAgentMemories(selectedAgent.id);
    }
    if (view === 'detail' && selectedAgent && detailTab === 'governance') {
      fetchAgentGovernance(selectedAgent.id);
    }
    if (view === 'detail' && selectedAgent && detailTab === 'runtime') {
      fetchAgentRuntime(selectedAgent.id);
    }
  }, [view, selectedAgent, detailTab, fetchAgentMemories, fetchAgentGovernance, fetchAgentRuntime]);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (departmentFilter) params.append('department', departmentFilter);
      if (frameworkFilter) params.append('harness', frameworkFilter);
      const res = await fetch(`/api/agents?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      setAgents(await res.json());
      setError(null);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const fetchSections = async () => {
    try {
      const res = await fetch('/api/sections');
      if (!res.ok) return;
      const data = await res.json();
      setSections(data.sections || data || []);
    } catch (err) { console.error(err); }
  };

  const fetchToolsAndSkills = async () => {
    try {
      const [toolsRes, skillsRes] = await Promise.all([
        fetch('/api/tools'),
        fetch('/api/skills'),
      ]);
      const toolsData = await toolsRes.json();
      const skillsData = await skillsRes.json();
      setAllTools(Array.isArray(toolsData) ? toolsData : []);
      setAllSkills(Array.isArray(skillsData) ? skillsData : []);
    } catch (err) { console.error(err); }
  };

  const fetchOutputs = async (agentId) => {
    try {
      const res = await fetch(`/api/outputs?agent_id=${agentId}`);
      if (!res.ok) return;
      const data = await res.json();
      setOutputs(data.outputs || data || []);
    } catch (err) { console.error(err); }
  };

  // ----- Scaffold Submit -----
  const handleScaffoldSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...scaffoldForm,
        section: scaffoldForm.department, // backward compat
        harness: scaffoldForm.framework, // backward compat
        config: JSON.stringify({ max_tasks: 10, timeout: 3600 }),
      };
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to create agent');
      setShowScaffoldModal(false);
      setScaffoldForm({
        name: '', role: '', department: '', goal: '', vibe: '', system_prompt: '',
        framework: 'crewai', assigned_tools: '[]', assigned_skills: '[]',
        memory_enabled: 0, agent_type: 'worker', stage: 'ideate', status: 'idle',
      });
      fetchAgents();
    } catch (err) { setError(err.message); }
  };

  // ----- Update Agent -----
  const handleUpdateAgent = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...editForm,
        section: editForm.department || editForm.section,
        harness: editForm.framework || editForm.harness,
      };
      const res = await fetch(`/api/agents?id=${selectedAgent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update agent');
      const updated = { ...selectedAgent, ...editForm };
      setEditMode(false);
      setSelectedAgent(updated);
      fetchAgents();
    } catch (err) { setError(err.message); }
  };

  const handleDeleteAgent = async () => {
    if (!confirm(`Delete agent "${selectedAgent.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/agents?id=${selectedAgent.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete agent');
      setView('fleet');
      setSelectedAgent(null);
      fetchAgents();
    } catch (err) { setError(err.message); }
  };

  const handleSubmitFeedback = async (outputId) => {
    try {
      await fetch('/api/outputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          output_id: outputId,
          vote: feedbackTags.has('excellent') ? 1 : feedbackTags.has('needs-work') ? -1 : 0,
          tags: Array.from(feedbackTags),
          comment: feedbackComment,
        }),
      });
      setExpandedOutputId(null);
      setFeedbackComment('');
      setFeedbackTags(new Set());
      fetchOutputs(selectedAgent.id);
    } catch (err) { console.error(err); }
  };

  // ----- Export .md -----
  const handleExportMd = (agent) => {
    const parsedTools = (() => { try { return JSON.parse(agent.assigned_tools || '[]'); } catch { return []; } })();
    const parsedSkills = (() => { try { return JSON.parse(agent.assigned_skills || '[]'); } catch { return []; } })();
    const toolObjects = allTools.filter(t => parsedTools.includes(t.id));
    const skillObjects = allSkills.filter(s => parsedSkills.includes(s.id));
    const md = generateAgentMd({ ...agent, _tools: toolObjects, _skills: skillObjects });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.name.toLowerCase().replace(/\s+/g, '-')}-agent.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMd = (agent) => {
    const parsedTools = (() => { try { return JSON.parse(agent.assigned_tools || '[]'); } catch { return []; } })();
    const parsedSkills = (() => { try { return JSON.parse(agent.assigned_skills || '[]'); } catch { return []; } })();
    const toolObjects = allTools.filter(t => parsedTools.includes(t.id));
    const skillObjects = allSkills.filter(s => parsedSkills.includes(s.id));
    const md = generateAgentMd({ ...agent, _tools: toolObjects, _skills: skillObjects });
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportBundle = async (agent) => {
    try {
      const res = await fetch(`/api/harness/bundle?agent_id=${agent.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bundle export failed');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${agent.name.toLowerCase().replace(/\s+/g, '-')}-bundle.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  const isHermesAgent = (agent) => {
    const fw = agent.framework || agent.harness;
    return fw === 'hermes-workspace' || fw === 'hermes-agent';
  };

  // ----- Multi-select helpers for tools/skills -----
  const toggleArrayItem = (field, id, formSetter, form) => {
    const current = (() => { try { return JSON.parse(form[field] || '[]'); } catch { return []; } })();
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    formSetter({ ...form, [field]: JSON.stringify(next) });
  };

  const isInArray = (field, id, form) => {
    try { return JSON.parse(form[field] || '[]').includes(id); } catch { return false; }
  };

  // ----- Filtering -----
  const filteredAgents = agents.filter((agent) => {
    const q = searchQuery.toLowerCase();
    return (
      agent.name?.toLowerCase().includes(q) ||
      agent.role?.toLowerCase().includes(q) ||
      agent.goal?.toLowerCase().includes(q)
    );
  });

  const groupedAgents = filteredAgents.reduce((acc, agent) => {
    const dept = agent.department || agent.section || 'uncategorized';
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(agent);
    return acc;
  }, {});

  // Sort departments by DEPARTMENTS order
  const sortedDepts = Object.keys(groupedAgents).sort((a, b) => {
    const ai = DEPARTMENTS.findIndex(d => d.id === a);
    const bi = DEPARTMENTS.findIndex(d => d.id === b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // ========== DETAIL VIEW ==========
  if (view === 'detail' && selectedAgent) {
    const agent = selectedAgent;
    return (
      <div className="min-h-screen bg-surface-950 text-surface-200">
        {/* Header */}
        <div className="border-b border-surface-800 bg-surface-900 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center gap-4 mb-4">
              <button onClick={() => { setView('fleet'); setSelectedAgent(null); setEditMode(false); }} className="flex items-center gap-2 text-surface-400 hover:text-orange-500 transition">
                <ChevronLeft size={20} /><span className="text-sm">Fleet</span>
              </button>
              <span className="text-surface-600">/</span>
              <h1 className="text-2xl font-bold text-surface-100">{agent.name}</h1>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
                <span className="text-surface-300">{agent.role}</span>
                <span className="px-3 py-1 text-xs font-bold rounded border" style={{ borderColor: getDeptColor(agent.department || agent.section), color: getDeptColor(agent.department || agent.section) }}>
                  {getDeptLabel(agent.department || agent.section)}
                </span>
                <span className={`px-3 py-1 text-xs font-bold rounded ${getFrameworkColor(agent.framework || agent.harness)}`}>
                  {FRAMEWORKS.find(f => f.id === (agent.framework || agent.harness))?.label || agent.framework || agent.harness}
                </span>
                {agent.stage && (
                  <span className={`px-3 py-1 text-xs font-bold rounded border ${STAGE_COLORS[agent.stage] || ''}`}>
                    {agent.stage.charAt(0).toUpperCase() + agent.stage.slice(1)}
                  </span>
                )}
                <span className="px-2 py-1 text-xs rounded bg-surface-800 text-surface-400">
                  {agent.agent_type === 'manager' ? '👑 Manager' : '⚙️ Worker'}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {isHermesAgent(agent) && (
                  <a href={runtimeUrls.hermesUi} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-3 py-2 rounded bg-rose-900/40 hover:bg-rose-900/60 text-rose-200 transition text-sm">
                    <ExternalLink size={14} /> Hermes Workspace
                  </a>
                )}
                <button type="button" onClick={() => handleExportBundle(agent)} className="flex items-center gap-1 px-3 py-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-orange-500 transition text-sm">
                  <Package size={14} /> Export bundle
                </button>
                <button onClick={() => handleExportMd(agent)} className="flex items-center gap-1 px-3 py-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-orange-500 transition text-sm">
                  <Download size={14} /> Export .md
                </button>
                <button onClick={() => handleCopyMd(agent)} className="flex items-center gap-1 px-3 py-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-orange-500 transition text-sm">
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied!' : 'Copy .md'}
                </button>
                {!editMode && (
                  <button onClick={() => { setEditMode(true); setEditForm(agent); }} className="flex items-center gap-2 px-3 py-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-orange-500 transition text-sm">
                    <Settings size={16} /> Edit
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex border-t border-surface-800 max-w-7xl mx-auto">
            {['outputs', 'memory', 'governance', 'runtime', 'performance', 'settings'].map((tab) => (
              <button key={tab} onClick={() => setDetailTab(tab)} className={`px-6 py-3 text-sm font-medium transition border-b-2 ${detailTab === tab ? 'border-orange-500 text-orange-500' : 'border-transparent text-surface-400 hover:text-surface-300'}`}>
                {tab === 'memory' ? 'Memory' : tab === 'governance' ? 'Governance' : tab === 'runtime' ? 'Runtime' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* OUTPUTS TAB */}
          {detailTab === 'outputs' && (
            <div className="space-y-4">
              {outputs.length === 0 ? (
                <div className="text-center py-12 text-surface-500">
                  <Activity size={40} className="mx-auto mb-4 opacity-50" />
                  <p>No outputs yet</p>
                </div>
              ) : outputs.map((output) => (
                <div key={output.id} className="card border border-surface-800 bg-surface-900 p-4 rounded-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-surface-100 mb-1">{output.title}</h3>
                      <p className="text-sm text-surface-400 line-clamp-2">{output.content}</p>
                    </div>
                    <span className="px-2 py-1 text-xs font-medium rounded bg-surface-800 text-surface-300 whitespace-nowrap ml-4">{output.type}</span>
                  </div>
                  <div className="text-xs text-surface-600 mb-3">{new Date(output.created_at).toLocaleString()}</div>
                  {expandedOutputId === output.id ? (
                    <div className="bg-surface-950 rounded p-4 border border-surface-800 mt-4">
                      <div className="mb-3">
                        <label className="text-xs font-semibold text-surface-300 uppercase block mb-2">Quick Tags</label>
                        <div className="flex flex-wrap gap-2">
                          {['excellent', 'needs-work', 'on-brand', 'off-target'].map((tag) => (
                            <button key={tag} onClick={() => { const t = new Set(feedbackTags); t.has(tag) ? t.delete(tag) : t.add(tag); setFeedbackTags(t); }} className={`px-3 py-1 text-xs rounded transition ${feedbackTags.has(tag) ? 'bg-orange-600 text-white' : 'bg-surface-800 text-surface-400 hover:text-surface-300'}`}>{tag}</button>
                          ))}
                        </div>
                      </div>
                      <textarea value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)} placeholder="Add a comment..." className="w-full bg-surface-900 border border-surface-700 rounded p-3 text-surface-200 text-sm mb-3 placeholder-surface-600" rows="3" />
                      <div className="flex gap-2">
                        <button onClick={() => handleSubmitFeedback(output.id)} className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded transition">Submit</button>
                        <button onClick={() => setExpandedOutputId(null)} className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 text-sm rounded transition">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 pt-2 border-t border-surface-800">
                      <button onClick={() => { setExpandedOutputId(output.id); setFeedbackComment(''); setFeedbackTags(new Set()); }} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs text-surface-400 hover:text-orange-500 hover:bg-surface-800 rounded transition">
                        <MessageSquare size={14} /> Feedback
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* MEMORY TAB */}
          {detailTab === 'memory' && (
            <div className="space-y-4 max-w-3xl">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-surface-100 font-medium flex items-center gap-2">
                    <Brain size={18} className="text-orange-500" /> Memory context
                  </h3>
                  <p className="text-surface-500 text-sm mt-1">
                    Entries attached to this agent ({agent.memory_enabled ? 'memory enabled' : 'memory disabled in config'}).
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/memory?agent_id=${agent.id}&agent_only=true`}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 text-sm"
                  >
                    <ExternalLink size={14} /> Open in Memory OS
                  </Link>
                  <Link
                    href={`/memory?agent_id=${agent.id}`}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded bg-orange-600 hover:bg-orange-500 text-white text-sm"
                  >
                    <Plus size={14} /> Add memory
                  </Link>
                </div>
              </div>

              {memoryLoading ? (
                <p className="text-surface-500 text-sm">Loading memory…</p>
              ) : agentMemories.length === 0 ? (
                <div className="card bg-surface-900 border border-surface-800 rounded-lg p-8 text-center text-surface-500">
                  <Brain size={32} className="mx-auto mb-3 opacity-40" />
                  <p>No memory entries attached to this agent yet.</p>
                  <Link href={`/memory?agent_id=${agent.id}`} className="text-orange-400 underline text-sm mt-2 inline-block">
                    Create one in Memory OS
                  </Link>
                </div>
              ) : (
                <ul className="space-y-3">
                  {agentMemories.map((m) => (
                    <li key={m.id} className="card bg-surface-900 border border-surface-800 rounded-lg p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-xs uppercase text-orange-400/90">{m.layer}</span>
                        <span className="text-xs text-surface-500">{m.sensitivity}</span>
                      </div>
                      <h4 className="text-surface-100 font-medium">{m.title || 'Untitled'}</h4>
                      <p className="text-surface-400 text-sm mt-1 line-clamp-3">{m.content}</p>
                      <Link href={`/memory?agent_id=${agent.id}&agent_only=true`} className="text-xs text-orange-400 underline mt-2 inline-block">
                        Edit in Memory OS
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* GOVERNANCE TAB */}
          {detailTab === 'governance' && (
            <div className="space-y-6 max-w-3xl">
              <div className="flex justify-between items-center">
                <h3 className="text-surface-100 font-medium">Goals & opinions</h3>
                <Link href="/governance" className="text-xs text-orange-400 underline">Open governance console</Link>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm text-surface-400">Active goals</h4>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-orange-600 text-white"
                    onClick={async () => {
                      const title = prompt('Goal title:');
                      if (!title?.trim()) return;
                      const priority = Number(prompt('Priority:', '10') || '10');
                      await fetch('/api/agent-goals', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ agent_id: agent.id, title: title.trim(), priority }),
                      });
                      fetchAgentGovernance(agent.id);
                    }}
                  >
                    + Add goal
                  </button>
                </div>
                {agentGoals.length === 0 ? <p className="text-surface-500 text-sm">No goals.</p> : (
                  <ul className="space-y-2">{agentGoals.map((g) => (
                    <li key={g.id} className="card bg-surface-900 border border-surface-800 rounded p-3 text-sm">
                      <div className="font-medium text-surface-100">{g.title}</div>
                      <div className="text-surface-500 text-xs mt-1">P{g.priority} · {g.status}</div>
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          className="text-xs px-2 py-0.5 rounded bg-surface-800 text-surface-300"
                          onClick={async () => {
                            await fetch(`/api/agent-goals/${g.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ...g, priority: (g.priority || 0) + 1 }),
                            });
                            fetchAgentGovernance(agent.id);
                          }}
                        >
                          ↑
                        </button>
                        {g.status !== 'done' && (
                          <button
                            type="button"
                            className="text-xs px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300"
                            onClick={async () => {
                              await fetch(`/api/agent-goals/${g.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ...g, status: 'done' }),
                              });
                              fetchAgentGovernance(agent.id);
                            }}
                          >
                            Done
                          </button>
                        )}
                      </div>
                    </li>
                  ))}</ul>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm text-surface-400">Held opinions</h4>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-orange-600 text-white"
                    onClick={async () => {
                      const claim = prompt('Opinion claim:');
                      if (!claim?.trim()) return;
                      await fetch('/api/agent-opinions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ agent_id: agent.id, claim: claim.trim(), confidence: 0.8 }),
                      });
                      fetchAgentGovernance(agent.id);
                    }}
                  >
                    + Add opinion
                  </button>
                </div>
                {agentOpinions.length === 0 ? <p className="text-surface-500 text-sm">No opinions.</p> : (
                  <ul className="space-y-2">{agentOpinions.map((o) => (
                    <li key={o.id} className="card bg-surface-900 border border-surface-800 rounded p-3 text-sm text-surface-300">{o.claim}</li>
                  ))}</ul>
                )}
              </div>
              <div className="card bg-surface-900 border border-surface-800 rounded-lg p-4 text-sm">
                <h4 className="text-surface-300 font-medium mb-2">Runtime & model</h4>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-surface-500">Runtime</dt>
                  <dd className="text-surface-200">{FRAMEWORKS.find(f => f.id === agent.framework)?.label || agent.framework || '—'}</dd>
                  <dt className="text-surface-500">Provider</dt>
                  <dd className="text-surface-200">{modelProviders.find(p => p.id === agent.model_provider_id)?.label || agent.model_provider_id || '—'}</dd>
                  <dt className="text-surface-500">Model</dt>
                  <dd className="text-surface-200">{agent.model_id || '—'}</dd>
                </dl>
              </div>
            </div>
          )}

          {/* RUNTIME TAB (v1.1) */}
          {detailTab === 'runtime' && (
            <div className="space-y-6 max-w-3xl">
              <div className="card bg-surface-900 border border-surface-800 rounded-lg p-4">
                <h3 className="text-surface-100 font-medium mb-3">Harness links</h3>
                <div className="flex flex-wrap gap-2">
                  {isHermesAgent(agent) ? (
                    <>
                      <a href={runtimeUrls.hermesUi} target="_blank" rel="noopener noreferrer" className="text-sm px-3 py-2 rounded bg-rose-900/40 text-rose-200 inline-flex items-center gap-1">
                        <ExternalLink size={14} /> Workspace UI
                      </a>
                      <a href={runtimeUrls.hermesGateway} target="_blank" rel="noopener noreferrer" className="text-sm px-3 py-2 rounded bg-surface-800 text-surface-200 inline-flex items-center gap-1">
                        <ExternalLink size={14} /> Gateway
                      </a>
                    </>
                  ) : (
                    <p className="text-surface-500 text-sm">Set framework to Hermes Workspace for link-out.</p>
                  )}
                </div>
                {runtimeInstance && (
                  <p className="text-xs text-surface-500 mt-3">
                    Last heartbeat: {runtimeInstance.last_heartbeat_at ? new Date(runtimeInstance.last_heartbeat_at).toLocaleString() : '—'}
                    {' · '}{runtimeInstance.last_status || 'unknown'}
                  </p>
                )}
              </div>
              <div>
                <h3 className="text-surface-100 font-medium mb-2">Recent runs</h3>
                {agentRuns.length === 0 ? (
                  <p className="text-surface-500 text-sm">No runs reported. Harnesses POST to <code className="text-surface-400">/api/agent-runs</code>.</p>
                ) : (
                  <ul className="space-y-2">
                    {agentRuns.map((r) => (
                      <li key={r.id} className="card bg-surface-900 border border-surface-800 rounded p-3 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="text-surface-200">Run #{r.id}</span>
                          <span className="text-xs uppercase text-orange-400/90">{r.status}</span>
                        </div>
                        <div className="text-xs text-surface-500 mt-1">
                          {r.runtime_type || '—'}
                          {r.duration_ms != null ? ` · ${r.duration_ms}ms` : ''}
                          {r.cost_usd != null ? ` · $${r.cost_usd}` : ''}
                        </div>
                        {r.finished_at && <div className="text-xs text-surface-600 mt-1">{new Date(r.finished_at).toLocaleString()}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* PERFORMANCE TAB */}
          {detailTab === 'performance' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Tasks', value: agent.tasks_today || 0, accent: true },
                { label: 'Quality', value: agent.quality_score || '—' },
                { label: 'Cost Today', value: `$${agent.cost_today || '0.00'}` },
                { label: 'Stage', value: (agent.stage || 'ideate').charAt(0).toUpperCase() + (agent.stage || 'ideate').slice(1) },
              ].map((kpi) => (
                <div key={kpi.label} className="card bg-surface-900 border border-surface-800 rounded-lg p-6">
                  <p className="text-surface-400 text-sm mb-2">{kpi.label}</p>
                  <p className={`text-3xl font-bold ${kpi.accent ? 'text-orange-500' : 'text-surface-100'}`}>{kpi.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* SETTINGS TAB */}
          {detailTab === 'settings' && (
            <div className="max-w-3xl">
              {editMode ? (
                <form onSubmit={handleUpdateAgent} className="space-y-5">
                  {renderFormFields(editForm, setEditForm, allTools, allSkills, toggleArrayItem, isInArray, modelProviders)}
                  <div className="flex gap-3 pt-4">
                    <button type="submit" className="flex-1 px-6 py-2 bg-orange-600 hover:bg-orange-500 text-white font-medium rounded transition">Save Changes</button>
                    <button type="button" onClick={() => setEditMode(false)} className="px-6 py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 font-medium rounded transition">Cancel</button>
                    <button type="button" onClick={handleDeleteAgent} className="px-6 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 font-medium rounded transition flex items-center gap-2">
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-1">
                  {[
                    ['Name', agent.name],
                    ['Role', agent.role],
                    ['Department', getDeptLabel(agent.department || agent.section)],
                    ['Goal', agent.goal || '—'],
                    ['Vibe', agent.vibe || '—'],
                    ['Framework', FRAMEWORKS.find(f => f.id === (agent.framework || agent.harness))?.label || agent.framework || agent.harness],
                    ['Model provider', modelProviders.find(p => p.id === agent.model_provider_id)?.label || agent.model_provider_id || '—'],
                    ['Model id', agent.model_id || '—'],
                    ['Agent Type', agent.agent_type === 'manager' ? 'Manager' : 'Worker'],
                    ['Memory', agent.memory_enabled ? 'Enabled' : 'Disabled'],
                    ['Stage', (agent.stage || 'ideate').charAt(0).toUpperCase() + (agent.stage || 'ideate').slice(1)],
                    ['Status', (agent.status || 'idle').charAt(0).toUpperCase() + (agent.status || 'idle').slice(1)],
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between py-3 border-b border-surface-800">
                      <span className="text-surface-400">{label}</span>
                      <span className="text-surface-100 font-medium text-right max-w-md">{val}</span>
                    </div>
                  ))}
                  {agent.system_prompt && (
                    <div className="pt-4">
                      <span className="text-surface-400 text-sm">System Prompt</span>
                      <div className="mt-2 bg-surface-900 border border-surface-800 rounded p-4 text-surface-300 text-sm leading-relaxed whitespace-pre-wrap">{agent.system_prompt}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========== FLEET VIEW ==========
  return (
    <div className="min-h-screen bg-surface-950 text-surface-200">
      <div className="border-b border-surface-800 bg-surface-900 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-surface-100">Agent Fleet</h1>
            <button onClick={() => setShowScaffoldModal(true)} className="btn-accent px-4 py-2 rounded font-medium flex items-center gap-2">
              <Plus size={18} /> Scaffold Agent
            </button>
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-64 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-600" />
              <input type="text" placeholder="Search agents..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-800 border border-surface-700 rounded pl-10 pr-4 py-2 text-surface-200 placeholder-surface-600 focus:outline-none focus:border-orange-500 text-sm" />
            </div>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }} className="bg-surface-800 border border-surface-700 rounded px-4 py-2 text-surface-300 text-sm focus:outline-none focus:border-orange-500">
              <option value="">All Statuses</option>
              {['active', 'running', 'idle', 'error', 'scheduled'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select value={departmentFilter} onChange={(e) => { setDepartmentFilter(e.target.value); }} className="bg-surface-800 border border-surface-700 rounded px-4 py-2 text-surface-300 text-sm focus:outline-none focus:border-orange-500">
              <option value="">All Departments</option>
              {DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.label} — {d.desc.split(',')[0]}</option>)}
            </select>
            <select value={frameworkFilter} onChange={(e) => { setFrameworkFilter(e.target.value); }} className="bg-surface-800 border border-surface-700 rounded px-4 py-2 text-surface-300 text-sm focus:outline-none focus:border-orange-500">
              <option value="">All Frameworks</option>
              {FRAMEWORKS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {error && <div className="mb-6 p-4 bg-red-900/20 border border-red-600/50 rounded text-red-400 text-sm">{error}</div>}

        {loading ? (
          <div className="text-center py-20 text-surface-500">
            <Activity size={40} className="mx-auto mb-4 animate-pulse opacity-50" />
            <p>Loading agents...</p>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-20 text-surface-500"><p>No agents found</p></div>
        ) : (
          sortedDepts.map((deptId) => {
            const deptAgents = groupedAgents[deptId];
            const dept = DEPARTMENTS.find(d => d.id === deptId);
            const DeptIcon = dept?.icon || Database;
            return (
              <div key={deptId} className="mb-12">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b-2" style={{ borderColor: dept?.color || '#666' }}>
                  <DeptIcon size={20} style={{ color: dept?.color || '#666' }} />
                  <h2 className="text-xl font-bold text-surface-100">{dept?.label || deptId.toUpperCase()}</h2>
                  <span className="text-xs text-surface-500 ml-1">{dept?.desc || ''}</span>
                  <span className="text-xs font-semibold text-surface-500 uppercase ml-auto">{deptAgents.length} agent{deptAgents.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {deptAgents.map((agent) => (
                    <button key={agent.id} onClick={() => { setSelectedAgent(agent); setView('detail'); setDetailTab('outputs'); }} className="card-hover card bg-surface-900 border border-surface-800 rounded-lg p-5 text-left transition cursor-pointer hover:border-orange-500/50">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(agent.status)}`} />
                            <h3 className="font-bold text-surface-100 text-sm">{agent.name}</h3>
                          </div>
                          <p className="text-xs text-surface-500 line-clamp-1">{agent.role}</p>
                        </div>
                        {agent.agent_type === 'manager' && <span className="text-xs px-2 py-0.5 rounded bg-yellow-900/30 text-yellow-300 border border-yellow-700/40">Mgr</span>}
                      </div>
                      {agent.goal && <p className="text-xs text-surface-400 line-clamp-2 mb-3">{agent.goal}</p>}
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <span className={`inline-block px-2 py-0.5 text-xs font-bold rounded ${getFrameworkColor(agent.framework || agent.harness)}`}>
                          {FRAMEWORKS.find(f => f.id === (agent.framework || agent.harness))?.label || agent.framework || agent.harness}
                        </span>
                        {agent.stage && (
                          <span className={`inline-block px-2 py-0.5 text-xs font-bold rounded border ${STAGE_COLORS[agent.stage] || ''}`}>
                            {agent.stage.charAt(0).toUpperCase() + agent.stage.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-surface-950/50 rounded p-2">
                          <p className="text-surface-600 mb-1">Tasks</p>
                          <p className="font-bold text-surface-100">{agent.tasks_today || 0}</p>
                        </div>
                        <div className="bg-surface-950/50 rounded p-2">
                          <p className="text-surface-600 mb-1">Quality</p>
                          <p className="font-bold text-surface-100">{agent.quality_score || '—'}</p>
                        </div>
                        <div className="bg-surface-950/50 rounded p-2">
                          <p className="text-surface-600 mb-1">Cost</p>
                          <p className="font-bold text-surface-100">${agent.cost_today || '0'}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ========== SCAFFOLD AGENT MODAL ========== */}
      <Modal isOpen={showScaffoldModal} onClose={() => setShowScaffoldModal(false)} title="Scaffold New Agent" size="2xl">
        <form onSubmit={handleScaffoldSubmit} className="space-y-5 max-h-[70vh] overflow-y-auto pr-2">
          {renderFormFields(scaffoldForm, setScaffoldForm, allTools, allSkills, toggleArrayItem, isInArray, modelProviders)}
          <div className="flex gap-3 pt-4 sticky bottom-0 bg-surface-800 pb-2">
            <button type="submit" className="flex-1 px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded transition">Create Agent</button>
            <button type="button" onClick={() => setShowScaffoldModal(false)} className="px-6 py-3 bg-surface-700 hover:bg-surface-600 text-surface-300 font-medium rounded transition">Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ========== SHARED FORM FIELDS ==========
function renderFormFields(form, setForm, allTools, allSkills, toggleArrayItem, isInArray, modelProviders = []) {
  const inputClass = "w-full bg-surface-900 border border-surface-700 rounded px-4 py-2.5 text-surface-200 focus:outline-none focus:border-orange-500 text-sm";
  const labelClass = "block text-sm font-semibold text-surface-200 mb-1";

  return (
    <>
      {/* Name */}
      <div>
        <label className={labelClass}>Agent Name <span className="text-red-400">*</span></label>
        <FieldHelper text="Give your agent a name — this is how you'll refer to it across the dashboard" />
        <input type="text" required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Content Strategist, Code Reviewer, Campaign Manager" className={inputClass} />
      </div>

      {/* Role */}
      <div>
        <label className={labelClass}>Role</label>
        <FieldHelper text="The agent's job title — think of this like a position in your org chart" />
        <input type="text" value={form.role || ''} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g., Senior Content Writer, Lead DevOps Engineer" className={inputClass} />
      </div>

      {/* Department */}
      <div>
        <label className={labelClass}>Department <span className="text-red-400">*</span></label>
        <FieldHelper text="Which C-Suite executive does this agent report to?" />
        <select required value={form.department || ''} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputClass}>
          <option value="">Select department...</option>
          {DEPARTMENTS.map(d => (
            <option key={d.id} value={d.id}>{d.label} — {d.desc}</option>
          ))}
        </select>
      </div>

      {/* Goal */}
      <div>
        <label className={labelClass}>Goal</label>
        <FieldHelper text="What is this agent's primary mission? Think use case or KPI" />
        <textarea value={form.goal || ''} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="e.g., Generate 3 SEO-optimized blog posts per week with 90%+ quality score" className={inputClass} rows="3" />
      </div>

      {/* Vibe */}
      <div>
        <label className={labelClass}>Vibe</label>
        <FieldHelper text="How should this agent come across? Think personality, tone, energy" />
        <input type="text" value={form.vibe || ''} onChange={(e) => setForm({ ...form, vibe: e.target.value })} placeholder="e.g., Professional but approachable, Data-driven and precise" className={inputClass} />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {VIBE_PRESETS.map(v => (
            <button key={v} type="button" onClick={() => setForm({ ...form, vibe: form.vibe ? `${form.vibe}, ${v.toLowerCase()}` : v.toLowerCase() })} className="px-2.5 py-1 text-xs rounded bg-surface-800 text-surface-400 hover:text-orange-400 hover:bg-surface-700 transition">{v}</button>
          ))}
        </div>
      </div>

      {/* System Prompt */}
      <div>
        <label className={labelClass}>System Prompt / Agent Instructions</label>
        <FieldHelper text="Detailed behavior instructions — how the agent works, what it prioritizes, what it avoids" />
        <textarea value={form.system_prompt || ''} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} placeholder="You are a [role] responsible for... You always... You never..." className={`${inputClass} font-mono`} rows="8" />
      </div>

      {/* Framework */}
      <div>
        <label className={labelClass}>Runtime / Framework</label>
        <FieldHelper text="Where this agent runs (Hermes Workspace, OpenClaw, CLI harness, etc.)" />
        <select value={form.framework || 'crewai'} onChange={(e) => setForm({ ...form, framework: e.target.value })} className={inputClass}>
          {FRAMEWORKS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className={labelClass}>Model provider</label>
          <FieldHelper text="API backend (Ollama Cloud, Anthropic, etc.) — separate from runtime" />
          <select
            value={form.model_provider_id ?? ''}
            onChange={(e) => setForm({ ...form, model_provider_id: e.target.value ? Number(e.target.value) : null })}
            className={inputClass}
          >
            <option value="">— None / harness default —</option>
            {modelProviders.map((p) => (
              <option key={p.id} value={p.id}>{p.label} ({p.slug})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Model id</label>
          <FieldHelper text="e.g. llama3.3, claude-sonnet-…, gpt-4.1" />
          <input
            type="text"
            value={form.model_id || ''}
            onChange={(e) => setForm({ ...form, model_id: e.target.value })}
            placeholder={modelProviders.find(p => p.id === form.model_provider_id)?.default_model || ''}
            className={inputClass}
          />
        </div>
      </div>

      {/* Two columns: Tools + Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Assigned Tools */}
        <div>
          <label className={labelClass}>Assigned Tools</label>
          <FieldHelper text="Tools this agent can use freely — no permission needed" />
          <div className="mt-2 max-h-40 overflow-y-auto space-y-1 bg-surface-900 border border-surface-700 rounded p-3">
            {allTools.length === 0 ? (
              <p className="text-xs text-surface-500">No tools available</p>
            ) : allTools.map(tool => (
              <label key={tool.id} className="flex items-center gap-2 text-sm text-surface-300 cursor-pointer hover:text-surface-100">
                <input type="checkbox" checked={isInArray('assigned_tools', tool.id, form)} onChange={() => toggleArrayItem('assigned_tools', tool.id, setForm, form)} className="accent-orange-500" />
                <span>{tool.name}</span>
                <span className="text-xs text-surface-600 ml-auto">{tool.type}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Assigned Skills */}
        <div>
          <label className={labelClass}>Assigned Skills</label>
          <FieldHelper text="Skills this agent has pre-loaded — ready to use anytime" />
          <div className="mt-2 max-h-40 overflow-y-auto space-y-1 bg-surface-900 border border-surface-700 rounded p-3">
            {allSkills.length === 0 ? (
              <p className="text-xs text-surface-500">No skills available</p>
            ) : allSkills.map(skill => (
              <label key={skill.id} className="flex items-center gap-2 text-sm text-surface-300 cursor-pointer hover:text-surface-100">
                <input type="checkbox" checked={isInArray('assigned_skills', skill.id, form)} onChange={() => toggleArrayItem('assigned_skills', skill.id, setForm, form)} className="accent-orange-500" />
                <span>{skill.name}</span>
                <span className="text-xs text-surface-600 ml-auto">{skill.type}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row: Memory + Agent Type + Stage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Memory Toggle */}
        <div>
          <label className={labelClass}>Memory</label>
          <FieldHelper text="Should this agent remember previous interactions?" />
          <button type="button" onClick={() => setForm({ ...form, memory_enabled: form.memory_enabled ? 0 : 1 })} className={`mt-2 w-full py-2.5 rounded text-sm font-semibold transition ${form.memory_enabled ? 'bg-orange-600 text-white' : 'bg-surface-800 text-surface-400 border border-surface-700'}`}>
            {form.memory_enabled ? '✓ Memory Enabled' : 'Memory Disabled'}
          </button>
        </div>

        {/* Agent Type */}
        <div>
          <label className={labelClass}>Agent Type</label>
          <FieldHelper text="Team lead who delegates, or worker who executes?" />
          <div className="mt-2 flex gap-2">
            {['worker', 'manager'].map(t => (
              <button key={t} type="button" onClick={() => setForm({ ...form, agent_type: t })} className={`flex-1 py-2.5 rounded text-sm font-semibold transition ${form.agent_type === t ? 'bg-orange-600 text-white' : 'bg-surface-800 text-surface-400 border border-surface-700'}`}>
                {t === 'manager' ? '👑 Manager' : '⚙️ Worker'}
              </button>
            ))}
          </div>
        </div>

        {/* Stage */}
        <div>
          <label className={labelClass}>Development Stage</label>
          <FieldHelper text="Where is this agent in the development lifecycle?" />
          <select value={form.stage || 'ideate'} onChange={(e) => setForm({ ...form, stage: e.target.value })} className={`mt-2 ${inputClass}`}>
            {STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}
