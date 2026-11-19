// ─────────────────────────────────────────────
// phase9JudgeEvaluationScoringAndResults.test.ts
// Unit & Integration Tests: Human Judging, Append-Only Scoring Ledger & Official Publication
// Proofly — Phase 09
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { competitionService } from '../competitionService';
import { judgeAssignmentService } from '../judgeAssignmentService';
import { scoringLedgerService } from '../scoringLedgerService';
import { resultsAndAnalyticsService } from '../resultsAndAnalyticsService';
import { governanceAuditService } from '../governanceAuditService';
import { submissionService } from '../submissionService';
import type { Competition, CompetitionPolicies } from '../../types/authAndCompetition';
import type { ProjectSubmission } from '../../types/submission';
import type { AiEvaluationReport } from '../../types/aiEvaluation';
import { InferenceMode } from 'firebase/ai';

describe('Phase 09: Judge Evaluation, Scoring and Official Results', () => {
  const compId = 'comp-phase9-judging';
  const orgId = 'org-phase9';

  const defaultPolicies: CompetitionPolicies = {
    teamSubmissionsEnabled: true,
    individualSubmissionsAllowed: true,
    minTeamMembers: 1,
    maxTeamMembers: 4,
    allowLateSubmissions: false,
    submissionDeadline: new Date(Date.now() + 86400000).toISOString(),
    lateSubmissionDeadline: new Date(Date.now() + 172800000).toISOString(),
    allowSubmissionEdits: true,
    maxSubmissions: 50,
    aiEvaluationEnabled: true,
    judgeFeedbackVisibleToParticipants: true,
    aiScoresVisibleToParticipants: true,
    isLeaderboardHidden: false,
  };

  const baseCompetition: Competition = {
    id: compId,
    organizationId: orgId,
    title: 'Autonomous Systems & Edge AI Hackathon',
    slug: 'autonomous-systems-edge-ai',
    tagline: 'Edge AI hardware accelerated inspection and robotics',
    description: 'Build cutting edge autonomous systems with traceable evidence and reproducible code.',
    type: 'HACKATHON',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    participationType: 'BOTH',
    startDate: new Date(Date.now() - 3600000).toISOString(),
    endDate: new Date(Date.now() + 86400000 * 3).toISOString(),
    evaluationDeadline: new Date(Date.now() + 86400000 * 5).toISOString(),
    tracks: ['Robotics', 'Vision AI', 'Open Track'],
    isOpenTrackEnabled: true,
    policies: defaultPolicies,
    rounds: [
      {
        id: 'round-1',
        name: 'AI Preliminary Screening',
        order: 1,
        type: 'AI_PRE_SCREENING',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        status: 'PENDING',
      },
    ],
    rubric: [
      {
        id: 'crit-tech',
        name: 'Technical Execution',
        description: 'Code quality and architecture',
        weight: 60,
        maxScore: 60,
      },
      {
        id: 'crit-impact',
        name: 'Impact & Usability',
        description: 'Real world impact',
        weight: 40,
        maxScore: 40,
      },
    ],
    publicAccessCode: 'PF-PHASE9',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function makeMockSubmission(id: string, refId: string, title: string): ProjectSubmission {
    return {
      id,
      referenceId: refId,
      competitionId: compId,
      organizationId: orgId,
      submissionType: 'TEAM',
      teamName: `Team ${title}`,
      primaryContactName: 'Lead Researcher',
      primaryContactEmail: 'lead@research.org',
      projectTitle: title,
      projectDescription: `Description for ${title} with high-depth technical verification.`,
      problemStatement: 'Problem statement describing edge inference constraints.',
      solution: 'Solution with embedded deployment and validated performance.',
      technologiesUsed: ['PyTorch', 'CUDA', 'ROS2'],
      track: 'Robotics',
      fieldValues: {},
      files: [],
      formSchemaId: 'default-schema',
      participants: [
        {
          id: 'p-1',
          competitionId: compId,
          organizationId: orgId,
          name: 'Lead Researcher',
          email: 'lead@research.org',
          role: 'Lead',
          isLead: true,
          source: 'FORM_SUBMISSION',
          createdAt: new Date().toISOString(),
        },
      ],
      managementTokenHash: 'mock-hash',
      managementTokenPrefix: 'mock-prefix',
      status: 'Ready for Judge Review',
      statusHistory: [],
      isLate: false,
      isLocked: false,
      currentVersion: 1,
      versions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function makeMockAiReport(subId: string, score: number): AiEvaluationReport {
    return {
      id: `ai-rep-${subId}`,
      submissionId: subId,
      referenceId: `REF-${subId}`,
      competitionId: compId,
      rubricVersion: {
        versionNumber: 1,
        competitionId: compId,
        criteria: baseCompetition.rubric.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          weight: r.weight,
          maxScore: r.maxScore,
        })),
        totalMaxScore: 100,
        capturedAt: new Date().toISOString(),
      },
      overallScore: score,
      totalMaxScore: 100,
      percentageScore: score,
      executiveSummary: 'Automated AI Pre-Evaluation dossier',
      strongestAspects: ['Robust ROS2 architecture', 'Well structured CUDA pipeline'],
      areasToImprove: ['Limited physical stress testing benchmarks'],
      evidenceGaps: [],
      evaluationWarnings: [],
      telemetry: {
        requestedMode: InferenceMode.ONLY_IN_CLOUD,
        modelUsed: 'gemini-2.5-flash',
        provider: 'firebase-ai-logic',
        modelIdentifier: 'gemini-2.5-flash',
        sdkVersion: 'firebase-ai-1.0',
        actualExecutionMode: 'IN_CLOUD',
        actualInferenceSource: 'IN_CLOUD',
        latencyMs: 850,
        appCheckStatus: 'ACTIVE_AND_VERIFIED',
        fallbackOccurred: false,
        timestamp: new Date().toISOString(),
      },
      evaluatedAt: new Date().toISOString(),
      isImmutable: true,
      evaluationOutcome: 'AI_COMPLETED',
      criteriaEvaluations: [
        {
          criterionId: 'crit-tech',
          criterionName: 'Technical Execution',
          suggestedScore: Math.round(score * 0.6),
          maxScore: 60,
          weight: 60,
          confidence: 'HIGH',
          positiveObservations: ['Clean modular implementation'],
          evidenceReferences: ['src/main.rs: Main controller loop'],
          weaknesses: [],
          exactDeductionExplanations: [],
          missingEvidence: [],
          limitations: [],
          evidenceClassifications: [],
        },
        {
          criterionId: 'crit-impact',
          criterionName: 'Impact & Usability',
          suggestedScore: Math.round(score * 0.4),
          maxScore: 40,
          weight: 40,
          confidence: 'HIGH',
          positiveObservations: ['Measurable domain application'],
          evidenceReferences: ['README.md: Impact statement'],
          weaknesses: [],
          exactDeductionExplanations: [],
          missingEvidence: [],
          limitations: [],
          evidenceClassifications: [],
        },
      ],
    };
  }

  beforeEach(() => {
    competitionService.resetInMemoryStore([baseCompetition]);
    judgeAssignmentService.resetForTesting();
    scoringLedgerService.resetForTesting();
    resultsAndAnalyticsService.resetForTesting();
    submissionService.resetInMemoryStore();
    governanceAuditService.resetForTesting();
  });

  // ─────────────────────────────────────────────
  // 1. Multiple Judges & Independent Evaluations
  // ─────────────────────────────────────────────

  describe('1. Multiple Judges & Independent Evaluations', () => {
    it('supports multiple judges assigned to the same submission without collisions', async () => {
      const sub = makeMockSubmission('sub-1', 'PF-SUB-001', 'Autonomous Drone Inspector');
      submissionService.resetInMemoryStore([sub]);

      // Assign Judge 1
      const asgn1 = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        assignedBy: 'admin-1',
        assignedByName: 'Lead Organizer',
      });

      // Assign Judge 2 to the same submission
      const asgn2 = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        judgeId: 'judge-2',
        judgeName: 'Prof. Bob Smith',
        assignedBy: 'admin-1',
        assignedByName: 'Lead Organizer',
      });

      expect(asgn1.id).not.toBe(asgn2.id);
      expect(asgn1.judgeId).toBe('judge-1');
      expect(asgn2.judgeId).toBe('judge-2');

      const allAssignments = await judgeAssignmentService.listAssignments({ submissionId: sub.id });
      expect(allAssignments.length).toBe(2);

      // Judge 1 submits 80
      const eval1 = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 48, 'crit-impact': 32 },
        totalScore: 80,
        aiTotalScore: 85,
        criterionDifferences: {},
        deductionNotes: 'Solid execution, slight deduction for missing deployment docs.',
      });

      // Judge 2 submits 90
      const eval2 = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-2',
        judgeName: 'Prof. Bob Smith',
        judgeEmail: 'bob@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 54, 'crit-impact': 36 },
        totalScore: 90,
        aiTotalScore: 85,
        criterionDifferences: {},
        deductionNotes: 'Outstanding algorithmic architecture.',
      });

      expect(eval1.id).not.toBe(eval2.id);
      expect(eval1.totalScore).toBe(80);
      expect(eval2.totalScore).toBe(90);

      // Both evaluations are independently preserved
      const retrieved1 = await judgeAssignmentService.getEvaluation(sub.id, 'judge-1');
      const retrieved2 = await judgeAssignmentService.getEvaluation(sub.id, 'judge-2');
      expect(retrieved1?.totalScore).toBe(80);
      expect(retrieved2?.totalScore).toBe(90);

      // Aggregated score (Mean)
      const policy = resultsAndAnalyticsService.getScoringPolicy(compId);
      const computed = resultsAndAnalyticsService.computeEntryScore(
        {
          submission: sub,
          humanEvaluations: [eval1, eval2],
          aiReport: makeMockAiReport(sub.id, 85),
          rubric: baseCompetition.rubric,
        },
        policy
      );

      expect(computed.officialScore).toBe(85); // (80 + 90) / 2
      expect(computed.judgeBreakdown.length).toBe(2);
    });

    it('maintains independent draft evaluations and isolates drafts across judges', async () => {
      const sub = makeMockSubmission('sub-2', 'PF-SUB-002', 'Edge Robotic Sorter');

      // Judge 1 saves draft with 75
      await judgeAssignmentService.saveEvaluationDraft({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 45, 'crit-impact': 30 },
        totalScore: 75,
        aiTotalScore: 80,
        criterionDifferences: {},
        deductionNotes: 'Alice initial draft notes',
      });

      // Judge 2 saves draft with 95
      await judgeAssignmentService.saveEvaluationDraft({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-2',
        judgeName: 'Prof. Bob Smith',
        judgeEmail: 'bob@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 57, 'crit-impact': 38 },
        totalScore: 95,
        aiTotalScore: 80,
        criterionDifferences: {},
        deductionNotes: 'Bob initial draft notes',
      });

      // Judge 1 requests evaluations: sees only own draft
      const judge1View = await judgeAssignmentService.listEvaluationsForSubmission(
        sub.id,
        'judge-1',
        false
      );
      expect(judge1View.length).toBe(1);
      expect(judge1View[0].judgeId).toBe('judge-1');
      expect(judge1View[0].totalScore).toBe(75);

      // Judge 2 requests evaluations: sees only own draft
      const judge2View = await judgeAssignmentService.listEvaluationsForSubmission(
        sub.id,
        'judge-2',
        false
      );
      expect(judge2View.length).toBe(1);
      expect(judge2View[0].judgeId).toBe('judge-2');
      expect(judge2View[0].totalScore).toBe(95);

      // Organizer requests evaluations: sees both drafts
      const organizerView = await judgeAssignmentService.listEvaluationsForSubmission(
        sub.id,
        undefined,
        true
      );
      expect(organizerView.length).toBe(2);
    });

    it('excludes draft evaluations from official ranking calculations', async () => {
      const sub = makeMockSubmission('sub-3', 'PF-SUB-003', 'Draft Only Project');

      // Only a DRAFT evaluation exists
      const draft = await judgeAssignmentService.saveEvaluationDraft({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 50, 'crit-impact': 35 },
        totalScore: 85,
        aiTotalScore: 80,
        criterionDifferences: {},
        deductionNotes: 'Incomplete review',
      });

      const policy = resultsAndAnalyticsService.getScoringPolicy(compId);
      const computed = resultsAndAnalyticsService.computeEntryScore(
        {
          submission: sub,
          humanEvaluations: [draft], // Status is DRAFT
          aiReport: makeMockAiReport(sub.id, 80),
          rubric: baseCompetition.rubric,
        },
        policy
      );

      // Must NOT be eligible for ranking because no evaluation is SUBMITTED
      expect(computed.eligibleForRanking).toBe(false);
      expect(computed.officialScore).toBe(0);
      expect(computed.judgeBreakdown.length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // 2. Conflict of Interest, Reassignment & Revocation
  // ─────────────────────────────────────────────

  describe('2. Assignment Lifecycle: Conflicts, Reassignments & Revocation', () => {
    it('records conflict of interest declarations and blocks review by the conflicted judge', async () => {
      const sub = makeMockSubmission('sub-4', 'PF-SUB-004', 'Conflict Project');
      const asgn = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        assignedBy: 'admin-1',
        assignedByName: 'Lead Organizer',
      });

      const updated = await judgeAssignmentService.declareConflictOfInterest({
        assignmentId: asgn.id,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        conflictType: 'ADVISOR_STUDENT',
        reason: 'Submitter is a current Master student under my supervision.',
      });

      expect(updated.status).toBe('CONFLICT');
      expect(updated.conflict?.conflictType).toBe('ADVISOR_STUDENT');
      expect(updated.conflict?.reason).toContain('Master student');

      // Attempting to re-assign the same conflicted judge fails
      await expect(
        judgeAssignmentService.assignSubmission({
          competitionId: compId,
          submissionId: sub.id,
          referenceId: sub.referenceId,
          projectTitle: sub.projectTitle,
          judgeId: 'judge-1',
          judgeName: 'Dr. Alice Vance',
          assignedBy: 'admin-1',
          assignedByName: 'Lead Organizer',
        })
      ).rejects.toThrow(/conflict of interest/i);
    });

    it('records full audit history on judge reassignment', async () => {
      const sub = makeMockSubmission('sub-5', 'PF-SUB-005', 'Reassigned Project');

      // Register new judge in service
      await judgeAssignmentService.addJudge({
        id: 'judge-3',
        name: 'Dr. Carol Danvers',
        email: 'carol@aerospace.gov',
        assignedTracks: ['Robotics'],
        competitionIds: [compId],
        maxQuota: 10,
        status: 'ACTIVE',
      });

      const asgn = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        assignedBy: 'admin-1',
        assignedByName: 'Lead Organizer',
      });

      const reassigned = await judgeAssignmentService.reassignSubmission(
        asgn.id,
        'judge-3',
        'admin-1',
        'Lead Organizer',
        'Reallocating workload due to domain specialization requirement.'
      );

      expect(reassigned.judgeId).toBe('judge-3');
      expect(reassigned.judgeName).toBe('Dr. Carol Danvers');
      expect(reassigned.reassignmentHistory.length).toBe(1);
      expect(reassigned.reassignmentHistory[0].previousJudgeId).toBe('judge-1');
      expect(reassigned.reassignmentHistory[0].newJudgeId).toBe('judge-3');
      expect(reassigned.reassignmentHistory[0].reassignedByName).toBe('Lead Organizer');
      expect(reassigned.reassignmentHistory[0].reason).toContain('domain specialization');
    });

    it('allows organizers to revoke assignments with a mandatory audit reason', async () => {
      const sub = makeMockSubmission('sub-6', 'PF-SUB-006', 'Revoked Project');
      const asgn = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        assignedBy: 'admin-1',
        assignedByName: 'Lead Organizer',
      });

      const revoked = await judgeAssignmentService.revokeAssignment(
        asgn.id,
        'admin-1',
        'Lead Organizer',
        'Review window closed for this preliminary track.'
      );

      expect(revoked.status).toBe('REVOKED');

      // Verify that short reasons are rejected
      await expect(
        judgeAssignmentService.revokeAssignment(asgn.id, 'admin-1', 'Lead Organizer', 'No')
      ).rejects.toThrow(/documented reason/i);
    });
  });

  // ─────────────────────────────────────────────
  // 3. AI Recommendation & Explicit Human Decisions
  // ─────────────────────────────────────────────

  describe('3. AI Recommendation & Explicit Human Decisions', () => {
    it('records explicit human decision when accepting AI recommendation without merging records', async () => {
      const sub = makeMockSubmission('sub-7', 'PF-SUB-007', 'AI Accepted Project');
      const aiReport = makeMockAiReport(sub.id, 92);

      // Judge explicitly selects AGREE
      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 55, 'crit-impact': 37 },
        totalScore: 92,
        aiTotalScore: 92,
        criterionDifferences: {},
        deductionNotes: 'Fully agreed with automated AI evaluation recommendations.',
      });

      expect(submitted.decisionMode).toBe('AGREE');
      expect(submitted.source).toBe('HUMAN');
      expect(submitted.totalScore).toBe(92);
      expect(submitted.aiTotalScore).toBe(92);

      // Verify AI report remains separate and untouched
      expect(aiReport.id).toBe(`ai-rep-${sub.id}`);
      expect(aiReport.overallScore).toBe(92);
      expect(submitted.id).not.toBe(aiReport.id);
    });

    it('records explicit rationale when rejecting AI recommendations', async () => {
      const sub = makeMockSubmission('sub-8', 'PF-SUB-008', 'AI Rejected Project');

      // Modifying/Rejecting AI scores requires deduction rationale
      await expect(
        judgeAssignmentService.submitFinalEvaluation({
          submissionId: sub.id,
          referenceId: sub.referenceId,
          competitionId: compId,
          judgeId: 'judge-1',
          judgeName: 'Dr. Alice Vance',
          judgeEmail: 'alice@mit.edu',
          decisionMode: 'REJECT',
          scores: { 'crit-tech': 20, 'crit-impact': 15 },
          totalScore: 35,
          aiTotalScore: 90,
          criterionDifferences: {},
          deductionNotes: '', // Missing justification!
        })
      ).rejects.toThrow(/Deduction rationale.*required/i);

      // With justification:
      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'REJECT',
        scores: { 'crit-tech': 20, 'crit-impact': 15 },
        totalScore: 35,
        aiTotalScore: 90,
        criterionDifferences: {},
        deductionNotes: 'AI hallucinated real hardware deployment; actual repository contains only mock test stubs.',
      });

      expect(submitted.decisionMode).toBe('REJECT');
      expect(submitted.totalScore).toBe(35);
      expect(submitted.scoreDifference).toBe(-55);
      expect(submitted.deductionNotes).toContain('mock test stubs');
    });

    it('records human score modification with criterion-level details', async () => {
      const sub = makeMockSubmission('sub-9', 'PF-SUB-009', 'AI Modified Project');

      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 50, 'crit-impact': 30 },
        totalScore: 80,
        aiTotalScore: 90,
        criterionDifferences: {
          'crit-tech': {
            criterionId: 'crit-tech',
            criterionName: 'Technical Execution',
            maxScore: 60,
            aiScore: 54,
            humanScore: 50,
            diff: -4,
          },
          'crit-impact': {
            criterionId: 'crit-impact',
            criterionName: 'Impact & Usability',
            maxScore: 40,
            aiScore: 36,
            humanScore: 30,
            diff: -6,
          },
        },
        deductionNotes: 'Adjusted down due to lack of comprehensive latency benchmarks.',
      });

      expect(submitted.decisionMode).toBe('MODIFY');
      expect(submitted.totalScore).toBe(80);
      expect(submitted.criterionDifferences['crit-tech'].diff).toBe(-4);
      expect(submitted.criterionDifferences['crit-impact'].diff).toBe(-6);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Immutability, Reopening & Duplicate Prevention
  // ─────────────────────────────────────────────

  describe('4. Evaluation Immutability & Duplicate Prevention', () => {
    it('locks submitted evaluations and prevents duplicate submission or modification', async () => {
      const sub = makeMockSubmission('sub-10', 'PF-SUB-010', 'Locked Project');

      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 55, 'crit-impact': 35 },
        totalScore: 90,
        aiTotalScore: 90,
        criterionDifferences: {},
        deductionNotes: 'Full agreement with AI analysis.',
      });

      // Attempting to re-submit throws error
      await expect(
        judgeAssignmentService.submitFinalEvaluation({
          submissionId: sub.id,
          referenceId: sub.referenceId,
          competitionId: compId,
          judgeId: 'judge-1',
          judgeName: 'Dr. Alice Vance',
          judgeEmail: 'alice@mit.edu',
          decisionMode: 'AGREE',
          scores: { 'crit-tech': 60, 'crit-impact': 40 },
          totalScore: 100,
          aiTotalScore: 90,
          criterionDifferences: {},
          deductionNotes: 'Trying to increase score.',
        })
      ).rejects.toThrow(/already finalized and locked/i);

      // Attempting to save draft over locked evaluation also throws
      await expect(
        judgeAssignmentService.saveEvaluationDraft({
          submissionId: sub.id,
          referenceId: sub.referenceId,
          competitionId: compId,
          judgeId: 'judge-1',
          judgeName: 'Dr. Alice Vance',
          judgeEmail: 'alice@mit.edu',
          decisionMode: 'MODIFY',
          scores: { 'crit-tech': 40, 'crit-impact': 30 },
          totalScore: 70,
          aiTotalScore: 90,
          criterionDifferences: {},
          deductionNotes: 'Trying to modify locked draft.',
        })
      ).rejects.toThrow(/submitted and locked/i);
    });

    it('allows authorized organizers to reopen locked evaluations with logged audit history', async () => {
      const sub = makeMockSubmission('sub-11', 'PF-SUB-011', 'Reopened Project');

      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 50, 'crit-impact': 30 },
        totalScore: 80,
        aiTotalScore: 80,
        criterionDifferences: {},
        deductionNotes: 'Initial agreement.',
      });

      // Reopening requires at least 5 characters
      await expect(
        judgeAssignmentService.reopenEvaluation({
          evaluationId: submitted.id,
          organizerUserId: 'admin-1',
          organizerName: 'Lead Organizer',
          auditReason: 'Fix',
        })
      ).rejects.toThrow(/detailed audit justification/i);

      // Reopen with detailed reason
      const reopened = await judgeAssignmentService.reopenEvaluation({
        evaluationId: submitted.id,
        organizerUserId: 'admin-1',
        organizerName: 'Lead Organizer',
        auditReason: 'Judge requested reopen to review newly uploaded hardware telemetry logs.',
      });

      expect(reopened.isLocked).toBe(false);
      expect(reopened.status).toBe('DRAFT');
      expect(reopened.reopenHistory.length).toBe(1);
      expect(reopened.reopenHistory[0].reopenedByName).toBe('Lead Organizer');
      expect(reopened.reopenHistory[0].auditReason).toContain('hardware telemetry logs');
    });
  });

  // ─────────────────────────────────────────────
  // 5. Append-Only Score Ledger & Authorized Adjustments
  // ─────────────────────────────────────────────

  describe('5. Append-Only Score Ledger & Authorized Adjustments', () => {
    it('records immutable score contributions and stores previousScore on adjustments', async () => {
      // 1. Initial judge contribution
      const initialEntry = scoringLedgerService.appendContribution({
        competitionId: compId,
        entryId: 'sub-ledger-1',
        evaluationId: 'eval-1',
        criterionId: 'crit-tech',
        score: 50,
        maxScore: 60,
        source: 'HUMAN',
        actorId: 'judge-1',
        actorName: 'Dr. Alice Vance',
        reasonForAdjustment: 'Initial judge scoring',
        authorizedSource: 'JUDGE_SUBMISSION',
      });

      expect(initialEntry.score).toBe(50);
      expect(initialEntry.isAdjustment).toBe(false);
      expect(initialEntry.previousScore).toBeUndefined();

      // 2. Organizer applies score adjustment
      const adjustment = await resultsAndAnalyticsService.applyAuthorizedScoreAdjustment({
        competitionId: compId,
        entryId: 'sub-ledger-1',
        evaluationId: 'eval-1',
        criterionId: 'crit-tech',
        newScore: 55,
        maxScore: 60,
        organizerUserId: 'admin-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Correction based on supplementary code review verification.',
      });

      expect(adjustment.score).toBe(55);
      expect(adjustment.previousScore).toBe(50);
      expect(adjustment.isAdjustment).toBe(true);
      expect(adjustment.previousEntryId).toBe(initialEntry.id);

      // 3. Verify prior entry was NOT mutated (append-only ledger)
      const allEntries = scoringLedgerService.listEntries({ entryId: 'sub-ledger-1' });
      expect(allEntries.length).toBe(2);
      expect(allEntries.find((e) => e.id === initialEntry.id)?.score).toBe(50);
      expect(allEntries.find((e) => e.id === adjustment.id)?.score).toBe(55);
    });

    it('rejects direct client modification of official scores', async () => {
      // Direct call without authorizedSource throws
      expect(() =>
        scoringLedgerService.appendContribution({
          competitionId: compId,
          entryId: 'sub-hack-attempt',
          evaluationId: 'eval-hack',
          criterionId: 'crit-tech',
          score: 60,
          maxScore: 60,
          source: 'HUMAN',
          actorId: 'unauthorized-user',
          actorName: 'Attacker',
          reasonForAdjustment: 'Arbitrary score change',
        } as any)
      ).toThrow(/Direct client modification.*is prohibited/i);

      // Calling applyAuthorizedScoreAdjustment with non-organizer role throws
      await expect(
        resultsAndAnalyticsService.applyAuthorizedScoreAdjustment({
          competitionId: compId,
          entryId: 'sub-hack-attempt',
          evaluationId: 'eval-hack',
          criterionId: 'crit-tech',
          newScore: 60,
          maxScore: 60,
          organizerUserId: 'judge-1',
          organizerName: 'Judge Alice',
          actorRole: 'JUDGE',
          reason: 'Trying to adjust score without organizer permission',
        })
      ).rejects.toThrow(/Organizer authorization is required/i);
    });
  });

  // ─────────────────────────────────────────────
  // 6. Configurable Aggregation Policies & Tie-Breakers
  // ─────────────────────────────────────────────

  describe('6. Aggregation Policies (Mean, Median, Trimmed Mean) & Deterministic Tie-Breakers', () => {
    it('computes median score aggregation correctly across an odd and even number of judges', () => {
      const sub = makeMockSubmission('sub-median', 'PF-MED-01', 'Median Test');
      const makeEval = (judgeId: string, score: number) => ({
        id: `eval-${judgeId}`,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId,
        judgeName: `Judge ${judgeId}`,
        judgeEmail: `${judgeId}@test.org`,
        source: 'HUMAN' as const,
        decisionMode: 'MODIFY' as const,
        scores: { 'crit-tech': score * 0.6, 'crit-impact': score * 0.4 },
        totalScore: score,
        aiTotalScore: 80,
        scoreDifference: 0,
        criterionDifferences: {},
        deductionNotes: 'Review',
        status: 'SUBMITTED' as const,
        isLocked: true,
        reopenHistory: [],
        evaluatorVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const medianPolicy = {
        ...resultsAndAnalyticsService.getScoringPolicy(compId),
        policyType: 'MEDIAN' as const,
      };

      // 3 judges: scores 70, 85, 95 -> Median is 85
      const oddResult = resultsAndAnalyticsService.computeEntryScore(
        {
          submission: sub,
          humanEvaluations: [makeEval('j1', 70), makeEval('j2', 85), makeEval('j3', 95)],
          aiReport: null,
          rubric: baseCompetition.rubric,
        },
        medianPolicy
      );
      expect(oddResult.officialScore).toBe(85);

      // 4 judges: scores 70, 80, 90, 100 -> Median is (80 + 90) / 2 = 85
      const evenResult = resultsAndAnalyticsService.computeEntryScore(
        {
          submission: sub,
          humanEvaluations: [makeEval('j1', 70), makeEval('j2', 80), makeEval('j3', 90), makeEval('j4', 100)],
          aiReport: null,
          rubric: baseCompetition.rubric,
        },
        medianPolicy
      );
      expect(evenResult.officialScore).toBe(85);
    });

    it('computes trimmed mean (Olympic scoring: drops lowest and highest) for 3+ judges', () => {
      const sub = makeMockSubmission('sub-trimmed', 'PF-TRIM-01', 'Trimmed Mean Test');
      const makeEval = (judgeId: string, score: number) => ({
        id: `eval-${judgeId}`,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId,
        judgeName: `Judge ${judgeId}`,
        judgeEmail: `${judgeId}@test.org`,
        source: 'HUMAN' as const,
        decisionMode: 'MODIFY' as const,
        scores: { 'crit-tech': score * 0.6, 'crit-impact': score * 0.4 },
        totalScore: score,
        aiTotalScore: 80,
        scoreDifference: 0,
        criterionDifferences: {},
        deductionNotes: 'Review',
        status: 'SUBMITTED' as const,
        isLocked: true,
        reopenHistory: [],
        evaluatorVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const trimmedPolicy = {
        ...resultsAndAnalyticsService.getScoringPolicy(compId),
        policyType: 'TRIMMED_MEAN' as const,
      };

      // 3 judges: 60 (lowest dropped), 80 (kept), 100 (highest dropped) -> Official score: 80
      const result3 = resultsAndAnalyticsService.computeEntryScore(
        {
          submission: sub,
          humanEvaluations: [makeEval('j1', 60), makeEval('j2', 80), makeEval('j3', 100)],
          aiReport: null,
          rubric: baseCompetition.rubric,
        },
        trimmedPolicy
      );
      expect(result3.officialScore).toBe(80);

      // 4 judges: 50 (drop), 70 (keep), 90 (keep), 100 (drop) -> (70 + 90) / 2 = 80
      const result4 = resultsAndAnalyticsService.computeEntryScore(
        {
          submission: sub,
          humanEvaluations: [makeEval('j1', 50), makeEval('j2', 70), makeEval('j3', 90), makeEval('j4', 100)],
          aiReport: null,
          rubric: baseCompetition.rubric,
        },
        trimmedPolicy
      );
      expect(result4.officialScore).toBe(80);
    });

    it('resolves ties deterministically using configured tie-breakers', () => {
      const subA = makeMockSubmission('sub-a', 'PF-TIE-A', 'Project Alpha');
      const subB = makeMockSubmission('sub-b', 'PF-TIE-B', 'Project Beta');

      // Both receive identical total score of 80, but Project Alpha has higher Technical score (48 vs 42)
      const evalA = {
        id: 'eval-a',
        submissionId: subA.id,
        referenceId: subA.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Judge Alice',
        judgeEmail: 'alice@test.org',
        source: 'HUMAN' as const,
        decisionMode: 'MODIFY' as const,
        scores: { 'crit-tech': 48, 'crit-impact': 32 }, // crit-tech is 60% weight
        totalScore: 80,
        aiTotalScore: 80,
        scoreDifference: 0,
        criterionDifferences: {},
        deductionNotes: 'Alpha',
        status: 'SUBMITTED' as const,
        isLocked: true,
        reopenHistory: [],
        evaluatorVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const evalB = {
        id: 'eval-b',
        submissionId: subB.id,
        referenceId: subB.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Judge Alice',
        judgeEmail: 'alice@test.org',
        source: 'HUMAN' as const,
        decisionMode: 'MODIFY' as const,
        scores: { 'crit-tech': 42, 'crit-impact': 38 },
        totalScore: 80,
        aiTotalScore: 80,
        scoreDifference: 0,
        criterionDifferences: {},
        deductionNotes: 'Beta',
        status: 'SUBMITTED' as const,
        isLocked: true,
        reopenHistory: [],
        evaluatorVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const policy = resultsAndAnalyticsService.getScoringPolicy(compId);
      const ranked = resultsAndAnalyticsService.rankEntries({
        inputs: [
          { submission: subB, humanEvaluations: [evalB], aiReport: null, rubric: baseCompetition.rubric },
          { submission: subA, humanEvaluations: [evalA], aiReport: null, rubric: baseCompetition.rubric },
        ],
        policy,
      });

      // Project Alpha should win tie-break (Rank 1) due to highest weighted criterion ('crit-tech')
      expect(ranked[0].submissionId).toBe('sub-a');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[0].isTied).toBe(false);

      expect(ranked[1].submissionId).toBe('sub-b');
      expect(ranked[1].rank).toBe(2);
      expect(ranked[1].tieBrokenBy).toContain('Highest Weighted Criterion Score');
    });

    it('assigns equal ranks and marks isTied: true when tie cannot be broken', () => {
      const subA = makeMockSubmission('sub-true-a', 'PF-TIE-01', 'True Tie Alpha');
      const subB = makeMockSubmission('sub-true-b', 'PF-TIE-02', 'True Tie Beta');

      const makeIdenticalEval = (subId: string) => ({
        id: `eval-${subId}`,
        submissionId: subId,
        referenceId: `PF-REF-${subId}`,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Judge Alice',
        judgeEmail: 'alice@test.org',
        source: 'HUMAN' as const,
        decisionMode: 'AGREE' as const,
        scores: { 'crit-tech': 50, 'crit-impact': 30 },
        totalScore: 80,
        aiTotalScore: 80,
        scoreDifference: 0,
        criterionDifferences: {},
        deductionNotes: 'Same',
        status: 'SUBMITTED' as const,
        isLocked: true,
        reopenHistory: [],
        evaluatorVersion: 1,
        createdAt: '2026-11-19T00:00:00.000Z',
        updatedAt: '2026-11-19T00:00:00.000Z',
      });

      // Disable all tie breakers
      const noTieBreakerPolicy = {
        ...resultsAndAnalyticsService.getScoringPolicy(compId),
        tieBreakers: [],
      };

      const ranked = resultsAndAnalyticsService.rankEntries({
        inputs: [
          { submission: subA, humanEvaluations: [makeIdenticalEval(subA.id)], aiReport: null, rubric: baseCompetition.rubric },
          { submission: subB, humanEvaluations: [makeIdenticalEval(subB.id)], aiReport: null, rubric: baseCompetition.rubric },
        ],
        policy: noTieBreakerPolicy,
      });

      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(1);
      expect(ranked[0].isTied).toBe(true);
      expect(ranked[1].isTied).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 7. Official Results Publication & Public Leaderboard Visibility
  // ─────────────────────────────────────────────

  describe('7. Official Publication & Leaderboard Privacy Controls', () => {
    it('requires explicit organizer approval to publish official results and rejects unauthorized publication', async () => {
      const sub = makeMockSubmission('sub-pub', 'PF-PUB-01', 'Published Project');
      submissionService.resetInMemoryStore([sub]);

      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 54, 'crit-impact': 36 },
        totalScore: 90,
        aiTotalScore: 90,
        criterionDifferences: {},
        deductionNotes: 'Agreed',
      });

      // Before publication, public leaderboard returns null
      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).toBeNull();

      // Non-organizer attempting to publish throws
      await expect(
        resultsAndAnalyticsService.publishOfficialResults({
          competitionId: compId,
          organizerUserId: 'judge-1',
          organizerName: 'Judge Alice',
          actorRole: 'JUDGE',
          approvalReason: 'Unauthorized publish attempt',
        })
      ).rejects.toThrow(/Unauthorized: Only organizers can approve/i);

      // Organizer publishes official results
      const pubRecord = await resultsAndAnalyticsService.publishOfficialResults({
        competitionId: compId,
        organizerUserId: 'admin-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        approvalReason: 'All judge evaluations verified against official rubric.',
      });

      expect(pubRecord.status).toBe('PUBLISHED');
      expect(pubRecord.version).toBe(1);

      // Now public leaderboard is accessible and returns official results
      const publicBoard = resultsAndAnalyticsService.getPublicLeaderboard(compId);
      expect(publicBoard).not.toBeNull();
      expect(publicBoard?.status).toBe('PUBLISHED');
      expect(publicBoard?.entries.length).toBe(1);
      expect(publicBoard?.entries[0].resultState).toBe('OFFICIAL');

      // Unpublishing official results
      const unpublished = await resultsAndAnalyticsService.unpublishOfficialResults({
        competitionId: compId,
        organizerUserId: 'admin-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        reason: 'Temporary unpublish for score audit correction.',
      });

      expect(unpublished.status).toBe('UNPUBLISHED');
      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).toBeNull();
    });

    it('enforces hidden and delayed leaderboard policies', async () => {
      const sub = makeMockSubmission('sub-hidden', 'PF-HID-01', 'Hidden Project');
      submissionService.resetInMemoryStore([sub]);

      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'judge-1',
        judgeName: 'Dr. Alice Vance',
        judgeEmail: 'alice@mit.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 54, 'crit-impact': 36 },
        totalScore: 90,
        aiTotalScore: 90,
        criterionDifferences: {},
        deductionNotes: 'Agreed',
      });

      // Publish results
      await resultsAndAnalyticsService.publishOfficialResults({
        competitionId: compId,
        organizerUserId: 'admin-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        approvalReason: 'Approved',
      });

      // 1. Hide leaderboard via policy
      await competitionService.updateCompetition(compId, {
        policies: {
          ...defaultPolicies,
          isLeaderboardHidden: true,
        },
      });

      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).toBeNull();

      // 2. Delayed leaderboard: publish date in future
      await competitionService.updateCompetition(compId, {
        policies: {
          ...defaultPolicies,
          isLeaderboardHidden: false,
          leaderboardPublishDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        },
      });

      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).toBeNull();

      // 3. Delayed leaderboard: publish date has passed
      await competitionService.updateCompetition(compId, {
        policies: {
          ...defaultPolicies,
          isLeaderboardHidden: false,
          leaderboardPublishDate: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        },
      });

      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).not.toBeNull();
    });
  });
});
