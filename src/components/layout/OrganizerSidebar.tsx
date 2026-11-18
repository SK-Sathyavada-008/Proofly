import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Trophy,
  Inbox,
  Sparkles,
  Users,
  Award,
  Settings,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';

interface OrganizerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OrganizerSidebar: React.FC<OrganizerSidebarProps> = ({ isOpen, onClose }) => {
  const location = useLocation();

  const navItems = [
    { label: 'Overview', to: '/organizer', icon: LayoutDashboard, exact: true },
    { label: 'Competitions', to: '/organizer/competitions', icon: Trophy },
    { label: 'Submissions', to: '/organizer/submissions', icon: Inbox },
    { label: 'Evaluations', to: '/organizer/evaluations', icon: Sparkles },
    { label: 'Judges', to: '/organizer/judges', icon: Users },
    { label: 'Results & Publishing', to: '/organizer/results', icon: Award },
    { label: 'Settings', to: '/organizer/settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-white border-r border-slate-200/90 flex flex-col transition-transform duration-200 ease-in-out md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 border-b border-slate-100 flex items-center justify-between">
          <NavLink to="/organizer" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <span className="font-bold text-sm tracking-wider">P</span>
            </div>
            <div>
              <span className="font-bold text-base text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors">
                Proofly
              </span>
              <span className="block text-[10px] font-medium text-slate-400 -mt-0.5">
                Organizer Workspace
              </span>
            </div>
          </NavLink>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Competition Management
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    size={16}
                    className={isActive ? 'text-blue-600' : 'text-slate-400'}
                  />
                  <span>{item.label}</span>
                </div>
                {isActive && <ChevronRight size={13} className="text-blue-500" />}
              </NavLink>
            );
          })}

          <div className="pt-5 px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Developer & Hybrid Engine
          </div>
          <NavLink
            to="/ai-test"
            className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all"
          >
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={16} className="text-emerald-600" />
              <span>AI Logic Test Spike</span>
            </div>
            <ExternalLink size={12} className="text-slate-400" />
          </NavLink>
        </div>

        {/* Footer Status & Organization Profile */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/50 space-y-3">
          <div className="p-2.5 rounded-lg border border-slate-200/80 bg-white shadow-2xs">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-700">Hybrid AI Runtime</span>
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">Gemini Nano 4 & 2.5 Flash</p>
          </div>

          <div className="flex items-center gap-2.5 px-1">
            <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
              SK
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">DeepMind Academic</p>
              <p className="text-[10px] text-slate-400 truncate">Lead Organizer</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
