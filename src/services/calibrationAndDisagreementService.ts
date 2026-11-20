// ─────────────────────────────────────────────
// calibrationAndDisagreementService.ts — Phase 12 Judge Calibration & Disagreement Studio
// Proofly — Variance Detection, Adjudication, & Auditable Resolution
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
} from './firestorePersistenceService';
import { judgeAssignmentService } from './judgeAssignmentService';
import { scoringLedgerService } from './scoringLedgerService';
import { governanceAuditService } from './governanceAuditService';
import type {
  AdjudicationRecord,
  AdjudicationResolutionType,
  CalibrationExercise,
  ClarificationRequest,
  CompetitionDisagreementAnalytics,
  CriterionCalibrationAnalysis,
  CriterionDisagreement,
  CriterionDisagreementRate,
  DisagreementThresholds,
  DisputeSeverity,
  JudgeCalibrationSubmission,
  JudgeCalibrationSummaryReport,
  JudgeConsistencyRanking,
  MissingJudgeReviewDetail,
  ScoringTendency,
  SubmissionDisagreementAnalysis,
} from '../types/calibrationAndDisagreement';

export const DEFAULT_DISAGREEMENT_THRESHOLDS: DisagreementThresholds = {
  criterionSpreadThreshold: 5, // 5 points max-min spread on a rubric criterion
  overallSpreadThreshold: 15, // 15 points spread across total scores
  criterionVarianceThreshold: 6.0, // variance threshold for notable divergence
  contradictoryHighThresholdPct: 0.8, // 80% or higher
  contradictoryLowThresholdPct: 0.4, // 40% or lower
};

export class CalibrationAndDisagreementService {
  // Unit-test in-memory persistence stores
  private exercises = new Map<string, CalibrationExercise>();
  private calibrationSubmissions = new Map<string, JudgeCalibrationSubmission>();
  private adjudications = new Map<string, AdjudicationRecord>();
  private customThresholds = new Map<string, DisagreementThresholds>();

  // ─────────────────────────────────────────────────────────────────
  // 1. STATISTICAL UTILITIES
  // ─────────────────────────────────────────────────────────────────

