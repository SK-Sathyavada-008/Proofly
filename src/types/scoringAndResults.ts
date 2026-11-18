// ─────────────────────────────────────────────
// scoringAndResults.ts — Domain Types for Phase 8: Scoring, Results & Analytics
// Proofly / Evalora — Append-Only Ledger, Aggregation Policies, Rankings & Audit
// ─────────────────────────────────────────────

import type { JudgeWorkloadSummary } from './judgeAndEvaluation';

export type AggregationPolicyType =
  | 'AVERAGE_JUDGE'
  | 'WEIGHTED_JUDGE'
  | 'AI_ASSISTED'
  | 'CRITERION_WEIGHTED'
  | 'ROUND_WISE';

export type TieBreakerType =
  | 'HIGHEST_WEIGHTED_CRITERION'
  | 'LOWEST_JUDGE_VARIANCE'
  | 'HIGHEST_SINGLE_JUDGE_SCORE'
  | 'HIGHEST_AI_SCORE'
  | 'EARLIEST_SUBMISSION'
  | 'REFERENCE_ID_ASC';

export interface TieBreakerRule {
  type: TieBreakerType;
  label: string;
  enabled: boolean;
  criterionId?: string;
}

export interface CompetitionScoringPolicy {
  competitionId: string;
  policyType: AggregationPolicyType;
  /**
   * STRICT GOVERNANCE RULE:
   * AI scores are NEVER counted toward official results unless the organizer
   * explicitly sets policyType = 'AI_ASSISTED' AND includeAiAsJudgeScore = true.
   */
  includeAiAsJudgeScore: boolean;
  /** Weight given to AI score (0.0 to 0.5) when AI_ASSISTED is explicitly enabled. */
  aiWeight: number;
  /** Map of judgeId -> multiplier weight (default 1.0) for WEIGHTED_JUDGE policy. */
  judgeWeights: Record<string, number>;
  /** Map of roundId -> percentage weight (e.g. { 'round-1': 40, 'round-2': 60 }) for ROUND_WISE policy. */
  roundWeights: Record<string, number>;
  /** Ordered tie-breaker rules applied deterministically when raw official scores match. */
  tieBreakers: TieBreakerRule[];
  updatedBy: string;
  updatedByName?: string;
  updatedAt: string;
}

export type ScoreContributionSource = 'AI' | 'HUMAN';

/**
 * Append-Only Score Contribution Ledger Entry.
 * Immutable once recorded — corrections must be appended as new adjustment entries.
 */
export interface ScoreLedgerEntry {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly competitionId: string;
  readonly entryId: string; // submissionId
  readonly referenceId?: string;
  readonly evaluationId: string;
  readonly criterionId: string;
  readonly criterionName?: string;
  readonly score: number;
  readonly maxScore: number;
  readonly source: ScoreContributionSource;
  readonly actorId: string;
  readonly actorName: string;
  readonly timestamp: string;
  readonly reasonForAdjustment: string;
  readonly roundId?: string;
  readonly isAdjustment?: boolean;
  readonly previousEntryId?: string;
}

export type RankingScope = 'OVERALL' | 'INDIVIDUAL' | 'TEAM' | 'CATEGORY' | 'ROUND';

export type ResultPublicationStatus = 'PROVISIONAL' | 'PUBLISHED' | 'UNPUBLISHED';

export interface JudgeContributionBreakdown {
  judgeId: string;
  judgeName: string;
  evaluationId: string;
  score: number;
  weight: number;
  roundId?: string;
  decisionMode: 'AGREE' | 'MODIFY' | 'REJECT';
  submittedAt: string;
}

export interface CriterionScoreSummary {
  criterionId: string;
  criterionName: string;
  averageScore: number;
  maxScore: number;
  weight: number;
}

