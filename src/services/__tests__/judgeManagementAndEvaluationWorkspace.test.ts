// ─────────────────────────────────────────────
// judgeManagementAndEvaluationWorkspace.test.ts
// Phase 7 Human Judging Workspace Tests: Assignment Scoping, Multi-Judge Coordination,
// Immutability, Conflict of Interest, Reassignment Audit, & Reopening
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { judgeAssignmentService } from '../judgeAssignmentService';
import { submissionService } from '../submissionService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import type { ProjectSubmission } from '../../types/submission';

describe('Phase 7: Human Judging Workspace & Multi-Judge Coordination', () => {
  beforeEach(() => {
    judgeAssignmentService.resetForTesting();
  });

  describe('1. Judge Management & Workload Capacity', () => {
    it('allows organizers to invite and register domain specialist judges', async () => {
      const newJudge = await judgeAssignmentService.inviteJudge({
        name: 'Dr. Sarah Connor',
        email: 's.connor@cyberdyne.org',
        title: 'Lead Robotics Researcher',
        organization: 'Cyberdyne Systems',
        assignedTracks: ['Intelligent Agents', 'Robotics & Edge'],
        competitionIds: ['comp-default-ai'],
        maxQuota: 12,
      });

      expect(newJudge).toBeDefined();
      expect(newJudge.name).toBe('Dr. Sarah Connor');
      expect(newJudge.status).toBe('INVITED');
      expect(newJudge.maxQuota).toBe(12);

      const retrieved = await judgeAssignmentService.getJudge(newJudge.id);
      expect(retrieved?.email).toBe('s.connor@cyberdyne.org');
    });

    it('tracks judge workload metrics and review progress velocity', async () => {
      const workloads = await judgeAssignmentService.getJudgeWorkload('comp-default-ai');
      expect(workloads.length).toBeGreaterThanOrEqual(4);

      const elena = workloads.find((w) => w.judgeId === 'user-judge-01');
      expect(elena).toBeDefined();
      expect(elena?.totalAssigned).toBeGreaterThanOrEqual(2);
      expect(elena?.maxQuota).toBe(10);
      expect(typeof elena?.completionRate).toBe('number');
    });
  });

  describe('2. Assignment Scoping & Permissions', () => {
    it('supports multiple judges assigned to the same submission', async () => {
      const subId = 'sub-nano-cardiopulse';
      const assignments = await judgeAssignmentService.listAssignments({ submissionId: subId });

      // In initial seed assignments, both Dr. Elena Vance and Dr. Maya Patel are assigned to CardioPulse
      const judgeIds = assignments.map((a) => a.judgeId);
      expect(judgeIds).toContain('user-judge-01');
      expect(judgeIds).toContain('judge-maya');
      expect(assignments.length).toBeGreaterThanOrEqual(2);
    });

    it('supports multiple submissions assigned to a single judge', async () => {
      const elenaAssignments = await judgeAssignmentService.listAssignments({ judgeId: 'user-judge-01' });
      expect(elenaAssignments.length).toBeGreaterThanOrEqual(2);

      const subIds = elenaAssignments.map((a) => a.submissionId);
      expect(subIds).toContain('sub-nano-cardiopulse');
      expect(subIds).toContain('sub-quantum-ai');
    });

    it('isolates evaluations: judges see only their own draft scores, never other judges drafts', async () => {
      const subId = 'sub-nano-cardiopulse';

      // Judge Elena saves a draft
      await judgeAssignmentService.saveEvaluationDraft({
        submissionId: subId,
        referenceId: 'PF-SUB-2026-NC892',
        competitionId: 'comp-default-ai',
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 24, 'crit-design': 23 },
        totalScore: 47,
        aiTotalScore: 50,
        criterionDifferences: {},
        deductionNotes: 'Draft review in progress',
      });

      // Judge Maya saves a draft
      await judgeAssignmentService.saveEvaluationDraft({
        submissionId: subId,
        referenceId: 'PF-SUB-2026-NC892',
        competitionId: 'comp-default-ai',
        judgeId: 'judge-maya',
        judgeName: 'Dr. Maya Patel',
        judgeEmail: 'maya.patel@deepmind.academic',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 21, 'crit-design': 20 },
        totalScore: 41,
        aiTotalScore: 50,
        criterionDifferences: {},
        deductionNotes: 'Maya private draft notes',
      });

      // Elena requests evaluations: should see Elena's draft, but NOT Maya's draft!
      const elenaView = await judgeAssignmentService.listEvaluationsForSubmission(subId, 'user-judge-01', false);
      expect(elenaView.some((e) => e.judgeId === 'user-judge-01')).toBe(true);
      expect(elenaView.some((e) => e.judgeId === 'judge-maya')).toBe(false);

      // Organizers request evaluations: sees all drafts
      const organizerView = await judgeAssignmentService.listEvaluationsForSubmission(subId, undefined, true);
      expect(organizerView.length).toBe(2);
    });
  });

  describe('3. Conflict-of-Interest Declaration & Reassignment Audit Trail', () => {
    it('allows a judge to declare conflict of interest and blocks review access', async () => {
      const assignmentId = 'asgn-sub-quantum-elena';

      const updated = await judgeAssignmentService.declareConflictOfInterest({
        assignmentId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        conflictType: 'ADVISOR_STUDENT',
        reason: 'Submitter is a current PhD student in my laboratory at Stanford.',
      });

      expect(updated.status).toBe('CONFLICT');
      expect(updated.conflict).toBeDefined();
      expect(updated.conflict?.conflictType).toBe('ADVISOR_STUDENT');
      expect(updated.conflict?.reason).toContain('PhD student');

      // Verify that getAssignment reflects conflict
      const asgn = await judgeAssignmentService.getAssignment(assignmentId);
      expect(asgn?.status).toBe('CONFLICT');
    });

    it('records full reassignment audit history when transferring submissions', async () => {
      const assignmentId = 'asgn-sub-cardio-maya';

      const reassigned = await judgeAssignmentService.reassignSubmission(
        assignmentId,
        'judge-chen',
        'user-organizer-01',
        'Saikeerthana (Lead Organizer)',
        'Balancing reviewer workload for cardiology domain review.'
      );

      expect(reassigned.judgeId).toBe('judge-chen');
      expect(reassigned.judgeName).toBe('Dr. Wei Chen');
      expect(reassigned.reassignmentHistory.length).toBe(1);

      const audit = reassigned.reassignmentHistory[0];
      expect(audit.previousJudgeId).toBe('judge-maya');
      expect(audit.newJudgeId).toBe('judge-chen');
      expect(audit.reassignedByName).toBe('Saikeerthana (Lead Organizer)');
      expect(audit.reason).toContain('Balancing reviewer workload');
    });
  });

  describe('4. Evaluation Immutability & Organizer Authorization Reopen', () => {
    it('allows saving drafts and submitting final evaluations', async () => {
      const subId = 'sub-eventscout-test';

      // 1. Save draft
      const draft = await judgeAssignmentService.saveEvaluationDraft({
        submissionId: subId,
        referenceId: 'PF-TEST-EV101',
        competitionId: 'comp-default-ai',
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 22, 'crit-design': 23 },
        totalScore: 45,
        aiTotalScore: 48,
        criterionDifferences: {
          'crit-tech': {
            criterionId: 'crit-tech',
            criterionName: 'Technological Implementation',
            maxScore: 25,
            aiScore: 24,
            humanScore: 22,
            diff: -2,
          },
        },
        deductionNotes: 'Deducted 2 pts for unverified backend stress benchmarks.',
      });

      expect(draft.status).toBe('DRAFT');
      expect(draft.isLocked).toBe(false);

      // 2. Submit final evaluation
      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: subId,
        referenceId: 'PF-TEST-EV101',
        competitionId: 'comp-default-ai',
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 22, 'crit-design': 23 },
        totalScore: 45,
        aiTotalScore: 48,
        criterionDifferences: {
          'crit-tech': {
            criterionId: 'crit-tech',
            criterionName: 'Technological Implementation',
            maxScore: 25,
            aiScore: 24,
            humanScore: 22,
            diff: -2,
          },
        },
        deductionNotes: 'Finalized deduction: 2 pts deducted for missing stress telemetry under load.',
      });

      expect(submitted.status).toBe('SUBMITTED');
      expect(submitted.isLocked).toBe(true);
      expect(submitted.submittedAt).toBeDefined();
    });

    it('strictly forbids silent modification of a submitted locked evaluation', async () => {
      const subId = 'sub-immutable-test';

      // Submit final evaluation
      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: subId,
        referenceId: 'PF-SUB-IMMUTABLE',
        competitionId: 'comp-default-ai',
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 25 },
        totalScore: 25,
        aiTotalScore: 25,
        criterionDifferences: {},
        deductionNotes: 'Agreed with AI evaluation.',
      });

      // Attempt to modify draft without reopening should throw
      await expect(
        judgeAssignmentService.saveEvaluationDraft({
          submissionId: subId,
          referenceId: 'PF-SUB-IMMUTABLE',
          competitionId: 'comp-default-ai',
          judgeId: 'user-judge-01',
          judgeName: 'Dr. Elena Vance',
          judgeEmail: 'dr.elena.vance@stanford.edu',
          decisionMode: 'MODIFY',
          scores: { 'crit-tech': 15 },
          totalScore: 15,
          aiTotalScore: 25,
          criterionDifferences: {},
          deductionNotes: 'Attempting unauthorized modification.',
        })
      ).rejects.toThrow(/locked/i);
    });

    it('requires documented organizer authorization to reopen an evaluation', async () => {
      const subId = 'sub-reopen-test';

      const submitted = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: subId,
        referenceId: 'PF-SUB-REOPEN',
        competitionId: 'comp-default-ai',
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 25 },
        totalScore: 25,
        aiTotalScore: 25,
        criterionDifferences: {},
        deductionNotes: 'Agreed with AI.',
      });

      // Fails if audit reason is empty
      await expect(
        judgeAssignmentService.reopenEvaluation({
          evaluationId: submitted.id,
          organizerUserId: 'user-organizer-01',
          organizerName: 'Saikeerthana (Lead Organizer)',
          auditReason: '  ',
        })
      ).rejects.toThrow(/audit justification/i);

      // Succeeds with valid organizer reason
      const reopened = await judgeAssignmentService.reopenEvaluation({
        evaluationId: submitted.id,
        organizerUserId: 'user-organizer-01',
        organizerName: 'Saikeerthana (Lead Organizer)',
        auditReason: 'Participant score dispute review: Submitter provided working repo commit log.',
      });

      expect(reopened.isLocked).toBe(false);
      expect(reopened.status).toBe('DRAFT');
      expect(reopened.reopenHistory.length).toBe(1);
      expect(reopened.reopenHistory[0].auditReason).toContain('score dispute review');

      // Now modification is permitted
      const modified = await judgeAssignmentService.saveEvaluationDraft({
        submissionId: subId,
        referenceId: 'PF-SUB-REOPEN',
        competitionId: 'comp-default-ai',
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 24 },
        totalScore: 24,
        aiTotalScore: 25,
        criterionDifferences: {},
        deductionNotes: 'Updated score following organizer authorized reopening.',
      });

      expect(modified.totalScore).toBe(24);
    });
  });

  describe('5. Separate Storage of AI and Human Evaluations', () => {
    it('never overwrites the AI evaluation report with the human report', async () => {
      // Create a test submission with an AI report
      const testSub: ProjectSubmission = {
        id: 'sub-separate-test',
        referenceId: 'PF-SUB-SEP-01',
        competitionId: 'comp-default-ai',
        organizationId: 'org-default',
        formSchemaId: 'form-default',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Taylor Submitter',
        projectTitle: 'Separation Test Project',
        projectDescription: 'Testing strict separation between AI and Human evaluations.',
        technologiesUsed: ['React', 'TypeScript'],
        fieldValues: {},
        files: [],
        status: 'Ready for Judge Review',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: 'hash',
        managementTokenPrefix: 'sec_ab',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await submissionService.saveSubmission(testSub);

      // Execute automated AI pipeline
      const pipelineResult = await evaluationPipelineService.executePipeline(testSub);
      expect(pipelineResult.success).toBe(true);
      expect(pipelineResult.report).toBeDefined();

      const originalAiScore = pipelineResult.report?.overallScore;
      const originalAiReportId = pipelineResult.report?.id;

      // Now Judge submits a completely different human score
      const humanScore = 80;
      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: testSub.id,
        referenceId: testSub.referenceId,
        competitionId: testSub.competitionId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 20, 'crit-design': 20, 'crit-impact': 20, 'crit-idea': 20 },
        totalScore: humanScore,
        aiTotalScore: originalAiScore || 96,
        criterionDifferences: {},
        deductionNotes: 'Rigorous manual code inspection yielded adjustments.',
      });

      // Verify AI Report is completely UNTOUCHED
      const aiReportAfter = await evaluationPipelineService.getEvaluationReport(originalAiReportId!);
      expect(aiReportAfter).toBeDefined();
      expect(aiReportAfter?.overallScore).toBe(originalAiScore);
      expect(aiReportAfter?.isImmutable).toBe(true);

      // Verify Human Evaluation is stored separately
      const humanEval = await judgeAssignmentService.getEvaluation(testSub.id, 'user-judge-01');
      expect(humanEval).toBeDefined();
      expect(humanEval?.totalScore).toBe(humanScore);
      expect(humanEval?.aiTotalScore).toBe(originalAiScore);
      expect(humanEval?.id).not.toBe(originalAiReportId);
    });

    it('supports flagging concerns on submissions', async () => {
      await judgeAssignmentService.flagConcern({
        submissionId: 'sub-flag-test',
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        category: 'PLAGIARISM',
        explanation: 'Core algorithmic module appears identical to an existing open-source package without citation.',
      });

      const evalRecord = await judgeAssignmentService.getEvaluation('sub-flag-test', 'user-judge-01');
      expect(evalRecord?.flaggedConcern).toBeDefined();
      expect(evalRecord?.flaggedConcern?.flagged).toBe(true);
      expect(evalRecord?.flaggedConcern?.category).toBe('PLAGIARISM');
      expect(evalRecord?.flaggedConcern?.explanation).toContain('without citation');
    });
  });

  describe('6. Senior Architect Critique & Anti-Grade-Inflation Evaluation', () => {
    it('critically evaluates solid hackathon prototypes between 75-82 rather than default 96', async () => {
      const { aiLogicService } = await import('../aiLogicService');
      const rubricVersion = {
        versionNumber: 1,
        competitionId: 'comp-default-ai',
        totalMaxScore: 100,
        capturedAt: new Date().toISOString(),
        criteria: [
          { id: 'crit-tech', name: 'Technological Implementation', description: 'Architecture & code', weight: 25, maxScore: 25 },
          { id: 'crit-design', name: 'Design & User Experience', description: 'Usability & design', weight: 25, maxScore: 25 },
          { id: 'crit-impact', name: 'Potential Impact', description: 'Real-world utility & user value', weight: 25, maxScore: 25 },
          { id: 'crit-idea', name: 'Quality of the Idea', description: 'Novelty & track alignment', weight: 25, maxScore: 25 },
        ],
      };

      const eventScoutPacket = {
        submissionId: 'sub-eventscout-anti-inflation',
        referenceId: 'PF-SUB-EV-INFLATION',
        competitionId: 'comp-default-ai',
        projectTitle: 'EventScout',
        projectDescription:
          'EventScout is a personal AI opportunity scout that continuously discovers events from fragmented sources, understands and ranks them based on the user, and proactively delivers the opportunities they are most likely to care about.',
        problemStatement:
          'Students and engineers miss critical hackathons, meetups, and grant deadlines because announcements are buried across scattered Discord channels, campus boards, and social feeds.',
        solution:
          'A continuous automated ingestion pipeline that parses and deduplicates event postings, scores relevance with vector embeddings, and delivers personalized opportunities directly to the user.',
        technologiesUsed: ['Python', 'MongoDB', 'React', 'FastAPI', 'TailwindCSS'],
        track: 'Open Track',
        githubMetadata: {
          repoUrl: 'https://github.com/SK-Sathyavada-008/eventscout_mobilefirst',
          accessible: true,
          repoName: 'eventscout_mobilefirst',
          readmeContent: 'EventScout Mobile-First Repository. Automated event discovery and ranking engine.',
        },
        deploymentMetadata: {
          url: 'https://eventscout-mobilefirst-git-main-sk-sathyavada.vercel.app/',
          accessible: true,
        },
        documentContents: [],
        evidenceDisclaimers: ['Static code inspection only; no live runtime sandbox.'],
        assembledAt: new Date().toISOString(),
      };

      const evaluation = aiLogicService.generateDeterministicEvidenceEvaluation(eventScoutPacket as any, rubricVersion as any);

      // 1. Total score must be in realistic hackathon range (75-82), avoiding 96/100 grade inflation
      expect(evaluation.overallScore).toBeGreaterThanOrEqual(75);
      expect(evaluation.overallScore).toBeLessThanOrEqual(82);

      // 2. Strict mathematical verification: suggestedScore equals maxScore minus sum of deductions
      for (const crit of evaluation.criteriaEvaluations) {
        const totalDeductions = crit.exactDeductionExplanations.reduce((sum: number, d: string) => {
          const match = d.match(/\(-(\d+)\s*pts?\)/i);
          return sum + (match ? parseInt(match[1], 10) : 0);
        }, 0);
        expect(crit.suggestedScore).toBe(crit.maxScore - totalDeductions);
      }

      // 3. Technical critique verification: concrete architectural improvements cited
      const techCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-tech');
      expect(techCrit.exactDeductionExplanations.some((d: string) => d.includes('rate-limiting resilience'))).toBe(true);
      expect(techCrit.exactDeductionExplanations.some((d: string) => d.includes('automated test suites'))).toBe(true);

      // 4. UX critique verification
      const designCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-design');
      expect(designCrit.exactDeductionExplanations.some((d: string) => d.includes('Google Calendar'))).toBe(true);
    });
  });
});
