// ─────────────────────────────────────────────
// Evaluation Center — Phase Post-Event Automated Repository Evaluation Console
// Checkpoint verification, Git workflow telemetry, safe static analysis,
// and administrative approval/override controls with audit logging.
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderGit2,
  Play,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  GitBranch,
  Terminal,
  ShieldCheck,
  Edit3,
  Search,
  Check,
  X,
  FileText,
  UserCheck,
  Plus,
  Zap,
  Trophy,
} from 'lucide-react';
import type { Team, RepoEvaluationReport } from '../../types';
import { teamService } from '../../services/teamService';
import { buildFromScratchService } from '../../services/buildFromScratchService';
import { bonusService } from '../../services/bonusService';
import RepositoryModal from '../../components/repositories/RepositoryModal';
import LoadingState from '../../components/ui/LoadingState';

export default function EvaluationCenterPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [activeReport, setActiveReport] = useState<RepoEvaluationReport | null>(null);

  const [evaluatingTeamId, setEvaluatingTeamId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add Repository Modal state
  const [showAddRepoModal, setShowAddRepoModal] = useState(false);

  // Override Modal state
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideScore, setOverrideScore] = useState<number>(80);
  const [overrideReason, setOverrideReason] = useState('');
  const [adminUsername] = useState('lead_evaluator');
  const [isOverriding, setIsOverriding] = useState(false);

  // Bonus XP Modal state
  const [isBonusModalOpen, setIsBonusModalOpen] = useState(false);
  const [bonusAmount, setBonusAmount] = useState<number>(50);
  const [bonusReason, setBonusReason] = useState('');
  const [isAwardingBonus, setIsAwardingBonus] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'evaluated' | 'pending' | 'review_required'>('all');

  useEffect(() => {
    setLoading(true);
    const unsub = teamService.subscribeToTeamsLeaderboard(
      (data) => {
        setTeams(data);
        setLoading(false);
        if (selectedTeam) {
          const updated = data.find((t) => t.id === selectedTeam.id);
          if (updated) {
            setSelectedTeam(updated);
            if (updated.latestEvaluationReport) {
              setActiveReport(updated.latestEvaluationReport);
            }
          }
        }
      },
      (err) => {
        console.error('[EvaluationCenter] Error subscribing to teams:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [selectedTeam?.id]);

  const handleSelectTeam = async (team: Team) => {
    setSelectedTeam(team);
    setActionError(null);
    setActionSuccess(null);

    if (team.latestEvaluationReport) {
      setActiveReport(team.latestEvaluationReport);
    } else {
      const report = await buildFromScratchService.getEvaluationReport(team.id);
      setActiveReport(report);
    }
  };

  const handleLaunchEvaluation = async (team: Team) => {
    try {
      setEvaluatingTeamId(team.id);
      setActionError(null);
      setActionSuccess(null);

      const report = await buildFromScratchService.evaluateRepository({
        teamId: team.id,
        githubUrl: team.githubUrl || `https://github.com/PRison-Break-2026/${team.repositoryName}`,
        adminUsername,
      });

      setActiveReport(report);
      setActionSuccess(`Evaluation complete for ${team.name}. Score: ${report.totalGitProcessScore}%, Earned XP: ${report.earnedXP}.`);
    } catch (err: any) {
      setActionError(err?.message || 'Error executing automated repository evaluation.');
    } finally {
      setEvaluatingTeamId(null);
    }
  };

  const handleApproveReport = async () => {
    if (!activeReport) return;
    try {
      setActionError(null);
      const approved = await buildFromScratchService.approveEvaluation(
        activeReport.id,
        adminUsername,
        'Evaluation verified and approved by evaluator'
      );
      setActiveReport(approved);
      setActionSuccess(`Approved evaluation for ${activeReport.teamName}.`);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to approve evaluation.');
    }
  };

  const handleOpenOverrideModal = () => {
    if (!activeReport) return;
    setOverrideScore(activeReport.totalGitProcessScore);
    setOverrideReason('');
    setIsOverrideModalOpen(true);
  };

  const handleConfirmOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReport) return;

    if (!overrideReason.trim() || overrideReason.trim().length < 5) {
      setActionError('A documented reason (min 5 characters) is required to override scores.');
      return;
    }

    try {
      setIsOverriding(true);
      setActionError(null);
      const updated = await buildFromScratchService.overrideEvaluation(
        activeReport.id,
        Number(overrideScore),
        adminUsername,
        overrideReason.trim()
      );
      setActiveReport(updated);
      setIsOverrideModalOpen(false);
      setActionSuccess(`Score successfully overridden to ${overrideScore}% with recorded audit log.`);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to override score.');
    } finally {
      setIsOverriding(false);
    }
  };

  const handleAwardBonusXP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam) return;

    if (!bonusReason.trim() || bonusReason.trim().length < 5) {
      setActionError('A mandatory reason (at least 5 characters) is required to award bonus XP.');
      return;
    }

    try {
      setIsAwardingBonus(true);
      setActionError(null);
      await bonusService.awardBonus({
        teamId: selectedTeam.id,
        amount: Number(bonusAmount),
        reason: bonusReason.trim(),
        adminUsername,
      });

      const updated = await teamService.getTeamById(selectedTeam.id);
      if (updated) setSelectedTeam(updated);

      setIsBonusModalOpen(false);
      setActionSuccess(`Awarded +${bonusAmount} Bonus XP to ${selectedTeam.name} with immutable audit log.`);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to award bonus XP.');
    } finally {
      setIsAwardingBonus(false);
    }
  };

  const handleRepositoryAdded = async () => {
    setShowAddRepoModal(false);
    const updatedTeams = await teamService.getTeams();
    setTeams(updatedTeams);
    setActionSuccess('Repository registered successfully! Select it below to run automated evaluation.');
  };

  const filteredTeams = teams.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.repositoryName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.problemTitle && t.problemTitle.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (statusFilter === 'evaluated') {
      return t.latestEvaluationReport?.status === 'APPROVED' || t.evaluationStatus === 'COMPLETED';
    }
    if (statusFilter === 'review_required') {
      return t.latestEvaluationReport?.manualReviewRequired || t.evaluationStatus === 'REVIEW_REQUIRED';
    }
    if (statusFilter === 'pending') {
      return !t.latestEvaluationReport || t.evaluationStatus === 'NOT_STARTED';
    }

    return true;
  });

  return (
    <div className="w-full space-y-6 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <FolderGit2 className="text-[#FF1E46]" size={26} />
            <span>Evaluation Center & Agent Reports</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Build-from-Scratch Hackathon &mdash; Post-event automated Git workflow, milestone checkpoints, and code quality audits
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddRepoModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF0A3B] hover:bg-[#FF1E46] text-white text-xs font-bold transition-all shadow-lg shadow-rose-950/40"
          >
            <Plus size={15} />
            <span>Add Repository</span>
          </button>
          <Link
            to="/admin/leaderboard"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all border border-slate-700"
          >
            <Trophy size={14} className="text-amber-400" />
            <span>Leaderboard</span>
          </Link>
          <div className="text-xs text-slate-400 pl-2 border-l border-slate-800 hidden sm:block">
            Admin: <span className="text-slate-200 font-semibold font-mono">@{adminUsername}</span>
          </div>
        </div>
      </div>

      {/* Action alerts */}
      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Squad Selector & List (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 rounded-2xl bg-[#090C19] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Submitted Repositories ({filteredTeams.length})
              </span>
              <button
                onClick={() => setShowAddRepoModal(true)}
                className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 font-semibold"
              >
                <Plus size={12} />
                <span>Add Repo</span>
              </button>
            </div>

            {/* Filter & Search */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search squad or project..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="evaluated">Evaluated</option>
                <option value="review_required">Needs Review</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            {/* Team List */}
            {loading ? (
              <LoadingState message="Loading squad repositories..." />
            ) : filteredTeams.length === 0 ? (
              <div className="p-8 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-3">
                <FolderGit2 className="mx-auto text-slate-600" size={32} />
                <div className="text-xs font-bold text-slate-300">No Repositories Found</div>
                <p className="text-[11px] text-slate-500">
                  Add student GitHub repository links to begin automated evaluations.
                </p>
                <button
                  onClick={() => setShowAddRepoModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#FF0A3B] hover:bg-[#FF1E46] text-white text-xs font-bold transition-all shadow-md shadow-rose-950/40"
                >
                  <Plus size={13} />
                  <span>Add First Repository</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
                {filteredTeams.map((team) => {
                  const isSelected = selectedTeam?.id === team.id;
                  const isEvaluating = evaluatingTeamId === team.id;
                  const report = team.latestEvaluationReport;

                  return (
                    <div
                      key={team.id}
                      onClick={() => handleSelectTeam(team)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 border-rose-500/80 shadow-[0_0_15px_rgba(255,10,59,0.15)]'
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            <span>{team.name}</span>
                            <span className="text-[10px] text-slate-500 font-normal">
                              ({team.repositoryName})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                            {team.problemTitle || 'Assigned Faculty Project'}
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="shrink-0 text-right">
                          {team.evaluationStatus === 'COMPLETED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 size={10} />
                              <span>{team.gitProcessScore ?? report?.totalGitProcessScore ?? 0}%</span>
                            </span>
                          ) : team.evaluationStatus === 'REVIEW_REQUIRED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-950/40 text-amber-400 border border-amber-500/30">
                              <AlertTriangle size={10} />
                              <span>Review</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                              <span>Pending</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
                        <span>{team.members?.length || 4} members</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLaunchEvaluation(team);
                          }}
                          disabled={isEvaluating}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition-colors disabled:opacity-50"
                        >
                          {isEvaluating ? (
                            <RotateCw size={11} className="animate-spin" />
                          ) : (
                            <Play size={11} />
                          )}
                          <span>{report ? 'Re-evaluate' : 'Evaluate'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Detailed Evaluation Report (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {!selectedTeam ? (
            <div className="p-12 rounded-2xl bg-[#090C19] border border-slate-800 text-center space-y-3">
              <FolderGit2 className="mx-auto text-slate-600" size={40} />
              <div className="text-sm font-bold text-slate-300">Select a Squad to Inspect Evaluation</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Select any registered repository from the left panel to review milestone checkpoints, Git workflow telemetry, and code quality findings.
              </p>
            </div>
          ) : !activeReport ? (
            <div className="p-10 rounded-2xl bg-[#090C19] border border-slate-800 text-center space-y-4">
              <Terminal className="mx-auto text-rose-500/60" size={36} />
              <div className="text-sm font-bold text-slate-200">
                Ready for Evaluation: {selectedTeam.name}
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                No automated evaluation report has been generated yet for repository{' '}
                <span className="text-slate-200 font-semibold">{selectedTeam.repositoryName}</span>.
              </p>
              <button
                onClick={() => handleLaunchEvaluation(selectedTeam)}
                disabled={evaluatingTeamId === selectedTeam.id}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF0A3B] hover:bg-[#FF1E46] text-white text-xs font-bold transition-all shadow-lg shadow-rose-950/40"
              >
                {evaluatingTeamId === selectedTeam.id ? (
                  <RotateCw size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                <span>Launch Automated Evaluation Agent</span>
              </button>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-[#090C19] border border-slate-800 space-y-6">
              {/* Report Header */}
              <div className="flex items-start justify-between flex-wrap gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white">{selectedTeam.name} Evaluation Report</h2>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      v{activeReport.evaluationVersion}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                        activeReport.status === 'APPROVED'
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-400'
                          : activeReport.status === 'OVERRIDDEN'
                          ? 'bg-purple-950/40 border-purple-500/40 text-purple-300'
                          : activeReport.status === 'FAILED'
                          ? 'bg-rose-950/40 border-rose-500/40 text-rose-400'
                          : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                      }`}
                    >
                      {activeReport.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                    <span>Target: {activeReport.repositoryOwner}/{activeReport.repositoryName}</span>
                    <span>&bull;</span>
                    <span>Evaluated: {new Date(activeReport.evaluatedAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* Score Pill Group */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-700/80 text-right">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">AI/Git Score</div>
                    <div className="text-xl font-bold text-rose-400">
                      {activeReport.totalGitProcessScore}%
                    </div>
                    <div className="text-[10px] text-slate-500">{activeReport.earnedXP} Earned XP</div>
                  </div>
                  {selectedTeam.bonusXP ? (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-right">
                      <div className="text-[10px] text-amber-400 uppercase tracking-wider">Bonus XP</div>
                      <div className="text-xl font-bold text-amber-300">
                        +{selectedTeam.bonusXP}
                      </div>
                      <div className="text-[10px] text-slate-500">Approved</div>
                    </div>
                  ) : null}
                  <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-right">
                    <div className="text-[10px] text-emerald-400 uppercase tracking-wider">Leaderboard Total</div>
                    <div className="text-xl font-bold text-emerald-300">
                      {(activeReport.earnedXP || 0) + (selectedTeam.bonusXP || 0)} XP
                    </div>
                    <div className="text-[10px] text-slate-500">Active Rank Score</div>
                  </div>
                </div>
              </div>

              {/* Action Buttons (Approve / Override / Retry / Bonus XP) */}
              <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <UserCheck size={14} className="text-slate-300" />
                  <span>Evaluator Action:</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      setBonusReason('');
                      setIsBonusModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border border-amber-500/30 transition-colors font-semibold"
                  >
                    <Zap size={12} className="text-amber-400" />
                    <span>Award Bonus XP</span>
                  </button>

                  <button
                    onClick={() => handleLaunchEvaluation(selectedTeam)}
                    disabled={evaluatingTeamId === selectedTeam.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  >
                    <RotateCw size={12} className={evaluatingTeamId === selectedTeam.id ? 'animate-spin' : ''} />
                    <span>Safe Retry</span>
                  </button>

                  <button
                    onClick={handleOpenOverrideModal}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-950/40 hover:bg-purple-900/50 text-purple-300 border border-purple-500/30 transition-colors"
                  >
                    <Edit3 size={12} />
                    <span>Override Score</span>
                  </button>

                  {activeReport.status !== 'APPROVED' && (
                    <button
                      onClick={handleApproveReport}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
                    >
                      <Check size={12} />
                      <span>Approve Report</span>
                    </button>
                  )}

                  <Link
                    to="/admin/leaderboard"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700"
                  >
                    <Trophy size={12} className="text-amber-400" />
                    <span>Leaderboard</span>
                  </Link>
                </div>
              </div>

              {/* Missing Evidence / Warnings Banner */}
              {(activeReport.warnings?.length > 0 || activeReport.missingEvidence?.length > 0) && (
                <div className="p-3.5 rounded-xl bg-amber-950/25 border border-amber-500/40 text-xs space-y-1.5">
                  <div className="font-semibold text-amber-300 flex items-center gap-2">
                    <AlertTriangle size={14} />
                    <span>Manual Review Flags & Missing Evidence:</span>
                  </div>
                  <ul className="list-disc list-inside text-amber-200/90 text-[11px] space-y-0.5">
                    {activeReport.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {activeReport.missingEvidence.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* A. Development Checkpoints Breakdown */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck size={14} className="text-rose-400" />
                  <span>A. Development Checkpoints ({activeReport.categoryScores.checkpoints} / {activeReport.maxCategoryScores.checkpoints} XP)</span>
                </h3>

                <div className="space-y-2">
                  {activeReport.checkpoints.map((cp) => (
                    <div
                      key={cp.checkpointId}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              cp.status === 'VERIFIED'
                                ? 'bg-emerald-400'
                                : cp.status === 'PARTIAL'
                                ? 'bg-amber-400'
                                : 'bg-rose-400'
                            }`}
                          />
                          <span className="text-xs font-semibold text-slate-200">{cp.checkpointName}</span>
                          <span className="text-[10px] text-slate-500">[{cp.status}]</span>
                        </div>
                        <span className="text-xs font-bold text-slate-200">
                          {cp.score} / {cp.maxScore} XP
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{cp.explanation}</p>
                      {cp.evidenceFiles?.length > 0 && (
                        <div className="text-[10px] text-slate-500 truncate">
                          Evidence files: {cp.evidenceFiles.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* B. Git Workflow Telemetry */}
              <div className="space-y-2 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <GitBranch size={14} className="text-rose-400" />
                    <span>B. Git Workflow Analysis</span>
                  </h3>
                  <span className="text-xs font-bold text-rose-400">
                    {activeReport.gitWorkflow.score} / 100
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Total Commits</div>
                    <div className="font-bold text-slate-200">{activeReport.gitWorkflow.totalCommits}</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Meaningful</div>
                    <div className="font-bold text-emerald-400">{activeReport.gitWorkflow.meaningfulCommits}</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Trivial / Dups</div>
                    <div className="font-bold text-amber-400">
                      {activeReport.gitWorkflow.trivialOrCosmeticCount + activeReport.gitWorkflow.duplicateCommitsCount}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Contributors</div>
                    <div className="font-bold text-slate-200">{activeReport.gitWorkflow.contributorCount}</div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 pt-1">
                  Timeline: {activeReport.gitWorkflow.commitTimelineProgression}
                </div>
              </div>

              {/* C. Code Quality & Modularity */}
              <div className="space-y-2 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <FileCode size={14} className="text-rose-400" />
                    <span>C. Code Quality ({activeReport.codeQuality.structureRating})</span>
                  </h3>
                  <span className="text-xs font-bold text-rose-400">
                    {activeReport.codeQuality.score} / 100
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 space-y-1">
                  <div>{activeReport.codeQuality.modularityNotes}</div>
                  <div>Error Handling: {activeReport.codeQuality.errorHandlingNotes}</div>
                </div>
              </div>

              {/* D. Build System & Test Execution */}
              <div className="space-y-2 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Terminal size={14} className="text-rose-400" />
                    <span>D. Build & Testing ({activeReport.buildTesting.detectedLanguage})</span>
                  </h3>
                  <span className="text-xs font-bold text-rose-400">
                    {activeReport.buildTesting.score} / 100
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 space-y-1">
                  <div>Build System: <span className="text-slate-200">{activeReport.buildTesting.detectedBuildSystem}</span></div>
                  <div>Runtime Verification: <span className="text-amber-400 font-semibold">{activeReport.buildTesting.runtimeVerificationStatus}</span> ({activeReport.buildTesting.runtimeNotes})</div>
                </div>
              </div>

              {/* E. Documentation Quality */}
              <div className="space-y-2 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <FileText size={14} className="text-rose-400" />
                    <span>E. Documentation Quality</span>
                  </h3>
                  <span className="text-xs font-bold text-rose-400">
                    {activeReport.documentation.score} / 100
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[10px]">
                  <span className={`px-2 py-0.5 rounded border ${activeReport.documentation.hasReadme ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300' : 'bg-rose-950/30 border-rose-500/30 text-rose-300'}`}>
                    README: {activeReport.documentation.hasReadme ? 'Present' : 'Missing'}
                  </span>
                  <span className={`px-2 py-0.5 rounded border ${activeReport.documentation.setupInstructionsPresent ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                    Setup Instructions: {activeReport.documentation.setupInstructionsPresent ? 'Yes' : 'No'}
                  </span>
                  <span className={`px-2 py-0.5 rounded border ${activeReport.documentation.architectureDocumented ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                    Architecture: {activeReport.documentation.architectureDocumented ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Override Score Modal */}
      {isOverrideModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0A0D1A] border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 size={18} className="text-purple-400" />
                <span>Override Proposed Score</span>
              </h3>
              <button onClick={() => setIsOverrideModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Manually adjust the Git/Process evaluation score for {activeReport?.teamName}. A documented reason is required for audit logs.
            </p>

            <form onSubmit={handleConfirmOverride} className="space-y-4">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  Adjusted Score (0 &mdash; 100%):
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={overrideScore}
                  onChange={(e) => setOverrideScore(Number(e.target.value))}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  Mandatory Justification Reason:
                </label>
                <textarea
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Explain why this score is adjusted (e.g. verified offline test run with team live demo)..."
                  required
                  minLength={5}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOverrideModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isOverriding || overrideReason.trim().length < 5}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs text-white font-bold disabled:opacity-50"
                >
                  {isOverriding ? 'Recording Override...' : 'Confirm Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bonus XP Modal */}
      {isBonusModalOpen && selectedTeam && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#090C19] border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap size={16} className="text-amber-400" />
                <span>Award Manual Bonus XP &mdash; {selectedTeam.name}</span>
              </h3>
              <button onClick={() => setIsBonusModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Award administrator bonus XP for faculty presentations, exceptional design, or offline problem solving.
            </p>

            <form onSubmit={handleAwardBonusXP} className="space-y-4">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  Bonus Amount (+XP):
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(Number(e.target.value))}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  Mandatory Reason:
                </label>
                <textarea
                  rows={3}
                  value={bonusReason}
                  onChange={(e) => setBonusReason(e.target.value)}
                  placeholder="e.g. Offline faculty presentation defense, creative architecture design..."
                  required
                  minLength={5}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBonusModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-mono"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAwardingBonus || bonusReason.trim().length < 5}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs text-white font-bold disabled:opacity-50 font-mono"
                >
                  {isAwardingBonus ? 'Awarding...' : 'Award Bonus XP'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Repository Modal */}
      <RepositoryModal
        isOpen={showAddRepoModal}
        onClose={() => setShowAddRepoModal(false)}
        onSuccess={handleRepositoryAdded}
      />
    </div>
  );
}
