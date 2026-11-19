// ─────────────────────────────────────────────
// phase8CompetitionLifecycleAndSubmission.test.ts
// Unit & Integration Tests: Competition Lifecycle, Public Access, Deadlines & Submission Integrity
// Proofly — Phase 08
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { competitionService } from '../competitionService';
import { competitionLifecycleService } from '../competitionLifecycleService';
import { accessManagementService } from '../accessManagementService';
import { submissionService } from '../submissionService';
import { formBuilderService } from '../formBuilderService';
import { formValidationService } from '../formValidationService';
import { sha256Hash } from '../../utils/cryptoUtils';
import type { Competition, CompetitionPolicies } from '../../types/authAndCompetition';
import type { SubmissionCreationPayload } from '../../types/submission';

describe('Phase 08: Competition Lifecycle and Submission Integrity', () => {
  const orgId = 'org-lifecycle-test';
  const compId = 'comp-phase8-lifecycle';

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
  };

  const baseCompetition: Competition = {
    id: compId,
    organizationId: orgId,
    title: 'Autonomous Systems & Edge AI Hackathon',
    slug: 'autonomous-systems-edge-ai',
    tagline: 'Edge AI hardware accelerated inspection and robotics',
    description: 'Build cutting edge autonomous systems with traceable evidence and reproducible code.',
    type: 'HACKATHON',
    status: 'DRAFT',
    visibility: 'PUBLIC',
    participationType: 'TEAM',
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
        weight: 50,
        maxScore: 10,
      },
      {
        id: 'crit-impact',
        name: 'Impact & Relevance',
        description: 'Real world impact',
        weight: 50,
        maxScore: 10,
      },
    ],
    publicAccessCode: 'PF-PHASE8',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    competitionService.resetInMemoryStore([baseCompetition]);
    accessManagementService.resetInMemoryStore();
    submissionService.resetInMemoryStore();
    formBuilderService.resetInMemoryStore();
  });

  // ─────────────────────────────────────────────
  // 1. Competition Creation Defaults & Lifecycle State Machine
  // ─────────────────────────────────────────────

  describe('1. Competition Lifecycle & State Machine', () => {
    it('creates new competitions as DRAFT by default with initial lifecycle audit history', async () => {
      const created = await competitionService.createCompetition(
        orgId,
        'user-organizer-1',
        'organizer@proofly.io',
        'Lead Organizer',
        {
          title: 'Brand New Draft Competition',
          description: 'A competition that should start as DRAFT.',
          visibility: 'PUBLIC',
          participationType: 'INDIVIDUAL',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
          tracks: ['Open Track'],
          isOpenTrackEnabled: true,
          policies: defaultPolicies,
        }
      );

      expect(created.status).toBe('DRAFT');
      expect(created.lifecycleHistory).toBeDefined();
      expect(created.lifecycleHistory?.length).toBe(1);
      expect(created.lifecycleHistory?.[0].from).toBe('DRAFT');
      expect(created.lifecycleHistory?.[0].to).toBe('DRAFT');
      expect(created.lifecycleHistory?.[0].changedBy).toBe('user-organizer-1');
    });

    it('enforces explicit valid lifecycle transitions through all 9 states', async () => {
      // DRAFT -> REGISTRATION_OPEN
      let current = await competitionService.transitionStatus(compId, 'REGISTRATION_OPEN', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Opening attendee registration',
      });
      expect(current.status).toBe('REGISTRATION_OPEN');

      // REGISTRATION_OPEN -> REGISTRATION_CLOSED
      current = await competitionService.transitionStatus(compId, 'REGISTRATION_CLOSED', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Closing registration deadline',
      });
      expect(current.status).toBe('REGISTRATION_CLOSED');

      // REGISTRATION_CLOSED -> ACTIVE
      current = await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Hacking kick-off',
      });
      expect(current.status).toBe('ACTIVE');

      // ACTIVE -> SUBMISSIONS_CLOSED
      current = await competitionService.transitionStatus(compId, 'SUBMISSIONS_CLOSED', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Submission window closed',
      });
      expect(current.status).toBe('SUBMISSIONS_CLOSED');

      // SUBMISSIONS_CLOSED -> EVALUATION
      current = await competitionService.transitionStatus(compId, 'EVALUATION', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Starting AI & Judge grading',
      });
      expect(current.status).toBe('EVALUATION');

      // EVALUATION -> RESULTS_REVIEW
      current = await competitionService.transitionStatus(compId, 'RESULTS_REVIEW', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Reviewing provisional scores',
      });
      expect(current.status).toBe('RESULTS_REVIEW');

      // RESULTS_REVIEW -> PUBLISHED
      current = await competitionService.transitionStatus(compId, 'PUBLISHED', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Public results ceremony',
      });
      expect(current.status).toBe('PUBLISHED');

      // PUBLISHED -> ARCHIVED
      current = await competitionService.transitionStatus(compId, 'ARCHIVED', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
        reason: 'Event complete and archived',
      });
      expect(current.status).toBe('ARCHIVED');

      // Verify complete lifecycle audit trail
      expect(current.lifecycleHistory?.length).toBe(8);
      expect(current.lifecycleHistory?.map((h) => h.to)).toEqual([
        'REGISTRATION_OPEN',
        'REGISTRATION_CLOSED',
        'ACTIVE',
        'SUBMISSIONS_CLOSED',
        'EVALUATION',
        'RESULTS_REVIEW',
        'PUBLISHED',
        'ARCHIVED',
      ]);
    });

    it('rejects illegal transitions (e.g. DRAFT straight to PUBLISHED or ACTIVE to PUBLISHED)', async () => {
      const draftToPublishedCheck = competitionLifecycleService.isValidTransition('DRAFT', 'PUBLISHED');
      expect(draftToPublishedCheck.valid).toBe(false);
      expect(draftToPublishedCheck.reason).toContain('Illegal lifecycle transition');

      await expect(
        competitionService.transitionStatus(compId, 'PUBLISHED', {
          callerRole: 'COMPETITION_ADMIN',
          userId: 'admin-1',
        })
      ).rejects.toThrow(/Illegal lifecycle transition/i);

      // Transition to ACTIVE
      await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
      });

      // Try jumping directly from ACTIVE to PUBLISHED (skipping SUBMISSIONS_CLOSED, EVALUATION, RESULTS_REVIEW)
      await expect(
        competitionService.transitionStatus(compId, 'PUBLISHED', {
          callerRole: 'COMPETITION_ADMIN',
          userId: 'admin-1',
        })
      ).rejects.toThrow(/Illegal lifecycle transition/i);
    });

    it('prevents unauthorized roles from mutating competition lifecycle status', async () => {
      await expect(
        competitionService.transitionStatus(compId, 'ACTIVE', {
          callerRole: 'JUDGE',
          userId: 'judge-1',
        })
      ).rejects.toThrow(/Unauthorized: Role "JUDGE" is not permitted/i);

      await expect(
        competitionService.transitionStatus(compId, 'ACTIVE', {
          callerRole: 'VIEWER',
          userId: 'viewer-1',
        })
      ).rejects.toThrow(/Unauthorized: Role "VIEWER" is not permitted/i);
    });
  });

  // ─────────────────────────────────────────────
  // 2. Public Access, Participant Sessions & Access Keys
  // ─────────────────────────────────────────────

  describe('2. Public Access, Scoped Tokens & Cryptographic Protection', () => {
    it('issues cryptographically secure participant session tokens without requiring participant accounts', async () => {
      // Ensure competition is ACTIVE
      await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
      });

      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        'PF-PHASE8'
      );

      expect(validation.valid).toBe(true);
      expect(validation.session).toBeDefined();
      expect(validation.session?.sessionToken).toBeDefined();
      expect(validation.session?.sessionToken.length).toBeGreaterThanOrEqual(32);
      expect(validation.session?.competitionId).toBe(compId);
      expect(validation.formSchema).toBeDefined();

      // Ensure stored access key tokenHash is not leaked to client
      expect(validation.accessKey?.tokenHash).toBeUndefined();
    });

    it('stores only SHA-256 hashes for individual links and returns raw secret token exactly once', async () => {
      const result = await accessManagementService.generateIndividualLink(compId, {
        email: 'alice@mit.edu',
        teamName: 'Team Alice',
        label: 'Alice Direct Submission Link',
      });

      expect(result.rawToken).toBeDefined();
      expect(result.rawToken.length).toBeGreaterThan(16);
      expect(result.accessKey.tokenHash).toBeDefined();

      // Verify that stored hash matches the SHA-256 of the raw token
      const expectedHash = await sha256Hash(result.rawToken);
      expect(result.accessKey.tokenHash).toBe(expectedHash);

      // Validate access using the raw token
      await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
      });

      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        result.rawToken
      );
      expect(validation.valid).toBe(true);
      expect(validation.session?.participantEmail).toBe('alice@mit.edu');
      expect(validation.session?.teamName).toBe('Team Alice');
    });

    it('rejects invalid access codes with clear error messages', async () => {
      const result = await accessManagementService.validateAccessAndCreateSession(
        compId,
        'COMPLETELY-INVALID-CODE'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Invalid access code or submission token/i);
    });

    it('enforces link expiration and rejects expired access tokens', async () => {
      const expiredLink = await accessManagementService.generateIndividualLink(compId, {
        email: 'bob@stanford.edu',
        expiresAt: new Date(Date.now() - 60000).toISOString(), // 1 minute in the past
      });

      await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
      });

      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        expiredLink.rawToken
      );

      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/expired on/i);
    });

    it('enforces link revocation and rejects revoked access keys', async () => {
      const link = await accessManagementService.generateIndividualLink(compId, {
        email: 'charlie@cmu.edu',
      });

      await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
      });

      // Revoke the key
      await accessManagementService.revokeAccessKey(link.accessKey.id);

      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        link.rawToken
      );

      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/revoked by the organizer/i);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Configurable Submissions: Individual vs Team & No Content Fabrication
  // ─────────────────────────────────────────────

  describe('3. Submission Policies, Team Size Limits & Backend Schema Validation', () => {
    let validSessionToken: string;

    beforeEach(async () => {
      await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
      });
      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        'PF-PHASE8'
      );
      validSessionToken = validation.session!.sessionToken;
    });

    it('accepts valid individual submission and preserves submitted values', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Dana Scully',
        primaryContactEmail: 'dana.scully@fbi.gov',
        projectTitle: 'Autonomous Edge Phenotyping Node',
        projectDescription: 'Edge AI hardware accelerated plant phenotyping using depth vision and local inference.',
        problemStatement: 'Field researchers lack real-time non-destructive plant morphology inspection.',
        solution: 'An autonomous robotic camera rig running embedded Jetson Orin Nano with real-time semantic segmentation.',
        technologiesUsed: ['Jetson Orin', 'PyTorch', 'ROS2', 'CUDA'],
        githubUrl: 'https://github.com/proofly-research/edge-phenotyper',
        track: 'Robotics',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload);
      expect(result.submission).toBeDefined();
      expect(result.submission.projectTitle).toBe('Autonomous Edge Phenotyping Node');
      expect(result.submission.submissionType).toBe('INDIVIDUAL');
      expect(result.rawManagementToken).toBeDefined();
      expect(result.referenceId).toMatch(/SUB-/);
    });

    it('rejects individual submission if multiple team members are included', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Solo Dev',
        primaryContactEmail: 'solo@example.com',
        participants: [
          { name: 'Solo Dev', email: 'solo@example.com', isLead: true },
          { name: 'Second Dev', email: 'second@example.com' },
        ],
        projectTitle: 'Multi-member Solo Attempt',
        projectDescription: 'Valid length description explaining why this should fail the individual check.',
        problemStatement: 'Problem statement describing the real world challenge in depth.',
        solution: 'Solution description outlining the autonomous hardware approach.',
        githubUrl: 'https://github.com/proofly-research/multi-member-solo',
        fieldValues: {},
      };

      await expect(submissionService.createSubmission(payload)).rejects.toThrow(
        /Individual submissions cannot have multiple team members/i
      );
    });

    it('rejects team submission without team name or with team size exceeding max cap', async () => {
      // 1. Missing team name
      const missingNamePayload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: validSessionToken,
        submissionType: 'TEAM',
        primaryContactName: 'Lead Dev',
        primaryContactEmail: 'lead@team.org',
        participants: [
          { name: 'Lead Dev', email: 'lead@team.org', isLead: true },
          { name: 'Teammate 2', email: 'two@team.org' },
        ],
        projectTitle: 'Nameless Team Project',
        projectDescription: 'A valid description of the autonomous software architecture.',
        problemStatement: 'Problem statement describing the edge AI requirements.',
        solution: 'Solution description outlining the model deployment.',
        githubUrl: 'https://github.com/proofly-research/nameless-team',
        fieldValues: {},
      };

      await expect(submissionService.createSubmission(missingNamePayload)).rejects.toThrow(
        /Team name is required for team submissions/i
      );

      // 2. Team size exceeding maxTeamMembers (max is 4)
      const oversizedPayload: SubmissionCreationPayload = {
        ...missingNamePayload,
        teamName: 'Five Star Team',
        participants: [
          { name: 'Member 1', email: 'm1@team.org', isLead: true },
          { name: 'Member 2', email: 'm2@team.org' },
          { name: 'Member 3', email: 'm3@team.org' },
          { name: 'Member 4', email: 'm4@team.org' },
          { name: 'Member 5', email: 'm5@team.org' },
        ],
        fieldValues: {},
      };

      await expect(submissionService.createSubmission(oversizedPayload)).rejects.toThrow(
        /Team cannot exceed 4 member\(s\)/i
      );
    });

    it('rejects submission with missing required schema fields without manufacturing dummy content', async () => {
      // Direct schema validation check via formValidationService
      const defaultSchema = formBuilderService.generateDefaultHackathonSchema(compId, orgId);
      const schemaValidation = formValidationService.validateSubmission(defaultSchema, {
        title: '',
        description: 'Too short',
      });
      expect(schemaValidation.valid).toBe(false);
      expect(schemaValidation.errors).toBeDefined();

      const invalidPayload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Solo Dev',
        primaryContactEmail: 'solo@example.com',
        projectTitle: '', // Missing title
        projectDescription: 'Short', // Less than 50 chars minimum
        problemStatement: '',
        solution: '',
        githubUrl: '',
        fieldValues: {},
      };

      await expect(submissionService.createSubmission(invalidPayload)).rejects.toThrow(
        /Validation failed/i
      );
    });
  });

  // ─────────────────────────────────────────────
  // 4. Deadlines, Late Policies & Atomic Submission Limits
  // ─────────────────────────────────────────────

  describe('4. Deadlines, Late Policy & Atomic Concurrency Limits', () => {
    it('rejects submissions when deadline has passed and late submissions are disallowed', async () => {
      // Set deadline in past with allowLateSubmissions: false
      const pastComp: Competition = {
        ...baseCompetition,
        status: 'ACTIVE',
        policies: {
          ...defaultPolicies,
          allowLateSubmissions: false,
          submissionDeadline: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        },
      };
      await competitionService.updateCompetition(compId, pastComp);

      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        'PF-PHASE8'
      );

      const payload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: validation.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Tardy Alice',
        primaryContactEmail: 'alice@tardy.edu',
        projectTitle: 'Too Late Edge Robotics',
        projectDescription: 'Comprehensive overview of a project submitted after the deadline has closed.',
        problemStatement: 'Problem statement of the late project.',
        solution: 'Solution details for the late project.',
        githubUrl: 'https://github.com/proofly-research/too-late',
        fieldValues: {},
      };

      await expect(submissionService.createSubmission(payload)).rejects.toThrow(
        /Submissions are closed.*deadline passed/i
      );
    });

    it('accepts late submissions when permitted and flags isLate: true', async () => {
      // Set deadline in past but allowLateSubmissions: true and lateSubmissionDeadline in future
      const lateAllowedComp: Competition = {
        ...baseCompetition,
        status: 'ACTIVE',
        policies: {
          ...defaultPolicies,
          allowLateSubmissions: true,
          submissionDeadline: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          lateSubmissionDeadline: new Date(Date.now() + 3600000).toISOString(), // 1 hour future
        },
      };
      await competitionService.updateCompetition(compId, lateAllowedComp);

      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        'PF-PHASE8'
      );

      const payload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: validation.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Grace Period Bob',
        primaryContactEmail: 'bob@grace.edu',
        projectTitle: 'Grace Period Edge Robotics',
        projectDescription: 'Comprehensive overview of an autonomous project submitted within grace period.',
        problemStatement: 'Problem statement of the grace period edge robotics project.',
        solution: 'Solution details for the autonomous robot deployed on Jetson.',
        githubUrl: 'https://github.com/proofly-research/grace-period',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload);
      expect(result.submission).toBeDefined();
      expect(result.submission.isLate).toBe(true);
    });

    it('atomically enforces maxSubmissions limit under concurrent submission bursts', async () => {
      // Set maxSubmissions = 2
      const cappedComp: Competition = {
        ...baseCompetition,
        status: 'ACTIVE',
        policies: {
          ...defaultPolicies,
          maxSubmissions: 2,
        },
      };
      await competitionService.updateCompetition(compId, cappedComp);

      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        'PF-PHASE8'
      );
      const sessionToken = validation.session!.sessionToken;

      const makePayload = (i: number): SubmissionCreationPayload => ({
        competitionId: compId,
        sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: `Concurrent Participant ${i}`,
        primaryContactEmail: `participant${i}@burst.edu`,
        projectTitle: `Concurrent Autonomous Node ${i}`,
        projectDescription: `Comprehensive project description for concurrent burst test participant ${i}.`,
        problemStatement: `Problem statement describing high volume edge inference challenges for ${i}.`,
        solution: `Solution detailing parallel execution and atomic ledger coordination for ${i}.`,
        githubUrl: `https://github.com/proofly-research/concurrent-node-${i}`,
        fieldValues: {},
      });

      // Launch 5 concurrent submissions simultaneously
      const results = await Promise.allSettled([
        submissionService.createSubmission(makePayload(1)),
        submissionService.createSubmission(makePayload(2)),
        submissionService.createSubmission(makePayload(3)),
        submissionService.createSubmission(makePayload(4)),
        submissionService.createSubmission(makePayload(5)),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 2 must succeed; 3 must be rejected due to atomic limit
      expect(fulfilled.length).toBe(2);
      expect(rejected.length).toBe(3);

      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          expect(rej.reason.message).toMatch(/Maximum submission limit of 2 reached/i);
        }
      }
    });
  });

  // ─────────────────────────────────────────────
  // 5. Submission Ownership, Locked State & Status Privilege Separation
  // ─────────────────────────────────────────────

  describe('5. Submission Ownership, Locked Submissions & Status Privilege Separation', () => {
    let createdRefId: string;
    let rawToken: string;

    beforeEach(async () => {
      await competitionService.transitionStatus(compId, 'ACTIVE', {
        callerRole: 'COMPETITION_ADMIN',
        userId: 'admin-1',
      });
      const validation = await accessManagementService.validateAccessAndCreateSession(
        compId,
        'PF-PHASE8'
      );

      const payload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: validation.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Original Author',
        primaryContactEmail: 'author@domain.org',
        projectTitle: 'Original Autonomous Drone Inspection',
        projectDescription: 'Long and detailed description of the autonomous drone inspection system.',
        problemStatement: 'Problem statement describing structural defect inspection in bridges.',
        solution: 'Autonomous quadrotor using optical flow and real-time edge defect segmentation.',
        githubUrl: 'https://github.com/proofly-research/drone-inspection',
        isDraft: true,
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload);
      createdRefId = result.referenceId;
      rawToken = result.rawManagementToken;
    });

    it('rejects editing attempt with mismatched or invalid secret management token', async () => {
      await expect(
        submissionService.updateSubmission({
          referenceId: createdRefId,
          rawToken: 'WRONG-SECRET-TOKEN',
          updatedPayload: {
            projectTitle: 'Hijacked Title',
          },
        })
      ).rejects.toThrow(/Invalid secret management token. Access denied/i);
    });

    it('allows author with valid management token to update draft submission', async () => {
      const updated = await submissionService.updateSubmission({
        referenceId: createdRefId,
        rawToken,
        updatedPayload: {
          projectTitle: 'Updated Autonomous Drone Inspection v2',
        },
      });

      expect(updated.projectTitle).toBe('Updated Autonomous Drone Inspection v2');
      expect(updated.currentVersion).toBe(2);
      expect(updated.versions.length).toBe(2);
      expect(updated.statusHistory?.length).toBeGreaterThanOrEqual(1);
    });

    it('prevents editing when submission is marked isLocked', async () => {
      // Lock submission
      const existing = await submissionService.getSubmissionByReference(createdRefId);
      expect(existing).toBeDefined();
      existing!.isLocked = true;
      await submissionService.saveSubmission(existing!);

      await expect(
        submissionService.updateSubmission({
          referenceId: createdRefId,
          rawToken,
          updatedPayload: {
            projectTitle: 'Attempted Edit on Locked Submission',
          },
        })
      ).rejects.toThrow(/This submission has been locked and can no longer be edited/i);
    });

    it('prevents participants from modifying backend evaluation/judge statuses', async () => {
      const forbiddenStatuses = [
        'AI Evaluation Complete',
        'Ready for Judge Review',
        'Under Human Review',
        'Evaluated',
        'Finalized',
      ];

      for (const forbidden of forbiddenStatuses) {
        await expect(
          submissionService.updateSubmission({
            referenceId: createdRefId,
            rawToken,
            updatedPayload: {
              status: forbidden,
            } as any,
          })
        ).rejects.toThrow(/Unauthorized status modification: Participants cannot transition/i);
      }
    });
  });
});
