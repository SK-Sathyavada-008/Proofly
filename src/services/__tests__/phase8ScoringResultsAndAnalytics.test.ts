// ─────────────────────────────────────────────
// phase8ScoringResultsAndAnalytics.test.ts
// Phase 8 Comprehensive Verification:
// Aggregation Policies, Append-Only Scoring Ledger, Ranking Determinism,
// Ties & Tie-Breakers, Official Publication, CSV Export, Analytics, & Audit Log
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { competitionService } from '../competitionService';
import { submissionService } from '../submissionService';
import { submissionLifecycleService } from '../submissionLifecycleService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { judgeAssignmentService } from '../judgeAssignmentService';
import { scoringLedgerService } from '../scoringLedgerService';
import { governanceAuditService } from '../governanceAuditService';
import {
  resultsAndAnalyticsService,
  AI_HUMAN_CORRELATION_DISCLAIMER,
  type EntryScoringInput,
} from '../resultsAndAnalyticsService';
import type { Competition } from '../../types/authAndCompetition';
import type { ProjectSubmission } from '../../types/submission';
import type { HumanJudgeEvaluation } from '../../types/judgeAndEvaluation';
import type { AiEvaluationReport } from '../../types/aiEvaluation';

describe('Phase 8: Scoring, Results, Publication, Analytics & Audit', () => {
  const compId = 'comp-phase8-test';
  const orgId = 'org-phase8';

  const testCompetition: Competition = {
    id: compId,
    organizationId: orgId,
    title: 'Phase 8 Global Evaluation Finals',
    slug: 'phase-8-finals',
    tagline: 'Deterministic scoring and verified official publication',
    description: 'Testing all Phase 8 scoring, ranking, publication, analytics, and audit rules.',
    type: 'HACKATHON',
    status: 'EVALUATION',
    visibility: 'PUBLIC',
    participationType: 'BOTH',
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-15T00:00:00.000Z',
    evaluationDeadline: '2026-10-20T00:00:00.000Z',
    publicAccessCode: 'P8-FINALS',
    policies: {
      teamSubmissionsEnabled: true,
      minTeamMembers: 1,
      maxTeamMembers: 4,
      individualSubmissionsAllowed: true,
      submissionDeadline: '2026-10-14T23:59:59.000Z',
      allowLateSubmissions: false,
      allowSubmissionEdits: false,
      aiEvaluationEnabled: true,
      judgeFeedbackVisibleToParticipants: true,
      aiScoresVisibleToParticipants: true,
    },
    rounds: [],
    rubric: [
      { id: 'crit-tech', name: 'Technical Depth', description: 'Architecture', weight: 40, maxScore: 25 },
      { id: 'crit-design', name: 'Design & UX', description: 'Usability', weight: 20, maxScore: 25 },
      { id: 'crit-impact', name: 'Impact', description: 'Utility', weight: 25, maxScore: 25 },
      { id: 'crit-idea', name: 'Innovation', description: 'Novelty', weight: 15, maxScore: 25 },
    ],
    tracks: ['Healthcare AI', 'Climate Tech', 'Developer Tools'],
    isOpenTrackEnabled: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  function makeSubmission(overrides: Partial<ProjectSubmission> & { id: string; referenceId: string; projectTitle: string }): ProjectSubmission {
    return {
      competitionId: compId,
      organizationId: orgId,
      formSchemaId: 'schema-p8',
      submissionType: 'TEAM',
      teamName: `Team ${overrides.id}`,
      primaryContactName: `Lead ${overrides.id}`,
      participants: [],
      projectDescription: `Description for ${overrides.projectTitle}`,
      technologiesUsed: ['TypeScript'],
      track: 'Healthcare AI',
      fieldValues: {},
      files: [],
      status: 'Ready for Judge Review',
      statusHistory: [],
      isLate: false,
      isLocked: false,
      currentVersion: 1,
      versions: [],
      managementTokenHash: `hash-${overrides.id}`,
      managementTokenPrefix: 'sec_p8',
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
      ...overrides,
    };
  }

  function makeAiReport(subId: string, refId: string, overallScore: number): AiEvaluationReport {
    return {
      id: `ai-rep-${subId}`,
      submissionId: subId,
      referenceId: refId,
      competitionId: compId,
      rubricVersion: {
        versionNumber: 1,
        competitionId: compId,
        totalMaxScore: 100,
        capturedAt: '2026-10-11T00:00:00.000Z',
        criteria: testCompetition.rubric,
      },
      overallScore,
      totalMaxScore: 100,
      percentageScore: overallScore,
      executiveSummary: 'AI summary',
      strongestAspects: ['Architecture'],
      areasToImprove: ['Testing'],
      evidenceGaps: [],
      evaluationWarnings: [],
      criteriaEvaluations: testCompetition.rubric.map((c) => ({
        criterionId: c.id,
        criterionName: c.name,
        suggestedScore: Math.min(c.maxScore, Math.round(overallScore / 4)),
        maxScore: c.maxScore,
        weight: c.weight,
        positiveObservations: [],
        evidenceReferences: [],
        weaknesses: [],
        exactDeductionExplanations: [],
        missingEvidence: [],
        confidence: 'HIGH',
        limitations: [],
        evidenceClassifications: [],
      })),
      telemetry: {
        requestedMode: 'PREFER_ON_DEVICE' as any,
        actualInferenceSource: 'ON_DEVICE',
        fallbackOccurred: false,
        modelUsed: 'gemini-nano-4',
        appCheckStatus: 'ACTIVE_AND_VERIFIED',
        latencyMs: 250,
        timestamp: '2026-10-11T00:00:00.000Z',
      },
      evaluatedAt: '2026-10-11T00:00:00.000Z',
      isImmutable: true,
    };
  }

  function makeHumanEval(params: {
    submissionId: string;
    referenceId: string;
    judgeId: string;
    judgeName: string;
    scores: Record<string, number>;
    aiTotalScore: number;
    decisionMode?: 'AGREE' | 'MODIFY' | 'REJECT';
    roundId?: string;
    status?: 'DRAFT' | 'SUBMITTED';
  }): HumanJudgeEvaluation {
    const total = Object.values(params.scores).reduce((a, b) => a + b, 0);
    return {
      id: `eval-${params.submissionId}-${params.judgeId}-${params.roundId || 'r1'}`,
      submissionId: params.submissionId,
      referenceId: params.referenceId,
      competitionId: compId,
      roundId: params.roundId || 'round-1',
      judgeId: params.judgeId,
      judgeName: params.judgeName,
      judgeEmail: `${params.judgeId}@judges.org`,
      decisionMode: params.decisionMode || 'MODIFY',
      scores: params.scores,
      totalScore: total,
      aiTotalScore: params.aiTotalScore,
      scoreDifference: total - params.aiTotalScore,
      criterionDifferences: {},
      deductionNotes: 'Verified human rubric scoring.',
      status: params.status || 'SUBMITTED',
      isLocked: (params.status || 'SUBMITTED') === 'SUBMITTED',
      submittedAt: '2026-10-12T12:00:00.000Z',
      reopenHistory: [],
      evaluatorVersion: 1,
      createdAt: '2026-10-12T12:00:00.000Z',
      updatedAt: '2026-10-12T12:00:00.000Z',
    };
  }

  beforeEach(() => {
    competitionService.resetInMemoryStore([testCompetition]);
    submissionService.clearMemoryStore();
    evaluationPipelineService.clearMemoryStore();
    judgeAssignmentService.resetForTesting();
    scoringLedgerService.resetForTesting();
    governanceAuditService.resetForTesting();
    resultsAndAnalyticsService.resetForTesting();
  });

  // ─────────────────────────────────────────────
  // 1. Configurable Aggregation Policies
  // ─────────────────────────────────────────────
  describe('1. Configurable Scoring Aggregation Policies', () => {
    it('defaults to human-only AVERAGE_JUDGE policy and NEVER counts AI automatically', () => {
      const policy = resultsAndAnalyticsService.getScoringPolicy(compId);
      expect(policy.policyType).toBe('AVERAGE_JUDGE');
      expect(policy.includeAiAsJudgeScore).toBe(false);
      expect(policy.aiWeight).toBe(0);

      const sub = makeSubmission({ id: 'sub-1', referenceId: 'PF-01', projectTitle: 'Alpha' });
      const input: EntryScoringInput = {
        submission: sub,
        aiReport: makeAiReport('sub-1', 'PF-01', 99), // Very high AI score must NOT affect official score
        humanEvaluations: [
          makeHumanEval({
            submissionId: 'sub-1',
            referenceId: 'PF-01',
            judgeId: 'j1',
            judgeName: 'Judge One',
            scores: { 'crit-tech': 20, 'crit-design': 20, 'crit-impact': 20, 'crit-idea': 20 }, // 80
            aiTotalScore: 99,
          }),
          makeHumanEval({
            submissionId: 'sub-1',
            referenceId: 'PF-01',
            judgeId: 'j2',
            judgeName: 'Judge Two',
            scores: { 'crit-tech': 18, 'crit-design': 18, 'crit-impact': 18, 'crit-idea': 16 }, // 70
            aiTotalScore: 99,
          }),
          // Draft evaluation must be ignored!
          makeHumanEval({
            submissionId: 'sub-1',
            referenceId: 'PF-01',
            judgeId: 'j3',
            judgeName: 'Judge Draft',
            scores: { 'crit-tech': 25, 'crit-design': 25, 'crit-impact': 25, 'crit-idea': 25 }, // 100 draft
            aiTotalScore: 99,
            status: 'DRAFT',
          }),
        ],
        rubric: testCompetition.rubric,
      };

      const res = resultsAndAnalyticsService.computeEntryScore(input, policy);
      expect(res.eligibleForRanking).toBe(true);
      expect(res.officialScore).toBe(75); // (80 + 70) / 2 = 75 (AI 99 and Draft 100 strictly ignored)
      expect(res.humanAverageScore).toBe(75);
      expect(res.aiScore).toBe(99);
      expect(res.aiHumanDelta).toBe(-24);
    });

    it('supports WEIGHTED_JUDGE policy with custom judge multipliers', () => {
      const policy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'WEIGHTED_JUDGE',
        judgeWeights: { j1: 2.0, j2: 1.0 },
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Lead domain specialist carries 2x panel weight.',
      });

      const sub = makeSubmission({ id: 'sub-w', referenceId: 'PF-W1', projectTitle: 'Weighted' });
      const input: EntryScoringInput = {
        submission: sub,
        aiReport: makeAiReport('sub-w', 'PF-W1', 50),
        humanEvaluations: [
          makeHumanEval({
            submissionId: 'sub-w',
            referenceId: 'PF-W1',
            judgeId: 'j1',
            judgeName: 'Lead Judge',
            scores: { 'crit-tech': 24, 'crit-design': 24, 'crit-impact': 24, 'crit-idea': 24 }, // 96 (weight 2)
            aiTotalScore: 50,
          }),
          makeHumanEval({
            submissionId: 'sub-w',
            referenceId: 'PF-W1',
            judgeId: 'j2',
            judgeName: 'Panel Judge',
            scores: { 'crit-tech': 18, 'crit-design': 18, 'crit-impact': 18, 'crit-idea': 18 }, // 72 (weight 1)
            aiTotalScore: 50,
          }),
        ],
        rubric: testCompetition.rubric,
      };

      const res = resultsAndAnalyticsService.computeEntryScore(input, policy);
      // (96 * 2 + 72 * 1) / 3 = 264 / 3 = 88.00
      expect(res.officialScore).toBe(88);
    });

    it('supports AI_ASSISTED policy ONLY when explicitly opted in by organizer', () => {
      // Attempt AI_ASSISTED without includeAiAsJudgeScore = true -> must stay human-only
      const guardedPolicy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'AI_ASSISTED',
        includeAiAsJudgeScore: false,
        aiWeight: 0.3,
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Testing opt-in guardrail',
      });
      expect(guardedPolicy.includeAiAsJudgeScore).toBe(false);
      expect(guardedPolicy.aiWeight).toBe(0);

      const sub = makeSubmission({ id: 'sub-ai', referenceId: 'PF-AI1', projectTitle: 'Assisted' });
      const input: EntryScoringInput = {
        submission: sub,
        aiReport: makeAiReport('sub-ai', 'PF-AI1', 100),
        humanEvaluations: [
          makeHumanEval({
            submissionId: 'sub-ai',
            referenceId: 'PF-AI1',
            judgeId: 'j1',
            judgeName: 'Judge One',
            scores: { 'crit-tech': 20, 'crit-design': 20, 'crit-impact': 20, 'crit-idea': 20 }, // 80
            aiTotalScore: 100,
          }),
        ],
        rubric: testCompetition.rubric,
      };

      const guardedRes = resultsAndAnalyticsService.computeEntryScore(input, guardedPolicy);
      expect(guardedRes.officialScore).toBe(80);

      // Now explicitly opt in with 25% AI weight
      const optedInPolicy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'AI_ASSISTED',
        includeAiAsJudgeScore: true,
        aiWeight: 0.25,
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Explicitly opted into 25% AI assistance for preliminary round.',
      });

      const assistedRes = resultsAndAnalyticsService.computeEntryScore(input, optedInPolicy);
      // 80 * 0.75 + 100 * 0.25 = 60 + 25 = 85
      expect(assistedRes.officialScore).toBe(85);
    });

    it('supports CRITERION_WEIGHTED policy using rubric criterion weights', () => {
      const policy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'CRITERION_WEIGHTED',
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Weighting technical depth at 40% per official rubric.',
      });

      const sub = makeSubmission({ id: 'sub-cw', referenceId: 'PF-CW1', projectTitle: 'CritWeighted' });
      // Rubric weights: tech 40%, design 20%, impact 25%, idea 15% (each max 25)
      // Scores: tech 25 (100%), design 15 (60%), impact 20 (80%), idea 10 (40%)
      // Simple sum = 70, but weighted = 1.0*40 + 0.6*20 + 0.8*25 + 0.4*15 = 40 + 12 + 20 + 6 = 78.00
      const input: EntryScoringInput = {
        submission: sub,
        aiReport: null,
        humanEvaluations: [
          makeHumanEval({
            submissionId: 'sub-cw',
            referenceId: 'PF-CW1',
            judgeId: 'j1',
            judgeName: 'Judge One',
            scores: { 'crit-tech': 25, 'crit-design': 15, 'crit-impact': 20, 'crit-idea': 10 },
            aiTotalScore: 70,
          }),
        ],
        rubric: testCompetition.rubric,
      };

      const res = resultsAndAnalyticsService.computeEntryScore(input, policy);
      expect(res.officialScore).toBe(78);
    });

    it('supports ROUND_WISE aggregation across multiple rounds', () => {
      const policy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'ROUND_WISE',
        roundWeights: { 'round-1': 40, 'round-2': 60 },
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Round 1 screening 40%, Round 2 finals 60%.',
      });

      const sub = makeSubmission({ id: 'sub-rw', referenceId: 'PF-RW1', projectTitle: 'MultiRound' });
      const input: EntryScoringInput = {
        submission: sub,
        aiReport: null,
        humanEvaluations: [
          makeHumanEval({
            submissionId: 'sub-rw',
            referenceId: 'PF-RW1',
            judgeId: 'j1',
            judgeName: 'R1 Judge',
            roundId: 'round-1',
            scores: { 'crit-tech': 20, 'crit-design': 20, 'crit-impact': 20, 'crit-idea': 20 }, // 80
            aiTotalScore: 80,
          }),
          makeHumanEval({
            submissionId: 'sub-rw',
            referenceId: 'PF-RW1',
            judgeId: 'j2',
            judgeName: 'R2 Judge',
            roundId: 'round-2',
            scores: { 'crit-tech': 23, 'crit-design': 22, 'crit-impact': 23, 'crit-idea': 22 }, // 90
            aiTotalScore: 80,
          }),
        ],
        rubric: testCompetition.rubric,
      };

      const res = resultsAndAnalyticsService.computeEntryScore(input, policy);
      // 80 * 0.4 + 90 * 0.6 = 32 + 54 = 86
      expect(res.officialScore).toBe(86);
      expect(res.roundScores['round-1']).toBe(80);
      expect(res.roundScores['round-2']).toBe(90);
    });
  });

  // ─────────────────────────────────────────────
  // 2. Append-Only Scoring Ledger & Immutability
  // ─────────────────────────────────────────────
  describe('2. Append-Only Scoring Ledger & Client Tampering Protection', () => {
    it('records immutable append-only score contributions with all required metadata and rejects direct client writes', async () => {
      // Direct unauthorized write without authorizedSource must throw
      expect(() =>
        scoringLedgerService.appendContribution({
          competitionId: compId,
          entryId: 'sub-1',
          evaluationId: 'eval-1',
          criterionId: 'crit-tech',
          score: 25,
          maxScore: 25,
          source: 'HUMAN',
          actorId: 'rogue-client',
          actorName: 'Frontend Hacker',
          reasonForAdjustment: 'Direct score hack',
        })
      ).toThrow(/prohibited/i);

      // Non-organizer calling authorized adjustment must throw
      await expect(
        resultsAndAnalyticsService.applyAuthorizedScoreAdjustment({
          competitionId: compId,
          entryId: 'sub-1',
          evaluationId: 'eval-1',
          criterionId: 'crit-tech',
          newScore: 25,
          maxScore: 25,
          organizerUserId: 'participant-1',
          organizerName: 'Participant',
          actorRole: 'PARTICIPANT',
          reason: 'Trying to boost own score',
        })
      ).rejects.toThrow(/prohibited/i);

      // Authorized contribution #1
      const entry1 = scoringLedgerService.appendContribution({
        competitionId: compId,
        entryId: 'sub-1',
        referenceId: 'PF-01',
        evaluationId: 'eval-1',
        criterionId: 'crit-tech',
        criterionName: 'Technical Depth',
        score: 20,
        maxScore: 25,
        source: 'HUMAN',
        actorId: 'user-judge-01',
        actorName: 'Dr. Elena Vance',
        reasonForAdjustment: 'Initial judge rubric score',
        authorizedSource: 'JUDGE_SUBMISSION',
      });

      expect(Object.isFrozen(entry1)).toBe(true);
      expect(entry1.competitionId).toBe(compId);
      expect(entry1.entryId).toBe('sub-1');
      expect(entry1.evaluationId).toBe('eval-1');
      expect(entry1.criterionId).toBe('crit-tech');
      expect(entry1.score).toBe(20);
      expect(entry1.maxScore).toBe(25);
      expect(entry1.source).toBe('HUMAN');
      expect(entry1.actorId).toBe('user-judge-01');
      expect(entry1.timestamp).toBeTruthy();
      expect(entry1.reasonForAdjustment).toBe('Initial judge rubric score');

      // Authorized adjustment appends a NEW record linking previousEntryId without mutating entry1
      const entry2 = await resultsAndAnalyticsService.applyAuthorizedScoreAdjustment({
        competitionId: compId,
        entryId: 'sub-1',
        referenceId: 'PF-01',
        evaluationId: 'eval-1',
        criterionId: 'crit-tech',
        criterionName: 'Technical Depth',
        newScore: 22,
        maxScore: 25,
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Verified test suite commit timestamp prior to cutoff.',
      });

      expect(entry2.isAdjustment).toBe(true);
      expect(entry2.previousEntryId).toBe(entry1.id);
      expect(entry2.sequenceNumber).toBeGreaterThan(entry1.sequenceNumber);

      // Both records coexist permanently in append-only ledger
      const all = scoringLedgerService.listEntries({ competitionId: compId, order: 'ASC' });
      expect(all.length).toBe(2);
      expect(all[0].score).toBe(20);
      expect(all[1].score).toBe(22);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Rankings, Scopes, Ties, Tie-Breakers & Determinism
  // ─────────────────────────────────────────────
  describe('3. Scopes, Ties, Configurable Tie-Breakers & Ranking Determinism', () => {
    const buildFixtureInputs = (): EntryScoringInput[] => {
      const s1 = makeSubmission({
        id: 'sub-a',
        referenceId: 'PF-A',
        projectTitle: 'Project A (Leader)',
        submissionType: 'TEAM',
        track: 'Healthcare AI',
        createdAt: '2026-10-10T09:00:00.000Z',
      });
      const s2 = makeSubmission({
        id: 'sub-b',
        referenceId: 'PF-B',
        projectTitle: 'Project B (Tied 84, Higher Tech)',
        submissionType: 'INDIVIDUAL',
        track: 'Healthcare AI',
        createdAt: '2026-10-10T11:00:00.000Z',
      });
      const s3 = makeSubmission({
        id: 'sub-c',
        referenceId: 'PF-C',
        projectTitle: 'Project C (Tied 84, Lower Tech)',
        submissionType: 'TEAM',
        track: 'Climate Tech',
        createdAt: '2026-10-10T08:00:00.000Z',
      });
      const s4 = makeSubmission({
        id: 'sub-d',
        referenceId: 'PF-D',
        projectTitle: 'Project D (Fourth)',
        submissionType: 'INDIVIDUAL',
        track: 'Climate Tech',
        createdAt: '2026-10-10T12:00:00.000Z',
      });

      return [
        {
          submission: s1,
          aiReport: makeAiReport('sub-a', 'PF-A', 90),
          humanEvaluations: [
            makeHumanEval({
              submissionId: 'sub-a',
              referenceId: 'PF-A',
              judgeId: 'j1',
              judgeName: 'J1',
              scores: { 'crit-tech': 23, 'crit-design': 23, 'crit-impact': 23, 'crit-idea': 23 }, // 92
              aiTotalScore: 90,
            }),
          ],
          rubric: testCompetition.rubric,
        },
        {
          submission: s2,
          aiReport: makeAiReport('sub-b', 'PF-B', 80),
          humanEvaluations: [
            makeHumanEval({
              submissionId: 'sub-b',
              referenceId: 'PF-B',
              judgeId: 'j1',
              judgeName: 'J1',
              scores: { 'crit-tech': 24, 'crit-design': 20, 'crit-impact': 20, 'crit-idea': 20 }, // 84 (Tech 24)
              aiTotalScore: 80,
            }),
          ],
          rubric: testCompetition.rubric,
        },
        {
          submission: s3,
          aiReport: makeAiReport('sub-c', 'PF-C', 85),
          humanEvaluations: [
            makeHumanEval({
              submissionId: 'sub-c',
              referenceId: 'PF-C',
              judgeId: 'j1',
              judgeName: 'J1',
              scores: { 'crit-tech': 20, 'crit-design': 22, 'crit-impact': 22, 'crit-idea': 20 }, // 84 (Tech 20)
              aiTotalScore: 85,
            }),
          ],
          rubric: testCompetition.rubric,
        },
        {
          submission: s4,
          aiReport: makeAiReport('sub-d', 'PF-D', 72),
          humanEvaluations: [
            makeHumanEval({
              submissionId: 'sub-d',
              referenceId: 'PF-D',
              judgeId: 'j1',
              judgeName: 'J1',
              scores: { 'crit-tech': 18, 'crit-design': 18, 'crit-impact': 18, 'crit-idea': 18 }, // 72
              aiTotalScore: 72,
            }),
          ],
          rubric: testCompetition.rubric,
        },
      ];
    };

    it('preserves true ties (1, 2, 2, 4) when tie-breakers are disabled and breaks ties deterministically when enabled', () => {
      const inputs = buildFixtureInputs();

      // 1. Disable all tie-breakers -> Project B and C share Rank #2, Project D is Rank #4
      const noTieBreakPolicy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'AVERAGE_JUDGE',
        tieBreakers: [
          { type: 'HIGHEST_WEIGHTED_CRITERION', label: 'Highest Weighted Criterion', enabled: false },
          { type: 'LOWEST_JUDGE_VARIANCE', label: 'Lowest Variance', enabled: false },
        ],
        organizerUserId: 'org-1',
        organizerName: 'Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Allow shared ranks for tied scores',
      });

      const tiedRanking = resultsAndAnalyticsService.rankEntries({
        inputs,
        policy: noTieBreakPolicy,
      });

      expect(tiedRanking.map((e) => ({ id: e.submissionId, rank: e.rank, isTied: e.isTied }))).toEqual([
        { id: 'sub-a', rank: 1, isTied: false },
        { id: 'sub-b', rank: 2, isTied: true },
        { id: 'sub-c', rank: 2, isTied: true },
        { id: 'sub-d', rank: 4, isTied: false },
      ]);

      // 2. Enable HIGHEST_WEIGHTED_CRITERION (crit-tech is 40% weight) -> Project B (Tech 24) beats Project C (Tech 20)
      const critTieBreakPolicy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'AVERAGE_JUDGE',
        tieBreakers: [
          { type: 'HIGHEST_WEIGHTED_CRITERION', label: 'Highest Weighted Criterion Score', enabled: true },
        ],
        organizerUserId: 'org-1',
        organizerName: 'Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Break ties by Technical Depth criterion',
      });

      const resolvedByTech = resultsAndAnalyticsService.rankEntries({
        inputs,
        policy: critTieBreakPolicy,
      });

      expect(resolvedByTech.map((e) => ({ id: e.submissionId, rank: e.rank, isTied: e.isTied }))).toEqual([
        { id: 'sub-a', rank: 1, isTied: false },
        { id: 'sub-b', rank: 2, isTied: false },
        { id: 'sub-c', rank: 3, isTied: false },
        { id: 'sub-d', rank: 4, isTied: false },
      ]);
      expect(resolvedByTech[2].tieBrokenBy).toContain('Highest Weighted Criterion');

      // 3. Switch tie-breaker to EARLIEST_SUBMISSION -> Project C (08:00) beats Project B (11:00)
      const earliestPolicy = resultsAndAnalyticsService.updateScoringPolicy({
        competitionId: compId,
        policyType: 'AVERAGE_JUDGE',
        tieBreakers: [
          { type: 'EARLIEST_SUBMISSION', label: 'Earliest Submission Timestamp', enabled: true },
        ],
        organizerUserId: 'org-1',
        organizerName: 'Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Break ties by earliest timestamp',
      });

      const resolvedByTime = resultsAndAnalyticsService.rankEntries({
        inputs,
        policy: earliestPolicy,
      });
      expect(resolvedByTime[1].submissionId).toBe('sub-c');
      expect(resolvedByTime[2].submissionId).toBe('sub-b');
    });

    it('guarantees 100% ranking determinism across arbitrary input permutations and scopes', () => {
      const baseInputs = buildFixtureInputs();
      const policy = resultsAndAnalyticsService.getScoringPolicy(compId);

      const order1 = resultsAndAnalyticsService.rankEntries({ inputs: baseInputs, policy });
      const order2 = resultsAndAnalyticsService.rankEntries({
        inputs: [...baseInputs].reverse(),
        policy,
      });
      const order3 = resultsAndAnalyticsService.rankEntries({
        inputs: [baseInputs[2], baseInputs[0], baseInputs[3], baseInputs[1]],
        policy,
      });

      const simplify = (list: typeof order1) =>
        list.map((e) => `${e.rank}:${e.submissionId}:${e.officialScore}:${e.isTied}`);

      expect(simplify(order2)).toEqual(simplify(order1));
      expect(simplify(order3)).toEqual(simplify(order1));

      // Verify Individual, Team, and Category scopes
      const teamRanking = resultsAndAnalyticsService.rankEntries({
        inputs: baseInputs,
        policy,
        scope: 'TEAM',
      });
      expect(teamRanking.every((e) => e.submissionType === 'TEAM')).toBe(true);
      expect(teamRanking.length).toBe(2);

      const indRanking = resultsAndAnalyticsService.rankEntries({
        inputs: baseInputs,
        policy,
        scope: 'INDIVIDUAL',
      });
      expect(indRanking.every((e) => e.submissionType === 'INDIVIDUAL')).toBe(true);
      expect(indRanking.length).toBe(2);

      const climateRanking = resultsAndAnalyticsService.rankEntries({
        inputs: baseInputs,
        policy,
        scope: 'CATEGORY',
        category: 'Climate Tech',
      });
      expect(climateRanking.every((e) => e.category === 'Climate Tech')).toBe(true);
      expect(climateRanking.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Official Publication, Public Leaderboard, CSV Export, Analytics & Audit
  // ─────────────────────────────────────────────
  describe('4. End-to-End Publication, Public Leaderboard, Analytics & Complete Audit Trail', () => {
    it('executes organizer approval, publication, unpublishing, CSV export, analytics & audit verification', async () => {
      // Seed 3 real submissions + AI reports + judge assignments + human evaluations
      const sub1 = makeSubmission({
        id: 'sub-pub-1',
        referenceId: 'PF-PUB-01',
        projectTitle: 'NeuroEdge, "Realtime" Monitor',
        submissionType: 'TEAM',
        track: 'Healthcare AI',
      });
      const sub2 = makeSubmission({
        id: 'sub-pub-2',
        referenceId: 'PF-PUB-02',
        projectTitle: 'EcoGrid Optimizer',
        submissionType: 'INDIVIDUAL',
        track: 'Climate Tech',
      });
      const sub3FailedAi = makeSubmission({
        id: 'sub-pub-3',
        referenceId: 'PF-PUB-03',
        projectTitle: 'Corrupt Artifact Entry',
        submissionType: 'INDIVIDUAL',
        track: 'Developer Tools',
        status: 'AI Evaluation Failed',
      });

      await submissionService.saveSubmission(sub1);
      await submissionService.saveSubmission(sub2);
      await submissionService.saveSubmission(sub3FailedAi);

      await evaluationPipelineService.saveEvaluationReport(makeAiReport(sub1.id, sub1.referenceId, 82));
      await evaluationPipelineService.saveEvaluationReport(makeAiReport(sub2.id, sub2.referenceId, 78));

      // Assignment + Reassignment audit
      const asgn1 = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: sub1.id,
        referenceId: sub1.referenceId,
        projectTitle: sub1.projectTitle,
        judgeId: 'user-judge-01',
        assignedBy: 'org-1',
        assignedByName: 'Lead Organizer',
      });
      await judgeAssignmentService.reassignSubmission(
        asgn1.id,
        'judge-maya',
        'org-1',
        'Lead Organizer',
        'Reassigning to specialist for clinical review.'
      );

      // Submit human evaluations for sub1 (score 88) and sub2 (score 76)
      const eval1 = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub1.id,
        referenceId: sub1.referenceId,
        competitionId: compId,
        judgeId: 'judge-maya',
        judgeName: 'Dr. Maya Patel',
        judgeEmail: 'maya.patel@deepmind.academic',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 23, 'crit-design': 21, 'crit-impact': 22, 'crit-idea': 22 },
        totalScore: 88,
        aiTotalScore: 82,
        criterionDifferences: {},
        deductionNotes: 'Stronger clinical edge architecture than AI baseline.',
      });

      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub2.id,
        referenceId: sub2.referenceId,
        competitionId: compId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 19, 'crit-design': 19, 'crit-impact': 19, 'crit-idea': 19 },
        totalScore: 76,
        aiTotalScore: 78,
        criterionDifferences: {},
        deductionNotes: 'Minor calibration deduction on live grid API.',
      });

      // Reopen & re-lock eval1 to test REOPENED_EVALUATION audit
      await judgeAssignmentService.reopenEvaluation({
        evaluationId: eval1.id,
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        auditReason: 'Double-checking benchmark verification evidence.',
      });
      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub1.id,
        referenceId: sub1.referenceId,
        competitionId: compId,
        judgeId: 'judge-maya',
        judgeName: 'Dr. Maya Patel',
        judgeEmail: 'maya.patel@deepmind.academic',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 24, 'crit-design': 21, 'crit-impact': 22, 'crit-idea': 22 },
        totalScore: 89,
        aiTotalScore: 82,
        criterionDifferences: {},
        deductionNotes: 'Confirmed verified benchmark logs (+1 pt Tech).',
      });

      // Apply organizer AI failure override on sub3 to test ADMIN_OVERRIDE audit
      const overriddenSub3 = submissionLifecycleService.applyAiFailureOverride(sub3FailedAi, {
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        reason: 'Manual artifact verified; unlocking for human judge review.',
      });
      expect(overriddenSub3.status).toBe('Ready for Judge Review');

      // 1. Before publishing, public leaderboard MUST return null (never leak provisional results!)
      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).toBeNull();

      // 2. Non-organizer cannot publish
      await expect(
        resultsAndAnalyticsService.publishOfficialResults({
          competitionId: compId,
          organizerUserId: 'user-judge-01',
          organizerName: 'Dr. Elena Vance',
          actorRole: 'JUDGE',
          approvalReason: 'Attempting unauthorized publish',
        })
      ).rejects.toThrow(/unauthorized/i);

      // 3. Organizer explicitly publishes official results
      const published = await resultsAndAnalyticsService.publishOfficialResults({
        competitionId: compId,
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        approvalReason: 'All final evaluations audited and officially approved.',
      });

      expect(published.status).toBe('PUBLISHED');
      expect(published.version).toBe(1);
      expect(published.entries.length).toBe(2);
      expect(published.entries[0].submissionId).toBe(sub1.id);
      expect(published.entries[0].officialScore).toBe(89);
      expect(published.entries[0].resultState).toBe('OFFICIAL');

      // Public leaderboard is now live!
      const liveBoard = resultsAndAnalyticsService.getPublicLeaderboard(compId);
      expect(liveBoard).not.toBeNull();
      expect(liveBoard?.version).toBe(1);

      // 4. CSV Export handles commas & quotes safely
      const csv = resultsAndAnalyticsService.exportResultsToCsv(
        published.entries,
        testCompetition.title,
        'OFFICIAL_v1'
      );
      expect(csv).toContain('"NeuroEdge, ""Realtime"" Monitor"');
      expect(csv).toContain('OFFICIAL_v1');

      // 5. Authorized Unpublish takes public leaderboard offline
      const unpublished = await resultsAndAnalyticsService.unpublishOfficialResults({
        competitionId: compId,
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Reviewing late category clarification request.',
      });
      expect(unpublished.status).toBe('UNPUBLISHED');
      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).toBeNull();

      // 6. Verify Analytics & AI/Human Comparison Report
      const analytics = await resultsAndAnalyticsService.computeCompetitionAnalytics(compId);
      expect(analytics.totalSubmissions).toBe(3);
      expect(analytics.validSubmissions).toBe(3);
      expect(analytics.aiEvaluationsCompleted).toBe(2);
      expect(analytics.aiEvaluationsFailed).toBe(1);
      expect(analytics.averageOfficialScore).toBe(82.5); // (89 + 76) / 2
      expect(analytics.aiHumanComparison.disclaimer).toBe(AI_HUMAN_CORRELATION_DISCLAIMER);
      expect(analytics.aiHumanComparison.disclaimer).toMatch(/NEVER proof of correctness/i);
      expect(analytics.aiHumanComparison.comparedCount).toBe(2);
      // Deltas: sub1 (+7), sub2 (-2) => mean signed = +2.5, mean abs = 4.5
      expect(analytics.aiHumanComparison.meanSignedDifference).toBe(2.5);
      expect(analytics.aiHumanComparison.meanAbsoluteDifference).toBe(4.5);

      // 7. Verify ALL Governance Audit categories were logged!
      const auditEvents = governanceAuditService.listEvents({ competitionId: compId });
      const categoriesLogged = new Set(auditEvents.map((e) => e.category));
      expect(categoriesLogged.has('SCORE_CHANGE')).toBe(true);
      expect(categoriesLogged.has('EVALUATION_SUBMISSION')).toBe(true);
      expect(categoriesLogged.has('ASSIGNMENT_CHANGE')).toBe(true);
      expect(categoriesLogged.has('PUBLICATION_ACTION')).toBe(true);
      expect(categoriesLogged.has('REOPENED_EVALUATION')).toBe(true);
      expect(categoriesLogged.has('ADMIN_OVERRIDE')).toBe(true);
    });
  });
});
