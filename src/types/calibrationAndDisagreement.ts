// ─────────────────────────────────────────────
// calibrationAndDisagreement.ts — Domain Types for Phase 12
// Proofly — Judge Calibration, Disagreement Detection & Adjudication Studio
// ─────────────────────────────────────────────

import type { RubricCriterion } from './authAndCompetition';

export type CalibrationStatus = 'ACTIVE' | 'ARCHIVED';

export interface SampleProjectArtifact {
  name: string;
  type: string; // 'PDF' | 'PPTX' | 'GITHUB_REPO' | 'DEPLOYMENT_URL' | 'TEXT_MARKDOWN' | 'OTHER'
  url?: string;
  contentSnippet?: string;
}

export interface SampleProjectDefinition {
  title: string;
  description: string;
  track?: string;
  submissionId?: string;
  referenceId?: string;
  artifacts?: SampleProjectArtifact[];
}

/**
 * Organizer-authored calibration exercise with sample submission and hidden benchmark scores.
 */
export interface CalibrationExercise {
  id: string;
  organizationId: string;
  competitionId: string;
  title: string;
  description: string;
  sampleProject: SampleProjectDefinition;
  rubric: RubricCriterion[];
  referenceScores: Record<string, number>; // criterionId -> benchmark score
  referenceReasoning: Record<string, string>; // criterionId -> benchmark justification
  status: CalibrationStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type CalibrationAlignmentLevel = 'EXACT' | 'CLOSE' | 'DEVIATION' | 'HIGH_CONFUSION';

export interface CriterionCalibrationAnalysis {
  criterionId: string;
  criterionName: string;
  maxScore: number;
  judgeScore: number;
  referenceScore: number;
  difference: number; // judgeScore - referenceScore
  absDifference: number;
  deviationPercentage: number;
  alignment: CalibrationAlignmentLevel;
  judgeComment?: string;
  referenceReasoning: string;
}

export type ScoringTendency =
  | 'BALANCED'
  | 'MILD_OVERSCORING'
  | 'SIGNIFICANT_OVERSCORING'
  | 'MILD_UNDERSCORING'
  | 'SIGNIFICANT_UNDERSCORING';

/**
 * A completed calibration exercise submitted by a human judge.
 */
export interface JudgeCalibrationSubmission {
  id: string;
  exerciseId: string;
  organizationId: string;
  competitionId: string;
  judgeId: string;
  judgeName: string;
  judgeEmail: string;
  proposedScores: Record<string, number>;
  criterionComments?: Record<string, string>;
  overallNotes?: string;
  totalProposedScore: number;
  totalReferenceScore: number;
  totalDifference: number; // proposed - reference
  averageScoreDeviation: number; // mean absolute deviation
  criterionDeviations: Record<string, CriterionCalibrationAnalysis>;
  overscoringCount: number;
  underscoringCount: number;
  exactCount: number;
  confusionCriteria: string[]; // criterion names with high deviation
  scoringPattern: ScoringTendency;
  submittedAt: string;
}

/**
 * Summary calibration report across all exercises completed by a judge.
 */
export interface JudgeCalibrationSummaryReport {
  judgeId: string;
  judgeName: string;
  judgeEmail: string;
  exercisesCompleted: number;
  overallAverageDeviation: number;
  overallBiasScore: number; // average signed difference (+ = lenient, - = strict)
  consistentAcrossExercises: boolean;
  frequentConfusionCriteria: string[];
  scoringTendency: 'BALANCED' | 'LEAN_LENIENT' | 'LEAN_STRICT' | 'VARIABLE';
  lastCalibratedAt: string;
  guidanceNote: string;
}

/**
 * Configurable thresholds for detecting score disagreements and anomalies.
 */
export interface DisagreementThresholds {
  criterionSpreadThreshold: number; // default: 5 pts spread (max - min on a single criterion)
  overallSpreadThreshold: number; // default: 15 pts spread across total scores
  criterionVarianceThreshold: number; // default: 6.0
  contradictoryHighThresholdPct: number; // default: 0.80 (80% score)
  contradictoryLowThresholdPct: number; // default: 0.40 (40% score)
}

export interface CriterionJudgeScoreDetail {
  judgeId: string;
  judgeName: string;
  judgeEmail?: string;
  score: number;
  comment?: string;
  evidenceReferences?: string[];
  deltaFromMean: number;
}

export interface CriterionDisagreement {
  criterionId: string;
  criterionName: string;
  maxScore: number;
  scores: CriterionJudgeScoreDetail[];
  meanScore: number;
  medianScore: number;
  variance: number;
  standardDeviation: number;
  minScore: number;
  maxScoreValue: number;
  scoreSpread: number; // maxScoreValue - minScore
  spreadPercentage: number;
  isLargeDifference: boolean;
  isContradictory: boolean;
  isDisputed: boolean;
  primaryCauseDescription: string;
}

export type DisputeSeverity = 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface MissingJudgeReviewDetail {
  judgeId: string;
  judgeName: string;
  judgeEmail: string;
  assignmentStatus: string;
}

/**
 * Detailed disagreement and variance analysis for a single submission.
 */
export interface SubmissionDisagreementAnalysis {
  submissionId: string;
  referenceId: string;
  projectTitle: string;
  competitionId: string;
  assignedJudgesCount: number;
  completedJudgesCount: number;
  missingJudgeEvaluations: MissingJudgeReviewDetail[];
  hasMissingEvaluations: boolean;
  judges: Array<{
    judgeId: string;
    judgeName: string;
    judgeEmail: string;
    totalScore: number;
    decisionMode: string;
    overallComments?: string;
    submittedAt: string;
    deltaFromMean: number;
  }>;
  overallMeanScore: number;
  overallMedianScore: number;
  overallScoreSpread: number;
  overallSpreadPercentage: number;
  overallVariance: number;
  overallStandardDeviation: number;
  isOverallDisputed: boolean;
  criterionDisagreements: CriterionDisagreement[];
  highestVarianceCriterion: string | null;
  disputeSeverity: DisputeSeverity;
  adjudicationStatus: 'NONE' | 'PENDING_REVIEW' | 'CLARIFICATION_REQUESTED' | 'ADJUDICATED';
  activeAdjudicationId?: string;
}

export type AdjudicationResolutionType =
  | 'MAINTAIN_AVERAGE'
  | 'UPHOLD_JUDGE_SCORE'
  | 'PANEL_CONSENSUS'
  | 'PANEL_MEDIAN'
  | 'CUSTOM_ADJUDICATION_ADJUSTMENT';

export interface ClarificationRequest {
  requestId: string;
  judgeId: string;
  judgeName: string;
  criteriaIds: string[];
  question: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  response?: string;
  respondedAt?: string;
}

/**
 * Formal, auditable adjudication record.
 * STRICT IMMUTABILITY RULE: Original human judge evaluations are NEVER overwritten.
 */
export interface AdjudicationRecord {
  id: string;
  organizationId?: string;
  competitionId: string;
  submissionId: string;
  referenceId: string;
  disputedCriterionIds: string[];
  resolutionType: AdjudicationResolutionType;
  originalJudgeScores: Array<{
    judgeId: string;
    judgeName: string;
    scores: Record<string, number>;
    totalScore: number;
  }>;
  adjustedScores: Record<string, number>; // criterionId -> final adjudicated score
  adjustedTotalScore: number;
  resolutionRationale: string;
  clarificationRequests: ClarificationRequest[];
  adjudicatorId: string;
  adjudicatorName: string;
  adjudicatorRole: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CriterionDisagreementRate {
  criterionId: string;
  criterionName: string;
  averageVariance: number;
  disputeCount: number;
  disputeRatePercentage: number;
}

export interface JudgeConsistencyRanking {
  judgeId: string;
  judgeName: string;
  evaluationsCount: number;
  meanDeltaFromConsensus: number;
  calibrationStatus: 'COMPLETED' | 'PENDING' | 'NOT_STARTED';
  tendency: 'BALANCED' | 'LEAN_HIGH' | 'LEAN_LOW';
}

/**
 * Competition-wide disagreement trends and judge consistency summary.
 */
export interface CompetitionDisagreementAnalytics {
  competitionId: string;
  totalSubmissionsReviewed: number;
  consensusSubmissionsCount: number;
  disputedSubmissionsCount: number;
  adjudicatedSubmissionsCount: number;
  missingEvaluationsCount: number;
  meanPanelVariance: number;
  criterionDisagreementRates: CriterionDisagreementRate[];
  judgeConsistencyRankings: JudgeConsistencyRanking[];
  disagreementTrends: {
    lowVariancePct: number;
    moderateVariancePct: number;
    highVariancePct: number;
  };
}
