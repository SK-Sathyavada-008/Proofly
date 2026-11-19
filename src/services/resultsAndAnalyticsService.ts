// ─────────────────────────────────────────────
// resultsAndAnalyticsService.ts — Phase 8: Scoring, Results, Publication & Analytics
// Proofly / Evalora — Deterministic Aggregation, Tie-Breakers, Official Snapshots & Telemetry
// ─────────────────────────────────────────────

import type { Competition, RubricCriterion } from '../types/authAndCompetition';
import type { ProjectSubmission } from '../types/submission';
import type { AiEvaluationReport } from '../types/aiEvaluation';
import type { HumanJudgeEvaluation } from '../types/judgeAndEvaluation';
import type {
  AggregationPolicyType,
  AiHumanComparisonReport,
  AiHumanEntryComparison,
  CompetitionAnalyticsReport,
  CompetitionScoringPolicy,
  CriterionScoreSummary,
  JudgeContributionBreakdown,
  RankedEntry,
  RankingScope,
  ResultPublicationRecord,
  ScoreDistributionBucket,
  TieBreakerRule,
} from '../types/scoringAndResults';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  startAfter,
  where,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import { isDemoModeEnabled } from '../config/firebase';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  PersistenceError,
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginatedResult,
  type PaginationOptions,
} from './firestorePersistenceService';
import {
  resolveTrustedExecutor,
  type TrustedBackendExecutor,
} from './trustedBackendPersistence';
import { competitionService } from './competitionService';
import { submissionService } from './submissionService';
import { evaluationPipelineService } from './evaluationPipelineService';
import { judgeAssignmentService } from './judgeAssignmentService';
import { scoringLedgerService } from './scoringLedgerService';
import { governanceAuditService } from './governanceAuditService';

export const AI_HUMAN_CORRELATION_DISCLAIMER =
  'IMPORTANT GOVERNANCE NOTICE: AI/human score agreement measures statistical alignment only and is NEVER proof of correctness. Human judge decisions remain the sole official authority unless an organizer explicitly configures an AI-assisted policy.';

