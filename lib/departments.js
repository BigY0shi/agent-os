/** Corporate departments — shared team_id values for agents & memory */
export const DEPARTMENTS = [
  { id: 'ceo', label: 'CEO', desc: 'Strategy, Vision, Leadership', color: '#F59E0B' },
  { id: 'cto', label: 'CTO', desc: 'Engineering, DevOps, Architecture', color: '#3B82F6' },
  { id: 'cmo', label: 'CMO', desc: 'Content, Social, Campaigns, SEO', color: '#EC4899' },
  { id: 'cfo', label: 'CFO', desc: 'Budgets, Invoicing, Cost Analysis', color: '#10B981' },
  { id: 'coo', label: 'COO', desc: 'Workflows, Processes, Logistics', color: '#8B5CF6' },
  { id: 'cio', label: 'CIO', desc: 'Data, Analytics, Research', color: '#06B6D4' },
  { id: 'chro', label: 'CHRO', desc: 'Team, Training, Culture', color: '#F97316' },
];

export function getDeptLabel(deptId) {
  const dept = DEPARTMENTS.find((d) => d.id === deptId);
  return dept ? dept.label : deptId?.toUpperCase() || '—';
}
