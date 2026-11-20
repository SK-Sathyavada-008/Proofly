// ─────────────────────────────────────────────
// OrganizerJudgesPage.tsx — Judge Coordination, Workload Tracking & Submission Assignment
// Proofly / Evalora — Phase 7 Human Judging Workspace
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  Plus,
  ArrowRightLeft,
  ShieldAlert,
  Target,
  Scale,
  CheckCircle2,
  Eye,
  Award,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { judgeAssignmentService } from '../../services/judgeAssignmentService';
import { submissionService } from '../../services/submissionService';
import { competitionService } from '../../services/competitionService';
import { authorizationService } from '../../services/authorizationService';
import { invitationService } from '../../services/invitationService';
import { calibrationAndDisagreementService } from '../../services/calibrationAndDisagreementService';
import { AdjudicationModal } from '../../components/adjudication/AdjudicationModal';
import { CreateCalibrationModal } from '../../components/calibration/CreateCalibrationModal';
import type {
  JudgeRecord,
  JudgeAssignment,
  JudgeWorkloadSummary,
} from '../../types/judgeAndEvaluation';
import type { ProjectSubmission } from '../../types/submission';
import type { Competition } from '../../types/authAndCompetition';
import type {
  CalibrationExercise,
  CriterionDisagreement,
  SubmissionDisagreementAnalysis,
  CompetitionDisagreementAnalytics,
  DisputeSeverity,
} from '../../types/calibrationAndDisagreement';

