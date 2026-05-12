'use client';

import { useState, useEffect } from 'react';
import { Search, Filter, ThumbsUp, ThumbsDown, MessageCircle, Check, X } from 'lucide-react';
import Modal from '@/components/Modal';

const TYPE_COLORS = {
  blog: 'bg-blue-600',
  ad: 'bg-orange-600',
  email: 'bg-purple-600',
  script: 'bg-green-600',
  social: 'bg-pink-600',
  report: 'bg-amber-600',
  proposal: 'bg-teal-600',
};

const TYPE_LABELS = {
  blog: 'Blog',
  ad: 'Ad',
  email: 'Email',
  script: 'Script',
  social: 'Social',
  report: 'Report',
  proposal: 'Proposal',
};

const STATUS_COLORS = {
  draft: 'status-draft',
  review: 'status-review',
  approved: 'status-approved',
  published: 'status-published',
  rejected: 'status-rejected',
};

export default function ContentPage() {
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const params = new URLSearchParams();
        if (typeFilter !== 'all') params.append('type', typeFilter);
        if (statusFilter !== 'all') params.append('status', statusFilter);
        const res = await fetch(`/api/content?${params}`);
        const data = await res.json();
        setContent(data);
      } catch (error) {
        console.error('Failed to fetch content:', error);
      } finally {
        setLoading(false);
      }
    };
    setLoading(true);
    fetchContent();
  }, [typeFilter, statusFilter]);

  const filteredContent = content.filter((item) =>
    item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.agent_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleApprove = async () => {
    if (!selectedItem) return;
    try {
      await fetch(`/api/content?id=${selectedItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      setContent(
        content.map((c) =>
          c.id === selectedItem.id ? { ...c, status: 'approved' } : c
        )
      );
      setShowApprovalModal(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('Failed to approve:', error);
    }
  };

  const handleReject = async () => {
    if (!selectedItem) return;
    try {
      await fetch(`/api/content?id=${selectedItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      setContent(
        content.map((c) =>
          c.id === selectedItem.id ? { ...c, status: 'rejected' } : c
        )
      );
      setShowApprovalModal(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('Failed to reject:', error);
    }
  };

  const toggleFeedback = (id, type) => {
    setFeedback((prev) => ({
      ...prev,
      [id]: prev[id] === type ? null : type,
    }));
  };

  return (
    <div className="surface-primary min-h-screen p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-6">Content</h1>

        {/* Filter Row */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search content..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg surface-secondary border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-4 py-2 rounded-lg surface-secondary border border-gray-700 text-white focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Types</option>
            <option value="blog">Blog</option>
            <option value="ad">Ad</option>
            <option value="email">Email</option>
            <option value="script">Script</option>
            <option value="social">Social</option>
            <option value="report">Report</option>
            <option value="proposal">Proposal</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 rounded-lg surface-secondary border border-gray-700 text-white focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="approved">Approved</option>
            <option value="published">Published</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Content Grid */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading content...</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredContent.map((item) => (
            <div
              key={item.id}
              className="card card-hover cursor-pointer transition-all"
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <span className={`badge ${TYPE_COLORS[item.type]} text-white text-xs px-2 py-1 rounded`}>
                  {TYPE_LABELS[item.type]}
                </span>
                <span className={`badge ${STATUS_COLORS[item.status]} text-xs px-2 py-1 rounded`}>
                  {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                </span>
              </div>

              {/* Title & Meta */}
              <h3 className="text-white font-bold mb-2 line-clamp-2">{item.title}</h3>
              <p className="text-gray-400 text-sm mb-3">{item.agent_name}</p>

              {/* Date & Word Count */}
              <div className="flex justify-between text-gray-500 text-xs mb-4">
                <span>{new Date(item.created_at).toLocaleDateString()}</span>
                <span>{item.word_count} words</span>
              </div>

              {/* Expanded Preview & Feedback */}
              {expandedId === item.id && (
                <div className="border-t border-gray-700 pt-4 mt-4 space-y-4">
                  {/* Preview Text */}
                  <div className="text-gray-300 text-sm line-clamp-4">{item.preview_text}</div>

                  {/* Feedback Section */}
                  <div className="space-y-3">
                    {/* Vote Buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFeedback(item.id, 'upvote');
                        }}
                        className={`feedback-btn flex items-center gap-1 text-xs px-2 py-1 rounded ${
                          feedback[item.id] === 'upvote'
                            ? 'bg-green-600 text-white'
                            : 'surface-secondary text-gray-400 hover:text-green-400'
                        }`}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFeedback(item.id, 'downvote');
                        }}
                        className={`feedback-btn flex items-center gap-1 text-xs px-2 py-1 rounded ${
                          feedback[item.id] === 'downvote'
                            ? 'bg-red-600 text-white'
                            : 'surface-secondary text-gray-400 hover:text-red-400'
                        }`}
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </button>
                      <button className="feedback-btn flex items-center gap-1 text-xs px-2 py-1 rounded surface-secondary text-gray-400 hover:text-orange-400">
                        <MessageCircle className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Quick Tags */}
                    <div className="flex flex-wrap gap-2">
                      {['engaging', 'clear', 'needs-work'].map((tag) => (
                        <button
                          key={tag}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs px-2 py-1 rounded surface-secondary text-gray-400 hover:text-orange-400"
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Approve/Reject for Review Items */}
                  {item.status === 'review' && (
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItem(item);
                          setShowApprovalModal(true);
                        }}
                        className="btn-accent flex-1 flex items-center justify-center gap-2 text-sm"
                      >
                        <Check className="w-4 h-4" />
                        Approve
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReject();
                          setSelectedItem(item);
                        }}
                        className="btn-danger flex-1 flex items-center justify-center gap-2 text-sm"
                      >
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approval Modal */}
      {showApprovalModal && selectedItem && (
        <Modal
          isOpen={showApprovalModal}
          onClose={() => setShowApprovalModal(false)}
          title="Approve Content"
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-white font-bold mb-2">{selectedItem.title}</h4>
              <p className="text-gray-400 text-sm">{selectedItem.preview_text}</p>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleApprove}
                className="btn-accent flex-1"
              >
                Approve
              </button>
              <button
                onClick={() => setShowApprovalModal(false)}
                className="btn-default flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
