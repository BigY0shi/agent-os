'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  CheckCircle,
  Bot,
  Kanban,
  Wrench,
  FileText,
  Inbox,
  BarChart3,
  Settings,
  Brain,
  Workflow,
} from 'lucide-react';

export default function Sidebar({ pendingApprovalsCount = 0 }) {
  const pathname = usePathname();

  const isActive = (href) => pathname === href;

  const NavLink = ({ href, icon: Icon, label, badge }) => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        className={`
          flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all
          border-l-2
          ${
            active
              ? 'border-l-[#FF6B00] text-[#FF6B00] bg-[#FF6B00]/5'
              : 'border-l-transparent text-surface-300 hover:text-surface-200 hover:bg-surface-800/50'
          }
        `}
      >
        <Icon size={18} />
        <span className="flex-1">{label}</span>
        {badge && (
          <span className="ml-auto flex items-center justify-center w-5 h-5 text-xs font-bold bg-[#FF6B00] text-white rounded-full">
            {badge}
          </span>
        )}
      </Link>
    );
  };

  const SectionLabel = ({ children }) => (
    <div className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-surface-500 mt-5 first:mt-0">
      {children}
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex fixed left-0 top-0 h-screen w-[220px] flex-col bg-surface-950 border-r border-surface-600/30 z-40">
        {/* Top Section */}
        <div className="p-6 border-b border-surface-800/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold tracking-tight" style={{ fontFamily: 'Space Grotesk', fontSize: '15px' }}>
              YOSHI
            </span>
            <div className="w-2 h-2 rounded-full bg-[#FF6B00]" />
          </div>
          <p className="text-xs text-surface-400 uppercase tracking-wide">Agent OS</p>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4 px-2">
          {/* Command */}
          <SectionLabel>Command</SectionLabel>
          <div className="space-y-1">
            <NavLink href="/" icon={LayoutDashboard} label="Dashboard" />
            <NavLink
              href="/approvals"
              icon={CheckCircle}
              label="Approvals"
              badge={pendingApprovalsCount > 0 ? pendingApprovalsCount : null}
            />
          </div>

          {/* Fleet */}
          <SectionLabel>Fleet</SectionLabel>
          <div className="space-y-1">
            <NavLink href="/agents" icon={Bot} label="Agents" />
            <NavLink href="/pipeline" icon={Kanban} label="Pipeline" />
          </div>

          {/* Build */}
          <SectionLabel>Build</SectionLabel>
          <div className="space-y-1">
            <NavLink href="/skills" icon={Wrench} label="Skills & Tools" />
            <NavLink href="/memory" icon={Brain} label="Memory OS" />
            <NavLink href="/pipelines" icon={Workflow} label="Pipelines" />
          </div>

          {/* Content */}
          <SectionLabel>Content</SectionLabel>
          <div className="space-y-1">
            <NavLink href="/content" icon={FileText} label="Content" />
            <NavLink href="/reports" icon={Inbox} label="Reports" />
          </div>

          {/* Insights */}
          <SectionLabel>Insights</SectionLabel>
          <div className="space-y-1">
            <NavLink href="/analytics" icon={BarChart3} label="Analytics" />
          </div>
        </div>

        {/* Bottom Section */}
        <div className="border-t border-surface-800/50 p-2 space-y-1">
          <NavLink href="/settings" icon={Settings} label="Settings" />

          <button className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-surface-400 hover:text-surface-300 hover:bg-surface-800/50 rounded-md transition-all">
            <span className="text-lg">◑</span>
          </button>

          <div className="px-3 py-2 text-xs text-surface-500 text-center border-t border-surface-800/50 pt-3">
            v2.0
          </div>
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 h-14 bg-surface-950 border-t border-surface-600/30 z-40">
        <div className="flex items-center justify-start gap-1 h-full px-2 overflow-x-auto">
          <Link
            href="/"
            className={`flex flex-col items-center justify-center min-w-[3rem] h-12 rounded-md transition-all shrink-0 ${
              isActive('/') ? 'text-[#FF6B00] bg-[#FF6B00]/5' : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            <LayoutDashboard size={20} />
          </Link>

          <Link
            href="/agents"
            className={`flex flex-col items-center justify-center min-w-[3rem] h-12 rounded-md transition-all shrink-0 ${
              isActive('/agents') ? 'text-[#FF6B00] bg-[#FF6B00]/5' : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            <Bot size={20} />
          </Link>

          <Link
            href="/pipeline"
            className={`flex flex-col items-center justify-center min-w-[3rem] h-12 rounded-md transition-all shrink-0 ${
              isActive('/pipeline') ? 'text-[#FF6B00] bg-[#FF6B00]/5' : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            <Kanban size={20} />
          </Link>

          <Link
            href="/skills"
            className={`flex flex-col items-center justify-center min-w-[3rem] h-12 rounded-md transition-all shrink-0 ${
              isActive('/skills') ? 'text-[#FF6B00] bg-[#FF6B00]/5' : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            <Wrench size={20} />
          </Link>

          <Link
            href="/memory"
            className={`flex flex-col items-center justify-center min-w-[3rem] h-12 rounded-md transition-all shrink-0 ${
              isActive('/memory') ? 'text-[#FF6B00] bg-[#FF6B00]/5' : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            <Brain size={20} />
          </Link>

          <Link
            href="/pipelines"
            className={`flex flex-col items-center justify-center min-w-[3rem] h-12 rounded-md transition-all shrink-0 ${
              isActive('/pipelines') ? 'text-[#FF6B00] bg-[#FF6B00]/5' : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            <Workflow size={20} />
          </Link>

          <Link
            href="/analytics"
            className={`flex flex-col items-center justify-center min-w-[3rem] h-12 rounded-md transition-all shrink-0 ${
              isActive('/analytics') ? 'text-[#FF6B00] bg-[#FF6B00]/5' : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            <BarChart3 size={20} />
          </Link>
        </div>
      </div>
    </>
  );
}
