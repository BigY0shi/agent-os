'use client';

import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  TrendingUp,
  DollarSign,
  Bot,
  Activity,
  ChevronRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detailsDecision, setDetailsDecision] = useState(null);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to fetch dashboard');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (decisionId, action) => {
    try {
      const res = await fetch(`/api/decisions?id=${decisionId}&action=${action}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolver: 'Yoshi' }),
      });
      if (!res.ok) throw new Error(`Failed to ${action} decision`);
      await fetchDashboard();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismissAlert = async (alertId) => {
    try {
      const res = await fetch(`/api/alerts/${alertId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to dismiss alert');
      await fetchDashboard();
    } catch (err) {
      console.error(err);
    }
  };

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const getHour = () => {
    const hour = now.getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  };

  const getAgentBadgeColor = (section) => {
    const colorMap = {
      analytics: 'badge-blue',
      automation: 'badge-purple',
      content: 'badge-orange',
      operations: 'badge-green',
      default: 'badge-gray',
    };
    return colorMap[section] || colorMap.default;
  };

  return (
    <div className="min-h-screen bg-surface-950 text-white p-8">
      {/* Header */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-4xl font-bold">
            Good {getHour()}, <span className="text-orange-500">Yoshi</span>
          </h1>
          <div className="text-sm text-surface-400">{dateStr}</div>
        </div>
        <div className="inline-block px-3 py-1 bg-surface-800 rounded text-xs font-mono text-orange-500 mt-4">
          Agent OS v2.0
        </div>
      </div>

      {/* KPI Strip */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4 mb-12">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-24 animate-pulse bg-surface-900" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-900 bg-opacity-20 border border-red-700 rounded p-4 mb-12">
          <p className="text-red-400 text-sm">Error loading dashboard: {error}</p>
          <button
            onClick={fetchDashboard}
            className="btn-accent text-xs mt-2"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-4 gap-4 mb-12">
            {/* Tasks */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="label">Tasks</span>
                <CheckCircle size={16} className="text-orange-500" />
              </div>
              <div className="kpi-value">
                {data.kpis.tasksCompleted}
                <span className="text-surface-500 text-sm ml-1">/
                  {data.kpis.tasksTotal}</span>
              </div>
            </div>

            {/* Quality */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="label">Quality</span>
                <TrendingUp size={16} className="text-green-500" />
              </div>
              <div className="kpi-value">{data.kpis.qualityAvg}</div>
            </div>

            {/* Active Agents */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="label">Active Agents</span>
                <Activity size={16} className="text-blue-500" />
              </div>
              <div className="kpi-value">
                {data.kpis.activeAgents}
                <span className="text-surface-500 text-sm ml-1">/
                  {data.kpis.totalAgents}</span>
              </div>
            </div>

            {/* Spend Today */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="label">Spend Today</span>
                <DollarSign size={16} className="text-orange-500" />
              </div>
              <div className="kpi-value text-orange-500">
                ${data.kpis.spendToday.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Pending Approvals */}
          {data.decisions && data.decisions.length > 0 && (
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-6 bg-orange-500 rounded" />
                <h2 className="text-lg font-semibold">Pending Approvals</h2>
                <span className="text-xs bg-orange-500 text-black px-2 py-1 rounded font-mono">
                  {data.decisions.length}
                </span>
              </div>
              <div className="space-y-3">
                {data.decisions.map((decision) => (
                  <div
                    key={decision.id}
                    className="card-hover p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <span
                        className={`badge-${decision.section || 'gray'} text-xs font-mono`}
                      >
                        {decision.agent_name}
                      </span>
                      <p className="text-sm text-surface-300">{decision.action}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDecision(decision.id, 'approve')}
                        className="btn-accent text-xs px-3 py-1"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleDecision(decision.id, 'reject')}
                        className="btn-danger text-xs px-3 py-1"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => setDetailsDecision(decision)}
                        className="btn-default text-xs px-3 py-1"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alerts */}
          {data.alerts && data.alerts.length > 0 && (
            <div className="mb-12">
              <h2 className="text-lg font-semibold mb-4">Active Alerts</h2>
              <div className="space-y-3">
                {data.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="bg-red-900 bg-opacity-20 border border-red-700 rounded p-4 flex items-start justify-between"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      {alert.type === 'error' ? (
                        <XCircle size={20} className="text-red-500 mt-0.5" />
                      ) : (
                        <AlertTriangle size={20} className="text-amber-500 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="font-mono text-sm text-red-400">
                          {alert.agent_name}
                        </p>
                        <p className="text-sm text-surface-300 mt-1">
                          {alert.message}
                        </p>
                        <p className="text-xs text-surface-500 mt-2">
                          {new Date(alert.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDismissAlert(alert.id)}
                      className="text-red-400 hover:text-red-300 ml-4"
                    >
                      <XCircle size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="mb-12">
            <h2 className="text-lg font-semibold mb-4">Timeline</h2>
            <div className="grid grid-cols-3 gap-4">
              {/* Yesterday */}
              <div>
                <h3 className="text-xs font-semibold text-surface-400 mb-3 uppercase">
                  Yesterday
                </h3>
                <div className="space-y-2">
                  {data.timeline.yesterday && data.timeline.yesterday.length > 0 ? (
                    data.timeline.yesterday.map((task, i) => (
                      <div key={i} className="card p-3 text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <span className="badge-gray text-xs font-mono">
                            {task.agent_name}
                          </span>
                          <status-dot className="status-active" />
                        </div>
                        <p className="text-surface-300 mb-1">{task.name}</p>
                        <p className="text-surface-500 text-xs">
                          {new Date(task.completed_at).toLocaleTimeString()}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-surface-500 text-xs">No tasks</p>
                  )}
                </div>
              </div>

              {/* Today */}
              <div>
                <h3 className="text-xs font-semibold text-surface-400 mb-3 uppercase">
                  Today
                </h3>
                <div className="space-y-2">
                  {data.timeline.today && data.timeline.today.length > 0 ? (
                    data.timeline.today.map((task, i) => (
                      <div key={i} className="card p-3 text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <span className="badge-amber text-xs font-mono">
                            {task.agent_name}
                          </span>
                          <Activity size={14} className="text-amber-500" />
                        </div>
                        <p className="text-surface-300 mb-2">{task.name}</p>
                        <div className="w-full bg-surface-800 rounded h-1.5">
                          <div
                            className="bg-amber-500 h-1.5 rounded transition-all"
                            style={{
                              width: `${task.progress || 45}%`,
                            }}
                          />
                        </div>
                        <p className="text-surface-500 text-xs mt-2">
                          {task.progress || 45}%
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-surface-500 text-xs">No tasks</p>
                  )}
                </div>
              </div>

              {/* Scheduled */}
              <div>
                <h3 className="text-xs font-semibold text-surface-400 mb-3 uppercase">
                  Scheduled
                </h3>
                <div className="space-y-2">
                  {data.timeline.scheduled && data.timeline.scheduled.length > 0 ? (
                    data.timeline.scheduled.map((task, i) => (
                      <div key={i} className="card p-3 text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <span className="badge-blue text-xs font-mono">
                            {task.agent_name}
                          </span>
                          <Clock size={14} className="text-blue-500" />
                        </div>
                        <p className="text-surface-300 mb-1">{task.name}</p>
                        <p className="text-surface-500 text-xs">
                          {new Date(task.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-surface-500 text-xs">No tasks</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cost Chart */}
          <div>
            <h3 className="text-xs font-semibold text-surface-400 mb-4 uppercase">
              7-Day Spend
            </h3>
            <div className="w-full h-64 bg-surface-900 rounded p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.costs.chart}>
                  <XAxis
                    dataKey="day"
                    stroke="#64748b"
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis
                    stroke="#64748b"
                    style={{ fontSize: '12px' }}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e1e24',
                      border: '1px solid #404045',
                      borderRadius: '4px',
                      color: '#fff',
                    }}
                    cursor={{ fill: 'rgba(255, 107, 0, 0.1)' }}
                  />
                  <Bar dataKey="cost" fill="#FF6B00" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-surface-500 mt-3">
              Total: <span className="text-orange-500 font-semibold">
                ${data.costs.total.toFixed(2)}
              </span>
            </p>
          </div>
        </>
      ) : null}

      {/* Decision Details Modal */}
      {detailsDecision && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={() => setDetailsDecision(null)}>
          <div className="bg-surface-800 border border-surface-700 rounded-lg max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold text-white">{detailsDecision.action}</h3>
              <button onClick={() => setDetailsDecision(null)} className="text-surface-400 hover:text-white text-xl">&times;</button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-surface-400">Agent:</span>
                <span className="ml-2 text-surface-200">{detailsDecision.agent_name}</span>
              </div>
              <div>
                <span className="text-surface-400">Type:</span>
                <span className="ml-2 text-surface-200 capitalize">{detailsDecision.type}</span>
              </div>
              <div>
                <span className="text-surface-400">Status:</span>
                <span className={`ml-2 capitalize ${detailsDecision.status === 'approved' ? 'text-green-400' : detailsDecision.status === 'rejected' ? 'text-red-400' : 'text-yellow-400'}`}>
                  {detailsDecision.status}
                </span>
              </div>
              <div>
                <span className="text-surface-400">Details:</span>
                <p className="mt-1 text-surface-300 leading-relaxed">
                  {typeof detailsDecision.details === 'string' && detailsDecision.details.startsWith('{')
                    ? JSON.stringify(JSON.parse(detailsDecision.details), null, 2)
                    : detailsDecision.details || 'No additional details'}
                </p>
              </div>
              {detailsDecision.created_at && (
                <div>
                  <span className="text-surface-400">Created:</span>
                  <span className="ml-2 text-surface-200 mono text-xs">{new Date(detailsDecision.created_at).toLocaleString()}</span>
                </div>
              )}
              {detailsDecision.resolved_at && (
                <div>
                  <span className="text-surface-400">Resolved:</span>
                  <span className="ml-2 text-surface-200 mono text-xs">{new Date(detailsDecision.resolved_at).toLocaleString()} by {detailsDecision.resolver}</span>
                </div>
              )}
            </div>
            {detailsDecision.status === 'pending' && (
              <div className="flex gap-2 mt-6">
                <button onClick={() => { handleDecision(detailsDecision.id, 'approve'); setDetailsDecision(null); }} className="btn-accent text-sm px-4 py-2">Approve</button>
                <button onClick={() => { handleDecision(detailsDecision.id, 'reject'); setDetailsDecision(null); }} className="btn-danger text-sm px-4 py-2">Reject</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
