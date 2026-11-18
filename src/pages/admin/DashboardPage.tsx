// ─────────────────────────────────────────────
// Admin Command Center — Build from Scratch Leaderboard Hub
// Focuses on:
// 1. Adding & Managing Student GitHub Repositories
// 2. Automated AI Code Scoring, Breakdown & Manual Bonus XP
// 3. Live Leaderboard Ranks
// ─────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import {
  Folder,
  FolderGit2,
  Trophy,
  Zap,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  ExternalLink,
  Search,
  Sparkles,
  ShieldAlert,
  RotateCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import StatCard from '../../components/dashboard/StatCard';
import type { Team, Repository } from '../../types';
import { teamService } from '../../services/teamService';
import { repositoryService } from '../../services/repositoryService';
import { bonusService } from '../../services/bonusService';
import RepositoryModal from '../../components/repositories/RepositoryModal';
import LoadingState from '../../components/ui/LoadingState';

export default function DashboardPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddRepoModal, setShowAddRepoModal] = useState(false);
  const [bonusModalTeam, setBonusModalTeam] = useState<Team | null>(null);
  const [bonusAmount, setBonusAmount] = useState<number>(10);
  const [bonusReason, setBonusReason] = useState<string>('');
  const [isAwardingBonus, setIsAwardingBonus] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    let loadedCount = 0;
    const checkLoaded = () => {
      loadedCount++;
      if (loadedCount >= 2) setLoading(false);
    };

    const unsubTeams = teamService.subscribeToTeamsLeaderboard((data) => {
      setTeams(data);
      checkLoaded();
    });

    const unsubRepos = repositoryService.subscribeToRepositories((data) => {
      setRepositories(data);
      checkLoaded();
    });

    return () => {
      unsubTeams();
      unsubRepos();
    };
  }, []);

  // Synchronize repositories that may not have teams yet
  useEffect(() => {
    if (repositories.length > 0 && teams.length === 0 && !loading) {
      // Auto-register team if repository exists in Firestore
      repositories.forEach(async (repo) => {
        try {
          await teamService.registerTeam({
            name: repo.name,
            repositoryName: repo.name,
            repositoryId: repo.id,
            githubUrl: repo.githubUrl,
            problemTitle: (repo as any).problemTitle || repo.name,
            members: [
              {
                studentId: `stu_${(repo.owner || 'student').toLowerCase()}`,
                name: repo.owner || 'Student',
                githubUsername: repo.owner || 'student',
                assignedIssues: [],
                prSubmitted: true,
              },
            ],
          });
        } catch {
          // ignore already existing
        }
      });
    }
  }, [repositories, teams, loading]);

  // Derived Telemetry Metrics
  const totalRepositories = Math.max(repositories.length, teams.length);
  const evaluatedCount = useMemo(
    () => teams.filter((t) => t.evaluationStatus === 'COMPLETED' || t.latestEvaluationReport).length,
    [teams]
  );
  const totalAwardedXP = useMemo(
    () =>
      teams.reduce((acc, t) => {
        const base = t.earnedXP ?? (t.latestEvaluationReport?.earnedXP ?? t.totalScore ?? 0);
        const bonus = t.bonusXP ?? 0;
        return acc + base + bonus;
      }, 0),
    [teams]
  );
  const highestScore = useMemo(() => {
    if (teams.length === 0) return 0;
    return Math.max(
      ...teams.map(
        (t) => t.gitProcessScore ?? t.latestEvaluationReport?.totalGitProcessScore ?? 0
      )
    );
  }, [teams]);

  // Search filter
  const filteredTeams = useMemo(() => {
    if (!searchQuery.trim()) return teams;
    const q = searchQuery.toLowerCase().trim();
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.repositoryName.toLowerCase().includes(q) ||
        (t.problemTitle && t.problemTitle.toLowerCase().includes(q))
    );
  }, [teams, searchQuery]);

  const handleAwardBonusXP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bonusModalTeam) return;

    if (!bonusReason.trim() || bonusReason.trim().length < 5) {
      setActionError('A reason of at least 5 characters is required for manual bonus XP.');
      return;
    }

    try {
      setIsAwardingBonus(true);
      setActionError(null);
      await bonusService.awardBonus({
        teamId: bonusModalTeam.id,
        amount: Number(bonusAmount),
        reason: bonusReason.trim(),
        adminUsername: 'lead_organizer',
      });

      setActionSuccess(`Awarded +${bonusAmount} Bonus XP to ${bonusModalTeam.name}!`);
      setBonusModalTeam(null);
      setBonusReason('');
    } catch (err: any) {
      setActionError(err?.message || 'Failed to award bonus XP.');
    } finally {
      setIsAwardingBonus(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState message="BOOTING COMMAND CENTER..." />
      </div>
    );
  }

  return (
    <div className="space-y-8 font-mono">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <Sparkles className="text-rose-500" size={24} />
              <span>Admin Command Center</span>
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
              BUILD FROM SCRATCH
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Register GitHub repos &bull; Trigger AI code evaluations &bull; Award bonus XP &bull; Live Leaderboard
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Link
            to="/admin/leaderboard"
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
          >
            <Trophy size={14} className="text-amber-400" />
            <span>Leaderboard</span>
          </Link>
          <Link
            to="/admin/evaluations"
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
          >
            <FolderGit2 size={14} className="text-rose-400" />
            <span>Evaluation Center</span>
          </Link>
          <button
            onClick={() => setShowAddRepoModal(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-rose-950/40"
          >
            <Plus size={15} />
            <span>Add Repository</span>
          </button>
        </div>
      </div>

      {/* Action Notifications */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-emerald-200">
            &times;
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-rose-400" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200">
            &times;
          </button>
        </div>
      )}

      {/* 4 Core Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Repositories"
          value={totalRepositories}
          icon={<Folder size={18} />}
          accent="purple"
          subtitle="registered repos"
        />
        <StatCard
          title="Evaluated by AI"
          value={`${evaluatedCount} / ${totalRepositories}`}
          icon={<FolderGit2 size={18} />}
          accent="cyan"
          subtitle="scored & audited"
        />
        <StatCard
          title="Top AI Score"
          value={highestScore > 0 ? `${highestScore}%` : 'Pending'}
          icon={<Trophy size={18} />}
          accent="amber"
          subtitle="highest quality"
        />
        <StatCard
          title="Total Leaderboard XP"
          value={totalAwardedXP.toLocaleString()}
          icon={<Zap size={18} />}
          accent="green"
          subtitle="earned + bonus"
        />
      </div>

      {/* Quick 3-Step Flow Guide */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-rose-400" />
          <span>How It Works &bull; 3 Simple Steps</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 font-bold flex items-center justify-center shrink-0 text-xs">
              1
            </span>
            <div>
              <div className="font-bold text-white">Add GitHub Repo Link</div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Click "+ Add Repository" and paste the student GitHub repository link.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-bold flex items-center justify-center shrink-0 text-xs">
              2
            </span>
            <div>
              <div className="font-bold text-white">AI Evaluates Code</div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Click "Evaluate Score" to analyze progressive commits, architecture, tests & build.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-xs">
              3
            </span>
            <div>
              <div className="font-bold text-white">Award Bonus XP & Rank</div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Review breakdown, add manual XP bonus, and see real-time ranks on Leaderboard.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Active Repositories Table Section */}
      <div className="card overflow-hidden border border-slate-800/80">
        <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/30">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Folder className="text-rose-400" size={16} />
              <span>Registered Repositories & Scores</span>
              <span className="text-xs text-slate-500 font-normal">
                ({filteredTeams.length} {filteredTeams.length === 1 ? 'project' : 'projects'})
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Click on any repository to run AI evaluation, view score breakdown, or award bonus XP
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search repo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500"
              />
            </div>
            <button
              onClick={() => setShowAddRepoModal(true)}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Plus size={13} />
              <span>Add Repo</span>
            </button>
          </div>
        </div>

        {filteredTeams.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <FolderGit2 className="mx-auto text-slate-600" size={42} />
            <div className="text-sm font-bold text-slate-300">No Repositories Registered Yet</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Add your first student GitHub repository link to immediately begin AI code scoring and populate the leaderboard.
            </p>
            <button
              onClick={() => setShowAddRepoModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF0A3B] hover:bg-[#FF1E46] text-white text-xs font-bold transition-all shadow-md shadow-rose-950/40"
            >
              <Plus size={14} />
              <span>Add First Repository Link</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-3.5 px-5">Rank</th>
                  <th className="py-3.5 px-5">Repository / Project</th>
                  <th className="py-3.5 px-5 text-center">AI Code Score</th>
                  <th className="py-3.5 px-5 text-center">Bonus XP</th>
                  <th className="py-3.5 px-5 text-right">Total XP</th>
                  <th className="py-3.5 px-5">Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {filteredTeams.map((t, idx) => {
                  const report = t.latestEvaluationReport;
                  const totalXP =
                    (t.earnedXP ?? (report?.earnedXP ?? t.totalScore ?? 0)) + (t.bonusXP ?? 0);
                  const isEvaluated =
                    t.evaluationStatus === 'COMPLETED' || report?.status === 'APPROVED';

                  return (
                    <tr key={t.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="py-4 px-5 font-bold text-slate-300">
                        {t.rankText || `#${t.rank || idx + 1}`}
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm hover:text-rose-400 transition-colors">
                            {t.name}
                          </span>
                        </div>
                        {t.githubUrl ? (
                          <a
                            href={t.githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-slate-500 hover:text-emerald-400 inline-flex items-center gap-1 transition-colors mt-0.5"
                          >
                            <span>{t.githubUrl}</span>
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <div className="text-[11px] text-slate-500">{t.repositoryName}</div>
                        )}
                      </td>
                      <td className="py-4 px-5 text-center">
                        {isEvaluated || t.gitProcessScore ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 font-bold">
                            <CheckCircle2 size={12} />
                            <span>{t.gitProcessScore ?? report?.totalGitProcessScore ?? 0}%</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-900 text-slate-500 border border-slate-800">
                            <Clock size={11} />
                            <span>Not Evaluated</span>
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-center">
                        {t.bonusXP ? (
                          <span className="font-bold text-amber-400">+{t.bonusXP} XP</span>
                        ) : (
                          <span className="text-slate-600">0</span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-right font-black text-emerald-400 text-sm">
                        {totalXP.toLocaleString()} XP
                      </td>
                      <td className="py-4 px-5">
                        {isEvaluated ? (
                          <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                            <CheckCircle2 size={13} /> Evaluated
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs flex items-center gap-1">
                            <Clock size={13} /> Pending
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to="/admin/evaluations"
                            className="px-2.5 py-1 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold transition-colors inline-flex items-center gap-1"
                            title="Evaluate repository or view detailed AI score breakdown"
                          >
                            <Play size={11} />
                            <span>{isEvaluated ? 'View Breakdown' : 'Evaluate'}</span>
                          </Link>

                          <button
                            onClick={() => {
                              setBonusModalTeam(t);
                              setBonusReason('');
                            }}
                            className="px-2.5 py-1 rounded bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-semibold transition-colors inline-flex items-center gap-1"
                            title="Add manual bonus XP to this team"
                          >
                            <Zap size={11} />
                            <span>+ Bonus</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bonus XP Modal */}
      {bonusModalTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-amber-400" />
                <h3 className="font-bold text-white text-sm">Award Bonus XP</h3>
              </div>
              <button
                onClick={() => setBonusModalTeam(null)}
                className="text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAwardBonusXP} className="space-y-4 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Target Repository / Team</label>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-semibold">
                  {bonusModalTeam.name} ({bonusModalTeam.repositoryName})
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Bonus XP Amount</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(Number(e.target.value))}
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-amber-300 font-bold focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">
                  Reason for Bonus XP <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={bonusReason}
                  onChange={(e) => setBonusReason(e.target.value)}
                  placeholder="e.g. Clean test automation script, exceptional modularity, offline demo verified..."
                  rows={3}
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setBonusModalTeam(null)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAwardingBonus}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isAwardingBonus && <RotateCw size={12} className="animate-spin" />}
                  <span>Confirm +{bonusAmount} XP</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Repository Modal */}
      {showAddRepoModal && (
        <RepositoryModal
          isOpen={showAddRepoModal}
          onClose={() => setShowAddRepoModal(false)}
          onSuccess={() => {
            setShowAddRepoModal(false);
            setActionSuccess('Repository registered! You can now evaluate it below or in Evaluation Center.');
          }}
        />
      )}
    </div>
  );
}
