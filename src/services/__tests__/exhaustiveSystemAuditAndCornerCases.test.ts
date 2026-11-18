// ─────────────────────────────────────────────
// exhaustiveSystemAuditAndCornerCases.test.ts
// Exhaustive End-to-End System Audit & Corner Case Verification
// Validating Phases 1-7: AI Engine, Critique Calibration, Judge Workspace,
// State Synchronization, Multi-Judge Scoping, and Immutability.
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { competitionService } from '../competitionService';
import { accessManagementService } from '../accessManagementService';
import { submissionService } from '../submissionService';
import { aiLogicService } from '../aiLogicService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { evaluationQueueService } from '../evaluationQueueService';
import { judgeAssignmentService } from '../judgeAssignmentService';
import { rubricEngineService } from '../rubricEngineService';
import type { Competition } from '../../types/authAndCompetition';
import type { ProjectSubmission } from '../../types/submission';
import type { StructuredEvidencePacket, RubricVersion } from '../../types/aiEvaluation';

describe('Exhaustive System Audit & Corner Cases Suite', () => {
  const compId = 'comp-audit-2026';
  const orgId = 'org-audit-lab';

  const auditCompetition: Competition = {
    id: compId,
    organizationId: orgId,
    title: 'Audit Innovation Summit 2026',
    slug: 'audit-innovation-summit-2026',
    tagline: 'Exhaustive verification of end-to-end competition OS',
    description: 'Testing every lifecycle state, judge assignment, conflict, and AI critique calibration.',
    type: 'HACKATHON',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    participationType: 'BOTH',
    startDate: new Date(Date.now() - 3600000).toISOString(),
    endDate: new Date(Date.now() + 86400000 * 7).toISOString(),
    evaluationDeadline: new Date(Date.now() + 86400000 * 14).toISOString(),
    publicAccessCode: 'AUDIT-2026',
    policies: {
      teamSubmissionsEnabled: true,
      minTeamMembers: 1,
      maxTeamMembers: 4,
      individualSubmissionsAllowed: true,
      submissionDeadline: new Date(Date.now() + 86400000 * 3).toISOString(),
      allowLateSubmissions: false,
      allowSubmissionEdits: true,
      aiEvaluationEnabled: true,
      judgeFeedbackVisibleToParticipants: true,
      aiScoresVisibleToParticipants: true,
    },
    rounds: [],
    rubric: [
      { id: 'crit-tech', name: 'Technological Implementation', description: 'Architecture & code', maxScore: 25, weight: 25 },
      { id: 'crit-design', name: 'Design & User Experience', description: 'Usability & design', maxScore: 25, weight: 25 },
      { id: 'crit-impact', name: 'Potential Impact', description: 'Real-world utility & user value', maxScore: 25, weight: 25 },
      { id: 'crit-idea', name: 'Quality of the Idea', description: 'Novelty & track alignment', maxScore: 25, weight: 25 },
    ],
    tracks: ['Healthcare & Edge AI', 'Event Tech & Community Discovery', 'FinTech & Web3'],
    isOpenTrackEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    competitionService.resetInMemoryStore([auditCompetition]);
    accessManagementService.resetInMemoryStore();
    submissionService.clearMemoryStore();
    rubricEngineService.clearMemoryStore();
    evaluationQueueService.clearMemoryStore();
    evaluationPipelineService.clearMemoryStore();
    judgeAssignmentService.resetForTesting();
  });

  // ─────────────────────────────────────────────
  // 1. Full Submission Lifecycle & State Synchronization
  // ─────────────────────────────────────────────
  describe('1. Full Submission Lifecycle & State Synchronization', () => {
    it('synchronizes submission lifecycle states through AI evaluation, draft saving, final submission, reopening, and resubmission', async () => {
      // Step 1: Create submission in Ready for Judge Review
      const sub: ProjectSubmission = {
        id: 'sub-audit-lifecycle',
        referenceId: 'PF-AUDIT-LC01',
        competitionId: compId,
        organizationId: orgId,
        formSchemaId: 'schema-audit',
        submissionType: 'INDIVIDUAL',
        participants: [
          {
            id: 'p-1',
            name: 'Alex Audit',
            email: 'alex@audit.io',
            role: 'Developer',
            isLead: true,
            source: 'FORM_SUBMISSION',
            competitionId: compId,
            organizationId: orgId,
            createdAt: new Date().toISOString(),
          },
        ],
        primaryContactName: 'Alex Audit',
        primaryContactEmail: 'alex@audit.io',
        projectTitle: 'AuditLens: Automated Compliance Inspector',
        projectDescription: 'Automated continuous compliance and vulnerability sentinel for multi-cloud deployments.',
        problemStatement: 'Security compliance audits take weeks of manual log extraction.',
        solution: 'An automated agent that parses cluster telemetry and outputs SOC2/HIPAA audit reports.',
        technologiesUsed: ['Go', 'TypeScript', 'Docker', 'PostgreSQL'],
        fieldValues: {},
        files: [],
        status: 'Ready for Judge Review',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: 'hash-lc01',
        managementTokenPrefix: 'sec_lc01',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await submissionService.saveSubmission(sub);

      // Step 2: Assign Judge Elena
      const assignment = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        judgeId: 'user-judge-01',
        assignedBy: 'user-org-01',
        assignedByName: 'Lead Organizer',
      });
      expect(assignment.status).toBe('PENDING');

      // Step 3: Judge saves draft -> submission moves to 'Under Human Review', assignment to 'IN_PROGRESS'
      const draft = await judgeAssignmentService.saveEvaluationDraft({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 20, 'crit-design': 21, 'crit-impact': 20, 'crit-idea': 21 },
        totalScore: 82,
        aiTotalScore: 80,
        criterionDifferences: {},
        deductionNotes: 'Initial draft assessment of code architecture.',
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.isLocked).toBe(false);

      const asgnAfterDraft = await judgeAssignmentService.getAssignment(assignment.id);
      expect(asgnAfterDraft?.status).toBe('IN_PROGRESS');

      const subAfterDraft = await submissionService.getSubmission(sub.id);
      expect(subAfterDraft?.status).toBe('Under Human Review');

      // Step 4: Judge submits final evaluation -> submission moves to 'Evaluated', assignment to 'COMPLETED', evaluation is locked
      const finalEval = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 21, 'crit-design': 21, 'crit-impact': 20, 'crit-idea': 21 },
        totalScore: 83,
        aiTotalScore: 80,
        criterionDifferences: {},
        deductionNotes: 'Finalized evaluation: Solid architecture with well-structured Go codebase.',
      });
      expect(finalEval.status).toBe('SUBMITTED');
      expect(finalEval.isLocked).toBe(true);

      const asgnAfterFinal = await judgeAssignmentService.getAssignment(assignment.id);
      expect(asgnAfterFinal?.status).toBe('COMPLETED');

      const subAfterFinal = await submissionService.getSubmission(sub.id);
      expect(subAfterFinal?.status).toBe('Evaluated');

      // Step 5: Silent modification of locked evaluation must throw
      await expect(
        judgeAssignmentService.saveEvaluationDraft({
          submissionId: sub.id,
          referenceId: sub.referenceId,
          competitionId: compId,
          judgeId: 'user-judge-01',
          judgeName: 'Dr. Elena Vance',
          judgeEmail: 'dr.elena.vance@stanford.edu',
          decisionMode: 'MODIFY',
          scores: { 'crit-tech': 25 },
          totalScore: 100,
          aiTotalScore: 80,
          criterionDifferences: {},
          deductionNotes: 'Unauthorized change',
        })
      ).rejects.toThrow(/locked/i);

      // Step 6: Organizer reopens evaluation with audit reason
      const reopened = await judgeAssignmentService.reopenEvaluation({
        evaluationId: finalEval.id,
        organizerUserId: 'user-org-01',
        organizerName: 'Lead Organizer',
        auditReason: 'Participant submitted live demonstration log validating Go telemetry pipeline.',
      });
      expect(reopened.isLocked).toBe(false);
      expect(reopened.status).toBe('DRAFT');
      expect(reopened.reopenHistory.length).toBe(1);
      expect(reopened.reopenHistory[0].auditReason).toContain('live demonstration log');

      // Verify assignment and submission status reverted to review in progress
      const asgnAfterReopen = await judgeAssignmentService.getAssignment(assignment.id);
      expect(asgnAfterReopen?.status).toBe('IN_PROGRESS');

      const subAfterReopen = await submissionService.getSubmission(sub.id);
      expect(subAfterReopen?.status).toBe('Under Human Review');

      // Step 7: Judge modifies and resubmits
      const resubmitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: compId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 23, 'crit-design': 21, 'crit-impact': 20, 'crit-idea': 21 },
        totalScore: 85,
        aiTotalScore: 80,
        criterionDifferences: {},
        deductionNotes: 'Updated score to 85 after inspecting verified telemetry logs.',
      });
      expect(resubmitted.isLocked).toBe(true);
      expect(resubmitted.totalScore).toBe(85);
      expect(resubmitted.evaluatorVersion).toBeGreaterThan(1);
      expect(resubmitted.reopenHistory.length).toBe(1);

      const subAfterResubmit = await submissionService.getSubmission(sub.id);
      expect(subAfterResubmit?.status).toBe('Evaluated');
    });

    it('supports direct final evaluation submission from Ready for Judge Review without saving draft', async () => {
      const subDirect: ProjectSubmission = {
        id: 'sub-audit-direct',
        referenceId: 'PF-AUDIT-DIR01',
        competitionId: compId,
        organizationId: orgId,
        formSchemaId: 'schema-audit',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Direct Reviewer Submitter',
        projectTitle: 'Direct Pipeline Tool',
        projectDescription: 'Testing direct submission transition.',
        technologiesUsed: ['Python'],
        fieldValues: {},
        files: [],
        status: 'Ready for Judge Review',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: 'hash-dir',
        managementTokenPrefix: 'sec_dir',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await submissionService.saveSubmission(subDirect);

      // Direct final evaluation
      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: subDirect.id,
        referenceId: subDirect.referenceId,
        competitionId: compId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 22, 'crit-design': 22, 'crit-impact': 22, 'crit-idea': 22 },
        totalScore: 88,
        aiTotalScore: 88,
        criterionDifferences: {},
        deductionNotes: 'Agreed with automated evaluation on all criteria.',
      });

      expect(submitted.isLocked).toBe(true);
      expect(submitted.status).toBe('SUBMITTED');

      const updatedSub = await submissionService.getSubmission(subDirect.id);
      expect(updatedSub?.status).toBe('Evaluated');
    });
  });

  // ─────────────────────────────────────────────
  // 2. Conflict of Interest, Reassignment & Scoped Privacy
  // ─────────────────────────────────────────────
  describe('2. Conflict of Interest, Reassignment & Scoped Privacy', () => {
    it('manages conflict recusal, transparent reassignment audit trail, and multi-judge privacy', async () => {
      const subId = 'sub-conflict-audit';

      // 1. Create assignments for Judge Maya and Judge Elena
      const asgnMaya = await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: subId,
        referenceId: 'PF-CONF-01',
        judgeId: 'judge-maya',
        assignedBy: 'user-org-01',
        assignedByName: 'Organizer',
      });

      await judgeAssignmentService.assignSubmission({
        competitionId: compId,
        submissionId: subId,
        referenceId: 'PF-CONF-01',
        judgeId: 'user-judge-01',
        assignedBy: 'user-org-01',
        assignedByName: 'Organizer',
      });

      // 2. Judge Maya declares conflict of interest
      const conflictResult = await judgeAssignmentService.declareConflictOfInterest({
        assignmentId: asgnMaya.id,
        judgeId: 'judge-maya',
        judgeName: 'Dr. Maya Patel',
        conflictType: 'DIRECT_COLLABORATOR',
        reason: 'Co-authored a paper on edge inference with the primary submitter in 2025.',
      });
      expect(conflictResult.status).toBe('CONFLICT');
      expect(conflictResult.conflict?.conflictType).toBe('DIRECT_COLLABORATOR');

      // 3. Organizer reassigns to Judge Chen
      const reassigned = await judgeAssignmentService.reassignSubmission(
        asgnMaya.id,
        'judge-chen',
        'user-org-01',
        'Lead Organizer',
        'Replacing recused judge due to academic co-authorship conflict of interest.'
      );
      expect(reassigned.judgeId).toBe('judge-chen');
      expect(reassigned.status).toBe('PENDING');
      expect(reassigned.conflict).toBeUndefined();
      expect(reassigned.reassignmentHistory.length).toBe(1);
      expect(reassigned.reassignmentHistory[0].previousJudgeName).toBe('Dr. Maya Patel');
      expect(reassigned.reassignmentHistory[0].newJudgeName).toBe('Dr. Wei Chen');
      expect(reassigned.reassignmentHistory[0].reason).toContain('academic co-authorship');

      // 4. Judge Elena saves a draft
      await judgeAssignmentService.saveEvaluationDraft({
        submissionId: subId,
        referenceId: 'PF-CONF-01',
        competitionId: compId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 21 },
        totalScore: 21,
        aiTotalScore: 25,
        criterionDifferences: {},
        deductionNotes: 'Elena private notes',
      });

      // Judge Chen should NOT see Elena's draft
      const chenView = await judgeAssignmentService.listEvaluationsForSubmission(subId, 'judge-chen', false);
      expect(chenView.length).toBe(0);

      // Elena should see her draft
      const elenaView = await judgeAssignmentService.listEvaluationsForSubmission(subId, 'user-judge-01', false);
      expect(elenaView.length).toBe(1);
      expect(elenaView[0].deductionNotes).toBe('Elena private notes');
    });
  });

  // ─────────────────────────────────────────────
  // 3. Extreme Boundary Cases for AI Pre-Evaluation
  // ─────────────────────────────────────────────
  describe('3. Extreme Boundary Cases for AI Pre-Evaluation', () => {
    it('safely evaluates an extreme minimal submission (0 files, 0 links, blank problem/solution) with heavy deductions and zero crashes', () => {
      const minimalPacket: StructuredEvidencePacket = {
        submissionId: 'sub-minimal-extreme',
        referenceId: 'PF-MIN-001',
        competitionId: compId,
        projectTitle: 'Blank App',
        projectDescription: 'Just a simple test',
        problemStatement: '',
        solution: '',
        technologiesUsed: [],
        track: 'Open Track',
        documentContents: [],
        evidenceDisclaimers: ['No repository or files provided.'],
        assembledAt: new Date().toISOString(),
      };

      const rubricVersion: RubricVersion = {
        versionNumber: 1,
        competitionId: compId,
        totalMaxScore: 100,
        capturedAt: new Date().toISOString(),
        criteria: [
          { id: 'crit-tech', name: 'Technological Implementation', description: 'Tech', weight: 25, maxScore: 25 },
          { id: 'crit-design', name: 'Design & User Experience', description: 'Design', weight: 25, maxScore: 25 },
          { id: 'crit-impact', name: 'Potential Impact', description: 'Impact', weight: 25, maxScore: 25 },
          { id: 'crit-idea', name: 'Quality of the Idea', description: 'Idea', weight: 25, maxScore: 25 },
        ],
      };

      const evaluation = aiLogicService.generateDeterministicEvidenceEvaluation(minimalPacket, rubricVersion);

      // Verify it did not crash and scores realistically low (< 50)
      expect(evaluation.overallScore).toBeLessThanOrEqual(45);
      expect(evaluation.overallScore).toBeGreaterThanOrEqual(10);
      expect(Number.isNaN(evaluation.overallScore)).toBe(false);

      // Verify all criteria contain major deductions
      for (const crit of evaluation.criteriaEvaluations) {
        expect(crit.exactDeductionExplanations.length).toBeGreaterThan(0);
        expect(crit.suggestedScore).toBeLessThan(15);
      }

      // Check tech has missing repo and solution deductions
      const techCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-tech');
      expect(techCrit.exactDeductionExplanations.some((d: string) => d.includes('Source Code Deduction') || d.includes('Technical Deduction'))).toBe(true);
    });

    it('correctly handles non-100 rubric totals (e.g. 45 points max) and computes accurate percentages', () => {
      const packet: StructuredEvidencePacket = {
        submissionId: 'sub-custom-rubric',
        referenceId: 'PF-RUBRIC-45',
        competitionId: compId,
        projectTitle: 'Micro Sentinel',
        projectDescription: 'A micro-utility monitoring memory leaks in node processes.',
        problemStatement: 'Node servers crash due to unmonitored heap expansion.',
        solution: 'Lightweight V8 heap profiling sidecar that posts alerts to Slack.',
        technologiesUsed: ['Node.js', 'TypeScript'],
        track: 'Open Track',
        githubMetadata: {
          repoUrl: 'https://github.com/micro/sentinel',
          accessible: true,
          repoName: 'sentinel',
          readmeContent: 'V8 heap profiling tool.',
        },
        documentContents: [],
        evidenceDisclaimers: [],
        assembledAt: new Date().toISOString(),
      };

      // Rubric totals 15 + 15 + 15 = 45 points
      const customRubric: RubricVersion = {
        versionNumber: 1,
        competitionId: compId,
        totalMaxScore: 45,
        capturedAt: new Date().toISOString(),
        criteria: [
          { id: 'crit-code', name: 'Code Quality', description: 'Clean architecture', weight: 33, maxScore: 15 },
          { id: 'crit-ui', name: 'Dashboard UX', description: 'Alerting UI', weight: 33, maxScore: 15 },
          { id: 'crit-val', name: 'Operational Value', description: 'Downtime saved', weight: 34, maxScore: 15 },
        ],
      };

      const evaluation = aiLogicService.generateDeterministicEvidenceEvaluation(packet, customRubric);

      expect(evaluation.overallScore).toBeLessThanOrEqual(45);
      expect(evaluation.overallScore).toBeGreaterThanOrEqual(20);

      for (const crit of evaluation.criteriaEvaluations) {
        expect(crit.suggestedScore).toBeLessThanOrEqual(crit.maxScore);
        expect(crit.suggestedScore).toBeGreaterThanOrEqual(1);
      }

      // Check percentage calculation
      const expectedPercentage = Math.round((evaluation.overallScore / 45) * 100);
      expect(expectedPercentage).toBeGreaterThanOrEqual(50);
      expect(expectedPercentage).toBeLessThanOrEqual(95);
    });

    it('handles track casing and whitespace variations seamlessly', () => {
      const packetLeadingSpaces: StructuredEvidencePacket = {
        submissionId: 'sub-track-spaces',
        referenceId: 'PF-TRK-01',
        competitionId: compId,
        projectTitle: 'CardioBeat',
        projectDescription: 'Arrhythmia classification using ECG sensors and mobile neural networks.',
        problemStatement: 'Heart conditions go undetected outside hospitals.',
        solution: 'Continuous ECG waveform anomaly detection on mobile.',
        technologiesUsed: ['TensorFlow Lite', 'Kotlin'],
        track: '   healthcare & edge ai   ',
        documentContents: [],
        evidenceDisclaimers: [],
        assembledAt: new Date().toISOString(),
      };

      const domain = aiLogicService.detectProjectDomain(packetLeadingSpaces);
      expect(domain.domainName).toContain('Healthcare');

      const relevance = aiLogicService.checkTrackRelevance(packetLeadingSpaces.track, domain, packetLeadingSpaces);
      expect(relevance.isAligned).toBe(true);
      expect(relevance.penaltyApplied).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Batch & Multi-Select AI Evaluation
  // ─────────────────────────────────────────────
  describe('4. Batch & Multi-Select AI Evaluation', () => {
    it('executes batch evaluations across multiple submissions concurrently with 100% success rate', async () => {
      const submissions: ProjectSubmission[] = [
        {
          id: 'sub-batch-1',
          referenceId: 'PF-B1',
          competitionId: compId,
          organizationId: orgId,
          formSchemaId: 's1',
          submissionType: 'INDIVIDUAL',
          participants: [],
          primaryContactName: 'User One',
          projectTitle: 'Project Alpha',
          projectDescription: 'Alpha test description for event tech.',
          technologiesUsed: ['React'],
          fieldValues: {},
          files: [],
          status: 'Queued for AI Evaluation',
          statusHistory: [],
          isLate: false,
          isLocked: false,
          currentVersion: 1,
          versions: [],
          managementTokenHash: 'h1',
          managementTokenPrefix: 'p1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'sub-batch-2',
          referenceId: 'PF-B2',
          competitionId: compId,
          organizationId: orgId,
          formSchemaId: 's1',
          submissionType: 'INDIVIDUAL',
          participants: [],
          primaryContactName: 'User Two',
          projectTitle: 'Project Beta',
          projectDescription: 'Beta test description for healthcare ai.',
          technologiesUsed: ['Python'],
          fieldValues: {},
          files: [],
          status: 'Queued for AI Evaluation',
          statusHistory: [],
          isLate: false,
          isLocked: false,
          currentVersion: 1,
          versions: [],
          managementTokenHash: 'h2',
          managementTokenPrefix: 'p2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      for (const s of submissions) {
        await submissionService.saveSubmission(s);
      }

      // Execute evaluations in parallel (simulating multi-select batch evaluation)
      const results = await Promise.all(
        submissions.map((sub) => evaluationPipelineService.executePipeline(sub, auditCompetition))
      );

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[0].report?.submissionId).toBe('sub-batch-1');
      expect(results[1].report?.submissionId).toBe('sub-batch-2');

      // Check that both submissions transitioned to 'Ready for Judge Review'
      const sub1 = await submissionService.getSubmission('sub-batch-1');
      const sub2 = await submissionService.getSubmission('sub-batch-2');
      expect(sub1?.status).toBe('Ready for Judge Review');
      expect(sub2?.status).toBe('Ready for Judge Review');
    });
  });
});
