// ─────────────────────────────────────────────
// OrganizerResultsPage.tsx — Phase 8: Scoring, Results, Publication & Analytics Console
// Proofly / Evalora — Configurable Policies, Append-Only Ledger, Rankings,
// AI vs Human Comparison Report, Public Leaderboard & Governance Audit
// ─────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ShieldCheck,
  Download,
  Share2,
  Eye,
  Lock,
  Unlock,
  BarChart3,
  SlidersHorizontal,
  ScrollText,
  History,
  AlertTriangle,
  Trophy,
  Users,
  User,
  Layers,
  GitBranch,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  CheckCircle2,
  Scale,
  Sparkles,
  FileCheck2,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardContent } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { competitionService } from '../../services/competitionService';
import { judgeAssignmentService } from '../../services/judgeAssignmentService';
import { resultsAndAnalyticsService } from '../../services/resultsAndAnalyticsService';
import { scoringLedgerService } from '../../services/scoringLedgerService';
import { governanceAuditService } from '../../services/governanceAuditService';
import type { Competition } from '../../types/authAndCompetition';
import type { JudgeRecord } from '../../types/judgeAndEvaluation';
import type {
  AggregationPolicyType,
  CompetitionAnalyticsReport,
  CompetitionScoringPolicy,
  GovernanceAuditCategory,
  GovernanceAuditEvent,
  RankedEntry,
  RankingScope,
  ResultPublicationRecord,
  ScoreLedgerEntry,
  TieBreakerRule,
} from '../../types/scoringAndResults';

type ActiveTab = 'rankings' | 'policy' | 'analytics' | 'ledger' | 'audit';

const POLICY_OPTIONS: Array<{
  type: AggregationPolicyType;
  title: string;
  description: string;
  badge: string;
}> = [
  {
    type: 'AVERAGE_JUDGE',
    title: 'Average Judge Score (Default)',
    description:
      'Arithmetic mean of finalized human judge scores. AI acts strictly as an assessment assistant and is never counted in official results.',
    badge: 'Recommended Default',
  },
  {
    type: 'WEIGHTED_JUDGE',
    title: 'Weighted Judge Score',
    description:
      'Applies organizer-configured weight multipliers per judge (e.g., Lead Domain Judge 1.5x, Panel Judge 1.0x). Human-only.',
    badge: 'Panel Weighting',
  },
  {
    type: 'MEDIAN',
    title: 'Median Judge Score',
    description:
      'Calculates the median of finalized human judge scores, robust against outlier judgments.',
    badge: 'Robust to Outliers',
  },
  {
    type: 'TRIMMED_MEAN',
    title: 'Trimmed Mean (Olympic Scoring)',
    description:
      'Excludes the lowest and highest judge scores and averages the remaining evaluations (for 3+ judges).',
    badge: 'Olympic Exclusion',
  },
  {
    type: 'CRITERION_WEIGHTED',
    title: 'Criterion-Weighted Score',
    description:
      'Aggregates per-criterion human averages weighted strictly by each rubric criterion weight percentage.',
    badge: 'Rubric Weighted',
  },
  {
    type: 'ROUND_WISE',
    title: 'Round-Wise Aggregation',
    description:
      'Groups human judge scores by competition round (e.g., Round 1 Screening 40% + Round 2 Finals 60%).',
    badge: 'Multi-Round',
  },
  {
    type: 'AI_ASSISTED',
    title: 'AI-Assisted Score Policy (Explicit Opt-In)',
    description:
      'Blends finalized human judge scores with a configured AI weight (max 50%). Must be explicitly opted in by an organizer.',
    badge: 'Opt-In Only',
  },
];

