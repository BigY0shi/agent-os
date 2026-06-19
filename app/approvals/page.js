'use client';

import { useState, useEffect } from 'react';
import { Check, X, ChevronDown } from 'lucide-react';
import Modal from '@/components/Modal';

const TYPE_COLORS = {
  deployment: 'bg-blue-600',
  budget: 'bg-amber-600',
  content: 'bg-purple-600',
  config: 'bg-green-600',
  outreach: 'bg-pink-600',
  tool_publish: 'bg-orange-600',
  infra_change: 'bg-cyan-600',
  model_change: 'bg-violet-600',
  data_access: 'bg-red-600',
};

export default function ApprovalsPage() {
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedDetailId, setExpandedDetailId] = useState(null);
  const [showHistoryToggle, setShowHistoryToggle] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState(null);

  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        const params = new URLSearchParams();
        if (typeFilter !== 'all') params.append('type', typeFilter);
        if (statusFilter !== 'all') params.append('status', statusFilter);
        const res = await fetch(`/api/decisions?${params}`);
        const data = await res.json();
        setDecisions(data);
      } catch (error) {
        console.error('Failed to fetch decisions:', error);
      } finally {
        setLoading(false);
      }
    };
    setLoading(true);
    fetchDecisions();
  }, [typeFilter, statusFilter]);

  const handleApprove = async (id) => {
    try {
      const res = await fetch(`/api/decisions?id=${id}&action=approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      const updated = await res.json();
      setDecisions(
        decisions.map((d) =>
          d.id === id ? updated : d
        )
      );
    } catch (error) {
      console.error('Failed to approve:', error);
    }
  };

  const handleReject = async (id) => {
    try {
      const res = await fetch(`/api/decisions?id=${id}&action=reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      const updated = await res.json();
      setDecisions(
        decisions.map((d) =>
          d.id === id ? updated : d
        )
      );
    } catch (error) {
      console.error('Failed to reject:', error);
    }
  };

  const pendingDecisions = decisions.filter((d) => d.status === 'pending');
  const historyDecisions = decisions.filter((d) => d.status !== 'pending');

  return (
    <div className="surface-primary min-h-screen p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">Approvals</h1>
            <p className="text-gray-400 text-sm mt-1">
              {pendingDecisions.length} pending decision{pendingDecisions.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-4 py-2 rounded-lg surface-secondary border border-gray-700 text-white focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Types</option>
            <option value="deployment">Deployment</option>
            <option value="budget">Budget</option>
            <option value="content">Content</option>
            <option value="config">Config</option>
            <option value="outreach">Outreach</option>
            <option value="tool_publish">Tool publish</option>
            <option value="infra_change">Infra change</option>
            <option value="model_change">Model change</option>
            <option value="data_access">Data access</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 rounded-lg surface-secondary border border-gray-700 text-white focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading decisions...</div>
      ) : (
        <>
          {/* Pending Section */}
          <div className="mb-12">
            <h2 className="text-xl font-bold text-white mb-4">Pending Decisions</h2>
            {pendingDecisions.length === 0 ? (
              <div className="card p-6 text-center text-gray-400">
                No pending decisions.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pendingDecisions.map((decision) => (
                  <div key={decision.id} className="card card-hover space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`badge ${TYPE_COLORS[decision.type] || 'bg-gray-600'} text-white text-xs px-2 py-1 rounded`}>
                            {decision.type.charAt(0).toUpperCase() + decision.type.slice(1)}
                          </span>
                          <span className="badge bg-orange-600 text-white text-xs px-2 py-1 rounded">
                            {decision.agent_name}
                          </span>
                        </div>
                        <p className="text-gray-500 text-xs">
                          Created {new Date(decision.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Action Text */}
                    <div className="text-gray-200">
                      <p className="font-medium">{decision.action}</p>
                    </div>

                    {/* Description (collapsible) */}
                    {decision.details && (
                      <div className="border-t border-gray-700 pt-3">
                        {expandedDetailId === decision.id ? (
                          <div className="text-gray-300 text-sm whitespace-pre-wrap bg-surface-secondary p-3 rounded">
                            {decision.details}
                          </div>
                        ) : (
                          <button
                            onClick={() => setExpandedDetailId(expandedDetailId === decision.id ? null : decision.id)}
                            className="text-orange-500 hover:text-orange-400 text-sm font-medium flex items-center gap-1"
                          >
                            Show Details
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => handleApprove(decision.id)}
                        className="btn-accent flex-1 flex items-center justify-center gap-2 text-sm"
                      >
                        <Check className="w-4 h-4" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(decision.id)}
                        className="btn-danger flex-1 flex items-center justify-center gap-2 text-sm"
                      >
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History Section */}
          {historyDecisions.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistoryToggle(!showHistoryToggle)}
                className="flex items-center gap-2 text-white font-bold mb-4 hover:text-orange-500 transition-colors"
              >
                <ChevronDown
                  className={`w-5 h-5 transition-transform ${showHistoryToggle ? 'rotate-180' : ''}`}
                />
                Show History ({historyDecisions.length})
              </button>

              {showHistoryToggle && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left px-4 py-3 text-gray-400 font-medium">Action</th>
                        <th className="text-left px-4 py-3 text-gray-400 font-medium">Type</th>
                        <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
                        <th className="text-left px-4 py-3 text-gray-400 font-medium">Resolver</th>
                        <th className="text-left px-4 py-3 text-gray-400 font-medium">Resolved Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {historyDecisions.map((decision) => (
                        <tr key={decision.id} className="hover:bg-surface-secondary transition-colors">
                          <td className="px-4 py-3 text-gray-300 max-w-xs truncate">
                            {decision.action}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`badge ${TYPE_COLORS[decision.type] || 'bg-gray-600'} text-white text-xs px-2 py-1 rounded`}>
                              {decision.type.charAt(0).toUpperCase() + decision.type.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`badge text-xs px-2 py-1 rounded ${
                              decision.status === 'approved'
                                ? 'status-approved'
                                : 'status-rejected'
                            }`}>
                              {decision.status.charAt(0).toUpperCase() + decision.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400">
                            {decision.resolver || '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-400">
                            {decision.resolved_at
                              ? new Date(decision.resolved_at).toLocaleDateString()
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
