// ─────────────────────────────────────────────
// JudgeAssignmentListPage.tsx — Judge Assigned Queue with Scoped Access & Workload Tabs
// Proofly / Evalora — Phase 7 Human Judging Workspace
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search,
  Sparkles,
  ChevronRight,
  Globe,
  Play,
  RotateCw,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Tabs } from '../../components/ui/Tabs';
import { Card } from '../../components/ui/Card';
import { GithubIcon } from '../../components/ui/GithubIcon';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { submissionService } from '../../services/submissionService';
import { submissionLifecycleService } from '../../services/submissionLifecycleService';
import { competitionService } from '../../services/competitionService';
import { evaluationPipelineService } from '../../services/evaluationPipelineService';
import { judgeAssignmentService } from '../../services/judgeAssignmentService';
import type { ProjectSubmission } from '../../types/submission';
import type { Competition } from '../../types/authAndCompetition';
import type { JudgeRecord, JudgeAssignment } from '../../types/judgeAndEvaluation';

export const JudgeAssignmentListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser } = useProoflyAuth();
  const { success, error: toastError, info } = useToast();

  const [activeTab, setActiveTab] = useState<string>('assigned');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string>(
    searchParams.get('competitionId') || 'ALL'
  );

  // Judge Scoping State
  const [judges, setJudges] = useState<JudgeRecord[]>([]);
  const [activeJudgeId, setActiveJudgeId] = useState<string>('');
  const [viewAllOrganizerMode, setViewAllOrganizerMode] = useState<boolean>(false);

  const [submissions, setSubmissions] = useState<ProjectSubmission[]>([]);
  const [assignments, setAssignments] = useState<JudgeAssignment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [evaluatingSubId, setEvaluatingSubId] = useState<string | null>(null);

  // Multi-Select & Batch Evaluation State
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [isBatchEvaluating, setIsBatchEvaluating] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentTitle?: string } | null>(null);

  // Load Judges and Competitions
  useEffect(() => {
    async function initData() {
      try {
        const loadedJudges = await judgeAssignmentService.listJudges();
        setJudges(loadedJudges);

        // Auto-select judge if currentUser matches a judge, or first available judge
        if (currentUser) {
          const matching = loadedJudges.find(
            (j) => j.id === currentUser.uid || j.email.toLowerCase() === currentUser.email.toLowerCase()
          );
          if (matching) {
            setActiveJudgeId(matching.id);
          } else if (loadedJudges.length > 0) {
            setActiveJudgeId(loadedJudges[0].id);
          } else {
            setActiveJudgeId('');
          }
        } else if (loadedJudges.length > 0) {
          setActiveJudgeId(loadedJudges[0].id);
        }

        const allComps = await competitionService.listAllCompetitions();
        setCompetitions(allComps);
      } catch (err) {
        console.warn('Could not initialize judge assignment data:', err);
      }
    }
    initData();
  }, [currentUser]);

  // Load Submissions and Assignments
  const loadData = async (compId: string) => {
    setLoading(true);
    try {
      // 1. Load submissions
      let subs: ProjectSubmission[] = [];
      if (compId === 'ALL') {
        subs = await submissionService.listAllSubmissions();
      } else {
        subs = await submissionService.listCompetitionSubmissions(compId);
      }
      setSubmissions(subs);

      // 2. Load judge assignments
      const allAsgns = await judgeAssignmentService.listAssignments({
        competitionId: compId === 'ALL' ? undefined : compId,
      });
      setAssignments(allAsgns);
    } catch (err) {
      console.warn('Failed to load submissions for judge:', err);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedCompId);
  }, [selectedCompId]);

  const handleCompetitionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCompId = e.target.value;
    setSelectedCompId(newCompId);
    if (newCompId === 'ALL') {
      searchParams.delete('competitionId');
      setSearchParams(searchParams);
    } else {
      setSearchParams({ competitionId: newCompId });
    }
  };

  // Inline Quick AI Evaluation
  const handleQuickEvaluate = async (sub: ProjectSubmission) => {
    setEvaluatingSubId(sub.id);
    info('Evaluating Submission', `Running automated 9-step AI evaluation for "${sub.projectTitle}"...`);

    try {
      const comp = competitions.find((c) => c.id === sub.competitionId);
      const res = await evaluationPipelineService.executePipeline(sub, comp);

      if (res.success && res.report) {
        success(
          'Evaluation Completed',
          `AI Score: ${res.report.overallScore}/${res.report.totalMaxScore} pts. Submission is now unlocked for review.`
        );
        await loadData(selectedCompId);
      } else {
        toastError('Evaluation Issue', res.error || 'Failed to complete automated evaluation.');
      }
    } catch (err: any) {
      toastError('Evaluation Error', err?.message || 'Unexpected evaluation error.');
    } finally {
      setEvaluatingSubId(null);
    }
  };

  const getCompetitionTitle = (compId: string) => {
    const comp = competitions.find((c) => c.id === compId);
    return comp?.title || compId;
  };

  // Map submissions with their assignment for the active judge
  const scopedRows = submissions
    .map((sub) => {
      const asgn = assignments.find(
        (a) => a.submissionId === sub.id && a.judgeId === activeJudgeId
      );
      return {
        submission: sub,
        assignment: asgn,
        isAssignedToActiveJudge: !!asgn,
      };
    })
    .filter((row) => {
      // Permission filtering: In Judge view, show ONLY assigned submissions!
      if (!viewAllOrganizerMode) {
        return row.isAssignedToActiveJudge;
      }
      return true;
    });

  // Calculate Tab Counts
  const assignedCount = scopedRows.length;
  const pendingCount = scopedRows.filter(
    (r) =>
      (!r.assignment || r.assignment.status === 'PENDING') &&
      r.assignment?.status !== 'CONFLICT' &&
      (r.submission.status === 'Ready for Judge Review' || r.submission.status === 'Submitted')
  ).length;
  const inProgressCount = scopedRows.filter(
    (r) => r.assignment?.status === 'IN_PROGRESS' || r.submission.status === 'Under Human Review'
  ).length;
  const completedCount = scopedRows.filter(
    (r) => r.assignment?.status === 'COMPLETED' || r.submission.status === 'Evaluated' || r.submission.status === 'Finalized'
  ).length;
  const conflictCount = scopedRows.filter((r) => r.assignment?.status === 'CONFLICT').length;

  const tabs = [
    { id: 'assigned', label: 'All Assigned', count: assignedCount },
    { id: 'pending', label: 'Pending Review', count: pendingCount },
    { id: 'in_progress', label: 'In Progress', count: inProgressCount },
    { id: 'completed', label: 'Completed', count: completedCount },
    { id: 'conflicts', label: 'Conflicts Declared', count: conflictCount },
  ];

  // Filtering by search & tab
  const filteredRows = scopedRows.filter(({ submission, assignment }) => {
    if (activeTab === 'pending') {
      if (assignment?.status === 'CONFLICT') return false;
      if (assignment?.status === 'COMPLETED') return false;
      if (assignment?.status === 'IN_PROGRESS') return false;
    }
    if (activeTab === 'in_progress') {
      if (assignment?.status !== 'IN_PROGRESS' && submission.status !== 'Under Human Review') {
        return false;
      }
    }
    if (activeTab === 'completed') {
      if (assignment?.status !== 'COMPLETED' && submission.status !== 'Evaluated' && submission.status !== 'Finalized') {
        return false;
      }
    }
    if (activeTab === 'conflicts') {
      if (assignment?.status !== 'CONFLICT') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        submission.projectTitle.toLowerCase().includes(q) ||
        (submission.teamName && submission.teamName.toLowerCase().includes(q)) ||
        submission.primaryContactName.toLowerCase().includes(q) ||
        submission.referenceId.toLowerCase().includes(q) ||
        getCompetitionTitle(submission.competitionId).toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Multi-Select Handlers
  const toggleSelect = (id: string) => {
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedSubIds.size === filteredRows.length && filteredRows.length > 0) {
      setSelectedSubIds(new Set());
    } else {
      setSelectedSubIds(new Set(filteredRows.map((r) => r.submission.id)));
    }
  };

  // High-Speed Parallel Batch AI Evaluation
  const handleBatchEvaluate = async () => {
    if (selectedSubIds.size === 0) return;
    const targetSubmissions = submissions.filter((s) => selectedSubIds.has(s.id));
    if (targetSubmissions.length === 0) return;

    setIsBatchEvaluating(true);
    setBatchProgress({ current: 0, total: targetSubmissions.length });
    info('Batch Evaluation Started', `Running high-speed AI evaluation on ${targetSubmissions.length} project(s)...`);

    let done = 0;
    let failed = 0;

    const chunkSize = 3;
    for (let i = 0; i < targetSubmissions.length; i += chunkSize) {
      const chunk = targetSubmissions.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (sub) => {
          try {
            const comp = competitions.find((c) => c.id === sub.competitionId);
            const res = await evaluationPipelineService.executePipeline(sub, comp);
            if (res.success) done++;
            else failed++;
          } catch (err) {
            console.error('Batch evaluation error for submission:', sub.id, err);
            failed++;
          } finally {
            setBatchProgress({
              current: done + failed,
              total: targetSubmissions.length,
              currentTitle: sub.projectTitle,
            });
          }
        })
      );
    }

    setIsBatchEvaluating(false);
    setBatchProgress(null);
    setSelectedSubIds(new Set());
    await loadData(selectedCompId);

    success(
      'Batch AI Evaluation Completed',
      `Processed ${done} submission(s) successfully.${failed > 0 ? ` (${failed} issues)` : ''}`
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assignments"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <select
              aria-label="Reviewer persona"
              value={activeJudgeId}
              onChange={(e) => setActiveJudgeId(e.target.value)}
              className="text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600 dark:focus:border-blue-400 cursor-pointer"
            >
              {judges.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>

            <select
              id="comp-select"
              value={selectedCompId}
              onChange={handleCompetitionChange}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600 dark:focus:border-blue-400 cursor-pointer"
            >
              <option value="ALL">All competitions ({competitions.length})</option>
              {competitions.map((comp) => (
                <option key={comp.id} value={comp.id}>
                  {comp.title}
                </option>
              ))}
            </select>

            <Button
              variant={viewAllOrganizerMode ? 'primary' : 'outline'}
              size="xs"
              onClick={() => setViewAllOrganizerMode(!viewAllOrganizerMode)}
              title="Toggle organizer panel oversight view"
            >
              {viewAllOrganizerMode ? 'All submissions' : 'My queue'}
            </Button>

            <Button
              variant="outline"
              size="xs"
              onClick={() => loadData(selectedCompId)}
              disabled={loading}
              title="Refresh submissions"
            >
              <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Assigned</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 font-mono mt-0.5">{assignedCount}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Pending</p>
          <p className="text-lg font-semibold text-amber-700 dark:text-amber-400 font-mono mt-0.5">{pendingCount}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Completed</p>
          <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400 font-mono mt-0.5">{completedCount}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Conflicts</p>
          <p className="text-lg font-semibold text-rose-600 dark:text-rose-400 font-mono mt-0.5">{conflictCount}</p>
        </div>
      </div>

      {/* Tabs and Filters */}
      <div className="space-y-4">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by project, team, contact..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 dark:focus:border-blue-400 font-medium transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {selectedSubIds.size > 0 && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Play size={13} fill="currentColor" />}
                onClick={handleBatchEvaluate}
                disabled={isBatchEvaluating}
              >
                Evaluate Selected ({selectedSubIds.size})
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Batch Progress Bar */}
      {isBatchEvaluating && batchProgress && (
        <Card className="bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-blue-900 dark:text-blue-200">
                Running Automated Evaluation ({batchProgress.current} / {batchProgress.total})
              </span>
              <span className="text-blue-700 dark:text-blue-300 font-mono">
                {Math.round((batchProgress.current / batchProgress.total) * 100)}%
              </span>
            </div>
            <div className="w-full bg-blue-200 dark:bg-blue-950 h-2 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 dark:bg-blue-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </Card>
      )}

      {/* Submissions Table */}
      <Card className="border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-2xs bg-white dark:bg-slate-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={selectedSubIds.size === filteredRows.length && filteredRows.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </TableHead>
              <TableHead>Project Title & Artifacts</TableHead>
              <TableHead>Team & Submitter</TableHead>
              <TableHead>Track & Deadline</TableHead>
              <TableHead>AI Evaluation</TableHead>
              <TableHead>Assignment Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-xs text-slate-400 dark:text-slate-500">
                  Loading assigned submissions...
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-xs text-slate-400 dark:text-slate-500">
                  No submissions found matching the current filter.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map(({ submission, assignment }) => {
                const gateCheck = submissionLifecycleService.canJudgeReviewSubmission(submission);
                const isSelected = selectedSubIds.has(submission.id);
                const isConflict = assignment?.status === 'CONFLICT';
                const isCompleted = assignment?.status === 'COMPLETED' || submission.status === 'Evaluated';

                return (
                  <TableRow
                    key={submission.id}
                    className={
                      isConflict
                        ? 'bg-rose-50/40 dark:bg-rose-500/10'
                        : isSelected
                        ? 'bg-blue-50/40 dark:bg-blue-500/10'
                        : undefined
                    }
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(submission.id)}
                        className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/judge/review?id=${submission.id}`}
                            className={`font-semibold text-sm hover:underline ${
                              isConflict ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {submission.projectTitle}
                          </Link>
                          {assignment?.deadline && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              Due: {new Date(assignment.deadline).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-md">
                          {submission.projectDescription}
                        </p>
                        <div className="flex items-center gap-3 pt-0.5">
                          {submission.githubUrl && (
                            <a
                              href={submission.githubUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 transition-colors"
                            >
                              <GithubIcon size={12} />
                              <span>Repository</span>
                            </a>
                          )}
                          {submission.deploymentUrl && (
                            <a
                              href={submission.deploymentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
                            >
                              <Globe size={12} />
                              <span>Live Demo</span>
                            </a>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                          {submission.teamName || submission.primaryContactName}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 text-[11px] font-mono">
                          {submission.referenceId}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        <span className="text-[11px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 font-medium inline-block">
                          {submission.track || 'General'}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-mono">
                          {getCompetitionTitle(submission.competitionId)}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      {submission.aiScore !== undefined ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-500/30">
                            {submission.aiScore} / 100
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Dossier Ready</span>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="xs"
                          leftIcon={<Sparkles size={11} className="text-blue-600 dark:text-blue-400" />}
                          onClick={() => handleQuickEvaluate(submission)}
                          disabled={evaluatingSubId === submission.id}
                        >
                          {evaluatingSubId === submission.id ? 'Evaluating...' : 'Run AI Pre-Eval'}
                        </Button>
                      )}
                    </TableCell>

                    <TableCell>
                      {isConflict ? (
                        <Badge variant="danger" size="sm" dot>
                          Conflict Declared
                        </Badge>
                      ) : (
                        <Badge
                          variant={
                            assignment?.status === 'COMPLETED' || submission.status === 'Evaluated'
                              ? 'success'
                              : assignment?.status === 'IN_PROGRESS' || submission.status === 'Under Human Review'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                          dot
                        >
                          {assignment?.status || submission.status}
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      {isConflict ? (
                        <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 italic">
                          Recused (Conflict)
                        </span>
                      ) : isCompleted ? (
                        <Link to={`/judge/review?id=${submission.id}`}>
                          <Button variant="outline" size="xs">
                            View Scorecard
                          </Button>
                        </Link>
                      ) : gateCheck.allowed ? (
                        <Link to={`/judge/review?id=${submission.id}`}>
                          <Button variant="primary" size="xs" rightIcon={<ChevronRight size={12} />}>
                            Evaluate
                          </Button>
                        </Link>
                      ) : (
                        <Button
                          variant="outline"
                          size="xs"
                          leftIcon={<Sparkles size={11} />}
                          onClick={() => handleQuickEvaluate(submission)}
                          disabled={evaluatingSubId === submission.id}
                        >
                          Pre-Eval Gate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
