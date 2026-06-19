'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScrollText, RefreshCw, Filter } from 'lucide-react';
import Link from 'next/link';

function AuditPageInner() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resourceType, setResourceType] = useState(searchParams.get('resource_type') || '');
  const [resourceId, setResourceId] = useState(searchParams.get('resource_id') || '');
  const [actionFilter, setActionFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (resourceType) params.set('resource_type', resourceType);
      if (resourceId) params.set('resource_id', resourceId);
      if (actionFilter) params.set('action', actionFilter);
      const res = await fetch(`/api/audit?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setRows([]);
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId, actionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
            <ScrollText className="text-[#FF6B00]" size={28} />
            Audit log
          </h1>
          <p className="text-surface-400 text-sm mt-1">
            Control-plane mutations and sensitive reads. Requires operator role when API keys are configured.
            {' '}
            <Link href="/memory" className="text-orange-400 underline">Memory</Link>
            {' · '}
            <Link href="/pipelines" className="text-orange-400 underline">Pipelines</Link>
            {' · '}
            <Link href="/governance" className="text-orange-400 underline">Governance</Link>
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-800 text-surface-200 hover:bg-surface-700 border border-surface-600/40">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="rounded-lg border border-surface-600/30 bg-surface-900/40 p-4">
        <div className="flex items-center gap-2 text-surface-300 text-sm mb-3">
          <Filter size={16} /> Filters
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className="px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm">
            <option value="">All resource types</option>
            <option value="memory">memory</option>
            <option value="pipeline">pipeline</option>
            <option value="pipeline_run">pipeline_run</option>
            <option value="agent">agent</option>
            <option value="agent_goal">agent_goal</option>
            <option value="tool_proposal">tool_proposal</option>
            <option value="safety_event">safety_event</option>
            <option value="model_provider">model_provider</option>
            <option value="decision">decision</option>
          </select>
          <input value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder="Resource id" className="px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm" />
          <input value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="Action contains…" className="px-3 py-2 rounded-md bg-surface-950 border border-surface-600/40 text-surface-100 text-sm" />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-800/50 bg-red-950/30 px-4 py-3 text-red-300 text-sm">
          {error}
          {error.includes('401') || error.toLowerCase().includes('key') ? (
            <span> — Set <code className="text-red-200">AGENT_OS_API_KEYS</code> with operator token for this page in production.</span>
          ) : null}
        </div>
      )}

      {loading ? (
        <p className="text-surface-500 text-sm">Loading audit entries…</p>
      ) : rows.length === 0 ? (
        <p className="text-surface-500 text-sm">No audit entries match filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-600/30">
          <table className="w-full text-sm text-left">
            <thead className="bg-surface-900 text-surface-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Meta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {rows.map((r) => (
                <tr key={r.id} className="bg-surface-950/60 hover:bg-surface-900/60">
                  <td className="px-4 py-2 text-surface-400 whitespace-nowrap text-xs">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-surface-300 font-mono text-xs">{r.actor}</td>
                  <td className="px-4 py-2 text-orange-400/90">{r.action}</td>
                  <td className="px-4 py-2 text-surface-300">
                    {r.resource_type || '—'}
                    {r.resource_id != null ? ` #${r.resource_id}` : ''}
                  </td>
                  <td className="px-4 py-2 text-surface-500 font-mono text-xs max-w-xs truncate" title={r.meta || ''}>
                    {r.meta || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<p className="text-surface-500 p-8">Loading audit…</p>}>
      <AuditPageInner />
    </Suspense>
  );
}
