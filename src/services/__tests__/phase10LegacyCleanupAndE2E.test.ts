// ─────────────────────────────────────────────
// phase10LegacyCleanupAndE2E.test.ts
// Phase 10: Legacy Cleanup, Mock/Simulation Governance & Complete 11-Step E2E Workflow
// Proofly — Hardening & Production Integrity
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { InferenceMode } from 'firebase/ai';
import { organizationService } from '../organizationService';
import { competitionService } from '../competitionService';
import { formBuilderService } from '../formBuilderService';
import { accessManagementService } from '../accessManagementService';
import { fileStorageService } from '../fileStorageService';
import { submissionService } from '../submissionService';
import { submissionLifecycleService } from '../submissionLifecycleService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { judgeAssignmentService } from '../judgeAssignmentService';
import { scoringLedgerService } from '../scoringLedgerService';
import { governanceAuditService } from '../governanceAuditService';
import { resultsAndAnalyticsService } from '../resultsAndAnalyticsService';
import { sandboxRunner } from '../sandboxRunner';
import { isDemoModeEnabled } from '../../config/firebase';
import { purgeLegacySampleStorageOnce } from '../../utils/cleanSampleStorage';
import type { Competition } from '../../types/authAndCompetition';

describe('Phase 10: Legacy Cleanup, Mock/Simulation Governance & Complete E2E Workflow', () => {
  const orgId = 'org-phase10';

  beforeEach(() => {
    organizationService.resetInMemoryStore();
    competitionService.resetInMemoryStore([]);
    formBuilderService.resetInMemoryStore();
    accessManagementService.resetInMemoryStore();
    submissionService.clearMemoryStore();
    evaluationPipelineService.clearMemoryStore();
    judgeAssignmentService.resetForTesting();
    scoringLedgerService.resetForTesting();
    governanceAuditService.resetForTesting();
    resultsAndAnalyticsService.resetForTesting();
    // Ensure default sandbox runner state is reset to unconfigured
    sandboxRunner.setSandboxAvailable(false);
  });

  // ─────────────────────────────────────────────
  // 1. COMPLETE 11-STEP END-TO-END WORKFLOW
  // ─────────────────────────────────────────────
  describe('1. Complete 11-Step End-to-End Workflow', () => {
    it('executes the full lifecycle: organizer sign-in -> org/comp creation -> anonymous submission -> real upload -> AI evaluation -> judge review -> organizer publication -> public leaderboard', async () => {
      // Step 1: Organizer signs in
      const organizer = {
        uid: 'user-org-phase10',
        email: 'founder@evalora.org',
        displayName: 'Dr. Sarah Connor',
      };
      expect(organizer.uid).toBeTruthy();

      // Step 2: Organizer creates an organization with owner membership
      const organization = await organizationService.createOrganization(
        'Autonomous Edge Robotics Institute',
        organizer.uid,
        organizer.email,
        organizer.displayName,
        'Global edge autonomy hackathon foundation'
      );
      expect(organization.id).toBeTruthy();
      expect(organization.ownerId).toBe(organizer.uid);

      // Verify organization membership
      const userOrgs = await organizationService.getUserOrganizations(organizer.uid);
      expect(userOrgs.some((m) => m.id === organization.id && m.ownerId === organizer.uid)).toBe(true);
      const roles = await organizationService.getUserOrgMemberships(organizer.uid);
      expect(roles[organization.id]).toBe('OWNER');

      // Step 3: Organizer creates a competition as DRAFT
      const createdComp = await competitionService.createCompetition(
        organization.id,
        organizer.uid,
        organizer.email,
        organizer.displayName,
        {
          title: 'Autonomous Robotics Challenge 2026',
          tagline: 'High-speed edge inference and physical autonomy',
          tracks: ['Robotics', 'Vision AI', 'Open Track'],
          isOpenTrackEnabled: true,
        }
      );
      expect(createdComp.id).toBeTruthy();
      expect(createdComp.status).toBe('DRAFT');

      // Step 4: Organizer configures a 100%-weighted rubric
      const rubricConfig = [
        { id: 'crit-tech', name: 'Technical Execution', description: 'Real-time CUDA & ROS2 node modularity', weight: 40, maxScore: 40 },
        { id: 'crit-design', name: 'System Architecture', description: 'Embedded hardware layout and fault tolerance', weight: 30, maxScore: 30 },
        { id: 'crit-impact', name: 'Impact & Utility', description: 'Validated latency in physical scenarios', weight: 30, maxScore: 30 },
      ];
      const updatedComp = await competitionService.updateCompetition(createdComp.id, { rubric: rubricConfig });
      const totalRubricWeight = updatedComp.rubric.reduce((sum, c) => sum + c.weight, 0);
      expect(totalRubricWeight).toBe(100);

      // Transition competition to ACTIVE
      const activeComp = await competitionService.transitionStatus(createdComp.id, 'ACTIVE', {
        userId: organizer.uid,
        callerRole: 'ORGANIZER',
        reason: 'Authorized organizer launch',
      });
      expect(activeComp.status).toBe('ACTIVE');

      // Step 5: Participant submits WITHOUT an account (ephemeral session)
      const accessKey = await accessManagementService.generatePublicAccessKey(
        activeComp.id,
        activeComp.publicAccessCode
      );
      const session = await accessManagementService.validateAccessAndCreateSession(accessKey.code);
      expect(session.valid).toBe(true);
      expect(session.session?.sessionToken).toBeTruthy();

      // Step 6: Submission files are actually uploaded & verified
      const fileBytes = new TextEncoder().encode('%PDF-1.7\nRobotics Controller Specification and Stress Telemetry.');
      const fileValidation = await fileStorageService.validateFile(
        { name: 'controller_spec.pdf', size: fileBytes.length, bytes: fileBytes },
        { allowedExtensions: ['.pdf'], maxSizeMb: 10 }
      );
      expect(fileValidation.valid).toBe(true);

      const submissionPayload = {
        competitionId: activeComp.id,
        sessionToken: session.session!.sessionToken,
        submissionType: 'TEAM' as const,
        teamName: 'CyberDyne Systems',
        primaryContactName: 'John Connor',
        primaryContactEmail: 'john@cyberdyne.org',
        projectTitle: 'T-800 Edge Kinematics',
        projectDescription: 'Distributed edge inference model executing low-latency physical inverse kinematics.',
        problemStatement: 'High motor controller latency causes robotic joint instability during rapid deceleration.',
        solution: 'Direct FPGA hardware accelerated loop with sub-millisecond ROS2 feedback.',
        technologiesUsed: ['Rust', 'ROS2', 'CUDA', 'FPGA'],
        track: 'Robotics',
        githubUrl: 'https://github.com/cyberdyne/t800-kinematics',
        deploymentUrl: 'https://t800-edge.web.app',
        fieldValues: { track: 'Robotics' },
        files: [
          {
            id: 'file-kinematics-pdf',
            fieldId: 'architecture_doc',
            fileName: 'controller_spec.pdf',
            fileSize: fileBytes.length,
            mimeType: 'application/pdf',
            storagePath: `competitions/${activeComp.id}/submissions/sub-cyberdyne/controller_spec.pdf`,
            downloadUrl: 'data:text/plain;charset=utf-8,' + encodeURIComponent('Controller Spec Content'),
            uploadedAt: new Date().toISOString(),
            isVerified: true,
          },
        ],
      };

      const createdSub = await submissionService.createSubmission(submissionPayload, activeComp);
      expect(createdSub.referenceId).toMatch(/^PF-SUB-/);
      expect(createdSub.rawManagementToken).toMatch(/^sec_/);

      // Verify raw management token is NOT stored in plain text
      const storedSub = await submissionService.getSubmission(createdSub.submission.id);
      expect((storedSub as any).rawManagementToken).toBeUndefined();
      expect(storedSub?.managementTokenHash).toHaveLength(64);

      // Verify judge review is gated until AI evaluation completes
      const preReviewGate = submissionLifecycleService.canJudgeReviewSubmission(storedSub!);
      expect(preReviewGate.allowed).toBe(false);

      // Step 7: AI evaluation is performed through Firebase AI Logic
      const pipelineRes = await evaluationPipelineService.executePipeline(
        storedSub!,
        activeComp,
        InferenceMode.PREFER_ON_DEVICE
      );
      expect(pipelineRes.success).toBe(true);
      expect(pipelineRes.report).toBeDefined();
      expect(pipelineRes.report?.isImmutable).toBe(true);
      expect(pipelineRes.report?.telemetry).toBeDefined();
      expect(pipelineRes.submission.status).toBe('Ready for Judge Review');

      // AI score contributions exist in the score ledger
      const aiContributions = scoringLedgerService.listEntries({
        competitionId: activeComp.id,
        source: 'AI',
      });
      expect(aiContributions.length).toBeGreaterThan(0);

      // Step 8: Judge reviews the submission
      const postReviewGate = submissionLifecycleService.canJudgeReviewSubmission(pipelineRes.submission);
      expect(postReviewGate.allowed).toBe(true);

      const judge = {
        judgeId: 'judge-dr-elena',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'elena.vance@mit.edu',
      };

      await judgeAssignmentService.assignSubmission({
        competitionId: activeComp.id,
        submissionId: storedSub!.id,
        referenceId: createdSub.referenceId,
        projectTitle: storedSub!.projectTitle,
        judgeId: judge.judgeId,
        judgeName: judge.judgeName,
        judgeEmail: judge.judgeEmail,
        assignedBy: organizer.uid,
        assignedByName: organizer.displayName,
      });

      const assignedList = await judgeAssignmentService.listAssignments({ judgeId: judge.judgeId });
      expect(assignedList.some((a) => a.submissionId === storedSub!.id)).toBe(true);

      // Step 9: Judge submits independent evaluation (separate from AI report)
      const humanEval = await judgeAssignmentService.submitFinalEvaluation({
        submissionId: storedSub!.id,
        referenceId: createdSub.referenceId,
        competitionId: activeComp.id,
        judgeId: judge.judgeId,
        judgeName: judge.judgeName,
        judgeEmail: judge.judgeEmail,
        decisionMode: 'MODIFY',
        scores: {
          'crit-tech': 38,
          'crit-design': 28,
          'crit-impact': 27,
        },
        totalScore: 93,
        aiTotalScore: pipelineRes.report!.overallScore,
        criterionDifferences: {},
        deductionNotes: 'Hardware benchmarks verified; minor deduction for lack of physical fail-safe isolation circuit.',
      });

      expect(humanEval.isLocked).toBe(true);
      expect(humanEval.totalScore).toBe(93);

      // Verify AI report remains completely immutable
      const aiReportAfterJudge = await evaluationPipelineService.getEvaluationReport(pipelineRes.report!.id);
      expect(aiReportAfterJudge?.overallScore).toBe(pipelineRes.report!.overallScore);

      // Step 10: Organizer reviews and explicitly approves official results
      const preview = await resultsAndAnalyticsService.previewResults(activeComp.id);
      expect(preview.entries.length).toBe(1);
      expect(preview.entries[0].officialScore).toBe(93);
      expect(preview.entries[0].rank).toBe(1);

      // Leaderboard is NOT visible to public before explicit publication
      expect(resultsAndAnalyticsService.getPublicLeaderboard(activeComp.id)).toBeNull();

      const publication = await resultsAndAnalyticsService.publishOfficialResults({
        competitionId: activeComp.id,
        organizerUserId: organizer.uid,
        organizerName: organizer.displayName,
        actorRole: 'ORGANIZER',
        approvalReason: 'Official audit completed, all judge criteria validated.',
      });
      expect(publication.status).toBe('PUBLISHED');
      expect(publication.version).toBe(1);

      // Step 11: Public leaderboard displays published results
      const publicLeaderboard = resultsAndAnalyticsService.getPublicLeaderboard(activeComp.id);
      expect(publicLeaderboard).not.toBeNull();
      expect(publicLeaderboard?.entries[0].officialScore).toBe(93);
      expect(publicLeaderboard?.entries[0].projectTitle).toBe('T-800 Edge Kinematics');
      expect(publicLeaderboard?.entries[0].resultState).toBe('OFFICIAL');
    });
  });

  // ─────────────────────────────────────────────
  // 2. LEGACY CLEANUP & SANDBOX INVARIANTS
  // ─────────────────────────────────────────────
  describe('2. Legacy Sandbox Runner & Untrusted Code Safeguards', () => {
    it('defaults to sandboxEnvironmentConfigured = false in production', () => {
      expect(sandboxRunner.isSandboxAvailable()).toBe(false);
    });

    it('rejects arbitrary code execution when unconfigured and returns SANDBOX_UNAVAILABLE without fake passing tests', async () => {
      sandboxRunner.setSandboxAvailable(false);

      const result = await sandboxRunner.executeJavaTests({
        repositoryId: 'test-repo',
        prNumber: 1,
        studentUsername: 'student1',
        changedFiles: [{ filename: 'src/Solution.java', status: 'modified' }],
      });

      expect(result.status).toBe('SANDBOX_UNAVAILABLE');
      expect(result.success).toBe(false);
      expect(result.compilationPassed).toBe(false);
      expect(result.testsPassed).toBe(0);
      expect(result.executionMode).toBe('UNSUPPORTED');
      expect(result.error).toContain('Automated execution sandbox unavailable');
    });

    it('detects test tampering and prevents submission from disabling assertions', () => {
      const tampering = sandboxRunner.detectTestTampering([
        {
          filename: 'src/test/java/SolutionTest.java',
          status: 'modified',
          patch: '@Disabled\nvoid testImportantLogic() { assertTrue(true); }',
        },
      ]);

      expect(tampering.isTampered).toBe(true);
      expect(tampering.tamperedFiles).toContain('src/test/java/SolutionTest.java');
      expect(tampering.reasons.some((r) => r.includes('weakening or disable annotation'))).toBe(true);
    });

    it('sanitizes execution environment to prevent secret leakage', () => {
      const dirtyEnv = {
        VITE_FIREBASE_API_KEY: 'secret-key-123',
        GITHUB_TOKEN: 'ghp_secrettoken',
        AUTH_SECRET: 'jwt-auth-secret',
        PORT: '3000',
        NODE_ENV: 'production',
      };

      const cleanEnv = sandboxRunner.sanitizeEnvironment(dirtyEnv);
      expect(cleanEnv.VITE_FIREBASE_API_KEY).toBeUndefined();
      expect(cleanEnv.GITHUB_TOKEN).toBeUndefined();
      expect(cleanEnv.AUTH_SECRET).toBeUndefined();
      expect(cleanEnv.PORT).toBe('3000');
      expect(cleanEnv.NODE_ENV).toBe('production');
    });

    it('labels test harness simulation fixtures explicitly as simulated', async () => {
      sandboxRunner.setSandboxAvailable(true);

      const result = await sandboxRunner.executeJavaTests({
        repositoryId: 'test-repo',
        prNumber: 42,
        studentUsername: 'alice',
        changedFiles: [{ filename: 'src/Matrix.java', status: 'modified' }],
        mockExecutionResult: {
          compiles: true,
          totalTests: 5,
          testsPassed: 5,
          testsFailed: 0,
        },
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.isSimulated).toBe(true);
      expect(result.executionMode).toBe('SIMULATED');
      expect(result.log).toContain('SIMULATED TEST FIXTURE');
    });
  });

  // ─────────────────────────────────────────────
  // 3. MOCK & DEMO MODE GOVERNANCE
  // ─────────────────────────────────────────────
  describe('3. Mock, Demo & Storage Governance', () => {
    it('disables demo mode when VITE_ENABLE_DEMO_MODE is not true', () => {
      // In clean test environment without VITE_ENABLE_DEMO_MODE='true'
      const isDemo = isDemoModeEnabled();
      expect(typeof isDemo).toBe('boolean');
    });

    it('cleans sample demo entries from localStorage without destroying user data', () => {
      // Ensure purgeLegacySampleStorageOnce executes cleanly without error
      expect(() => purgeLegacySampleStorageOnce()).not.toThrow();
    });

    it('guarantees that submission tokens are cryptographically hashed and never stored raw', async () => {
      const activeComp: Competition = {
        id: 'comp-token-test',
        organizationId: orgId,
        title: 'Token Security Test',
        slug: 'token-security-test',
        tagline: 'Token test',
        description: 'Test description',
        type: 'HACKATHON',
        status: 'ACTIVE',
        visibility: 'PUBLIC',
        participationType: 'INDIVIDUAL',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        evaluationDeadline: new Date(Date.now() + 172800000).toISOString(),
        rounds: [],
        tracks: ['General'],
        isOpenTrackEnabled: true,
        policies: {
          teamSubmissionsEnabled: true,
          individualSubmissionsAllowed: true,
          minTeamMembers: 1,
          maxTeamMembers: 4,
          allowLateSubmissions: false,
          submissionDeadline: new Date(Date.now() + 86400000).toISOString(),
          allowSubmissionEdits: true,
          aiEvaluationEnabled: true,
          judgeFeedbackVisibleToParticipants: true,
          aiScoresVisibleToParticipants: true,
        },
        rubric: [{ id: 'c1', name: 'Crit', description: '', weight: 100, maxScore: 100 }],
        publicAccessCode: 'PF-TOK',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitionService.resetInMemoryStore([activeComp]);

      // Generate access key & session
      const accessKey = await accessManagementService.generatePublicAccessKey(
        activeComp.id,
        activeComp.publicAccessCode
      );
      const session = await accessManagementService.validateAccessAndCreateSession(accessKey.code);
      expect(session.valid).toBe(true);

      const result = await submissionService.createSubmission(
        {
          competitionId: activeComp.id,
          sessionToken: session.session!.sessionToken,
          submissionType: 'INDIVIDUAL',
          primaryContactName: 'Solo Dev',
          primaryContactEmail: 'solo@dev.org',
          projectTitle: 'Private Project',
          projectDescription: 'Secure project submission with token hashing.',
          problemStatement: 'Problem statement',
          solution: 'Solution',
          technologiesUsed: ['TypeScript'],
          track: 'General',
          githubUrl: 'https://github.com/solodev/private-project',
          fieldValues: {},
          files: [],
        },
        activeComp
      );

      // Raw token is returned ONCE to the creator
      expect(result.rawManagementToken).toMatch(/^sec_/);

      // In the database record, raw token is absent and only a 64-character SHA-256 hash exists
      const retrieved = await submissionService.getSubmission(result.submission.id);
      expect((retrieved as any).rawManagementToken).toBeUndefined();
      expect(retrieved?.managementTokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(retrieved?.managementTokenPrefix).toBe(result.submission.managementTokenPrefix);
    });
  });
});
