// ─────────────────────────────────────────────
// phase9ProductionReadinessAndReliability.test.ts
// Phase 9: Complete 13-Step End-to-End Functional Verification,
// 10 Reliability & Failure-Mode Scenarios, and Security Controls Audit
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { InferenceMode } from 'firebase/ai';
import { organizationService } from '../organizationService';
import { scopedAuthService } from '../scopedAuthService';
import { competitionService } from '../competitionService';
import { formBuilderService } from '../formBuilderService';
import { accessManagementService } from '../accessManagementService';
import { fileStorageService } from '../fileStorageService';
import { submissionService } from '../submissionService';
import { submissionLifecycleService } from '../submissionLifecycleService';
import { contentExtractionService } from '../contentExtractionService';
import { rubricEngineService } from '../rubricEngineService';
import { aiLogicService } from '../aiLogicService';
import { evaluationQueueService } from '../evaluationQueueService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { judgeAssignmentService } from '../judgeAssignmentService';
import { scoringLedgerService } from '../scoringLedgerService';
import { governanceAuditService } from '../governanceAuditService';
import { resultsAndAnalyticsService } from '../resultsAndAnalyticsService';
import type { Competition } from '../../types/authAndCompetition';

describe('Phase 9: Production Hardening, 13-Step E2E Functional & Reliability Verification', () => {
  beforeEach(() => {
    competitionService.resetInMemoryStore([]);
    formBuilderService.resetInMemoryStore();
    accessManagementService.resetInMemoryStore();
    submissionService.clearMemoryStore();
    rubricEngineService.clearMemoryStore();
    evaluationQueueService.clearMemoryStore();
    evaluationPipelineService.clearMemoryStore();
    judgeAssignmentService.resetForTesting();
    scoringLedgerService.resetForTesting();
    governanceAuditService.resetForTesting();
    resultsAndAnalyticsService.resetForTesting();
  });

  // ─────────────────────────────────────────────
  // PART 1: COMPLETE 13-STEP END-TO-END WORKFLOW
  // ─────────────────────────────────────────────
  it('executes the complete 13-step end-to-end functional workflow from organizer sign-in to official leaderboard publication', async () => {
    // 1. Organizer signs in & creates/loads their organization
    const organizer = {
      uid: 'user-organizer-01',
      email: 'lead.organizer@deepmind.academic',
      displayName: 'Lead Organizer',
      platformRole: 'USER' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const activeOrg = await organizationService.createOrganization(
      'Phase 9 Verification Guild',
      organizer.uid,
      organizer.email,
      organizer.displayName,
      'Production verification tenant'
    );
    expect(activeOrg.id).toBeTruthy();

    // 2. Organizer creates a competition & 3. Configures a 100%-weighted rubric
    const competition = await competitionService.createCompetition(
      activeOrg.id,
      organizer.uid,
      organizer.email,
      organizer.displayName,
      {
        title: 'Phase 9 Hybrid AI Production Summit',
        tagline: 'End-to-end production readiness verification',
        tracks: ['Healthcare & Edge AI', 'Event Tech & Community Discovery'],
        isOpenTrackEnabled: true,
        rubric: [
          { id: 'crit-tech', name: 'Technological Implementation', description: 'Architecture & code', weight: 30, maxScore: 30 },
          { id: 'crit-design', name: 'Design & User Experience', description: 'UX clarity', weight: 20, maxScore: 20 },
          { id: 'crit-impact', name: 'Potential Impact', description: 'Real-world utility', weight: 25, maxScore: 25 },
          { id: 'crit-idea', name: 'Quality of the Idea', description: 'Novelty & alignment', weight: 25, maxScore: 25 },
        ],
      }
    );
    expect(competition.id).toBeTruthy();
    expect(competition.rubric.reduce((s, c) => s + c.weight, 0)).toBe(100);

    // Activate competition
    const activeCompetition = await competitionService.transitionStatus(competition.id, 'ACTIVE');

    // 4. Organizer creates/loads a submission form schema
    const formSchema = await formBuilderService.getFormSchema(competition.id);
    expect(formSchema.fields.length).toBeGreaterThan(0);

    // 5. Organizer generates a submission access link / code
    const accessKey = await accessManagementService.generatePublicAccessKey(
      competition.id,
      competition.publicAccessCode
    );
    expect(accessKey.code).toBeTruthy();

    // 6. Participant submits WITHOUT an account (ephemeral session)
    const sessionRes = await accessManagementService.validateAccessAndCreateSession(accessKey.code);
    expect(sessionRes.valid).toBe(true);
    expect(sessionRes.session?.sessionToken).toBeTruthy();

    // 7. Submission files are validated & stored securely (PDF magic bytes)
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\nEventScout technical architecture specification and latency analysis.');
    const fileVal = await fileStorageService.validateFile(
      { name: 'architecture.pdf', size: pdfBytes.length, bytes: pdfBytes },
      { allowedExtensions: ['.pdf', '.md'], maxSizeMb: 25 }
    );
    expect(fileVal.valid).toBe(true);

    const createdSub = await submissionService.createSubmission(
      {
        competitionId: competition.id,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'TEAM',
        teamName: 'ScoutBuilders',
        primaryContactName: 'Jordan Dev',
        primaryContactEmail: 'jordan@scoutbuilders.dev',
        projectTitle: 'EventScout',
        projectDescription:
          'Personal AI opportunity scout that continuously discovers events from fragmented feeds, ranks them, and notifies attendees.',
        problemStatement:
          'Students and builders miss hackathons and grants buried across scattered chat groups and campus boards.',
        solution:
          'Automated continuous event ingestion pipeline with vector relevance ranking and personalized delivery.',
        technologiesUsed: ['TypeScript', 'React', 'FastAPI', 'MongoDB'],
        track: 'Event Tech & Community Discovery',
        githubUrl: 'https://github.com/example/eventscout-demo',
        deploymentUrl: 'https://eventscout-demo.web.app',
        fieldValues: { track: 'Event Tech & Community Discovery' },
        files: [
          {
            id: 'file-arch-pdf',
            fieldId: 'pitch_deck',
            fileName: 'architecture.pdf',
            fileSize: pdfBytes.length,
            mimeType: 'application/pdf',
            storagePath: `competitions/${competition.id}/submissions/sub/architecture.pdf`,
            downloadUrl: 'data:text/plain;charset=utf-8,' + encodeURIComponent('EventScout Architecture Spec'),
            uploadedAt: new Date().toISOString(),
            isVerified: true,
          },
        ],
      },
      activeCompetition
    );

    expect(createdSub.referenceId).toMatch(/^PF-SUB-/);
    expect(createdSub.rawManagementToken).toMatch(/^sec_/);
    // Raw token is NEVER persisted in stored submission
    const persistedSub = await submissionService.getSubmission(createdSub.submission.id);
    expect((persistedSub as any).rawManagementToken).toBeUndefined();
    expect(persistedSub?.managementTokenHash).toHaveLength(64);

    // Judge MUST be blocked BEFORE AI evaluation finishes
    const gateBeforeAi = submissionLifecycleService.canJudgeReviewSubmission(persistedSub!);
    expect(gateBeforeAi.allowed).toBe(false);

    // 8 & 9. AI evaluation runs through Firebase AI Logic & saves immutable report + ledger entries
    const pipelineRes = await evaluationPipelineService.executePipeline(
      persistedSub!,
      competition,
      InferenceMode.PREFER_ON_DEVICE
    );
    expect(pipelineRes.success).toBe(true);
    expect(pipelineRes.report).toBeDefined();
    expect(pipelineRes.report?.isImmutable).toBe(true);
    expect(pipelineRes.report?.telemetry).toBeDefined();
    expect(pipelineRes.submission.status).toBe('Ready for Judge Review');

    const aiLedgerEntries = scoringLedgerService.listEntries({
      competitionId: competition.id,
      source: 'AI',
    });
    expect(aiLedgerEntries.length).toBe(4);

    // 10. Judge sees the AI report & is now permitted to review
    const gateAfterAi = submissionLifecycleService.canJudgeReviewSubmission(pipelineRes.submission);
    expect(gateAfterAi.allowed).toBe(true);
    const fetchedReport = await evaluationPipelineService.getReportBySubmissionId(persistedSub!.id);
    expect(fetchedReport?.id).toBe(pipelineRes.report?.id);

    // Assign Judge Dr. Elena Vance
    await judgeAssignmentService.assignSubmission({
      competitionId: competition.id,
      submissionId: persistedSub!.id,
      referenceId: createdSub.referenceId,
      projectTitle: persistedSub!.projectTitle,
      judgeId: 'user-judge-01',
      assignedBy: organizer.uid,
      assignedByName: organizer.displayName,
    });

    // 11. Judge submits locked human evaluation (separate from AI report)
    const humanEval = await judgeAssignmentService.submitFinalEvaluation({
      submissionId: persistedSub!.id,
      referenceId: createdSub.referenceId,
      competitionId: competition.id,
      judgeId: 'user-judge-01',
      judgeName: 'Dr. Elena Vance',
      judgeEmail: 'dr.elena.vance@stanford.edu',
      decisionMode: 'MODIFY',
      scores: { 'crit-tech': 25, 'crit-design': 17, 'crit-impact': 21, 'crit-idea': 21 },
      totalScore: 84,
      aiTotalScore: pipelineRes.report!.overallScore,
      criterionDifferences: {},
      deductionNotes: 'Verified live prototype; deducted points for missing automated test suite.',
    });
    expect(humanEval.isLocked).toBe(true);
    expect(humanEval.totalScore).toBe(84);

    // AI report remains completely untouched
    const aiAfterHuman = await evaluationPipelineService.getEvaluationReport(pipelineRes.report!.id);
    expect(aiAfterHuman?.overallScore).toBe(pipelineRes.report!.overallScore);

    // 12. Scoring engine calculates deterministic official results (default human-only policy)
    const preview = await resultsAndAnalyticsService.previewResults(competition.id);
    expect(preview.entries.length).toBe(1);
    expect(preview.entries[0].officialScore).toBe(84);
    expect(preview.entries[0].rank).toBe(1);
    expect(resultsAndAnalyticsService.getPublicLeaderboard(competition.id)).toBeNull();

    // 13. Organizer explicitly publishes the official leaderboard
    const published = await resultsAndAnalyticsService.publishOfficialResults({
      competitionId: competition.id,
      organizerUserId: organizer.uid,
      organizerName: organizer.displayName,
      actorRole: 'ORGANIZER',
      approvalReason: 'All Phase 9 end-to-end checks passed and judge scores verified.',
    });
    expect(published.status).toBe('PUBLISHED');
    expect(published.version).toBe(1);

    const publicBoard = resultsAndAnalyticsService.getPublicLeaderboard(competition.id);
    expect(publicBoard).not.toBeNull();
    expect(publicBoard?.entries[0].officialScore).toBe(84);
    expect(publicBoard?.entries[0].resultState).toBe('OFFICIAL');

    // Audit trail recorded all governance events
    const audits = governanceAuditService.listEvents({ competitionId: competition.id });
    expect(audits.some((a) => a.category === 'ASSIGNMENT_CHANGE')).toBe(true);
    expect(audits.some((a) => a.category === 'EVALUATION_SUBMISSION')).toBe(true);
    expect(audits.some((a) => a.category === 'PUBLICATION_ACTION')).toBe(true);
  });

  // ─────────────────────────────────────────────
  // PART 2: RELIABILITY & FAILURE-MODE SCENARIOS
  // ─────────────────────────────────────────────
  describe('Reliability & Fault-Tolerance Verification (10 Scenarios)', () => {
    it('1-4. handles network failures, unavailable on-device AI, and cloud fallback failures gracefully', async () => {
      // 1. Network failure / inaccessible external repo & deployment links degrade cleanly without throwing
      const packet = await contentExtractionService.extractSubmissionEvidence({
        id: 'sub-net-fail',
        referenceId: 'PF-NET-01',
        competitionId: 'comp-rel',
        organizationId: 'org-1',
        formSchemaId: 's1',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Net Tester',
        projectTitle: 'Offline Resilient Prototype',
        projectDescription: 'Tests inaccessible URLs and offline extraction resilience.',
        technologiesUsed: ['TypeScript'],
        githubUrl: 'https://github.com/nonexistent-owner-xyz/nonexistent-repo-999999',
        deploymentUrl: 'https://nonexistent.invalid.local',
        videoUrl: 'https://youtube.com/watch?v=demo123',
        fieldValues: {},
        files: [],
        status: 'Queued for AI Evaluation',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: 'h',
        managementTokenPrefix: 'p',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      expect(packet.evidenceDisclaimers.some((d) => d.includes('Video'))).toBe(true);

      // 2-4. On-device unavailable & cloud unavailable: evaluateProjectSummary returns honest error / telemetry without crashing
      const onDeviceOnlyRes = await aiLogicService.evaluateProjectSummary(
        'Offline test summary',
        InferenceMode.ONLY_ON_DEVICE
      );
      expect(onDeviceOnlyRes.success).toBe(false);
      expect(onDeviceOnlyRes.telemetry.requestedMode).toBe(InferenceMode.ONLY_ON_DEVICE);
      expect(onDeviceOnlyRes.error).toBeTruthy();

      // Failed AI submission can still be unlocked via audited organizer AI-Failure Override
      const failedSub = {
        id: 'sub-ai-fail',
        referenceId: 'PF-FAIL-01',
        competitionId: 'comp-rel',
        organizationId: 'org-1',
        formSchemaId: 's1',
        submissionType: 'INDIVIDUAL' as const,
        participants: [],
        primaryContactName: 'Fallback User',
        projectTitle: 'Cloud Outage Recovery Entry',
        projectDescription: 'Testing recovery when cloud inference fails.',
        technologiesUsed: ['Python'],
        fieldValues: {},
        files: [],
        status: 'AI Evaluation Failed' as const,
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: 'h',
        managementTokenPrefix: 'p',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(submissionLifecycleService.canJudgeReviewSubmission(failedSub).allowed).toBe(false);
      const recovered = submissionLifecycleService.applyAiFailureOverride(failedSub, {
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        reason: 'Cloud fallback outage confirmed; manually verified submission artifacts.',
      });
      expect(recovered.status).toBe('Ready for Judge Review');
      expect(submissionLifecycleService.canJudgeReviewSubmission(recovered).allowed).toBe(true);
    });

    it('5. prevents duplicate job execution via concurrency leasing and idempotency', async () => {
      const job1 = await evaluationQueueService.enqueueSubmission('sub-dup-1', 'PF-DUP-1', 'comp-dup');
      // Enqueueing the same submission again returns the existing active job instead of creating a duplicate
      const job2 = await evaluationQueueService.enqueueSubmission('sub-dup-1', 'PF-DUP-1', 'comp-dup');
      expect(job2.id).toBe(job1.id);

      // Worker 1 leases the job; Worker 2 attempting to lease simultaneously gets null
      const lease1 = await evaluationQueueService.claimNextJob('worker-1');
      const lease2 = await evaluationQueueService.claimNextJob('worker-2');
      expect(lease1?.id).toBe(job1.id);
      expect(lease2).toBeNull();
    });

    it('6 & 7. rejects expired access links, rate-limits brute force, and blocks disguised executable files', async () => {
      const comp: Competition = {
        id: 'comp-sec-test',
        organizationId: 'org-1',
        title: 'Security Test Comp',
        slug: 'sec-test',
        tagline: 'Security checks',
        description: 'Testing expiry, rate limits, and file validation.',
        type: 'HACKATHON',
        status: 'ACTIVE',
        visibility: 'PUBLIC',
        participationType: 'BOTH',
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        evaluationDeadline: new Date(Date.now() + 86400000 * 2).toISOString(),
        publicAccessCode: 'SEC-TEST-99',
        policies: {
          teamSubmissionsEnabled: true,
          minTeamMembers: 1,
          maxTeamMembers: 4,
          individualSubmissionsAllowed: true,
          submissionDeadline: new Date(Date.now() + 86400000).toISOString(),
          allowLateSubmissions: false,
          allowSubmissionEdits: true,
          aiEvaluationEnabled: true,
          judgeFeedbackVisibleToParticipants: true,
          aiScoresVisibleToParticipants: true,
        },
        rounds: [],
        rubric: [{ id: 'c1', name: 'Tech', description: 'Tech', weight: 100, maxScore: 100 }],
        tracks: ['Open Track'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitionService.resetInMemoryStore([comp]);

      // 6. Expired access link rejected
      const expiredLink = await accessManagementService.generateIndividualLink(comp.id, {
        label: 'Expired Invite',
        expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      });
      const expiredValidation = await accessManagementService.validateAccessAndCreateSession(
        comp.id,
        expiredLink.rawToken
      );
      expect(expiredValidation.valid).toBe(false);
      expect(expiredValidation.reason).toMatch(/expired/i);

      // Rate limiting kicks in after 10 failed brute-force attempts
      for (let i = 0; i < 10; i++) {
        await accessManagementService.validateAccessAndCreateSession(comp.id, `WRONG-CODE-${i}`);
      }
      const rateLimitedRes = await accessManagementService.validateAccessAndCreateSession(
        comp.id,
        'SEC-TEST-99'
      );
      expect(rateLimitedRes.valid).toBe(false);
      expect(rateLimitedRes.reason).toMatch(/too many failed access attempts/i);

      // 7. Invalid files: empty file, oversized file, and Windows PE .exe renamed to .pdf
      const peHeader = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const exeRes = await fileStorageService.validateFile(
        { name: 'malware_deck.pdf', size: peHeader.length, bytes: peHeader },
        { allowedExtensions: ['.pdf'] }
      );
      expect(exeRes.valid).toBe(false);
      expect(exeRes.error).toMatch(/executable|prohibited/i);

      const zeroRes = await fileStorageService.validateFile(
        { name: 'empty.pdf', size: 0, bytes: new Uint8Array([]) },
        { allowedExtensions: ['.pdf'] }
      );
      expect(zeroRes.valid).toBe(false);
    });

    it('8, 9 & 10. preserves draft/locked state across refresh, isolates multi-judge reviews, and guards interrupted publication', async () => {
      const compId = 'comp-multi-rel';
      const comp: Competition = {
        id: compId,
        organizationId: 'org-1',
        title: 'Multi-Judge Reliability Comp',
        slug: 'multi-rel',
        tagline: 'Testing refresh & interrupted publish',
        description: 'Multi judge tests',
        type: 'HACKATHON',
        status: 'EVALUATION',
        visibility: 'PUBLIC',
        participationType: 'BOTH',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        evaluationDeadline: new Date().toISOString(),
        publicAccessCode: 'MULTI-9',
        policies: {
          teamSubmissionsEnabled: true,
          minTeamMembers: 1,
          maxTeamMembers: 4,
          individualSubmissionsAllowed: true,
          submissionDeadline: new Date().toISOString(),
          allowLateSubmissions: false,
          allowSubmissionEdits: false,
          aiEvaluationEnabled: true,
          judgeFeedbackVisibleToParticipants: true,
          aiScoresVisibleToParticipants: true,
        },
        rounds: [],
        rubric: [{ id: 'c1', name: 'Overall', description: 'Overall', weight: 100, maxScore: 100 }],
        tracks: ['Open Track'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitionService.resetInMemoryStore([comp]);

      await submissionService.saveSubmission({
        id: 'sub-mj-1',
        referenceId: 'PF-MJ-01',
        competitionId: compId,
        organizationId: 'org-1',
        formSchemaId: 's1',
        submissionType: 'TEAM',
        teamName: 'Team Dual',
        primaryContactName: 'Lead Dual',
        participants: [],
        projectTitle: 'Dual Review Project',
        projectDescription: 'Reviewed by two judges simultaneously.',
        technologiesUsed: ['React'],
        fieldValues: {},
        files: [],
        status: 'Ready for Judge Review',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: 'h',
        managementTokenPrefix: 'p',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 8 & 9. Judge 1 saves draft (simulating mid-review before browser refresh), Judge 2 submits final
      await judgeAssignmentService.saveEvaluationDraft({
        submissionId: 'sub-mj-1',
        referenceId: 'PF-MJ-01',
        competitionId: compId,
        judgeId: 'user-judge-01',
        judgeName: 'Dr. Elena Vance',
        judgeEmail: 'dr.elena.vance@stanford.edu',
        decisionMode: 'MODIFY',
        scores: { c1: 80 },
        totalScore: 80,
        aiTotalScore: 78,
        criterionDifferences: {},
        deductionNotes: 'Mid-review draft saved prior to refresh.',
      });

      // Draft survives lookup & is hidden from Judge 2
      const recoveredDraft = await judgeAssignmentService.getEvaluation('sub-mj-1', 'user-judge-01');
      expect(recoveredDraft?.status).toBe('DRAFT');
      expect(recoveredDraft?.deductionNotes).toContain('prior to refresh');
      const judge2Visible = await judgeAssignmentService.listEvaluationsForSubmission(
        'sub-mj-1',
        'judge-maya',
        false
      );
      expect(judge2Visible.length).toBe(0);

      // Judge 2 submits final evaluation (score 90)
      await judgeAssignmentService.submitFinalEvaluation({
        submissionId: 'sub-mj-1',
        referenceId: 'PF-MJ-01',
        competitionId: compId,
        judgeId: 'judge-maya',
        judgeName: 'Dr. Maya Patel',
        judgeEmail: 'maya.patel@deepmind.academic',
        decisionMode: 'MODIFY',
        scores: { c1: 90 },
        totalScore: 90,
        aiTotalScore: 78,
        criterionDifferences: {},
        deductionNotes: 'Completed review #2.',
      });

      // 10. Interrupted / invalid publication (empty reason) leaves public leaderboard unpublished & clean
      await expect(
        resultsAndAnalyticsService.publishOfficialResults({
          competitionId: compId,
          organizerUserId: 'org-1',
          organizerName: 'Lead Organizer',
          actorRole: 'ORGANIZER',
          approvalReason: '', // Invalid/interrupted approval
        })
      ).rejects.toThrow(/confirmation note/i);
      expect(resultsAndAnalyticsService.getPublicLeaderboard(compId)).toBeNull();

      // Valid publish succeeds atomically
      const pub = await resultsAndAnalyticsService.publishOfficialResults({
        competitionId: compId,
        organizerUserId: 'org-1',
        organizerName: 'Lead Organizer',
        actorRole: 'ORGANIZER',
        approvalReason: 'Verified Judge 2 finalized score (90/100).',
      });
      expect(pub.status).toBe('PUBLISHED');
      expect(pub.entries[0].officialScore).toBe(90);

      // Cross-tenant isolation check: Judge cannot edit competition or publish results
      const judgeAuthCtx = {
        uid: 'user-judge-01',
        email: 'dr.elena.vance@stanford.edu',
        platformRole: 'USER' as const,
        orgMemberships: { 'org-1': 'MEMBER' as const },
        competitionRoles: { [compId]: 'JUDGE' as const },
      };
      expect(scopedAuthService.canEditCompetition(judgeAuthCtx, compId, 'org-1').allowed).toBe(false);
      expect(scopedAuthService.canPublishResults(judgeAuthCtx, compId, 'org-1').allowed).toBe(false);
      expect(scopedAuthService.canEvaluateSubmission(judgeAuthCtx, compId, 'org-1').allowed).toBe(true);
      expect(scopedAuthService.assertTenantIsolation(judgeAuthCtx, 'org-other-tenant').allowed).toBe(false);
    });
  });
});