  public calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / values.length) * 100) / 100;
  }

  public calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return sorted[mid];
    }
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  }

  public calculateVariance(values: number[]): { variance: number; standardDeviation: number } {
    if (values.length <= 1) {
      return { variance: 0, standardDeviation: 0 };
    }
    const mean = this.calculateMean(values);
    // Sample variance: divide by (n - 1)
    const sumSquaredDiffs = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
    const variance = Math.round((sumSquaredDiffs / (values.length - 1)) * 100) / 100;
    const standardDeviation = Math.round(Math.sqrt(variance) * 100) / 100;
    return { variance, standardDeviation };
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. CONFIGURABLE DISAGREEMENT THRESHOLDS
  // ─────────────────────────────────────────────────────────────────

  public setCompetitionThresholds(
    competitionId: string,
    thresholds: Partial<DisagreementThresholds>
  ): DisagreementThresholds {
    const existing = this.customThresholds.get(competitionId) || { ...DEFAULT_DISAGREEMENT_THRESHOLDS };
    const merged: DisagreementThresholds = { ...existing, ...thresholds };
    this.customThresholds.set(competitionId, merged);
    return merged;
  }

  public getCompetitionThresholds(competitionId?: string): DisagreementThresholds {
    if (competitionId && this.customThresholds.has(competitionId)) {
      return this.customThresholds.get(competitionId)!;
    }
    return { ...DEFAULT_DISAGREEMENT_THRESHOLDS };
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. JUDGE CALIBRATION EXERCISES
  // ─────────────────────────────────────────────────────────────────

  public async createCalibrationExercise(
    input: Omit<CalibrationExercise, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    options?: FirestoreExecutionOptions
  ): Promise<CalibrationExercise> {
    if (!input.title || !input.competitionId || !input.rubric || input.rubric.length === 0) {
      throw new Error('Calibration exercise requires a title, competitionId, and at least one rubric criterion.');
    }

    const id = input.id || `calib-ex-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const exercise: CalibrationExercise = {
      id,
      organizationId: input.organizationId || '',
      competitionId: input.competitionId,
      title: input.title,
      description: input.description || '',
      sampleProject: input.sampleProject,
      rubric: input.rubric,
      referenceScores: input.referenceScores || {},
      referenceReasoning: input.referenceReasoning || {},
      status: input.status || 'ACTIVE',
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdAt: now,
      updatedAt: now,
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'calibrationExercises', id);
        await setDoc(ref, withServerTimestamps(sanitizeFirestoreData(exercise), true));
        return exercise;
      } catch (err) {
        throw mapFirestoreError(err, 'createCalibrationExercise', 'calibrationExercises');
      }
    }

    this.exercises.set(id, exercise);
    return exercise;
  }

  /**
   * Retrieves an exercise. If isJudgeView === true, strips referenceScores and referenceReasoning
   * to guarantee the judge cannot see the benchmark answers before submission.
   */
  public async getCalibrationExercise(
    exerciseId: string,
    isJudgeView = false,
    options?: FirestoreExecutionOptions
  ): Promise<CalibrationExercise | null> {
    let ex: CalibrationExercise | null = null;
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'calibrationExercises', exerciseId));
        if (snap.exists()) {
          ex = snap.data() as CalibrationExercise;
        }
      } catch (err) {
        throw mapFirestoreError(err, 'getCalibrationExercise', 'calibrationExercises');
      }
    } else {
      ex = this.exercises.get(exerciseId) || null;
    }

    if (!ex) return null;

    if (isJudgeView) {
      // Blind mode for judges: reference scores and benchmark rationales are strictly hidden!
      return {
        ...ex,
        referenceScores: {},
        referenceReasoning: {},
      };
    }

    return ex;
  }

  public async listCalibrationExercises(
    competitionId: string,
    includeArchived = false,
    options?: FirestoreExecutionOptions
  ): Promise<CalibrationExercise[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const constraints = [where('competitionId', '==', competitionId)];
        if (!includeArchived) {
          constraints.push(where('status', '==', 'ACTIVE'));
        }
        const snap = await getDocs(query(collection(fs, 'calibrationExercises'), ...constraints));
        return snap.docs.map((d) => d.data() as CalibrationExercise);
      } catch (err) {
        throw mapFirestoreError(err, 'listCalibrationExercises', 'calibrationExercises');
      }
    }

    return Array.from(this.exercises.values()).filter((e) => {
      const matchComp = competitionId === 'ALL' || e.competitionId === competitionId;
      const matchStatus = includeArchived ? true : e.status === 'ACTIVE';
      return matchComp && matchStatus;
    });
  }

  /**
   * Evaluates and records a judge's calibration submission against benchmark reference scores.
   * Immediately returns the difference analysis and un-blinds reference reasoning.
   */
  public async submitJudgeCalibration(
    payload: {
      exerciseId: string;
      judgeId: string;
      judgeName: string;
      judgeEmail: string;
      proposedScores: Record<string, number>;
      criterionComments?: Record<string, string>;
      overallNotes?: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<JudgeCalibrationSubmission> {
    // 1. Load authoritative exercise with benchmark reference scores
    const exercise = await this.getCalibrationExercise(payload.exerciseId, false, options);
    if (!exercise) {
      throw new Error(`Calibration exercise "${payload.exerciseId}" not found.`);
    }

    const now = new Date().toISOString();
    const submissionId = `calib-sub-${payload.exerciseId}-${payload.judgeId}`;

    let totalProposed = 0;
    let totalReference = 0;
    let totalAbsDiff = 0;
    let overscoringCount = 0;
    let underscoringCount = 0;
    let exactCount = 0;
    const confusionCriteria: string[] = [];
    const criterionDeviations: Record<string, CriterionCalibrationAnalysis> = {};

    exercise.rubric.forEach((crit) => {
      const judgeScore = Number(payload.proposedScores[crit.id] ?? 0);
      const refScore = Number(exercise.referenceScores[crit.id] ?? 0);
      const diff = judgeScore - refScore;
      const absDiff = Math.abs(diff);
      const maxScore = crit.maxScore || 25;
      const deviationPct = Math.round((absDiff / maxScore) * 100);

      totalProposed += judgeScore;
      totalReference += refScore;
      totalAbsDiff += absDiff;

      let alignment: CriterionCalibrationAnalysis['alignment'] = 'CLOSE';
      if (diff === 0) {
        alignment = 'EXACT';
        exactCount++;
      } else if (diff > 0) {
        overscoringCount++;
      } else {
        underscoringCount++;
      }

      if (deviationPct > 25) {
        alignment = 'HIGH_CONFUSION';
        confusionCriteria.push(crit.name);
      } else if (deviationPct > 12) {
        alignment = 'DEVIATION';
      }

      criterionDeviations[crit.id] = {
        criterionId: crit.id,
        criterionName: crit.name,
        maxScore,
        judgeScore,
        referenceScore: refScore,
        difference: diff,
        absDifference: absDiff,
        deviationPercentage: deviationPct,
        alignment,
        judgeComment: payload.criterionComments?.[crit.id] || '',
        referenceReasoning:
          exercise.referenceReasoning[crit.id] ||
          'Standard benchmark reasoning for this criterion under the competition rubric.',
      };
    });

    const criteriaCount = exercise.rubric.length || 1;
    const averageScoreDeviation = Math.round((totalAbsDiff / criteriaCount) * 100) / 100;
    const totalDiff = totalProposed - totalReference;

    let scoringPattern: ScoringTendency = 'BALANCED';
    if (totalDiff >= 8) {
      scoringPattern = 'SIGNIFICANT_OVERSCORING';
    } else if (totalDiff >= 3) {
      scoringPattern = 'MILD_OVERSCORING';
    } else if (totalDiff <= -8) {
      scoringPattern = 'SIGNIFICANT_UNDERSCORING';
    } else if (totalDiff <= -3) {
      scoringPattern = 'MILD_UNDERSCORING';
    }

    const submission: JudgeCalibrationSubmission = {
      id: submissionId,
      exerciseId: exercise.id,
      organizationId: exercise.organizationId,
      competitionId: exercise.competitionId,
      judgeId: payload.judgeId,
      judgeName: payload.judgeName,
      judgeEmail: payload.judgeEmail,
      proposedScores: payload.proposedScores,
      criterionComments: payload.criterionComments || {},
      overallNotes: payload.overallNotes || '',
      totalProposedScore: totalProposed,
      totalReferenceScore: totalReference,
      totalDifference: totalDiff,
      averageScoreDeviation,
      criterionDeviations,
      overscoringCount,
      underscoringCount,
      exactCount,
      confusionCriteria,
      scoringPattern,
      submittedAt: now,
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'calibrationSubmissions', submissionId);
        await setDoc(ref, withServerTimestamps(sanitizeFirestoreData(submission), true));
        return submission;
      } catch (err) {
        throw mapFirestoreError(err, 'submitJudgeCalibration', 'calibrationSubmissions');
      }
    }

    this.calibrationSubmissions.set(submissionId, submission);
    return submission;
  }

  public async listJudgeCalibrationSubmissions(
    judgeId: string,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeCalibrationSubmission[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(collection(fs, 'calibrationSubmissions'), where('judgeId', '==', judgeId));
        const snap = await getDocs(q);
        return snap.docs.map((d) => d.data() as JudgeCalibrationSubmission);
      } catch (err) {
        throw mapFirestoreError(err, 'listJudgeCalibrationSubmissions', 'calibrationSubmissions');
      }
    }

    return Array.from(this.calibrationSubmissions.values()).filter((s) => s.judgeId === judgeId);
  }

  public async getJudgeCalibrationReport(
    judgeId: string,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeCalibrationSummaryReport> {
    const subs = await this.listJudgeCalibrationSubmissions(judgeId, options);

    if (subs.length === 0) {
      return {
        judgeId,
        judgeName: 'Judge',
        judgeEmail: '',
        exercisesCompleted: 0,
        overallAverageDeviation: 0,
        overallBiasScore: 0,
        consistentAcrossExercises: false,
        frequentConfusionCriteria: [],
        scoringTendency: 'BALANCED',
        lastCalibratedAt: '',
        guidanceNote:
          'No calibration exercises completed yet. Complete calibration to align on rubric standards.',
      };
    }

    const totalDev = subs.reduce((acc, s) => acc + s.averageScoreDeviation, 0);
    const overallAverageDeviation = Math.round((totalDev / subs.length) * 100) / 100;

    const totalBias = subs.reduce((acc, s) => acc + s.totalDifference, 0);
    const overallBiasScore = Math.round((totalBias / subs.length) * 100) / 100;

    const confusionCounts = new Map<string, number>();
    subs.forEach((s) => {
      s.confusionCriteria.forEach((crit) => {
        confusionCounts.set(crit, (confusionCounts.get(crit) || 0) + 1);
      });
    });

    const frequentConfusion = Array.from(confusionCounts.entries())
      .filter(([, count]) => count >= Math.ceil(subs.length / 2))
      .map(([name]) => name);

    let tendency: JudgeCalibrationSummaryReport['scoringTendency'] = 'BALANCED';
    if (overallBiasScore >= 4) {
      tendency = 'LEAN_LENIENT';
    } else if (overallBiasScore <= -4) {
      tendency = 'LEAN_STRICT';
    } else if (overallAverageDeviation > 5) {
      tendency = 'VARIABLE';
    }

    const deviations = subs.map((s) => s.averageScoreDeviation);
    const { standardDeviation } = this.calculateVariance(deviations);
    const consistentAcrossExercises = subs.length >= 2 ? standardDeviation <= 3.5 : true;

    return {
      judgeId,
      judgeName: subs[0].judgeName,
      judgeEmail: subs[0].judgeEmail,
      exercisesCompleted: subs.length,
      overallAverageDeviation,
      overallBiasScore,
      consistentAcrossExercises,
      frequentConfusionCriteria: frequentConfusion,
      scoringTendency: tendency,
      lastCalibratedAt: subs[subs.length - 1].submittedAt,
      guidanceNote:
        'Calibration is an educational alignment tool to foster shared rubric interpretation. It is never used as proof of bias or misconduct.',
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. JUDGE DISAGREEMENT DETECTION & VARIANCE ENGINE
  // ─────────────────────────────────────────────────────────────────

  /**
   * Analyzes variance, contradictions, and missing evaluations across judges for a specific submission.
   */
  public async analyzeSubmissionDisagreement(
    submissionId: string,
    thresholdsInput?: Partial<DisagreementThresholds>,
    options?: FirestoreExecutionOptions
  ): Promise<SubmissionDisagreementAnalysis> {
    // 1. Fetch all human judge evaluations for the submission (in organizer mode so blind mode doesn't hide panel evaluations)
    const evaluations = await judgeAssignmentService.listEvaluationsForSubmission(
      submissionId,
      undefined,
      true,
      options
    );

    // 2. Fetch judge assignments to check for missing/pending reviews
    const assignments = await judgeAssignmentService.listAssignments(
      { submissionId },
      options
    );

    const completedJudgeIds = new Set(evaluations.map((e) => e.judgeId));
    const missingJudges: MissingJudgeReviewDetail[] = assignments
      .filter((a) => !completedJudgeIds.has(a.judgeId) && a.status !== 'REVOKED' && a.status !== 'CONFLICT')
      .map((a) => ({
        judgeId: a.judgeId,
        judgeName: a.judgeName,
        judgeEmail: a.judgeEmail,
        assignmentStatus: a.status,
      }));

    const sampleEval = evaluations[0];
    const sampleAsgn = assignments[0];
    const compId = sampleEval?.competitionId || sampleAsgn?.competitionId || '';
    const refId = sampleEval?.referenceId || sampleAsgn?.referenceId || submissionId;
    const projectTitle = sampleAsgn?.projectTitle || 'Submission Project';

    const thresholds: DisagreementThresholds = {
      ...this.getCompetitionThresholds(compId),
      ...(thresholdsInput || {}),
    };

    // Calculate total score metrics robustly (deriving from scores map if totalScore is missing)
    const totalScores = evaluations.map((e) => {
      if (typeof e.totalScore === 'number' && !Number.isNaN(e.totalScore)) {
        return e.totalScore;
      }
      return Object.values(e.scores || {}).reduce((acc, v) => acc + Number(v), 0);
    });
    const overallMeanScore = this.calculateMean(totalScores);
    const overallMedianScore = this.calculateMedian(totalScores);
    const { variance: overallVariance, standardDeviation: overallStandardDeviation } =
      this.calculateVariance(totalScores);

    const overallMin = totalScores.length > 0 ? Math.min(...totalScores) : 0;
    const overallMax = totalScores.length > 0 ? Math.max(...totalScores) : 0;
    const overallScoreSpread = Math.round((overallMax - overallMin) * 100) / 100;
    const overallSpreadPercentage =
      totalScores.length > 0
        ? Math.round((overallScoreSpread / Math.max(overallMax, 100)) * 100)
        : 0;

    const isOverallDisputed = overallScoreSpread >= thresholds.overallSpreadThreshold;

    // 3. Map Criterion-level breakdown
    const criterionMap = new Map<
      string,
      {
        criterionId: string;
        criterionName: string;
        maxScore: number;
        scores: Array<{
          judgeId: string;
          judgeName: string;
          judgeEmail?: string;
          score: number;
          comment?: string;
          evidenceReferences?: string[];
        }>;
      }
    >();

    evaluations.forEach((evalDoc) => {
      // Criterion scores
      Object.entries(evalDoc.scores || {}).forEach(([critId, score]) => {
        const diffDetail = evalDoc.criterionDifferences?.[critId];
        const critName = diffDetail?.criterionName || critId;
        const maxScore = diffDetail?.maxScore || 25;
        const comment = evalDoc.criterionComments?.[critId] || '';

        // Extract any evidence annotations attached by this judge
        const citedEvidences = Object.values(evalDoc.evidenceAnnotations || {})
          .filter((ann) => ann.isRelevant)
          .map((ann) => ann.evidenceId);

        if (!criterionMap.has(critId)) {
          criterionMap.set(critId, {
            criterionId: critId,
            criterionName: critName,
            maxScore,
            scores: [],
          });
        }

        criterionMap.get(critId)!.scores.push({
          judgeId: evalDoc.judgeId,
          judgeName: evalDoc.judgeName,
          judgeEmail: evalDoc.judgeEmail,
          score,
          comment,
          evidenceReferences: citedEvidences,
        });
      });
    });

    let highestVarianceCritName: string | null = null;
    let highestVarianceValue = -1;
    let disputedCriteriaCount = 0;

    const criterionDisagreements: CriterionDisagreement[] = Array.from(criterionMap.values()).map(
      (entry) => {
        const rawScores = entry.scores.map((s) => s.score);
        const meanScore = this.calculateMean(rawScores);
        const medianScore = this.calculateMedian(rawScores);
        const { variance, standardDeviation } = this.calculateVariance(rawScores);

        const minScore = rawScores.length > 0 ? Math.min(...rawScores) : 0;
        const maxScoreValue = rawScores.length > 0 ? Math.max(...rawScores) : 0;
        const scoreSpread = Math.round((maxScoreValue - minScore) * 100) / 100;
        const spreadPercentage =
          entry.maxScore > 0 ? Math.round((scoreSpread / entry.maxScore) * 100) : 0;

        const isLargeDifference =
          scoreSpread >= thresholds.criterionSpreadThreshold ||
          variance >= thresholds.criterionVarianceThreshold;

        // Contradictory check: One judge gives high score >= 80% while another gives <= 40%
        const maxRatio = entry.maxScore > 0 ? maxScoreValue / entry.maxScore : 0;
        const minRatio = entry.maxScore > 0 ? minScore / entry.maxScore : 0;
        const isContradictory =
          rawScores.length >= 2 &&
          maxRatio >= thresholds.contradictoryHighThresholdPct &&
          minRatio <= thresholds.contradictoryLowThresholdPct;

        const isDisputed = isLargeDifference || isContradictory;
        if (isDisputed) disputedCriteriaCount++;

        if (variance > highestVarianceValue) {
          highestVarianceValue = variance;
          highestVarianceCritName = entry.criterionName;
        }

        let primaryCause = 'High consensus among reviewing judges.';
        if (isContradictory) {
          primaryCause = `Contradictory assessment: scores range from ${minScore}/${entry.maxScore} to ${maxScoreValue}/${entry.maxScore}.`;
        } else if (isLargeDifference) {
          primaryCause = `Score spread of ${scoreSpread} points (${spreadPercentage}% of max ${entry.maxScore} pts) exceeds threshold.`;
        }

        const scoresWithDelta = entry.scores.map((s) => ({
          ...s,
          deltaFromMean: Math.round((s.score - meanScore) * 100) / 100,
        }));

        return {
          criterionId: entry.criterionId,
          criterionName: entry.criterionName,
          maxScore: entry.maxScore,
          scores: scoresWithDelta,
          meanScore,
          medianScore,
          variance,
          standardDeviation,
          minScore,
          maxScoreValue,
          scoreSpread,
          spreadPercentage,
          isLargeDifference,
          isContradictory,
          isDisputed,
          primaryCauseDescription: primaryCause,
        };
      }
    );

    // Determine Dispute Severity
    let disputeSeverity: DisputeSeverity = 'NONE';
    if (disputedCriteriaCount >= 3 || overallScoreSpread >= 25) {
      disputeSeverity = 'CRITICAL';
    } else if (disputedCriteriaCount >= 2 || overallScoreSpread >= 18) {
      disputeSeverity = 'HIGH';
    } else if (disputedCriteriaCount >= 1 || isOverallDisputed) {
      disputeSeverity = 'MODERATE';
    } else if (overallScoreSpread > 5) {
      disputeSeverity = 'LOW';
    }

    // Check existing adjudication
    const activeAdj = await this.getAdjudicationForSubmission(submissionId, options);
    let adjudicationStatus: SubmissionDisagreementAnalysis['adjudicationStatus'] = 'NONE';
    if (activeAdj) {
      if (activeAdj.status === 'APPROVED') {
        adjudicationStatus = 'ADJUDICATED';
      } else if (activeAdj.clarificationRequests.length > 0) {
        adjudicationStatus = 'CLARIFICATION_REQUESTED';
      } else {
        adjudicationStatus = 'PENDING_REVIEW';
      }
    }

    const judgesList = evaluations.map((e) => {
      const effectiveTotal =
        typeof e.totalScore === 'number' && !Number.isNaN(e.totalScore)
          ? e.totalScore
          : Object.values(e.scores || {}).reduce((acc, v) => acc + Number(v), 0);
      return {
        judgeId: e.judgeId,
        judgeName: e.judgeName,
        judgeEmail: e.judgeEmail,
        totalScore: effectiveTotal,
        decisionMode: e.decisionMode || 'MODIFY',
        overallComments: e.overallComments || e.deductionNotes || '',
        submittedAt: e.submittedAt || e.createdAt,
        deltaFromMean: Math.round((effectiveTotal - overallMeanScore) * 100) / 100,
      };
    });

    return {
      submissionId,
      referenceId: refId,
      projectTitle,
      competitionId: compId,
      assignedJudgesCount: assignments.length,
      completedJudgesCount: evaluations.length,
      missingJudgeEvaluations: missingJudges,
      hasMissingEvaluations: missingJudges.length > 0,
      judges: judgesList,
      overallMeanScore,
      overallMedianScore,
      overallScoreSpread,
      overallSpreadPercentage,
      overallVariance,
      overallStandardDeviation,
      isOverallDisputed,
      criterionDisagreements,
      highestVarianceCriterion: highestVarianceCritName,
      disputeSeverity,
      adjudicationStatus,
      activeAdjudicationId: activeAdj?.id,
    };
  }

  public async detectCompetitionDisagreements(
    competitionId: string,
    thresholdsInput?: Partial<DisagreementThresholds>,
    options?: FirestoreExecutionOptions
  ): Promise<SubmissionDisagreementAnalysis[]> {
    // 1. Load all evaluations for this competition
    const allEvals = await judgeAssignmentService.listAllEvaluations(
      competitionId,
      options
    );

    // Group evaluations by submissionId
    const subIds = Array.from(new Set(allEvals.map((e) => e.submissionId)));
    const results: SubmissionDisagreementAnalysis[] = [];

    for (const subId of subIds) {
      const analysis = await this.analyzeSubmissionDisagreement(subId, thresholdsInput, options);
      results.push(analysis);
    }

    // Sort by dispute severity: CRITICAL -> HIGH -> MODERATE -> LOW -> NONE
    const severityWeight: Record<DisputeSeverity, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MODERATE: 2,
      LOW: 1,
      NONE: 0,
    };

    return results.sort((a, b) => severityWeight[b.disputeSeverity] - severityWeight[a.disputeSeverity]);
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. ADJUDICATION & CLARIFICATION WORKFLOW
  // ─────────────────────────────────────────────────────────────────

  public async getAdjudicationForSubmission(
    submissionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<AdjudicationRecord | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(collection(fs, 'adjudications'), where('submissionId', '==', submissionId));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        return snap.docs[0].data() as AdjudicationRecord;
      } catch (err) {
        throw mapFirestoreError(err, 'getAdjudicationForSubmission', 'adjudications');
      }
    }

    for (const adj of this.adjudications.values()) {
      if (adj.submissionId === submissionId) return adj;
    }
    return null;
  }

  /**
   * Request clarification from a specific judge regarding disputed criteria.
   */
  public async requestClarification(
    params: {
      submissionId: string;
      judgeId: string;
      criteriaIds: string[];
      question: string;
      requestedBy: string;
      requestedByName: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<ClarificationRequest> {
    const analysis = await this.analyzeSubmissionDisagreement(params.submissionId, undefined, options);
    const judgeDetail = analysis.judges.find((j) => j.judgeId === params.judgeId);
    const judgeName = judgeDetail?.judgeName || 'Judge';

    const req: ClarificationRequest = {
      requestId: `clarif-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      judgeId: params.judgeId,
      judgeName,
      criteriaIds: params.criteriaIds,
      question: params.question,
      requestedBy: params.requestedBy,
      requestedByName: params.requestedByName,
      requestedAt: new Date().toISOString(),
    };

    let adj = await this.getAdjudicationForSubmission(params.submissionId, options);
    const now = new Date().toISOString();

    if (!adj) {
      adj = {
        id: `adj-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        competitionId: analysis.competitionId,
        submissionId: params.submissionId,
        referenceId: analysis.referenceId,
        disputedCriterionIds: params.criteriaIds,
        resolutionType: 'PANEL_CONSENSUS',
        originalJudgeScores: analysis.judges.map((j) => ({
          judgeId: j.judgeId,
          judgeName: j.judgeName,
          scores: {},
          totalScore: j.totalScore,
        })),
        adjustedScores: {},
        adjustedTotalScore: analysis.overallMeanScore,
        resolutionRationale: 'Clarification requested from judge before final resolution.',
        clarificationRequests: [req],
        adjudicatorId: params.requestedBy,
        adjudicatorName: params.requestedByName,
        adjudicatorRole: 'ORGANIZER',
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
      };
    } else {
      adj = {
        ...adj,
        clarificationRequests: [...adj.clarificationRequests, req],
        updatedAt: now,
      };
    }

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(doc(fs, 'adjudications', adj.id), withServerTimestamps(sanitizeFirestoreData(adj), false));
      } catch (err) {
        throw mapFirestoreError(err, 'requestClarification', 'adjudications');
      }
    } else {
      this.adjudications.set(adj.id, adj);
    }

    return req;
  }

  /**
   * Records a judge's clarification response.
   */
  public async recordClarificationResponse(
    params: {
      adjudicationId: string;
      requestId: string;
      response: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<AdjudicationRecord> {
    let adj: AdjudicationRecord | null = null;
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'adjudications', params.adjudicationId));
        if (snap.exists()) {
          adj = snap.data() as AdjudicationRecord;
        }
      } catch (err) {
        throw mapFirestoreError(err, 'recordClarificationResponse', 'adjudications');
      }
    } else {
      adj = this.adjudications.get(params.adjudicationId) || null;
    }

    if (!adj) {
      throw new Error(`Adjudication "${params.adjudicationId}" not found.`);
    }

    const now = new Date().toISOString();
    const updatedReqs = adj.clarificationRequests.map((r) => {
      if (r.requestId === params.requestId) {
        return { ...r, response: params.response, respondedAt: now };
      }
      return r;
    });

    const updatedAdj: AdjudicationRecord = {
      ...adj,
      clarificationRequests: updatedReqs,
      updatedAt: now,
    };

    if (fs) {
      try {
        await updateDoc(doc(fs, 'adjudications', params.adjudicationId), withServerTimestamps(sanitizeFirestoreData(updatedAdj), false));
      } catch (err) {
        throw mapFirestoreError(err, 'recordClarificationResponse', 'adjudications');
      }
    } else {
      this.adjudications.set(params.adjudicationId, updatedAdj);
    }

    return updatedAdj;
  }

  /**
   * Saves or updates an adjudication resolution.
   * STRICT GOVERNANCE RULE:
   * Original human judge evaluations in /humanEvaluations are NEVER silently overwritten.
   * Adjudications are recorded in /adjudications with full rationale, preserve original scores,
   * and log an immutable audit event.
   */
  public async saveAdjudicationResolution(
    payload: {
      submissionId: string;
      competitionId: string;
      disputedCriterionIds: string[];
      resolutionType: AdjudicationResolutionType;
      adjustedScores: Record<string, number>;
      resolutionRationale: string;
      adjudicatorId: string;
      adjudicatorName: string;
      adjudicatorRole?: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<AdjudicationRecord> {
    if (!payload.resolutionRationale || payload.resolutionRationale.trim().length === 0) {
      throw new Error('Adjudication resolution requires a written audit rationale.');
    }

    const analysis = await this.analyzeSubmissionDisagreement(
      payload.submissionId,
      undefined,
      options
    );

    const adjustedTotalScore = Object.values(payload.adjustedScores).reduce(
      (acc, s) => acc + Number(s),
      0
    );

    const now = new Date().toISOString();
    const existing = await this.getAdjudicationForSubmission(payload.submissionId, options);
    const adjId = existing?.id || `adj-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    // Compile original scores snapshot without mutating the source
    const originalJudgeScores = analysis.judges.map((j) => {
      const judgeScoresMap: Record<string, number> = {};
      analysis.criterionDisagreements.forEach((crit) => {
        const sc = crit.scores.find((s) => s.judgeId === j.judgeId);
        if (sc) judgeScoresMap[crit.criterionId] = sc.score;
      });
      return {
        judgeId: j.judgeId,
        judgeName: j.judgeName,
        scores: judgeScoresMap,
        totalScore: j.totalScore,
      };
    });

    const record: AdjudicationRecord = {
      id: adjId,
      organizationId: existing?.organizationId || '',
      competitionId: payload.competitionId,
      submissionId: payload.submissionId,
      referenceId: analysis.referenceId,
      disputedCriterionIds: payload.disputedCriterionIds,
      resolutionType: payload.resolutionType,
      originalJudgeScores,
      adjustedScores: payload.adjustedScores,
      adjustedTotalScore,
      resolutionRationale: payload.resolutionRationale,
      clarificationRequests: existing?.clarificationRequests || [],
      adjudicatorId: payload.adjudicatorId,
      adjudicatorName: payload.adjudicatorName,
      adjudicatorRole: payload.adjudicatorRole || 'ORGANIZER',
      status: 'DRAFT',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(doc(fs, 'adjudications', adjId), withServerTimestamps(sanitizeFirestoreData(record), !existing));
      } catch (err) {
        throw mapFirestoreError(err, 'saveAdjudicationResolution', 'adjudications');
      }
    } else {
      this.adjudications.set(adjId, record);
    }

    // Log governance audit trail
    governanceAuditService.recordEvent({
      category: 'ADMIN_OVERRIDE',
      action: 'SCORE_OVERRIDDEN',
      actorId: payload.adjudicatorId,
      actorName: payload.adjudicatorName,
      actorRole: (payload.adjudicatorRole as 'ORGANIZER' | 'JUDGE' | 'SYSTEM') || 'ORGANIZER',
      competitionId: payload.competitionId,
      targetId: `adjudication/${adjId}`,
      targetLabel: 'Adjudication Record',
      reason: payload.resolutionRationale,
      metadata: {
        submissionId: payload.submissionId,
        referenceId: analysis.referenceId,
        resolutionType: payload.resolutionType,
        disputedCriteria: payload.disputedCriterionIds,
        adjustedTotalScore,
      },
    });

    return record;
  }

  /**
   * Approves an adjudication adjustment and registers it with the official scoring ledger.
   * The original HumanJudgeEvaluation documents remain 100% untouched.
   */
  public async approveAdjudicationAdjustment(
    adjudicationId: string,
    approver: { id: string; name: string; role?: string },
    options?: FirestoreExecutionOptions
  ): Promise<AdjudicationRecord> {
    let adj: AdjudicationRecord | null = null;
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'adjudications', adjudicationId));
        if (snap.exists()) {
          adj = snap.data() as AdjudicationRecord;
        }
      } catch (err) {
        throw mapFirestoreError(err, 'approveAdjudicationAdjustment', 'adjudications');
      }
    } else {
      adj = this.adjudications.get(adjudicationId) || null;
    }

    if (!adj) {
      throw new Error(`Adjudication "${adjudicationId}" not found.`);
    }

    const now = new Date().toISOString();
    const approvedAdj: AdjudicationRecord = {
      ...adj,
      status: 'APPROVED',
      approvedAt: now,
      updatedAt: now,
    };

    if (fs) {
      try {
        await updateDoc(doc(fs, 'adjudications', adjudicationId), withServerTimestamps(sanitizeFirestoreData(approvedAdj), false));
      } catch (err) {
        throw mapFirestoreError(err, 'approveAdjudicationAdjustment', 'adjudications');
      }
    } else {
      this.adjudications.set(adjudicationId, approvedAdj);
    }

    // Append adjustment entries to official scoring ledger for each adjusted criterion
    for (const [critId, adjustedScore] of Object.entries(approvedAdj.adjustedScores)) {
      try {
        await scoringLedgerService.appendContributionDurable({
          organizationId: approvedAdj.organizationId || 'org-default',
          competitionId: approvedAdj.competitionId,
          entryId: approvedAdj.submissionId,
          referenceId: approvedAdj.referenceId,
          evaluationId: `adj-${approvedAdj.id}`,
          criterionId: critId,
          score: adjustedScore,
          maxScore: 25,
          source: 'HUMAN',
          actorId: approver.id,
          actorName: approver.name,
          reasonForAdjustment: `Adjudication Approved: ${approvedAdj.resolutionType} - ${approvedAdj.resolutionRationale}`,
          isAdjustment: true,
          authorizedSource: 'ORGANIZER_AUTHORIZED_WORKFLOW',
        }, options);
      } catch (ledgerErr) {
        console.warn('Scoring ledger adjustment note:', ledgerErr);
      }
    }

    // Log final approval audit
    governanceAuditService.recordEvent({
      category: 'ADMIN_OVERRIDE',
      action: 'EVALUATION_SUBMITTED',
      actorId: approver.id,
      actorName: approver.name,
      actorRole: (approver.role as 'ORGANIZER' | 'JUDGE' | 'SYSTEM') || 'ORGANIZER',
      competitionId: approvedAdj.competitionId,
      targetId: `adjudication/${adjudicationId}`,
      targetLabel: 'Adjudication Approval',
      reason: `Adjudication approved: ${approvedAdj.resolutionRationale}`,
      metadata: {
        submissionId: approvedAdj.submissionId,
        referenceId: approvedAdj.referenceId,
        status: 'APPROVED',
        approvedAt: now,
        adjustedTotalScore: approvedAdj.adjustedTotalScore,
      },
    });

    return approvedAdj;
  }

  // ─────────────────────────────────────────────────────────────────
  // 6. COMPETITION-WIDE ANALYTICS & INSIGHTS
  // ─────────────────────────────────────────────────────────────────

  public async getCompetitionDisagreementAnalytics(
    competitionId: string,
    thresholdsInput?: Partial<DisagreementThresholds>,
    options?: FirestoreExecutionOptions
  ): Promise<CompetitionDisagreementAnalytics> {
    const analyses = await this.detectCompetitionDisagreements(competitionId, thresholdsInput, options);

    const totalSubmissions = analyses.length;
    let consensusCount = 0;
    let disputedCount = 0;
    let adjudicatedCount = 0;
    let missingEvalsCount = 0;
    let totalVarianceSum = 0;

    const criterionDisputeStats = new Map<
      string,
      { name: string; totalVariance: number; occurrences: number; disputes: number }
    >();

    const judgeDeltas = new Map<string, { name: string; deltas: number[]; count: number }>();

    let lowVarianceCount = 0;
    let modVarianceCount = 0;
    let highVarianceCount = 0;

    analyses.forEach((a) => {
      totalVarianceSum += a.overallVariance;

      if (a.hasMissingEvaluations) missingEvalsCount++;

      if (a.adjudicationStatus === 'ADJUDICATED') {
        adjudicatedCount++;
      } else if (a.isOverallDisputed || a.disputeSeverity === 'HIGH' || a.disputeSeverity === 'CRITICAL') {
        disputedCount++;
      } else {
        consensusCount++;
      }

      if (a.overallScoreSpread <= 5) {
        lowVarianceCount++;
      } else if (a.overallScoreSpread <= 15) {
        modVarianceCount++;
      } else {
        highVarianceCount++;
      }

      // Criterion aggregation
      a.criterionDisagreements.forEach((crit) => {
        if (!criterionDisputeStats.has(crit.criterionId)) {
          criterionDisputeStats.set(crit.criterionId, {
            name: crit.criterionName,
            totalVariance: 0,
            occurrences: 0,
            disputes: 0,
          });
        }
        const stat = criterionDisputeStats.get(crit.criterionId)!;
        stat.totalVariance += crit.variance;
        stat.occurrences++;
        if (crit.isDisputed) stat.disputes++;
      });

      // Judge consistency tracking
      a.judges.forEach((j) => {
        if (!judgeDeltas.has(j.judgeId)) {
          judgeDeltas.set(j.judgeId, { name: j.judgeName, deltas: [], count: 0 });
        }
        const jd = judgeDeltas.get(j.judgeId)!;
        jd.deltas.push(j.deltaFromMean);
        jd.count++;
      });
    });

    const meanPanelVariance =
      totalSubmissions > 0 ? Math.round((totalVarianceSum / totalSubmissions) * 100) / 100 : 0;

    const criterionDisagreementRates: CriterionDisagreementRate[] = Array.from(
      criterionDisputeStats.entries()
    ).map(([id, stat]) => ({
      criterionId: id,
      criterionName: stat.name,
      averageVariance:
        stat.occurrences > 0 ? Math.round((stat.totalVariance / stat.occurrences) * 100) / 100 : 0,
      disputeCount: stat.disputes,
      disputeRatePercentage:
        stat.occurrences > 0 ? Math.round((stat.disputes / stat.occurrences) * 100) : 0,
    })).sort((a, b) => b.averageVariance - a.averageVariance);

    const judgeConsistencyRankings: JudgeConsistencyRanking[] = Array.from(
      judgeDeltas.entries()
    ).map(([jId, stat]) => {
      const avgDelta = this.calculateMean(stat.deltas);
      let tendency: JudgeConsistencyRanking['tendency'] = 'BALANCED';
      if (avgDelta >= 3) tendency = 'LEAN_HIGH';
      else if (avgDelta <= -3) tendency = 'LEAN_LOW';

      return {
        judgeId: jId,
        judgeName: stat.name,
        evaluationsCount: stat.count,
        meanDeltaFromConsensus: avgDelta,
        calibrationStatus: 'COMPLETED' as const,
        tendency,
      };
    }).sort((a, b) => Math.abs(a.meanDeltaFromConsensus) - Math.abs(b.meanDeltaFromConsensus));

    const totalCalculated = lowVarianceCount + modVarianceCount + highVarianceCount || 1;

    return {
      competitionId,
      totalSubmissionsReviewed: totalSubmissions,
      consensusSubmissionsCount: consensusCount,
      disputedSubmissionsCount: disputedCount,
      adjudicatedSubmissionsCount: adjudicatedCount,
      missingEvaluationsCount: missingEvalsCount,
      meanPanelVariance,
      criterionDisagreementRates,
      judgeConsistencyRankings,
      disagreementTrends: {
        lowVariancePct: Math.round((lowVarianceCount / totalCalculated) * 100),
        moderateVariancePct: Math.round((modVarianceCount / totalCalculated) * 100),
        highVariancePct: Math.round((highVarianceCount / totalCalculated) * 100),
      },
    };
  }
}

export const calibrationAndDisagreementService = new CalibrationAndDisagreementService();
