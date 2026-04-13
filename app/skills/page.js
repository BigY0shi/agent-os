'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Trash2, Edit2, Play, Square, Download, Copy, Check, Zap, Wrench, Server } from 'lucide-react';
import Modal from '@/components/Modal';

const SKILL_TYPES = ['automation', 'research', 'content', 'code', 'data', 'custom'];
const SKILL_STATUSES = ['active', 'draft', 'testing', 'disabled'];
const TOOL_TYPES = ['mcp', 'api', 'cli', 'function', 'webhook'];
const MCP_TRANSPORTS = ['stdio', 'sse', 'http'];

function FieldHelper({ text }) {
  return <p className="text-xs text-surface-500 mt-1 leading-relaxed">{text}</p>;
}

function generateSkillMd(skill) {
  const kebab = (skill.name || 'unnamed').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
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

export default function SkillsPage() {
  const [loading, setLoading] = useState(true);

  // Data
  const [skills, setSkills] = useState([]);
  const [tools, setTools] = useState([]);
  const [mcpServers, setMcpServers] = useState([]);
  const [agents, setAgents] = useState([]);

  // Skill modal
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [skillForm, setSkillForm] = useState({
    name: '', description: '', type: 'custom', agent_id: '',
    trigger_keywords: '', file_path: '', version: '1.0', status: 'draft',
  });

  // Tool modal
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingTool, setEditingTool] = useState(null);
  const [toolForm, setToolForm] = useState({
    name: '', description: '', type: 'api', endpoint: '', config: '', agent_id: '',
  });

  // MCP modal
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [editingMcp, setEditingMcp] = useState(null);
  const [mcpForm, setMcpForm] = useState({
    name: '', description: '', transport: 'stdio', command: '', args: '', env: '',
  });
  const [mcpRunning, setMcpRunning] = useState({});

  // Filters
  const [skillSearch, setSkillSearch] = useState('');
  const [toolSearch, setToolSearch] = useState('');

  // Export
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => { fetchAllData(); }, []);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [skillsRes, toolsRes, mcpRes, agentsRes] = await Promise.all([
        fetch('/api/skills'), fetch('/api/tools'), fetch('/api/mcp-servers'), fetch('/api/agents'),
      ]);
      const [skillsData, toolsData, mcpData, agentsData] = await Promise.all([
        skillsRes.json(), toolsRes.json(), mcpRes.json(), agentsRes.json(),
      ]);
      setSkills(Array.isArray(skillsData) ? skillsData : []);
      setTools(Array.isArray(toolsData) ? toolsData : []);
      setMcpServers(Array.isArray(mcpData) ? mcpData : []);
      setAgents(Array.isArray(agentsData) ? agentsData : []);

      // Init MCP running states
      const running = {};
      (Array.isArray(mcpData) ? mcpData : []).forEach(s => { running[s.id] = s.status === 'running'; });
      setMcpRunning(running);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally { setLoading(false); }
  };

  // ===== SKILLS =====
  const openNewSkill = () => {
    setEditingSkill(null);
    setSkillForm({ name: '', description: '', type: 'custom', agent_id: '', trigger_keywords: '', file_path: '', version: '1.0', status: 'draft' });
    setShowSkillModal(true);
  };

  const openEditSkill = (skill) => {
    setEditingSkill(skill);
    setSkillForm({
      name: skill.name, description: skill.description || '', type: skill.type || 'custom',
      agent_id: skill.agent_id || '', trigger_keywords: skill.trigger_keywords || '',
      file_path: skill.file_path || '', version: skill.version || '1.0', status: skill.status || 'draft',
    });
    setShowSkillModal(true);
  };

  const handleSkillSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingSkill ? `/api/skills?id=${editingSkill.id}` : '/api/skills';
      const method = editingSkill ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(skillForm) });
      if (!res.ok) throw new Error('Failed');
      setShowSkillModal(false);
      fetchAllData();
    } catch (err) { console.error(err); }
  };

  const deleteSkill = async (id) => {
    if (!confirm('Delete this skill?')) return;
    await fetch(`/api/skills?id=${id}`, { method: 'DELETE' });
    fetchAllData();
  };

  const handleExportSkillMd = (skill) => {
    const md = generateSkillMd(skill);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skill.name.toLowerCase().replace(/\s+/g, '-')}-SKILL.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopySkillMd = (skill) => {
    navigator.clipboard.writeText(generateSkillMd(skill));
    setCopiedId(skill.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ===== TOOLS =====
  const openNewTool = () => {
    setEditingTool(null);
    setToolForm({ name: '', description: '', type: 'api', endpoint: '', config: '', agent_id: '' });
    setShowToolModal(true);
  };

  const openEditTool = (tool) => {
    setEditingTool(tool);
    setToolForm({
      name: tool.name, description: tool.description || '', type: tool.type || 'api',
      endpoint: tool.endpoint || '', config: tool.config || '', agent_id: tool.agent_id || '',
    });
    setShowToolModal(true);
  };

  const handleToolSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingTool ? `/api/tools?id=${editingTool.id}` : '/api/tools';
      const method = editingTool ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toolForm) });
      if (!res.ok) throw new Error('Failed');
      setShowToolModal(false);
      fetchAllData();
    } catch (err) { console.error(err); }
  };

  const deleteTool = async (id) => {
    if (!confirm('Delete this tool?')) return;
    await fetch(`/api/tools?id=${id}`, { method: 'DELETE' });
    fetchAllData();
  };

  // ===== MCP =====
  const openNewMcp = () => {
    setEditingMcp(null);
    setMcpForm({ name: '', description: '', transport: 'stdio', command: '', args: '', env: '' });
    setShowMcpModal(true);
  };

  const openEditMcp = (mcp) => {
    setEditingMcp(mcp);
    setMcpForm({
      name: mcp.name, description: mcp.description || '', transport: mcp.transport || 'stdio',
      command: mcp.command || '', args: mcp.args || '', env: mcp.env || '',
    });
    setShowMcpModal(true);
  };

  const handleMcpSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingMcp ? `/api/mcp-servers?id=${editingMcp.id}` : '/api/mcp-servers';
      const method = editingMcp ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mcpForm) });
      if (!res.ok) throw new Error('Failed');
      setShowMcpModal(false);
      fetchAllData();
    } catch (err) { console.error(err); }
  };

  const deleteMcp = async (id) => {
    if (!confirm('Delete this MCP server?')) return;
    await fetch(`/api/mcp-servers?id=${id}`, { method: 'DELETE' });
    fetchAllData();
  };

  const toggleMcpServer = async (id) => {
    const isRunning = mcpRunning[id];
    const action = isRunning ? 'stop' : 'start';
    try {
      await fetch(`/api/mcp-servers?id=${id}&action=${action}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      setMcpRunning({ ...mcpRunning, [id]: !isRunning });
    } catch (err) { console.error(err); }
  };

  // Filtered lists
  const filteredSkills = skills.filter(s => s.name?.toLowerCase().includes(skillSearch.toLowerCase()) || s.description?.toLowerCase().includes(skillSearch.toLowerCase()));
  const filteredTools = tools.filter(t => t.name?.toLowerCase().includes(toolSearch.toLowerCase()) || t.description?.toLowerCase().includes(toolSearch.toLowerCase()));

  const inputClass = "w-full bg-surface-900 border border-surface-700 rounded px-4 py-2.5 text-surface-200 focus:outline-none focus:border-orange-500 text-sm";
  const labelClass = "block text-sm font-semibold text-surface-200 mb-1";

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 text-surface-200 flex items-center justify-center">
        <p className="text-surface-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-950 text-surface-200">
      {/* Header */}
      <div className="border-b border-surface-800 bg-surface-900 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-surface-100 mb-2">Skills & Tools</h1>
          <p className="text-surface-400 text-sm">Manage agent capabilities — skills they can perform and tools they can use</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Two-column layout: Skills + Tools */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">

          {/* ===== LEFT: SKILLS ===== */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap size={20} className="text-orange-500" />
                <h2 className="text-xl font-bold text-surface-100">Skills</h2>
                <span className="text-xs text-surface-500 bg-surface-800 rounded px-2 py-0.5">{skills.length}</span>
              </div>
              <button onClick={openNewSkill} className="btn-accent px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5">
                <Plus size={14} /> Add Skill
              </button>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-600" />
              <input type="text" placeholder="Search skills..." value={skillSearch} onChange={e => setSkillSearch(e.target.value)} className="w-full bg-surface-900 border border-surface-700 rounded pl-9 pr-4 py-2 text-surface-200 placeholder-surface-600 focus:outline-none focus:border-orange-500 text-sm" />
            </div>

            {/* Skill cards */}
            <div className="space-y-3">
              {filteredSkills.length === 0 ? (
                <div className="text-center py-8 text-surface-500 text-sm">No skills found</div>
              ) : filteredSkills.map(skill => (
                <div key={skill.id} className="bg-surface-900 border border-surface-800 rounded-lg p-4 hover:border-surface-700 transition group">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-bold text-surface-100 text-sm">{skill.name}</h3>
                      <p className="text-xs text-surface-400 line-clamp-2 mt-1">{skill.description}</p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => handleCopySkillMd(skill)} className="p-1.5 text-surface-500 hover:text-orange-400 rounded" title="Copy SKILL.md">
                        {copiedId === skill.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <button onClick={() => handleExportSkillMd(skill)} className="p-1.5 text-surface-500 hover:text-orange-400 rounded" title="Download SKILL.md">
                        <Download size={14} />
                      </button>
                      <button onClick={() => openEditSkill(skill)} className="p-1.5 text-surface-500 hover:text-blue-400 rounded" title="Edit">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => deleteSkill(skill.id)} className="p-1.5 text-surface-500 hover:text-red-400 rounded" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 text-xs rounded bg-surface-800 text-surface-400">{skill.type}</span>
                    <span className={`px-2 py-0.5 text-xs rounded ${skill.status === 'active' ? 'bg-green-900/30 text-green-400' : skill.status === 'testing' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-surface-800 text-surface-500'}`}>{skill.status}</span>
                    {skill.agent_name && <span className="px-2 py-0.5 text-xs rounded bg-blue-900/20 text-blue-300">{skill.agent_name}</span>}
                    {skill.version && <span className="text-xs text-surface-600">v{skill.version}</span>}
                    {skill.run_count > 0 && <span className="text-xs text-surface-600">{skill.run_count} runs</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== RIGHT: TOOLS ===== */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wrench size={20} className="text-blue-400" />
                <h2 className="text-xl font-bold text-surface-100">Tools</h2>
                <span className="text-xs text-surface-500 bg-surface-800 rounded px-2 py-0.5">{tools.length}</span>
              </div>
              <button onClick={openNewTool} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 transition">
                <Plus size={14} /> Add Tool
              </button>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-600" />
              <input type="text" placeholder="Search tools..." value={toolSearch} onChange={e => setToolSearch(e.target.value)} className="w-full bg-surface-900 border border-surface-700 rounded pl-9 pr-4 py-2 text-surface-200 placeholder-surface-600 focus:outline-none focus:border-orange-500 text-sm" />
            </div>

            {/* Tool cards */}
            <div className="space-y-3">
              {filteredTools.length === 0 ? (
                <div className="text-center py-8 text-surface-500 text-sm">No tools found</div>
              ) : filteredTools.map(tool => (
                <div key={tool.id} className="bg-surface-900 border border-surface-800 rounded-lg p-4 hover:border-surface-700 transition group">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-bold text-surface-100 text-sm">{tool.name}</h3>
                      <p className="text-xs text-surface-400 line-clamp-1 mt-1">{tool.description}</p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => openEditTool(tool)} className="p-1.5 text-surface-500 hover:text-blue-400 rounded" title="Edit">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => deleteTool(tool.id)} className="p-1.5 text-surface-500 hover:text-red-400 rounded" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 text-xs rounded bg-surface-800 text-surface-400">{tool.type}</span>
                    {tool.endpoint && <span className="text-xs text-surface-600 font-mono truncate max-w-48">{tool.endpoint}</span>}
                    <span className={`px-2 py-0.5 text-xs rounded ${tool.status === 'connected' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{tool.status || 'connected'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ===== MCP SERVERS ===== */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Server size={20} className="text-purple-400" />
              <h2 className="text-xl font-bold text-surface-100">MCP Servers</h2>
              <span className="text-xs text-surface-500 bg-surface-800 rounded px-2 py-0.5">{mcpServers.length}</span>
            </div>
            <button onClick={openNewMcp} className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 transition">
              <Plus size={14} /> Add Server
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mcpServers.map(server => (
              <div key={server.id} className="bg-surface-900 border border-surface-800 rounded-lg p-4 group">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-surface-100 text-sm">{server.name}</h3>
                    <p className="text-xs text-surface-400 mt-1">{server.description}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggleMcpServer(server.id)} className={`p-1.5 rounded transition ${mcpRunning[server.id] ? 'text-green-400 hover:text-red-400' : 'text-surface-500 hover:text-green-400'}`} title={mcpRunning[server.id] ? 'Stop' : 'Start'}>
                      {mcpRunning[server.id] ? <Square size={14} /> : <Play size={14} />}
                    </button>
                    <button onClick={() => openEditMcp(server)} className="p-1.5 text-surface-500 hover:text-blue-400 rounded opacity-0 group-hover:opacity-100 transition"><Edit2 size={14} /></button>
                    <button onClick={() => deleteMcp(server.id)} className="p-1.5 text-surface-500 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="px-2 py-0.5 rounded bg-surface-800 text-surface-400">{server.transport}</span>
                  <span className="text-surface-600 font-mono">{server.command}</span>
                  <span className={`px-2 py-0.5 rounded ${mcpRunning[server.id] ? 'bg-green-900/30 text-green-400' : 'bg-surface-800 text-surface-500'}`}>
                    {mcpRunning[server.id] ? 'Running' : 'Stopped'}
                  </span>
                  {server.tools_count > 0 && <span className="text-surface-600">{server.tools_count} tools</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== SKILL MODAL ===== */}
      <Modal isOpen={showSkillModal} onClose={() => setShowSkillModal(false)} title={editingSkill ? 'Edit Skill' : 'Add Skill'} size="lg">
        <form onSubmit={handleSkillSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Skill Name <span className="text-red-400">*</span></label>
            <FieldHelper text="What capability does this skill provide to an agent?" />
            <input type="text" required value={skillForm.name} onChange={e => setSkillForm({ ...skillForm, name: e.target.value })} placeholder="e.g., Content Writing, Data Analysis" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <FieldHelper text="A clear summary of what this skill does and when it should be used" />
            <textarea value={skillForm.description} onChange={e => setSkillForm({ ...skillForm, description: e.target.value })} placeholder="Describe the skill's purpose and capabilities..." className={inputClass} rows="3" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Type</label>
              <select value={skillForm.type} onChange={e => setSkillForm({ ...skillForm, type: e.target.value })} className={inputClass}>
                {SKILL_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select value={skillForm.status} onChange={e => setSkillForm({ ...skillForm, status: e.target.value })} className={inputClass}>
                {SKILL_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Assigned Agent</label>
            <FieldHelper text="Which agent owns this skill? Leave blank for shared skills" />
            <select value={skillForm.agent_id} onChange={e => setSkillForm({ ...skillForm, agent_id: e.target.value })} className={inputClass}>
              <option value="">Shared (no agent)</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Trigger Keywords</label>
            <FieldHelper text="Comma-separated keywords that activate this skill" />
            <input type="text" value={skillForm.trigger_keywords} onChange={e => setSkillForm({ ...skillForm, trigger_keywords: e.target.value })} placeholder="e.g., write, blog, content, article" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>File Path</label>
              <input type="text" value={skillForm.file_path} onChange={e => setSkillForm({ ...skillForm, file_path: e.target.value })} placeholder="/skills/my_skill.js" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Version</label>
              <input type="text" value={skillForm.version} onChange={e => setSkillForm({ ...skillForm, version: e.target.value })} placeholder="1.0" className={inputClass} />
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" className="flex-1 px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-medium rounded transition">{editingSkill ? 'Update Skill' : 'Create Skill'}</button>
            <button type="button" onClick={() => setShowSkillModal(false)} className="px-6 py-2.5 bg-surface-800 hover:bg-surface-700 text-surface-300 font-medium rounded transition">Cancel</button>
          </div>
        </form>
      </Modal>

      {/* ===== TOOL MODAL ===== */}
      <Modal isOpen={showToolModal} onClose={() => setShowToolModal(false)} title={editingTool ? 'Edit Tool' : 'Add Tool'} size="lg">
        <form onSubmit={handleToolSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Tool Name <span className="text-red-400">*</span></label>
            <FieldHelper text="The tool's display name as agents will reference it" />
            <input type="text" required value={toolForm.name} onChange={e => setToolForm({ ...toolForm, name: e.target.value })} placeholder="e.g., GitHub API, Slack Bot" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <textarea value={toolForm.description} onChange={e => setToolForm({ ...toolForm, description: e.target.value })} placeholder="What does this tool do?" className={inputClass} rows="2" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Type</label>
              <select value={toolForm.type} onChange={e => setToolForm({ ...toolForm, type: e.target.value })} className={inputClass}>
                {TOOL_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Assigned Agent</label>
              <select value={toolForm.agent_id} onChange={e => setToolForm({ ...toolForm, agent_id: e.target.value })} className={inputClass}>
                <option value="">Shared (no agent)</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Endpoint</label>
            <input type="text" value={toolForm.endpoint} onChange={e => setToolForm({ ...toolForm, endpoint: e.target.value })} placeholder="https://api.example.com" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Config (JSON)</label>
            <textarea value={toolForm.config} onChange={e => setToolForm({ ...toolForm, config: e.target.value })} placeholder='{"key": "value"}' className={`${inputClass} font-mono`} rows="3" />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" className="flex-1 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition">{editingTool ? 'Update Tool' : 'Create Tool'}</button>
            <button type="button" onClick={() => setShowToolModal(false)} className="px-6 py-2.5 bg-surface-800 hover:bg-surface-700 text-surface-300 font-medium rounded transition">Cancel</button>
          </div>
        </form>
      </Modal>

      {/* ===== MCP MODAL ===== */}
      <Modal isOpen={showMcpModal} onClose={() => setShowMcpModal(false)} title={editingMcp ? 'Edit MCP Server' : 'Add MCP Server'} size="lg">
        <form onSubmit={handleMcpSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Server Name <span className="text-red-400">*</span></label>
            <input type="text" required value={mcpForm.name} onChange={e => setMcpForm({ ...mcpForm, name: e.target.value })} placeholder="e.g., filesystem, web-search" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <textarea value={mcpForm.description} onChange={e => setMcpForm({ ...mcpForm, description: e.target.value })} placeholder="What does this MCP server provide?" className={inputClass} rows="2" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Transport</label>
              <select value={mcpForm.transport} onChange={e => setMcpForm({ ...mcpForm, transport: e.target.value })} className={inputClass}>
                {MCP_TRANSPORTS.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Command</label>
              <input type="text" value={mcpForm.command} onChange={e => setMcpForm({ ...mcpForm, command: e.target.value })} placeholder="npx mcp-server" className={`${inputClass} font-mono`} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Args (JSON)</label>
              <textarea value={mcpForm.args} onChange={e => setMcpForm({ ...mcpForm, args: e.target.value })} placeholder='["--port", "8000"]' className={`${inputClass} font-mono`} rows="2" />
            </div>
            <div>
              <label className={labelClass}>Env (JSON)</label>
              <textarea value={mcpForm.env} onChange={e => setMcpForm({ ...mcpForm, env: e.target.value })} placeholder='{"DEBUG": "1"}' className={`${inputClass} font-mono`} rows="2" />
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" className="flex-1 px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded transition">{editingMcp ? 'Update Server' : 'Create Server'}</button>
            <button type="button" onClick={() => setShowMcpModal(false)} className="px-6 py-2.5 bg-surface-800 hover:bg-surface-700 text-surface-300 font-medium rounded transition">Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
