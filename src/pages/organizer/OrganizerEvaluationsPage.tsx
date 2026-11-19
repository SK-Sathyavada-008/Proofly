// ─────────────────────────────────────────────
// OrganizerEvaluationsPage.tsx — AI Evaluation Engine & Control Center
// Proofly / Evalora — Phase 6
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  Play,
  RotateCw,
  ShieldCheck,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../components/ui/Toast';
import { AiEvaluationReportView } from '../../components/evaluation/AiEvaluationReportView';
import { evaluationQueueService } from '../../services/evaluationQueueService';
import { evaluationPipelineService } from '../../services/evaluationPipelineService';
import { submissionService } from '../../services/submissionService';
import { competitionService } from '../../services/competitionService';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import type { AiEvaluationJob, AiEvaluationReport } from '../../types/aiEvaluation';
import type { ProjectSubmission } from '../../types/submission';

export const OrganizerEvaluationsPage: React.FC = () => {
  const { activeOrganization } = useProoflyAuth();
  const { success, error, info } = useToast();
  const [jobs, setJobs] = useState<AiEvaluationJob[]>([]);
  const [submissions, setSubmissions] = useState<ProjectSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Report Modal
  const [selectedReport, setSelectedReport] = useState<AiEvaluationReport | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  // Override Dialog
  const [overrideJob, setOverrideJob] = useState<AiEvaluationJob | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);

  // Persistent worker ID for browser session leases
  const [workerId] = useState(() => `browser-worker-${Math.random().toString(36).substring(2, 9)}`);

  const loadData = async () => {
    setLoading(true);
    try {
      const comps = activeOrganization
        ? await competitionService.listOrganizationCompetitions(activeOrganization.id)
        : await competitionService.listAllCompetitions();
      const activeCompetition = comps[0];

      const allSubs = activeCompetition
        ? await submissionService.listSubmissions(activeCompetition.id)
        : await submissionService.listAllSubmissions();
      setSubmissions(allSubs);

      // Ensure any final submission in 'Queued for AI Evaluation' has a job
      for (const sub of allSubs) {
        if (sub.status === 'Queued for AI Evaluation' || sub.status === 'AI Evaluation In Progress') {
          await evaluationQueueService.enqueueSubmission(sub.id, sub.competitionId, sub.referenceId, sub.organizationId);
        }
      }

      const allJobs = await evaluationQueueService.listJobs();
      setJobs(allJobs);
    } catch (err: any) {
      console.warn('Failed to load evaluation queue data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeOrganization]);

  // Controlled evaluation worker execution
  const processNextJob = async () => {
    try {
      // 1. Claim next job with a 60s lease
      const claimed = await evaluationQueueService.claimNextJob(workerId, 60000);
      if (!claimed) {
        info('Evaluation Queue Empty', 'No queued evaluation jobs require processing right now.');
        return false;
      }

      setActiveJobId(claimed.id);
      info('Processing Job', `Worker claimed lease on submission ${claimed.referenceId || claimed.submissionId}. Running 9-step pipeline...`);

      // 2. Execute pipeline in browser worker
      const result = await evaluationQueueService.processJob(claimed, workerId);

      if (result.success && result.report) {
        success(
          'Evaluation Completed',
          `Evaluated ${claimed.referenceId} with score ${result.report.overallScore}/${result.report.totalMaxScore}. Submission is now Ready for Judge Review.`
        );
      } else {
        error(
          'Evaluation Failed',
          `Job ${claimed.referenceId} failed: ${result.error || 'Pipeline error'}. Saved to queue for retry or organizer override.`
        );
      }

      await loadData();
      return true;
    } catch (err: any) {
      error('Worker Error', err?.message || 'Unexpected worker error');
      return false;
    } finally {
      setActiveJobId(null);
    }
  };

  const handleRunAllJobs = async () => {
    setWorkerRunning(true);
    let hasMore = true;
    let processedCount = 0;

    while (hasMore) {
      hasMore = await processNextJob();
      if (hasMore) processedCount++;
    }

    setWorkerRunning(false);
    if (processedCount > 0) {
      success('Worker Finished', `Successfully processed ${processedCount} evaluation job(s).`);
    }
  };

  const handleInspectReport = async (submissionId: string, reportId?: string) => {
    setReportLoading(true);
    setIsReportModalOpen(true);
    try {
      let rep: AiEvaluationReport | null = null;
      if (reportId) {
        rep = await evaluationPipelineService.getEvaluationReport(reportId);
      }
      if (!rep) {
        rep = await evaluationPipelineService.getReportBySubmissionId(submissionId);
      }

      if (rep) {
        setSelectedReport(rep);
      } else {
        // Construct visual fallback report for preview if needed
        const sub = submissions.find((s) => s.id === submissionId);
        if (sub) {
          const comp = (await competitionService.getCompetition(sub.competitionId)) || undefined;
          const pipelineRes = await evaluationPipelineService.executePipeline(sub, comp);
          setSelectedReport(pipelineRes.report || null);
        }
      }
    } catch (err: any) {
      error('Report Load Error', err?.message || 'Could not load evaluation report.');
    } finally {
      setReportLoading(false);
    }
  };

  const handleApplyOverride = async () => {
    if (!overrideJob) return;
    if (!overrideReason || overrideReason.trim().length < 5) {
      error('Validation Error', 'A documented justification reason (minimum 5 characters) is required.');
      return;
    }

    try {
      await evaluationPipelineService.applyOrganizerOverride(overrideJob.submissionId, {
        id: 'org-admin-1',
        name: 'Platform Administrator',
        reason: overrideReason,
        justificationNotes: overrideNotes,
      });

      // Mark job as completed by override
      await evaluationQueueService.completeJob(overrideJob.id, workerId, 'override-applied');

      success('Override Applied', `Submission ${overrideJob.referenceId} has been manually unlocked for Judge Review.`);
      setIsOverrideModalOpen(false);
      setOverrideJob(null);
      setOverrideReason('');
      setOverrideNotes('');
      await loadData();
    } catch (err: any) {
      error('Override Failed', err?.message || 'Could not apply override.');
    }
  };

  // Metrics
  const queuedCount = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'RETRY_WAIT').length;
  const inProgressCount = jobs.filter((j) =>
    ['IN_PROGRESS', 'LEASED', 'CLAIMED', 'EXTRACTING', 'EVALUATING', 'VALIDATING'].includes(j.status)
  ).length;
  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failedCount = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Evaluations"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={loadData}
              disabled={loading || workerRunning}
              leftIcon={<RotateCw size={13} className={loading ? 'animate-spin' : ''} />}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="xs"
              onClick={handleRunAllJobs}
              disabled={workerRunning || (queuedCount === 0 && failedCount === 0)}
              leftIcon={<Play size={13} className={workerRunning ? 'animate-spin' : ''} />}
            >
              {workerRunning ? 'Running...' : `Run queue (${queuedCount + failedCount})`}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Queued</p>
          <p className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100 mt-0.5">{queuedCount}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">In progress</p>
          <p className="text-lg font-semibold font-mono text-blue-600 dark:text-blue-400 mt-0.5">{inProgressCount}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Completed</p>
          <p className="text-lg font-semibold font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">{completedCount}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Failed</p>
          <p className="text-lg font-semibold font-mono text-rose-600 dark:text-rose-400 mt-0.5">{failedCount}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-900 dark:text-slate-100">Evaluation jobs</CardTitle>
          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">{workerId}</span>
        </CardHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference / Title</TableHead>
              <TableHead>Submitter / Team</TableHead>
              <TableHead>Pipeline Status</TableHead>
              <TableHead>AI Score</TableHead>
              <TableHead>Judge Access Gate</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((sub) => {
              const job = jobs.find((j) => j.submissionId === sub.id);
              const isWorkingThis = activeJobId === job?.id;

              return (
                <TableRow key={sub.id}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm block">
                        {sub.projectTitle || (sub as any).title}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 block">
                        {sub.referenceId || sub.id}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                      {sub.teamName || sub.primaryContactName}
                    </span>
                  </TableCell>

                  <TableCell>
                    {isWorkingThis ? (
                      <Badge variant="warning" size="sm" className="animate-pulse">
                        <RotateCw size={11} className="animate-spin mr-1" />
                        Evaluating...
                      </Badge>
                    ) : sub.status === 'Ready for Judge Review' || sub.status === 'AI Evaluation Complete' ? (
                      <Badge variant="success" size="sm">
                        <CheckCircle2 size={11} className="mr-1" />
                        AI Complete
                      </Badge>
                    ) : sub.status === 'AI Evaluation Failed' ? (
                      <Badge variant="danger" size="sm">
                        <AlertTriangle size={11} className="mr-1" />
                        Failed
                      </Badge>
                    ) : sub.status === 'Queued for AI Evaluation' ? (
                      <Badge variant="warning" size="sm">
                        <Clock size={11} className="mr-1" />
                        Queued
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        {sub.status}
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell>
                    {sub.aiScore !== undefined ? (
                      <span className="text-xs font-mono font-bold text-blue-700 dark:text-blue-400">
                        {sub.aiScore} pts
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {sub.aiFailureOverride ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/15 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-500/30">
                        <ShieldCheck size={11} />
                        Override Unlocked
                      </span>
                    ) : sub.status === 'Ready for Judge Review' ||
                      sub.status === 'Under Human Review' ||
                      sub.status === 'Evaluated' ||
                      sub.status === 'Finalized' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30">
                        <CheckCircle2 size={11} />
                        Unlocked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-500/30">
                        <Lock size={11} />
                        Locked (Gate Active)
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {((job && job.status === 'FAILED') || sub.status === 'AI Evaluation Failed') && (
                        <>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={async () => {
                              if (job) {
                                try {
                                  await evaluationQueueService.retryJobManual({
                                    jobId: job.id,
                                    organizerUserId: workerId,
                                    organizerName: 'Competition Organizer',
                                    auditReason: 'Organizer manual queue retry from evaluation dashboard',
                                  });
                                  await loadData();
                                  success('Job Re-queued', `Evaluation job for ${job.referenceId} has been reset to QUEUED.`);
                                } catch (err: any) {
                                  error('Retry Failed', err?.message || 'Could not reset job.');
                                }
                              }
                            }}
                            className="text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 hover:bg-amber-50 dark:hover:bg-amber-500/15"
                          >
                            Retry Job
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              setOverrideJob(job || null);
                              setIsOverrideModalOpen(true);
                            }}
                            className="text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/15"
                          >
                            Override Failure
                          </Button>
                        </>
                      )}

                      {sub.status === 'Queued for AI Evaluation' && (
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={workerRunning}
                          onClick={async () => {
                            if (job) {
                              setActiveJobId(job.id);
                              await evaluationQueueService.processJob(job, workerId);
                              await loadData();
                              setActiveJobId(null);
                            }
                          }}
                          leftIcon={<Play size={12} />}
                        >
                          Evaluate Now
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleInspectReport(sub.id, sub.aiEvaluationId)}
                        leftIcon={<FileText size={12} />}
                      >
                        Inspect Dossier
                      </Button>

                      <Link to={`/judge/review?id=${sub.referenceId || sub.id}`}>
                        <Button variant="ghost" size="xs">
                          Judge View
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* ── REPORT INSPECTION MODAL ── */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title="AI Evaluation Dossier (Audit View)"
        maxWidth="xl"
      >
        {reportLoading ? (
          <div className="py-20 text-center text-xs text-slate-500 dark:text-slate-400">
            <RotateCw size={24} className="animate-spin mx-auto mb-2 text-blue-600 dark:text-blue-400" />
            Loading complete AI evaluation report...
          </div>
        ) : selectedReport ? (
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <AiEvaluationReportView report={selectedReport} />
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-500">
            No report available for this submission yet. Run the evaluation worker first.
          </div>
        )}
      </Modal>

      {/* ── AI-FAILURE OVERRIDE MODAL ── */}
      <Modal
        isOpen={isOverrideModalOpen}
        onClose={() => setIsOverrideModalOpen(false)}
        title="Apply Authorized AI-Failure Override"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            <p className="font-semibold flex items-center gap-1.5 mb-1">
              <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400" />
              Administrative Governance Notice
            </p>
            An AI-failure override permits human judges to access the review workspace for a submission whose automated AI pre-evaluation failed or stalled. All overrides are logged permanently on the audit ledger.
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Documented Justification Reason (Required)*
            </label>
            <input
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g. Rate limit timeout or corrupted external binary link"
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Additional Organizer Notes (Optional)
            </label>
            <Textarea
              value={overrideNotes}
              onChange={(e) => setOverrideNotes(e.target.value)}
              placeholder="Provide context for the judging panel regarding what to manually inspect..."
              rows={3}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="ghost" size="sm" onClick={() => setIsOverrideModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleApplyOverride}>
              Confirm & Unlock Submission
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
