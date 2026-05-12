'use client';

import { useEffect, useState, useCallback } from 'react';
import { Brain, Plus, Search, Trash2, RefreshCw, ArrowUp, Database } from 'lucide-react';
import Modal from '@/components/Modal';

const LAYERS = ['working', 'mid', 'long', 'artifact'];
const SENSITIVITY = ['public', 'internal', 'confidential'];

export default function MemoryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [layer, setLayer] = useState('');
  const [q, setQ] = useState('');
  const [retrieveQ, setRetrieveQ] = useState('');
  const [retrieveHits, setRetrieveHits] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    layer: 'working',
    title: '',
    content: '',
    team_id: '',
    agent_id: '',
    sensitivity: 'internal',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (layer) params.set('layer', layer);
      if (q) params.set('q', q);
      const res = await fetch(`/api/memory?${params.toString()}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [layer, q]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const body = {
      layer: form.layer,
      title: form.title,
      content: form.content,
      team_id: form.team_id || null,
      agent_id: form.agent_id ? Number(form.agent_id) : null,
      sensitivity: form.sensitivity,
      tags: ['ui'],
    };
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Failed to create');
      return;
    }
    setShowModal(false);
    setForm({ layer: 'working', title: '', content: '', team_id: '', agent_id: '', sensitivity: 'internal' });
    load();
  };

  const handleRetrieve = async () => {
    const res = await fetch('/api/memory/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: retrieveQ, limit: 15 }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Retrieve failed');
      return;
    }
    setRetrieveHits(data.hits || []);
  };

  const promote = async (id, targetLayer) => {
    const res = await fetch(`/api/memory/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLayer }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Promote failed (requires operator role when API keys are set)');
      return;
    }
    load();
  };

  const forget = async (id) => {
    if (!confirm('Tombstone this memory entry?')) return;
    const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Delete failed');
      return;
    }
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
            <Brain className="text-[#FF6B00]" size={28} />
            Memory OS
          </h1>
          <p className="text-surface-400 text-sm mt-1 max-w-2xl">
            Cross-agent persistent memory (working → mid → long). APIs: <code className="text-orange-400/90">/api/memory</code>,{' '}
            <code className="text-orange-400/90">/api/memory/retrieve</code>. See{' '}
            <a className="text-orange-400 underline" href="https://github.com/BAI-LAB/MemoryOS" target="_blank" rel="noreferrer">
              MemoryOS
            </a>{' '}
            for external patterns.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-800 text-surface-200 hover:bg-surface-700 border border-surface-600/40"
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600"
          >
            <Plus size={16} /> Add memory
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3 rounded-lg border border-surface-600/30 bg-surface-900/40 p-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" size={16} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search title / content…"
                className="w-full pl-9 pr-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              />
            </div>
            <select
              value={layer}
              onChange={(e) => setLayer(e.target.value)}
              className="px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
            >
              <option value="">All layers</option>
              {LAYERS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="text-surface-500 text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-surface-500 text-sm">No memory entries yet.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((m) => (
                <li key={m.id} className="rounded-md border border-surface-700/50 bg-surface-950/60 p-3">
                  <div className="flex justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-orange-400/90">{m.layer}</span>
                        <span className="text-xs text-surface-500">{m.sensitivity}</span>
                        {m.team_id ? <span className="text-xs text-surface-400">team:{m.team_id}</span> : null}
                      </div>
                      <h3 className="text-surface-100 font-medium mt-1">{m.title || 'Untitled'}</h3>
                      <p className="text-surface-400 text-sm mt-1 whitespace-pre-wrap">{m.content}</p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {m.layer !== 'long' && (
                        <button
                          type="button"
                          onClick={() => promote(m.id, m.layer === 'working' ? 'mid' : 'long')}
                          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-surface-200"
                          title="Promote (operator)"
                        >
                          <ArrowUp size={12} /> Promote
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => forget(m.id)}
                        className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-300"
                      >
                        <Trash2 size={12} /> Forget
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-surface-600/30 bg-surface-900/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-surface-200 font-medium">
            <Database size={18} className="text-[#FF6B00]" /> Retrieve test
          </div>
          <p className="text-xs text-surface-500">POST /api/memory/retrieve — simple LIKE match in v1.</p>
          <input
            value={retrieveQ}
            onChange={(e) => setRetrieveQ(e.target.value)}
            placeholder="Query…"
            className="w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
          />
          <button
            type="button"
            onClick={handleRetrieve}
            className="w-full py-2 rounded-md bg-surface-800 hover:bg-surface-700 text-surface-100 border border-surface-600/40"
          >
            Retrieve
          </button>
          {retrieveHits && (
            <ul className="text-sm text-surface-300 space-y-2 max-h-64 overflow-y-auto">
              {retrieveHits.length === 0 && <li className="text-surface-500">No hits</li>}
              {retrieveHits.map((h) => (
                <li key={h.id} className="border-b border-surface-800/80 pb-2">
                  <span className="text-orange-400/90 text-xs">{h.layer}</span> — {h.title || h.id}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New memory entry" size="lg">
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-surface-300">
              Layer
              <select
                className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
                value={form.layer}
                onChange={(e) => setForm((f) => ({ ...f, layer: e.target.value }))}
              >
                {LAYERS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-surface-300">
              Sensitivity
              <select
                className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
                value={form.sensitivity}
                onChange={(e) => setForm((f) => ({ ...f, sensitivity: e.target.value }))}
              >
                {SENSITIVITY.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-sm text-surface-300 block">
            Title
            <input
              className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </label>
          <label className="text-sm text-surface-300 block">
            Content
            <textarea
              rows={5}
              className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              required
            />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-surface-300">
              Team id (optional)
              <input
                className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
                value={form.team_id}
                onChange={(e) => setForm((f) => ({ ...f, team_id: e.target.value }))}
              />
            </label>
            <label className="text-sm text-surface-300">
              Agent id (optional)
              <input
                type="number"
                className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
                value={form.agent_id}
                onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-surface-300 hover:bg-surface-800">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600">
              Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
