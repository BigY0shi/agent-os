'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Workflow,
  Plus,
  RefreshCw,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  ChevronUp,
  ChevronDown,
  Trash2,
  Download,
  AlertCircle,
  GitBranch,
} from 'lucide-react';
import Modal from '@/components/Modal';
import { validatePipelineDefinition } from '@/lib/pipelineValidate';
import {
  parsePipelineDefinition,
  nextNodeId,
  definitionForSave,
  inputsToString,
  parseInputsJson,
  skillLabel,
  linearEdgesFromNodes,
} from '@/lib/pipelineEditorHelpers';

const PIPELINE_STATUSES = ['draft', 'active', 'archived'];
const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

function statusIcon(status) {
  if (status === 'succeeded') return <CheckCircle2 className="text-emerald-400 shrink-0" size={16} />;
  if (status === 'failed' || status === 'cancelled') return <XCircle className="text-red-400 shrink-0" size={16} />;
  if (status === 'running') return <Loader2 className="text-amber-300 animate-spin shrink-0" size={16} />;
  return <Play className="text-surface-500 shrink-0" size={16} />;
}

function JsonBlock({ label, value }) {
  let text = '—';
  if (value != null && value !== '') {
    try {
      text = typeof value === 'string' ? JSON.stringify(JSON.parse(value), null, 2) : JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return (
    <div>
      <div className="text-xs text-surface-500 mb-1">{label}</div>
      <pre className="text-xs text-surface-300 bg-surface-950/80 p-2 rounded-md overflow-x-auto max-h-36">{text}</pre>
    </div>
  );
}

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState([]);
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [runs, setRuns] = useState([]);
  const [globalRuns, setGlobalRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [panelTab, setPanelTab] = useState('editor'); // editor | runs

  const [showModal, setShowModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });

  // Editor state (synced when selected changes)
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('draft');
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [advancedEdges, setAdvancedEdges] = useState(false);
  const [nodeInputDrafts, setNodeInputDrafts] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [runInput, setRunInput] = useState('{\n  "topic": "demo"\n}');

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes, gRes] = await Promise.all([
        fetch('/api/pipelines'),
        fetch('/api/skills'),
        fetch('/api/pipeline-runs?limit=30'),
      ]);
      const [pData, sData, gData] = await Promise.all([pRes.json(), sRes.json(), gRes.json()]);
      setPipelines(Array.isArray(pData) ? pData : []);
      setSkills(Array.isArray(sData) ? sData : []);
      setGlobalRuns(Array.isArray(gData) ? gData : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (pipelineId) => {
    const res = await fetch(`/api/pipelines/${pipelineId}/runs`);
    const data = await res.json();
    setRuns(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (!selected?.id) {
      setRuns([]);
      setSelectedRun(null);
      return;
    }
    loadRuns(selected.id);
  }, [selected?.id, loadRuns]);

  const syncEditorFromPipeline = useCallback((p) => {
    const def = parsePipelineDefinition(p.definition_json);
    setEditName(p.name || '');
    setEditDescription(p.description || '');
    setEditStatus(p.status || 'draft');
    const ns = (def.nodes || []).map((n) => ({
      id: n.id,
      skillId: n.skillId,
      skillName: n.skillName,
      inputs: n.inputs || {},
      notes: n.notes,
    }));
    setNodes(ns);
    const es = def.edges || [];
    setEdges(es);
    setAdvancedEdges(es.length > 0 && JSON.stringify(es) !== JSON.stringify(linearEdgesFromNodes(ns)));
    const drafts = {};
    ns.forEach((n) => {
      drafts[n.id] = inputsToString(n.inputs);
    });
    setNodeInputDrafts(drafts);
    setSaveError(null);
  }, []);

  useEffect(() => {
    if (selected) syncEditorFromPipeline(selected);
  }, [selected, syncEditorFromPipeline]);

  const builtDefinition = useMemo(() => {
    const parsedNodes = nodes.map((n) => {
      const inputs = parseInputsJson(nodeInputDrafts[n.id]);
      return {
        ...n,
        skillId: Number(n.skillId),
        inputs: inputs ?? n.inputs ?? {},
      };
    });
    return definitionForSave(
      { version: 1, name: editName, nodes: parsedNodes, edges },
      { useAdvancedEdges: advancedEdges }
    );
  }, [nodes, edges, advancedEdges, nodeInputDrafts, editName]);

  const validation = useMemo(() => validatePipelineDefinition(builtDefinition), [builtDefinition]);

  const selectPipeline = (p) => {
    setSelected(p);
    setPanelTab('editor');
    setSelectedRun(null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    const firstSkill = skills[0];
    const sid = firstSkill?.id ?? 1;
    const definition = {
      version: 1,
      name: createForm.name.trim(),
      nodes: [{ id: 'step1', skillId: sid, inputs: {} }],
      edges: [],
    };
    const res = await fetch('/api/pipelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: createForm.name.trim(),
        description: createForm.description,
        definition,
        status: 'draft',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Create failed');
      return;
    }
    const created = await res.json();
    setShowModal(false);
    setCreateForm({ name: '', description: '' });
    await loadPipelines();
    selectPipeline(created);
  };

  const handleSave = async () => {
    if (!selected) return;
    for (const n of nodes) {
      const parsed = parseInputsJson(nodeInputDrafts[n.id]);
      if (parsed === null) {
        setSaveError(`Invalid JSON inputs on node "${n.id}"`);
        return;
      }
    }
    if (!validation.ok) {
      setSaveError(validation.error);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/pipelines/${selected.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName.trim(),
        description: editDescription,
        status: editStatus,
        definition: builtDefinition,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setSaveError(err.error || 'Save failed');
      return;
    }
    const updated = await res.json();
    setSelected(updated);
    await loadPipelines();
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(builtDefinition, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline-${selected?.id || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addNode = () => {
    const id = nextNodeId(nodes);
    const firstSkill = skills[0];
    setNodes((prev) => [...prev, { id, skillId: firstSkill?.id ?? '', inputs: {} }]);
    setNodeInputDrafts((prev) => ({ ...prev, [id]: '{}' }));
  };

  const removeNode = (index) => {
    const removed = nodes[index];
    setNodes((prev) => prev.filter((_, i) => i !== index));
    setEdges((prev) => prev.filter((e) => e.from !== removed.id && e.to !== removed.id));
    setNodeInputDrafts((prev) => {
      const next = { ...prev };
      delete next[removed.id];
      return next;
    });
  };

  const moveNode = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= nodes.length) return;
    setNodes((prev) => {
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const updateNode = (index, patch) => {
    setNodes((prev) => prev.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  };

  const addEdge = () => {
    if (nodes.length < 2) return;
    setEdges((prev) => [...prev, { from: nodes[0].id, to: nodes[1].id, port: 'default' }]);
  };

  const queueRun = async () => {
    if (!selected) return;
    let input = {};
    try {
      input = JSON.parse(runInput);
    } catch {
      alert('Invalid run input JSON');
      return;
    }
    const res = await fetch(`/api/pipelines/${selected.id}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Queue failed');
      return;
    }
    const run = await res.json();
    await loadRuns(selected.id);
    await loadPipelines();
    setSelectedRun(run);
    setPanelTab('runs');
  };

  const patchRun = async (runId, patch) => {
    if (!selected) return;
    const res = await fetch(`/api/pipelines/${selected.id}/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Update failed');
      return;
    }
    const updated = await res.json();
    setSelectedRun(updated);
    await loadRuns(selected.id);
    await loadPipelines();
  };

  const demoRun = async () => {
    if (!selected) return;
    const res = await fetch(`/api/pipelines/${selected.id}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { topic: 'demo' } }),
    });
    if (!res.ok) return;
    const run = await res.json();
    await patchRun(run.id, { status: 'running' });
    await patchRun(run.id, { status: 'succeeded', output: { message: 'demo complete', steps: nodes.length } });
    setPanelTab('runs');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
            <Workflow className="text-[#FF6B00]" size={28} />
            Skill pipelines
          </h1>
          <p className="text-surface-400 text-sm mt-1">
            Multi-step composition · run console ·{' '}
            <Link href="/audit?resource_type=pipeline" className="text-orange-400 underline">
              audit
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => loadPipelines()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-800 text-surface-200 hover:bg-surface-700 border border-surface-600/40">
            <RefreshCw size={16} /> Refresh
          </button>
          <button type="button" onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600">
            <Plus size={16} /> New pipeline
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        {/* Pipeline list */}
        <div className="lg:col-span-3 rounded-lg border border-surface-600/30 bg-surface-900/40 p-4">
          <h2 className="text-surface-200 font-medium mb-3 text-sm uppercase tracking-wide">Pipelines</h2>
          {loading ? (
            <p className="text-surface-500 text-sm">Loading…</p>
          ) : pipelines.length === 0 ? (
            <p className="text-surface-500 text-sm">No pipelines yet.</p>
          ) : (
            <ul className="space-y-2 max-h-[480px] overflow-y-auto">
              {pipelines.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectPipeline(p)}
                    className={`w-full text-left px-3 py-2 rounded-md border transition ${
                      selected?.id === p.id ? 'border-[#FF6B00]/60 bg-[#FF6B00]/10' : 'border-surface-700/50 bg-surface-950/50 hover:border-surface-600'
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-surface-100 font-medium text-sm">{p.name}</span>
                      <span className="text-[10px] uppercase text-surface-500">{p.status}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Editor / runs */}
        <div className="lg:col-span-9 rounded-lg border border-surface-600/30 bg-surface-900/40 p-4 min-h-[420px]">
          {!selected ? (
            <p className="text-surface-500 text-sm">Select a pipeline to edit or run.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-surface-800 pb-3 mb-4">
                <button type="button" onClick={() => setPanelTab('editor')} className={`px-3 py-1.5 text-sm rounded-md ${panelTab === 'editor' ? 'bg-[#FF6B00]/20 text-orange-300' : 'text-surface-400 hover:bg-surface-800'}`}>
                  Editor
                </button>
                <button type="button" onClick={() => setPanelTab('runs')} className={`px-3 py-1.5 text-sm rounded-md ${panelTab === 'runs' ? 'bg-[#FF6B00]/20 text-orange-300' : 'text-surface-400 hover:bg-surface-800'}`}>
                  Runs ({runs.length})
                </button>
                <div className="ml-auto flex flex-wrap gap-2">
                  {panelTab === 'editor' && (
                    <>
                      <button type="button" onClick={exportJson} disabled={!validation.ok} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-surface-800 hover:bg-surface-700 border border-surface-600/40 disabled:opacity-40">
                        <Download size={14} /> Export JSON
                      </button>
                      <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600 disabled:opacity-50">
                        <Save size={14} /> {saving ? 'Saving…' : 'Save pipeline'}
                      </button>
                    </>
                  )}
                  {panelTab === 'runs' && (
                    <>
                      <button type="button" onClick={queueRun} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-surface-800 hover:bg-surface-700 border border-surface-600/40">
                        <Play size={14} /> Queue run
                      </button>
                      <button type="button" onClick={demoRun} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-surface-800 hover:bg-surface-700 border border-surface-600/40">
                        Demo (queued→succeeded)
                      </button>
                    </>
                  )}
                </div>
              </div>

              {panelTab === 'editor' && (
                <div className="space-y-4">
                  {(saveError || !validation.ok) && (
                    <div className="flex items-start gap-2 text-sm text-red-300 bg-red-950/30 border border-red-800/40 rounded-md px-3 py-2">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" />
                      <span>{saveError || validation.error}</span>
                    </div>
                  )}

                  <div className="grid sm:grid-cols-3 gap-3">
                    <label className="text-sm text-surface-300 sm:col-span-1">
                      Name
                      <input className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </label>
                    <label className="text-sm text-surface-300 sm:col-span-1">
                      Status
                      <select className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                        {PIPELINE_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-surface-300 sm:col-span-1">
                      Description
                      <input className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                    </label>
                  </div>

                  <div className="flex items-center justify-between">
                    <h3 className="text-surface-200 font-medium text-sm">Steps ({nodes.length})</h3>
                    <button type="button" onClick={addNode} className="text-xs px-3 py-1.5 rounded-md bg-surface-800 hover:bg-surface-700 text-surface-200">
                      + Add step
                    </button>
                  </div>

                  <ul className="space-y-3">
                    {nodes.map((node, index) => (
                      <li key={node.id} className="rounded-md border border-surface-700/50 bg-surface-950/60 p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-xs font-mono text-orange-400/90">{node.id}</span>
                          <div className="flex gap-1 ml-auto">
                            <button type="button" onClick={() => moveNode(index, -1)} disabled={index === 0} className="p-1 rounded bg-surface-800 disabled:opacity-30"><ChevronUp size={14} /></button>
                            <button type="button" onClick={() => moveNode(index, 1)} disabled={index === nodes.length - 1} className="p-1 rounded bg-surface-800 disabled:opacity-30"><ChevronDown size={14} /></button>
                            <button type="button" onClick={() => removeNode(index)} disabled={nodes.length <= 1} className="p-1 rounded bg-red-900/30 text-red-300 disabled:opacity-30"><Trash2 size={14} /></button>
                          </div>
                        </div>
                        <select
                          className="w-full px-3 py-2 rounded-md bg-surface-900 border border-surface-600/40 text-surface-100 text-sm mb-2"
                          value={node.skillId}
                          onChange={(e) => updateNode(index, { skillId: e.target.value })}
                        >
                          <option value="">Select skill…</option>
                          {skills.map((s) => (
                            <option key={s.id} value={s.id}>{skillLabel(skills, s.id)}</option>
                          ))}
                        </select>
                        <label className="text-xs text-surface-500 block">
                          Inputs (JSON)
                          <textarea
                            rows={2}
                            className="mt-1 w-full px-2 py-1.5 rounded-md bg-surface-900 border border-surface-600/40 text-surface-100 font-mono text-xs"
                            value={nodeInputDrafts[node.id] ?? '{}'}
                            onChange={(e) => setNodeInputDrafts((prev) => ({ ...prev, [node.id]: e.target.value }))}
                          />
                        </label>
                      </li>
                    ))}
                  </ul>

                  <div className="border-t border-surface-800 pt-4">
                    <label className="flex items-center gap-2 text-sm text-surface-300 mb-3">
                      <input type="checkbox" checked={advancedEdges} onChange={(e) => setAdvancedEdges(e.target.checked)} />
                      <GitBranch size={14} /> Advanced: custom edges (DAG)
                    </label>
                    {advancedEdges ? (
                      <div className="space-y-2">
                        {edges.map((edge, i) => (
                          <div key={`${edge.from}-${edge.to}-${i}`} className="flex gap-2 items-center text-sm">
                            <input className="flex-1 px-2 py-1 rounded bg-surface-950 border border-surface-700 text-surface-100 font-mono text-xs" value={edge.from} onChange={(e) => setEdges((prev) => prev.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} placeholder="from" />
                            <span className="text-surface-500">→</span>
                            <input className="flex-1 px-2 py-1 rounded bg-surface-950 border border-surface-700 text-surface-100 font-mono text-xs" value={edge.to} onChange={(e) => setEdges((prev) => prev.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} placeholder="to" />
                            <button type="button" onClick={() => setEdges((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 p-1"><Trash2 size={14} /></button>
                          </div>
                        ))}
                        <button type="button" onClick={addEdge} className="text-xs text-orange-400 underline">+ Add edge</button>
                      </div>
                    ) : (
                      <p className="text-xs text-surface-500">Linear order: {nodes.map((n) => n.id).join(' → ') || '—'}</p>
                    )}
                  </div>
                </div>
              )}

              {panelTab === 'runs' && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <label className="text-xs text-surface-500 block">
                      Run input (JSON)
                      <textarea rows={4} className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 font-mono text-xs" value={runInput} onChange={(e) => setRunInput(e.target.value)} />
                    </label>
                    <ul className="space-y-2 max-h-64 overflow-y-auto">
                      {runs.length === 0 && <li className="text-surface-500 text-sm">No runs yet.</li>}
                      {runs.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedRun(r)}
                            className={`w-full flex items-center gap-2 text-sm text-left px-3 py-2 rounded-md border ${selectedRun?.id === r.id ? 'border-orange-600/50 bg-orange-950/20' : 'border-surface-800 bg-surface-950/50 hover:border-surface-700'}`}
                          >
                            {statusIcon(r.status)}
                            <span className="font-mono text-xs text-surface-500">#{r.id}</span>
                            <span className="text-surface-200">{r.status}</span>
                            <span className="text-surface-500 text-xs ml-auto truncate">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-md border border-surface-700/50 bg-surface-950/60 p-4 space-y-3">
                    <h3 className="text-surface-200 font-medium text-sm">Run console</h3>
                    {!selectedRun ? (
                      <p className="text-surface-500 text-sm">Select a run.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2 items-center">
                          {statusIcon(selectedRun.status)}
                          <span className="font-mono text-sm text-surface-300">Run #{selectedRun.id}</span>
                          <span className="text-xs uppercase text-surface-500">{selectedRun.status}</span>
                        </div>
                        <JsonBlock label="Input" value={selectedRun.input_json} />
                        <JsonBlock label="Output" value={selectedRun.output_json} />
                        {selectedRun.error && (
                          <div className="text-xs text-red-300 bg-red-950/30 p-2 rounded">{selectedRun.error}</div>
                        )}
                        <div className="flex flex-wrap gap-2 pt-2">
                          {RUN_STATUSES.filter((s) => s !== selectedRun.status).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => patchRun(selectedRun.id, {
                                status: s,
                                ...(s === 'succeeded' ? { output: { ok: true } } : {}),
                                ...(s === 'failed' ? { error: 'Manual failure' } : {}),
                              })}
                              className="text-xs px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-surface-300"
                            >
                              → {s}
                            </button>
                          ))}
                        </div>
                        <Link href={`/audit?resource_type=pipeline_run&resource_id=${selectedRun.id}`} className="text-xs text-orange-400 underline block">
                          View in audit log
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Global recent runs */}
      <div className="rounded-lg border border-surface-600/30 bg-surface-900/40 p-4">
        <h2 className="text-surface-200 font-medium mb-3 text-sm uppercase tracking-wide">Recent runs (all pipelines)</h2>
        {globalRuns.length === 0 ? (
          <p className="text-surface-500 text-sm">No runs yet.</p>
        ) : (
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {globalRuns.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm text-surface-400 py-1 border-b border-surface-800/40">
                {statusIcon(r.status)}
                <span className="font-mono text-xs">#{r.id}</span>
                <span className="text-surface-300">{r.pipeline_name}</span>
                <span className="text-xs">{r.status}</span>
                <span className="text-xs ml-auto">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New pipeline" size="md">
        <form onSubmit={handleCreate} className="space-y-3">
          <p className="text-xs text-surface-500">Creates a draft with one step — add more in the editor.</p>
          <label className="text-sm text-surface-300 block">
            Name
            <input required className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100" value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="text-sm text-surface-300 block">
            Description
            <input className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-surface-300 hover:bg-surface-800">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600">Create & edit</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