export const OrganizerResultsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { currentUser } = useProoflyAuth();
  const { success, error: toastError } = useToast();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string>(
    searchParams.get('comp') || 'comp-default-ai'
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('rankings');

  // Ranking & Publication state
  const [scope, setScope] = useState<RankingScope>('OVERALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedRound, setSelectedRound] = useState<string>('round-1');
  const [entries, setEntries] = useState<RankedEntry[]>([]);
  const [publication, setPublication] = useState<ResultPublicationRecord | null>(null);
  const [analytics, setAnalytics] = useState<CompetitionAnalyticsReport | null>(null);
  const [judges, setJudges] = useState<JudgeRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<readonly ScoreLedgerEntry[]>([]);
  const [auditEvents, setAuditEvents] = useState<GovernanceAuditEvent[]>([]);

  // Ledger & Audit filters
  const [ledgerSourceFilter, setLedgerSourceFilter] = useState<'ALL' | 'HUMAN' | 'AI'>('ALL');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<'ALL' | GovernanceAuditCategory>('ALL');

  // Policy draft editor state
  const [policyType, setPolicyType] = useState<AggregationPolicyType>('AVERAGE_JUDGE');
  const [includeAi, setIncludeAi] = useState<boolean>(false);
  const [aiWeight, setAiWeight] = useState<number>(0.2);
  const [judgeWeights, setJudgeWeights] = useState<Record<string, number>>({});
  const [roundWeights, setRoundWeights] = useState<Record<string, number>>({
    'round-1': 40,
    'round-2': 60,
  });
  const [tieBreakers, setTieBreakers] = useState<TieBreakerRule[]>([]);
  const [policyReason, setPolicyReason] = useState<string>('');

  // Modals
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishApprovalConfirmed, setPublishApprovalConfirmed] = useState(false);
  const [publishReason, setPublishReason] = useState(
    'All assigned judge evaluations verified and scoring policy audited.'
  );
  const [unpublishModalOpen, setUnpublishModalOpen] = useState(false);
  const [unpublishReason, setUnpublishReason] = useState('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // Entry breakdown & authorized adjustment modal
  const [inspectedEntry, setInspectedEntry] = useState<RankedEntry | null>(null);
  const [adjCriterionId, setAdjCriterionId] = useState<string>('');
  const [adjScore, setAdjScore] = useState<string>('');
  const [adjReason, setAdjReason] = useState<string>('');

  const organizerId = currentUser?.uid || '';
  const organizerName = currentUser?.displayName || 'Organizer';

  const refreshData = useCallback(async () => {
    const allComps = await competitionService.listAllCompetitions();
    setCompetitions(allComps);

    if (allComps.length === 0) {
      setEntries([]);
      setPublication(null);
      setAnalytics(null);
      setJudges([]);
      setLedgerEntries([]);
      setAuditEvents([]);
      return;
    }

    const activeId = allComps.some((c: Competition) => c.id === selectedCompId)
      ? selectedCompId
      : allComps[0].id;
    if (activeId !== selectedCompId) {
      setSelectedCompId(activeId);
    }

    const [previewRes, analyticsRes, judgeList] = await Promise.all([
      resultsAndAnalyticsService.previewResults(activeId, {
        scope,
        category: selectedCategory,
        roundId: scope === 'ROUND' ? selectedRound : undefined,
      }),
      resultsAndAnalyticsService.computeCompetitionAnalytics(activeId),
      judgeAssignmentService.listJudges(activeId),
    ]);

    setEntries(previewRes.entries);
    setPublication(previewRes.publication);
    setAnalytics(analyticsRes);
    setJudges(judgeList);

    const policy: CompetitionScoringPolicy = previewRes.policy;
    setPolicyType(policy.policyType);
    setIncludeAi(policy.includeAiAsJudgeScore);
    setAiWeight(policy.aiWeight || 0.2);
    setJudgeWeights(policy.judgeWeights || {});
    setRoundWeights(
      Object.keys(policy.roundWeights || {}).length > 0
        ? policy.roundWeights
        : { 'round-1': 40, 'round-2': 60 }
    );
    setTieBreakers(policy.tieBreakers);

    setLedgerEntries(
      scoringLedgerService.listEntries({
        competitionId: activeId,
        source: ledgerSourceFilter === 'ALL' ? undefined : ledgerSourceFilter,
        order: 'DESC',
      })
    );
    setAuditEvents(
      governanceAuditService.listEvents({
        competitionId: activeId,
        category: auditCategoryFilter === 'ALL' ? undefined : auditCategoryFilter,
      })
    );
  }, [selectedCompId, scope, selectedCategory, selectedRound, ledgerSourceFilter, auditCategoryFilter]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const activeCompetition = useMemo(
    () => competitions.find((c) => c.id === selectedCompId),
    [competitions, selectedCompId]
  );

  const availableCategories = useMemo(() => {
    const set = new Set<string>(activeCompetition?.tracks || []);
    entries.forEach((e) => set.add(e.category));
    return Array.from(set).sort();
  }, [activeCompetition, entries]);

  const handleSavePolicy = async () => {
    try {
      const reason =
        policyReason.trim() ||
        `Updated scoring aggregation policy to ${policyType}${includeAi ? ` (AI Weight ${Math.round(aiWeight * 100)}%)` : ''}`;
      resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: selectedCompId,
        policyType,
        includeAiAsJudgeScore: policyType === 'AI_ASSISTED' ? includeAi : false,
        aiWeight: policyType === 'AI_ASSISTED' && includeAi ? aiWeight : 0,
        judgeWeights,
        roundWeights,
        tieBreakers,
        organizerUserId: organizerId,
        organizerName,
        actorRole: 'ORGANIZER',
        reason,
      });
      setPolicyReason('');
      await refreshData();
      success(
        'Scoring Policy Updated',
        'Rankings recomputed deterministically and policy change logged in the Governance Audit Trail.'
      );
    } catch (err: any) {
      toastError('Policy Update Failed', err?.message || 'Unable to update scoring policy.');
    }
  };

  const handlePublish = async () => {
    if (!publishApprovalConfirmed) {
      toastError('Explicit Approval Required', 'Please check the organizer approval confirmation box.');
      return;
    }
    try {
      const rec = await resultsAndAnalyticsService.publishOfficialResults({
        competitionId: selectedCompId,
        organizerUserId: organizerId,
        organizerName,
        actorRole: 'ORGANIZER',
        approvalReason: publishReason,
      });
      setPublishModalOpen(false);
      setPublishApprovalConfirmed(false);
      await refreshData();
      success(
        `Official Results Published (v${rec.version})`,
        'Public leaderboard is now live and locked to this verified official snapshot.'
      );
    } catch (err: any) {
      toastError('Publication Blocked', err?.message || 'Could not publish official results.');
    }
  };

  const handleUnpublish = async () => {
    try {
      await resultsAndAnalyticsService.unpublishOfficialResults({
        competitionId: selectedCompId,
        organizerUserId: organizerId,
        organizerName,
        actorRole: 'ORGANIZER',
        reason: unpublishReason,
      });
      setUnpublishModalOpen(false);
      setUnpublishReason('');
      await refreshData();
      success(
        'Official Results Unpublished',
        'Public leaderboard has been taken offline for authorized review and logged in the audit trail.'
      );
    } catch (err: any) {
      toastError('Unpublish Failed', err?.message || 'Could not unpublish results.');
    }
  };

  const handleExportCsv = () => {
    const csv = resultsAndAnalyticsService.exportResultsToCsv(
      entries,
      activeCompetition?.title || selectedCompId,
      publication?.status === 'PUBLISHED' ? `OFFICIAL_v${publication.version}` : 'PROVISIONAL'
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeCompetition?.slug || selectedCompId}-results.csv`;
    link.click();
    URL.revokeObjectURL(url);
    success('CSV Exported', `Downloaded ${entries.length} ranked entries with full AI & human breakdown.`);
  };

  const handleMoveTieBreaker = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= tieBreakers.length) return;
    const copy = [...tieBreakers];
    const tmp = copy[idx];
    copy[idx] = copy[target];
    copy[target] = tmp;
    setTieBreakers(copy);
  };

  const handleToggleTieBreaker = (idx: number) => {
    const copy = [...tieBreakers];
    copy[idx] = { ...copy[idx], enabled: !copy[idx].enabled };
    setTieBreakers(copy);
  };

  const handleAppendAuthorizedAdjustment = async () => {
    if (!inspectedEntry) return;
    const crit = inspectedEntry.criterionSummaries[adjCriterionId];
    if (!crit) {
      toastError('Select Criterion', 'Choose a rubric criterion to append an authorized adjustment.');
      return;
    }
    const parsedScore = Number(adjScore);
    if (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > crit.maxScore) {
      toastError('Invalid Score', `Score must be between 0 and ${crit.maxScore}.`);
      return;
    }

    try {
      await resultsAndAnalyticsService.applyAuthorizedScoreAdjustment({
        competitionId: selectedCompId,
        entryId: inspectedEntry.submissionId,
        referenceId: inspectedEntry.referenceId,
        evaluationId: inspectedEntry.judgeBreakdown[0]?.evaluationId || `adj-${inspectedEntry.submissionId}`,
        criterionId: crit.criterionId,
        criterionName: crit.criterionName,
        newScore: parsedScore,
        maxScore: crit.maxScore,
        organizerUserId: organizerId,
        organizerName,
        actorRole: 'ORGANIZER',
        reason: adjReason,
      });
      setAdjScore('');
      setAdjReason('');
      await refreshData();
      success(
        'Ledger Adjustment Appended',
        'Immutable adjustment record appended to Scoring Ledger and logged in Governance Audit Trail.'
      );
    } catch (err: any) {
      toastError('Adjustment Rejected', err?.message || 'Failed to record ledger adjustment.');
    }
  };

  const isPublished = publication?.status === 'PUBLISHED';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Results"
        badge={
          <Badge variant={isPublished ? 'success' : 'neutral'} size="sm">
            {isPublished ? `Official v${publication?.version}` : 'Provisional'}
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <select
              aria-label="Select Competition"
              value={selectedCompId}
              onChange={(e) => setSelectedCompId(e.target.value)}
              className="text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>

            <Button
              variant="outline"
              size="xs"
              leftIcon={<Eye size={13} />}
              onClick={() => setPreviewModalOpen(true)}
            >
              Preview
            </Button>

            <Button
              variant="outline"
              size="xs"
              leftIcon={<Download size={13} />}
              onClick={handleExportCsv}
            >
              Export CSV
            </Button>

            {isPublished ? (
              <>
                <Link to={`/leaderboard/${selectedCompId}`}>
                  <Button variant="secondary" size="xs" leftIcon={<ExternalLink size={13} />}>
                    Leaderboard
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="xs"
                  leftIcon={<Unlock size={13} />}
                  onClick={() => setUnpublishModalOpen(true)}
                >
                  Unpublish
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="xs"
                leftIcon={<Share2 size={13} />}
                onClick={() => setPublishModalOpen(true)}
                disabled={entries.length === 0}
              >
                Publish results
              </Button>
            )}
          </div>
        }
      />

      {/* Concise Status Strip */}
      <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-2 flex-wrap">
          {isPublished ? (
            <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <ShieldCheck size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
          )}
          <span>
            {isPublished
              ? `Published v${publication?.version} by ${publication?.publishedByName}`
              : 'Provisional standings — requires organizer approval to publish'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
          <span>Policy: {policyType.replace(/_/g, ' ')}</span>
          <span>·</span>
          <span>{includeAi ? `AI ${Math.round(aiWeight * 100)}%` : 'Human-only'}</span>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {(
          [
            { id: 'rankings', label: `Rankings (${entries.length})`, icon: Trophy },
            { id: 'policy', label: 'Scoring policy', icon: SlidersHorizontal },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'ledger', label: `Ledger (${ledgerEntries.length})`, icon: ScrollText },
            { id: 'audit', label: `Audit (${auditEvents.length})`, icon: History },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors duration-150 cursor-pointer -mb-px ${
                active
                  ? 'border-blue-600 dark:border-blue-400 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon size={13} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* TAB 1: RANKINGS & PUBLICATION                   */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'rankings' && (
        <div className="space-y-4">
          {/* Scope Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { key: 'OVERALL', label: 'Overall', icon: Trophy },
                  { key: 'TEAM', label: 'Teams', icon: Users },
                  { key: 'INDIVIDUAL', label: 'Individuals', icon: User },
                  { key: 'CATEGORY', label: 'Category / Track', icon: Layers },
                  { key: 'ROUND', label: 'By Round', icon: GitBranch },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = scope === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setScope(item.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-600 dark:bg-blue-500 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Icon size={13} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              {scope === 'CATEGORY' && (
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-lg px-3 py-1.5"
                >
                  <option value="ALL">All Categories</option>
                  {availableCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}

              {scope === 'ROUND' && (
                <select
                  value={selectedRound}
                  onChange={(e) => setSelectedRound(e.target.value)}
                  className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-lg px-3 py-1.5"
                >
                  <option value="round-1">Round 1 (Screening)</option>
                  <option value="round-2">Round 2 (Finals)</option>
                </select>
              )}
            </div>
          </div>

          {entries.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">No Ranked Entries Yet</p>
                <p>
                  Entries appear here once at least one human judge submits a finalized evaluation
                  (or if AI-Assisted scoring is explicitly opted in).
                </p>
              </CardContent>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Project & Reference</TableHead>
                  <TableHead>Participant / Team</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>AI Pre-Score</TableHead>
                  <TableHead>Human Avg</TableHead>
                  <TableHead>Official Score</TableHead>
                  <TableHead>Tie Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.submissionId}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                          #{entry.rank}
                        </span>
                        {entry.isTied && (
                          <Badge variant="warning" size="sm">
                            TIE
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{entry.projectTitle}</p>
                        <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500">{entry.referenceId}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                          {entry.teamOrParticipantName}
                        </p>
                        <Badge variant="neutral" size="sm">
                          {entry.submissionType}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-600 dark:text-slate-400">{entry.category}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {entry.aiScore !== null ? `${entry.aiScore.toFixed(1)}` : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {entry.humanAverageScore !== null
                            ? `${entry.humanAverageScore.toFixed(2)}`
                            : '—'}
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                          {entry.judgeCount} {entry.judgeCount === 1 ? 'judge' : 'judges'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono font-bold text-blue-700 dark:text-blue-400">
                        {entry.officialScore.toFixed(2)} / {entry.maxPossibleScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      {entry.tieBrokenBy ? (
                        <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                          {entry.tieBrokenBy}
                        </span>
                      ) : entry.isTied ? (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                          Unresolved Tie
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">Deterministic</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          setInspectedEntry(entry);
                          const firstCritId = Object.keys(entry.criterionSummaries)[0] || '';
                          setAdjCriterionId(firstCritId);
                        }}
                      >
                        Inspect Breakdown
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* TAB 2: SCORING POLICY & TIE-BREAKERS            */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'policy' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardContent className="p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Aggregation Policy Configuration
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Choose how official rankings are calculated. AI scores are strictly excluded
                    unless explicitly opted in under AI-Assisted Policy.
                  </p>
                </div>

                <div className="space-y-2.5">
                  {POLICY_OPTIONS.map((opt) => {
                    const selected = policyType === opt.type;
                    return (
                      <div
                        key={opt.type}
                        onClick={() => {
                          setPolicyType(opt.type);
                          if (opt.type !== 'AI_ASSISTED') {
                            setIncludeAi(false);
                          }
                        }}
                        className={`p-4 rounded-xl border transition-all cursor-pointer ${
                          selected
                            ? 'border-blue-600 dark:border-blue-400 bg-blue-50/40 dark:bg-blue-500/15 ring-1 ring-blue-600 dark:ring-blue-400'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <input
                              type="radio"
                              checked={selected}
                              onChange={() => setPolicyType(opt.type)}
                              className="accent-blue-600"
                            />
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {opt.title}
                            </span>
                          </div>
                          <Badge variant={selected ? 'primary' : 'neutral'} size="sm">
                            {opt.badge}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 pl-6">{opt.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Policy-specific controls */}
                {policyType === 'AI_ASSISTED' && (
                  <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-500/35 bg-amber-50/70 dark:bg-amber-500/10 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-950 dark:text-amber-200 space-y-1">
                        <p className="font-bold">Explicit AI Weight Opt-In Required</p>
                        <p>
                          By default, AI scores act solely as assessment assistants. Check below to
                          explicitly include AI scores in official aggregation.
                        </p>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeAi}
                        onChange={(e) => setIncludeAi(e.target.checked)}
                        className="accent-blue-600 rounded"
                      />
                      <span>
                        Explicitly authorize AI score contribution to official competition results
                      </span>
                    </label>

                    {includeAi && (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between text-xs font-medium text-slate-800 dark:text-slate-200">
                          <span>AI Weight: {Math.round(aiWeight * 100)}%</span>
                          <span>Human Judge Weight: {Math.round((1 - aiWeight) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.05}
                          max={0.5}
                          step={0.05}
                          value={aiWeight}
                          onChange={(e) => setAiWeight(Number(e.target.value))}
                          className="w-full accent-blue-600"
                        />
                      </div>
                    )}
                  </div>
                )}

                {policyType === 'WEIGHTED_JUDGE' && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">Judge Weight Multipliers</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {judges.map((j) => (
                        <div
                          key={j.id}
                          className="flex items-center justify-between bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{j.name}</p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{j.organization}</p>
                          </div>
                          <input
                            type="number"
                            min={0.5}
                            max={5}
                            step={0.25}
                            value={judgeWeights[j.id] ?? 1}
                            onChange={(e) =>
                              setJudgeWeights({
                                ...judgeWeights,
                                [j.id]: Number(e.target.value) || 1,
                              })
                            }
                            className="w-16 text-xs font-mono text-right bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded px-2 py-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {policyType === 'ROUND_WISE' && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">Round Weight Distribution (%)</p>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(roundWeights).map(([rId, w]) => (
                        <div
                          key={rId}
                          className="flex items-center justify-between bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700"
                        >
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">
                            {rId}
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={w}
                            onChange={(e) =>
                              setRoundWeights({
                                ...roundWeights,
                                [rId]: Number(e.target.value) || 0,
                              })
                            }
                            className="w-20 text-xs font-mono text-right bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded px-2 py-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Audit Reason & Save */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Audit Justification for Policy Change
                    </label>
                    <input
                      type="text"
                      value={policyReason}
                      onChange={(e) => setPolicyReason(e.target.value)}
                      placeholder="e.g., Configured Weighted Judge scoring for Finals panel review"
                      className="w-full text-xs bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <Button variant="primary" size="sm" onClick={handleSavePolicy}>
                    Save Scoring Policy & Recompute Rankings
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tie-Breakers Panel */}
          <div className="space-y-4">
            <Card>
              <CardContent className="p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Scale size={16} className="text-blue-600 dark:text-blue-400" />
                    <span>Deterministic Tie-Breakers</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Applied sequentially when two entries share an identical official score. If all
                    enabled rules tie, entries receive a shared official rank (e.g., #2, #2, #4).
                  </p>
                </div>

                <div className="space-y-2">
                  {tieBreakers.map((tb, idx) => (
                    <div
                      key={tb.type}
                      className={`p-3 rounded-lg border flex items-center justify-between gap-2 transition-colors ${
                        tb.enabled
                          ? 'border-blue-200 dark:border-blue-500/30 bg-blue-50/40 dark:bg-blue-500/10'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40'
                      }`}
                    >
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={tb.enabled}
                          onChange={() => handleToggleTieBreaker(idx)}
                          className="accent-blue-600"
                        />
                        <span>
                          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 mr-1.5">
                            #{idx + 1}
                          </span>
                          {tb.label}
                        </span>
                      </label>
                      <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                        <button
                          type="button"
                          onClick={() => handleMoveTieBreaker(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                          title="Move Up"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveTieBreaker(idx, 1)}
                          disabled={idx === tieBreakers.length - 1}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                          title="Move Down"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* TAB 3: ANALYTICS & AI vs. HUMAN REPORT          */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'analytics' && analytics && (
        <div className="space-y-6">
          {/* Top KPI Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total / Valid Submissions</p>
                <p className="text-2xl font-mono font-bold text-slate-900 dark:text-slate-100 mt-1">
                  {analytics.totalSubmissions}{' '}
                  <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                    ({analytics.validSubmissions} valid)
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">AI Pre-Evaluations</p>
                <p className="text-2xl font-mono font-bold text-purple-700 dark:text-purple-400 mt-1">
                  {analytics.aiEvaluationsCompleted}
                  <span className="text-xs font-normal text-rose-600 dark:text-rose-400 ml-2">
                    {analytics.aiEvaluationsFailed} failed
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Judge Evaluations</p>
                <p className="text-2xl font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                  {analytics.completedJudgeEvaluations} done
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {analytics.pendingJudgeEvaluations} pending · {analytics.inProgressJudgeEvaluations} in progress
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Average Official Score</p>
                <p className="text-2xl font-mono font-bold text-blue-700 dark:text-blue-400 mt-1">
                  {analytics.averageOfficialScore !== null
                    ? analytics.averageOfficialScore.toFixed(1)
                    : '—'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Progress: {analytics.evaluationProgressPercent}% complete
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Score Distribution & Judge Workload */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score Distribution Chart */}
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Score Distribution</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Human Judge Average vs. AI Pre-Evaluation Buckets (%)
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-semibold">
                    <span className="flex items-center gap-1 text-blue-700 dark:text-blue-400">
                      <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 dark:bg-blue-400 inline-block" /> Human
                    </span>
                    <span className="flex items-center gap-1 text-purple-700 dark:text-purple-400">
                      <span className="w-2.5 h-2.5 rounded-sm bg-purple-400 inline-block" /> AI
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {analytics.scoreDistribution.map((b) => {
                    const maxVal = Math.max(
                      1,
                      ...analytics.scoreDistribution.map((x) => Math.max(x.humanCount, x.aiCount))
                    );
                    return (
                      <div key={b.bucket} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 w-16">
                            {b.bucket}%
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Human: {b.humanCount} · AI: {b.aiCount}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all"
                              style={{ width: `${(b.humanCount / maxVal) * 100}%` }}
                            />
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-purple-400 h-2 rounded-full transition-all"
                              style={{ width: `${(b.aiCount / maxVal) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Judge Workload */}
            <Card>
              <CardContent className="p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Judge Workload & Throughput</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Assignment completion velocity and conflict-of-interest counts per judge
                  </p>
                </div>

                <div className="space-y-3">
                  {analytics.judgeWorkload.map((w) => (
                    <div key={w.judgeId} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{w.judgeName}</span>
                        <span className="font-mono text-slate-600 dark:text-slate-400">
                          {w.completedReviews} / {w.totalAssigned} ({w.completionRate}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-2 rounded-full transition-all"
                          style={{ width: `${w.completionRate}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                        <span>Pending: {w.pendingReviews}</span>
                        <span>In Progress: {w.inProgressReviews}</span>
                        {w.conflictsDeclared > 0 && (
                          <span className="text-rose-600 dark:text-rose-400 font-semibold">
                            Conflicts: {w.conflictsDeclared}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Dedicated AI vs. Human Score Comparison Report */}
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Sparkles size={17} className="text-purple-600 dark:text-purple-400" />
                    <span>AI vs. Human Score Comparison Report</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Diagnostic comparison of automated AI pre-evaluation scores against finalized
                    human judge decisions.
                  </p>
                </div>
                <Badge variant="neutral" size="sm">
                  {analytics.aiHumanComparison.comparedCount} Projects Compared
                </Badge>
              </div>

              {/* Mandatory Governance Disclaimer — NEVER present agreement as proof of correctness */}
              <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-500/35 bg-amber-50/80 dark:bg-amber-500/10 flex items-start gap-2.5">
                <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-950 dark:text-amber-200 font-medium leading-relaxed">
                  {analytics.aiHumanComparison.disclaimer}
                </p>
              </div>

              {/* Summary Comparison Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Mean Signed Difference (Human − AI)
                  </p>
                  <p className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {analytics.aiHumanComparison.meanSignedDifference > 0 ? '+' : ''}
                    {analytics.aiHumanComparison.meanSignedDifference.toFixed(2)} pts
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Mean Absolute Difference
                  </p>
                  <p className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {analytics.aiHumanComparison.meanAbsoluteDifference.toFixed(2)} pts
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Within ±5 Points</p>
                  <p className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {analytics.aiHumanComparison.withinFivePointsCount} /{' '}
                    {analytics.aiHumanComparison.comparedCount} (
                    {analytics.aiHumanComparison.withinFivePointsPercent}%)
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Judge Decisions</p>
                  <p className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100 mt-1.5">
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Agree {analytics.aiHumanComparison.decisionBreakdown.agree}
                    </span>{' '}
                    ·{' '}
                    <span className="text-blue-700 dark:text-blue-400">
                      Modify {analytics.aiHumanComparison.decisionBreakdown.modify}
                    </span>{' '}
                    ·{' '}
                    <span className="text-rose-700 dark:text-rose-400">
                      Reject {analytics.aiHumanComparison.decisionBreakdown.reject}
                    </span>
                  </p>
                </div>
              </div>

              {/* Per-entry comparison table */}
              {analytics.aiHumanComparison.perEntryComparison.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>AI Pre-Score</TableHead>
                      <TableHead>Human Avg</TableHead>
                      <TableHead>Delta (Human − AI)</TableHead>
                      <TableHead>Judge Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.aiHumanComparison.perEntryComparison.map((row) => (
                      <TableRow key={row.submissionId}>
                        <TableCell>
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                            {row.projectTitle}
                          </span>
                          <span className="block text-[10px] font-mono text-slate-400 dark:text-slate-500">
                            {row.referenceId}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-600 dark:text-slate-400">{row.category}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono text-purple-700 dark:text-purple-400">
                            {row.aiScore.toFixed(1)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono font-bold text-blue-700 dark:text-blue-400">
                            {row.humanScore.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              Math.abs(row.delta) <= 3
                                ? 'neutral'
                                : row.delta > 0
                                ? 'success'
                                : 'warning'
                            }
                            size="sm"
                          >
                            {row.delta > 0 ? '+' : ''}
                            {row.delta.toFixed(2)} pts
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {row.decisionModes.map((m, i) => (
                              <Badge
                                key={i}
                                variant={
                                  m === 'AGREE' ? 'success' : m === 'REJECT' ? 'danger' : 'primary'
                                }
                                size="sm"
                              >
                                {m}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* TAB 4: APPEND-ONLY SCORING LEDGER               */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <Lock size={15} className="text-slate-500 dark:text-slate-400" />
              <span>
                <strong className="text-slate-900 dark:text-slate-100">Append-Only Immutable Scoring Ledger</strong> — Every AI and Human
                criterion score contribution is permanently recorded. Direct client mutation is
                disabled.
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {(['ALL', 'HUMAN', 'AI'] as const).map((src) => (
                <button
                  key={src}
                  onClick={() => setLedgerSourceFilter(src)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    ledgerSourceFilter === src
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seq #</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Entry / Eval ID</TableHead>
                <TableHead>Criterion</TableHead>
                <TableHead>Score / Max</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Reason for Contribution / Adjustment</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerEntries.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">#{item.sequenceNumber}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.source === 'HUMAN' ? 'primary' : 'neutral'} size="sm">
                      {item.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 block">
                      {item.referenceId || item.entryId}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      {item.evaluationId}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-700 dark:text-slate-300">
                      {item.criterionName || item.criterionId}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100">
                      {item.score} / {item.maxScore}
                    </span>
                    {item.isAdjustment && (
                      <Badge variant="warning" size="sm" className="ml-1.5">
                        ADJ
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-700 dark:text-slate-300">{item.actorName}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 max-w-xs">
                      {item.reasonForAdjustment}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* TAB 5: GOVERNANCE AUDIT TRAIL                   */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <FileCheck2 size={15} className="text-blue-600 dark:text-blue-400" />
              <span className="font-semibold">
                Immutable Governance Audit Log (Scores, Submissions, Assignments, Publication,
                Reopens & Overrides)
              </span>
            </div>
            <select
              value={auditCategoryFilter}
              onChange={(e) => setAuditCategoryFilter(e.target.value as any)}
              className="text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-lg px-3 py-1.5"
            >
              <option value="ALL">All Categories</option>
              <option value="SCORE_CHANGE">Score Changes</option>
              <option value="EVALUATION_SUBMISSION">Evaluation Submissions</option>
              <option value="ASSIGNMENT_CHANGE">Assignment Changes</option>
              <option value="PUBLICATION_ACTION">Publication Actions</option>
              <option value="REOPENED_EVALUATION">Reopened Evaluations</option>
              <option value="ADMIN_OVERRIDE">Administrative Overrides</option>
              <option value="POLICY_CHANGE">Policy Changes</option>
            </select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seq</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditEvents.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell>
                    <span className="font-mono text-xs text-slate-400 dark:text-slate-500">#{ev.sequenceNumber}</span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        ev.category === 'PUBLICATION_ACTION'
                          ? 'success'
                          : ev.category === 'ADMIN_OVERRIDE' || ev.category === 'REOPENED_EVALUATION'
                          ? 'warning'
                          : 'neutral'
                      }
                      size="sm"
                    >
                      {ev.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {ev.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-800 dark:text-slate-200">{ev.actorName}</span>
                    <span className="block text-[10px] text-slate-400 dark:text-slate-500">{ev.actorRole}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-700 dark:text-slate-300">{ev.targetLabel || ev.targetId}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-600 dark:text-slate-400">{ev.reason}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                      {new Date(ev.timestamp).toLocaleString()}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* MODALS: PUBLISH, UNPUBLISH, PREVIEW, BREAKDOWN  */}
      {/* ═══════════════════════════════════════════════ */}

      {/* Publish Official Results Modal */}
      <Modal
        isOpen={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        title="Approve & Publish Official Results"
        description="Official publication freezes the current rankings under the active scoring policy and makes the Public Leaderboard accessible."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPublishModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePublish}
              disabled={!publishApprovalConfirmed || publishReason.trim().length < 5}
            >
              Authorize & Publish Now
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Snapshot Summary ({entries.length} ranked entries)
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              Policy: <strong>{policyType.replace(/_/g, ' ')}</strong> · AI Included:{' '}
              <strong>{includeAi ? `Yes (${Math.round(aiWeight * 100)}%)` : 'No (Human Only)'}</strong>
            </p>
            {entries[0] && (
              <p className="text-slate-600 dark:text-slate-300">
                #1 Ranked: <strong>{entries[0].projectTitle}</strong> ({entries[0].officialScore.toFixed(2)} /{' '}
                {entries[0].maxPossibleScore})
              </p>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Organizer Approval Statement *
            </label>
            <textarea
              rows={3}
              value={publishReason}
              onChange={(e) => setPublishReason(e.target.value)}
              className="w-full bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Document why these official results are approved for publication..."
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer p-3 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/10">
            <input
              type="checkbox"
              checked={publishApprovalConfirmed}
              onChange={(e) => setPublishApprovalConfirmed(e.target.checked)}
              className="mt-0.5 accent-blue-600"
            />
            <span className="text-blue-950 dark:text-blue-200 font-medium">
              I confirm that judge evaluations, tie-breakers, and scoring policies have been
              reviewed and I authorize publishing these official results publicly.
            </span>
          </label>
        </div>
      </Modal>

      {/* Unpublish / Correct Modal */}
      <Modal
        isOpen={unpublishModalOpen}
        onClose={() => setUnpublishModalOpen(false)}
        title="Unpublish Official Results for Correction"
        description="Takes the public leaderboard offline immediately and records an audited publication reversal."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setUnpublishModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleUnpublish}
              disabled={unpublishReason.trim().length < 5}
            >
              Unpublish Results
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-xs">
          <p className="text-slate-600 dark:text-slate-400">
            Provide a documented audit justification (e.g., judge score dispute reopened, tie-breaker
            review, or eligibility check).
          </p>
          <textarea
            rows={3}
            value={unpublishReason}
            onChange={(e) => setUnpublishReason(e.target.value)}
            className="w-full bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Mandatory audit reason (minimum 5 characters)..."
          />
        </div>
      </Modal>

      {/* Preview Official Leaderboard Modal */}
      <Modal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        maxWidth="2xl"
        title="Public Leaderboard Preview (Provisional)"
        description="Preview how official standings will appear once authorized and published."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreviewModalOpen(false)}>
              Close Preview
            </Button>
            {!isPublished && entries.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setPreviewModalOpen(false);
                  setPublishModalOpen(true);
                }}
              >
                Proceed to Official Publication
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {entries.map((e) => (
            <div
              key={e.submissionId}
              className="p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/60 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 rounded-lg">
                  #{e.rank}
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{e.projectTitle}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {e.teamOrParticipantName} · {e.category} · {e.submissionType}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-bold text-blue-700 dark:text-blue-400">
                  {e.officialScore.toFixed(2)} / {e.maxPossibleScore}
                </p>
                {e.isTied && (
                  <Badge variant="warning" size="sm">
                    TIED
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Entry Reconciliation & Authorized Ledger Adjustment Modal */}
      <Modal
        isOpen={Boolean(inspectedEntry)}
        onClose={() => setInspectedEntry(null)}
        maxWidth="2xl"
        title={inspectedEntry ? `Score Breakdown: ${inspectedEntry.projectTitle}` : ''}
        description="Inspect human judge score contributions, AI comparison, and authorized adjustment workflow."
        footer={
          <Button variant="outline" size="sm" onClick={() => setInspectedEntry(null)}>
            Close
          </Button>
        }
      >
        {inspectedEntry && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
                <span className="text-slate-500 dark:text-slate-400 block">Official Score</span>
                <span className="text-lg font-mono font-bold text-blue-700 dark:text-blue-400">
                  {inspectedEntry.officialScore.toFixed(2)} / {inspectedEntry.maxPossibleScore}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block">Human Judge Average</span>
                <span className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100">
                  {inspectedEntry.humanAverageScore !== null
                    ? inspectedEntry.humanAverageScore.toFixed(2)
                    : '—'}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30">
                <span className="text-slate-500 dark:text-slate-400 block">AI Pre-Evaluation (Separate)</span>
                <span className="text-lg font-mono font-bold text-purple-700 dark:text-purple-400">
                  {inspectedEntry.aiScore !== null ? inspectedEntry.aiScore.toFixed(2) : '—'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-bold text-slate-900 dark:text-slate-100">Finalized Human Judge Contributions</p>
              {inspectedEntry.judgeBreakdown.map((jb) => (
                <div
                  key={jb.evaluationId}
                  className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/60 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{jb.judgeName}</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">
                      Round: {jb.roundId} · Weight: {jb.weight}x · Decision: {jb.decisionMode}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{jb.score} pts</span>
                </div>
              ))}
            </div>

            {/* Authorized Organizer Ledger Adjustment Form */}
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 space-y-3">
              <p className="font-bold text-amber-950 dark:text-amber-200">
                Append Authorized Ledger Adjustment (Organizer Only)
              </p>
              <p className="text-amber-900 dark:text-amber-300/90">
                Never overwrites historical contributions. Appends a new immutable ledger entry and
                logs an ADMIN_OVERRIDE audit event.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={adjCriterionId}
                  onChange={(e) => setAdjCriterionId(e.target.value)}
                  className="border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 text-xs"
                >
                  {Object.values(inspectedEntry.criterionSummaries).map((c) => (
                    <option key={c.criterionId} value={c.criterionId}>
                      {c.criterionName} (Max {c.maxScore})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Adjusted criterion score"
                  value={adjScore}
                  onChange={(e) => setAdjScore(e.target.value)}
                  className="border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs font-mono"
                />
              </div>
              <input
                type="text"
                placeholder="Mandatory audit justification (min 5 chars)..."
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-xs"
              />
              <Button
                variant="secondary"
                size="xs"
                onClick={handleAppendAuthorizedAdjustment}
                disabled={adjReason.trim().length < 5 || adjScore === ''}
              >
                Append Immutable Adjustment to Ledger
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
