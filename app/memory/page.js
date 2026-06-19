'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Brain,
  Plus,
  Search,
  Trash2,
  RefreshCw,
  ArrowUp,
  Database,
  X,
  Pencil,
  User,
  Users,
} from 'lucide-react';
import Modal from '@/components/Modal';
import AuditLink from '@/components/AuditLink';
import { DEPARTMENTS, getDeptLabel } from '@/lib/departments';

const LAYERS = ['working', 'mid', 'long', 'artifact'];
const SENSITIVITY = ['public', 'internal', 'confidential'];

const SENS_COLORS = {
  public: 'bg-green-900/40 text-green-300 border-green-700/40',
  internal: 'bg-surface-800 text-surface-300 border-surface-600/40',
  confidential: 'bg-red-900/30 text-red-300 border-red-700/40',
};

const emptyForm = {
  layer: 'working',
  title: '',
  content: '',
  tags: '',
  team_id: '',
  agent_id: '',
  sensitivity: 'internal',
};

function MemoryPageInner() {
  const searchParams = useSearchParams();

  const [items, setItems] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [layer, setLayer] = useState('');
  const [q, setQ] = useState('');
  const [filterAgent, setFilterAgent] = useState(searchParams.get('agent_id') || '');
  const [filterTeam, setFilterTeam] = useState(searchParams.get('team_id') || '');
  const [filterSensitivity, setFilterSensitivity] = useState('');
  const [agentOnly, setAgentOnly] = useState(searchParams.get('agent_only') === 'true');

  const [retrieveQ, setRetrieveQ] = useState('');
  const [retrieveHits, setRetrieveHits] = useState(null);
  const [honchoSyncing, setHonchoSyncing] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [drawerEntry, setDrawerEntry] = useState(null);
  const [drawerForm, setDrawerForm] = useState(emptyForm);
  const [drawerSaving, setDrawerSaving] = useState(false);

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, []);

  const agentName = (id) => agents.find((a) => String(a.id) === String(id))?.name || `Agent #${id}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (layer) params.set('layer', layer);
      if (q) params.set('q', q);
      if (filterAgent) {
        params.set('agent_id', filterAgent);
        if (agentOnly) params.set('agent_only', 'true');
      }
      if (filterTeam) params.set('team_id', filterTeam);
      if (filterSensitivity) params.set('sensitivity', filterSensitivity);
      const res = await fetch(`/api/memory?${params.toString()}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [layer, q, filterAgent, filterTeam, filterSensitivity, agentOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      agent_id: filterAgent || '',
      team_id: filterTeam || '',
    });
    setShowModal(true);
  };

  const saveEntry = async (payload, id) => {
    const tags = payload.tags
      ? payload.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : ['ui'];
    const body = {
      layer: payload.layer,
      title: payload.title,
      content: payload.content,
      team_id: payload.team_id || null,
      agent_id: payload.agent_id ? Number(payload.agent_id) : null,
      sensitivity: payload.sensitivity,
      tags,
    };
    const res = await fetch(id ? `/api/memory/${id}` : '/api/memory', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Save failed');
      return false;
    }
    return true;
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (await saveEntry(form, null)) {
      setShowModal(false);
      setForm(emptyForm);
      load();
    }
  };

  const openDrawer = (m) => {
    let tagsStr = '';
    try {
      const parsed = typeof m.tags === 'string' ? JSON.parse(m.tags) : m.tags;
      tagsStr = Array.isArray(parsed) ? parsed.join(', ') : m.tags || '';
    } catch {
      tagsStr = m.tags || '';
    }
    setDrawerEntry(m);
    setDrawerForm({
      layer: m.layer,
      title: m.title || '',
      content: m.content || '',
      tags: tagsStr,
      team_id: m.team_id || '',
      agent_id: m.agent_id != null ? String(m.agent_id) : '',
      sensitivity: m.sensitivity || 'internal',
    });
  };

  const handleDrawerSave = async () => {
    if (!drawerEntry) return;
    setDrawerSaving(true);
    const ok = await saveEntry(drawerForm, drawerEntry.id);
    setDrawerSaving(false);
    if (ok) {
      setDrawerEntry(null);
      load();
    }
  };

  const handleRetrieve = async () => {
    const body = { query: retrieveQ, limit: 15 };
    if (filterAgent) body.agent_id = Number(filterAgent);
    const res = await fetch('/api/memory/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    if (drawerEntry?.id === id) {
      const updated = await fetch(`/api/memory/${id}`).then((r) => r.json());
      openDrawer(updated);
    }
  };

  const forget = async (id) => {
    if (!confirm('Tombstone this memory entry?')) return;
    const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Delete failed');
      return;
    }
    if (drawerEntry?.id === id) setDrawerEntry(null);
    load();
  };

  const syncFromHoncho = async () => {
    setHonchoSyncing(true);
    try {
      const res = await fetch('/api/honcho/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: filterAgent ? Number(filterAgent) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Honcho sync failed');
      await load();
      alert(`Honcho sync: ${data.created} new, ${data.updated} updated`);
    } catch (e) {
      alert(e.message);
    } finally {
      setHonchoSyncing(false);
    }
  };

  const AgentTeamFields = ({ value, onChange, idPrefix = '' }) => (
    <div className="grid sm:grid-cols-2 gap-3">
      <label className="text-sm text-surface-300">
        <span className="inline-flex items-center gap-1"><User size={12} /> Agent</span>
        <select
          className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
          value={value.agent_id}
          onChange={(e) => onChange({ ...value, agent_id: e.target.value })}
        >
          <option value="">Fleet-wide (no agent)</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({getDeptLabel(a.department || a.section)})
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-surface-300">
        <span className="inline-flex items-center gap-1"><Users size={12} /> Team / department</span>
        <select
          className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
          value={value.team_id}
          onChange={(e) => onChange({ ...value, team_id: e.target.value })}
        >
          <option value="">All teams</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
            <Brain className="text-[#FF6B00]" size={28} />
            Memory OS
          </h1>
          <p className="text-surface-400 text-sm mt-1 max-w-2xl">
            Attach context to agents and teams. Promote working → mid → long.{' '}
            <Link href="/audit" className="text-orange-400 underline">Audit log</Link> records promote &amp; forget actions.
            {' '}Pull Honcho conclusions into the <code className="text-surface-500">long</code> layer.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={syncFromHoncho} disabled={honchoSyncing} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-800 text-surface-200 hover:bg-surface-700 border border-surface-600/40 disabled:opacity-50">
            <RefreshCw size={16} className={honchoSyncing ? 'animate-spin' : ''} /> {honchoSyncing ? 'Syncing…' : 'Sync Honcho'}
          </button>
          <button type="button" onClick={() => load()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-800 text-surface-200 hover:bg-surface-700 border border-surface-600/40">
            <RefreshCw size={16} /> Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600">
            <Plus size={16} /> Add memory
          </button>
        </div>
      </div>

      {filterAgent && (
        <div className="text-sm text-orange-300/90 bg-orange-950/30 border border-orange-800/40 rounded-md px-3 py-2">
          Filtered for agent: <strong>{agentName(filterAgent)}</strong>
          {' · '}
          <Link href="/memory" className="underline">Clear filter</Link>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3 rounded-lg border border-surface-600/30 bg-surface-900/40 p-4">
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" size={16} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search title / content…"
                className="w-full pl-9 pr-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <select value={layer} onChange={(e) => setLayer(e.target.value)} className="px-2 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm">
                <option value="">All layers</option>
                {LAYERS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <select value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)} className="px-2 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm">
                <option value="">All agents</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className="px-2 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm">
                <option value="">All teams</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <select value={filterSensitivity} onChange={(e) => setFilterSensitivity(e.target.value)} className="px-2 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm">
                <option value="">All sensitivity</option>
                {SENSITIVITY.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {filterAgent && (
              <label className="flex items-center gap-2 text-xs text-surface-400">
                <input type="checkbox" checked={agentOnly} onChange={(e) => setAgentOnly(e.target.checked)} className="rounded" />
                Show only this agent&apos;s entries (exclude fleet-wide)
              </label>
            )}
          </div>

          {loading ? (
            <p className="text-surface-500 text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-surface-500 text-sm">No memory entries match filters.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((m) => (
                <li key={m.id} className="rounded-md border border-surface-700/50 bg-surface-950/60 p-3 hover:border-surface-600/60 transition">
                  <div className="flex justify-between gap-2">
                    <button type="button" className="text-left flex-1 min-w-0" onClick={() => openDrawer(m)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-orange-400/90">{m.layer}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${SENS_COLORS[m.sensitivity] || SENS_COLORS.internal}`}>
                          {m.sensitivity}
                        </span>
                        {m.agent_id ? (
                          <span className="text-xs text-blue-300/90">{agentName(m.agent_id)}</span>
                        ) : (
                          <span className="text-xs text-surface-500">fleet-wide</span>
                        )}
                        {m.team_id ? <span className="text-xs text-surface-400">{getDeptLabel(m.team_id)}</span> : null}
                      </div>
                      <h3 className="text-surface-100 font-medium mt-1">{m.title || 'Untitled'}</h3>
                      <p className="text-surface-400 text-sm mt-1 line-clamp-2">{m.content}</p>
                    </button>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button type="button" onClick={() => openDrawer(m)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-surface-200">
                        <Pencil size={12} /> Edit
                      </button>
                      {m.layer !== 'long' && (
                        <button type="button" onClick={() => promote(m.id, m.layer === 'working' ? 'mid' : 'long')} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-surface-200">
                          <ArrowUp size={12} /> Promote
                        </button>
                      )}
                      <button type="button" onClick={() => forget(m.id)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-300">
                        <Trash2 size={12} /> Forget
                      </button>
                      <AuditLink resourceType="memory" resourceId={m.id} className="text-[10px] text-orange-400/80 underline text-center">
                        Audit
                      </AuditLink>
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
          <p className="text-xs text-surface-500">
            POST /api/memory/retrieve{filterAgent ? ` scoped to ${agentName(filterAgent)} + fleet-wide` : ''}.
          </p>
          <input value={retrieveQ} onChange={(e) => setRetrieveQ(e.target.value)} placeholder="Query…" className="w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100" />
          <button type="button" onClick={handleRetrieve} className="w-full py-2 rounded-md bg-surface-800 hover:bg-surface-700 text-surface-100 border border-surface-600/40">
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

      {/* Detail drawer */}
      {drawerEntry && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button type="button" className="flex-1 bg-black/50" aria-label="Close" onClick={() => setDrawerEntry(null)} />
          <div className="w-full max-w-md bg-surface-950 border-l border-surface-700 p-6 overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-surface-100">Edit memory</h2>
              <button type="button" onClick={() => setDrawerEntry(null)} className="text-surface-400 hover:text-surface-200">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-surface-300">
                  Layer
                  <select className="mt-1 w-full px-3 py-2 rounded-md bg-surface-900 border border-surface-600/40 text-surface-100" value={drawerForm.layer} onChange={(e) => setDrawerForm((f) => ({ ...f, layer: e.target.value }))}>
                    {LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <label className="text-sm text-surface-300">
                  Sensitivity
                  <select className="mt-1 w-full px-3 py-2 rounded-md bg-surface-900 border border-surface-600/40 text-surface-100" value={drawerForm.sensitivity} onChange={(e) => setDrawerForm((f) => ({ ...f, sensitivity: e.target.value }))}>
                    {SENSITIVITY.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <label className="text-sm text-surface-300 block">
                Title
                <input className="mt-1 w-full px-3 py-2 rounded-md bg-surface-900 border border-surface-600/40 text-surface-100" value={drawerForm.title} onChange={(e) => setDrawerForm((f) => ({ ...f, title: e.target.value }))} />
              </label>
              <label className="text-sm text-surface-300 block">
                Content
                <textarea rows={6} className="mt-1 w-full px-3 py-2 rounded-md bg-surface-900 border border-surface-600/40 text-surface-100" value={drawerForm.content} onChange={(e) => setDrawerForm((f) => ({ ...f, content: e.target.value }))} />
              </label>
              <label className="text-sm text-surface-300 block">
                Tags (comma-separated)
                <input className="mt-1 w-full px-3 py-2 rounded-md bg-surface-900 border border-surface-600/40 text-surface-100" value={drawerForm.tags} onChange={(e) => setDrawerForm((f) => ({ ...f, tags: e.target.value }))} />
              </label>
              <AgentTeamFields value={drawerForm} onChange={setDrawerForm} />
              <div className="flex gap-2 pt-2">
                <button type="button" disabled={drawerSaving} onClick={handleDrawerSave} className="flex-1 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600 disabled:opacity-50">
                  {drawerSaving ? 'Saving…' : 'Save changes'}
                </button>
                {drawerEntry.layer !== 'long' && (
                  <button type="button" onClick={() => promote(drawerEntry.id, drawerEntry.layer === 'working' ? 'mid' : 'long')} className="px-3 py-2 rounded-md bg-surface-800 text-surface-200 text-sm">
                    Promote
                  </button>
                )}
              </div>
              <Link href={`/audit?resource_type=memory&resource_id=${drawerEntry.id}`} className="text-xs text-orange-400 underline block">
                View audit history for this entry
              </Link>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New memory entry" size="lg">
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-surface-300">
              Layer
              <select className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100" value={form.layer} onChange={(e) => setForm((f) => ({ ...f, layer: e.target.value }))}>
                {LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="text-sm text-surface-300">
              Sensitivity
              <select className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100" value={form.sensitivity} onChange={(e) => setForm((f) => ({ ...f, sensitivity: e.target.value }))}>
                {SENSITIVITY.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label className="text-sm text-surface-300 block">
            Title
            <input className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </label>
          <label className="text-sm text-surface-300 block">
            Content
            <textarea rows={5} className="mt-1 w-full px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100" value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} required />
          </label>
          <AgentTeamFields value={form} onChange={setForm} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-surface-300 hover:bg-surface-800">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-[#FF6B00] text-white hover:bg-orange-600">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function MemoryPage() {
  return (
    <Suspense fallback={<p className="text-surface-500 p-8">Loading memory…</p>}>
      <MemoryPageInner />
    </Suspense>
  );
}
