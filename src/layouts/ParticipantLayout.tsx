import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ProoflyGlobalHeader } from '../components/layout/ProoflyGlobalHeader';
import { ToastProvider } from '../components/ui/Toast';

export const ParticipantLayout: React.FC = () => {
  const location = useLocation();

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 font-sans flex flex-col w-full">
        <ProoflyGlobalHeader />

        <main
          key={location.pathname}
          className="proofly-page-enter flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        >
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
          Proofly
        </footer>
      </div>
    </ToastProvider>
  );
};
