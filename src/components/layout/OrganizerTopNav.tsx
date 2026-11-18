import React from 'react';
import { Menu, Search, Plus, Bell, ChevronDown } from 'lucide-react';
import { Button } from '../ui/Button';

interface OrganizerTopNavProps {
  onToggleSidebar: () => void;
  onNewCompetition?: () => void;
}

export const OrganizerTopNav: React.FC<OrganizerTopNavProps> = ({
  onToggleSidebar,
  onNewCompetition,
}) => {
  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-4">
      {/* Left: Mobile hamburger & Organization Switcher */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors md:hidden cursor-pointer"
          aria-label="Toggle navigation sidebar"
        >
          <Menu size={20} />
        </button>

        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer bg-slate-50/60">
          <span className="w-2 h-2 rounded-full bg-blue-600" />
          <span className="text-xs font-semibold text-slate-800">DeepMind Academic Guild</span>
          <ChevronDown size={14} className="text-slate-400" />
        </div>
      </div>

      {/* Middle: Minimal Global Search Input */}
      <div className="hidden md:flex items-center flex-1 max-w-md">
        <div className="relative w-full">
          <Search size={15} className="absolute left-3 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search competitions, submissions, rubrics..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-white focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-colors text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="absolute right-2.5 top-1.5 text-[10px] font-mono text-slate-400 border border-slate-200 rounded px-1 bg-white">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: Quick Action, Notifications, User */}
      <div className="flex items-center gap-2.5">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus size={14} />}
          onClick={onNewCompetition}
          className="hidden sm:inline-flex"
        >
          New Competition
        </Button>

        <button
          type="button"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors relative cursor-pointer"
          aria-label="Notifications"
        >
          <Bell size={17} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white" />
        </button>

        <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />

        <div className="flex items-center gap-2 cursor-pointer p-1 rounded-lg hover:bg-slate-50 transition-colors">
          <div className="w-7 h-7 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs">
            SK
          </div>
          <span className="text-xs font-semibold text-slate-700 hidden lg:inline-block">
            Saikeerthana
          </span>
          <ChevronDown size={13} className="text-slate-400 hidden lg:inline-block" />
        </div>
      </div>
    </header>
  );
};
