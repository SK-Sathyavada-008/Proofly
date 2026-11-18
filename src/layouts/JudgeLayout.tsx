import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { ProoflyGlobalHeader } from '../components/layout/ProoflyGlobalHeader';
import { ToastProvider } from '../components/ui/Toast';

export const JudgeLayout: React.FC = () => {
  const location = useLocation();

  const judgeTabs = [
    { label: 'Assignments', to: '/judge/assignments' },
    { label: 'Review', to: '/judge/review' },
    { label: 'History', to: '/judge/history' },
  ];

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 font-sans flex flex-col w-full">
        <ProoflyGlobalHeader />

        <div className="w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto">
            <nav className="flex items-center gap-1 -mb-px">
              {judgeTabs.map((tab) => {
                const isActive = location.pathname.startsWith(tab.to);
                return (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    className={`py-2.5 px-3 border-b-2 text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
                      isActive
                        ? 'border-blue-600 dark:border-blue-400 text-slate-900 dark:text-slate-100'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {tab.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </div>

        <main
          key={location.pathname}
          className="proofly-page-enter flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"
        >
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  );
};
