// ─────────────────────────────────────────────
// StatusBadge — Clean Reusable Status Pill
// ─────────────────────────────────────────────

import type { PRStatus, ParticipantStatus, RepositoryStatus, TestStatus } from '../../types';

type StatusValue = PRStatus | ParticipantStatus | RepositoryStatus | TestStatus | string;

interface StatusBadgeProps {
  status: StatusValue;
  size?: 'sm' | 'md';
}

const CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  // PR statuses & Processing states
  merged:         { label: 'Merged',          color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  open:           { label: 'Open',            color: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/30',          dot: 'bg-blue-500 dark:bg-blue-400' },
  closed:         { label: 'Closed',          color: 'text-slate-700 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30',       dot: 'bg-slate-400' },
  flagged:        { label: 'Flagged',         color: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30',          dot: 'bg-rose-500 dark:bg-rose-400' },
  pending:        { label: 'Pending',         color: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30',       dot: 'bg-amber-500 dark:bg-amber-400' },
  auto_approved:  { label: 'AUTO-APPROVED',   color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/20 dark:border-emerald-500/40', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  pending_review: { label: 'PENDING REVIEW',  color: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/20 dark:border-amber-500/40',       dot: 'bg-amber-500 dark:bg-amber-400' },
  rejected:       { label: 'REJECTED',        color: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-500/20 dark:border-rose-500/40',          dot: 'bg-rose-500 dark:bg-rose-400' },
  force_merged:   { label: 'FORCE MERGED',    color: 'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-300 dark:bg-purple-500/20 dark:border-purple-500/40',    dot: 'bg-purple-500 dark:bg-purple-400' },

  // Participant statuses
  active:   { label: 'Active',   color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  inactive: { label: 'Inactive', color: 'text-slate-700 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30',       dot: 'bg-slate-400' },
  escaped:  { label: 'Escaped',  color: 'text-cyan-700 bg-cyan-50 border-cyan-200 dark:text-cyan-300 dark:bg-cyan-500/15 dark:border-cyan-500/30',          dot: 'bg-cyan-500 dark:bg-cyan-400' },

  // Repo statuses
  archived: { label: 'Archived', color: 'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30', dot: 'bg-purple-500 dark:bg-purple-400' },

  // Test statuses
  passing:  { label: 'Passing',  color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  failing:  { label: 'Failing',  color: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30',          dot: 'bg-rose-500 dark:bg-rose-400' },
  skipped:  { label: 'Skipped',  color: 'text-slate-700 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30',       dot: 'bg-slate-400' },

  // Webhook statuses
  processed: { label: 'PROCESSED', color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  ignored:   { label: 'IGNORED',   color: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30',       dot: 'bg-amber-500 dark:bg-amber-400' },
  failed:    { label: 'FAILED',    color: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30',          dot: 'bg-rose-500 dark:bg-rose-400' },
  received:  { label: 'RECEIVED',  color: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/30',          dot: 'bg-blue-500 dark:bg-blue-400' },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const cfg = CONFIG[status.toLowerCase()] ?? {
    label: status,
    color: 'text-slate-700 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30',
    dot: 'bg-slate-400',
  };

  const padding = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${padding} ${cfg.color}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