export interface RankedEntry {
  rank: number;
  isTied: boolean;
  tieBrokenBy?: string;
  submissionId: string;
  referenceId: string;
  projectTitle: string;
  submissionType: 'INDIVIDUAL' | 'TEAM';
  teamOrParticipantName: string;
  category: string;
  roundId?: string;
  officialScore: number;
  maxPossibleScore: number;
  percentageScore: number;
  humanAverageScore: number | null;
  aiScore: number | null;
  aiHumanDelta: number | null; // humanAverageScore - aiScore
  judgeCount: number;
  judgeBreakdown: JudgeContributionBreakdown[];
  criterionSummaries: Record<string, CriterionScoreSummary>;
  roundScores: Record<string, number>;
  submittedAt: string;
  resultState: 'PROVISIONAL' | 'OFFICIAL';
  policyApplied: AggregationPolicyType;
}

export interface ResultPublicationRecord {
  id: string;
  competitionId: string;
  competitionTitle: string;
  publicSlug: string;
  status: ResultPublicationStatus;
  version: number;
  policySnapshot: CompetitionScoringPolicy;
  entries: RankedEntry[];
  publishedBy?: string;
  publishedByName?: string;
  publishedAt?: string;
  approvalReason?: string;
  unpublishedBy?: string;
  unpublishedByName?: string;
  unpublishedAt?: string;
  unpublishReason?: string;
  updatedAt: string;
}

export interface ScoreDistributionBucket {
  bucket: string;
  min: number;
  max: number;
  humanCount: number;
  aiCount: number;
}

export interface AiHumanEntryComparison {
  submissionId: string;
  referenceId: string;
  projectTitle: string;
  category: string;
  aiScore: number;
  humanScore: number;
  delta: number; // humanScore - aiScore
  absDelta: number;
  decisionModes: Array<'AGREE' | 'MODIFY' | 'REJECT'>;
}

export interface AiHumanComparisonReport {
  /** Mandatory governance disclaimer — AI/human alignment is never proof of correctness. */
  disclaimer: string;
  comparedCount: number;
  meanSignedDifference: number; // avg(human - ai)
  meanAbsoluteDifference: number; // avg(|human - ai|)
  withinFivePointsCount: number;
  withinFivePointsPercent: number;
  aiHigherCount: number;
  humanHigherCount: number;
  exactMatchCount: number;
  decisionBreakdown: {
    agree: number;
    modify: number;
    reject: number;
  };
  perEntryComparison: AiHumanEntryComparison[];
}

export interface CompetitionAnalyticsReport {
  competitionId: string;
  competitionTitle: string;
  totalSubmissions: number;
  validSubmissions: number;
  aiEvaluationsCompleted: number;
  aiEvaluationsFailed: number;
  pendingJudgeEvaluations: number;
  inProgressJudgeEvaluations: number;
  completedJudgeEvaluations: number;
  conflictDeclarations: number;
  averageHumanScore: number | null;
  averageAiScore: number | null;
  averageOfficialScore: number | null;
  scoreDistribution: ScoreDistributionBucket[];
  judgeWorkload: JudgeWorkloadSummary[];
  evaluationProgressPercent: number;
  aiHumanComparison: AiHumanComparisonReport;
  generatedAt: string;
}

export type GovernanceAuditCategory =
  | 'SCORE_CHANGE'
  | 'EVALUATION_SUBMISSION'
  | 'ASSIGNMENT_CHANGE'
  | 'PUBLICATION_ACTION'
  | 'REOPENED_EVALUATION'
  | 'ADMIN_OVERRIDE'
  | 'POLICY_CHANGE';

export interface GovernanceAuditEvent {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly competitionId: string;
  readonly category: GovernanceAuditCategory;
  readonly action: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly actorRole: 'ORGANIZER' | 'JUDGE' | 'SYSTEM';
  readonly targetId: string;
  readonly targetLabel?: string;
  readonly reason: string;
  readonly metadata?: Record<string, unknown>;
  readonly timestamp: string;
}
