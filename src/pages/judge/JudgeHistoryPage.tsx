// ─────────────────────────────────────────────
// JudgeHistoryPage.tsx — Evaluation History & Audit Log
// Proofly / Evalora — Phase 7 Human Judging Workspace
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Link } from 'react-router-dom';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { judgeAssignmentService } from '../../services/judgeAssignmentService';
import { submissionService } from '../../services/submissionService';
import type { HumanJudgeEvaluation } from '../../types/judgeAndEvaluation';
import type { ProjectSubmission } from '../../types/submission';
import { ArrowRight } from 'lucide-react';

interface HistoryRow {
  evaluation: HumanJudgeEvaluation;
  submission?: ProjectSubmission | null;
}

export const JudgeHistoryPage: React.FC = () => {
  const { currentUser } = useProoflyAuth();
  const judgeId = currentUser?.uid || 'user-judge-demo';

  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      try {
        const evals = await judgeAssignmentService.listEvaluationsByJudge(judgeId);
        const rows: HistoryRow[] = [];

        for (const ev of evals) {
          const sub = await submissionService.getSubmission(ev.submissionId);
          rows.push({
            evaluation: ev,
            submission: sub,
          });
        }

        setHistoryRows(rows);
      } catch (err) {
        console.warn('Could not load judge history:', err);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [judgeId]);

  return (
    <div className="space-y-5">
      <PageHeader title="History" />

      {loading ? (
        <div className="text-center py-10 text-xs text-slate-400 dark:text-slate-500">Loading history...</div>
      ) : historyRows.length === 0 ? (
        <Card className="text-center py-10 px-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-2">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No evaluations submitted</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Completed evaluations will appear here once submitted.
          </p>
          <div className="pt-2">
            <Link to="/judge/assignments">
              <Button variant="outline" size="xs" rightIcon={<ArrowRight size={13} />}>
                Open assignments
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project Title</TableHead>
                <TableHead>Team / Submitter</TableHead>
                <TableHead>AI Score</TableHead>
                <TableHead>Your Submitted Score</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead>Decision Mode</TableHead>
                <TableHead>Lock Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyRows.map(({ evaluation: ev, submission: sub }) => {
                const title = sub?.projectTitle || ev.referenceId;
                const team = sub?.teamName || sub?.primaryContactName || 'Participant';
                const isLocked = ev.isLocked;

                return (
                  <TableRow key={ev.id}>
                    <TableCell>
                      <div className="space-y-0.5">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm block">{title}</span>
                        <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">{ev.referenceId}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{team}</span>
                    </TableCell>

                    <TableCell>
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{ev.aiTotalScore} / 100</span>
                    </TableCell>

                    <TableCell>
                      <span className="text-sm font-mono font-bold text-blue-700 dark:text-blue-400">
                        {ev.totalScore} / 100
                      </span>
                    </TableCell>

                    <TableCell>
                      <span
                        className={`text-xs font-mono font-bold ${
                          ev.scoreDifference > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : ev.scoreDifference < 0
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {ev.scoreDifference > 0 ? `+${ev.scoreDifference}` : ev.scoreDifference} pts
                      </span>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          ev.decisionMode === 'AGREE'
                            ? 'success'
                            : ev.decisionMode === 'MODIFY'
                            ? 'neutral'
                            : 'danger'
                        }
                        size="sm"
                      >
                        {ev.decisionMode}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <Badge variant={isLocked ? 'success' : 'warning'} size="sm" dot>
                        {isLocked ? 'Locked' : 'Draft'}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right">
                      <Link to={`/judge/review?id=${ev.submissionId}`}>
                        <Button variant="outline" size="xs">
                          View Scorecard
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
};
