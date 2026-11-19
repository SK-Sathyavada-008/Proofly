// ─────────────────────────────────────────────
// anonymousParticipantSubmission.test.ts — Phase 5 Test Suite
// Proofly — Anonymous Participant Submissions
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { submissionService } from '../submissionService';
import { submissionLifecycleService } from '../submissionLifecycleService';
import { participantTeamService } from '../participantTeamService';
import { fileStorageService } from '../fileStorageService';
import { accessManagementService } from '../accessManagementService';
import { formBuilderService } from '../formBuilderService';
import { competitionService } from '../competitionService';
import { sha256Hash } from '../../utils/cryptoUtils';
import type { Competition } from '../../types/authAndCompetition';
import type { SubmissionCreationPayload } from '../../types/submission';

describe('Phase 5: Anonymous Participant Submissions', () => {
  const competitionId = 'comp_phase5_test';
  const orgId = 'org_phase5_test';

  const mockCompetition: Competition = {
    id: competitionId,
    organizationId: orgId,
    title: 'Hybrid AI Global Hackathon 2026',
    slug: 'hybrid-ai-global-hackathon-2026',
    tagline: 'Better reviews. Clearer decisions.',
    description: 'On-device Gemini Nano 4 and Cloud Gemini 2.5 Flash hackathon.',
    type: 'HACKATHON',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    participationType: 'BOTH',
    startDate: new Date(Date.now() - 86400000).toISOString(),
    endDate: new Date(Date.now() + 86400000 * 7).toISOString(),
    evaluationDeadline: new Date(Date.now() + 86400000 * 10).toISOString(),
    publicAccessCode: 'PF-HACK',
    policies: {
      teamSubmissionsEnabled: true,
      minTeamMembers: 1,
      maxTeamMembers: 5,
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
      { id: 'c1', name: 'Technical Execution', description: 'Code quality and architecture', maxScore: 25, weight: 25 },
      { id: 'c2', name: 'Innovation', description: 'Originality of concept', maxScore: 25, weight: 25 },
      { id: 'c3', name: 'Gemini Integration', description: 'Hybrid inference implementation', maxScore: 25, weight: 25 },
      { id: 'c4', name: 'Impact & Feasibility', description: 'Real-world value', maxScore: 25, weight: 25 },
    ],
    tracks: ['AI at the Edge', 'Autonomous Agents'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let validSessionToken: string;

  beforeEach(async () => {
    competitionService.resetInMemoryStore([mockCompetition]);
    submissionService.clearMemoryStore();
    formBuilderService.clearMemoryStore();
    accessManagementService.clearMemoryStore();

    // Setup active form schema and access key
    await formBuilderService.saveFormSchema(
      formBuilderService.generateDefaultHackathonSchema(competitionId, orgId)
    );

    await accessManagementService.generatePublicAccessKey(competitionId, 'PF-HACK');
    const sessionRes = await accessManagementService.validateAccessAndCreateSession(competitionId, 'PF-HACK');
    validSessionToken = sessionRes.session!.sessionToken;
  });

  // ─────────────────────────────────────────────
  // 1. Zero-Account Anonymous Submission
  // ─────────────────────────────────────────────
  describe('Zero-Account Anonymous Submission Creation', () => {
    it('creates a project submission anonymously without requiring user credentials', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'TEAM',
        teamName: 'Neural Surge',
        primaryContactName: 'Alice Developer',
        primaryContactEmail: 'alice@example.com',
        participants: [
          { name: 'Alice Developer', email: 'alice@example.com', role: 'Team Lead', isLead: true },
          { name: 'Bob Engineer', email: 'bob@example.com', role: 'AI Specialist', isLead: false },
        ],
        projectTitle: 'Proofly Hybrid Evaluator',
        projectDescription: 'Decentralized hackathon evaluation running local Gemini Nano 4 inference.',
        problemStatement: 'Manual hackathon evaluations are biased and slow.',
        solution: 'Automated on-device AI grading with cryptographic audit trails.',
        technologiesUsed: ['Gemini Nano 4', 'React', 'Firebase'],
        githubUrl: 'https://github.com/sk-sathyavada-008/proofly',
        deploymentUrl: 'https://proofly.web.app',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, mockCompetition);

      expect(result).toBeDefined();
      expect(result.referenceId).toMatch(/^PF-SUB-2026-[A-Z0-9]{5}$/);
      expect(result.rawManagementToken).toMatch(/^sec_[a-f0-9]{64}$/);
      expect(result.managementUrl).toContain(result.referenceId);

      // Verify stored document
      const stored = await submissionService.getSubmissionByReference(result.referenceId);
      expect(stored).not.toBeNull();
      expect(stored!.projectTitle).toBe('Proofly Hybrid Evaluator');
      expect(stored!.submissionType).toBe('TEAM');
      expect(stored!.teamName).toBe('Neural Surge');
      expect(stored!.participants).toHaveLength(2);
      expect(stored!.status).toBe('Queued for AI Evaluation'); // Auto-transitioned from Submitted -> Validating -> Queued
      expect(stored!.currentVersion).toBe(1);
    });

    it('rejects submission if session token is invalid or expired', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: 'invalid_or_expired_session',
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Solo Coder',
        projectTitle: 'Solo Hack',
        projectDescription: 'Quick hack',
        fieldValues: {},
      };

      await expect(submissionService.createSubmission(payload, mockCompetition)).rejects.toThrow(
        /Invalid or expired submission session/i
      );
    });
  });

  // ─────────────────────────────────────────────
  // 2. Cryptographic Management Token Security
  // ─────────────────────────────────────────────
  describe('Cryptographic Management Token Security', () => {
    it('stores ONLY the SHA-256 hash of the raw token, NEVER the plaintext token', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Cryptographer',
        primaryContactEmail: 'crypto@example.com',
        participants: [{ name: 'Cryptographer', isLead: true }],
        projectTitle: 'Zero Knowledge Token Proof',
        projectDescription: 'Security verification demonstration project with zero knowledge token hash guarantees.',
        githubUrl: 'https://github.com/sk-sathyavada-008/zk-proof',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, mockCompetition);
      const stored = await submissionService.getSubmissionByReference(result.referenceId);

      // Assert raw token is not stored anywhere in the document
      expect((stored as any).rawManagementToken).toBeUndefined();
      expect((stored as any).token).toBeUndefined();

      // Assert SHA-256 hash matches
      const expectedHash = await sha256Hash(result.rawManagementToken);
      expect(stored!.managementTokenHash).toBe(expectedHash);
      expect(stored!.managementTokenPrefix).toBe(result.rawManagementToken.substring(0, 6));

      // Assert verification service
      const isAuthValid = await submissionService.verifyManagementToken(
        result.referenceId,
        result.rawManagementToken
      );
      expect(isAuthValid).toBe(true);

      const isFakeValid = await submissionService.verifyManagementToken(
        result.referenceId,
        'sec_attacker_fake_token_000000000000'
      );
      expect(isFakeValid).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Team Handling vs Solo Individual Submissions
  // ─────────────────────────────────────────────
  describe('Team Handling vs Solo Individual Submissions', () => {
    it('creates a solo participant record WITHOUT forcing a fake team for individual submissions', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Solo Researcher',
        primaryContactEmail: 'solo@example.com',
        participants: [{ name: 'Solo Researcher', email: 'solo@example.com', role: 'Solo Creator', isLead: true }],
        projectTitle: 'Independent AI Agent Study',
        projectDescription: 'Empirical analysis of on-device LLMs and decentralized hybrid model evaluation.',
        githubUrl: 'https://github.com/sk-sathyavada-008/solo-study',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, mockCompetition);
      const stored = await submissionService.getSubmissionByReference(result.referenceId);

      expect(stored!.submissionType).toBe('INDIVIDUAL');
      expect(stored!.teamId).toBeUndefined();
      expect(stored!.teamName).toBeUndefined();
      expect(stored!.participants).toHaveLength(1);
      expect(stored!.participants[0].name).toBe('Solo Researcher');
      expect(stored!.participants[0].isLead).toBe(true);
    });

    it('supports CSV import of teams and participants', async () => {
      const csvData = `
team_name,participant_name,email,role,github_username,is_lead
Alpha Squad,Elena Vance,elena@example.com,AI Engineer,evance,true
Alpha Squad,Gordon Freeman,gordon@example.com,Physicist,gfreeman,false
Beta Squad,Chell Lab,chell@example.com,Robotics,chell,true
,Solo Contributor,solo@example.com,Developer,solodev,true
      `.trim();

      const importResult = await participantTeamService.importParticipantsFromCsv(
        competitionId,
        orgId,
        csvData
      );

      expect(importResult.totalRows).toBe(4);
      expect(importResult.teamsCreated).toBe(2); // Alpha Squad and Beta Squad
      expect(importResult.participantsCreated).toBe(4);
      expect(importResult.errors).toHaveLength(0);

      const compTeams = await participantTeamService.listCompetitionTeams(competitionId);
      expect(compTeams.length).toBeGreaterThanOrEqual(2);
      expect(compTeams.some((t) => t.name === 'Alpha Squad')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 4. File Handling & Magic Byte Inspection
  // ─────────────────────────────────────────────
  describe('File Handling & Magic Byte Security Inspection', () => {
    it('accepts genuine PDF and ZIP files', async () => {
      // PDF magic bytes (%PDF-)
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      const pdfRes = await fileStorageService.validateFile({
        name: 'architecture.pdf',
        size: pdfBytes.length,
        bytes: pdfBytes,
      }, { allowedExtensions: ['.pdf'] });

      expect(pdfRes.valid).toBe(true);
      expect(pdfRes.detectedMimeType).toBe('application/pdf');

      // ZIP magic bytes (PK..)
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
      const zipRes = await fileStorageService.validateFile({
        name: 'codebase.zip',
        size: zipBytes.length,
        bytes: zipBytes,
      }, { allowedExtensions: ['.zip'] });

      expect(zipRes.valid).toBe(true);
      expect(zipRes.detectedMimeType).toBe('application/zip');

      // PPTX presentation archive (PK..)
      const pptxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const pptxRes = await fileStorageService.validateFile({
        name: 'deck.pptx',
        size: pptxBytes.length,
        bytes: pptxBytes,
      }, { allowedExtensions: ['.pptx', '.pdf'] });

      expect(pptxRes.valid).toBe(true);

      // Legacy PPT presentation (OLE2 Compound Document Header: D0 CF 11 E0)
      const pptBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const pptRes = await fileStorageService.validateFile({
        name: 'slides.ppt',
        size: pptBytes.length,
        bytes: pptBytes,
      }, { allowedExtensions: ['.ppt', '.pdf'] });

      expect(pptRes.valid).toBe(true);
      expect(pptRes.detectedMimeType).toBe('application/vnd.ms-powerpoint');
    });

    it('rejects disguised executable binaries disguised as PDF files', async () => {
      // Windows PE Executable magic bytes (MZ) disguised as presentation.pdf
      const evilExeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const res = await fileStorageService.validateFile({
        name: 'presentation.pdf',
        size: evilExeBytes.length,
        bytes: evilExeBytes,
      }, { allowedExtensions: ['.pdf'] });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/executable binary code|valid PDF headers/i);
    });

    it('rejects files exceeding max allowed size', async () => {
      const dummyBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const res = await fileStorageService.validateFile({
        name: 'oversized.pdf',
        size: 30 * 1024 * 1024, // 30 MB
        bytes: dummyBytes,
      }, { allowedExtensions: ['.pdf'], maxSizeMb: 25 });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceeds maximum allowed size of 25MB/i);
    });
  });

  // ─────────────────────────────────────────────
  // 5. Submission Lifecycle & AI Evaluation Gate
  // ─────────────────────────────────────────────
  describe('Submission Lifecycle & AI Evaluation Gate', () => {
    it('blocks judges from accessing submissions prior to AI evaluation completion', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Tester',
        primaryContactEmail: 'tester@example.com',
        projectTitle: 'Gatekeeper Check',
        projectDescription: 'Check that judges cannot view un-evaluated submissions before AI completion.',
        githubUrl: 'https://github.com/sk-sathyavada-008/gatekeeper',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, mockCompetition);
      const sub = (await submissionService.getSubmissionByReference(result.referenceId))!;

      // Status is 'Queued for AI Evaluation'
      const check1 = submissionLifecycleService.canJudgeReviewSubmission(sub);
      expect(check1.allowed).toBe(false);
      expect(check1.reason).toMatch(/requires automated AI pre-evaluation to complete/i);

      // Transition to 'AI Evaluation In Progress'
      const inProgressSub = submissionLifecycleService.transitionStatus(
        sub,
        'AI Evaluation In Progress',
        { id: 'ai_engine' }
      ).updatedSubmission!;
      const check2 = submissionLifecycleService.canJudgeReviewSubmission(inProgressSub);
      expect(check2.allowed).toBe(false);

      // Transition to 'AI Evaluation Complete' -> 'Ready for Judge Review'
      const aiDoneSub = submissionLifecycleService.transitionStatus(
        inProgressSub,
        'AI Evaluation Complete',
        { id: 'ai_engine' }
      ).updatedSubmission!;
      const readySub = submissionLifecycleService.transitionStatus(
        aiDoneSub,
        'Ready for Judge Review',
        { id: 'system' }
      ).updatedSubmission!;

      // Now judge access must be permitted
      const check3 = submissionLifecycleService.canJudgeReviewSubmission(readySub);
      expect(check3.allowed).toBe(true);
    });

    it('enforces organizer AI-failure override to unlock review when AI evaluation fails', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Tester',
        primaryContactEmail: 'tester@example.com',
        projectTitle: 'Failure Override Project',
        projectDescription: 'Simulate AI failure and organizer manual override with documented justification notes.',
        githubUrl: 'https://github.com/sk-sathyavada-008/override-test',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, mockCompetition);
      let sub = (await submissionService.getSubmissionByReference(result.referenceId))!;

      // Simulate failure
      sub = submissionLifecycleService.transitionStatus(
        sub,
        'AI Evaluation In Progress',
        { id: 'ai_engine' }
      ).updatedSubmission!;

      sub = submissionLifecycleService.transitionStatus(
        sub,
        'AI Evaluation Failed',
        { id: 'ai_engine' },
        'Prompt token limit exceeded on local Nano'
      ).updatedSubmission!;

      // Judge access should be rejected
      const judgeCheckBlocked = submissionLifecycleService.canJudgeReviewSubmission(sub);
      expect(judgeCheckBlocked.allowed).toBe(false);
      expect(judgeCheckBlocked.reason).toMatch(/Automated AI Evaluation failed/i);

      // Attempting to jump to Ready for Judge Review without override is rejected
      const illegalTransition = submissionLifecycleService.transitionStatus(
        sub,
        'Ready for Judge Review',
        { id: 'judge_1' }
      );
      expect(illegalTransition.valid).toBe(false);

      // Organizer applies documented override
      const overriddenSub = submissionLifecycleService.applyAiFailureOverride(sub, {
        organizerUserId: 'organizer_saikeerthana',
        organizerName: 'Saikeerthana Sathyavada',
        reason: 'Authorized manual evaluation due to special binary model packaging.',
        justificationNotes: 'Inspected repo manually; project meets requirements.',
      });

      expect(overriddenSub.status).toBe('Ready for Judge Review');
      expect(overriddenSub.aiFailureOverride).toBeDefined();
      expect(overriddenSub.aiFailureOverride!.overriddenBy).toBe('organizer_saikeerthana');

      // Judge access is now unlocked
      const judgeCheckAllowed = submissionLifecycleService.canJudgeReviewSubmission(overriddenSub);
      expect(judgeCheckAllowed.allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 6. Resubmission, Edits & Version History
  // ─────────────────────────────────────────────
  describe('Resubmission, Edits & Version History', () => {
    it('creates version 2 when participant updates an existing submission', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Versioner',
        primaryContactEmail: 'versioner@example.com',
        projectTitle: 'Initial Title v1',
        projectDescription: 'Initial comprehensive project description for version 1 submission.',
        githubUrl: 'https://github.com/sk-sathyavada-008/v1-repo',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, mockCompetition);
      expect(result.submission.currentVersion).toBe(1);

      // Update submission
      const updated = await submissionService.updateSubmission({
        referenceId: result.referenceId,
        rawToken: result.rawManagementToken,
        updatedPayload: {
          projectTitle: 'Refined Title v2',
          projectDescription: 'Updated and expanded description v2 with architectural diagrams and benchmarks.',
        },
        changeSummary: 'Expanded problem statement and added architectural diagrams.',
        mockCompetition,
      });

      expect(updated.currentVersion).toBe(2);
      expect(updated.projectTitle).toBe('Refined Title v2');
      expect(updated.versions).toHaveLength(2);
      expect(updated.versions[0].versionNumber).toBe(1);
      expect(updated.versions[1].versionNumber).toBe(2);
      expect(updated.versions[1].changeSummary).toBe(
        'Expanded problem statement and added architectural diagrams.'
      );
    });

    it('rejects update if wrong management token is provided and prevents cross-participant tampering', async () => {
      const payloadA: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Participant A',
        primaryContactEmail: 'participanta@example.com',
        projectTitle: 'Project A',
        projectDescription: 'Project A comprehensive description detailing architecture and implementation.',
        githubUrl: 'https://github.com/sk-sathyavada-008/project-a',
        fieldValues: {},
      };

      const resultA = await submissionService.createSubmission(payloadA, mockCompetition);

      // Verify token verification method directly
      const isAuthValid = await submissionService.verifyManagementToken(
        resultA.referenceId,
        'sec_wrong_token_1234567890'
      );
      expect(isAuthValid).toBe(false);

      // Participant B attempts to modify Participant A's submission
      await expect(
        submissionService.updateSubmission({
          referenceId: resultA.referenceId,
          rawToken: 'sec_wrong_token_1234567890',
          updatedPayload: { projectTitle: 'Hacked Title' },
          mockCompetition,
        })
      ).rejects.toThrow(/Invalid secret management token/i);
    });

    it('rejects editing an active submission when allowSubmissionEdits is false', async () => {
      const noEditsComp: Competition = {
        ...mockCompetition,
        policies: {
          ...mockCompetition.policies,
          allowSubmissionEdits: false,
        },
      };

      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Locked Submitter',
        primaryContactEmail: 'locked@example.com',
        projectTitle: 'No Edits Allowed',
        projectDescription: 'Comprehensive description for a submission that cannot be edited afterwards.',
        githubUrl: 'https://github.com/sk-sathyavada-008/no-edits',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, noEditsComp);

      await expect(
        submissionService.updateSubmission({
          referenceId: result.referenceId,
          rawToken: result.rawManagementToken,
          updatedPayload: { projectTitle: 'Illegal Update' },
          mockCompetition: noEditsComp,
        })
      ).rejects.toThrow(/Organizers have disabled submission edits/i);
    });

    it('supports saving Drafts and promoting Draft to Submitted', async () => {
      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Drafter',
        primaryContactEmail: 'drafter@example.com',
        projectTitle: 'Work in Progress',
        projectDescription: 'Incomplete project description...',
        fieldValues: {},
        isDraft: true,
      };

      const result = await submissionService.createSubmission(payload, mockCompetition);
      expect(result.submission.status).toBe('Draft');

      // Promote to final submit
      const promoted = await submissionService.updateSubmission({
        referenceId: result.referenceId,
        rawToken: result.rawManagementToken,
        updatedPayload: {
          projectTitle: 'Finalized Project',
          projectDescription: 'Complete and polished project description explaining the architecture and problem.',
          githubUrl: 'https://github.com/sk-sathyavada-008/promoted',
        },
        isFinalSubmit: true,
        mockCompetition,
      });

      expect(promoted.status).toBe('Queued for AI Evaluation');
      expect(promoted.submittedAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // 7. Deadline & Late Submission Policy
  // ─────────────────────────────────────────────
  describe('Deadline & Late Submission Policy', () => {
    it('rejects submissions past deadline when allowLateSubmissions is false', async () => {
      const closedComp: Competition = {
        ...mockCompetition,
        policies: {
          ...mockCompetition.policies,
          submissionDeadline: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          allowLateSubmissions: false,
        },
      };

      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Late Submitter',
        primaryContactEmail: 'late@example.com',
        projectTitle: 'Too Late',
        projectDescription: 'Attempting to submit after deadline with complete architectural documentation.',
        githubUrl: 'https://github.com/sk-sathyavada-008/too-late',
        fieldValues: {},
      };

      await expect(submissionService.createSubmission(payload, closedComp)).rejects.toThrow(
        /Submissions are closed for this competition/i
      );
    });

    it('accepts submissions past deadline and flags them as late when allowLateSubmissions is true', async () => {
      const lateAllowedComp: Competition = {
        ...mockCompetition,
        policies: {
          ...mockCompetition.policies,
          submissionDeadline: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          allowLateSubmissions: true,
        },
      };

      const payload: SubmissionCreationPayload = {
        competitionId,
        sessionToken: validSessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Grace Period Submitter',
        primaryContactEmail: 'grace@example.com',
        projectTitle: 'Accepted Late Project',
        projectDescription: 'Submitted during grace period with full architectural documentation.',
        githubUrl: 'https://github.com/sk-sathyavada-008/grace-period',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, lateAllowedComp);
      expect(result.submission.isLate).toBe(true);
    });
  });
});
