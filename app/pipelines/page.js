'use client';

import { useEffect, useState, useCallback } from 'react';
import { Workflow, Plus, RefreshCw, Play, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState([]);
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [runs, setRuns] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    skillId: '',
    status: 'draft',
  });

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([fetch('/api/pipelines'), fetch('/api/skills')]);
      const [pData, sData] = await Promise.all([pRes.json(), sRes.json()]);
      setPipelines(Array.isArray(pData) ? pData : []);
      setSkills(Array.isArray(sData) ? sData : []);
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
      return;
    }
    loadRuns(selected.id);
  }, [selected?.id, loadRuns]);

  const openCreate = () => {
    const firstSkill = skills[0];
    setForm({
      name: '',
      description: '',
      skillId: firstSkill ? String(firstSkill.id) : '',
      status: 'draft',
    });
    setShowModal(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const sid = Number(form.skillId);
    if (!form.name.trim() || Number.isNaN(sid)) {
      alert('Name and valid skill required');
      return;
    }
    const definition = {
      version: 1,
      name: form.name,
      nodes: [{ id: 'step1', skillId: sid, inputs: {} }],
      edges: [],
    };
    const res = await fetch('/api/pipelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        description: form.description,
        definition,
        status: form.status,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Create failed');
      return;
    }
    const created = await res.json();
    setShowModal(false);
    await loadPipelines();
    setSelected(created);
  };

  const startRun = async () => {
    if (!selected) return;
    const res = await fetch(`/api/pipelines/${selected.id}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { topic: 'demo' } }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Run failed');
      return;
    }
    const run = await res.json();
    await fetch(`/api/pipelines/${selected.id}/runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    await fetch(`/api/pipelines/${selected.id}/runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'succeeded', output: { message: 'demo complete' } }),
    });
    loadRuns(selected.id);
  };

  const statusIcon = (status) => {
    if (status === 'succeeded') return <CheckCircle2 className="text-emerald-400" size={16} />;
    if (status === 'failed' || status === 'cancelled') return <XCircle className="text-red-400" size={16} />;
    if (status === 'running') return <Loader2 className="text-amber-300 animate-spin" size={16} />;
    return <Play className="text-surface-500" size={16} />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
            <Workflow className="text-[#FF6B00]" size={28} />
            Skill pipelines
          </h1>
          <p className="text-surface-400 text-sm mt-1 max-w-2xl">
            Compose skills into auditable DAGs. Spec: <code className="text-orange-400/90">docs/agent-os/SKILL_PIPELINE_SPEC.md</code>. Inspired by{' '}
            <a className="text-orange-400 underline" href="https://github.com/ynulihao/AgentSkillOS" target="_blank" rel="noreferrer">
              AgentSkillOS
            </a>
            .
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => loadPipelines()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-800 text-surface-200 hover:bg-surface-700 border border-surface-600/40"
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600"
          >
            <Plus size={16} /> New pipeline
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-surface-600/30 bg-surface-900/40 p-4">
          <h2 className="text-surface-200 font-medium mb-3">Pipelines</h2>
          {loading ? (
            <p className="text-surface-500 text-sm">Loading…</p>
          ) : pipelines.length === 0 ? (
            <p className="text-surface-500 text-sm">No pipelines yet.</p>
          ) : (
            <ul className="space-y-2">
              {pipelines.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className={`w-full text-left px-3 py-2 rounded-md border transition ${
                      selected?.id === p.id
                        ? 'border-[#FF6B00]/60 bg-[#FF6B00]/10'
                        : 'border-surface-700/50 bg-surface-950/50 hover:border-surface-600'
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-surface-100 font-medium">{p.name}</span>
                      <span className="text-xs uppercase text-surface-500">{p.status}</span>
                    </div>
                    {p.description && <p className="text-xs text-surface-500 mt-1">{p.description}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-surface-600/30 bg-surface-900/40 p-4 space-y-3">
          <h2 className="text-surface-200 font-medium">Runs</h2>
          {!selected && <p className="text-surface-500 text-sm">Select a pipeline.</p>}
          {selected && (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-surface-400 text-sm">Pipeline #{selected.id}</span>
                <button
                  type="button"
                  onClick={startRun}
                  className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-md bg-surface-800 hover:bg-surface-700 border border-surface-600/40"
                >
                  <Play size={14} /> Demo run (queued→running→succeeded)
                </button>
              </div>
              <pre className="text-xs text-surface-500 bg-surface-950/80 p-2 rounded-md overflow-x-auto max-h-40">
                {selected.definition_json}
              </pre>
              <ul className="space-y-2">
                {runs.length === 0 && <li className="text-surface-500 text-sm">No runs yet.</li>}
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm text-surface-300 border-b border-surface-800/60 pb-2">
                    {statusIcon(r.status)}
                    <span className="font-mono text-xs text-surface-500">#{r.id}</span>
                    <span>{r.status}</span>
                    <span className="text-surface-500 text-xs ml-auto">{r.started_at || '—'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New pipeline (linear v1)" size="lg">
        <form onSubmit={handleCreate} className="space-y-3">
          <label className="text-sm text-surface-300 block">
            Name
            <input
              required
              className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="text-sm text-surface-300 block">
            Description
            <input
              className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <label className="text-sm text-surface-300 block">
            First skill step
            <select
              required
              className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              value={form.skillId}
              onChange={(e) => setForm((f) => ({ ...f, skillId: e.target.value }))}
            >
              <option value="">Select skill…</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-surface-300 block">
            Status
            <select
              className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-surface-300 hover:bg-surface-800">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600">
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
