export const dynamic = 'force-dynamic';

import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function subDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function GET(request) {
  try {
    const db = await getDb();

    // Fetch KPIs
    const kpisData = db
      .prepare(
        `SELECT
          COUNT(CASE WHEN status = 'done' THEN 1 END) as tasks_completed,
          COUNT(*) as tasks_total
        FROM tasks`
      )
      .get();

    const agentsData = db
      .prepare(
        `SELECT
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_agents,
          COUNT(DISTINCT id) as total_agents
        FROM agents`
      )
      .get();

    const spendData = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total_spend
         FROM cost_entries
         WHERE DATE(created_at) = DATE('now')`
      )
      .get();

    const kpis = {
      tasksCompleted: kpisData?.tasks_completed || 0,
      tasksTotal: kpisData?.tasks_total || 0,
      qualityAvg: '89%',
      activeAgents: agentsData?.active_agents || 0,
      totalAgents: agentsData?.total_agents || 0,
      spendToday: parseFloat(spendData?.total_spend || 0),
    };

    // Fetch Pending Decisions
    const decisions = db
      .prepare(
        `SELECT id, agent_name, section, action, type, created_at
         FROM decisions
         WHERE status = 'pending'
         ORDER BY created_at DESC`
      )
      .all();

    // Fetch Active Alerts
    const alerts = db
      .prepare(
        `SELECT id, agent_name, type, message, created_at
         FROM alerts
         WHERE status = 'active'
         ORDER BY created_at DESC`
      )
      .all();

    // Fetch Timeline Data
    const now = new Date();
    const yesterdayStart = startOfDay(subDays(now, 1));
    const yesterdayEnd = endOfDay(subDays(now, 1));
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const yesterday = db
      .prepare(
        `SELECT id, title, agent_id, created_at, completed_at
         FROM tasks
         WHERE status = 'done'
         AND completed_at >= ? AND completed_at <= ?
         ORDER BY completed_at DESC
         LIMIT 10`
      )
      .all(yesterdayStart.toISOString(), yesterdayEnd.toISOString());

    const today = db
      .prepare(
        `SELECT id, title, agent_id, created_at
         FROM tasks
         WHERE status = 'in-progress'
         AND created_at >= ? AND created_at <= ?
         ORDER BY created_at DESC
         LIMIT 10`
      )
      .all(todayStart.toISOString(), todayEnd.toISOString());

    const scheduled = db
      .prepare(
        `SELECT id, title, agent_id, created_at
         FROM tasks
         WHERE status = 'backlog'
         ORDER BY created_at ASC
         LIMIT 10`
      )
      .all();

    const timeline = {
      yesterday,
      today,
      scheduled,
    };

    // Fetch Cost Chart Data (last 7 days)
    const sevenDaysAgo = subDays(now, 7);
    const costEntries = db
      .prepare(
        `SELECT
          DATE(created_at) as day,
          ROUND(SUM(amount), 2) as cost
         FROM cost_entries
         WHERE created_at >= ?
         GROUP BY DATE(created_at)
         ORDER BY created_at ASC`
      )
      .all(sevenDaysAgo.toISOString());

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const costMap = {};
    costEntries.forEach((entry) => {
      costMap[entry.day] = entry.cost;
    });

    const chart = [];
    for (let i = 6; i >= 0; i--) {
      const date = subDays(now, i);
      const dateStr = formatDate(date);
      const dayName = dayNames[date.getDay()];
      chart.push({
        day: dayName,
        cost: costMap[dateStr] ? parseFloat(costMap[dateStr]) : 0,
      });
    }

    const totalSpend = chart.reduce((sum, day) => sum + day.cost, 0);

    const costs = {
      chart,
      total: parseFloat(totalSpend.toFixed(2)),
    };

    return NextResponse.json({
      kpis,
      decisions,
      alerts,
      timeline,
      costs,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
