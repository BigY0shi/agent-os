'use client';

import { useState, useEffect } from 'react';
import { Star, Circle } from 'lucide-react';

const SECTION_COLORS = {
  performance: 'bg-blue-600',
  security: 'bg-red-600',
  compliance: 'bg-amber-600',
  optimization: 'bg-green-600',
  user_feedback: 'bg-purple-600',
  system: 'bg-teal-600',
};

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const params = new URLSearchParams();
        if (filterTab !== 'all') params.append('filter', filterTab);
        const res = await fetch(`/api/reports?${params}`);
        const data = await res.json();
        setReports(data);
      } catch (error) {
        console.error('Failed to fetch reports:', error);
      } finally {
        setLoading(false);
      }
    };
    setLoading(true);
    fetchReports();
  }, [filterTab]);

  const handleToggleStar = async (id, isStarred) => {
    try {
      await fetch(`/api/reports?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: !isStarred }),
      });
      setReports(
        reports.map((r) =>
          r.id === id ? { ...r, starred: !r.starred } : r
        )
      );
    } catch (error) {
      console.error('Failed to toggle star:', error);
    }
  };

  const handleMarkAsRead = async (id, isRead) => {
    if (isRead) return; // Already read
    try {
      await fetch(`/api/reports?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
      setReports(
        reports.map((r) =>
          r.id === id ? { ...r, read: true } : r
        )
      );
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const sortedReports = [...reports].sort((a, b) => {
    // Starred first
    if (a.starred !== b.starred) return b.starred ? 1 : -1;
    // Then by date
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <div className="surface-primary min-h-screen p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-6">Reports</h1>

        {/* Filter Tabs */}
        <div className="flex gap-4 border-b border-gray-700">
          <button
            onClick={() => setFilterTab('all')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              filterTab === 'all'
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterTab('unread')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              filterTab === 'unread'
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Unread
          </button>
          <button
            onClick={() => setFilterTab('starred')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              filterTab === 'starred'
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Starred
          </button>
        </div>
      </div>

      {/* Reports List */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading reports...</div>
      ) : (
        <div className="space-y-2">
          {sortedReports.length === 0 ? (
            <div className="text-center text-gray-400 py-12">No reports found.</div>
          ) : (
            sortedReports.map((report) => (
              <div key={report.id}>
                {/* Report Row */}
                <div
                  className="card card-hover p-4 cursor-pointer transition-all"
                  onClick={() => {
                    handleMarkAsRead(report.id, report.read);
                    setExpandedId(expandedId === report.id ? null : report.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Section Color Dot + Content */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Section Dot */}
                      <div className={`${SECTION_COLORS[report.section] || 'bg-gray-600'} w-3 h-3 rounded-full flex-shrink-0 mt-1.5`} />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Agent Badge + Title */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="badge bg-orange-600 text-white text-xs px-2 py-1 rounded flex-shrink-0">
                            {report.agent_name}
                          </span>
                          <h3 className={`font-bold ${report.read ? 'text-gray-300' : 'text-white'} truncate`}>
                            {report.title}
                          </h3>
                        </div>

                        {/* Date */}
                        <p className="text-gray-500 text-xs">
                          {new Date(report.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Right: Unread Indicator + Star Button */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {!report.read && (
                        <Circle className="w-2 h-2 fill-orange-500 text-orange-500" />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStar(report.id, report.starred);
                        }}
                        className="p-1 text-gray-400 hover:text-amber-400 transition-colors"
                      >
                        <Star
                          className="w-5 h-5"
                          fill={report.starred ? 'currentColor' : 'none'}
                          stroke={report.starred ? 'currentColor' : 'currentColor'}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedId === report.id && (
                    <div className="border-t border-gray-700 mt-4 pt-4">
                      <div className="text-gray-300 text-sm whitespace-pre-wrap">
                        {report.content}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