export const OrganizerJudgesPage: React.FC = () => {
  const { currentUser, verifiedSession, activeOrganization } = useProoflyAuth();
  const { success, warning, error: toastError } = useToast();

  const [activeSubTab, setActiveSubTab] = useState<'panel' | 'calibration' | 'disagreement'>('panel');

  const [judges, setJudges] = useState<JudgeRecord[]>([]);
  const [workloads, setWorkloads] = useState<JudgeWorkloadSummary[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string>('ALL');
  const [allSubmissions, setAllSubmissions] = useState<ProjectSubmission[]>([]);
  const [allAssignments, setAllAssignments] = useState<JudgeAssignment[]>([]);
  const [, setLoading] = useState(true);

  // Calibration State
  const [calibrationExercises, setCalibrationExercises] = useState<CalibrationExercise[]>([]);
  const [createCalibrationModalOpen, setCreateCalibrationModalOpen] = useState(false);
  const [selectedExerciseForDetail, setSelectedExerciseForDetail] = useState<CalibrationExercise | null>(null);

  // Disagreement State
  const [disagreementAnalyses, setDisagreementAnalyses] = useState<SubmissionDisagreementAnalysis[]>([]);
  const [disagreementAnalytics, setDisagreementAnalytics] = useState<CompetitionDisagreementAnalytics | null>(null);
  const [adjudicationModalOpen, setAdjudicationModalOpen] = useState(false);
  const [selectedDisagreementAnalysis, setSelectedDisagreementAnalysis] = useState<SubmissionDisagreementAnalysis | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'ALL' | DisputeSeverity>('ALL');

  // Invite / Add Judge Modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [judgeName, setJudgeName] = useState('');
  const [judgeEmail, setJudgeEmail] = useState('');
  const [judgeTitle, setJudgeTitle] = useState('');
  const [judgeOrg, setJudgeOrg] = useState('');
  const [judgeTracks, setJudgeTracks] = useState('Healthcare & Edge AI, Intelligent Agents');
  const [judgeQuota, setJudgeQuota] = useState(10);
  const [judgeCompId, setJudgeCompId] = useState('');

  // Assign Submissions Modal
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [targetJudge, setTargetJudge] = useState<JudgeRecord | null>(null);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
  const [assignDeadline, setAssignDeadline] = useState('2026-11-25');

  // View Judge Assignments Drawer / Modal
  const [viewAssignmentsJudge, setViewAssignmentsJudge] = useState<JudgeRecord | null>(null);
  const [judgeAssignmentsList, setJudgeAssignmentsList] = useState<JudgeAssignment[]>([]);

  // Reassign Modal
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignTargetAsgn, setReassignTargetAsgn] = useState<JudgeAssignment | null>(null);
  const [reassignNewJudgeId, setReassignNewJudgeId] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  const loadAllData = async () => {
    setLoading(true);
    try {
      // 1. Competitions
      const comps = await competitionService.listAllCompetitions();
      setCompetitions(comps);
      if (!judgeCompId && comps.length > 0) {
        setJudgeCompId(comps[0].id);
      }

      // 2. Judges & Workload
      const loadedJudges = await judgeAssignmentService.listJudges(selectedCompId);
      setJudges(loadedJudges);

      const wl = await judgeAssignmentService.getJudgeWorkload(selectedCompId);
      setWorkloads(wl);

      // 3. Submissions
      const subs = await submissionService.listAllSubmissions();
      setAllSubmissions(subs);

      // 4. Assignments
      const asgns = await judgeAssignmentService.listAssignments({ competitionId: selectedCompId });
      setAllAssignments(asgns);

      // 5. Calibration Exercises
      const exList = await calibrationAndDisagreementService.listCalibrationExercises(selectedCompId);
      setCalibrationExercises(exList);

      // 6. Disagreements & Analytics
      const targetComp = selectedCompId === 'ALL' && comps.length > 0 ? comps[0].id : selectedCompId;
      if (targetComp && targetComp !== 'ALL') {
        const analyses = await calibrationAndDisagreementService.detectCompetitionDisagreements(targetComp);
        setDisagreementAnalyses(analyses);

        const analytics = await calibrationAndDisagreementService.getCompetitionDisagreementAnalytics(targetComp);
        setDisagreementAnalytics(analytics);
      } else {
        setDisagreementAnalyses([]);
        setDisagreementAnalytics(null);
      }
    } catch (err: any) {
      console.warn('Error loading judge coordination data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [selectedCompId]);

  // Handle Invite / Add Judge
  const handleInviteJudge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!judgeName.trim() || !judgeEmail.trim()) {
      warning('Validation Error', 'Name and email are required.');
      return;
    }

    try {
      const parsedTracks = judgeTracks
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (activeOrganization && judgeCompId) {
        await authorizationService.assertAuthorized(verifiedSession, {
          operation: 'JUDGE_INVITE_OR_ASSIGN',
          organizationId: activeOrganization.id,
          competitionId: judgeCompId,
        });
      } else if (activeOrganization) {
        await authorizationService.assertAuthorized(verifiedSession, {
          operation: 'ORG_MEMBER_MANAGE',
          organizationId: activeOrganization.id,
        });
      }

      const newJudge = await judgeAssignmentService.inviteJudge({
        organizationId: activeOrganization?.id,
        name: judgeName.trim(),
        email: judgeEmail.trim(),
        title: judgeTitle.trim() || 'Domain Specialist',
        organization: judgeOrg.trim() || 'External Evaluation Panel',
        assignedTracks: parsedTracks.length > 0 ? parsedTracks : ['General'],
        competitionIds: judgeCompId ? [judgeCompId] : [],
        maxQuota: Number(judgeQuota) || 8,
      });

      let inviteHint = '';
      if (verifiedSession && activeOrganization && judgeCompId) {
        const invite = await invitationService.createInvitation(verifiedSession, {
          targetType: 'COMPETITION',
          organizationId: activeOrganization.id,
          competitionId: judgeCompId,
          email: judgeEmail.trim(),
          role: 'JUDGE',
        });
        inviteHint = ` Invite URL: ${window.location.origin}/auth?invite=${invite.id}`;
      }

      success(
        'Judge Invited Successfully',
        `Scoped JUDGE invitation created for ${newJudge.email}.${inviteHint}`
      );
      setInviteModalOpen(false);
      setJudgeName('');
      setJudgeEmail('');
      setJudgeTitle('');
      setJudgeOrg('');
      await loadAllData();
    } catch (err: any) {
      toastError('Invitation Failed', err?.message || 'Could not invite judge.');
    }
  };

  // Add current organizer as active judge
  const handleAddMyselfAsJudge = async () => {
    if (!currentUser) return;
    try {
      const targetCompId = selectedCompId === 'ALL' ? (competitions[0]?.id || '') : selectedCompId;
      await judgeAssignmentService.inviteJudge({
        id: currentUser.uid,
        organizationId: activeOrganization?.id,
        name: currentUser.displayName || 'Lead Organizer & Judge',
        email: currentUser.email || '',
        title: 'Competition Organizer & Lead Judge',
        organization: activeOrganization?.name || 'Organizer Panel',
        assignedTracks: ['General', 'All Tracks'],
        competitionIds: targetCompId ? [targetCompId] : (competitions.map((c) => c.id)),
        maxQuota: 25,
      });

      success(
        'Added as Judge',
        `You (${currentUser.displayName || currentUser.email}) are now registered as an active judge for this competition.`
      );
      await loadAllData();
    } catch (err: any) {
      toastError('Registration Failed', err?.message || 'Error adding yourself as judge.');
    }
  };

  // Open Assign Submissions Modal
  const openAssignModal = (judge: JudgeRecord) => {
    setTargetJudge(judge);
    setSelectedSubmissionIds([]);
    setAssignModalOpen(true);
  };

  // Execute Submission Assignment
  const handleExecuteAssignment = async () => {
    if (!targetJudge) return;
    if (selectedSubmissionIds.length === 0) {
      warning('No Submissions Selected', 'Please select at least one submission to allocate.');
      return;
    }

    try {
      const targetCompId = selectedCompId === 'ALL' ? (competitions[0]?.id || '') : selectedCompId;
      if (targetCompId) {
        await authorizationService.assertAuthorized(verifiedSession, {
          operation: 'JUDGE_INVITE_OR_ASSIGN',
          organizationId: activeOrganization?.id,
          competitionId: targetCompId,
        });
      }

      const assigned = await judgeAssignmentService.batchAssignSubmissions({
        competitionId: targetCompId,
        submissionIds: selectedSubmissionIds,
        judgeId: targetJudge.id,
        assignedBy: currentUser?.uid || '',
        assignedByName: currentUser?.displayName || 'Organizer',
        deadline: assignDeadline ? new Date(assignDeadline).toISOString() : undefined,
      });

      success(
        'Submissions Allocated',
        `Assigned ${assigned.length} submission(s) to ${targetJudge.name}. Workload quota updated.`
      );
      setAssignModalOpen(false);
      await loadAllData();
    } catch (err: any) {
      toastError('Assignment Error', err?.message || 'Could not assign submissions.');
    }
  };

  // View Judge Assignments
  const openViewAssignments = async (judge: JudgeRecord) => {
    setViewAssignmentsJudge(judge);
    const asgns = await judgeAssignmentService.listAssignments({ judgeId: judge.id });
    setJudgeAssignmentsList(asgns);
  };

  // Open Reassign Modal
  const openReassignModal = (asgn: JudgeAssignment) => {
    setReassignTargetAsgn(asgn);
    setReassignNewJudgeId('');
    setReassignReason(
      asgn.status === 'CONFLICT'
        ? `Resolving declared conflict of interest: ${asgn.conflict?.reason || 'Judge declared conflict'}`
        : 'Reallocating submission to balance panel review workload.'
    );
    setReassignModalOpen(true);
  };

  // Execute Reassignment
  const handleExecuteReassignment = async () => {
    if (!reassignTargetAsgn || !reassignNewJudgeId) {
      warning('Incomplete Information', 'Please select a replacement judge.');
      return;
    }

    try {
      await authorizationService.assertAuthorized(verifiedSession, {
        operation: 'JUDGE_INVITE_OR_ASSIGN',
        organizationId: activeOrganization?.id,
        competitionId: reassignTargetAsgn.competitionId,
      });

      const updated = await judgeAssignmentService.reassignSubmission(
        reassignTargetAsgn.id,
        reassignNewJudgeId,
        currentUser?.uid || '',
        currentUser?.displayName || 'Organizer',
        reassignReason
      );

      success(
        'Submission Reassigned',
        `Successfully transferred "${updated.projectTitle}" to ${updated.judgeName}. Reassignment audit trail recorded.`
      );
      setReassignModalOpen(false);

      if (viewAssignmentsJudge) {
        const asgns = await judgeAssignmentService.listAssignments({ judgeId: viewAssignmentsJudge.id });
        setJudgeAssignmentsList(asgns);
      }
      await loadAllData();
    } catch (err: any) {
      toastError('Reassignment Failed', err?.message || 'Could not reassign submission.');
    }
  };

  // Workload aggregates
  const totalJudgesCount = judges.length;
  const totalAssignedSubmissions = allAssignments.length;
  const totalCompletedReviews = allAssignments.filter((a) => a.status === 'COMPLETED').length;
  const totalInProgressReviews = allAssignments.filter((a) => a.status === 'IN_PROGRESS').length;
  const totalConflictsDeclared = allAssignments.filter((a) => a.status === 'CONFLICT').length;

  const filteredDisagreements = disagreementAnalyses.filter((ana) => {
    if (severityFilter === 'ALL') return true;
    return ana.disputeSeverity === severityFilter;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Judges & Evaluation Quality"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={selectedCompId}
              onChange={(e) => setSelectedCompId(e.target.value)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded-md px-2.5 py-1.5 font-medium text-slate-700 dark:text-slate-200 focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All competitions</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            {activeSubTab === 'calibration' ? (
              <Button
                variant="primary"
                size="xs"
                leftIcon={<Plus size={13} />}
                onClick={() => setCreateCalibrationModalOpen(true)}
              >
                Create exercise
              </Button>
            ) : (
              <>
                {currentUser && !judges.some((j) => j.id === currentUser.uid || j.email.toLowerCase() === currentUser.email?.toLowerCase()) && (
                  <Button
                    variant="outline"
                    size="xs"
                    leftIcon={<Plus size={13} />}
                    onClick={handleAddMyselfAsJudge}
                  >
                    Add myself as judge
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="xs"
                  leftIcon={<Plus size={13} />}
                  onClick={() => setInviteModalOpen(true)}
                >
                  Invite judge
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Sub-Tabs Switcher */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-6 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveSubTab('panel')}
          className={`pb-2.5 border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'panel'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          Judges Panel & Workload
          <Badge variant="outline" size="sm">
            {judges.length}
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('calibration')}
          className={`pb-2.5 border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'calibration'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          Calibration Exercises
          <Badge variant="outline" size="sm">
            {calibrationExercises.length}
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('disagreement')}
          className={`pb-2.5 border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'disagreement'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          Disagreement & Adjudication
          {disagreementAnalyses.filter((a) => a.isOverallDisputed).length > 0 && (
            <Badge variant="danger" size="sm">
              {disagreementAnalyses.filter((a) => a.isOverallDisputed).length} disputed
            </Badge>
          )}
        </button>
      </div>

      {activeSubTab === 'panel' && (
        <div className="space-y-5">

      <div className="grid grid-cols-2 sm:grid-cols-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Judges</p>
          <p className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100 mt-0.5">{totalJudgesCount}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Assigned</p>
          <p className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100 mt-0.5">{totalAssignedSubmissions}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">In progress</p>
          <p className="text-lg font-semibold font-mono text-amber-700 dark:text-amber-400 mt-0.5">{totalInProgressReviews}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Completed</p>
          <p className="text-lg font-semibold font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">{totalCompletedReviews}</p>
        </div>
        <div className="p-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Conflicts</p>
          <p className="text-lg font-semibold font-mono text-rose-600 dark:text-rose-400 mt-0.5">{totalConflictsDeclared}</p>
        </div>
      </div>

      <Card className="border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900">
        <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-900 dark:text-slate-100">Panel</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{judges.length} active</span>
        </CardHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Judge & Institution</TableHead>
              <TableHead>Assigned Tracks</TableHead>
              <TableHead>Workload & Quota</TableHead>
              <TableHead>Progress Velocity</TableHead>
              <TableHead>Status & Conflicts</TableHead>
              <TableHead className="text-right">Coordination Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {judges.map((judge) => {
              const wl = workloads.find((w) => w.judgeId === judge.id);
              const total = wl?.totalAssigned || 0;
              const completed = wl?.completedReviews || 0;
              const inProgress = wl?.inProgressReviews || 0;
              const conflicts = wl?.conflictsDeclared || 0;
              const quota = judge.maxQuota || 10;
              const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
              const quotaUsagePct = Math.min(100, Math.round((total / quota) * 100));

              return (
                <TableRow key={judge.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <img
                        src={
                          judge.avatarUrl ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(judge.name)}&background=2563eb&color=fff`
                        }
                        alt={judge.name}
                        className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700 shrink-0"
                      />
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm block">
                          {judge.name}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {judge.title} · {judge.organization}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 block">
                          {judge.email}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {judge.assignedTracks.map((t, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 font-medium"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {total} / {quota}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 text-[10px]">
                          {quotaUsagePct}% capacity
                        </span>
                      </div>
                      <div className="w-28 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            quotaUsagePct >= 90 ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-400'
                          }`}
                          style={{ width: `${quotaUsagePct}%` }}
                        />
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-700 dark:text-slate-300">
                          {completed} done · {inProgress} drafting
                        </span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">{pct}%</span>
                      </div>
                      <div className="w-28 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-600 dark:bg-emerald-400 h-full rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={judge.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm" dot>
                        {judge.status}
                      </Badge>
                      {conflicts > 0 && (
                        <Badge variant="danger" size="sm">
                          {conflicts} Conflict{conflicts > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => openViewAssignments(judge)}
                      >
                        Assignments ({total})
                      </Button>
                      <Button
                        variant="primary"
                        size="xs"
                        leftIcon={<Plus size={12} />}
                        onClick={() => openAssignModal(judge)}
                      >
                        Allocate
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
        </div>
      )}

      {/* ── SUB-TAB 2: CALIBRATION EXERCISES ── */}
      {activeSubTab === 'calibration' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-500" />
                Judge Calibration & Benchmark Exercises
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Standardize human evaluation criteria. Reference scores and justifications remain strictly blinded to judges until submission.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={() => setCreateCalibrationModalOpen(true)}
            >
              Create Calibration Exercise
            </Button>
          </div>

          {calibrationExercises.length === 0 ? (
            <Card className="p-8 text-center bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
              <div className="max-w-md mx-auto space-y-3">
                <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
                  <Target className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  No Calibration Exercises Created
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Create a sample submission exercise with hidden benchmark scores to measure judge consistency and identify rubric confusion before official scoring begins.
                </p>
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => setCreateCalibrationModalOpen(true)}
                >
                  Create First Exercise
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {calibrationExercises.map((ex) => (
                <Card
                  key={ex.id}
                  className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex flex-col justify-between"
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <Badge variant="outline" size="sm">
                        {ex.competitionId}
                      </Badge>
                      <Badge
                        variant={ex.status === 'ACTIVE' ? 'success' : 'neutral'}
                        size="sm"
                      >
                        {ex.status}
                      </Badge>
                    </div>
                    <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {ex.title}
                    </CardTitle>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                      {ex.description}
                    </p>
                  </CardHeader>
                  <CardContent className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300 block">
                        Sample Project: {ex.sampleProject.title}
                      </span>
                      <span className="text-slate-400 text-[11px] block mt-0.5">
                        Track: {ex.sampleProject.track} · {ex.sampleProject.artifacts?.length || 0} artifacts · {ex.rubric.length} criteria
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400">
                        Created {new Date(ex.createdAt).toLocaleDateString()}
                      </span>
                      <Button
                        variant="outline"
                        size="xs"
                        leftIcon={<Eye className="w-3.5 h-3.5" />}
                        onClick={() => setSelectedExerciseForDetail(ex)}
                      >
                        Inspect Benchmarks
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SUB-TAB 3: DISAGREEMENT & ADJUDICATION ── */}
      {activeSubTab === 'disagreement' && (
        <div className="space-y-4">
          {/* Analytics Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Evaluated Projects</p>
              <p className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100 mt-0.5">
                {disagreementAnalytics?.totalSubmissionsReviewed ?? 0}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Panel Consensus</p>
              <p className="text-lg font-semibold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {disagreementAnalytics && disagreementAnalytics.totalSubmissionsReviewed > 0
                  ? `${Math.round((disagreementAnalytics.consensusSubmissionsCount / disagreementAnalytics.totalSubmissionsReviewed) * 100)}%`
                  : '100%'}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Disputed Submissions</p>
              <p className="text-lg font-semibold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
                {disagreementAnalytics?.disputedSubmissionsCount ?? 0}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Mean Score Variance</p>
              <p className="text-lg font-semibold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">
                {disagreementAnalytics?.meanPanelVariance.toFixed(2) ?? '0.00'}
              </p>
            </div>
          </div>

          {/* Table Header & Filter */}
          <Card className="border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Scale className="w-4 h-4 text-amber-500" />
                  Score Disagreement & Variance Studio
                </CardTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Flags high variance, contradictory marks, and missing reviews across human evaluations. Original evaluations are strictly preserved.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Severity:</span>
                {(['ALL', 'CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'NONE'] as const).map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setSeverityFilter(sev)}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                      severityFilter === sev
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </CardHeader>

            {filteredDisagreements.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  No Disagreements Detected
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  All multi-judge evaluations are within the configured variance threshold.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Submission</TableHead>
                    <TableHead>Reviewers</TableHead>
                    <TableHead>Score Spread</TableHead>
                    <TableHead>Variance (s²)</TableHead>
                    <TableHead>Disputed Criteria</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Adjudication</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDisagreements.map((ana) => {
                    const disputedCriteriaNames = ana.criterionDisagreements
                      .filter((c: CriterionDisagreement) => c.isDisputed)
                      .map((c: CriterionDisagreement) => c.criterionName);

                    const judgeTotalScores = ana.judges.map((j) => j.totalScore);
                    const minScore = judgeTotalScores.length > 0 ? Math.min(...judgeTotalScores) : 0;
                    const maxScore = judgeTotalScores.length > 0 ? Math.max(...judgeTotalScores) : 0;

                    return (
                      <TableRow key={ana.submissionId}>
                        <TableCell>
                          <div>
                            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 block">
                              {ana.projectTitle}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">
                              {ana.referenceId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                              {ana.completedJudgesCount}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              / {ana.assignedJudgesCount} judges
                            </span>
                            {ana.hasMissingEvaluations && (
                              <Badge variant="warning" size="sm">
                                Missing
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {minScore.toFixed(1)} – {maxScore.toFixed(1)}
                            </span>
                            <span className="text-slate-400 text-[11px] block">
                              Avg: {ana.overallMeanScore.toFixed(1)} (Δ {ana.overallScoreSpread.toFixed(1)})
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`font-mono text-xs font-semibold ${
                              ana.overallVariance >= 15
                                ? 'text-rose-600 dark:text-rose-400'
                                : ana.overallVariance >= 8
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {ana.overallVariance.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {disputedCriteriaNames.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {disputedCriteriaNames.map((name: string) => (
                                <Badge key={name} variant="danger" size="sm">
                                  {name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              ana.disputeSeverity === 'CRITICAL'
                                ? 'danger'
                                : ana.disputeSeverity === 'HIGH'
                                ? 'warning'
                                : ana.disputeSeverity === 'MODERATE'
                                ? 'warning'
                                : 'neutral'
                            }
                            size="sm"
                          >
                            {ana.disputeSeverity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              ana.adjudicationStatus === 'ADJUDICATED'
                                ? 'success'
                                : ana.adjudicationStatus === 'CLARIFICATION_REQUESTED'
                                ? 'warning'
                                : 'neutral'
                            }
                            size="sm"
                          >
                            {ana.adjudicationStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="primary"
                            size="xs"
                            leftIcon={<Scale className="w-3.5 h-3.5" />}
                            onClick={() => {
                              setSelectedDisagreementAnalysis(ana);
                              setAdjudicationModalOpen(true);
                            }}
                          >
                            Inspect & Adjudicate
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ── 1. INVITE / ADD JUDGE MODAL ── */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Invite Domain Specialist / Judge"
        description="Judges receive direct authenticated access to the split-screen evaluation studio."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setInviteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleInviteJudge}>
              Send Invitation & Access Link
            </Button>
          </>
        }
      >
        <form onSubmit={handleInviteJudge} className="space-y-4">
          <Input
            label="Full Name & Academic / Professional Title"
            required
            placeholder="Full name"
            value={judgeName}
            onChange={(e) => setJudgeName(e.target.value)}
          />
          <Input
            label="Email Address"
            type="email"
            required
            placeholder="judge@institution.edu"
            value={judgeEmail}
            onChange={(e) => setJudgeEmail(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Position / Title"
              placeholder="e.g. Associate Professor"
              value={judgeTitle}
              onChange={(e) => setJudgeTitle(e.target.value)}
            />
            <Input
              label="Institution / Organization"
              placeholder="e.g. Stanford University"
              value={judgeOrg}
              onChange={(e) => setJudgeOrg(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Assigned Competition
            </label>
            <select
              value={judgeCompId}
              onChange={(e) => setJudgeCompId(e.target.value)}
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg px-3 py-2 font-medium text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Domain Specialization Tracks (comma-separated)"
            placeholder="Healthcare & Edge AI, Intelligent Agents, Open Track"
            value={judgeTracks}
            onChange={(e) => setJudgeTracks(e.target.value)}
            helperText="Submissions within these tracks will be prioritized when auto-matching."
          />
          <Input
            label="Maximum Review Quota"
            type="number"
            min={1}
            max={50}
            value={judgeQuota}
            onChange={(e) => setJudgeQuota(parseInt(e.target.value, 10) || 10)}
            helperText="Maximum number of submissions this reviewer can be allocated."
          />
        </form>
      </Modal>

      {/* ── 2. ASSIGN SUBMISSIONS MODAL ── */}
      <Modal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title={`Allocate Submissions to ${targetJudge?.name || 'Judge'}`}
        description="Select submissions to assign. Multiple judges can be assigned to the same submission."
        maxWidth="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setAssignModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selectedSubmissionIds.length === 0}
              onClick={handleExecuteAssignment}
            >
              Allocate {selectedSubmissionIds.length} Submission(s)
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80">
            <div>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{targetJudge?.name}</span>
              <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                Tracks: {targetJudge?.assignedTracks.join(', ')}
              </span>
            </div>
            <div className="text-right">
              <span className="font-mono text-slate-700 dark:text-slate-200 font-bold">
                Quota: {targetJudge?.maxQuota || 10}
              </span>
              <span className="text-slate-400 dark:text-slate-500 block text-[10px]">
                Currently assigned:{' '}
                {allAssignments.filter((a) => a.judgeId === targetJudge?.id).length}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Evaluation Deadline (Optional)
            </label>
            <input
              type="date"
              value={assignDeadline}
              onChange={(e) => setAssignDeadline(e.target.value)}
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg px-3 py-2 font-medium text-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Available Submissions ({allSubmissions.length})
              </label>
              <button
                type="button"
                onClick={() => {
                  if (selectedSubmissionIds.length === allSubmissions.length) {
                    setSelectedSubmissionIds([]);
                  } else {
                    setSelectedSubmissionIds(allSubmissions.map((s) => s.id));
                  }
                }}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
              >
                {selectedSubmissionIds.length === allSubmissions.length
                  ? 'Deselect All'
                  : 'Select All'}
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-700/80 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
              {allSubmissions.map((sub) => {
                const isSelected = selectedSubmissionIds.includes(sub.id);
                const isAlreadyAssigned = allAssignments.some(
                  (a) => a.submissionId === sub.id && a.judgeId === targetJudge?.id
                );
                const matchingTrack = targetJudge?.assignedTracks.some((t) =>
                  sub.track ? sub.track.toLowerCase().includes(t.toLowerCase()) : false
                );

                return (
                  <div
                    key={sub.id}
                    onClick={() => {
                      if (isAlreadyAssigned) return;
                      setSelectedSubmissionIds((prev) =>
                        prev.includes(sub.id) ? prev.filter((id) => id !== sub.id) : [...prev, sub.id]
                      );
                    }}
                    className={`p-3 flex items-center justify-between gap-3 text-xs cursor-pointer transition-colors ${
                      isAlreadyAssigned
                        ? 'bg-slate-50 dark:bg-slate-800/40 opacity-60 cursor-not-allowed'
                        : isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-500/15 border-l-2 border-blue-600 dark:border-blue-400'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected || isAlreadyAssigned}
                        disabled={isAlreadyAssigned}
                        onChange={() => {}}
                        className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{sub.projectTitle}</span>
                          {matchingTrack && (
                            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30">
                              Track Match
                            </span>
                          )}
                          {isAlreadyAssigned && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-400 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                              Already Assigned
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {sub.teamName || sub.primaryContactName} · Track: {sub.track || 'General'}
                        </span>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                      {sub.referenceId}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* ── 3. VIEW ASSIGNMENTS MODAL & CONFLICT RESOLUTION ── */}
      <Modal
        isOpen={!!viewAssignmentsJudge}
        onClose={() => setViewAssignmentsJudge(null)}
        title={`Assignments for ${viewAssignmentsJudge?.name}`}
        description="Monitor status, review conflict declarations, reassign submissions, or update deadlines."
        maxWidth="xl"
      >
        <div className="space-y-4">
          {judgeAssignmentsList.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 dark:text-slate-500">
              No submissions are currently assigned to this judge.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-lg overflow-hidden">
              {judgeAssignmentsList.map((asgn) => {
                const isConflict = asgn.status === 'CONFLICT';

                return (
                  <div key={asgn.id} className="p-4 bg-white dark:bg-slate-900/80 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                            {asgn.projectTitle}
                          </span>
                          <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                            ({asgn.referenceId})
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Track: {asgn.track || 'General'} · Assigned on{' '}
                          {new Date(asgn.assignedAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            asgn.status === 'COMPLETED'
                              ? 'success'
                              : asgn.status === 'IN_PROGRESS'
                              ? 'warning'
                              : asgn.status === 'CONFLICT'
                              ? 'danger'
                              : 'neutral'
                          }
                          size="sm"
                          dot
                        >
                          {asgn.status}
                        </Badge>

                        <Button
                          variant="outline"
                          size="xs"
                          leftIcon={<ArrowRightLeft size={12} />}
                          onClick={() => openReassignModal(asgn)}
                        >
                          Reassign
                        </Button>
                      </div>
                    </div>

                    {/* Conflict Alert Box */}
                    {isConflict && asgn.conflict && (
                      <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg p-3 text-xs text-rose-800 dark:text-rose-200 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <ShieldAlert size={14} className="text-rose-600 dark:text-rose-400 shrink-0" />
                          <span>Conflict of Interest Declared ({asgn.conflict.conflictType})</span>
                        </div>
                        <p className="text-rose-700 dark:text-rose-300 italic">
                          "{asgn.conflict.reason}"
                        </p>
                        <span className="text-[10px] text-rose-500 dark:text-rose-400 block">
                          Declared at {new Date(asgn.conflict.declaredAt).toLocaleString()}
                        </span>
                      </div>
                    )}

                    {/* Reassignment Audit History */}
                    {asgn.reassignmentHistory && asgn.reassignmentHistory.length > 0 && (
                      <div className="bg-slate-50 dark:bg-slate-800/60 rounded p-2 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                        <span className="font-semibold text-slate-700 dark:text-slate-200 block">
                          Reassignment Audit Trail:
                        </span>
                        {asgn.reassignmentHistory.map((h, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 flex-wrap">
                            <span>• Reassigned from {h.previousJudgeName} by {h.reassignedByName}:</span>
                            <span className="italic">"{h.reason}"</span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              ({new Date(h.reassignedAt).toLocaleDateString()})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* ── 4. REASSIGN SUBMISSION MODAL ── */}
      <Modal
        isOpen={reassignModalOpen}
        onClose={() => setReassignModalOpen(false)}
        title="Reassign Submission to Another Judge"
        description="Preserves full audit trail including previous reviewer and documented rationale."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setReassignModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!reassignNewJudgeId}
              onClick={handleExecuteReassignment}
            >
              Confirm Reassignment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs space-y-1">
            <span className="font-semibold text-slate-800 dark:text-slate-100 block">
              Project: {reassignTargetAsgn?.projectTitle}
            </span>
            <span className="text-slate-500 dark:text-slate-400 block">
              Current Reviewer: {reassignTargetAsgn?.judgeName} ({reassignTargetAsgn?.status})
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Select Replacement Judge
            </label>
            <select
              value={reassignNewJudgeId}
              onChange={(e) => setReassignNewJudgeId(e.target.value)}
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg px-3 py-2 font-medium text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select a replacement judge...</option>
              {judges
                .filter((j) => j.id !== reassignTargetAsgn?.judgeId)
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} ({j.organization} - {j.assignedTracks.join(', ')})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Mandatory Reassignment Reason (Audit Record)
            </label>
            <textarea
              required
              rows={3}
              value={reassignReason}
              onChange={(e) => setReassignReason(e.target.value)}
              placeholder="Explain why this submission is being transferred (e.g. resolving conflict of interest, workload balance)..."
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </Modal>

      {/* ── 5. CALIBRATION EXERCISE CREATION MODAL ── */}
      <CreateCalibrationModal
        isOpen={createCalibrationModalOpen}
        onClose={() => setCreateCalibrationModalOpen(false)}
        competitions={competitions}
        selectedCompId={selectedCompId}
        creatorId={currentUser?.uid || 'organizer'}
        creatorName={currentUser?.displayName || 'Organizer'}
        onExerciseCreated={async (ex) => {
          setCalibrationExercises((prev) => [ex, ...prev]);
          await loadAllData();
        }}
      />

      {/* ── 6. ADJUDICATION & DISAGREEMENT MODAL ── */}
      <AdjudicationModal
        isOpen={adjudicationModalOpen}
        onClose={() => {
          setAdjudicationModalOpen(false);
          setSelectedDisagreementAnalysis(null);
        }}
        analysis={selectedDisagreementAnalysis}
        adjudicatorId={currentUser?.uid || 'organizer'}
        adjudicatorName={currentUser?.displayName || 'Organizer Adjudicator'}
        adjudicatorRole="ORGANIZER"
        onAdjudicationSaved={async () => {
          await loadAllData();
        }}
      />

      {/* ── 7. BENCHMARK DETAIL INSPECTION MODAL ── */}
      {selectedExerciseForDetail && (
        <Modal
          isOpen={!!selectedExerciseForDetail}
          onClose={() => setSelectedExerciseForDetail(null)}
          title={`Calibration Benchmarks: ${selectedExerciseForDetail.title}`}
          description="Organizer-only benchmark reference scores and justifications. Hidden from judges until after submission."
          footer={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedExerciseForDetail(null)}
            >
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs space-y-1">
              <span className="font-semibold text-slate-800 dark:text-slate-100 block">
                Sample Project: {selectedExerciseForDetail.sampleProject.title}
              </span>
              <p className="text-slate-500 dark:text-slate-400">
                {selectedExerciseForDetail.sampleProject.description}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                Benchmark Criteria & Justifications
              </h4>
              <div className="space-y-2">
                {selectedExerciseForDetail.rubric.map((c) => {
                  const benchmarkScore = selectedExerciseForDetail.referenceScores[c.id];
                  const benchmarkReason = selectedExerciseForDetail.referenceReasoning[c.id];

                  return (
                    <div
                      key={c.id}
                      className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700/80 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                          {c.name}
                        </span>
                        <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                          {benchmarkScore} / {c.maxScore} pts
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        {benchmarkReason || 'No reference justification documented.'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
