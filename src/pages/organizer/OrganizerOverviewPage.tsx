import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { competitionService } from '../../services/competitionService';
import { resultsAndAnalyticsService } from '../../services/resultsAndAnalyticsService';
import type { Competition } from '../../types/authAndCompetition';
import type { CompetitionAnalyticsReport } from '../../types/scoringAndResults';

export const OrganizerOverviewPage: React.FC = () => {
  const { activeOrganization, canManageCurrentOrg } = useProoflyAuth();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [analytics, setAnalytics] = useState<CompetitionAnalyticsReport | null>(null);

  useEffect(() => {
    let active = true;
    const loadDashboard = async () => {
      const comps = activeOrganization
        ? await competitionService.listOrganizationCompetitions(activeOrganization.id)
        : await competitionService.listAllCompetitions();

      if (!active) return;
      setCompetitions(comps);

      if (comps.length === 0) {
        setAnalytics(null);
        return;
      }

      const primaryCompId = comps[0].id;
      const report = await resultsAndAnalyticsService.computeCompetitionAnalytics(primaryCompId);
      if (active) {
        setAnalytics(report);
      }
    };
    loadDashboard();
    return () => {
      active = false;
    };
  }, [activeOrganization]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={activeOrganization?.name || 'Overview'}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/organizer/results">
              <Button variant="outline" size="xs">
                Results
              </Button>
            </Link>
            <Link to="/organizer/competitions?action=create">
              <Button
                variant="primary"
                size="xs"
                leftIcon={<Plus size={13} />}
                disabled={!canManageCurrentOrg}
              >
                Create competition
              </Button>
            </Link>
          </div>
        }
      />

      {/* Compact Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Submissions</p>
          <p className="text-xl font-semibold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {analytics ? analytics.totalSubmissions : 0}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            {analytics ? analytics.validSubmissions : 0} valid
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">AI evaluated</p>
          <p className="text-xl font-semibold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {analytics ? analytics.aiEvaluationsCompleted : 0}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            {analytics ? analytics.aiEvaluationsFailed : 0} failed
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Judge reviews</p>
          <p className="text-xl font-semibold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {analytics ? analytics.completedJudgeEvaluations : 0}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            {analytics ? analytics.pendingJudgeEvaluations : 0} pending ·{' '}
            {analytics ? analytics.evaluationProgressPercent : 0}%
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Average score</p>
          <p className="text-xl font-semibold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {analytics?.averageOfficialScore !== null &&
            analytics?.averageOfficialScore !== undefined
              ? analytics.averageOfficialScore.toFixed(1)
              : '—'}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            Human / AI |Δ|:{' '}
            {analytics
              ? `${analytics.aiHumanComparison.meanAbsoluteDifference.toFixed(1)} pts`
              : '—'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Competitions Table */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Competitions
            </h2>
            <Link
              to="/organizer/competitions"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              View all ({competitions.length})
            </Link>
          </div>

          {competitions.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs">
              No competitions yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {competitions.map((comp) => (
                  <TableRow key={comp.id}>
                    <TableCell>
                      <span className="text-xs font-medium text-slate-900 dark:text-slate-100">{comp.title}</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          comp.status === 'EVALUATION'
                            ? 'warning'
                            : comp.status === 'ACTIVE'
                            ? 'success'
                            : 'neutral'
                        }
                        size="sm"
                      >
                        {comp.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {comp.publicAccessCode}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {comp.policies.submissionDeadline.split('T')[0]}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2 text-xs">
                        <Link
                          to={`/organizer/submissions?comp=${comp.id}`}
                          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 font-medium transition-colors"
                        >
                          Submissions
                        </Link>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <Link
                          to={`/organizer/results?comp=${comp.id}`}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
                        >
                          Results
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Right: Judge Workload & Distribution */}
        <div className="space-y-4">
          {analytics && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Judge workload
                </h3>
                <Link
                  to="/organizer/judges"
                  className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                >
                  Manage
                </Link>
              </div>
              <div className="space-y-2.5">
                {analytics.judgeWorkload.slice(0, 5).map((w) => (
                  <div key={w.judgeId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-800 dark:text-slate-200 font-medium truncate">{w.judgeName}</span>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {w.completedReviews}/{w.totalAssigned}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 dark:bg-blue-400 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${w.completionRate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {analytics && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Score distribution
                </h3>
                <Link
                  to="/organizer/results"
                  className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                >
                  Analytics
                </Link>
              </div>
              <div className="space-y-1.5">
                {analytics.scoreDistribution.map((b) => (
                  <div key={b.bucket} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-500 dark:text-slate-400 w-14">{b.bucket}%</span>
                    <span className="text-slate-700 dark:text-slate-300 font-mono">
                      {b.humanCount} human · {b.aiCount} AI
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                Human vs. AI alignment is descriptive only, not proof of correctness.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
