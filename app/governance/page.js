'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Wrench, Target, Brain, Cpu, Check, X, Plus, RefreshCw } from 'lucide-react';

const TABS = [
  { id: 'proposals', label: 'Tool proposals', icon: Wrench },
  { id: 'safety', label: 'Safety', icon: Shield },
  { id: 'goals', label: 'Goals & opinions', icon: Target },
  { id: 'models', label: 'Model changes', icon: Cpu },
];

export default function GovernancePage() {
  const [tab, setTab] = useState('proposals');
  const [agents, setAgents] = useState([]);
  const [providers, setProviders] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [safety, setSafety] = useState([]);
  const [goals, setGoals] = useState([]);
  const [opinions, setOpinions] = useState([]);
  const [modelDecisions, setModelDecisions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, pRes, tpRes, sRes, gRes, oRes, dRes] = await Promise.all([
        fetch('/api/agents'),
        fetch('/api/model-providers'),
        fetch('/api/tool-proposals'),
        fetch('/api/safety-events'),
        fetch('/api/agent-goals'),
        fetch('/api/agent-opinions'),
        fetch('/api/decisions?type=model_change'),
      ]);
      const [a, p, tp, s, g, o, d] = await Promise.all([
        aRes.json(), pRes.json(), tpRes.json(), sRes.json(), gRes.json(), oRes.json(), dRes.json(),
      ]);
      setAgents(Array.isArray(a) ? a : []);
      setProviders(Array.isArray(p) ? p : []);
      setProposals(Array.isArray(tp) ? tp : []);
      setSafety(Array.isArray(s) ? s : []);
      setGoals(Array.isArray(g) ? g : []);
      setOpinions(Array.isArray(o) ? o : []);
      setModelDecisions(Array.isArray(d) ? d : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const agentName = (id) => agents.find((a) => a.id === id)?.name || `#${id}`;

  const approveProposal = async (id) => {
    await fetch(`/api/tool-proposals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', version: '1.0.0' }),
    });
    load();
  };

  const rejectProposal = async (id) => {
    await fetch(`/api/tool-proposals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    });
    load();
  };

  const mitigateSafety = async (id) => {
    const note = prompt('Mitigation note:');
    if (note === null) return;
    await fetch(`/api/safety-events/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'mitigated', mitigation: note }),
    });
    load();
  };

  const approveDecision = async (id) => {
    await fetch(`/api/decisions?id=${id}&action=approve`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    load();
  };

  const rejectDecision = async (id) => {
    await fetch(`/api/decisions?id=${id}&action=reject`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    load();
  };

  const createSafetyEvent = async () => {
    const message = prompt('Safety event message:');
    if (!message?.trim()) return;
    const severity = prompt('Severity (low/med/high):', 'med') || 'med';
    await fetch('/api/safety-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim(), severity, kind: 'policy' }),
    });
    load();
  };

  const addGoal = async () => {
    const agentId = prompt('Agent id:');
    const title = prompt('Goal title:');
    const priority = prompt('Priority (higher = first):', '10');
    if (!agentId || !title?.trim()) return;
    await fetch('/api/agent-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: Number(agentId), title: title.trim(), priority: Number(priority) || 0 }),
    });
    load();
  };

  const updateGoal = async (goal, patch) => {
    await fetch(`/api/agent-goals/${goal.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...goal, ...patch }),
    });
    load();
  };

  const addOpinion = async () => {
    const agentId = prompt('Agent id:');
    const claim = prompt('Opinion claim:');
    if (!agentId || !claim?.trim()) return;
    await fetch('/api/agent-opinions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: Number(agentId), claim: claim.trim(), confidence: 0.8 }),
    });
    load();
  };

  const submitProposal = async () => {
    const name = prompt('Tool name:');
    if (!name) return;
    await fetch('/api/tool-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, status: 'submitted', risk_class: 'med', spec_json: { description: 'Submitted from governance UI' } }),
    });
    load();
  };

  const requestModelChange = async () => {
    const agentId = prompt('Agent id:');
    const toModel = prompt('New model id:');
    const toProvider = prompt('Provider slug (e.g. ollama-cloud):');
    if (!agentId || !toModel) return;
    const agent = agents.find((a) => String(a.id) === agentId);
    await fetch('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: Number(agentId),
        agent_name: agent?.name || '',
        action: `Change model to ${toModel}`,
        type: 'model_change',
        details: JSON.stringify({
          severity: 'med',
          agent_id: Number(agentId),
          from_model: agent?.model_id,
          to_model: toModel,
          to_provider: toProvider || undefined,
        }),
      }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
            <Shield className="text-[#FF6B00]" size={28} />
            Governance
          </h1>
          <p className="text-surface-400 text-sm mt-1">
            Proposals, safety, goals, model changes.{' '}
            <Link href="/approvals" className="text-orange-400 underline">All approvals</Link>
            {' · '}
            <Link href="/settings" className="text-orange-400 underline">Model providers</Link>
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-800 text-surface-200 border border-surface-600/40">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-surface-800 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md ${tab === t.id ? 'bg-[#FF6B00]/20 text-orange-300' : 'text-surface-400 hover:bg-surface-800'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-surface-500 text-sm">Loading…</p>
      ) : (
        <>
          {tab === 'proposals' && (
            <div className="space-y-3">
              <button type="button" onClick={submitProposal} className="text-sm px-3 py-2 rounded bg-orange-600 text-white inline-flex items-center gap-1">
                <Plus size={14} /> Submit tool proposal
              </button>
              {proposals.length === 0 ? <p className="text-surface-500 text-sm">No proposals.</p> : proposals.map((p) => (
                <div key={p.id} className="rounded-lg border border-surface-700/50 bg-surface-950/60 p-4 flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-medium text-surface-100">{p.name}</div>
                    <div className="text-xs text-surface-500 mt-1">risk: {p.risk_class} · {p.status} · agent: {p.agent_id ? agentName(p.agent_id) : 'fleet'}</div>
                  </div>
                  {p.status === 'submitted' && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => approveProposal(p.id)} className="px-3 py-1.5 rounded bg-emerald-900/40 text-emerald-300 text-sm inline-flex items-center gap-1"><Check size={14} /> Approve</button>
                      <button type="button" onClick={() => rejectProposal(p.id)} className="px-3 py-1.5 rounded bg-red-900/40 text-red-300 text-sm inline-flex items-center gap-1"><X size={14} /> Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'safety' && (
            <div className="space-y-3">
              <button type="button" onClick={createSafetyEvent} className="text-sm px-3 py-2 rounded bg-surface-800 text-surface-200 border border-surface-600/40 inline-flex items-center gap-1">
                <Plus size={14} /> Report safety event
              </button>
              {safety.length === 0 ? <p className="text-surface-500 text-sm">No safety events.</p> : safety.map((s) => (
                <div key={s.id} className="rounded-lg border border-surface-700/50 bg-surface-950/60 p-4">
                  <div className="flex justify-between gap-2">
                    <span className="text-xs uppercase text-red-300/80">{s.severity} · {s.status}</span>
                    {s.status === 'open' && (
                      <button type="button" onClick={() => mitigateSafety(s.id)} className="text-xs px-2 py-1 rounded bg-surface-800 text-surface-200">Mitigate</button>
                    )}
                  </div>
                  <p className="text-surface-200 mt-2">{s.message}</p>
                  {s.mitigation && <p className="text-xs text-surface-500 mt-2">Mitigation: {s.mitigation}</p>}
                </div>
              ))}
            </div>
          )}

          {tab === 'goals' && (
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-surface-200 font-medium flex items-center gap-2"><Target size={16} /> Goals</h3>
                  <button type="button" onClick={addGoal} className="text-xs px-2 py-1 rounded bg-orange-600/80 text-white inline-flex items-center gap-1"><Plus size={12} /> Add</button>
                </div>
                <ul className="space-y-2">
                  {goals.map((g) => (
                    <li key={g.id} className="text-sm border border-surface-800 rounded p-3">
                      <div className="font-medium text-surface-100">{g.title}</div>
                      <div className="text-xs text-surface-500 mt-1">{agentName(g.agent_id)} · P{g.priority} · {g.status}</div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button type="button" onClick={() => updateGoal(g, { priority: (g.priority || 0) + 1 })} className="text-xs px-2 py-0.5 rounded bg-surface-800 text-surface-300">↑ priority</button>
                        <button type="button" onClick={() => updateGoal(g, { priority: Math.max(0, (g.priority || 0) - 1) })} className="text-xs px-2 py-0.5 rounded bg-surface-800 text-surface-300">↓ priority</button>
                        {g.status !== 'done' && (
                          <button type="button" onClick={() => updateGoal(g, { status: 'done' })} className="text-xs px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300">Mark done</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-surface-200 font-medium flex items-center gap-2"><Brain size={16} /> Opinions</h3>
                  <button type="button" onClick={addOpinion} className="text-xs px-2 py-1 rounded bg-orange-600/80 text-white inline-flex items-center gap-1"><Plus size={12} /> Add</button>
                </div>
                <ul className="space-y-2">
                  {opinions.map((o) => (
                    <li key={o.id} className="text-sm border border-surface-800 rounded p-3">
                      <div className="text-surface-200">{o.claim}</div>
                      <div className="text-xs text-surface-500">{agentName(o.agent_id)} · conf: {o.confidence ?? '—'}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {tab === 'models' && (
            <div className="space-y-3">
              <button type="button" onClick={requestModelChange} className="text-sm px-3 py-2 rounded bg-surface-800 text-surface-200 border border-surface-600/40">
                Request model change (decision)
              </button>
              <p className="text-xs text-surface-500">Providers: {providers.map((p) => p.slug).join(', ') || 'none seeded'}</p>
              {modelDecisions.length === 0 ? <p className="text-surface-500 text-sm">No model_change decisions.</p> : modelDecisions.map((d) => (
                <div key={d.id} className="rounded-lg border border-surface-700/50 bg-surface-950/60 p-4 flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-medium text-surface-100">{d.action}</div>
                    <div className="text-xs text-surface-500">{d.status} · {d.agent_name || agentName(d.agent_id)}</div>
                    <pre className="text-xs text-surface-600 mt-2 max-w-xl overflow-x-auto">{d.details}</pre>
                  </div>
                  {d.status === 'pending' && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => approveDecision(d.id)} className="px-3 py-1.5 rounded bg-emerald-900/40 text-emerald-300 text-sm"><Check size={14} /> Approve</button>
                      <button type="button" onClick={() => rejectDecision(d.id)} className="px-3 py-1.5 rounded bg-red-900/40 text-red-300 text-sm"><X size={14} /> Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
