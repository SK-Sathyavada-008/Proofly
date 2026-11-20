// ─────────────────────────────────────────────
// JudgeCalibrationPage.tsx — Phase 12 Judge Calibration Workspace
// Proofly — Blind Calibration, Benchmark Scoring & Difference Analysis
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  Target,
  CheckCircle2,
  AlertCircle,
  FileText,
  RotateCcw,
  Sparkles,
  Info,
  Scale,
  Award,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { calibrationAndDisagreementService } from '../../services/calibrationAndDisagreementService';
import { competitionService } from '../../services/competitionService';
import type { Competition } from '../../types/authAndCompetition';
import type {
  CalibrationExercise,
  JudgeCalibrationSubmission,
  JudgeCalibrationSummaryReport,
} from '../../types/calibrationAndDisagreement';

export const JudgeCalibrationPage: React.FC = () => {
  const { currentUser, verifiedSession } = useProoflyAuth();
  const { success, error: toastError } = useToast();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string>('');
  const [exercises, setExercises] = useState<CalibrationExercise[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');
  const [activeExercise, setActiveExercise] = useState<CalibrationExercise | null>(null);

  // Judge scoring state
  const [proposedScores, setProposedScores] = useState<Record<string, number>>({});
  const [criterionComments, setCriterionComments] = useState<Record<string, string>>({});
  const [overallNotes, setOverallNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Submitted report state
  const [completedReport, setCompletedReport] = useState<JudgeCalibrationSubmission | null>(null);
  const [judgeSummary, setJudgeSummary] = useState<JudgeCalibrationSummaryReport | null>(null);

  const judgeId = currentUser?.uid || verifiedSession?.uid || 'judge-active';
  const judgeName = currentUser?.displayName || 'Judge Reviewer';
  const judgeEmail = currentUser?.email || 'judge@example.org';

  // 1. Load Competitions & Calibration Summary
  useEffect(() => {
    async function init() {
      try {
        const comps = await competitionService.listAllCompetitions();
        setCompetitions(comps);
        if (comps.length > 0 && !selectedCompId) {
          setSelectedCompId(comps[0].id);
        }

        const summary = await calibrationAndDisagreementService.getJudgeCalibrationReport(judgeId);
        setJudgeSummary(summary);
      } catch (err: any) {
        console.warn('Failed to load calibration data:', err);
      }
    }
    init();
  }, [judgeId]);

  // 2. Load Exercises for Selected Competition
  useEffect(() => {
    async function loadExercises() {
      if (!selectedCompId) return;
      try {
        const list = await calibrationAndDisagreementService.listCalibrationExercises(selectedCompId);
        setExercises(list);
        if (list.length > 0 && !selectedExerciseId) {
          setSelectedExerciseId(list[0].id);
        } else if (list.length === 0) {
          setSelectedExerciseId('');
          setActiveExercise(null);
          setCompletedReport(null);
        }
      } catch (err: any) {
        console.warn('Failed to load exercises:', err);
      }
    }
    loadExercises();
  }, [selectedCompId]);

  // 3. Load Active Exercise in Judge (Blind) Mode
  useEffect(() => {
    async function loadSingleExercise() {
      if (!selectedExerciseId) return;
      try {
        // Blind mode = true strictly strips reference scores & justifications
        const ex = await calibrationAndDisagreementService.getCalibrationExercise(
          selectedExerciseId,
          true
        );
        setActiveExercise(ex);

        // Check if judge has already submitted this exercise
        const prevSubs = await calibrationAndDisagreementService.listJudgeCalibrationSubmissions(judgeId);
        const existing = prevSubs.find((s) => s.exerciseId === selectedExerciseId);
        if (existing) {
          setCompletedReport(existing);
        } else {
          setCompletedReport(null);
          // Initialize scoring draft
          const initScores: Record<string, number> = {};
          ex?.rubric.forEach((crit) => {
            initScores[crit.id] = Math.round((crit.maxScore || 25) * 0.75);
          });
          setProposedScores(initScores);
        }
      } catch (err: any) {
        console.warn('Error loading calibration exercise:', err);
      }
    }
    loadSingleExercise();
  }, [selectedExerciseId, judgeId]);

  const handleScoreChange = (critId: string, val: number, maxScore: number) => {
    setProposedScores((prev) => ({
      ...prev,
      [critId]: Math.max(0, Math.min(val, maxScore)),
    }));
  };

  const handleCommentChange = (critId: string, text: string) => {
    setCriterionComments((prev) => ({
      ...prev,
      [critId]: text,
    }));
  };

  const handleSubmitCalibration = async () => {
    if (!activeExercise) return;

    setIsSubmitting(true);
    try {
      const submission = await calibrationAndDisagreementService.submitJudgeCalibration({
        exerciseId: activeExercise.id,
        judgeId,
        judgeName,
        judgeEmail,
        proposedScores,
        criterionComments,
        overallNotes,
      });

      success(
        'Calibration Submitted',
        `Benchmark comparison revealed. Average score deviation: ${submission.averageScoreDeviation} pts.`
      );
      setCompletedReport(submission);

      // Refresh overall judge summary
      const summary = await calibrationAndDisagreementService.getJudgeCalibrationReport(judgeId);
      setJudgeSummary(summary);
    } catch (err: any) {
      toastError('Submission Error', err?.message || 'Could not submit calibration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetake = () => {
    setCompletedReport(null);
  };

  const totalProposed = Object.values(proposedScores).reduce((acc, v) => acc + Number(v || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Judge Calibration Workspace"
        description="Practice evaluating sample submissions against rubric benchmarks. Build shared alignment across the judging panel."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={selectedCompId}
              onChange={(e) => setSelectedCompId(e.target.value)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded-md px-2.5 py-1.5 font-medium text-slate-700 dark:text-slate-200"
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {/* Educational Reassurance Alert */}
      <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl flex items-start gap-3 text-xs text-blue-900 dark:text-blue-100">
        <Info size={16} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-sm">Educational Rubric Alignment</p>
          <p className="mt-0.5 text-blue-800 dark:text-blue-200/90 leading-relaxed">
            Calibration is designed to foster a shared understanding of competition rubric standards.
            <strong> It is never treated as proof of bias or misconduct.</strong> Benchmark reference scores and justifications remain strictly blind during scoring and are revealed immediately upon submission for self-calibration.
          </p>
        </div>
      </div>

      {/* Calibration Summary Card */}
      {judgeSummary && judgeSummary.exercisesCompleted > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
          <div className="p-3.5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Exercises Completed</p>
            <p className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100 mt-0.5">
              {judgeSummary.exercisesCompleted}
            </p>
          </div>
          <div className="p-3.5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Avg Score Deviation</p>
            <p className="text-lg font-semibold font-mono text-blue-600 dark:text-blue-400 mt-0.5">
              ± {judgeSummary.overallAverageDeviation} pts
            </p>
          </div>
          <div className="p-3.5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Scoring Tendency</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">
              <Badge
                variant={
                  judgeSummary.scoringTendency === 'BALANCED'
                    ? 'success'
                    : judgeSummary.scoringTendency === 'LEAN_LENIENT'
                    ? 'primary'
                    : 'warning'
                }
                size="sm"
              >
                {judgeSummary.scoringTendency}
              </Badge>
            </p>
          </div>
          <div className="p-3.5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Panel Consistency</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1 flex items-center gap-1">
              {judgeSummary.consistentAcrossExercises ? (
                <>
                  <CheckCircle2 size={13} className="text-emerald-500" />
                  <span className="text-emerald-700 dark:text-emerald-400 text-xs">High Consistency</span>
                </>
              ) : (
                <>
                  <AlertCircle size={13} className="text-amber-500" />
                  <span className="text-amber-700 dark:text-amber-400 text-xs">Calibrating</span>
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Exercise Selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
          Calibration Exercise:
        </span>
        {exercises.length === 0 ? (
          <span className="text-xs text-slate-400 italic">No exercises created for this competition yet.</span>
        ) : (
          exercises.map((ex) => (
            <button
              key={ex.id}
              onClick={() => setSelectedExerciseId(ex.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap transition-colors ${
                selectedExerciseId === ex.id
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              {ex.title}
            </button>
          ))
        )}
      </div>

      {/* Main Workspace */}
      {activeExercise && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Sample Project & Instructions (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText size={15} className="text-blue-600" />
                  Sample Project Dossier
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4 text-xs">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    {activeExercise.sampleProject.title}
                  </h4>
                  {activeExercise.sampleProject.track && (
                    <Badge variant="primary" size="sm" className="mt-1">
                      Track: {activeExercise.sampleProject.track}
                    </Badge>
                  )}
                </div>

                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Problem & Solution Overview
                  </span>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                    {activeExercise.sampleProject.description || 'No description provided.'}
                  </p>
                </div>

                {activeExercise.sampleProject.artifacts && activeExercise.sampleProject.artifacts.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                      Provided Artifacts:
                    </span>
                    <div className="space-y-1.5">
                      {activeExercise.sampleProject.artifacts.map((art, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between"
                        >
                          <span className="font-medium text-slate-800 dark:text-slate-200">{art.name}</span>
                          <Badge variant="neutral" size="sm">
                            {art.type}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Scorecard (Blind Mode) OR Calibration Difference Report (8 cols) */}
          <div className="lg:col-span-8">
            {completedReport ? (
              /* ── REVEALED DIFFERENCE ANALYSIS & REPORT ── */
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Sparkles size={16} className="text-emerald-600" />
                      Calibration Difference Analysis & Benchmark Comparison
                    </CardTitle>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Benchmark reference scores and rubric rationales unblinded for your review.
                    </p>
                  </div>
                  <Button variant="outline" size="xs" leftIcon={<RotateCcw size={12} />} onClick={handleRetake}>
                    Re-Score
                  </Button>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                  {/* Summary Metric Ribbon */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono block">YOUR TOTAL</span>
                      <span className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
                        {completedReport.totalProposedScore} pts
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono block">BENCHMARK TOTAL</span>
                      <span className="text-base font-bold font-mono text-blue-600 dark:text-blue-400">
                        {completedReport.totalReferenceScore} pts
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono block">TOTAL DIFFERENCE</span>
                      <span
                        className={`text-base font-bold font-mono ${
                          completedReport.totalDifference > 0
                            ? 'text-emerald-600'
                            : completedReport.totalDifference < 0
                            ? 'text-rose-600'
                            : 'text-slate-600'
                        }`}
                      >
                        {completedReport.totalDifference > 0 ? `+${completedReport.totalDifference}` : completedReport.totalDifference} pts
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono block">AVG DEVIATION</span>
                      <span className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
                        ± {completedReport.averageScoreDeviation} pts
                      </span>
                    </div>
                  </div>

                  {/* Criteria Comparison Breakdown */}
                  <div className="space-y-3">
                    {Object.values(completedReport.criterionDeviations).map((crit) => (
                      <div
                        key={crit.criterionId}
                        className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                          <div>
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                              {crit.criterionName}
                            </span>
                            <span className="text-slate-400 ml-2">Max: {crit.maxScore} pts</span>
                          </div>

                          <div className="flex items-center gap-3 font-mono">
                            <span>You: <strong>{crit.judgeScore}</strong></span>
                            <span>Ref: <strong className="text-blue-600 dark:text-blue-400">{crit.referenceScore}</strong></span>
                            <span
                              className={`font-bold ${
                                crit.difference > 0
                                  ? 'text-emerald-600'
                                  : crit.difference < 0
                                  ? 'text-rose-600'
                                  : 'text-slate-500'
                              }`}
                            >
                              {crit.difference > 0 ? `+${crit.difference}` : crit.difference} pts
                            </span>
                            <Badge
                              variant={
                                crit.alignment === 'EXACT'
                                  ? 'success'
                                  : crit.alignment === 'CLOSE'
                                  ? 'primary'
                                  : crit.alignment === 'DEVIATION'
                                  ? 'warning'
                                  : 'danger'
                              }
                              size="sm"
                            >
                              {crit.alignment}
                            </Badge>
                          </div>
                        </div>

                        {/* Benchmark Reasoning */}
                        <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <Scale size={12} className="text-blue-500" />
                            Official Benchmark Justification:
                          </span>
                          <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-[11px]">
                            {crit.referenceReasoning}
                          </p>
                        </div>

                        {/* Judge's Comment */}
                        {crit.judgeComment && (
                          <div className="text-[11px] text-slate-500 italic">
                            Your Notes: "{crit.judgeComment}"
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              /* ── BLIND SCORING CARD (Reference Scores Strictly Hidden) ── */
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Target size={16} className="text-blue-600" />
                      Scorecard (Blind Mode Active)
                    </CardTitle>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Assign proposed scores based on rubric standards. Reference scores are hidden until submitted.
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <span className="text-[10px] text-slate-400 block">TOTAL SCORE</span>
                    <span className="text-base font-bold text-blue-600 dark:text-blue-400">
                      {totalProposed} pts
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                  {activeExercise.rubric.map((crit) => (
                    <div
                      key={crit.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                            {crit.name}
                          </span>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {crit.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={crit.maxScore}
                            step={0.5}
                            value={proposedScores[crit.id] ?? ''}
                            onChange={(e) =>
                              handleScoreChange(crit.id, parseFloat(e.target.value) || 0, crit.maxScore)
                            }
                            className="w-20 px-2.5 py-1.5 text-center font-bold font-mono text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500"
                          />
                          <span className="text-xs text-slate-400">/ {crit.maxScore}</span>
                        </div>
                      </div>

                      <div>
                        <input
                          type="text"
                          value={criterionComments[crit.id] ?? ''}
                          onChange={(e) => handleCommentChange(crit.id, e.target.value)}
                          placeholder="Optional notes or rubric rationale for this criterion..."
                          className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  ))}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Overall Assessment Notes (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={overallNotes}
                      onChange={(e) => setOverallNotes(e.target.value)}
                      placeholder="Add overall observations or calibration takeaways..."
                      className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Scores will be compared against benchmark upon submission.
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Award size={14} />}
                      disabled={isSubmitting}
                      onClick={handleSubmitCalibration}
                    >
                      Submit Calibration
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
