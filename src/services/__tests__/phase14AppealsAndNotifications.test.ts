// ─────────────────────────────────────────────
// phase14AppealsAndNotifications.test.ts
// Unit & Integration Tests for Proofly Phase 14 — Participant Appeals and Notifications
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppealService } from '../appealService';
import { NotificationService, MockBackendEmailProvider } from '../notificationService';
import { submissionService } from '../submissionService';
import { competitionService } from '../competitionService';
import { resultsAndAnalyticsService } from '../resultsAndAnalyticsService';
import { scoringLedgerService } from '../scoringLedgerService';
import { governanceAuditService } from '../governanceAuditService';
import type { ResultPublicationRecord } from '../../types/scoringAndResults';

describe('Proofly Phase 14 — Participant Appeals and Notifications', () => {
  let appealService: AppealService;
  let notificationService: NotificationService;
  let mockEmailProvider: MockBackendEmailProvider;

  const sampleCompetition: any = {
    id: 'comp-hack-2026',
    title: 'HackAI Global 2026',
    organizationId: 'org-proofly',
    ownerId: 'org-admin-1',
    status: 'ACTIVE',
    description: 'Premier AI hackathon',
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-11-30T23:59:59Z',
    rubric: [
      { id: 'crit-innovation', name: 'Technical Innovation', description: '', maxScore: 25, weight: 25 },
      { id: 'crit-feasibility', name: 'Feasibility & Architecture', description: '', maxScore: 25, weight: 25 },
      { id: 'crit-ux', name: 'User Experience & Design', description: '', maxScore: 25, weight: 25 },
      { id: 'crit-impact', name: 'Real-world Impact', description: '', maxScore: 25, weight: 25 },
    ],
    tracks: ['AI / Agents'],
    eligibilityRules: [],
    customFields: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  const sampleSubmission: any = {
    id: 'sub-sentinel-01',
    competitionId: 'comp-hack-2026',
    referenceId: 'PF-SUB-2026-V8M8R',
    projectTitle: 'OmniTrack Sentinel',
    projectDescription: 'Intelligent security monitor and container verification engine.',
    primaryContactName: 'Sai Keerthana',
    primaryContactEmail: 'keerthana@omnitrack.io',
    teamId: 'team-omni',
    teamName: 'OmniTrack Team',
    status: 'Evaluated',
    currentVersion: 1,
    files: [],
    versions: [],
    managementTokenHash: 'mock-hash',
    managementTokenSalt: 'mock-salt',
    managementTokenPrefix: 'sec_ae9',
    createdAt: '2026-11-18T10:00:00Z',
    updatedAt: '2026-11-18T10:00:00Z',
  };

  beforeEach(() => {
    mockEmailProvider = new MockBackendEmailProvider();
    notificationService = new NotificationService(mockEmailProvider);
    appealService = new AppealService();

    // Reset mocks
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. PARTICIPANT FEEDBACK RETRIEVAL & UNRELEASED PRIVACY GUARD
  // ─────────────────────────────────────────────────────────────────
  describe('1. Participant Feedback & Unreleased Privacy Guard', () => {
    it('strictly withholds scores, criterion evaluations and judge comments when results are unreleased', async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(competitionService, 'getCompetition').mockResolvedValue(sampleCompetition);
      vi.spyOn(resultsAndAnalyticsService, 'getPublicationStatusFromFirestore').mockResolvedValue(null);
      vi.spyOn(resultsAndAnalyticsService, 'getPublicationStatus').mockReturnValue(null);

      const feedback = await appealService.getParticipantFeedback('sub-sentinel-01');

      expect(feedback.isResultsReleased).toBe(false);
      expect(feedback.publishedScore).toBeNull();
      expect(feedback.percentageScore).toBeNull();
      expect(feedback.criterionFeedback).toHaveLength(0);
      expect(feedback.submissionStatus).toBe('Evaluated');
      expect(feedback.referenceId).toBe('PF-SUB-2026-V8M8R');
    });

    it('returns official score, criterion-wise breakdown, released judge comments and announcements when results are released', async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(competitionService, 'getCompetition').mockResolvedValue(sampleCompetition);

      const publishedRecord: ResultPublicationRecord = {
        id: 'pub-hack-2026-v1',
        competitionId: 'comp-hack-2026',
        competitionTitle: 'HackAI Global 2026',
        publicSlug: 'hackai-2026',
        status: 'PUBLISHED',
        version: 1,
        policySnapshot: {} as any,
        entries: [
          {
            rank: 1,
            isTied: false,
            submissionId: 'sub-sentinel-01',
            referenceId: 'PF-SUB-2026-V8M8R',
            projectTitle: 'OmniTrack Sentinel',
            teamOrParticipantName: 'OmniTrack Team',
            submissionType: 'TEAM',
            category: 'AI / Agents',
            officialScore: 92,
            maxPossibleScore: 100,
            percentageScore: 92,
            humanAverageScore: 92,
            aiScore: 90,
            aiHumanDelta: 2,
            judgeCount: 3,
            judgeBreakdown: [],
            criterionSummaries: {
              'crit-innovation': {
                criterionId: 'crit-innovation',
                criterionName: 'Technical Innovation',
                maxScore: 25,
                averageScore: 24,
                weight: 25,
                judgeComments: ['Exceptional algorithmic design and container monitoring implementation.'],
              } as any,
              'crit-feasibility': {
                criterionId: 'crit-feasibility',
                criterionName: 'Feasibility & Architecture',
                maxScore: 25,
                averageScore: 23,
                weight: 25,
                judgeComments: ['Robust architecture with clean error boundaries.'],
              } as any,
            },
            roundScores: {},
            submittedAt: '2026-11-18T10:00:00Z',
            resultState: 'OFFICIAL',
            policyApplied: 'AVERAGE_JUDGE',
          },
        ],
        publishedAt: '2026-11-19T18:00:00Z',
        updatedAt: '2026-11-19T18:00:00Z',
      };

      vi.spyOn(resultsAndAnalyticsService, 'getPublicationStatusFromFirestore').mockResolvedValue(publishedRecord);
      vi.spyOn(resultsAndAnalyticsService, 'getPublicationStatus').mockReturnValue(publishedRecord);

      await appealService.createAnnouncement({
        competitionId: 'comp-hack-2026',
        title: 'Final Scores Released',
        content: 'Official scores and awards have been published to the public leaderboard.',
        authorName: 'Lead Organizer',
      });

      const feedback = await appealService.getParticipantFeedback('sub-sentinel-01');

      expect(feedback.isResultsReleased).toBe(true);
      expect(feedback.publishedScore).toBe(92);
      expect(feedback.percentageScore).toBe(92);
      expect(feedback.criterionFeedback).toHaveLength(2);
      expect(feedback.criterionFeedback[0].criterionId).toBe('crit-innovation');
      expect(feedback.criterionFeedback[0].releasedComments).toContain(
        'Exceptional algorithmic design and container monitoring implementation.'
      );
      expect(feedback.announcements).toHaveLength(1);
      expect(feedback.announcements[0].title).toBe('Final Scores Released');
    });

    it('rejects access if an invalid management token is provided', async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(submissionService, 'verifyManagementToken').mockResolvedValue(false);

      await expect(
        appealService.getParticipantFeedback('sub-sentinel-01', { token: 'invalid-token' })
      ).rejects.toThrow('Access denied: Invalid management token.');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. SUBMITTING AN EVALUATION APPEAL
  // ─────────────────────────────────────────────────────────────────
  describe('2. Submitting an Evaluation Appeal', () => {
    it('creates an appeal with complete metadata, participant identity and initial SUBMITTED status', async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(submissionService, 'verifyManagementToken').mockResolvedValue(true);
      vi.spyOn(competitionService, 'getCompetition').mockResolvedValue(sampleCompetition);

      const appeal = await appealService.submitAppeal({
        submissionId: 'sub-sentinel-01',
        referenceId: 'PF-SUB-2026-V8M8R',
        competitionId: 'comp-hack-2026',
        participant: {
          participantId: 'user-keerthana',
          participantName: 'Sai Keerthana',
          participantEmail: 'keerthana@omnitrack.io',
          teamName: 'OmniTrack Team',
        },
        criterionId: 'crit-innovation',
        criterionName: 'Technical Innovation',
        reason: 'EVIDENCE_OVERLOOKED',
        supportingExplanation:
          'The evaluation deducted marks for missing container health checks, but line 142 in src/monitor.ts implements the full health verification probe.',
        evidenceReferences: ['src/monitor.ts#L142-L160'],
      });

      expect(appeal.id).toMatch(/^appl_/);
      expect(appeal.status).toBe('SUBMITTED');
      expect(appeal.criterionId).toBe('crit-innovation');
      expect(appeal.reason).toBe('EVIDENCE_OVERLOOKED');
      expect(appeal.evidenceReferences).toContain('src/monitor.ts#L142-L160');
      expect(appeal.auditHistory).toHaveLength(1);
      expect(appeal.auditHistory[0].status).toBe('SUBMITTED');
    });

    it('rejects an appeal with insufficient supporting explanation (< 10 chars)', async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(competitionService, 'getCompetition').mockResolvedValue(sampleCompetition);

      await expect(
        appealService.submitAppeal({
          submissionId: 'sub-sentinel-01',
          referenceId: 'PF-SUB-2026-V8M8R',
          competitionId: 'comp-hack-2026',
          participant: { participantName: 'Sai Keerthana' },
          criterionId: 'crit-innovation',
          criterionName: 'Technical Innovation',
          reason: 'SCORING_DISCREPANCY',
          supportingExplanation: 'Unfair score', // Only 12 chars? Wait, <10 chars
        })
      ).resolves.toBeDefined();

      await expect(
        appealService.submitAppeal({
          submissionId: 'sub-sentinel-01',
          referenceId: 'PF-SUB-2026-V8M8R',
          competitionId: 'comp-hack-2026',
          participant: { participantName: 'Sai Keerthana' },
          criterionId: 'crit-feasibility',
          criterionName: 'Feasibility',
          reason: 'SCORING_DISCREPANCY',
          supportingExplanation: 'Too low', // 7 chars -> fails
        })
      ).rejects.toThrow('Detailed supporting explanation (minimum 10 characters) is required.');
    });

    it('prevents duplicate active appeals for the same criterion on the same submission', async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(competitionService, 'getCompetition').mockResolvedValue(sampleCompetition);

      await appealService.submitAppeal({
        submissionId: 'sub-sentinel-01',
        referenceId: 'PF-SUB-2026-V8M8R',
        competitionId: 'comp-hack-2026',
        participant: { participantName: 'Sai Keerthana' },
        criterionId: 'crit-innovation',
        criterionName: 'Technical Innovation',
        reason: 'EVIDENCE_OVERLOOKED',
        supportingExplanation: 'First appeal on technical innovation.',
      });

      await expect(
        appealService.submitAppeal({
          submissionId: 'sub-sentinel-01',
          referenceId: 'PF-SUB-2026-V8M8R',
          competitionId: 'comp-hack-2026',
          participant: { participantName: 'Sai Keerthana' },
          criterionId: 'crit-innovation',
          criterionName: 'Technical Innovation',
          reason: 'SCORING_DISCREPANCY',
          supportingExplanation: 'Second duplicate appeal on technical innovation.',
        })
      ).rejects.toThrow(/already exists for criterion "Technical Innovation"/);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. APPEAL WORKFLOW & STATUS TRANSITIONS
  // ─────────────────────────────────────────────────────────────────
  describe('3. Appeal Workflow & Status Transitions', () => {
    let createdAppealId: string;

    beforeEach(async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(competitionService, 'getCompetition').mockResolvedValue(sampleCompetition);

      const appeal = await appealService.submitAppeal({
        submissionId: 'sub-sentinel-01',
        referenceId: 'PF-SUB-2026-V8M8R',
        competitionId: 'comp-hack-2026',
        participant: {
          participantId: 'user-keerthana',
          participantName: 'Sai Keerthana',
          participantEmail: 'keerthana@omnitrack.io',
        },
        criterionId: 'crit-feasibility',
        criterionName: 'Feasibility & Architecture',
        reason: 'RUBRIC_MISINTERPRETATION',
        supportingExplanation:
          'The microservice isolation was scored as a monolith despite independent docker-compose definitions in /deploy.',
      });
      createdAppealId = appeal.id;
    });

    it('allows assigning an appeal reviewer and transitions status to UNDER_REVIEW', async () => {
      const updated = await appealService.assignAppealReviewer(
        createdAppealId,
        { id: 'judge-dr-chen', name: 'Dr. Marcus Chen', role: 'HEAD_JUDGE' },
        { id: 'org-admin-1', name: 'Lead Organizer', role: 'ORGANIZER' }
      );

      expect(updated.status).toBe('UNDER_REVIEW');
      expect(updated.assignedReviewer?.name).toBe('Dr. Marcus Chen');
      expect(updated.auditHistory.some((a) => a.status === 'UNDER_REVIEW')).toBe(true);
    });

    it('allows requesting clarification (NEEDS_INFORMATION) and records participant response', async () => {
      // 1. Request more information
      const withReq = await appealService.requestAppealInformation(
        createdAppealId,
        'Please clarify where the service discovery configuration is located.',
        { id: 'judge-dr-chen', name: 'Dr. Marcus Chen', role: 'HEAD_JUDGE' }
      );

      expect(withReq.status).toBe('NEEDS_INFORMATION');
      expect(withReq.informationRequests).toHaveLength(1);
      const reqId = withReq.informationRequests[0].id;

      // 2. Participant responds
      const answered = await appealService.respondToInformationRequest(
        createdAppealId,
        reqId,
        'Service discovery is configured in deploy/traefik.yml under http.services.',
        { id: 'user-keerthana', name: 'Sai Keerthana' }
      );

      expect(answered.status).toBe('UNDER_REVIEW');
      expect(answered.informationRequests[0].response).toContain('deploy/traefik.yml');
      expect(answered.informationRequests[0].respondedAt).toBeDefined();
    });

    it('allows withdrawing an appeal', async () => {
      const withdrawn = await appealService.withdrawAppeal(
        createdAppealId,
        { id: 'user-keerthana', name: 'Sai Keerthana', role: 'PARTICIPANT' },
        'Issue resolved after inspecting rubric definitions.'
      );

      expect(withdrawn.status).toBe('WITHDRAWN');
      expect(withdrawn.auditHistory.some((a) => a.status === 'WITHDRAWN')).toBe(true);
    });

    it('rejects an appeal with written rationale', async () => {
      const rejected = await appealService.resolveAppeal({
        appealId: createdAppealId,
        acceptAppeal: false,
        resolution:
          'Upon review of deploy/ directory, container networking lacks redundancy as specified in rubric Level 4 criteria.',
        resolver: { id: 'org-admin-1', name: 'Lead Organizer', role: 'ORGANIZER' },
      });

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.resolution).toContain('lacks redundancy');
      expect(rejected.resolvedAt).toBeDefined();
      expect(rejected.scoreAdjustment).toBeUndefined();
    });

    it('blocks non-organizers from resolving appeals', async () => {
      await expect(
        appealService.resolveAppeal({
          appealId: createdAppealId,
          acceptAppeal: true,
          resolution: 'Accepting appeal.',
          resolver: { id: 'user-keerthana', name: 'Participant', role: 'PARTICIPANT' },
        })
      ).rejects.toThrow('Only authorized organizers or administrators can resolve evaluation appeals.');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. APPEND-ONLY SCORE ADJUSTMENT ON APPEAL RESOLUTION
  // ─────────────────────────────────────────────────────────────────
  describe('4. Append-Only Score Adjustment on Appeal Resolution', () => {
    it('appends an authorized correction to the scoring ledger and audit trail when appeal is accepted with score change', async () => {
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(sampleSubmission);
      vi.spyOn(competitionService, 'getCompetition').mockResolvedValue(sampleCompetition);

      const appendSpy = vi.spyOn(scoringLedgerService, 'appendContributionDurable').mockResolvedValue({
        id: 'sc_appeal_adj_01',
        sequenceNumber: 1,
        entryId: 'sub-sentinel-01',
        competitionId: 'comp-hack-2026',
        evaluationId: 'appeal_appl_test',
        criterionId: 'crit-feasibility',
        score: 24,
        maxScore: 25,
        source: 'HUMAN',
        actorId: 'org-admin-1',
        actorName: 'Lead Organizer',
        reasonForAdjustment: 'Appeal Resolved: Docker compose configuration verified.',
        isAdjustment: true,
        timestamp: '2026-11-20T17:00:00Z',
      });

      const auditSpy = vi.spyOn(governanceAuditService, 'recordEvent').mockReturnValue({} as any);

      const appeal = await appealService.submitAppeal({
        submissionId: 'sub-sentinel-01',
        referenceId: 'PF-SUB-2026-V8M8R',
        competitionId: 'comp-hack-2026',
        participant: { participantName: 'Sai Keerthana' },
        criterionId: 'crit-feasibility',
        criterionName: 'Feasibility & Architecture',
        reason: 'EVIDENCE_OVERLOOKED',
        supportingExplanation: 'Architecture diagrams in /docs verify microservice separation.',
      });

      const resolved = await appealService.resolveAppeal({
        appealId: appeal.id,
        acceptAppeal: true,
        resolution: 'Verified microservice architecture in repository. Upgrading feasibility score from 20 to 24.',
        resolver: { id: 'org-admin-1', name: 'Lead Organizer', role: 'ORGANIZER' },
        scoreAdjustment: {
          criterionId: 'crit-feasibility',
          newScore: 24,
          reason: 'Verified microservice separation in /docs.',
        },
      });

      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.scoreAdjustment?.applied).toBe(true);
      expect(resolved.scoreAdjustment?.newScore).toBe(24);
      expect(resolved.scoreAdjustment?.scoreLedgerEntryId).toBe('sc_appeal_adj_01');

      // Verify that scoring ledger was called with durable append-only adjustment
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          competitionId: 'comp-hack-2026',
          entryId: 'sub-sentinel-01',
          criterionId: 'crit-feasibility',
          score: 24,
          isAdjustment: true,
          authorizedSource: 'ORGANIZER_AUTHORIZED_WORKFLOW',
        })
      );

      // Verify governance audit trail
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'ADMIN_OVERRIDE',
          action: 'SCORE_OVERRIDDEN',
          targetLabel: expect.stringContaining('Appeal'),
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. IN-APP NOTIFICATIONS & DUPLICATE PREVENTION
  // ─────────────────────────────────────────────────────────────────
  describe('5. In-App Notifications & Duplicate Prevention', () => {
    it('creates and lists notifications for a specific recipient', async () => {
      const notif = await notificationService.createNotification({
        recipientId: 'user-keerthana',
        eventType: 'SUBMISSION_CONFIRMATION',
        title: 'Submission Received',
        message: 'Your project OmniTrack Sentinel has been received.',
        resourceType: 'SUBMISSION',
        resourceId: 'sub-sentinel-01',
        actionUrl: '/submit/manage?ref=PF-SUB-2026-V8M8R',
      });

      expect(notif.id).toMatch(/^notif_/);
      expect(notif.isRead).toBe(false);

      const list = await notificationService.listNotifications({ recipientId: 'user-keerthana' });
      expect(list.total).toBe(1);
      expect(list.unreadCount).toBe(1);
      expect(list.notifications[0].title).toBe('Submission Received');
    });

    it('prevents duplicate notifications when identical event occurs within window', async () => {
      const notif1 = await notificationService.createNotification({
        recipientId: 'user-keerthana',
        eventType: 'SUBMISSION_DEADLINE_REMINDER',
        title: 'Deadline Alert: 24h Remaining',
        message: 'Submission window closes in 24 hours.',
        resourceId: 'comp-hack-2026',
        deduplicationKey: 'dedup_user-keerthana_deadline_24h',
      });

      const notif2 = await notificationService.createNotification({
        recipientId: 'user-keerthana',
        eventType: 'SUBMISSION_DEADLINE_REMINDER',
        title: 'Deadline Alert: 24h Remaining',
        message: 'Submission window closes in 24 hours.',
        resourceId: 'comp-hack-2026',
        deduplicationKey: 'dedup_user-keerthana_deadline_24h',
      });

      expect(notif2.id).toBe(notif1.id);

      const list = await notificationService.listNotifications({ recipientId: 'user-keerthana' });
      expect(list.total).toBe(1);
    });

    it('supports read / unread states, marking as read, and marking all as read', async () => {
      const notif1 = await notificationService.createNotification({
        recipientId: 'user-keerthana',
        eventType: 'COMPETITION_INVITATION',
        title: 'Invited to HackAI',
        message: 'You have been invited.',
      });

      await notificationService.createNotification({
        recipientId: 'user-keerthana',
        eventType: 'JUDGE_ASSIGNMENT',
        title: 'New Evaluation Assignments',
        message: 'Assignments pending.',
      });

      let unreadCount = await notificationService.getUnreadCount('user-keerthana');
      expect(unreadCount).toBe(2);

      // Mark single notification as read
      const updated = await notificationService.markAsRead(notif1.id, 'user-keerthana');
      expect(updated.isRead).toBe(true);
      expect(updated.readAt).toBeDefined();

      unreadCount = await notificationService.getUnreadCount('user-keerthana');
      expect(unreadCount).toBe(1);

      // Mark all as read
      const count = await notificationService.markAllAsRead('user-keerthana');
      expect(count).toBe(1);

      unreadCount = await notificationService.getUnreadCount('user-keerthana');
      expect(unreadCount).toBe(0);
    });

    it('denies user from marking another recipient’s notification as read', async () => {
      const notif = await notificationService.createNotification({
        recipientId: 'user-keerthana',
        eventType: 'REGISTRATION_CONFIRMATION',
        title: 'Registration Confirmed',
        message: 'Confirmed.',
      });

      await expect(
        notificationService.markAsRead(notif.id, 'user-intruder')
      ).rejects.toThrow(/Access denied/);
    });

    it('tests all 11 required notification event triggers without failure', async () => {
      await notificationService.notifyCompetitionInvitation({
        recipientId: 'u1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
        inviterName: 'Organizer',
      });

      await notificationService.notifyRegistrationConfirmation({
        recipientId: 'u1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
      });

      await notificationService.notifySubmissionConfirmation({
        recipientId: 'u1',
        submissionId: 's1',
        referenceId: 'PF-SUB-1',
        projectTitle: 'Project 1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
      });

      await notificationService.notifySubmissionDeadlineReminder({
        recipientId: 'u1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
        deadlineHoursRemaining: 12,
      });

      await notificationService.notifySubmissionStatusChange({
        recipientId: 'u1',
        submissionId: 's1',
        referenceId: 'PF-SUB-1',
        projectTitle: 'Project 1',
        newStatus: 'Under Human Review',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
      });

      await notificationService.notifyJudgeAssignment({
        judgeId: 'j1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
        assignedSubmissionsCount: 5,
      });

      await notificationService.notifyEvaluationDeadline({
        judgeId: 'j1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
        pendingCount: 2,
      });

      await notificationService.notifyEvaluationCompletion({
        organizerId: 'o1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
        completedCount: 20,
        totalCount: 20,
      });

      await notificationService.notifyAppealStatusChange({
        recipientId: 'u1',
        appealId: 'a1',
        referenceId: 'PF-SUB-1',
        criterionName: 'Innovation',
        newStatus: 'UNDER_REVIEW',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
      });

      await notificationService.notifyResultsPublication({
        recipientId: 'u1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
        publicSlug: 'comp-1',
      });

      await notificationService.notifyOrganizerAnnouncement({
        recipientId: 'u1',
        competitionId: 'c1',
        competitionTitle: 'Comp 1',
        announcementTitle: 'Office Hours',
        announcementContent: 'Join the mentor office hours today at 4pm.',
      });

      const res = await notificationService.listNotifications({ recipientId: 'u1' });
      expect(res.total).toBe(8); // 8 for u1, 2 for j1, 1 for o1 (11 total)
      const resJ1 = await notificationService.listNotifications({ recipientId: 'j1' });
      expect(resJ1.total).toBe(2);
      const resO1 = await notificationService.listNotifications({ recipientId: 'o1' });
      expect(resO1.total).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 6. EMAIL EXTENSION & SECURITY PREFERENCES
  // ─────────────────────────────────────────────────────────────────
  describe('6. Email Extension & Security Preferences', () => {
    it('dispatches emails via mock backend provider and guarantees ZERO real emails are sent during tests', async () => {
      await notificationService.createNotification({
        recipientId: 'user-keerthana',
        recipientEmail: 'keerthana@omnitrack.io',
        eventType: 'SUBMISSION_CONFIRMATION',
        title: 'Submission Received',
        message: 'Your project OmniTrack Sentinel has been safely received.',
        sendEmail: true,
      });

      expect(mockEmailProvider.dispatchedEmails).toHaveLength(1);
      const email = mockEmailProvider.dispatchedEmails[0];
      expect(email.to).toBe('keerthana@omnitrack.io');
      expect(email.subject).toContain('[Proofly] Submission Received');
      expect(email.eventType).toBe('SUBMISSION_CONFIRMATION');
    });

    it('respects user preferences and skips email dispatch when user opted out', async () => {
      notificationService.setUserPreferences({
        userId: 'user-keerthana',
        emailNotificationsEnabled: false, // User disabled email notifications
        subscribedCategories: {
          submissions: false,
          evaluations: false,
          appeals: false,
          announcements: false,
          reminders: false,
        },
      });

      await notificationService.createNotification({
        recipientId: 'user-keerthana',
        recipientEmail: 'keerthana@omnitrack.io',
        eventType: 'SUBMISSION_CONFIRMATION',
        title: 'Submission Received',
        message: 'Your project has been received.',
        sendEmail: true,
      });

      // Email dispatch was skipped because emailNotificationsEnabled === false
      expect(mockEmailProvider.dispatchedEmails).toHaveLength(0);
    });

    it('ensures notification email subjects and previews never leak private tokens or sensitive internal comments', async () => {
      await notificationService.createNotification({
        recipientId: 'user-keerthana',
        recipientEmail: 'keerthana@omnitrack.io',
        eventType: 'APPEAL_STATUS_CHANGE',
        title: 'Appeal UNDER_REVIEW: Technical Innovation',
        message: 'Evaluation appeal is currently under review by the judging panel.',
        sendEmail: true,
        metadata: {
          secretManagementToken: 'sec_1234567890abcdef', // sensitive secret
          privateJudgeDeliberation: 'Judge A argued with Judge B', // sensitive internal comment
        },
      });

      expect(mockEmailProvider.dispatchedEmails).toHaveLength(1);
      const email = mockEmailProvider.dispatchedEmails[0];
      expect(email.subject).not.toContain('sec_1234567890abcdef');
      expect(email.subject).not.toContain('Judge A argued with Judge B');
      expect(email.text).not.toContain('sec_1234567890abcdef');
      expect(email.text).not.toContain('Judge A argued with Judge B');
    });
  });
});
