'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Filter, X } from 'lucide-react';
import Modal from '@/components/Modal';

const SECTION_COLORS = {
  'social-media': '#A78BFA',
  'marketing': '#60A5FA',
  'content': '#34D399',
  'analytics': '#F59E0B',
  'engineering': '#EF5350',
  'research': '#8B5CF6',
  'customer-support': '#EC4899',
};

const PRIORITY_STYLES = {
  low: 'bg-gray-700 text-gray-100',
  medium: 'bg-amber-700 text-amber-100',
  high: 'bg-red-700 text-red-100',
  urgent: 'bg-red-600 text-red-100 animate-pulse',
};

const COLUMNS = ['Backlog', 'In Progress', 'Review', 'Done', 'Rejected'];

export default function PipelinePage() {
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    agent_id: '',
    section: '',
    status: 'Backlog',
    priority: 'medium',
    description: '',
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAgent, setFilterAgent] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [tasksRes, agentsRes] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/agents'),
      ]);
      const tasksData = await tasksRes.json();
      const agentsData = await agentsRes.json();
      setTasks(tasksData || []);
      setAgents(agentsData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const openNewTask = () => {
    setEditingTask(null);
    setFormData({
      title: '',
      agent_id: '',
      section: '',
      status: 'Backlog',
      priority: 'medium',
      description: '',
    });
    setShowModal(true);
  };

  const openEditTask = (task) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      agent_id: task.agent_id || '',
      section: task.section || '',
      status: task.status,
      priority: task.priority,
      description: task.description,
    });
    setShowModal(true);
  };

  const handleAgentChange = (agentId) => {
    const agent = agents.find((a) => a.id == agentId);
    setFormData({
      ...formData,
      agent_id: agentId,
      section: agent?.section || formData.section,
    });
  };

  const saveTask = async () => {
    if (!formData.title.trim()) {
      alert('Please enter a task title');
      return;
    }
    try {
      const method = editingTask ? 'PUT' : 'POST';
      const url = editingTask ? `/api/tasks?id=${editingTask.id}` : '/api/tasks';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setShowModal(false);
        fetchData();
      }
    } catch (error) {
      console.error('Error saving task:', error);
    }
  };

  const deleteTask = async (taskId) => {
    if (!confirm('Delete this task?')) return;
    try {
      const response = await fetch(`/api/tasks?id=${taskId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.agent_name && task.agent_name.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesSection = !filterSection || task.section === filterSection;
    const matchesPriority = !filterPriority || task.priority === filterPriority;
    const matchesAgent = !filterAgent || task.agent_id == filterAgent;
    return matchesSearch && matchesSection && matchesPriority && matchesAgent;
  });

  // Group by status
  const tasksByStatus = {};
  COLUMNS.forEach((col) => {
    tasksByStatus[col] = filteredTasks.filter((t) => t.status === col);
  });

  const sections = [...new Set(tasks.map((t) => t.section).filter(Boolean))];
  const priorities = ['low', 'medium', 'high', 'urgent'];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-dark">
        <div className="text-accent">Loading pipeline...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-dark p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-white">Pipeline</h1>
        <button onClick={openNewTask} className="btn-accent flex items-center gap-2">
          <Plus size={18} /> New Task
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-3 text-gray-500" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-10 w-full"
          />
        </div>
        <select
          value={filterSection}
          onChange={(e) => setFilterSection(e.target.value)}
          className="select-field"
        >
          <option value="">All Sections</option>
          {sections.map((section) => (
            <option key={section} value={section}>
              {section}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="select-field"
        >
          <option value="">All Priorities</option>
          {priorities.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="select-field"
        >
          <option value="">All Agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      {/* Kanban Columns */}
      <div className="flex gap-6 overflow-x-auto pb-4">
        {COLUMNS.map((column) => (
          <div key={column} className="flex-shrink-0 w-80">
            {/* Column Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{column}</h2>
              <span className="badge-default">{tasksByStatus[column].length}</span>
            </div>

            {/* Card Container */}
            <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto">
              {tasksByStatus[column].map((task) => (
                <div
                  key={task.id}
                  className={`group kanban-card border-l-4 cursor-pointer transition-all hover:shadow-lg ${
                    column === 'Rejected' ? 'opacity-40' : ''
                  }`}
                  style={{
                    borderLeftColor: SECTION_COLORS[task.section] || '#666',
                  }}
                  onClick={() => openEditTask(task)}
                >
                  {/* Title */}
                  <h3 className="font-semibold text-white text-sm mb-2">{task.title}</h3>

                  {/* Agent Badge */}
                  {task.agent_name && (
                    <div className="mb-2">
                      <span className="badge-default text-xs">{task.agent_name}</span>
                    </div>
                  )}

                  {/* Priority Tag */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`badge-default text-xs py-1 px-2 ${PRIORITY_STYLES[task.priority]}`}>
                      {task.priority.toUpperCase()}
                    </span>
                  </div>

                  {/* Date */}
                  {task.created_at && (
                    <div className="text-xs text-gray-400 mono">
                      {new Date(task.created_at).toLocaleDateString()}
                    </div>
                  )}

                  {/* Delete button (on hover) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteTask(task.id);
                    }}
                    className="mt-2 text-xs text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Task Modal */}
      {showModal && (
        <Modal
          title={editingTask ? 'Edit Task' : 'New Task'}
          onClose={() => setShowModal(false)}
          onSubmit={saveTask}
        >
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="label">Task Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input-field w-full"
                placeholder="Enter task title"
              />
            </div>

            {/* Agent */}
            <div>
              <label className="label">Agent</label>
              <select
                value={formData.agent_id}
                onChange={(e) => handleAgentChange(e.target.value)}
                className="select-field w-full"
              >
                <option value="">Select Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Section */}
            <div>
              <label className="label">Section</label>
              <select
                value={formData.section}
                onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                className="select-field w-full"
              >
                <option value="">Select Section</option>
                {Object.keys(SECTION_COLORS).map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="label">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="select-field w-full"
              >
                {COLUMNS.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="label">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="select-field w-full"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="label">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input-field w-full h-24 resize-none"
                placeholder="Task description"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
