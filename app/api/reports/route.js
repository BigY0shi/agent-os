export const dynamic = 'force-dynamic';

import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';

const MOCK_REPORTS = [
  {
    id: '1',
    title: 'System Performance Metrics - March 2026',
    agent_name: 'Monitoring Agent',
    section: 'performance',
    content:
      'Uptime: 99.98%\nAverage Response Time: 145ms\nP95 Latency: 320ms\n\nKey observations:\n- Peak traffic hours (2-4 PM EST) show 15% increase in response times\n- Database query optimization reduced average query time by 23%\n- No critical incidents reported this month\n\nRecommendations:\n- Implement caching layer for frequently accessed resources\n- Scale database read replicas during peak hours',
    created_at: '2026-04-05T09:15:00Z',
    read: false,
    starred: true,
  },
  {
    id: '2',
    title: 'Security Audit - Weekly Report',
    agent_name: 'Security Agent',
    section: 'security',
    content:
      'Completed comprehensive security scan across all production systems.\n\nFindings:\n- 2 medium severity vulnerabilities identified in API endpoints\n- 0 critical vulnerabilities\n- All third-party dependencies are up to date\n\nActions taken:\n- Patched authentication middleware\n- Updated SSL certificates\n- Rotated API keys\n\nNext review: April 16, 2026',
    created_at: '2026-04-08T14:30:00Z',
    read: false,
    starred: false,
  },
  {
    id: '3',
    title: 'Compliance Status Check',
    agent_name: 'Compliance Agent',
    section: 'compliance',
    content:
      'GDPR Compliance: 100% ✓\nSOC 2 Type II: In Progress (95% complete)\nISO 27001: Certified\n\nCurrent status:\n- Data handling procedures reviewed and approved\n- Access logs maintained for 180 days\n- Incident response plan tested\n\nUpcoming deadlines:\n- SOC 2 completion: May 15, 2026\n- Annual GDPR audit: June 1, 2026',
    created_at: '2026-04-07T11:00:00Z',
    read: true,
    starred: true,
  },
  {
    id: '4',
    title: 'Optimization Opportunities',
    agent_name: 'Analytics Agent',
    section: 'optimization',
    content:
      'Analysis of resource utilization patterns.\n\nKey findings:\n- 12% of compute resources idle during off-peak hours\n- Database connection pool can be reduced by 20%\n- Image delivery could benefit from WebP compression (estimated 30% savings)\n\nEstimated savings:\n- $2,400/month in cloud compute costs\n- 40% faster image load times\n- Improved Core Web Vitals scores\n\nImplementation timeline: 3-4 weeks',
    created_at: '2026-04-06T13:45:00Z',
    read: true,
    starred: false,
  },
  {
    id: '5',
    title: 'User Feedback Summary - April 2026',
    agent_name: 'User Research Agent',
    section: 'user_feedback',
    content:
      'Collected and analyzed 342 user feedback entries this month.\n\nTop requested features:\n1. Dark mode enhancement (87 requests)\n2. Export to PDF functionality (64 requests)\n3. Mobile app version (52 requests)\n\nSatisfaction scores:\n- Overall satisfaction: 8.3/10 (+0.5 from last month)\n- Feature completeness: 7.9/10\n- Performance: 8.7/10\n- Documentation quality: 7.2/10\n\nRecommended actions:\n- Prioritize dark mode improvements\n- Begin research on mobile app feasibility',
    created_at: '2026-04-09T08:20:00Z',
    read: false,
    starred: false,
  },
  {
    id: '6',
    title: 'Infrastructure Health Check',
    agent_name: 'Infrastructure Agent',
    section: 'system',
    content:
      'All systems operational.\n\nStatus summary:\n- API Servers: 100% healthy\n- Database Cluster: Replication lag < 100ms\n- Cache Layer: 94% hit rate\n- Load Balancers: Even distribution\n\nMaintenance completed:\n- OS patches applied to 12 servers\n- Network configuration optimized\n- Backup integrity verified\n\nNext scheduled maintenance: April 20, 2026 (3 AM UTC)',
    created_at: '2026-04-04T16:00:00Z',
    read: true,
    starred: false,
  },
];

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter');

  let filtered = [...MOCK_REPORTS];

  if (filter === 'unread') {
    filtered = filtered.filter((r) => !r.read);
  } else if (filter === 'starred') {
    filtered = filtered.filter((r) => r.starred);
  }

  // Sort: starred first, then by created_at DESC
  filtered.sort((a, b) => {
    if (a.starred !== b.starred) return b.starred ? 1 : -1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return Response.json(filtered);
}

export async function PUT(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const body = await request.json();

  const index = MOCK_REPORTS.findIndex((r) => r.id === id);
  if (index === -1) {
    return Response.json({ error: 'Report not found' }, { status: 404 });
  }

  MOCK_REPORTS[index] = { ...MOCK_REPORTS[index], ...body };
  return Response.json(MOCK_REPORTS[index]);
}
