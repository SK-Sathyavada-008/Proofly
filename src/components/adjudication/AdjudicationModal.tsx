// ─────────────────────────────────────────────
// AdjudicationModal.tsx — Phase 12 Disagreement Studio & Adjudication Modal
// Proofly — Side-by-Side Comparison, Evidence Grounding & Immutable Adjudication
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Scale,
  Send,
  CheckCircle2,
  HelpCircle,
  FileText,
  User,
  Sliders,
  History,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { calibrationAndDisagreementService } from '../../services/calibrationAndDisagreementService';
import type {
  AdjudicationRecord,
  AdjudicationResolutionType,
  SubmissionDisagreementAnalysis,
} from '../../types/calibrationAndDisagreement';

interface AdjudicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: SubmissionDisagreementAnalysis | null;
  adjudicatorId: string;
  adjudicatorName: string;
  adjudicatorRole?: string;
  onAdjudicationSaved?: (record: AdjudicationRecord) => void;
}

export const AdjudicationModal: React.FC<AdjudicationModalProps> = ({
  isOpen,
  onClose,
  analysis,
  adjudicatorId,
  adjudicatorName,
  adjudicatorRole = 'ORGANIZER',
  onAdjudicationSaved,
}) => {
  const { success, warning, error: toastError } = useToast();

  const [resolutionType, setResolutionType] =
    useState<AdjudicationResolutionType>('PANEL_CONSENSUS');
  const [adjustedScores, setAdjustedScores] = useState<Record<string, number>>({});
  const [resolutionRationale, setResolutionRationale] = useState('');
  const [selectedDisputedCriteria, setSelectedDisputedCriteria] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Clarification request state
  const [clarifyJudgeId, setClarifyJudgeId] = useState('');
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const clarifyCriteria = selectedDisputedCriteria;
  const [isSendingClarification, setIsSendingClarification] = useState(false);
  const [activeAdjudication, setActiveAdjudication] = useState<AdjudicationRecord | null>(null);

  // Initialize scores and disputed criteria when analysis loads
  useEffect(() => {
    if (analysis) {
      // Find criteria that are disputed
      const disputedIds = analysis.criterionDisagreements
        .filter((c) => c.isDisputed)
        .map((c) => c.criterionId);
      setSelectedDisputedCriteria(disputedIds);

      // Default adjusted scores to panel mean rounded
      const initialScores: Record<string, number> = {};
      analysis.criterionDisagreements.forEach((c) => {
        initialScores[c.criterionId] = Math.round(c.meanScore);
      });
      setAdjustedScores(initialScores);

      // Fetch existing adjudication if any
      calibrationAndDisagreementService
        .getAdjudicationForSubmission(analysis.submissionId)
        .then((existing) => {
          setActiveAdjudication(existing);
          if (existing) {
            setResolutionType(existing.resolutionType);
            setAdjustedScores(existing.adjustedScores);
            setResolutionRationale(existing.resolutionRationale);
          }
        });
    }
  }, [analysis]);

  if (!analysis) return null;

  const totalAdjusted = Object.values(adjustedScores).reduce((acc, v) => acc + Number(v || 0), 0);

  // Handle Resolution Type preset shifts
  const handleResolutionTypeChange = (type: AdjudicationResolutionType) => {
    setResolutionType(type);
    const updated: Record<string, number> = {};

    analysis.criterionDisagreements.forEach((crit) => {
      if (type === 'MAINTAIN_AVERAGE') {
        updated[crit.criterionId] = Math.round(crit.meanScore * 10) / 10;
      } else if (type === 'PANEL_MEDIAN') {
        updated[crit.criterionId] = crit.medianScore;
      } else if (type === 'UPHOLD_JUDGE_SCORE' && analysis.judges.length > 0) {
        // Default to first judge
        const jScore = crit.scores[0]?.score ?? crit.meanScore;
        updated[crit.criterionId] = jScore;
      } else {
        updated[crit.criterionId] = adjustedScores[crit.criterionId] ?? Math.round(crit.meanScore);
      }
    });

    setAdjustedScores(updated);
  };

  const handleScoreChange = (criterionId: string, val: number, maxScore: number) => {
    const clamped = Math.max(0, Math.min(val, maxScore));
    setAdjustedScores((prev) => ({
      ...prev,
      [criterionId]: clamped,
    }));
  };

  // Submit Adjudication Resolution
  const handleSaveResolution = async (approveImmediately = false) => {
    if (!resolutionRationale.trim() || resolutionRationale.trim().length < 8) {
      warning('Audit Rationale Required', 'Please provide a written rationale of at least 8 characters explaining this adjudication resolution.');
      return;
    }

    setIsSubmitting(true);
    try {
      const saved = await calibrationAndDisagreementService.saveAdjudicationResolution({
        submissionId: analysis.submissionId,
        competitionId: analysis.competitionId,
        disputedCriterionIds: selectedDisputedCriteria,
        resolutionType,
        adjustedScores,
        resolutionRationale,
        adjudicatorId,
        adjudicatorName,
        adjudicatorRole,
      });

      let finalRecord = saved;
      if (approveImmediately) {
        finalRecord = await calibrationAndDisagreementService.approveAdjudicationAdjustment(
          saved.id,
          { id: adjudicatorId, name: adjudicatorName, role: adjudicatorRole }
        );
        success(
          'Adjudication Approved',
          `Adjusted total score to ${finalRecord.adjustedTotalScore} pts. Official score ledger updated; original judge evaluations remain strictly preserved.`
        );
      } else {
        success('Resolution Draft Saved', 'Adjudication draft saved. You can approve it when all reviews and clarifications are complete.');
      }

      setActiveAdjudication(finalRecord);
      onAdjudicationSaved?.(finalRecord);
      onClose();
    } catch (err: any) {
      toastError('Adjudication Error', err?.message || 'Could not save adjudication.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Send Clarification Request
  const handleSendClarification = async () => {
    if (!clarifyJudgeId || !clarifyQuestion.trim()) {
      warning('Missing Information', 'Select a judge and enter a specific clarification question.');
      return;
    }

    setIsSendingClarification(true);
    try {
      const req = await calibrationAndDisagreementService.requestClarification({
        submissionId: analysis.submissionId,
        judgeId: clarifyJudgeId,
        criteriaIds: clarifyCriteria.length > 0 ? clarifyCriteria : selectedDisputedCriteria,
        question: clarifyQuestion,
        requestedBy: adjudicatorId,
        requestedByName: adjudicatorName,
      });

      success('Clarification Sent', `Requested clarification from judge on ${req.criteriaIds.length} criteria.`);
      setClarifyQuestion('');
      const updated = await calibrationAndDisagreementService.getAdjudicationForSubmission(analysis.submissionId);
      setActiveAdjudication(updated);
    } catch (err: any) {
      toastError('Clarification Error', err?.message || 'Could not send request.');
    } finally {
      setIsSendingClarification(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Adjudication & Disagreement Studio — ${analysis.referenceId}`}
    >
      <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-1">
        {/* Header Summary Card */}
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{analysis.projectTitle}</span>
                <Badge
                  variant={
                    analysis.disputeSeverity === 'CRITICAL'
                      ? 'danger'
                      : analysis.disputeSeverity === 'HIGH'
                      ? 'warning'
                      : analysis.disputeSeverity === 'MODERATE'
                      ? 'primary'
                      : 'neutral'
                  }
                  size="sm"
                >
                  Severity: {analysis.disputeSeverity}
                </Badge>
                {activeAdjudication?.status === 'APPROVED' && (
                  <Badge variant="success" size="sm">
                    Adjudicated & Approved
                  </Badge>
                )}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Ref ID: <span className="font-mono">{analysis.referenceId}</span> • Completed reviews:{' '}
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  {analysis.completedJudgesCount} of {analysis.assignedJudgesCount}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">MEAN SCORE</span>
                <span className="text-slate-900 dark:text-slate-100 font-bold text-sm">
                  {analysis.overallMeanScore} pts
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">SCORE SPREAD</span>
                <span
                  className={`font-bold text-sm ${
                    analysis.overallScoreSpread >= 15 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  Δ {analysis.overallScoreSpread} pts
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">VARIANCE</span>
                <span className="font-bold text-sm text-slate-700 dark:text-slate-300">
                  {analysis.overallVariance} (σ {analysis.overallStandardDeviation})
                </span>
              </div>
            </div>
          </div>

          {/* Missing Review Warnings */}
          {analysis.hasMissingEvaluations && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Missing Panel Evaluations Detected:</p>
                <p className="text-[11px] mt-0.5">
                  {analysis.missingJudgeEvaluations.map((m) => `${m.judgeName} (${m.assignmentStatus})`).join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Preserved Immutability Reminder */}
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
            <ShieldAlert size={13} className="text-blue-500 shrink-0" />
            <span>
              <strong>Immutability Guarantee:</strong> Original human judge evaluations in{' '}
              <code className="text-blue-600 dark:text-blue-400 font-mono">/humanEvaluations</code> are never overwritten.
              Approved adjustments append explicit audit entries in the scoring ledger.
            </span>
          </div>
        </div>

        {/* ── CRITERION-WISE SIDE-BY-SIDE DISAGREEMENT INSPECTION ── */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Scale size={14} className="text-blue-600 dark:text-blue-400" />
            Rubric Criteria Disagreement & Evidence Grounding
          </h4>

          <div className="space-y-3">
            {analysis.criterionDisagreements.map((crit) => {
              return (
                <div
                  key={crit.criterionId}
                  className={`border rounded-xl p-4 transition-colors ${
                    crit.isDisputed
                      ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/10'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Criterion Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {crit.criterionName}
                        </span>
                        <span className="text-xs text-slate-400">Max: {crit.maxScore} pts</span>
                        {crit.isContradictory && (
                          <Badge variant="danger" size="sm">
                            Contradictory
                          </Badge>
                        )}
                        {crit.isLargeDifference && !crit.isContradictory && (
                          <Badge variant="warning" size="sm">
                            High Variance
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {crit.primaryCauseDescription}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span>Mean: <strong>{crit.meanScore}</strong></span>
                      <span>Spread: <strong className={crit.isLargeDifference ? 'text-rose-600 dark:text-rose-400' : ''}>Δ {crit.scoreSpread} pts</strong></span>
                      <span>Var: <strong>{crit.variance}</strong></span>
                    </div>
                  </div>

                  {/* Side-by-Side Judges Comparison */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-3">
                    {crit.scores.map((s) => (
                      <div
                        key={s.judgeId}
                        className="p-3 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                            <User size={12} className="text-slate-400" />
                            {s.judgeName}
                          </span>
                          <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                            {s.score} / {crit.maxScore}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                          <span>Delta vs Mean:</span>
                          <span
                            className={
                              s.deltaFromMean > 0
                                ? 'text-emerald-600 font-bold'
                                : s.deltaFromMean < 0
                                ? 'text-rose-600 font-bold'
                                : 'text-slate-500'
                            }
                          >
                            {s.deltaFromMean > 0 ? `+${s.deltaFromMean}` : s.deltaFromMean} pts
                          </span>
                        </div>

                        {s.comment ? (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 italic bg-white dark:bg-slate-900 p-2 rounded border border-slate-200/50 dark:border-slate-800/50">
                            "{s.comment}"
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400 italic">No criterion comment recorded.</p>
                        )}

                        {s.evidenceReferences && s.evidenceReferences.length > 0 && (
                          <div className="pt-1 border-t border-slate-200/50 dark:border-slate-800/50 text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                            <FileText size={11} />
                            <span>Cited {s.evidenceReferences.length} verified evidence asset(s)</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Adjudication Override Score for this criterion */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-blue-50/30 dark:bg-blue-950/10 p-2.5 rounded-lg">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Sliders size={13} className="text-blue-600" />
                      Adjusted Final Score:
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={crit.maxScore}
                        step={0.5}
                        value={adjustedScores[crit.criterionId] ?? ''}
                        onChange={(e) =>
                          handleScoreChange(crit.criterionId, parseFloat(e.target.value) || 0, crit.maxScore)
                        }
                        className="w-20 px-2.5 py-1 text-xs font-mono text-center font-bold rounded border border-blue-200 dark:border-blue-900 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-400">/ {crit.maxScore}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RESOLUTION & AUDIT ACTIONS ── */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-600" />
            Adjudication Resolution & Audit Log
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Resolution Strategy
              </label>
              <select
                value={resolutionType}
                onChange={(e) => handleResolutionTypeChange(e.target.value as AdjudicationResolutionType)}
                className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                <option value="PANEL_CONSENSUS">Panel Consensus (Custom Compromise)</option>
                <option value="MAINTAIN_AVERAGE">Maintain Mathematical Mean</option>
                <option value="PANEL_MEDIAN">Panel Median Score</option>
                <option value="UPHOLD_JUDGE_SCORE">Uphold Designated Judge Score</option>
                <option value="CUSTOM_ADJUDICATION_ADJUSTMENT">Custom Adjudication Adjustment</option>
              </select>
            </div>

            <div className="flex flex-col justify-end">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Total Adjudicated Score:</span>
                <span className="font-mono text-base font-bold text-blue-600 dark:text-blue-400">
                  {totalAdjusted} pts
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Adjudication Audit Rationale (Required) *
            </label>
            <Textarea
              rows={3}
              value={resolutionRationale}
              onChange={(e) => setResolutionRationale(e.target.value)}
              placeholder="Record why this adjustment is approved, summarizing evidence inspects, clarification responses, or consensus notes..."
              className="text-xs"
            />
          </div>

          {/* Clarification History */}
          {activeAdjudication?.clarificationRequests && activeAdjudication.clarificationRequests.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <History size={13} className="text-blue-500" />
                Clarification Requests & Responses:
              </span>
              <div className="space-y-2">
                {activeAdjudication.clarificationRequests.map((req) => (
                  <div
                    key={req.requestId}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>To: <strong>{req.judgeName}</strong> • Sent by: {req.requestedByName}</span>
                      <span>{new Date(req.requestedAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">Q: {req.question}</p>
                    {req.response ? (
                      <p className="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded border border-emerald-200 dark:border-emerald-900/40 text-[11px] mt-1">
                        <strong>Judge Response:</strong> {req.response}
                      </p>
                    ) : (
                      <p className="text-amber-600 dark:text-amber-400 italic text-[11px]">
                        Pending response from judge...
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clarification Request Tool */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <HelpCircle size={13} className="text-blue-500" />
              Need clarification before final approval?
            </span>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={clarifyJudgeId}
                onChange={(e) => setClarifyJudgeId(e.target.value)}
                className="text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-slate-900 dark:text-slate-100 sm:w-1/3"
              >
                <option value="">Select reviewing judge...</option>
                {analysis.judges.map((j) => (
                  <option key={j.judgeId} value={j.judgeId}>
                    {j.judgeName} ({j.totalScore} pts)
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={clarifyQuestion}
                onChange={(e) => setClarifyQuestion(e.target.value)}
                placeholder="Ask specific question regarding evidence, code lines or rubric interpretation..."
                className="text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 flex-1 text-slate-900 dark:text-slate-100"
              />
              <Button
                variant="outline"
                size="xs"
                leftIcon={<Send size={12} />}
                disabled={isSendingClarification || !clarifyJudgeId || !clarifyQuestion.trim()}
                onClick={handleSendClarification}
              >
                Request
              </Button>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => handleSaveResolution(false)}
            >
              Save Draft Resolution
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<CheckCircle2 size={14} />}
              disabled={isSubmitting}
              onClick={() => handleSaveResolution(true)}
            >
              Approve & Apply Adjustment
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
