// ─────────────────────────────────────────────
// phase12JudgeCalibrationAndDisagreement.test.ts
// Unit & Integration Tests for Proofly Phase 12 — Calibration & Disagreement Studio
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CalibrationAndDisagreementService,
} from '../calibrationAndDisagreementService';
import { judgeAssignmentService } from '../judgeAssignmentService';
import { scoringLedgerService } from '../scoringLedgerService';
import type { RubricCriterion } from '../../types/authAndCompetition';

const submitTestEval = async (payload: any) => {
  return (judgeAssignmentService.submitFinalEvaluation as any)({
    referenceId: 'PF-TEST-REF',
    decisionMode: 'MODIFY',
    aiTotalScore: 70,
    totalScore: payload.totalScore ?? Object.values(payload.scores || {}).reduce((a: any, b: any) => a + Number(b), 0),
    criterionDifferences: {},
    deductionNotes: 'Standard judge review.',
    ...payload,
  });
};

describe('Proofly Phase 12 — Judge Calibration and Disagreement Analysis', () => {
  let service: CalibrationAndDisagreementService;

  const mockRubric: RubricCriterion[] = [
    {
      id: 'crit-tech',
      name: 'Technological Implementation',
      description: 'Robustness, code quality and architecture.',
      maxScore: 25,
      weight: 25,
    },
    {
      id: 'crit-design',
      name: 'Design & UX',
      description: 'Ergonomics, clarity, accessibility.',
      maxScore: 25,
      weight: 25,
    },
    {
      id: 'crit-impact',
      name: 'Potential Impact',
      description: 'Real-world value and scalability.',
      maxScore: 25,
      weight: 25,
    },
    {
      id: 'crit-idea',
      name: 'Quality of Idea',
      description: 'Novelty and creativity.',
      maxScore: 25,
      weight: 25,
    },
  ];

  beforeEach(() => {
    service = new CalibrationAndDisagreementService();
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. JUDGE CALIBRATION EXERCISES & BLIND BENCHMARK INTEGRITY
  // ─────────────────────────────────────────────────────────────────
  describe('1. Judge Calibration & Blind Mode Integrity', () => {
    it('creates a calibration exercise with reference rubric, scores, and benchmark reasoning', async () => {
      const exercise = await service.createCalibrationExercise({
        organizationId: 'org-test',
        competitionId: 'comp-hackathon-2026',
        title: 'Calibration: EventScout Sample Submission',
        description: 'Standard benchmark calibration for Event Tech track.',
        sampleProject: {
          title: 'EventScout',
          description: 'Autonomous event discovery system.',
          track: 'Event Tech',
          artifacts: [
            { name: 'README.md', type: 'TEXT_MARKDOWN', contentSnippet: '# EventScout' },
            { name: 'pitch.pdf', type: 'PDF' },
          ],
        },
        rubric: mockRubric,
        referenceScores: {
          'crit-tech': 20,
          'crit-design': 18,
          'crit-impact': 22,
          'crit-idea': 21,
        },
        referenceReasoning: {
          'crit-tech': 'Comprehensive architecture with real API routes, but lacks end-to-end load tests.',
          'crit-design': 'Clean responsive interface, minor contrast issues in dark mode.',
          'crit-impact': 'Strong market potential for hackathon organizing teams.',
          'crit-idea': 'Novel hybrid agent approach.',
        },
        status: 'ACTIVE',
        createdBy: 'org-admin-1',
        createdByName: 'Alice Organizer',
      });

      expect(exercise.id).toBeDefined();
      expect(exercise.status).toBe('ACTIVE');
      expect(exercise.referenceScores['crit-tech']).toBe(20);
    });

    it('strictly hides reference scores and reasoning when retrieved in judge mode', async () => {
      const exercise = await service.createCalibrationExercise({
        organizationId: 'org-test',
        competitionId: 'comp-1',
        title: 'Blind Calibration Exercise',
        description: 'Testing blind scorecard delivery.',
        sampleProject: {
          title: 'Sample App',
          description: 'A test project.',
        },
        rubric: mockRubric,
        referenceScores: { 'crit-tech': 22, 'crit-design': 20 },
        referenceReasoning: { 'crit-tech': 'Benchmark rationale' },
        status: 'ACTIVE',
        createdBy: 'admin-1',
        createdByName: 'Admin',
      });

      // 1. Judge View (isJudgeView = true)
      const judgeView = await service.getCalibrationExercise(exercise.id, true);
      expect(judgeView).not.toBeNull();
      expect(Object.keys(judgeView!.referenceScores)).toHaveLength(0);
      expect(Object.keys(judgeView!.referenceReasoning)).toHaveLength(0);

      // 2. Organizer View (isJudgeView = false)
      const organizerView = await service.getCalibrationExercise(exercise.id, false);
      expect(organizerView).not.toBeNull();
      expect(organizerView!.referenceScores['crit-tech']).toBe(22);
      expect(organizerView!.referenceReasoning['crit-tech']).toBe('Benchmark rationale');
    });

    it('evaluates judge calibration submission, reveals benchmarks, and calculates deviation metrics', async () => {
      const exercise = await service.createCalibrationExercise({
        organizationId: 'org-test',
        competitionId: 'comp-1',
        title: 'Benchmark 1',
        description: 'Test',
        sampleProject: { title: 'Project A', description: 'Desc' },
        rubric: mockRubric,
        referenceScores: {
          'crit-tech': 20,
          'crit-design': 18,
          'crit-impact': 22,
          'crit-idea': 20,
        },
        referenceReasoning: {
          'crit-tech': 'Benchmark tech rationale',
          'crit-design': 'Benchmark design rationale',
          'crit-impact': 'Benchmark impact rationale',
          'crit-idea': 'Benchmark idea rationale',
        },
        status: 'ACTIVE',
        createdBy: 'admin-1',
        createdByName: 'Admin',
      });

      // Judge submits proposed scores: tech=24 (+4), design=18 (0, exact), impact=15 (-7, high confusion), idea=21 (+1)
      const submission = await service.submitJudgeCalibration({
        exerciseId: exercise.id,
        judgeId: 'judge-dr-lee',
        judgeName: 'Dr. Lee',
        judgeEmail: 'lee@example.edu',
        proposedScores: {
          'crit-tech': 24,
          'crit-design': 18,
          'crit-impact': 15,
          'crit-idea': 21,
        },
        criterionComments: {
          'crit-impact': 'Felt the scalability claim was overly optimistic.',
        },
      });

      expect(submission.totalProposedScore).toBe(78);
      expect(submission.totalReferenceScore).toBe(80);
      expect(submission.totalDifference).toBe(-2);
      expect(submission.exactCount).toBe(1); // Design was exact match
      expect(submission.overscoringCount).toBe(2); // Tech (+4), Idea (+1)
      expect(submission.underscoringCount).toBe(1); // Impact (-7)

      // Criterion-level deviation checks
      const designDev = submission.criterionDeviations['crit-design'];
      expect(designDev.alignment).toBe('EXACT');
      expect(designDev.referenceScore).toBe(18);
      expect(designDev.referenceReasoning).toBe('Benchmark design rationale');

      const impactDev = submission.criterionDeviations['crit-impact'];
      expect(impactDev.difference).toBe(-7);
      expect(impactDev.alignment).toBe('HIGH_CONFUSION'); // 7/25 = 28% deviation > 25% threshold
      expect(submission.confusionCriteria).toContain('Potential Impact');
    });

    it('compiles multi-exercise judge calibration summary without treating deviation as misconduct', async () => {
      // Create 2 calibration exercises
      const ex1 = await service.createCalibrationExercise({
        organizationId: 'org-test',
        competitionId: 'comp-1',
        title: 'Exercise 1',
        description: 'Test',
        sampleProject: { title: 'Project 1', description: 'Desc' },
        rubric: mockRubric,
        referenceScores: { 'crit-tech': 20, 'crit-design': 20, 'crit-impact': 20, 'crit-idea': 20 },
        referenceReasoning: {},
        status: 'ACTIVE',
        createdBy: 'admin',
        createdByName: 'Admin',
      });

      const ex2 = await service.createCalibrationExercise({
        organizationId: 'org-test',
        competitionId: 'comp-1',
        title: 'Exercise 2',
        description: 'Test',
        sampleProject: { title: 'Project 2', description: 'Desc' },
        rubric: mockRubric,
        referenceScores: { 'crit-tech': 15, 'crit-design': 15, 'crit-impact': 15, 'crit-idea': 15 },
        referenceReasoning: {},
        status: 'ACTIVE',
        createdBy: 'admin',
        createdByName: 'Admin',
      });

      // Judge submits both exercises with mild over-scoring (+3 total on each)
      await service.submitJudgeCalibration({
        exerciseId: ex1.id,
        judgeId: 'judge-sarah',
        judgeName: 'Sarah Jenkins',
        judgeEmail: 'sarah@example.com',
        proposedScores: { 'crit-tech': 21, 'crit-design': 21, 'crit-impact': 21, 'crit-idea': 20 },
      });

      await service.submitJudgeCalibration({
        exerciseId: ex2.id,
        judgeId: 'judge-sarah',
        judgeName: 'Sarah Jenkins',
        judgeEmail: 'sarah@example.com',
        proposedScores: { 'crit-tech': 16, 'crit-design': 16, 'crit-impact': 16, 'crit-idea': 15 },
      });

      const report = await service.getJudgeCalibrationReport('judge-sarah');
      expect(report.exercisesCompleted).toBe(2);
      expect(report.consistentAcrossExercises).toBe(true);
      expect(report.overallBiasScore).toBe(3);
      expect(report.guidanceNote).toContain('never used as proof of bias or misconduct');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. STATISTICAL VARIANCE & DISAGREEMENT DETECTION
  // ─────────────────────────────────────────────────────────────────
  describe('2. Score Variance, Disagreement Detection & Configurable Thresholds', () => {
    it('calculates correct mathematical mean, median, sample variance, and standard deviation', () => {
      const values = [10, 15, 20];
      const mean = service.calculateMean(values);
      const median = service.calculateMedian(values);
      const { variance, standardDeviation } = service.calculateVariance(values);

      expect(mean).toBe(15);
      expect(median).toBe(15);
      // Sample variance: [(10-15)^2 + (15-15)^2 + (20-15)^2] / (3 - 1) = [25 + 0 + 25] / 2 = 25
      expect(variance).toBe(25);
      expect(standardDeviation).toBe(5);
    });

    it('detects large score differences, contradictory assessments, and missing judge evaluations', async () => {
      const submissionId = 'sub-dispute-test-1';
      const competitionId = 'comp-ai-clash';

      // 1. Create 3 assignments (Judge A, Judge B, Judge C)
      await judgeAssignmentService.assignSubmission({
        competitionId,
        submissionId,
        referenceId: 'PF-SUB-DISPUTE-1',
        projectTitle: 'MediScan AI',
        judgeId: 'judge-a',
        judgeName: 'Judge Alice',
        judgeEmail: 'alice@judge.org',
        assignedBy: 'admin',
        assignedByName: 'Admin',
      });
      await judgeAssignmentService.assignSubmission({
        competitionId,
        submissionId,
        referenceId: 'PF-SUB-DISPUTE-1',
        projectTitle: 'MediScan AI',
        judgeId: 'judge-b',
        judgeName: 'Judge Bob',
        judgeEmail: 'bob@judge.org',
        assignedBy: 'admin',
        assignedByName: 'Admin',
      });
      await judgeAssignmentService.assignSubmission({
        competitionId,
        submissionId,
        referenceId: 'PF-SUB-DISPUTE-1',
        projectTitle: 'MediScan AI',
        judgeId: 'judge-c',
        judgeName: 'Judge Charlie',
        judgeEmail: 'charlie@judge.org',
        assignedBy: 'admin',
        assignedByName: 'Admin',
      });

      // 2. Submit evaluations for Judge A and Judge B (Judge C is missing!)
      // Judge A rates Tech highly: 24/25 (96%)
      await submitTestEval({
        submissionId,
        competitionId,
        judgeId: 'judge-a',
        judgeName: 'Judge Alice',
        judgeEmail: 'alice@judge.org',
        decisionMode: 'MODIFY',
        scores: {
          'crit-tech': 24,
          'crit-design': 20,
        },
        criterionComments: {
          'crit-tech': 'Flawless edge inference pipeline with complete offline failover.',
        },
        deductionNotes: 'Minor deduction for missing dark mode.',
      });

      // Judge B rates Tech very low: 8/25 (32% -> Contradictory!)
      await submitTestEval({
        submissionId,
        competitionId,
        judgeId: 'judge-b',
        judgeName: 'Judge Bob',
        judgeEmail: 'bob@judge.org',
        decisionMode: 'MODIFY',
        scores: {
          'crit-tech': 8,
          'crit-design': 19,
        },
        criterionComments: {
          'crit-tech': 'Could not verify on-device weights, appears to be an unauthenticated REST stub.',
        },
        deductionNotes: 'Heavy penalty for unsubstantiated edge claims.',
      });

      // 3. Run Disagreement Analysis
      const analysis = await service.analyzeSubmissionDisagreement(submissionId);

      expect(analysis.completedJudgesCount).toBe(2);
      expect(analysis.assignedJudgesCount).toBe(3);
      expect(analysis.hasMissingEvaluations).toBe(true);
      expect(analysis.missingJudgeEvaluations).toHaveLength(1);
      expect(analysis.missingJudgeEvaluations[0].judgeId).toBe('judge-c');

      // Check Tech criterion disagreement
      const techDispute = analysis.criterionDisagreements.find((c) => c.criterionId === 'crit-tech');
      expect(techDispute).toBeDefined();
      expect(techDispute!.scoreSpread).toBe(16); // 24 - 8
      expect(techDispute!.isLargeDifference).toBe(true); // 16 >= threshold of 5
      expect(techDispute!.isContradictory).toBe(true); // 24/25 (96%) >= 80% AND 8/25 (32%) <= 40%
      expect(techDispute!.primaryCauseDescription).toContain('Contradictory assessment');

      // Verify overall dispute severity
      expect(analysis.isOverallDisputed).toBe(true); // Total spread 44 - 27 = 17 >= threshold 15
      expect(analysis.disputeSeverity).toMatch(/MODERATE|HIGH|CRITICAL/);
    });

    it('respects configurable thresholds when evaluating dispute severity', async () => {
      const submissionId = 'sub-threshold-test';
      const competitionId = 'comp-custom-thresholds';

      await submitTestEval({
        submissionId,
        competitionId,
        judgeId: 'judge-1',
        judgeName: 'Judge 1',
        judgeEmail: 'j1@test.com',
        scores: { 'crit-tech': 20 },
        deductionNotes: '',
      });

      await submitTestEval({
        submissionId,
        competitionId,
        judgeId: 'judge-2',
        judgeName: 'Judge 2',
        judgeEmail: 'j2@test.com',
        scores: { 'crit-tech': 14 }, // spread = 6
        deductionNotes: '',
      });

      // Under default threshold of 5, spread=6 is a dispute
      const defaultAnalysis = await service.analyzeSubmissionDisagreement(submissionId);
      const defaultTech = defaultAnalysis.criterionDisagreements.find((c) => c.criterionId === 'crit-tech');
      expect(defaultTech?.isLargeDifference).toBe(true);

      // Relax threshold to 8 points and variance to 20
      service.setCompetitionThresholds(competitionId, {
        criterionSpreadThreshold: 8,
        criterionVarianceThreshold: 20,
      });
      const relaxedAnalysis = await service.analyzeSubmissionDisagreement(submissionId);
      const relaxedTech = relaxedAnalysis.criterionDisagreements.find((c) => c.criterionId === 'crit-tech');
      expect(relaxedTech?.isLargeDifference).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. ADJUDICATION & IMMUTABLE SCORE RESOLUTION WORKFLOW
  // ─────────────────────────────────────────────────────────────────
  describe('3. Adjudication, Clarification Requests & Immutability Protection', () => {
    it('manages clarification requests and records judge responses', async () => {
      const submissionId = 'sub-clarif-test';
      const compId = 'comp-adjudication-demo';

      // Setup two conflicting judge evaluations
      await submitTestEval({
        submissionId,
        competitionId: compId,
        judgeId: 'judge-alpha',
        judgeName: 'Judge Alpha',
        judgeEmail: 'alpha@test.com',
        scores: { 'crit-tech': 25 },
        deductionNotes: 'Perfect score',
      });
      await submitTestEval({
        submissionId,
        competitionId: compId,
        judgeId: 'judge-beta',
        judgeName: 'Judge Beta',
        judgeEmail: 'beta@test.com',
        scores: { 'crit-tech': 10 },
        deductionNotes: 'Severely penalizing external dependency',
      });

      // 1. Organizer requests clarification from Judge Beta
      const req = await service.requestClarification({
        submissionId,
        judgeId: 'judge-beta',
        criteriaIds: ['crit-tech'],
        question: 'Did you review src/edge/weights.bin before deducting 15 points?',
        requestedBy: 'organizer-lead',
        requestedByName: 'Head Organizer',
      });

      expect(req.requestId).toBeDefined();
      expect(req.judgeId).toBe('judge-beta');

      // Check adjudication status is now CLARIFICATION_REQUESTED
      let analysis = await service.analyzeSubmissionDisagreement(submissionId);
      expect(analysis.adjudicationStatus).toBe('CLARIFICATION_REQUESTED');

      // 2. Judge Beta responds to clarification
      const updatedAdj = await service.recordClarificationResponse({
        adjudicationId: analysis.activeAdjudicationId!,
        requestId: req.requestId,
        response: 'Reviewed the binary weights on second inspection; the fallback is valid.',
      });

      const matchedReq = updatedAdj.clarificationRequests.find((r) => r.requestId === req.requestId);
      expect(matchedReq?.response).toContain('fallback is valid');
      expect(matchedReq?.respondedAt).toBeDefined();
    });

    it('records an approved adjudication adjustment in the scoring ledger while strictly preserving original judge evaluations', async () => {
      const submissionId = 'sub-immutable-test';
      const compId = 'comp-adjudication-ledger';

      // 1. Judges submit evaluations
      await submitTestEval({
        submissionId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Judge One',
        judgeEmail: 'one@test.com',
        scores: { 'crit-tech': 24, 'crit-design': 20 },
        deductionNotes: '',
      });

      await submitTestEval({
        submissionId,
        competitionId: compId,
        judgeId: 'judge-2',
        judgeName: 'Judge Two',
        judgeEmail: 'two@test.com',
        scores: { 'crit-tech': 10, 'crit-design': 22 },
        deductionNotes: '',
      });

      // 2. Adjudicator reviews and records a resolution
      const resolution = await service.saveAdjudicationResolution({
        submissionId,
        competitionId: compId,
        disputedCriterionIds: ['crit-tech'],
        resolutionType: 'PANEL_CONSENSUS',
        adjustedScores: { 'crit-tech': 19, 'crit-design': 21 },
        resolutionRationale: 'Panel consensus reached after inspecting clarification response.',
        adjudicatorId: 'lead-adjudicator-1',
        adjudicatorName: 'Prof. Miller',
        adjudicatorRole: 'ADJUDICATOR',
      });

      expect(resolution.status).toBe('DRAFT');
      expect(resolution.adjustedTotalScore).toBe(40);

      // 3. Approve Adjudication Adjustment
      const approved = await service.approveAdjudicationAdjustment(
        resolution.id,
        { id: 'lead-adjudicator-1', name: 'Prof. Miller', role: 'ADJUDICATOR' }
      );

      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedAt).toBeDefined();

      // 4. CRITICAL GOVERNANCE CHECK:
      // Verify that original HumanJudgeEvaluation records are 100% PRESERVED and NOT mutated!
      const originalJudge1 = await judgeAssignmentService.getEvaluation(submissionId, 'judge-1');
      const originalJudge2 = await judgeAssignmentService.getEvaluation(submissionId, 'judge-2');

      expect(originalJudge1).not.toBeNull();
      expect(originalJudge1!.scores['crit-tech']).toBe(24); // Original untouched
      expect(originalJudge2).not.toBeNull();
      expect(originalJudge2!.scores['crit-tech']).toBe(10); // Original untouched

      // 5. Check official Scoring Ledger has registered adjustment entries with audit flag
      const ledgerResult = await scoringLedgerService.listEntriesPaginated({ entryId: submissionId });
      const adjustmentEntry = ledgerResult.items.find(
        (e) => e.isAdjustment && e.evaluationId === `adj-${approved.id}`
      );

      expect(adjustmentEntry).toBeDefined();
      expect(adjustmentEntry?.reasonForAdjustment).toContain('Panel consensus reached');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. COMPETITION-WIDE ANALYTICS & INSIGHTS
  // ─────────────────────────────────────────────────────────────────
  describe('4. Competition-Wide Analytics & Privacy Governance', () => {
    it('aggregates criterion-level disagreement rates and ranks judge consistency', async () => {
      const compId = 'comp-analytics-suite';

      // Submission 1: High variance on Tech
      await submitTestEval({
        submissionId: 'sub-comp-1',
        competitionId: compId,
        judgeId: 'judge-x',
        judgeName: 'Judge X',
        judgeEmail: 'x@test.com',
        scores: { 'crit-tech': 25, 'crit-design': 20 },
        deductionNotes: '',
      });
      await submitTestEval({
        submissionId: 'sub-comp-1',
        competitionId: compId,
        judgeId: 'judge-y',
        judgeName: 'Judge Y',
        judgeEmail: 'y@test.com',
        scores: { 'crit-tech': 10, 'crit-design': 20 },
        deductionNotes: '',
      });

      // Submission 2: High consensus
      await submitTestEval({
        submissionId: 'sub-comp-2',
        competitionId: compId,
        judgeId: 'judge-x',
        judgeName: 'Judge X',
        judgeEmail: 'x@test.com',
        scores: { 'crit-tech': 20, 'crit-design': 20 },
        deductionNotes: '',
      });
      await submitTestEval({
        submissionId: 'sub-comp-2',
        competitionId: compId,
        judgeId: 'judge-y',
        judgeName: 'Judge Y',
        judgeEmail: 'y@test.com',
        scores: { 'crit-tech': 20, 'crit-design': 21 },
        deductionNotes: '',
      });

      const analytics = await service.getCompetitionDisagreementAnalytics(compId);

      expect(analytics.totalSubmissionsReviewed).toBe(2);
      expect(analytics.consensusSubmissionsCount).toBe(1);
      expect(analytics.disputedSubmissionsCount).toBe(1);

      // Tech criterion should rank higher in variance than Design
      const techRate = analytics.criterionDisagreementRates.find((c) => c.criterionId === 'crit-tech');
      const designRate = analytics.criterionDisagreementRates.find((c) => c.criterionId === 'crit-design');

      expect(techRate).toBeDefined();
      expect(designRate).toBeDefined();
      expect(techRate!.averageVariance).toBeGreaterThan(designRate!.averageVariance);

      // Judge consistency ranking
      expect(analytics.judgeConsistencyRankings.length).toBeGreaterThanOrEqual(2);
    });

    it('handles unanimous submissions with 0 variance and classifies dispute severity as NONE', async () => {
      const compId = 'comp-unanimous';
      const submissionId = 'sub-perfect-consensus';

      await submitTestEval({
        submissionId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Judge 1',
        judgeEmail: 'j1@test.com',
        scores: { 'crit-tech': 22, 'crit-design': 20 },
        totalScore: 42,
        deductionNotes: '',
      });

      await submitTestEval({
        submissionId,
        competitionId: compId,
        judgeId: 'judge-2',
        judgeName: 'Judge 2',
        judgeEmail: 'j2@test.com',
        scores: { 'crit-tech': 22, 'crit-design': 20 },
        totalScore: 42,
        deductionNotes: '',
      });

      const analysis = await service.analyzeSubmissionDisagreement(submissionId);
      expect(analysis.overallScoreSpread).toBe(0);
      expect(analysis.overallVariance).toBe(0);
      expect(analysis.isOverallDisputed).toBe(false);
      expect(analysis.disputeSeverity).toBe('NONE');
    });

    it('rejects adjudication resolution when audit rationale is missing', async () => {
      await expect(
        service.saveAdjudicationResolution({
          submissionId: 'sub-missing-rationale',
          competitionId: 'comp-1',
          disputedCriterionIds: ['crit-tech'],
          resolutionType: 'PANEL_CONSENSUS',
          adjustedScores: { 'crit-tech': 20 },
          resolutionRationale: '   ', // Whitespace only
          adjudicatorId: 'admin-1',
          adjudicatorName: 'Admin',
        })
      ).rejects.toThrow('requires a written audit rationale');
    });

    it('rejects calibration exercise creation when title or rubric criteria are missing', async () => {
      await expect(
        service.createCalibrationExercise({
          organizationId: 'org-1',
          competitionId: 'comp-1',
          title: '',
          description: '',
          sampleProject: { title: 'Test', description: '' },
          rubric: [],
          referenceScores: {},
          referenceReasoning: {},
          status: 'ACTIVE',
          createdBy: 'admin-1',
          createdByName: 'Admin',
        })
      ).rejects.toThrow('requires a title, competitionId, and at least one rubric criterion');
    });
  });
});