export const DEFAULT_TIE_BREAKERS: TieBreakerRule[] = [
  {
    type: 'HIGHEST_WEIGHTED_CRITERION',
    label: 'Highest Weighted Criterion Score',
    enabled: true,
  },
  {
    type: 'LOWEST_JUDGE_VARIANCE',
    label: 'Lowest Judge Score Variance (Strongest Consensus)',
    enabled: true,
  },
  {
    type: 'HIGHEST_SINGLE_JUDGE_SCORE',
    label: 'Highest Single Judge Score',
    enabled: false,
  },
  {
    type: 'HIGHEST_AI_SCORE',
    label: 'Highest AI Pre-Evaluation Score',
    enabled: false,
  },
  {
    type: 'EARLIEST_SUBMISSION',
    label: 'Earliest Submission Timestamp',
    enabled: false,
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeVariance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface EntryScoringInput {
  submission: ProjectSubmission;
  humanEvaluations: HumanJudgeEvaluation[]; // only status === 'SUBMITTED' should be passed for official scoring
  aiReport: AiEvaluationReport | null;
  rubric: RubricCriterion[];
  roundFilterId?: string;
}

class ResultsAndAnalyticsService {
  // Unit-test-only / read-through maps (NEVER used as silent write fallback when Firestore is active)
  private policies: Map<string, CompetitionScoringPolicy> = new Map();
  private publications: Map<string, ResultPublicationRecord> = new Map();
  private demoSeededCompetitions: Set<string> = new Set();

  // ─────────────────────────────────────────────
  // 1. SCORING POLICY CONFIGURATION (Firestore: /scoringPolicies/{competitionId})
  // ─────────────────────────────────────────────

  /**
   * Loads the authoritative scoring policy from Firestore (or returns default if none configured).
   */
  public async loadScoringPolicyFromFirestore(
    competitionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<CompetitionScoringPolicy> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'scoringPolicies', competitionId));
        if (snap.exists()) {
          const policy = snap.data() as CompetitionScoringPolicy;
          this.policies.set(competitionId, policy);
          return policy;
        }
      } catch (err) {
        throw mapFirestoreError(err, 'loadScoringPolicyFromFirestore', 'scoringPolicies');
      }
    }
    return this.getScoringPolicy(competitionId);
  }

  /**
   * Durably persists an updated scoring policy to Firestore `/scoringPolicies/{competitionId}`.
   * Throws PersistenceError on failure (zero silent fallback).
   */
  public async saveScoringPolicyDurable(
    params: {
      organizationId: string;
      competitionId: string;
      policyType: AggregationPolicyType;
      includeAiAsJudgeScore?: boolean;
      aiWeight?: number;
      judgeWeights?: Record<string, number>;
      roundWeights?: Record<string, number>;
      tieBreakers?: TieBreakerRule[];
      organizerUserId: string;
      organizerName: string;
      actorRole: 'ORGANIZER' | 'JUDGE' | 'PARTICIPANT';
      reason: string;
    },
    options?: FirestoreExecutionOptions & { trustedExecutor?: TrustedBackendExecutor }
  ): Promise<CompetitionScoringPolicy> {
    const updated = this.buildValidatedPolicy(params);
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      try {
        await setDoc(
          doc(fs, 'scoringPolicies', params.competitionId),
          withServerTimestamps(sanitizeFirestoreData(updated), true)
        );
      } catch (err) {
        throw mapFirestoreError(err, 'saveScoringPolicyDurable', 'scoringPolicies');
      }
    }

    this.policies.set(params.competitionId, updated);

    if (options?.trustedExecutor) {
      await governanceAuditService.recordEventDurable(
        {
          organizationId: params.organizationId,
          competitionId: params.competitionId,
          category: 'POLICY_CHANGE',
          action: 'SCORING_POLICY_UPDATED',
          actorId: params.organizerUserId,
          actorName: params.organizerName,
          actorRole: 'ORGANIZER',
          targetId: params.competitionId,
          targetLabel: `Scoring Policy (${updated.policyType})`,
          reason: params.reason.trim(),
          metadata: {
            newPolicyType: updated.policyType,
            includeAiAsJudgeScore: updated.includeAiAsJudgeScore,
            aiWeight: updated.aiWeight,
          },
        },
        { trustedExecutor: options.trustedExecutor }
      );
    }

    return updated;
  }

  private buildValidatedPolicy(params: {
    organizationId?: string;
    competitionId: string;
    policyType: AggregationPolicyType;
    includeAiAsJudgeScore?: boolean;
    aiWeight?: number;
    judgeWeights?: Record<string, number>;
    roundWeights?: Record<string, number>;
    tieBreakers?: TieBreakerRule[];
    organizerUserId: string;
    organizerName: string;
    actorRole: 'ORGANIZER' | 'JUDGE' | 'PARTICIPANT';
    reason: string;
  }): CompetitionScoringPolicy {
    if (params.actorRole !== 'ORGANIZER') {
      throw new Error('Only authorized organizers may modify official competition scoring policies.');
    }

    if (!params.reason || params.reason.trim().length < 3) {
      throw new Error('A documented reason is required when updating scoring aggregation policies.');
    }

    const previous = this.getScoringPolicy(params.competitionId);

    const includeAi =
      params.policyType === 'AI_ASSISTED' && Boolean(params.includeAiAsJudgeScore);
    const sanitizedAiWeight = includeAi
      ? Math.max(0, Math.min(0.5, Number(params.aiWeight ?? 0.2)))
      : 0;

    const cleanJudgeWeights: Record<string, number> = {};
    if (params.judgeWeights) {
      for (const [jId, w] of Object.entries(params.judgeWeights)) {
        cleanJudgeWeights[jId] = Math.max(0.1, Math.min(10, Number(w) || 1));
      }
    } else {
      Object.assign(cleanJudgeWeights, previous.judgeWeights);
    }

    const cleanRoundWeights: Record<string, number> = {};
    if (params.roundWeights) {
      for (const [rId, w] of Object.entries(params.roundWeights)) {
        cleanRoundWeights[rId] = Math.max(0, Number(w) || 0);
      }
    } else {
      Object.assign(cleanRoundWeights, previous.roundWeights);
    }

    return {
      organizationId: params.organizationId || previous.organizationId,
      competitionId: params.competitionId,
      policyType: params.policyType,
      includeAiAsJudgeScore: includeAi,
      aiWeight: sanitizedAiWeight,
      judgeWeights: cleanJudgeWeights,
      roundWeights: cleanRoundWeights,
      tieBreakers: params.tieBreakers
        ? params.tieBreakers.map((tb) => ({ ...tb }))
        : previous.tieBreakers.map((tb) => ({ ...tb })),
      updatedBy: params.organizerUserId,
      updatedByName: params.organizerName,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns the active scoring policy for a competition.
   * Defaults to AVERAGE_JUDGE with includeAiAsJudgeScore = false.
   */
  public getScoringPolicy(competitionId: string): CompetitionScoringPolicy {
    const existing = this.policies.get(competitionId);
    if (existing) return existing;

    const defaultPolicy: CompetitionScoringPolicy = {
      competitionId,
      policyType: 'AVERAGE_JUDGE',
      includeAiAsJudgeScore: false,
      aiWeight: 0,
      judgeWeights: {},
      roundWeights: {
        'round-1': 40,
        'round-2': 60,
      },
      tieBreakers: DEFAULT_TIE_BREAKERS.map((tb) => ({ ...tb })),
      updatedBy: 'system',
      updatedByName: 'System Default',
      updatedAt: new Date().toISOString(),
    };

    return defaultPolicy;
  }

  /**
   * Updates the scoring policy (unit-test sync helper; use saveScoringPolicyDurable for Firestore).
   */
  public updateScoringPolicy(params: {
    organizationId?: string;
    competitionId: string;
    policyType: AggregationPolicyType;
    includeAiAsJudgeScore?: boolean;
    aiWeight?: number;
    judgeWeights?: Record<string, number>;
    roundWeights?: Record<string, number>;
    tieBreakers?: TieBreakerRule[];
    organizerUserId: string;
    organizerName: string;
    actorRole: 'ORGANIZER' | 'JUDGE' | 'PARTICIPANT';
    reason: string;
  }): CompetitionScoringPolicy {
    const previous = this.getScoringPolicy(params.competitionId);
    const updated = this.buildValidatedPolicy(params);

    this.policies.set(params.competitionId, updated);

    governanceAuditService.recordEvent({
      organizationId: updated.organizationId,
      competitionId: params.competitionId,
      category: 'POLICY_CHANGE',
      action: 'SCORING_POLICY_UPDATED',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      actorRole: 'ORGANIZER',
      targetId: params.competitionId,
      targetLabel: `Scoring Policy (${updated.policyType})`,
      reason: params.reason.trim(),
      metadata: {
        previousPolicyType: previous.policyType,
        newPolicyType: updated.policyType,
        includeAiAsJudgeScore: updated.includeAiAsJudgeScore,
        aiWeight: updated.aiWeight,
      },
    });

    return updated;
  }

  // ─────────────────────────────────────────────
  // 2. DETERMINISTIC SCORE AGGREGATION ENGINE
  // ─────────────────────────────────────────────

  /**
   * Computes a single entry's official score according to the active policy.
   * Pure and deterministic given the inputs.
   */
  public computeEntryScore(
    input: EntryScoringInput,
    policy: CompetitionScoringPolicy
  ): {
    eligibleForRanking: boolean;
    officialScore: number;
    maxPossibleScore: number;
    percentageScore: number;
    humanAverageScore: number | null;
    aiScore: number | null;
    aiHumanDelta: number | null;
    judgeBreakdown: JudgeContributionBreakdown[];
    criterionSummaries: Record<string, CriterionScoreSummary>;
    roundScores: Record<string, number>;
  } {
    const rubric = input.rubric.length > 0
      ? input.rubric
      : [
          { id: 'crit-tech', name: 'Technological Implementation', description: '', weight: 25, maxScore: 25 },
          { id: 'crit-design', name: 'Design & User Experience', description: '', weight: 25, maxScore: 25 },
          { id: 'crit-impact', name: 'Potential Impact', description: '', weight: 25, maxScore: 25 },
          { id: 'crit-idea', name: 'Quality of the Idea', description: '', weight: 25, maxScore: 25 },
        ];

    const maxPossibleScore =
      rubric.reduce((sum, c) => sum + (c.maxScore || 25), 0) || 100;

    // Filter only SUBMITTED human evaluations (drafts are never included in official scores!)
    let submittedHuman = input.humanEvaluations.filter((e) => e.status === 'SUBMITTED');
    if (input.roundFilterId) {
      submittedHuman = submittedHuman.filter(
        (e) => (e.roundId || 'round-1') === input.roundFilterId
      );
    }

    const aiScore = input.aiReport ? round2(input.aiReport.overallScore) : null;

    // Build judge breakdown
    const judgeBreakdown: JudgeContributionBreakdown[] = submittedHuman
      .map((e) => ({
        judgeId: e.judgeId,
        judgeName: e.judgeName,
        evaluationId: e.id,
        score: round2(e.totalScore),
        weight: policy.judgeWeights[e.judgeId] ?? 1.0,
        roundId: e.roundId || 'round-1',
        decisionMode: e.decisionMode,
        submittedAt: e.submittedAt || e.updatedAt,
      }))
      .sort((a, b) => a.judgeId.localeCompare(b.judgeId));

    // Compute simple human average
    const humanAverageScore =
      judgeBreakdown.length > 0
        ? round2(
            judgeBreakdown.reduce((sum, j) => sum + j.score, 0) / judgeBreakdown.length
          )
        : null;

    // Compute per-criterion human averages
    const criterionSummaries: Record<string, CriterionScoreSummary> = {};
    for (const crit of rubric) {
      const scoresForCrit = submittedHuman
        .map((e) => e.scores?.[crit.id])
        .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

      const avg =
        scoresForCrit.length > 0
          ? round2(scoresForCrit.reduce((a, b) => a + b, 0) / scoresForCrit.length)
          : 0;

      criterionSummaries[crit.id] = {
        criterionId: crit.id,
        criterionName: crit.name,
        averageScore: avg,
        maxScore: crit.maxScore || 25,
        weight: crit.weight || 25,
      };
    }

    // Compute per-round human averages
    const roundBuckets: Record<string, number[]> = {};
    for (const e of submittedHuman) {
      const rId = e.roundId || 'round-1';
      if (!roundBuckets[rId]) roundBuckets[rId] = [];
      roundBuckets[rId].push(e.totalScore);
    }
    const roundScores: Record<string, number> = {};
    for (const [rId, vals] of Object.entries(roundBuckets)) {
      roundScores[rId] = round2(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    const aiHumanDelta =
      humanAverageScore !== null && aiScore !== null
        ? round2(humanAverageScore - aiScore)
        : null;

    // Determine eligibility & compute official score based on policy
    const aiExplicitlyEnabled =
      policy.policyType === 'AI_ASSISTED' &&
      policy.includeAiAsJudgeScore === true &&
      policy.aiWeight > 0;

    if (submittedHuman.length === 0 && !aiExplicitlyEnabled) {
      return {
        eligibleForRanking: false,
        officialScore: 0,
        maxPossibleScore,
        percentageScore: 0,
        humanAverageScore: null,
        aiScore,
        aiHumanDelta: null,
        judgeBreakdown,
        criterionSummaries,
        roundScores,
      };
    }

    if (submittedHuman.length === 0 && aiExplicitlyEnabled && aiScore === null) {
      return {
        eligibleForRanking: false,
        officialScore: 0,
        maxPossibleScore,
        percentageScore: 0,
        humanAverageScore: null,
        aiScore: null,
        aiHumanDelta: null,
        judgeBreakdown,
        criterionSummaries,
        roundScores,
      };
    }

    let officialScore = 0;

    switch (policy.policyType) {
      case 'AVERAGE_JUDGE': {
        // Default policy: human average only; AI is NEVER counted
        officialScore = humanAverageScore ?? 0;
        break;
      }

      case 'WEIGHTED_JUDGE': {
        // Weighted mean across human judges; AI is NEVER counted
        const totalWeight = judgeBreakdown.reduce((sum, j) => sum + j.weight, 0);
        if (totalWeight > 0) {
          const weightedSum = judgeBreakdown.reduce((sum, j) => sum + j.score * j.weight, 0);
          officialScore = round2(weightedSum / totalWeight);
        } else {
          officialScore = humanAverageScore ?? 0;
        }
        break;
      }

      case 'MEDIAN': {
        // Median of finalized human judge scores
        const judgeScores = judgeBreakdown.map((j) => j.score).sort((a, b) => a - b);
        if (judgeScores.length === 0) {
          officialScore = 0;
        } else if (judgeScores.length % 2 === 1) {
          officialScore = judgeScores[Math.floor(judgeScores.length / 2)];
        } else {
          const mid = judgeScores.length / 2;
          officialScore = round2((judgeScores[mid - 1] + judgeScores[mid]) / 2);
        }
        break;
      }

      case 'TRIMMED_MEAN': {
        // Lowest & highest judge score exclusion (Olympic scoring) for 3+ judges
        const judgeScores = judgeBreakdown.map((j) => j.score).sort((a, b) => a - b);
        if (judgeScores.length <= 2) {
          officialScore = humanAverageScore ?? 0;
        } else {
          const trimmed = judgeScores.slice(1, judgeScores.length - 1);
          officialScore = round2(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
        }
        break;
      }

      case 'AI_ASSISTED': {
        // STRICT RULE: Only count AI when organizer explicitly enabled includeAiAsJudgeScore
        if (aiExplicitlyEnabled && aiScore !== null) {
          if (humanAverageScore !== null) {
            const w = Math.max(0, Math.min(0.5, policy.aiWeight));
            officialScore = round2(humanAverageScore * (1 - w) + aiScore * w);
          } else {
            officialScore = aiScore;
          }
        } else {
          // Guardrail: fallback strictly to human judge average
          officialScore = humanAverageScore ?? 0;
        }
        break;
      }

      case 'CRITERION_WEIGHTED': {
        // Compute normalized criterion-weighted score across human judges
        const totalRubricWeight = rubric.reduce((sum, c) => sum + (c.weight || 0), 0);
        if (totalRubricWeight > 0) {
          let weightedFraction = 0;
          for (const crit of rubric) {
            const summary = criterionSummaries[crit.id];
            const ratio = summary.maxScore > 0 ? summary.averageScore / summary.maxScore : 0;
            weightedFraction += ratio * (crit.weight / totalRubricWeight);
          }
          officialScore = round2(weightedFraction * maxPossibleScore);
        } else {
          officialScore = humanAverageScore ?? 0;
        }
        break;
      }

      case 'ROUND_WISE': {
        const scoredRounds = Object.keys(roundScores);
        if (scoredRounds.length === 0) {
          officialScore = 0;
        } else if (scoredRounds.length === 1) {
          officialScore = roundScores[scoredRounds[0]];
        } else {
          let weightSum = 0;
          let weightedTotal = 0;
          for (const rId of scoredRounds) {
            const rw = policy.roundWeights[rId] ?? 100 / scoredRounds.length;
            weightSum += rw;
            weightedTotal += roundScores[rId] * rw;
          }
          officialScore = weightSum > 0 ? round2(weightedTotal / weightSum) : humanAverageScore ?? 0;
        }
        break;
      }

      default:
        officialScore = humanAverageScore ?? 0;
    }

    officialScore = Math.max(0, Math.min(maxPossibleScore, round2(officialScore)));
    const percentageScore =
      maxPossibleScore > 0 ? round2((officialScore / maxPossibleScore) * 100) : 0;

    return {
      eligibleForRanking: true,
      officialScore,
      maxPossibleScore,
      percentageScore,
      humanAverageScore,
      aiScore,
      aiHumanDelta,
      judgeBreakdown,
      criterionSummaries,
      roundScores,
    };
  }

  /**
   * Deterministic Ranking Engine with true ties & configurable tie-breakers.
   */
  public rankEntries(params: {
    inputs: EntryScoringInput[];
    policy: CompetitionScoringPolicy;
    scope?: RankingScope;
    category?: string;
    roundId?: string;
    resultState?: 'PROVISIONAL' | 'OFFICIAL';
  }): RankedEntry[] {
    const scope = params.scope || 'OVERALL';
    const resultState = params.resultState || 'PROVISIONAL';

    // 1. Scope filtering
    let filtered = [...params.inputs];
    if (scope === 'INDIVIDUAL') {
      filtered = filtered.filter((i) => i.submission.submissionType === 'INDIVIDUAL');
    } else if (scope === 'TEAM') {
      filtered = filtered.filter((i) => i.submission.submissionType === 'TEAM');
    } else if (scope === 'CATEGORY' && params.category && params.category !== 'ALL') {
      const catLower = params.category.toLowerCase().trim();
      filtered = filtered.filter(
        (i) => (i.submission.track || 'Open Track').toLowerCase().trim() === catLower
      );
    }

    // 2. Score each entry
    const scored: RankedEntry[] = [];
    for (const item of filtered) {
      const computed = this.computeEntryScore(
        {
          ...item,
          roundFilterId: scope === 'ROUND' ? params.roundId : undefined,
        },
        params.policy
      );

      if (!computed.eligibleForRanking) continue;

      scored.push({
        rank: 0,
        isTied: false,
        submissionId: item.submission.id,
        referenceId: item.submission.referenceId,
        projectTitle: item.submission.projectTitle,
        submissionType: item.submission.submissionType,
        teamOrParticipantName:
          item.submission.submissionType === 'TEAM'
            ? item.submission.teamName || item.submission.primaryContactName
            : item.submission.primaryContactName,
        category: item.submission.track || 'Open Track',
        roundId: scope === 'ROUND' ? params.roundId : undefined,
        officialScore: computed.officialScore,
        maxPossibleScore: computed.maxPossibleScore,
        percentageScore: computed.percentageScore,
        humanAverageScore: computed.humanAverageScore,
        aiScore: computed.aiScore,
        aiHumanDelta: computed.aiHumanDelta,
        judgeCount: computed.judgeBreakdown.length,
        judgeBreakdown: computed.judgeBreakdown,
        criterionSummaries: computed.criterionSummaries,
        roundScores: computed.roundScores,
        submittedAt: item.submission.createdAt,
        resultState,
        policyApplied: params.policy.policyType,
      });
    }

    const enabledTieBreakers = params.policy.tieBreakers.filter((tb) => tb.enabled);

    // Helper: evaluate a single tie-breaker rule between a and b (<0 means a wins, >0 means b wins, 0 means tied)
    const evaluateTieBreaker = (
      a: RankedEntry,
      b: RankedEntry,
      rule: TieBreakerRule
    ): number => {
      switch (rule.type) {
        case 'HIGHEST_WEIGHTED_CRITERION': {
          // Pick explicit criterionId or the criterion with highest weight
          let critId = rule.criterionId;
          if (!critId) {
            const crits = Object.values(a.criterionSummaries);
            crits.sort((x, y) => y.weight - x.weight || x.criterionId.localeCompare(y.criterionId));
            critId = crits[0]?.criterionId;
          }
          if (!critId) return 0;
          const aScore = a.criterionSummaries[critId]?.averageScore ?? 0;
          const bScore = b.criterionSummaries[critId]?.averageScore ?? 0;
          if (Math.abs(aScore - bScore) < 1e-6) return 0;
          return bScore - aScore;
        }
        case 'LOWEST_JUDGE_VARIANCE': {
          const aVar = computeVariance(a.judgeBreakdown.map((j) => j.score));
          const bVar = computeVariance(b.judgeBreakdown.map((j) => j.score));
          if (Math.abs(aVar - bVar) < 1e-6) return 0;
          return aVar - bVar; // lower variance wins
        }
        case 'HIGHEST_SINGLE_JUDGE_SCORE': {
          const aMax = a.judgeBreakdown.length > 0 ? Math.max(...a.judgeBreakdown.map((j) => j.score)) : 0;
          const bMax = b.judgeBreakdown.length > 0 ? Math.max(...b.judgeBreakdown.map((j) => j.score)) : 0;
          if (Math.abs(aMax - bMax) < 1e-6) return 0;
          return bMax - aMax;
        }
        case 'HIGHEST_AI_SCORE': {
          const aAi = a.aiScore ?? -1;
          const bAi = b.aiScore ?? -1;
          if (Math.abs(aAi - bAi) < 1e-6) return 0;
          return bAi - aAi;
        }
        case 'EARLIEST_SUBMISSION': {
          const aTime = new Date(a.submittedAt).getTime();
          const bTime = new Date(b.submittedAt).getTime();
          if (aTime === bTime) return 0;
          return aTime - bTime; // earlier wins
        }
        case 'REFERENCE_ID_ASC': {
          return a.referenceId.localeCompare(b.referenceId);
        }
        default:
          return 0;
      }
    };

    // Compare two entries returning { cmp, brokenBy }
    const comparePair = (
      a: RankedEntry,
      b: RankedEntry
    ): { cmp: number; brokenBy?: string; isTrueTie: boolean } => {
      if (Math.abs(a.officialScore - b.officialScore) >= 1e-6) {
        return { cmp: b.officialScore - a.officialScore, isTrueTie: false };
      }

      for (const rule of enabledTieBreakers) {
        const diff = evaluateTieBreaker(a, b, rule);
        if (diff !== 0) {
          return { cmp: diff, brokenBy: rule.label, isTrueTie: false };
        }
      }

      // True unresolved tie — use referenceId only for deterministic display order
      return {
        cmp: a.referenceId.localeCompare(b.referenceId),
        isTrueTie: true,
      };
    };

    // 3. Deterministic sort
    scored.sort((a, b) => comparePair(a, b).cmp);

    // 4. Assign ranks (standard competition ranking: 1, 2, 2, 4 for unresolved ties)
    for (let i = 0; i < scored.length; i++) {
      if (i === 0) {
        scored[i].rank = 1;
        scored[i].isTied = false;
      } else {
        const prev = scored[i - 1];
        const curr = scored[i];
        const res = comparePair(prev, curr);

        if (res.isTrueTie) {
          curr.rank = prev.rank;
          curr.isTied = true;
          prev.isTied = true;
          curr.tieBrokenBy = undefined;
        } else {
          curr.rank = i + 1;
          curr.isTied = false;
          if (res.brokenBy && Math.abs(prev.officialScore - curr.officialScore) < 1e-6) {
            curr.tieBrokenBy = `Broken by: ${res.brokenBy}`;
            if (!prev.tieBrokenBy) {
              prev.tieBrokenBy = `Won tie-break: ${res.brokenBy}`;
            }
          }
        }
      }
    }

    return scored;
  }

  // ─────────────────────────────────────────────
  // 3. COMPETITION DATA LOADER & PREVIEW / PUBLICATION
  // ─────────────────────────────────────────────

  private async loadCompetitionScoringInputs(
    competitionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<{
    competition: Competition;
    inputs: EntryScoringInput[];
    allSubmissions: ProjectSubmission[];
    aiReports: AiEvaluationReport[];
    allHumanEvaluations: HumanJudgeEvaluation[];
  }> {
    const fs = resolveFirestore(options?.firestore);
    let comp = await competitionService.getCompetition(competitionId, options);
    if (!comp) {
      if (fs) {
        throw new PersistenceError({
          code: 'NOT_FOUND',
          message: `Competition "${competitionId}" not found in Firestore.`,
          operation: 'loadCompetitionScoringInputs',
          collection: 'competitions',
        });
      }
      const allComps = await competitionService.listAllCompetitions(options);
      comp = allComps[0] || {
        id: competitionId,
        organizationId: 'org-default',
        title: 'Competition',
        slug: competitionId,
        tagline: '',
        description: '',
        type: 'HACKATHON',
        visibility: 'PUBLIC',
        status: 'ACTIVE',
        participationType: 'BOTH',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        evaluationDeadline: new Date().toISOString(),
        publicAccessCode: 'DEFAULT',
        policies: {
          teamSubmissionsEnabled: true,
          minTeamMembers: 1,
          maxTeamMembers: 4,
          individualSubmissionsAllowed: true,
          submissionDeadline: new Date().toISOString(),
          allowLateSubmissions: false,
          allowSubmissionEdits: true,
          aiEvaluationEnabled: true,
          judgeFeedbackVisibleToParticipants: true,
          aiScoresVisibleToParticipants: true,
        },
        rounds: [],
        rubric: [
          { id: 'crit-tech', name: 'Technological Implementation', description: 'Architecture & code', weight: 25, maxScore: 25 },
          { id: 'crit-design', name: 'Design & User Experience', description: 'Usability & design', weight: 25, maxScore: 25 },
          { id: 'crit-impact', name: 'Potential Impact', description: 'Real-world utility', weight: 25, maxScore: 25 },
          { id: 'crit-idea', name: 'Quality of the Idea', description: 'Novelty & alignment', weight: 25, maxScore: 25 },
        ],
        tracks: ['Open Track'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const resolvedComp: Competition = comp;

    const [allSubmissions, aiReports, allHumanEvaluations] = await Promise.all([
      submissionService.listCompetitionSubmissions(competitionId, options),
      evaluationPipelineService.listReportsByCompetition(competitionId, options),
      judgeAssignmentService.listAllEvaluations(competitionId, options),
    ]);

    const reportsBySub = new Map<string, AiEvaluationReport>();
    aiReports.forEach((r) => reportsBySub.set(r.submissionId, r));

    const evalsBySub = new Map<string, HumanJudgeEvaluation[]>();
    for (const ev of allHumanEvaluations) {
      const list = evalsBySub.get(ev.submissionId) || [];
      list.push(ev);
      evalsBySub.set(ev.submissionId, list);
    }

    const inputs: EntryScoringInput[] = allSubmissions.map((sub) => ({
      submission: sub,
      humanEvaluations: (evalsBySub.get(sub.id) || []).filter((e) => e.status === 'SUBMITTED'),
      aiReport: reportsBySub.get(sub.id) || null,
      rubric: resolvedComp.rubric,
    }));

    return {
      competition: resolvedComp,
      inputs,
      allSubmissions,
      aiReports,
      allHumanEvaluations,
    };
  }

  /**
   * Computes a live PROVISIONAL preview of results under the active scoring policy.
   */
  public async previewResults(
    competitionId: string,
    options?: {
      scope?: RankingScope;
      category?: string;
      roundId?: string;
      firestore?: Firestore;
    }
  ): Promise<{
    competition: Competition;
    policy: CompetitionScoringPolicy;
    publication: ResultPublicationRecord | null;
    entries: RankedEntry[];
  }> {
    const fsOpts = options?.firestore ? { firestore: options.firestore } : undefined;
    const { competition, inputs } = await this.loadCompetitionScoringInputs(competitionId, fsOpts);
    const policy = await this.loadScoringPolicyFromFirestore(competitionId, fsOpts);
    const publication =
      (await this.getPublicationStatusFromFirestore(competitionId, fsOpts)) ||
      this.publications.get(competitionId) ||
      null;

    const entries = this.rankEntries({
      inputs,
      policy,
      scope: options?.scope || 'OVERALL',
      category: options?.category,
      roundId: options?.roundId,
      resultState: publication?.status === 'PUBLISHED' ? 'OFFICIAL' : 'PROVISIONAL',
    });

    return {
      competition,
      policy,
      publication,
      entries,
    };
  }

  /**
   * Organizer explicitly approves and publishes official results.
   * Freezes an immutable official snapshot for the public leaderboard in Firestore.
   */
  public async publishOfficialResults(
    params: {
      competitionId: string;
      organizerUserId: string;
      organizerName: string;
      actorRole: 'ORGANIZER' | 'JUDGE' | 'PARTICIPANT';
      approvalReason: string;
    },
    options?: FirestoreExecutionOptions & { trustedExecutor?: TrustedBackendExecutor }
  ): Promise<ResultPublicationRecord> {
    if (params.actorRole !== 'ORGANIZER') {
      throw new Error('Unauthorized: Only organizers can approve and publish official competition results.');
    }

    if (!params.approvalReason || params.approvalReason.trim().length < 5) {
      throw new Error('Organizer approval requires a documented confirmation note (minimum 5 characters).');
    }

    const { competition, inputs } = await this.loadCompetitionScoringInputs(
      params.competitionId,
      options
    );
    const policy = await this.loadScoringPolicyFromFirestore(params.competitionId, options);

    const officialEntries = this.rankEntries({
      inputs,
      policy,
      scope: 'OVERALL',
      resultState: 'OFFICIAL',
    });

    if (officialEntries.length === 0) {
      throw new Error(
        'Cannot publish official results: No entries have completed human judge evaluations under the active scoring policy.'
      );
    }

    const existing =
      (await this.getPublicationStatusFromFirestore(params.competitionId, options)) ||
      this.publications.get(params.competitionId);
    const nextVersion = (existing?.version || 0) + 1;
    const now = new Date().toISOString();

    const record: ResultPublicationRecord & { organizationId: string; isPublic: boolean } = {
      id: `pub-${params.competitionId}-v${nextVersion}`,
      organizationId: competition.organizationId,
      competitionId: params.competitionId,
      competitionTitle: competition.title,
      publicSlug: competition.slug || params.competitionId,
      status: 'PUBLISHED',
      isPublic: competition.visibility !== 'PRIVATE',
      version: nextVersion,
      policySnapshot: JSON.parse(JSON.stringify(policy)),
      entries: officialEntries,
      publishedBy: params.organizerUserId,
      publishedByName: params.organizerName,
      publishedAt: now,
      approvalReason: params.approvalReason.trim(),
      updatedAt: now,
    };

    const executor = resolveTrustedExecutor(options);
    if (executor) {
      await executor.persistResultPublication(record);
      await governanceAuditService.recordEventDurable(
        {
          organizationId: competition.organizationId,
          competitionId: params.competitionId,
          category: 'PUBLICATION_ACTION',
          action: 'OFFICIAL_RESULTS_PUBLISHED',
          actorId: params.organizerUserId,
          actorName: params.organizerName,
          actorRole: 'ORGANIZER',
          targetId: record.id,
          targetLabel: `${competition.title} Official Results v${nextVersion}`,
          reason: params.approvalReason.trim(),
          metadata: {
            version: nextVersion,
            rankedCount: officialEntries.length,
            policyType: policy.policyType,
            includeAiAsJudgeScore: policy.includeAiAsJudgeScore,
          },
        },
        { trustedExecutor: executor }
      );
      this.publications.set(params.competitionId, record);
      return record;
    }

    this.publications.set(params.competitionId, record);

    governanceAuditService.recordEvent({
      organizationId: competition.organizationId,
      competitionId: params.competitionId,
      category: 'PUBLICATION_ACTION',
      action: 'OFFICIAL_RESULTS_PUBLISHED',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      actorRole: 'ORGANIZER',
      targetId: record.id,
      targetLabel: `${competition.title} Official Results v${nextVersion}`,
      reason: params.approvalReason.trim(),
      metadata: {
        version: nextVersion,
        rankedCount: officialEntries.length,
        policyType: policy.policyType,
        includeAiAsJudgeScore: policy.includeAiAsJudgeScore,
      },
    });

    return record;
  }

  /**
   * Unpublishes official results through an authorized organizer workflow.
   */
  public async unpublishOfficialResults(
    params: {
      competitionId: string;
      organizerUserId: string;
      organizerName: string;
      actorRole: 'ORGANIZER' | 'JUDGE' | 'PARTICIPANT';
      reason: string;
    },
    options?: FirestoreExecutionOptions & { trustedExecutor?: TrustedBackendExecutor }
  ): Promise<ResultPublicationRecord> {
    if (params.actorRole !== 'ORGANIZER') {
      throw new Error('Unauthorized: Only organizers can unpublish official results.');
    }

    if (!params.reason || params.reason.trim().length < 5) {
      throw new Error('A documented justification (minimum 5 characters) is required to unpublish official results.');
    }

    const existing =
      (await this.getPublicationStatusFromFirestore(params.competitionId, options)) ||
      this.publications.get(params.competitionId);
    if (!existing || existing.status !== 'PUBLISHED') {
      throw new Error('Official results are not currently published for this competition.');
    }

    const now = new Date().toISOString();
    const updated: ResultPublicationRecord & { organizationId: string; isPublic: boolean } = {
      ...existing,
      organizationId: existing.organizationId || 'unknown',
      status: 'UNPUBLISHED',
      isPublic: false,
      unpublishedBy: params.organizerUserId,
      unpublishedByName: params.organizerName,
      unpublishedAt: now,
      unpublishReason: params.reason.trim(),
      updatedAt: now,
    };

    const executor = resolveTrustedExecutor(options);
    if (executor) {
      await executor.persistResultPublication(updated);
      await governanceAuditService.recordEventDurable(
        {
          organizationId: updated.organizationId,
          competitionId: params.competitionId,
          category: 'PUBLICATION_ACTION',
          action: 'OFFICIAL_RESULTS_UNPUBLISHED',
          actorId: params.organizerUserId,
          actorName: params.organizerName,
          actorRole: 'ORGANIZER',
          targetId: updated.id,
          targetLabel: `${updated.competitionTitle} Official Results v${updated.version}`,
          reason: params.reason.trim(),
          metadata: { version: updated.version },
        },
        { trustedExecutor: executor }
      );
      this.publications.set(params.competitionId, updated);
      return updated;
    }

    this.publications.set(params.competitionId, updated);

    governanceAuditService.recordEvent({
      organizationId: existing.organizationId,
      competitionId: params.competitionId,
      category: 'PUBLICATION_ACTION',
      action: 'OFFICIAL_RESULTS_UNPUBLISHED',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      actorRole: 'ORGANIZER',
      targetId: updated.id,
      targetLabel: `${updated.competitionTitle} Official Results v${updated.version}`,
      reason: params.reason.trim(),
      metadata: {
        version: updated.version,
      },
    });

    return updated;
  }

  /**
   * Authorized organizer workflow for appending an official score correction to the ledger.
   * Never mutates previous ledger records — appends a new audited contribution and logs ADMIN_OVERRIDE.
   */
  public async applyAuthorizedScoreAdjustment(params: {
    competitionId: string;
    entryId: string;
    referenceId?: string;
    evaluationId: string;
    criterionId: string;
    criterionName?: string;
    newScore: number;
    maxScore: number;
    organizerUserId: string;
    organizerName: string;
    actorRole: 'ORGANIZER' | 'JUDGE' | 'PARTICIPANT';
    reason: string;
  }) {
    if (params.actorRole !== 'ORGANIZER') {
      throw new Error(
        'Direct client modification of official scores is prohibited. Organizer authorization is required.'
      );
    }

    if (!params.reason || params.reason.trim().length < 5) {
      throw new Error('A documented audit justification (minimum 5 characters) is required for score adjustments.');
    }

    const ledgerEntry = scoringLedgerService.appendContribution({
      competitionId: params.competitionId,
      entryId: params.entryId,
      referenceId: params.referenceId,
      evaluationId: params.evaluationId,
      criterionId: params.criterionId,
      criterionName: params.criterionName,
      score: params.newScore,
      maxScore: params.maxScore,
      source: 'HUMAN',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      reasonForAdjustment: params.reason.trim(),
      isAdjustment: true,
      authorizedSource: 'ORGANIZER_AUTHORIZED_WORKFLOW',
    });

    governanceAuditService.recordEvent({
      competitionId: params.competitionId,
      category: 'ADMIN_OVERRIDE',
      action: 'AUTHORIZED_SCORE_ADJUSTMENT',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      actorRole: 'ORGANIZER',
      targetId: params.entryId,
      targetLabel: params.referenceId || params.entryId,
      reason: params.reason.trim(),
      metadata: {
        ledgerEntryId: ledgerEntry.id,
        criterionId: params.criterionId,
        newScore: params.newScore,
        maxScore: params.maxScore,
      },
    });

    return ledgerEntry;
  }

  /**
   * Reads official publication record directly from Firestore `/resultPublications/{competitionId}`.
   */
  public async getPublicationStatusFromFirestore(
    competitionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<ResultPublicationRecord | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'resultPublications', competitionId));
        if (!snap.exists()) return null;
        return snap.data() as ResultPublicationRecord;
      } catch (err) {
        throw mapFirestoreError(err, 'getPublicationStatusFromFirestore', 'resultPublications');
      }
    }
    return this.publications.get(competitionId) || null;
  }

  /**
   * Reads published public leaderboard directly from Firestore. Returns null if not PUBLISHED.
   */
  public async getPublicLeaderboardFromFirestore(
    competitionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<ResultPublicationRecord | null> {
    const pub = await this.getPublicationStatusFromFirestore(competitionId, options);
    if (!pub || pub.status !== 'PUBLISHED') {
      return null;
    }
    const comp = await competitionService.getCompetition(competitionId, options);
    if (comp?.policies?.isLeaderboardHidden) {
      return null;
    }
    if (comp?.policies?.leaderboardPublishDate) {
      const publishAt = new Date(comp.policies.leaderboardPublishDate).getTime();
      if (Date.now() < publishAt) {
        return null;
      }
    }
    return pub;
  }

  /**
   * Lists immutable leaderboard snapshots for a competition with bounded pagination.
   */
  public async listLeaderboardSnapshotsPaginated(
    competitionId: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<ResultPublicationRecord>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);
    if (fs) {
      try {
        const constraints: QueryConstraint[] = [
          where('competitionId', '==', competitionId),
          limit(pageSize + 1),
        ];
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }
        const snap = await getDocs(query(collection(fs, 'leaderboardSnapshots'), ...constraints));
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        const items = pageDocs
          .map((d) => d.data() as ResultPublicationRecord)
          .sort((a, b) => (b.version || 0) - (a.version || 0));
        return {
          items,
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listLeaderboardSnapshotsPaginated', 'leaderboardSnapshots');
      }
    }
    const existing = this.publications.get(competitionId);
    return {
      items: existing ? [existing] : [],
      hasMore: false,
      nextCursor: null,
      pageSize,
    };
  }

  /**
   * Returns published official results ONLY (sync cache helper for unit tests).
   */
  public getPublicLeaderboard(competitionId: string): ResultPublicationRecord | null {
    const pub = this.publications.get(competitionId);
    if (!pub || pub.status !== 'PUBLISHED') {
      return null;
    }
    const comp = competitionService.getCompetitionSync(competitionId);
    if (comp?.policies?.isLeaderboardHidden) {
      return null;
    }
    if (comp?.policies?.leaderboardPublishDate) {
      const publishAt = new Date(comp.policies.leaderboardPublishDate).getTime();
      if (Date.now() < publishAt) {
        return null;
      }
    }
    return pub;
  }

  /**
   * Lists all published competitions for the public leaderboard directory.
   */
  public listPublishedLeaderboards(): ResultPublicationRecord[] {
    return Array.from(this.publications.values())
      .filter((p) => p.status === 'PUBLISHED')
      .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  }

  public getPublicationStatus(competitionId: string): ResultPublicationRecord | null {
    return this.publications.get(competitionId) || null;
  }

  // ─────────────────────────────────────────────
  // 4. CSV EXPORT ENGINE
  // ─────────────────────────────────────────────

  public exportResultsToCsv(
    entries: RankedEntry[],
    competitionTitle: string,
    publicationStatus: string
  ): string {
    const headers = [
      'Rank',
      'Tie Status',
      'Tie-Breaker Applied',
      'Reference ID',
      'Project Title',
      'Submission Type',
      'Team / Participant',
      'Category / Track',
      'Official Score',
      'Max Score',
      'Percentage (%)',
      'Human Judge Avg',
      'AI Pre-Evaluation Score',
      'AI-Human Delta (Human - AI)',
      'Judges Completed',
      'Scoring Policy',
      'Result Status',
      'Competition',
    ];

    const rows = entries.map((e) => [
      e.rank,
      e.isTied ? 'TIED' : 'UNIQUE',
      e.tieBrokenBy || '',
      e.referenceId,
      e.projectTitle,
      e.submissionType,
      e.teamOrParticipantName,
      e.category,
      e.officialScore.toFixed(2),
      e.maxPossibleScore,
      e.percentageScore.toFixed(1),
      e.humanAverageScore !== null ? e.humanAverageScore.toFixed(2) : '',
      e.aiScore !== null ? e.aiScore.toFixed(2) : '',
      e.aiHumanDelta !== null ? e.aiHumanDelta.toFixed(2) : '',
      e.judgeCount,
      e.policyApplied,
      publicationStatus,
      competitionTitle,
    ]);

    return [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((r) => r.map(escapeCsvCell).join(',')),
    ].join('\n');
  }

  // ─────────────────────────────────────────────
  // 5. ANALYTICS & AI vs. HUMAN COMPARISON REPORT
  // ─────────────────────────────────────────────

  public async computeCompetitionAnalytics(
    competitionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<CompetitionAnalyticsReport> {
    const { competition, inputs, allSubmissions, aiReports, allHumanEvaluations } =
      await this.loadCompetitionScoringInputs(competitionId, options);
    const policy = await this.loadScoringPolicyFromFirestore(competitionId, options);
    const assignments = await judgeAssignmentService.listAssignments({ competitionId }, options);
    const judgeWorkload = await judgeAssignmentService.getJudgeWorkload(competitionId, {
      firestore: options?.firestore,
      organizationId: competition.organizationId,
    });

    const totalSubmissions = allSubmissions.length;
    const validSubmissions = allSubmissions.filter((s) => s.status !== 'Draft').length;

    const aiFailedCount = allSubmissions.filter((s) => s.status === 'AI Evaluation Failed').length;
    const aiCompletedIds = new Set<string>(aiReports.map((r) => r.submissionId));
    allSubmissions.forEach((s) => {
      if (
        s.status === 'AI Evaluation Complete' ||
        s.status === 'Ready for Judge Review' ||
        s.status === 'Under Human Review' ||
        s.status === 'Evaluated' ||
        s.status === 'Finalized'
      ) {
        aiCompletedIds.add(s.id);
      }
    });
    const aiEvaluationsCompleted = aiCompletedIds.size;

    const pendingJudgeEvaluations = assignments.filter((a) => a.status === 'PENDING').length;
    const inProgressJudgeEvaluations = assignments.filter((a) => a.status === 'IN_PROGRESS').length;
    const completedJudgeEvaluations = assignments.filter((a) => a.status === 'COMPLETED').length;
    const conflictDeclarations = assignments.filter((a) => a.status === 'CONFLICT').length;

    const activeAssignments = assignments.filter((a) => a.status !== 'CONFLICT').length;
    const evaluationProgressPercent =
      activeAssignments > 0
        ? Math.round((completedJudgeEvaluations / activeAssignments) * 100)
        : allHumanEvaluations.filter((e) => e.status === 'SUBMITTED').length > 0 && validSubmissions > 0
        ? Math.min(
            100,
            Math.round(
              (new Set(allHumanEvaluations.filter((e) => e.status === 'SUBMITTED').map((e) => e.submissionId)).size /
                validSubmissions) *
                100
            )
          )
        : 0;

    // Score distribution buckets
    const buckets: ScoreDistributionBucket[] = [
      { bucket: '0–39', min: 0, max: 39.99, humanCount: 0, aiCount: 0 },
      { bucket: '40–59', min: 40, max: 59.99, humanCount: 0, aiCount: 0 },
      { bucket: '60–69', min: 60, max: 69.99, humanCount: 0, aiCount: 0 },
      { bucket: '70–79', min: 70, max: 79.99, humanCount: 0, aiCount: 0 },
      { bucket: '80–89', min: 80, max: 89.99, humanCount: 0, aiCount: 0 },
      { bucket: '90–100', min: 90, max: 100, humanCount: 0, aiCount: 0 },
    ];

    const humanScoresForAvg: number[] = [];
    const aiScoresForAvg: number[] = [];
    const officialScoresForAvg: number[] = [];
    const perEntryComparison: AiHumanEntryComparison[] = [];

    for (const item of inputs) {
      const computed = this.computeEntryScore(item, policy);

      if (computed.humanAverageScore !== null) {
        const pct =
          computed.maxPossibleScore > 0
            ? (computed.humanAverageScore / computed.maxPossibleScore) * 100
            : computed.humanAverageScore;
        humanScoresForAvg.push(computed.humanAverageScore);
        const b = buckets.find((bk) => pct >= bk.min && pct <= bk.max);
        if (b) b.humanCount += 1;
      }

      if (computed.aiScore !== null) {
        const pct =
          computed.maxPossibleScore > 0
            ? (computed.aiScore / computed.maxPossibleScore) * 100
            : computed.aiScore;
        aiScoresForAvg.push(computed.aiScore);
        const b = buckets.find((bk) => pct >= bk.min && pct <= bk.max);
        if (b) b.aiCount += 1;
      }

      if (computed.eligibleForRanking) {
        officialScoresForAvg.push(computed.officialScore);
      }

      if (computed.humanAverageScore !== null && computed.aiScore !== null) {
        const delta = round2(computed.humanAverageScore - computed.aiScore);
        perEntryComparison.push({
          submissionId: item.submission.id,
          referenceId: item.submission.referenceId,
          projectTitle: item.submission.projectTitle,
          category: item.submission.track || 'Open Track',
          aiScore: computed.aiScore,
          humanScore: computed.humanAverageScore,
          delta,
          absDelta: round2(Math.abs(delta)),
          decisionModes: item.humanEvaluations.map((e) => e.decisionMode),
        });
      }
    }

    const averageHumanScore =
      humanScoresForAvg.length > 0
        ? round2(humanScoresForAvg.reduce((a, b) => a + b, 0) / humanScoresForAvg.length)
        : null;
    const averageAiScore =
      aiScoresForAvg.length > 0
        ? round2(aiScoresForAvg.reduce((a, b) => a + b, 0) / aiScoresForAvg.length)
        : null;
    const averageOfficialScore =
      officialScoresForAvg.length > 0
        ? round2(officialScoresForAvg.reduce((a, b) => a + b, 0) / officialScoresForAvg.length)
        : null;

    // Decision mode breakdown across all submitted human evaluations
    const submittedEvals = allHumanEvaluations.filter((e) => e.status === 'SUBMITTED');
    const decisionBreakdown = {
      agree: submittedEvals.filter((e) => e.decisionMode === 'AGREE').length,
      modify: submittedEvals.filter((e) => e.decisionMode === 'MODIFY').length,
      reject: submittedEvals.filter((e) => e.decisionMode === 'REJECT').length,
    };

    const comparedCount = perEntryComparison.length;
    const meanSignedDifference =
      comparedCount > 0
        ? round2(perEntryComparison.reduce((s, c) => s + c.delta, 0) / comparedCount)
        : 0;
    const meanAbsoluteDifference =
      comparedCount > 0
        ? round2(perEntryComparison.reduce((s, c) => s + c.absDelta, 0) / comparedCount)
        : 0;
    const withinFivePointsCount = perEntryComparison.filter((c) => c.absDelta <= 5).length;
    const withinFivePointsPercent =
      comparedCount > 0 ? Math.round((withinFivePointsCount / comparedCount) * 100) : 0;

    const aiHumanComparison: AiHumanComparisonReport = {
      disclaimer: AI_HUMAN_CORRELATION_DISCLAIMER,
      comparedCount,
      meanSignedDifference,
      meanAbsoluteDifference,
      withinFivePointsCount,
      withinFivePointsPercent,
      aiHigherCount: perEntryComparison.filter((c) => c.delta < 0).length,
      humanHigherCount: perEntryComparison.filter((c) => c.delta > 0).length,
      exactMatchCount: perEntryComparison.filter((c) => c.delta === 0).length,
      decisionBreakdown,
      perEntryComparison: perEntryComparison.sort((a, b) => b.absDelta - a.absDelta),
    };

    return {
      competitionId,
      competitionTitle: competition.title,
      totalSubmissions,
      validSubmissions,
      aiEvaluationsCompleted,
      aiEvaluationsFailed: aiFailedCount,
      pendingJudgeEvaluations,
      inProgressJudgeEvaluations,
      completedJudgeEvaluations,
      conflictDeclarations,
      averageHumanScore,
      averageAiScore,
      averageOfficialScore,
      scoreDistribution: buckets,
      judgeWorkload,
      evaluationProgressPercent,
      aiHumanComparison,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────
  // 6. DEMO SEEDER FOR LIVE UI EXPLORATION
  // ─────────────────────────────────────────────

  /**
   * Populates realistic evaluated entries on the default competition if it has zero
   * live submissions yet, so organizers immediately see a rich working scoring/results/analytics
   * command center with real multi-judge evaluations, ledger entries, and ties to test.
   */
  public async ensureDemoDataForUi(competitionId: string): Promise<void> {
    // Strictly disabled in production or whenever real Firestore persistence is active
    if (!isDemoModeEnabled() || resolveFirestore()) return;
    if (this.demoSeededCompetitions.has(competitionId)) return;

    const existingSubs = await submissionService.listCompetitionSubmissions(competitionId);
    const existingEvals = await judgeAssignmentService.listAllEvaluations(competitionId);
    if (existingSubs.length > 0 && existingEvals.length > 0) {
      this.demoSeededCompetitions.add(competitionId);
      return;
    }

    if (competitionId !== 'comp-default-ai') return;
    this.demoSeededCompetitions.add(competitionId);

    const comp = await competitionService.getCompetition(competitionId);
    if (!comp) return;

    const demoSubmissions: Array<{
      id: string;
      ref: string;
      title: string;
      type: 'TEAM' | 'INDIVIDUAL';
      teamName?: string;
      contact: string;
      track: string;
      aiScore: number;
      createdAt: string;
      judges: Array<{
        judgeId: string;
        judgeName: string;
        judgeEmail: string;
        mode: 'AGREE' | 'MODIFY' | 'REJECT';
        scores: Record<string, number>;
        roundId: string;
        notes: string;
      }>;
    }> = [
      {
        id: 'sub-nano-cardiopulse',
        ref: 'PF-SUB-2026-NC892',
        title: 'CardioPulse: Local Nano 4 Arrhythmia Detector',
        type: 'TEAM',
        teamName: 'MedEdge Labs',
        contact: 'Dr. Sarah Chen',
        track: 'Healthcare & Edge AI',
        aiScore: 88,
        createdAt: '2026-10-12T09:15:00.000Z',
        judges: [
          {
            judgeId: 'user-judge-01',
            judgeName: 'Dr. Elena Vance',
            judgeEmail: 'dr.elena.vance@stanford.edu',
            mode: 'MODIFY',
            scores: { 'crit-tech': 24, 'crit-design': 22, 'crit-impact': 23, 'crit-idea': 23 },
            roundId: 'round-1',
            notes: 'Outstanding on-device WebGPU signal quantization; minor deduction on mobile waveform zoom.',
          },
          {
            judgeId: 'judge-maya',
            judgeName: 'Dr. Maya Patel',
            judgeEmail: 'maya.patel@deepmind.academic',
            mode: 'MODIFY',
            scores: { 'crit-tech': 23, 'crit-design': 22, 'crit-impact': 23, 'crit-idea': 22 },
            roundId: 'round-2',
            notes: 'Strong clinical relevance; needs retrospective benchmark documentation for FDA path.',
          },
        ],
      },
      {
        id: 'sub-eventscout-demo',
        ref: 'PF-SUB-2026-EV401',
        title: 'EventScout: Proactive AI Opportunity Scout',
        type: 'INDIVIDUAL',
        contact: 'Saikeerthana Sathyavada',
        track: 'Intelligent Agents',
        aiScore: 79,
        createdAt: '2026-10-12T10:30:00.000Z',
        judges: [
          {
            judgeId: 'user-judge-01',
            judgeName: 'Dr. Elena Vance',
            judgeEmail: 'dr.elena.vance@stanford.edu',
            mode: 'MODIFY',
            scores: { 'crit-tech': 21, 'crit-design': 21, 'crit-impact': 22, 'crit-idea': 21 },
            roundId: 'round-1',
            notes: 'High practical value solving fragmented student event discovery; add calendar sync & CI tests.',
          },
          {
            judgeId: 'judge-chen',
            judgeName: 'Dr. Wei Chen',
            judgeEmail: 'w.chen@mit.csail.edu',
            mode: 'MODIFY',
            scores: { 'crit-tech': 20, 'crit-design': 22, 'crit-impact': 21, 'crit-idea': 22 },
            roundId: 'round-2',
            notes: 'Clean mobile-first UX and thoughtful ranking workflow; recommend distributed queue for scrapers.',
          },
        ],
      },
      {
        id: 'sub-quantum-ai',
        ref: 'PF-SUB-2026-QA410',
        title: 'QuantumGuard: Edge Post-Quantum Key Vault',
        type: 'TEAM',
        teamName: 'CipherGrid',
        contact: 'Marcus Vance',
        track: 'Fintech & Security',
        aiScore: 84,
        createdAt: '2026-10-12T11:00:00.000Z',
        judges: [
          {
            judgeId: 'user-judge-01',
            judgeName: 'Dr. Elena Vance',
            judgeEmail: 'dr.elena.vance@stanford.edu',
            mode: 'MODIFY',
            scores: { 'crit-tech': 23, 'crit-design': 19, 'crit-impact': 21, 'crit-idea': 22 },
            roundId: 'round-1',
            notes: 'Rigorous Kyber-768 WASM implementation; onboarding ergonomics could be streamlined.',
          },
          {
            judgeId: 'judge-maya',
            judgeName: 'Dr. Maya Patel',
            judgeEmail: 'maya.patel@deepmind.academic',
            mode: 'MODIFY',
            scores: { 'crit-tech': 23, 'crit-design': 20, 'crit-impact': 21, 'crit-idea': 21 },
            roundId: 'round-2',
            notes: 'Strong cryptographic depth; tied overall with EventScout on raw score (85.0) — higher Tech criterion.',
          },
        ],
      },
      {
        id: 'sub-greengrid-solo',
        ref: 'PF-SUB-2026-GG215',
        title: 'GridPulse: Solar Microgrid Load Forecaster',
        type: 'INDIVIDUAL',
        contact: 'Aarav Mehta',
        track: 'Healthcare & Edge AI',
        aiScore: 76,
        createdAt: '2026-10-12T12:45:00.000Z',
        judges: [
          {
            judgeId: 'judge-chen',
            judgeName: 'Dr. Wei Chen',
            judgeEmail: 'w.chen@mit.csail.edu',
            mode: 'AGREE',
            scores: { 'crit-tech': 19, 'crit-design': 19, 'crit-impact': 19, 'crit-idea': 19 },
            roundId: 'round-1',
            notes: 'Agreed with AI assessment: solid forecasting prototype, lacks live telemetry integration.',
          },
        ],
      },
      {
        id: 'sub-devflow-team',
        ref: 'PF-SUB-2026-DF708',
        title: 'DevFlow: Autonomous PR Security Gate',
        type: 'TEAM',
        teamName: 'PipeCraft Collective',
        contact: 'Priya Nair',
        track: 'Developer Tools',
        aiScore: 82,
        createdAt: '2026-10-12T13:10:00.000Z',
        judges: [
          {
            judgeId: 'judge-maya',
            judgeName: 'Dr. Maya Patel',
            judgeEmail: 'maya.patel@deepmind.academic',
            mode: 'REJECT',
            scores: { 'crit-tech': 17, 'crit-design': 18, 'crit-impact': 18, 'crit-idea': 17 },
            roundId: 'round-1',
            notes: 'Rejected AI pre-score (82): static analysis wrapper relied heavily on default regexes without AST depth.',
          },
        ],
      },
    ];

    for (const demo of demoSubmissions) {
      const sub: ProjectSubmission = {
        id: demo.id,
        referenceId: demo.ref,
        competitionId,
        organizationId: comp.organizationId,
        formSchemaId: 'schema-default',
        submissionType: demo.type,
        teamName: demo.teamName,
        primaryContactName: demo.contact,
        participants: [
          {
            id: `p-${demo.id}`,
            name: demo.contact,
            email: `${demo.id}@demo.proofly.app`,
            role: 'Lead',
            isLead: true,
            source: 'FORM_SUBMISSION',
            competitionId,
            organizationId: comp.organizationId,
            createdAt: demo.createdAt,
          },
        ],
        projectTitle: demo.title,
        projectDescription: `${demo.title} — verified competition submission under ${demo.track}.`,
        technologiesUsed: ['TypeScript', 'React', 'Firebase AI Logic'],
        track: demo.track,
        fieldValues: { track: demo.track },
        files: [],
        status: 'Ready for Judge Review',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: `hash-${demo.id}`,
        managementTokenPrefix: 'sec_demo',
        createdAt: demo.createdAt,
        updatedAt: demo.createdAt,
      };
      await submissionService.saveSubmission(sub);

      // Save matching AI evaluation report so AI vs Human comparison works immediately
      const aiReportId = `ai-rep-seed-${demo.id}`;
      const perCritAi = Math.floor(demo.aiScore / 4);
      const remainder = demo.aiScore - perCritAi * 4;
      const aiReport: AiEvaluationReport = {
        id: aiReportId,
        submissionId: demo.id,
        referenceId: demo.ref,
        competitionId,
        rubricVersion: {
          versionNumber: 1,
          competitionId,
          totalMaxScore: 100,
          capturedAt: demo.createdAt,
          criteria: comp.rubric,
        },
        overallScore: demo.aiScore,
        totalMaxScore: 100,
        percentageScore: demo.aiScore,
        executiveSummary: `Automated AI pre-evaluation for ${demo.title}.`,
        strongestAspects: ['Cohesive architecture', 'Clear problem alignment'],
        areasToImprove: ['Add end-to-end automated regression tests'],
        evidenceGaps: ['Load stress telemetry'],
        evaluationWarnings: ['Static analysis only; human judge review is authoritative.'],
        criteriaEvaluations: comp.rubric.map((c, idx) => ({
          criterionId: c.id,
          criterionName: c.name,
          suggestedScore: perCritAi + (idx < remainder ? 1 : 0),
          maxScore: c.maxScore || 25,
          weight: c.weight || 25,
          positiveObservations: [`Verified evidence for ${c.name}.`],
          evidenceReferences: [demo.title],
          weaknesses: ['Requires deeper benchmark coverage.'],
          exactDeductionExplanations: [`Deduction (-${(c.maxScore || 25) - (perCritAi + (idx < remainder ? 1 : 0))} pts): Room for architectural hardening.`],
          missingEvidence: [],
          confidence: 'HIGH',
          limitations: ['Static evaluation only.'],
          evidenceClassifications: [],
        })),
        telemetry: {
          requestedMode: 'PREFER_ON_DEVICE' as any,
          actualInferenceSource: 'ON_DEVICE',
          fallbackOccurred: false,
          modelUsed: 'gemini-nano-4',
          appCheckStatus: 'ACTIVE_AND_VERIFIED',
          latencyMs: 420,
          timestamp: demo.createdAt,
        },
        evaluatedAt: demo.createdAt,
        isImmutable: true,
      };
      await evaluationPipelineService.saveEvaluationReport(aiReport);

      for (const crit of aiReport.criteriaEvaluations) {
        scoringLedgerService.appendContribution({
          competitionId,
          entryId: demo.id,
          referenceId: demo.ref,
          evaluationId: aiReport.id,
          criterionId: crit.criterionId,
          criterionName: crit.criterionName,
          score: crit.suggestedScore,
          maxScore: crit.maxScore,
          source: 'AI',
          actorId: 'gemini-nano-4',
          actorName: 'AI Logic (ON_DEVICE)',
          reasonForAdjustment: crit.exactDeductionExplanations[0],
          authorizedSource: 'EVALUATION_PIPELINE',
        });
      }

      // Submit real human judge evaluations (this automatically writes to Scoring Ledger & Governance Audit!)
      for (const j of demo.judges) {
        const total = Object.values(j.scores).reduce((a, b) => a + b, 0);
        const diffs: Record<string, any> = {};
        comp.rubric.forEach((c, idx) => {
          const aiCrit = perCritAi + (idx < remainder ? 1 : 0);
          const humanCrit = j.scores[c.id] ?? 0;
          diffs[c.id] = {
            criterionId: c.id,
            criterionName: c.name,
            maxScore: c.maxScore || 25,
            aiScore: aiCrit,
            humanScore: humanCrit,
            diff: humanCrit - aiCrit,
          };
        });

        await judgeAssignmentService.submitFinalEvaluation({
          submissionId: demo.id,
          referenceId: demo.ref,
          competitionId,
          roundId: j.roundId,
          judgeId: j.judgeId,
          judgeName: j.judgeName,
          judgeEmail: j.judgeEmail,
          decisionMode: j.mode,
          scores: j.scores,
          totalScore: total,
          aiTotalScore: demo.aiScore,
          criterionDifferences: diffs,
          deductionNotes: j.notes,
        });
      }
    }
  }

  public resetForTesting(): void {
    this.policies.clear();
    this.publications.clear();
    this.demoSeededCompetitions.clear();
  }
}

export const resultsAndAnalyticsService = new ResultsAndAnalyticsService();
