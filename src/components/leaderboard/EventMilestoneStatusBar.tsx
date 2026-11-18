// ─────────────────────────────────────────────
// EventMilestoneStatusBar — NULL Storyline & Verified Milestone Telemetry
// Real-time restoration metrics calculated strictly from verified team checkpoints
// ─────────────────────────────────────────────

import { ShieldAlert, Cpu, Terminal, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Team, FirestoreEventConfig, HackathonCheckpoint } from '../../types';
import { DEFAULT_CHECKPOINTS } from '../../services/eventConfigService';

interface EventMilestoneStatusBarProps {
  teams: Team[];
  eventConfig?: FirestoreEventConfig | null;
}

export default function EventMilestoneStatusBar({ teams, eventConfig }: EventMilestoneStatusBarProps) {
  const checkpoints: HackathonCheckpoint[] =
    eventConfig?.checkpoints || DEFAULT_CHECKPOINTS;

  const activeTeams = teams.filter((t) => t.active !== false);
  const totalTeams = Math.max(1, activeTeams.length);

  // Calculate verified checkpoints strictly from real team evaluation data
  let totalPossibleCheckpoints = totalTeams * checkpoints.filter((c) => c.enabled).length;
  let verifiedCheckpointCount = 0;

  activeTeams.forEach((team) => {
    const report = team.latestEvaluationReport;
    if (report && Array.isArray(report.checkpoints)) {
      report.checkpoints.forEach((cp) => {
        if (cp.status === 'VERIFIED') {
          verifiedCheckpointCount++;
        }
      });
    } else if (team.validatedIssueCount && team.validatedIssueCount > 0) {
      // Fallback for legacy teams
      verifiedCheckpointCount += Math.min(team.validatedIssueCount, checkpoints.length);
    }
  });

  if (totalPossibleCheckpoints === 0) totalPossibleCheckpoints = 1;
  const restorationPercentage = Math.min(
    100,
    Math.round((verifiedCheckpointCount / totalPossibleCheckpoints) * 100)
  );

  // NULL Threat Level is inverse of verified system restoration
  const nullThreatLevel = Math.max(0, 100 - restorationPercentage);

  // Determine current active milestone phase across the event
  let activePhaseName = 'Phase 1: Mission Blueprint';
  if (restorationPercentage >= 90) {
    activePhaseName = 'Phase 5: Verification & Academic Finalization';
  } else if (restorationPercentage >= 70) {
    activePhaseName = 'Phase 4: Execution & Runtime Validation';
  } else if (restorationPercentage >= 45) {
    activePhaseName = 'Phase 3: Integration & Collaboration';
  } else if (restorationPercentage >= 20) {
    activePhaseName = 'Phase 2: Core Domain Implementation';
  }

  const isFinalized = activeTeams.length > 0 && activeTeams.every(
    (t) => t.rankingStatus === 'FINALIZED' || (t.facultyScore !== undefined && t.gitProcessScore !== undefined)
  );

  return (
    <div className="w-full rounded-2xl border border-slate-800/90 bg-[#080B15]/90 backdrop-blur-md p-4 sm:p-5 shadow-2xl space-y-4 font-mono relative overflow-hidden">
      {/* Background cyber accent glow */}
      <div
        className="absolute -right-20 -top-20 w-72 h-72 rounded-full opacity-10 blur-3xl pointer-events-none"
        style={{
          background: nullThreatLevel > 50
            ? 'radial-gradient(circle, #FF003C 0%, transparent 70%)'
            : 'radial-gradient(circle, #10B981 0%, transparent 70%)',
        }}
      />

      {/* Top telemetry bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
              nullThreatLevel > 50
                ? 'bg-rose-950/30 border-rose-500/40 text-rose-400 animate-pulse'
                : 'bg-emerald-950/30 border-emerald-500/40 text-emerald-400'
            }`}
          >
            <ShieldAlert size={18} />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <span>Sector NØLL Containment Status</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">
                Live Telemetry
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Active Phase: <span className="text-rose-400 font-semibold">{activePhaseName}</span>
            </div>
          </div>
        </div>

        {/* Verification Badge */}
        <div className="flex items-center gap-2">
          {isFinalized ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-950/40 border border-emerald-500/40 text-emerald-300">
              <CheckCircle2 size={13} />
              <span>Rankings Finalized</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-950/30 border border-amber-500/40 text-amber-300">
              <AlertTriangle size={13} />
              <span>Evaluations In Progress</span>
            </span>
          )}
        </div>
      </div>

      {/* Progress gauges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {/* System Restoration Meter */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5">
              <Cpu size={14} className="text-emerald-400" />
              <span>System Restoration</span>
            </span>
            <span className="font-bold text-slate-200">{restorationPercentage}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
              style={{ width: `${restorationPercentage}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500">
            {verifiedCheckpointCount} of {totalPossibleCheckpoints} squad milestone checkpoints verified
          </div>
        </div>

        {/* NULL Threat Level */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5">
              <Terminal size={14} className="text-rose-400" />
              <span>NULL AI Control Level</span>
            </span>
            <span className="font-bold text-rose-400">{nullThreatLevel}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-500"
              style={{ width: `${nullThreatLevel}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500">
            NULL control weakens as squads progress through development checkpoints
          </div>
        </div>

        {/* Checkpoint Milestones Breakdown */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
          <div className="text-slate-400 font-semibold flex items-center justify-between">
            <span>Milestones Catalog</span>
            <span className="text-slate-500 text-[10px]">{checkpoints.length} Tracks</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {checkpoints.map((cp) => (
              <span
                key={cp.id}
                title={`${cp.displayName} (${cp.xpValue} XP)`}
                className="px-2 py-0.5 rounded text-[10px] bg-slate-800/80 border border-slate-700/60 text-slate-300"
              >
                {cp.displayName.split(' ')[0]} ({cp.xpValue} XP)
              </span>
            ))}
          </div>
          <div className="text-[10px] text-slate-500">
            Academic problem statements evaluated post-event
          </div>
        </div>
      </div>
    </div>
  );
}
