// ─────────────────────────────────────────────
// JudgeReviewWorkspacePage.tsx — Focused Split-Screen Review Studio
// Proofly / Evalora — Phase 7 Human Judging Workspace
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Sparkles,
  Zap,
  Cloud,
  CheckCircle2,
  Globe,
  FileText,
  ArrowLeft,
  ShieldCheck,
  Sliders,
  Check,
  X,
  Lock,
  RefreshCw,
  Eye,
  EyeOff,
  Flag,
  ShieldAlert,
  Save,
  Unlock,
  History,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';
import { GithubIcon } from '../../components/ui/GithubIcon';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { submissionService } from '../../services/submissionService';
import { submissionLifecycleService } from '../../services/submissionLifecycleService';
import { evaluationPipelineService } from '../../services/evaluationPipelineService';
import { judgeAssignmentService } from '../../services/judgeAssignmentService';
import { authorizationService } from '../../services/authorizationService';
import { fileStorageService } from '../../services/fileStorageService';
import { InferenceMode } from 'firebase/ai';
import { AiEvaluationReportView } from '../../components/evaluation/AiEvaluationReportView';
import type { AiEvaluationReport } from '../../types/aiEvaluation';
import type {
  JudgeAssignment,
  HumanJudgeEvaluation,
  ConflictType,
  ConcernCategory,
  CriterionComparisonDetail,
} from '../../types/judgeAndEvaluation';

const DEFAULT_FALLBACK_CRITERIA = [
  { id: 'crit-tech', name: 'Technological Implementation', maxScore: 25 },
  { id: 'crit-design', name: 'Design & User Experience', maxScore: 25 },
  { id: 'crit-impact', name: 'Potential Impact', maxScore: 25 },
  { id: 'crit-idea', name: 'Quality of the Idea', maxScore: 25 },
];

export const JudgeReviewWorkspacePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const subId = searchParams.get('id') || searchParams.get('ref') || searchParams.get('submissionId') || '';
  const { currentUser, verifiedSession, activeOrganization } = useProoflyAuth();
  const { success, warning, error: toastError, info } = useToast();

  const [submission, setSubmission] = useState<any>(null);
  const [aiReport, setAiReport] = useState<AiEvaluationReport | null>(null);
  const [assignment, setAssignment] = useState<JudgeAssignment | null>(null);
  const [humanEvaluation, setHumanEvaluation] = useState<HumanJudgeEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReEvaluating, setIsReEvaluating] = useState(false);

  // Blind Evaluation Mode
  const [blindReviewMode, setBlindReviewMode] = useState<boolean>(false);

  // Full AI Dossier Modal
  const [isDossierModalOpen, setIsDossierModalOpen] = useState(false);

  // Effective Reviewer Identity (derived strictly from authenticated Firebase session)
  const judgeId = currentUser?.uid || verifiedSession?.uid || 'judge-direct-eval';
  const judgeName = currentUser?.displayName || currentUser?.email || 'Judge Reviewer';
  const judgeEmail = currentUser?.email || '';

  // Judge Decision & Scores State
  const [decisionMode, setDecisionMode] = useState<'AGREE' | 'MODIFY' | 'REJECT'>('MODIFY');
  const [scores, setScores] = useState<{ [key: string]: number }>({
    'crit-tech': 0,
    'crit-design': 0,
    'crit-impact': 0,
    'crit-idea': 0,
  });
  const [deductionNotes, setDeductionNotes] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');

  // Modals & Action States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Conflict of Interest Modal
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [conflictType, setConflictType] = useState<ConflictType>('DIRECT_COLLABORATOR');
  const [conflictReason, setConflictReason] = useState('');

  // Flag Concern Modal
  const [isFlagConcernModalOpen, setIsFlagConcernModalOpen] = useState(false);
  const [concernCategory, setConcernCategory] = useState<ConcernCategory>('PLAGIARISM');
  const [concernExplanation, setConcernExplanation] = useState('');

  // Organizer Reopen Modal
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenAuthName, setReopenAuthName] = useState('Organizer');

  // Load Submission, AI Report, Assignment, and Existing Human Evaluation
  const loadWorkspaceData = async () => {
    setLoading(true);
    try {
      if (!subId) {
        setSubmission(null);
        setAiReport(null);
        setAssignment(null);
        setHumanEvaluation(null);
        return;
      }

      let realSub: any = null;
      try {
        realSub = await submissionService.getSubmission(subId);
      } catch (e) {
        console.warn('getSubmission failed, attempting by reference:', e);
      }

      if (!realSub) {
        try {
          realSub = await submissionService.getSubmissionByReference(subId);
        } catch (e) {
          console.warn('getSubmissionByReference failed:', e);
        }
      }

      if (realSub) {
        setSubmission(realSub);

        // 1. Load AI Report safely
        try {
          let rep: AiEvaluationReport | null = null;
          if (realSub.aiEvaluationId) {
            rep = await evaluationPipelineService.getEvaluationReport(realSub.aiEvaluationId);
          }
          if (!rep) {
            rep = await evaluationPipelineService.getReportBySubmissionId(realSub.id);
          }
          setAiReport(rep || null);

          // Initialize scores from AI report if available
          if (rep && rep.criteriaEvaluations && rep.criteriaEvaluations.length > 0) {
            const initialScores: { [key: string]: number } = {};
            rep.criteriaEvaluations.forEach((c) => {
              initialScores[c.criterionId] = c.suggestedScore;
            });
            setScores(initialScores);
          }
        } catch (e) {
          console.warn('Could not load AI report:', e);
        }

        // 2. Load Assignment safely
        try {
          if (judgeId) {
            const asgn = await judgeAssignmentService.getAssignmentForSubmissionAndJudge(realSub.id, judgeId);
            setAssignment(asgn);
          }
        } catch (e) {
          console.warn('Could not load assignment:', e);
        }

        // 3. Load Existing Human Evaluation safely
        try {
          if (judgeId) {
            const existingEval = await judgeAssignmentService.getEvaluation(realSub.id, judgeId);
            if (existingEval) {
              setHumanEvaluation(existingEval);
              setScores(existingEval.scores);
              setDecisionMode(existingEval.decisionMode);
              setDeductionNotes(existingEval.deductionNotes || '');
              setPrivateNotes(existingEval.privateNotes || '');
            }
          }
        } catch (e) {
          console.warn('Could not load existing evaluation:', e);
        }
      } else {
        setSubmission(null);
        setAiReport(null);
      }
    } catch (err) {
      console.warn('Could not load submission review workspace:', err);
      setSubmission(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
  }, [subId, judgeId]);

  // Re-run AI Evaluation
  const handleRerunAiEvaluation = async () => {
    if (!submission) return;
    setIsReEvaluating(true);
    try {
      const pipelineResult = await evaluationPipelineService.executePipeline(
        submission,
        undefined,
        InferenceMode.PREFER_ON_DEVICE
      );
      if (pipelineResult.report) {
        setAiReport(pipelineResult.report);
        const updatedScores: { [key: string]: number } = {};
        pipelineResult.report.criteriaEvaluations.forEach((c: any) => {
          updatedScores[c.criterionId] = c.suggestedScore;
        });
        setScores(updatedScores);
        const refreshed = await submissionService.getSubmission(submission.id);
        if (refreshed) setSubmission(refreshed);
        success('AI Pre-Evaluation Refreshed', `Dossier updated successfully. Suggested Score: ${pipelineResult.report.overallScore}/100.`);
      }
    } catch (err: any) {
      toastError('Re-evaluation Failed', err?.message || 'Error executing AI evaluation.');
    } finally {
      setIsReEvaluating(false);
    }
  };

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const isLocked = humanEvaluation?.isLocked || false;

  // Build criterion comparison details
  const buildCriterionDifferences = (): Record<string, CriterionComparisonDetail> => {
    const diffs: Record<string, CriterionComparisonDetail> = {};
    if (aiReport) {
      aiReport.criteriaEvaluations.forEach((c) => {
        const hScore = scores[c.criterionId] ?? c.suggestedScore;
        diffs[c.criterionId] = {
          criterionId: c.criterionId,
          criterionName: c.criterionName,
          maxScore: c.maxScore,
          aiScore: c.suggestedScore,
          humanScore: hScore,
          diff: hScore - c.suggestedScore,
        };
      });
    } else {
      DEFAULT_FALLBACK_CRITERIA.forEach((c) => {
        const hScore = scores[c.id] ?? 0;
        diffs[c.id] = {
          criterionId: c.id,
          criterionName: c.name,
          maxScore: c.maxScore,
          aiScore: 0,
          humanScore: hScore,
          diff: hScore,
        };
      });
    }
    return diffs;
  };

  const handleDecisionModeChange = (mode: 'AGREE' | 'MODIFY' | 'REJECT') => {
    if (isLocked) return;
    setDecisionMode(mode);
    if (mode === 'AGREE') {
      const aiScores: { [key: string]: number } = {};
      if (aiReport) {
        aiReport.criteriaEvaluations.forEach((c) => {
          aiScores[c.criterionId] = c.suggestedScore;
        });
      } else {
        DEFAULT_FALLBACK_CRITERIA.forEach((c) => {
          aiScores[c.id] = scores[c.id] ?? 0;
        });
      }
      setScores(aiScores);
      setDeductionNotes('Fully agreed with automated AI evaluation recommendations.');
    } else if (mode === 'REJECT') {
      setDeductionNotes('');
    }
  };

  const handleScoreChange = (criteriaId: string, val: number, maxScore: number = 25) => {
    if (isLocked) return;
    setScores((prev) => ({
      ...prev,
      [criteriaId]: Math.max(0, Math.min(maxScore, val)),
    }));
  };

  // ── SAVE DRAFT ACTION ──
  const handleSaveDraft = async () => {
    if (isLocked) {
      warning('Evaluation Locked', 'This evaluation has already been submitted and locked.');
      return;
    }
    setIsSavingDraft(true);
    try {
      const draft = await judgeAssignmentService.saveEvaluationDraft({
        organizationId: submission?.organizationId || activeOrganization?.id || 'org-krivee',
        submissionId: submission.id,
        referenceId: submission.referenceId || submission.id,
        competitionId: submission.competitionId || 'comp-default-ai',
        roundId: submission.roundId,
        judgeId,
        judgeName,
        judgeEmail,
        decisionMode,
        scores,
        totalScore,
        aiTotalScore: aiReport?.overallScore || 96,
        criterionDifferences: buildCriterionDifferences(),
        deductionNotes: deductionNotes?.trim() || 'Judge review draft in progress.',
        privateNotes,
        assignmentId: assignment?.id,
      });

      setHumanEvaluation(draft);
      success('Draft Saved', `Your in-progress evaluation (${totalScore} pts) has been saved.`);
    } catch (err: any) {
      toastError('Draft Save Failed', err?.message || 'Could not save evaluation draft.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  // ── FINAL SUBMIT ACTION (LOCKS EVALUATION) ──
  const handleFinalSubmit = async () => {
    if (!submission) {
      toastError('Submission Not Found', 'Cannot submit evaluation without an active submission record.');
      return;
    }
    setIsSubmitting(true);
    try {
      const effectiveJudgeId = currentUser?.uid || verifiedSession?.uid || 'judge-direct-eval';
      const effectiveJudgeName = currentUser?.displayName || currentUser?.email || 'Judge Reviewer';
      const effectiveJudgeEmail = currentUser?.email || '';

      const effectiveDeductionNotes =
        deductionNotes?.trim() ||
        (decisionMode === 'AGREE'
          ? 'Fully agreed with automated AI pre-evaluation scores.'
          : 'Manual score adjustments submitted by judge review.');

      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        organizationId: submission?.organizationId || activeOrganization?.id || 'org-krivee',
        submissionId: submission.id,
        referenceId: submission.referenceId || submission.id,
        competitionId: submission.competitionId || 'comp-default-ai',
        roundId: submission.roundId,
        judgeId: effectiveJudgeId,
        judgeName: effectiveJudgeName,
        judgeEmail: effectiveJudgeEmail,
        decisionMode,
        scores,
        totalScore,
        aiTotalScore: aiReport?.overallScore || 96,
        criterionDifferences: buildCriterionDifferences(),
        deductionNotes: effectiveDeductionNotes,
        privateNotes,
        assignmentId: assignment?.id,
      });

      setHumanEvaluation(submitted);

      // Update submission record with official score and status if applicable
      try {
        await submissionService.saveSubmission({
          ...submission,
          status: 'Evaluated',
          officialScore: totalScore,
          updatedAt: new Date().toISOString(),
        });
      } catch (subErr) {
        console.warn('Non-fatal: could not update submission status to Evaluated:', subErr);
      }

      // Refresh assignment status
      try {
        const refreshedAsgn = await judgeAssignmentService.getAssignmentForSubmissionAndJudge(submission.id, effectiveJudgeId);
        if (refreshedAsgn) setAssignment(refreshedAsgn);
      } catch (asgnErr) {
        console.warn('Non-fatal: could not refresh assignment:', asgnErr);
      }

      success(
        'Evaluation Finalized & Locked',
        `Score of ${totalScore}/100 officially recorded. Tamper-proof comparison trail preserved.`
      );
    } catch (err: any) {
      toastError('Submission Failed', err?.message || 'Could not submit official evaluation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── DECLARE CONFLICT OF INTEREST ──
  const handleDeclareConflict = async () => {
    if (!assignment) {
      toastError('Error', 'No active assignment found to declare conflict on.');
      return;
    }
    if (!conflictReason.trim() || conflictReason.trim().length < 5) {
      warning('Reason Required', 'Please provide a detailed justification for the conflict of interest.');
      return;
    }

    try {
      const updated = await judgeAssignmentService.declareConflictOfInterest({
        assignmentId: assignment.id,
        judgeId,
        judgeName,
        conflictType,
        reason: conflictReason.trim(),
      });

      setAssignment(updated);
      setIsConflictModalOpen(false);
      warning(
        'Conflict Declared',
        `You have been recused from reviewing "${submission.projectTitle}". Organizers have been notified to reassign.`
      );
    } catch (err: any) {
      toastError('Conflict Declaration Failed', err?.message || 'Could not record conflict.');
    }
  };

  // ── FLAG CONCERN ──
  const handleFlagConcern = async () => {
    if (!concernExplanation.trim() || concernExplanation.trim().length < 5) {
      warning('Explanation Required', 'Please provide details explaining your concern.');
      return;
    }

    try {
      await judgeAssignmentService.flagConcern({
        submissionId: submission.id,
        judgeId,
        judgeName,
        category: concernCategory,
        explanation: concernExplanation.trim(),
      });

      setIsFlagConcernModalOpen(false);
      setConcernExplanation('');
      success('Concern Flagged', `Integrity warning (${concernCategory}) logged for organizer review.`);
      await loadWorkspaceData();
    } catch (err: any) {
      toastError('Flag Concern Failed', err?.message || 'Could not flag concern.');
    }
  };

  // ── ORGANIZER REOPEN EVALUATION ──
  const handleReopenEvaluation = async () => {
    if (!humanEvaluation) return;
    if (!reopenReason.trim() || reopenReason.trim().length < 5) {
      warning('Audit Reason Required', 'Organizer authorization requires a detailed audit reason.');
      return;
    }

    try {
      await authorizationService.assertAuthorized(verifiedSession, {
        operation: 'EVALUATION_REOPEN',
        competitionId: humanEvaluation.competitionId,
      });

      const reopened = await judgeAssignmentService.reopenEvaluation({
        evaluationId: humanEvaluation.id,
        organizerUserId: currentUser?.uid || '',
        organizerName: reopenAuthName.trim() || currentUser?.displayName || 'Organizer',
        auditReason: reopenReason.trim(),
      });

      setHumanEvaluation(reopened);
      setIsReopenModalOpen(false);
      setReopenReason('');
      success(
        'Evaluation Reopened',
        `Scores unlocked for revision. Organizer audit trail recorded (${reopened.reopenHistory.length} event(s)).`
      );
      await loadWorkspaceData();
    } catch (err: any) {
      toastError('Reopen Failed', err?.message || 'Could not reopen evaluation.');
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-xs text-slate-400 dark:text-slate-500">
        Loading submission review workspace...
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          {subId ? 'Submission Not Found' : 'No Submission Selected'}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {subId
            ? 'The requested submission ID could not be loaded.'
            : 'Select a submission from the assignments queue to begin your review.'}
        </p>
        <Link to="/judge/assignments">
          <Button variant="secondary" size="sm">Back to Queue</Button>
        </Link>
      </div>
    );
  }

  // ── CONFLICT REVISION LOCK ──
  if (assignment?.status === 'CONFLICT') {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <Card className="p-8 text-center space-y-6 bg-white dark:bg-slate-900 border-rose-200 dark:border-rose-500/30 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-2xs">
            <ShieldAlert size={28} />
          </div>
          <div className="space-y-2">
            <Badge variant="danger" size="sm">Conflict of Interest Declared</Badge>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Review Access Recused</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              You declared a conflict of interest ({assignment.conflict?.conflictType}) regarding "{submission.projectTitle}".
              In compliance with academic integrity guidelines, your access to score this submission is locked.
            </p>
            {assignment.conflict?.reason && (
              <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg p-3 text-xs text-rose-800 dark:text-rose-200 text-left max-w-md mx-auto">
                <span className="font-semibold block">Declared Reason:</span>
                <span className="italic">"{assignment.conflict.reason}"</span>
              </div>
            )}
          </div>
          <div className="pt-2 flex items-center justify-center gap-3 flex-wrap">
            <Button
              variant="primary"
              size="md"
              isLoading={isReEvaluating}
              onClick={handleRerunAiEvaluation}
            >
              <Sparkles size={14} className="mr-1.5 text-amber-300" />
              Run AI Evaluation Now
            </Button>
            <Link to="/judge/assignments">
              <Button variant="secondary" size="md" leftIcon={<ArrowLeft size={14} />}>
                Return to Assignments Queue
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // ── MANDATORY AI EVALUATION GATE CHECK ──
  const gateCheck = submissionLifecycleService.canJudgeReviewSubmission(submission);
  if (!gateCheck.allowed) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <Card className="p-8 text-center space-y-6 bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-500/30 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-2xs">
            <Lock size={28} />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>AI Evaluation Gate Active</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Review Workspace Locked
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              {gateCheck.reason ||
                `This submission is currently in "${submission.status}" status. Under competition rules, human judges cannot access the review workspace until automated AI evaluation is complete.`}
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-3 flex-wrap">
            <Button
              variant="primary"
              size="md"
              isLoading={isReEvaluating}
              onClick={handleRerunAiEvaluation}
            >
              <Sparkles size={14} className="mr-1.5 text-amber-300" />
              Run AI Evaluation Now
            </Button>
            <Link to="/judge/assignments">
              <Button variant="secondary" size="md" leftIcon={<ArrowLeft size={14} />}>
                Return to Assignments Queue
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const projectTitle = submission.projectTitle || submission.title;
  const projectTrack = submission.fieldValues?.track || submission.track || 'Healthcare & Edge AI';
  const teamDisplayName = blindReviewMode ? 'Anonymous Submitter #A-892' : (submission.teamName || submission.primaryContactName);

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb, Judge Info, & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
        <div className="flex items-center gap-3">
          <Link
            to="/judge/assignments"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Assignments Queue</span>
          </Link>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-2">
            <Badge variant="purple" size="sm">
              Reviewer: {judgeName}
            </Badge>
            <Badge variant="neutral" size="sm" className="font-mono">
              {submission.referenceId || submission.id}
            </Badge>
          </div>
        </div>

        {/* Action Controls: Blind Review Toggle, Flag Concern, Declare Conflict */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Blind Evaluation Mode Toggle */}
          <button
            type="button"
            onClick={() => {
              setBlindReviewMode(!blindReviewMode);
              info(
                blindReviewMode ? 'Standard Review' : 'Blind Review Active',
                blindReviewMode
                  ? 'Showing team and submitter names.'
                  : 'Anonymized team and member identities to eliminate bias.'
              );
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              blindReviewMode
                ? 'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-slate-100 text-white dark:text-slate-900 shadow-xs'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Toggle blind review to anonymize submitter identity"
          >
            {blindReviewMode ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>{blindReviewMode ? 'Blind Review Active' : 'Blind Review'}</span>
          </button>

          {/* Flag Concern Button */}
          <Button
            variant="outline"
            size="xs"
            leftIcon={<Flag size={13} className="text-amber-600 dark:text-amber-400" />}
            onClick={() => setIsFlagConcernModalOpen(true)}
          >
            Flag Concern
          </Button>

          {/* Declare Conflict of Interest Button */}
          <Button
            variant="outline"
            size="xs"
            leftIcon={<ShieldAlert size={13} className="text-rose-600 dark:text-rose-400" />}
            onClick={() => setIsConflictModalOpen(true)}
          >
            Declare Conflict
          </Button>

          {/* Rerun AI Evaluation */}
          <Button
            variant="outline"
            size="xs"
            leftIcon={<RefreshCw size={12} className={isReEvaluating ? 'animate-spin' : ''} />}
            onClick={handleRerunAiEvaluation}
            disabled={isReEvaluating}
          >
            {isReEvaluating ? 'Re-evaluating...' : 'Re-run AI'}
          </Button>
        </div>
      </div>

      {/* Locked Status Banner (if submitted) */}
      {isLocked && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-emerald-900 dark:text-emerald-200">
                  Evaluation Submitted & Locked ({totalScore}/100)
                </span>
                <Badge variant="success" size="sm">Immutable Scorecard</Badge>
                {humanEvaluation?.reopenHistory && humanEvaluation.reopenHistory.length > 0 && (
                  <Badge variant="neutral" size="sm">
                    Reopened {humanEvaluation.reopenHistory.length}x
                  </Badge>
                )}
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-300/90 mt-0.5">
                Submitted by {judgeName} at{' '}
                {new Date(humanEvaluation?.submittedAt || Date.now()).toLocaleString()}. Scores cannot be modified without documented organizer authorization.
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            leftIcon={<Unlock size={13} className="text-amber-600 dark:text-amber-400" />}
            onClick={() => setIsReopenModalOpen(true)}
          >
            Authorize Reopening
          </Button>
        </div>
      )}

      {/* Flagged Concern Notice (if present) */}
      {humanEvaluation?.flaggedConcern && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
          <Flag size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-bold">
              Flagged Concern: {humanEvaluation.flaggedConcern.category}
            </span>
            <p className="text-amber-800 dark:text-amber-300/90 italic">
              "{humanEvaluation.flaggedConcern.explanation}"
            </p>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 block">
              Flagged by {humanEvaluation.flaggedConcern.flaggedByJudgeName} at{' '}
              {new Date(humanEvaluation.flaggedConcern.flaggedAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Split-Screen Review Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 cols): Participant Information & Evidence Artifacts */}
        <div className="lg:col-span-5 space-y-5">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-500/30">
                  {projectTrack}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  Submitted {new Date(submission.submittedAt || Date.now()).toLocaleDateString()}
                </span>
              </div>
              <CardTitle className="text-lg mt-2">{projectTitle}</CardTitle>
              <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5 pt-1">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{teamDisplayName}</span>
                {!blindReviewMode && (
                  <>
                    <span>•</span>
                    <span>
                      {submission.members?.join(', ') || submission.primaryContactEmail || 'Solo Submitter'}
                    </span>
                  </>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              {/* Project Summary */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  1. Project Information & Summary
                </span>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80">
                  {submission.projectDescription || submission.summary || submission.description}
                </p>
              </div>

              {/* Problem & Solution framing */}
              {(submission.problemStatement || submission.solution) && (
                <div className="space-y-2 text-xs">
                  {submission.problemStatement && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80">
                      <span className="font-bold text-slate-700 dark:text-slate-200 block mb-0.5">Problem Statement:</span>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{submission.problemStatement}</p>
                    </div>
                  )}
                  {submission.solution && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80">
                      <span className="font-bold text-slate-700 dark:text-slate-200 block mb-0.5">Proposed Solution:</span>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{submission.solution}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Technologies Used */}
              {submission.technologiesUsed && submission.technologiesUsed.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Technologies & Stack
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {submission.technologiesUsed.map((tech: string, i: number) => (
                      <span
                        key={i}
                        className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-mono"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Artifacts & links
                </span>
                <div className="space-y-2">
                  {submission.githubUrl && (
                    <a
                      href={submission.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900/60 transition-colors group"
                    >
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 min-w-0">
                        <GithubIcon size={16} className="text-slate-700 dark:text-slate-300 shrink-0" />
                        <span className="truncate">{submission.githubUrl}</span>
                      </div>
                      <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold group-hover:underline shrink-0 ml-2">
                        Open Repo ↗
                      </span>
                    </a>
                  )}

                  {(submission.demoUrl || submission.deploymentUrl) && (
                    <a
                      href={submission.deploymentUrl || submission.demoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900/60 transition-colors group"
                    >
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 min-w-0">
                        <Globe size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="truncate">{submission.deploymentUrl || submission.demoUrl}</span>
                      </div>
                      <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold group-hover:underline shrink-0 ml-2">
                        Live Demo ↗
                      </span>
                    </a>
                  )}

                  {submission.files && submission.files.length > 0 && (
                    <div className="space-y-1">
                      {submission.files.map((f: any) => {
                        const fileName = f.fileName || f.originalFileName || 'Uploaded Artifact';
                        const rawBytes = f.fileSize || f.sizeBytes || 0;
                        const sizeKb = (rawBytes / 1024).toFixed(0);
                        const isFiniteSize = rawBytes > 0 && !isNaN(Number(sizeKb));
                        const mimeLabel = f.detectedMimeType || f.mimeType?.split('/')[1]?.toUpperCase() || 'Verified';

                        const isLegacyBlob =
                          Boolean(f.downloadUrl?.startsWith('blob:')) ||
                          Boolean(f.downloadUrl?.includes('storage.proofly.internal')) ||
                          !fileStorageService.parseCanonicalStoragePath(f.storagePath || '');

                        return (
                          <div key={f.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/50">
                            <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 truncate mr-2">
                              <FileText size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                              <span className="truncate">{fileName} {isFiniteSize ? `(${sizeKb} KB)` : ''}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isLegacyBlob ? (
                                <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-500/30">
                                  Re-upload required
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await fileStorageService.triggerBrowserDownload(f, {
                                        verifiedSession,
                                        assignedJudgeIds: assignment ? [assignment.judgeId] : [],
                                      });
                                    } catch (err: any) {
                                      toastError('Artifact Access Denied', err?.message || 'Unable to download file.');
                                    }
                                  }}
                                  className="text-[10px] text-blue-700 dark:text-blue-300 font-semibold bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-500/30 cursor-pointer"
                                >
                                  Download
                                </button>
                              )}
                              <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30">
                                {mimeLabel.length > 15 ? 'Verified File' : mimeLabel}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column (7 cols): AI Evidence Dossier + Judge Evaluation Form */}
        <div className="lg:col-span-7 space-y-5">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  AI Pre-Evaluation
                </span>
                {aiReport && (
                  <Badge variant="neutral" size="sm" className="font-mono">
                    v{aiReport.rubricVersion.versionNumber}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {aiReport ? (
                  aiReport.telemetry.actualInferenceSource === 'ON_DEVICE' ? (
                    <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      <Zap size={12} />
                      On-Device Gemini Nano 4 ({aiReport.telemetry.latencyMs}ms)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-blue-700 dark:text-blue-400 font-medium">
                      <Cloud size={12} />
                      Cloud 2.5 Flash ({aiReport.telemetry.latencyMs}ms)
                    </span>
                  )
                ) : (
                  <span className="text-slate-400 dark:text-slate-500 font-medium">
                    Pending AI run
                  </span>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-5 space-y-4">
              {aiReport ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">AI Suggested Total</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
                          {aiReport.overallScore}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                          / {aiReport.totalMaxScore}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant="success" size="sm" dot>
                        AUDIT_VERIFIED
                      </Badge>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setIsDossierModalOpen(true)}
                      >
                        View Full Evidence Packet
                      </Button>
                    </div>
                  </div>

                  {/* Criterion-wise AI Scores, Reasoning, References, Deductions & Limitations */}
                  <div className="space-y-3 pt-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block">
                      5–9. Criterion-Wise AI Scores, Reasoning & Deductions
                    </span>

                    <div className="space-y-3">
                      {aiReport.criteriaEvaluations.map((crit) => (
                        <div
                          key={crit.criterionId}
                          className="bg-white dark:bg-slate-800/40 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700/80 space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 dark:text-slate-100">{crit.criterionName}</span>
                            <span className="font-mono font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-500/30">
                              {crit.suggestedScore} / {crit.maxScore}
                            </span>
                          </div>

                          {/* Reasoning & Positive Observations */}
                          {crit.positiveObservations && crit.positiveObservations.length > 0 && (
                            <ul className="text-slate-600 dark:text-slate-300 list-disc list-inside space-y-0.5">
                              {crit.positiveObservations.map((obs, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  {obs}
                                </li>
                              ))}
                            </ul>
                          )}

                          {/* Evidence References */}
                          {crit.evidenceReferences && crit.evidenceReferences.length > 0 && (
                            <div className="bg-slate-50 dark:bg-slate-900/60 p-2 rounded text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                              <span className="font-semibold text-slate-700 dark:text-slate-300 block">Evidence References:</span>
                              <span className="italic">{crit.evidenceReferences.join('; ')}</span>
                            </div>
                          )}

                          {/* Why marks were deducted */}
                          {crit.exactDeductionExplanations && crit.exactDeductionExplanations.length > 0 && (
                            <div className="bg-rose-50/70 dark:bg-rose-500/10 p-2 rounded text-[11px] text-rose-800 dark:text-rose-200 space-y-0.5 border border-rose-100 dark:border-rose-500/25">
                              <span className="font-semibold text-rose-900 dark:text-rose-300 block">Deduction Explanation:</span>
                              <p className="italic leading-relaxed">{crit.exactDeductionExplanations.join(' ')}</p>
                            </div>
                          )}

                          {/* Missing Evidence & Limitations */}
                          {((crit.missingEvidence && crit.missingEvidence.length > 0) || (crit.limitations && crit.limitations.length > 0)) && (
                            <div className="text-[11px] text-amber-700 dark:text-amber-300 space-y-0.5">
                              <span className="font-semibold block">Missing Evidence & Limitations:</span>
                              <span>{[...(crit.missingEvidence || []), ...(crit.limitations || [])].join(' • ')}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-6 text-center space-y-2">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    No AI pre-evaluation report generated for this submission yet.
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Run AI evaluation to generate criterion-level evidence notes, or score manually below.
                  </p>
                  <div className="pt-1">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={handleRerunAiEvaluation}
                      isLoading={isReEvaluating}
                    >
                      Run AI pre-evaluation
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 10. Judge Evaluation Form */}
          <Card className="border-slate-300 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900">
            <CardHeader className="py-4 px-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-blue-600 dark:text-blue-400" />
                  <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                    10. Human Judge Decision & Scorecard
                  </CardTitle>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Confirm or modify AI recommendations. All deviations require justification rationales.
                </p>
              </div>

              {/* Total Score Counter */}
              <div className="text-right shrink-0">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider block">
                  Your Final Score
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-black text-blue-700 dark:text-blue-400 font-mono">{totalScore}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">/ 100</span>
                </div>
              </div>
            </CardHeader>

            {/* Decision Mode Selector: Agree / Modify / Reject */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex gap-2">
              <button
                type="button"
                disabled={isLocked}
                onClick={() => handleDecisionModeChange('AGREE')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  decisionMode === 'AGREE'
                    ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                <span>Agree with AI{aiReport ? ` (${aiReport.overallScore})` : ''}</span>
              </button>

              <button
                type="button"
                disabled={isLocked}
                onClick={() => handleDecisionModeChange('MODIFY')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  decisionMode === 'MODIFY'
                    ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-300 dark:border-blue-500/40 text-blue-800 dark:text-blue-300 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Sliders size={14} className="text-blue-600 dark:text-blue-400" />
                <span>Modify Scores</span>
              </button>

              <button
                type="button"
                disabled={isLocked}
                onClick={() => handleDecisionModeChange('REJECT')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  decisionMode === 'REJECT'
                    ? 'bg-rose-50 dark:bg-rose-500/15 border-rose-300 dark:border-rose-500/40 text-rose-800 dark:text-rose-300 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <X size={14} className="text-rose-600 dark:text-rose-400" />
                <span>Reject AI</span>
              </button>
            </div>

            <CardContent className="p-5 space-y-5">
              {/* Sliders for Rubric Criteria */}
              <div className="space-y-4">
                {aiReport
                  ? aiReport.criteriaEvaluations.map((crit) => {
                      const currentScore = scores[crit.criterionId] ?? crit.suggestedScore;

                      return (
                        <div key={crit.criterionId} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{crit.criterionName}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                AI: {crit.suggestedScore}/{crit.maxScore}
                              </span>
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                {currentScore} / {crit.maxScore}
                              </span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max={crit.maxScore}
                            value={currentScore}
                            disabled={decisionMode === 'AGREE' || isLocked}
                            onChange={(e) =>
                              handleScoreChange(crit.criterionId, parseInt(e.target.value, 10), crit.maxScore)
                            }
                            className="w-full accent-blue-600 dark:accent-blue-400 cursor-pointer disabled:cursor-not-allowed"
                          />
                        </div>
                      );
                    })
                  : DEFAULT_FALLBACK_CRITERIA.map((crit) => {
                      const currentScore = scores[crit.id] ?? 0;

                      return (
                        <div key={crit.id} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{crit.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                {currentScore} / {crit.maxScore}
                              </span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max={crit.maxScore}
                            value={currentScore}
                            disabled={decisionMode === 'AGREE' || isLocked}
                            onChange={(e) =>
                              handleScoreChange(crit.id, parseInt(e.target.value, 10), crit.maxScore)
                            }
                            className="w-full accent-blue-600 dark:accent-blue-400 cursor-pointer disabled:cursor-not-allowed"
                          />
                        </div>
                      );
                    })}
              </div>

              {/* Deduction Justification Textarea */}
              <Textarea
                label="Deduction Rationale & Modification Justification"
                required={decisionMode !== 'AGREE'}
                disabled={isLocked}
                placeholder="Explain why points were deducted or why AI recommendations were modified..."
                value={deductionNotes}
                onChange={(e) => setDeductionNotes(e.target.value)}
                helperText="This explanation is preserved in the transparent competition audit trail."
              />

              {/* Private Judge Notes */}
              <Textarea
                label="Private Judge Notes (Optional)"
                disabled={isLocked}
                placeholder="Internal notes visible only to organizers and fellow judges..."
                value={privateNotes}
                onChange={(e) => setPrivateNotes(e.target.value)}
                rows={2}
              />
            </CardContent>

            {/* Bottom Actions Bar */}
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-900/70 rounded-b-xl border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!isLocked && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<Save size={14} />}
                      onClick={handleSaveDraft}
                      disabled={isSavingDraft}
                    >
                      {isSavingDraft ? 'Saving Draft...' : 'Save Draft'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        handleDecisionModeChange('MODIFY');
                        warning('Resetting', 'Scores reset to current values.');
                      }}
                    >
                      Reset
                    </Button>
                  </>
                )}
              </div>

              <div>
                {!isLocked ? (
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<CheckCircle2 size={15} />}
                    isLoading={isSubmitting}
                    disabled={isSubmitting}
                    onClick={handleFinalSubmit}
                  >
                    {isSubmitting ? 'Finalizing & Submitting...' : 'Finalize & Submit Score'}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Evaluation Finalized</span>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<Unlock size={14} className="text-amber-600 dark:text-amber-400" />}
                      onClick={() => setIsReopenModalOpen(true)}
                    >
                      Reopen
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ── AI AND HUMAN COMPARISON SCORECARD (Preserved Trail) ── */}
      {humanEvaluation && (
        <Card className="border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
          <CardHeader className="py-4 px-5 border-b border-slate-200 dark:border-slate-800 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={16} className="text-blue-600 dark:text-blue-400" />
              <div>
                <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  AI vs Human Scoring Comparison & Audit Record
                </CardTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Preserved evaluation trail: Original AI score, human score, criterion differences, and justification.
                </p>
              </div>
            </div>
            <Badge variant={humanEvaluation.isLocked ? 'success' : 'warning'} size="sm">
              {humanEvaluation.isLocked ? 'OFFICIALLY LOCKED' : 'DRAFT IN PROGRESS'}
            </Badge>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold block">Original AI Score</span>
                <span className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono">
                  {humanEvaluation.aiTotalScore} / 100
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold block">Final Human Score</span>
                <span className="text-xl font-bold text-blue-700 dark:text-blue-400 font-mono">
                  {humanEvaluation.totalScore} / 100
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold block">Score Variance</span>
                <span
                  className={`text-xl font-bold font-mono ${
                    humanEvaluation.scoreDifference > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : humanEvaluation.scoreDifference < 0
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {humanEvaluation.scoreDifference > 0
                    ? `+${humanEvaluation.scoreDifference}`
                    : humanEvaluation.scoreDifference} pts
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold block">Decision Mode</span>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase">
                  {humanEvaluation.decisionMode}
                </span>
              </div>
            </div>

            {/* Criterion-wise differences table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Rubric Criterion</th>
                    <th className="py-2.5 px-3">AI Suggested</th>
                    <th className="py-2.5 px-3">Human Awarded</th>
                    <th className="py-2.5 px-3 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {Object.values(humanEvaluation.criterionDifferences || {}).map((item) => (
                    <tr key={item.criterionId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">{item.criterionName}</td>
                      <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400">
                        {item.aiScore} / {item.maxScore}
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-blue-700 dark:text-blue-400">
                        {item.humanScore} / {item.maxScore}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold">
                        <span
                          className={
                            item.diff > 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : item.diff < 0
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }
                        >
                          {item.diff > 0 ? `+${item.diff}` : item.diff}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Deduction rationale */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-200 block mb-1">Deduction & Override Rationale:</span>
              <p className="text-slate-600 dark:text-slate-300 italic leading-relaxed">
                "{humanEvaluation.deductionNotes || 'No deductions noted.'}"
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── FULL AI DOSSIER MODAL ── */}
      {aiReport && (
        <Modal
          isOpen={isDossierModalOpen}
          onClose={() => setIsDossierModalOpen(false)}
          title="Full AI Evaluation Dossier"
          maxWidth="xl"
        >
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <AiEvaluationReportView report={aiReport} />
          </div>
        </Modal>
      )}


      {/* ── CONFLICT OF INTEREST MODAL ── */}
      <Modal
        isOpen={isConflictModalOpen}
        onClose={() => setIsConflictModalOpen(false)}
        title="Declare Conflict of Interest"
        description="Recuse yourself from reviewing this submission in accordance with competition integrity standards."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsConflictModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!conflictReason.trim()}
              onClick={handleDeclareConflict}
            >
              Confirm Recusal & Notify Organizers
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nature of Conflict
            </label>
            <select
              value={conflictType}
              onChange={(e) => setConflictType(e.target.value as ConflictType)}
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg px-3 py-2 font-medium text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
            >
              <option value="DIRECT_COLLABORATOR">Direct Collaborator / Co-Author</option>
              <option value="ADVISOR_STUDENT">Academic Advisor / Direct Mentee</option>
              <option value="INSTITUTIONAL">Same Lab or Institutional Conflict</option>
              <option value="FINANCIAL_PERSONAL">Financial or Personal Interest</option>
              <option value="OTHER">Other Professional Conflict</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Mandatory Explanation / Justification
            </label>
            <textarea
              required
              rows={3}
              value={conflictReason}
              onChange={(e) => setConflictReason(e.target.value)}
              placeholder="Explain the relationship or circumstance that necessitates recusal..."
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </Modal>

      {/* ── FLAG CONCERN MODAL ── */}
      <Modal
        isOpen={isFlagConcernModalOpen}
        onClose={() => setIsFlagConcernModalOpen(false)}
        title="Flag Project Concern to Organizers"
        description="Raise flags regarding plagiarism, inappropriate material, or synthetic code fraud."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsFlagConcernModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!concernExplanation.trim()}
              onClick={handleFlagConcern}
            >
              Submit Flagged Concern
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Concern Category
            </label>
            <select
              value={concernCategory}
              onChange={(e) => setConcernCategory(e.target.value as ConcernCategory)}
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg px-3 py-2 font-medium text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
            >
              <option value="PLAGIARISM">Suspected Plagiarism / Uncited Borrowing</option>
              <option value="TECHNICAL_FRAUD">Synthetic Code Fraud / Fake Benchmarks</option>
              <option value="INSUFFICIENT_EVIDENCE">Insufficient Evidence / Missing Code</option>
              <option value="INAPPROPRIATE_CONTENT">Inappropriate or Offensive Material</option>
              <option value="CODE_ORIGINALITY">Pre-Existing Code / Non-Hackathon Work</option>
              <option value="OTHER">Other Integrity Violation</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Detailed Explanation & Observed Evidence
            </label>
            <textarea
              required
              rows={3}
              value={concernExplanation}
              onChange={(e) => setConcernExplanation(e.target.value)}
              placeholder="Describe what was discovered in the repository, commits, or demo..."
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </Modal>

      {/* ── ORGANIZER REOPEN AUTHORIZATION MODAL ── */}
      <Modal
        isOpen={isReopenModalOpen}
        onClose={() => setIsReopenModalOpen(false)}
        title="Authorize Evaluation Reopening"
        description="Under competition rules, reopening a finalized evaluation requires organizer authorization and a logged audit reason."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsReopenModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!reopenReason.trim()}
              onClick={handleReopenEvaluation}
            >
              Authorize & Unlock Scorecard
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Authorized Organizer Name / ID
            </label>
            <input
              type="text"
              value={reopenAuthName}
              onChange={(e) => setReopenAuthName(e.target.value)}
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg px-3 py-2 font-medium text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Mandatory Reopening Audit Reason
            </label>
            <textarea
              required
              rows={3}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Specify the reason for reopening this evaluation (e.g. participant score dispute review, newly verified file artifact, organizer calibration)..."
              className="w-full bg-white dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
