'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  TrendingUp,
  Bot,
  DollarSign,
  FileText,
  Calendar,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const COLORS = {
  accent: '#FF6B00',
  green: '#34D399',
  amber: '#FBBF24',
  blue: '#60A5FA',
  purple: '#A78BFA',
  red: '#F87171',
};

const STATUS_COLORS = {
  backlog: '#6B7280',
  'in-progress': '#3B82F6',
  review: '#FBBF24',
  done: '#34D399',
  rejected: '#F87171',
};

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('7days');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/analytics?period=${period}`);
        if (!response.ok) throw new Error('Failed to fetch analytics');
        const result = await response.json();
        setData(result);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#09090B]">
        <div className="animate-spin rounded-full h-12 w-12 border border-[#FF6B00]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-[#09090B] min-h-screen">
        <div className="bg-[#1a1a1f] border border-[#F87171] rounded-lg p-6 text-[#F87171]">
          Error: {error}
        </div>
      </div>
    );
  }

  const kpis = data?.kpis || {};
  const costByAgent = data?.costByAgent || [];
  const tasksByStatus = data?.tasksByStatus || [];
  const agentUtilization = data?.agentUtilization || [];
  const sectionBreakdown = data?.sectionBreakdown || [];
  const costTrend = data?.costTrend || [];
  const qualityDistribution = data?.qualityDistribution || [];

  return (
    <div className="min-h-screen bg-[#09090B] p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-white">Analytics</h1>

        {/* Period Selector */}
        <div className="flex gap-3">
          {[
            { label: 'Today', value: 'today' },
            { label: '7 Days', value: '7days' },
            { label: '30 Days', value: '30days' },
            { label: 'All Time', value: 'all' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                period === opt.value
                  ? 'bg-[#FF6B00] text-white'
                  : 'bg-[#1a1a1f] text-[#a0a0a0] hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 1: KPI Cards */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {/* Total Tasks Completed */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6 hover:border-[#34D399] transition">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#a0a0a0] text-sm font-medium">Total Tasks Completed</h3>
            <CheckCircle className="w-5 h-5" color="#34D399" />
          </div>
          <p className="text-3xl font-bold text-white">{kpis.tasksCompleted || 0}</p>
        </div>

        {/* Avg Quality Score */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6 hover:border-[#60A5FA] transition">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#a0a0a0] text-sm font-medium">Avg Quality Score</h3>
            <TrendingUp className="w-5 h-5" color="#60A5FA" />
          </div>
          <p className="text-3xl font-bold text-white">{kpis.qualityAvg || '0%'}</p>
        </div>

        {/* Active Agents */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6 hover:border-[#A78BFA] transition">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#a0a0a0] text-sm font-medium">Active Agents</h3>
            <Bot className="w-5 h-5" color="#A78BFA" />
          </div>
          <p className="text-3xl font-bold text-white">{kpis.activeAgents || 0}</p>
        </div>

        {/* Total Spend */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6 hover:border-[#FF6B00] transition">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#a0a0a0] text-sm font-medium">Total Spend</h3>
            <DollarSign className="w-5 h-5" color="#FF6B00" />
          </div>
          <p className="text-3xl font-bold text-white">${Math.round(kpis.totalSpend || 0).toLocaleString()}</p>
        </div>

        {/* Outputs Generated */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6 hover:border-[#FBBF24] transition">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#a0a0a0] text-sm font-medium">Outputs Generated</h3>
            <FileText className="w-5 h-5" color="#FBBF24" />
          </div>
          <p className="text-3xl font-bold text-white">{kpis.outputsGenerated || 0}</p>
        </div>
      </div>

      {/* Row 2: Charts */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Cost by Agent */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Cost by Agent</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={costByAgent} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2f" />
              <XAxis type="number" stroke="#a0a0a0" />
              <YAxis dataKey="name" type="category" stroke="#a0a0a0" width={100} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1f',
                  border: `1px solid #2a2a2f`,
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="cost" fill={COLORS.accent} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tasks by Status */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Tasks by Status</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={tasksByStatus}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ status, count }) => `${status}: ${count}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="count"
              >
                {tasksByStatus.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={STATUS_COLORS[entry.status] || '#8884d8'}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1f',
                  border: `1px solid #2a2a2f`,
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 3: Utilization & Sections */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Agent Utilization Table */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Agent Utilization</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2f]">
                  <th className="text-left py-3 px-4 text-[#a0a0a0] font-medium">Agent</th>
                  <th className="text-left py-3 px-4 text-[#a0a0a0] font-medium">Status</th>
                  <th className="text-right py-3 px-4 text-[#a0a0a0] font-medium">Tasks</th>
                  <th className="text-right py-3 px-4 text-[#a0a0a0] font-medium">Quality</th>
                  <th className="text-right py-3 px-4 text-[#a0a0a0] font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {agentUtilization.map((agent, idx) => (
                  <tr key={idx} className="border-b border-[#2a2a2f] hover:bg-[#13131a]">
                    <td className="py-3 px-4 text-white font-medium">{agent.name}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block w-2 h-2 rounded-full mr-2 ${
                          agent.status === 'active'
                            ? 'bg-[#34D399]'
                            : agent.status === 'idle'
                              ? 'bg-[#60A5FA]'
                              : 'bg-[#6B7280]'
                        }`}
                      ></span>
                      <span className="text-[#a0a0a0] text-xs">{agent.status}</span>
                    </td>
                    <td className="py-3 px-4 text-white text-right">{agent.tasks}</td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-[#34D399]">{agent.quality}</span>
                    </td>
                    <td className="py-3 px-4 text-white text-right">${agent.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section Breakdown */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Section Breakdown</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sectionBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2f" />
              <XAxis dataKey="section" stroke="#a0a0a0" />
              <YAxis stroke="#a0a0a0" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1f',
                  border: `1px solid #2a2a2f`,
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="tasks" fill={COLORS.accent}>
                {sectionBreakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color || COLORS.accent} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 4: Trends & Quality */}
      <div className="grid grid-cols-2 gap-6">
        {/* Cost Trend */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Cost Trend (7 Days)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={costTrend}>
              <defs>
                <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2f" />
              <XAxis dataKey="date" stroke="#a0a0a0" />
              <YAxis stroke="#a0a0a0" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1f',
                  border: `1px solid #2a2a2f`,
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke={COLORS.accent}
                fillOpacity={1}
                fill="url(#colorCost)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Quality Distribution */}
        <div className="bg-[#1a1a1f] border border-[#2a2a2f] rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Quality Distribution</h2>
          <div className="space-y-4 max-h-80 overflow-y-auto">
            {qualityDistribution
              .sort((a, b) => b.quality - a.quality)
              .map((agent, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-[#a0a0a0] font-medium">{agent.name}</span>
                  <div className="flex items-center gap-3 flex-1 ml-4">
                    <div className="w-full bg-[#2a2a2f] rounded-full h-2">
                      <div
                        className="bg-[#34D399] h-2 rounded-full transition-all"
                        style={{ width: `${agent.quality}%` }}
                      ></div>
                    </div>
                    <span className="text-white font-bold w-12 text-right">
                      {agent.quality}%
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
