// ─────────────────────────────────────────────
// comprehensiveCornerCases.test.ts
// Exhaustive Corner Case & Boundary Test Suite
// Proofly — All Phases End-to-End Verification
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { competitionService } from '../competitionService';
import { accessManagementService } from '../accessManagementService';
import { formBuilderService } from '../formBuilderService';
import { formValidationService } from '../formValidationService';
import { fileStorageService } from '../fileStorageService';
import { submissionService } from '../submissionService';
import { submissionLifecycleService } from '../submissionLifecycleService';
import { participantTeamService } from '../participantTeamService';
import type { Competition } from '../../types/authAndCompetition';
import type { SubmissionCreationPayload } from '../../types/submission';

describe('Proofly Comprehensive Corner Cases & Resilience Suite', () => {
  const compId = 'comp-corner-case-suite';
  const orgId = 'org-corner-case-tenant';
  const publicAccessCode = 'PF-CORNER';

  const baseCompetition: Competition = {
    id: compId,
    organizationId: orgId,
    title: 'Extreme Edge AI Challenge 2026',
    slug: 'extreme-edge-ai-challenge-2026',
    tagline: 'Better reviews. Clearer decisions.',
    description: 'Autonomous edge and hybrid evaluation platform.',
    type: 'HACKATHON',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    participationType: 'BOTH',
    startDate: new Date(Date.now() - 3600000).toISOString(),
    endDate: new Date(Date.now() + 86400000 * 7).toISOString(),
    evaluationDeadline: new Date(Date.now() + 86400000 * 14).toISOString(),
    publicAccessCode,
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
      { id: 'c1', name: 'Technical Execution', description: 'Code architecture', maxScore: 25, weight: 25 },
      { id: 'c2', name: 'Innovation', description: 'Novel concept', maxScore: 25, weight: 25 },
      { id: 'c3', name: 'Feasibility', description: 'Real-world deployment', maxScore: 25, weight: 25 },
      { id: 'c4', name: 'Impact', description: 'Domain value', maxScore: 25, weight: 25 },
    ],
    tracks: ['Edge AI', 'Autonomous Systems'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    competitionService.resetInMemoryStore([baseCompetition]);
    accessManagementService.resetInMemoryStore();
    formBuilderService.resetInMemoryStore();
    submissionService.clearMemoryStore();
    participantTeamService.clearMemoryStore();
  });

  // ─────────────────────────────────────────────
  // 1. Access Code Resolution & Boundary Conditions
  // ─────────────────────────────────────────────
  describe('1. Access Code Resolution & Boundary Conditions', () => {
    it('matches access code with case-insensitivity and whitespace padding', async () => {
      // Lowercase with leading & trailing spaces
      const resLower = await accessManagementService.validateAccessAndCreateSession('   pf-corner   ');
      expect(resLower.valid).toBe(true);
      expect(resLower.session).toBeDefined();
      expect(resLower.competition?.id).toBe(compId);

      // Uppercase
      const resUpper = await accessManagementService.validateAccessAndCreateSession('PF-CORNER');
      expect(resUpper.valid).toBe(true);
      expect(resUpper.session).toBeDefined();
    });

    it('auto-activates a DRAFT competition when accessed with the matching direct access code', async () => {
      const draftComp: Competition = {
        ...baseCompetition,
        id: 'comp-draft-test',
        publicAccessCode: 'PF-DRAFT99',
        status: 'DRAFT',
      };
      competitionService.resetInMemoryStore([draftComp]);

      const res = await accessManagementService.validateAccessAndCreateSession('PF-DRAFT99');
      expect(res.valid).toBe(true);
      expect(res.session).toBeDefined();

      // Verify competition was transitioned to ACTIVE
      const updated = await competitionService.getCompetition('comp-draft-test');
      expect(updated?.status).toBe('ACTIVE');
    });

    it('rejects an ARCHIVED competition with explicit reason', async () => {
      const archivedComp: Competition = {
        ...baseCompetition,
        id: 'comp-archived-test',
        publicAccessCode: 'PF-ARCH88',
        status: 'ARCHIVED',
      };
      competitionService.resetInMemoryStore([archivedComp]);

      const res = await accessManagementService.validateAccessAndCreateSession('PF-ARCH88');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/permanently closed|archived/i);
    });

    it('rejects completely invalid codes and empty strings', async () => {
      const resEmpty = await accessManagementService.validateAccessAndCreateSession('');
      expect(resEmpty.valid).toBe(false);
      expect(resEmpty.error).toBeDefined();

      const resInvalid = await accessManagementService.validateAccessAndCreateSession('PF-DOES-NOT-EXIST-999');
      expect(resInvalid.valid).toBe(false);
      expect(resInvalid.error).toMatch(/does not exist|invalid/i);
    });

    it('enforces maximum submission count on access keys', async () => {
      const cappedKey = await accessManagementService.generatePublicAccessKey(compId, 'PF-CAPPED');
      cappedKey.maxSubmissions = 2;
      cappedKey.submissionsCount = 2;

      const res = await accessManagementService.validateAccessAndCreateSession(compId, 'PF-CAPPED');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/submission limit reached/i);
    });

    it('enforces link expiration on access keys', async () => {
      const expiredKey = await accessManagementService.generatePublicAccessKey(compId, 'PF-EXPIRED');
      expiredKey.expiresAt = new Date(Date.now() - 60000).toISOString(); // Expired 1 min ago

      const res = await accessManagementService.validateAccessAndCreateSession(compId, 'PF-EXPIRED');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/expired/i);
    });

    it('enforces organizer revocation on access keys', async () => {
      const revokedKey = await accessManagementService.generatePublicAccessKey(compId, 'PF-REVOKED');
      revokedKey.revoked = true;

      const res = await accessManagementService.validateAccessAndCreateSession(compId, 'PF-REVOKED');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/revoked/i);
    });
  });

  // ─────────────────────────────────────────────
  // 2. Form Builder, Schema Presets & Field Validation
  // ─────────────────────────────────────────────
  describe('2. Form Builder, Schema Presets & Field Validation', () => {
    it('persists a schema with undefined roundId cleanly without exceptions', async () => {
      const saved = await formBuilderService.saveFormSchema(
        compId,
        'Global Hackathon Form',
        formBuilderService.generateDefaultHackathonSchema(compId, orgId).fields,
        undefined, // roundId undefined
        'Top-level form'
      );

      expect(saved.id).toBeDefined();
      expect(saved.title).toBe('Global Hackathon Form');
      expect(saved.roundId).toBeUndefined();

      const fetched = await formBuilderService.getFormSchema(compId);
      expect(fetched.id).toBe(saved.id);
    });

    it('supports Research Form preset without team repeater', async () => {
      const researchSchema = formBuilderService.generateDefaultResearchSchema(compId, orgId);
      expect(researchSchema.fields.some((f) => f.type === 'TEAM_MEMBER_REPEATER')).toBe(false);
      expect(researchSchema.fields.some((f) => f.id === 'field-manuscript-file')).toBe(true);

      const saved = await formBuilderService.saveFormSchema(researchSchema);
      expect(saved.fields.length).toBeGreaterThan(5);
    });

    it('validates email, GitHub repository URL, and video URLs rigorously', () => {
      const emailField = {
        id: 'email',
        label: 'Email',
        type: 'EMAIL' as const,
        required: true,
        order: 1,
        visibility: 'PUBLIC' as const,
        validation: { required: true },
      };

      expect(formValidationService.validateFieldValue(emailField, 'valid.dev@example.org')).toBeNull();
      expect(formValidationService.validateFieldValue(emailField, 'invalid-email')).toMatch(/valid email/i);

      const githubField = {
        id: 'github',
        label: 'GitHub Repo',
        type: 'GITHUB_URL' as const,
        required: true,
        order: 2,
        visibility: 'PUBLIC' as const,
        validation: { required: true },
      };

      expect(formValidationService.validateFieldValue(githubField, 'https://github.com/facebook/react')).toBeNull();
      expect(formValidationService.validateFieldValue(githubField, 'https://gitlab.com/facebook/react')).toMatch(/valid GitHub repository URL/i);

      const videoField = {
        id: 'video',
        label: 'Demo Video',
        type: 'VIDEO_URL' as const,
        required: true,
        order: 3,
        visibility: 'PUBLIC' as const,
        validation: { required: true },
      };

      expect(formValidationService.validateFieldValue(videoField, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
      expect(formValidationService.validateFieldValue(videoField, 'https://loom.com/share/abcd1234')).toBeNull();
      expect(formValidationService.validateFieldValue(videoField, 'https://example.com/not-a-video')).toMatch(/YouTube, Vimeo, Loom/i);
    });
  });

  // ─────────────────────────────────────────────
  // 3. File Handling & Multi-Format Validation (.ppt, .pptx, .pdf, .zip)
  // ─────────────────────────────────────────────
  describe('3. File Handling & Multi-Format Security Inspection', () => {
    it('accepts both modern .pptx (PK ZIP) and legacy .ppt (OLE2) formats', async () => {
      // Modern PPTX
      const pptxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const pptxRes = await fileStorageService.validateFile({
        name: 'pitch_deck.pptx',
        size: pptxBytes.length,
        bytes: pptxBytes,
      }, { allowedExtensions: ['.pptx', '.ppt', '.pdf'] });

      expect(pptxRes.valid).toBe(true);

      // Legacy PPT
      const pptBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00, 0x00, 0x00]);
      const pptRes = await fileStorageService.validateFile({
        name: 'legacy_deck.ppt',
        size: pptBytes.length,
        bytes: pptBytes,
      }, { allowedExtensions: ['.ppt', '.pptx', '.pdf'] });

      expect(pptRes.valid).toBe(true);
      expect(pptRes.detectedMimeType).toBe('application/vnd.ms-powerpoint');

      // Test PPT with text stream
      const textPptBytes = new TextEncoder().encode('Sample presentation outline');
      const textPptRes = await fileStorageService.validateFile({
        name: 'test_outline.ppt',
        size: textPptBytes.length,
        bytes: textPptBytes,
      }, { allowedExtensions: ['.ppt', '.pptx'] });

      expect(textPptRes.valid).toBe(true);
    });

    it('strictly blocks executable files even if renamed to .ppt or .pdf', async () => {
      // Windows PE binary (MZ) renamed to presentation.ppt
      const exeDisguised = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const res = await fileStorageService.validateFile({
        name: 'trojan_presentation.ppt',
        size: exeDisguised.length,
        bytes: exeDisguised,
      }, { allowedExtensions: ['.ppt'] });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/executable binary code|prohibited/i);
    });

    it('rejects empty (0 bytes) and oversized files', async () => {
      const zeroByteRes = await fileStorageService.validateFile({
        name: 'empty.pdf',
        size: 0,
        bytes: new Uint8Array([]),
      }, { allowedExtensions: ['.pdf'] });

      expect(zeroByteRes.valid).toBe(false);
      expect(zeroByteRes.error).toMatch(/empty/i);

      const oversizedBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const oversizedRes = await fileStorageService.validateFile({
        name: 'massive.pdf',
        size: 60 * 1024 * 1024, // 60 MB
        bytes: oversizedBytes,
      }, { allowedExtensions: ['.pdf'], maxSizeMb: 25 });

      expect(oversizedRes.valid).toBe(false);
      expect(oversizedRes.error).toMatch(/exceeds maximum allowed size/i);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Submissions, Cryptographic Tokens & Isolation
  // ─────────────────────────────────────────────
  describe('4. Submissions, Cryptographic Tokens & Isolation', () => {
    it('creates an anonymous individual submission without forcing a team record', async () => {
      const sessionRes = await accessManagementService.validateAccessAndCreateSession('PF-CORNER');
      expect(sessionRes.valid).toBe(true);

      const payload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Solo Researcher',
        primaryContactEmail: 'solo@research.org',
        projectTitle: 'On-Device Edge Transformers',
        projectDescription: 'Efficient on-device inference using quantized kernels.',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, baseCompetition);
      expect(result.referenceId).toMatch(/^PF-SUB-2026-[A-Z0-9]{5}$/);
      expect(result.rawManagementToken).toMatch(/^sec_[a-f0-9]{64}$/);

      // Verify stored document does NOT have a teamId
      const stored = await submissionService.getSubmissionByReference(result.referenceId);
      expect(stored).not.toBeNull();
      expect(stored!.submissionType).toBe('INDIVIDUAL');
      expect(stored!.teamId).toBeUndefined();
      expect(stored!.participants).toHaveLength(1);
      expect(stored!.participants[0].name).toBe('Solo Researcher');
      expect(stored!.participants[0].isLead).toBe(true);

      // Verify that rawManagementToken is NEVER stored in database
      expect((stored as any).rawManagementToken).toBeUndefined();
      expect(stored!.managementTokenHash).toHaveLength(64); // SHA-256 hash length
    });

    it('creates an anonymous team submission and handles empty/blank member rows cleanly', async () => {
      const sessionRes = await accessManagementService.validateAccessAndCreateSession('PF-CORNER');

      const payload: SubmissionCreationPayload = {
        competitionId: compId,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'TEAM',
        teamName: 'Quantum Coders',
        primaryContactName: 'Lead Dev',
        primaryContactEmail: 'lead@quantum.org',
        participants: [
          { name: 'Lead Dev', email: 'lead@quantum.org', role: 'Architect', isLead: true },
          { name: '', email: '', role: 'Collaborator', isLead: false }, // Blank row to test sanitizer!
          { name: 'Specialist Dev', email: 'spec@quantum.org', role: 'ML Ops', isLead: false },
        ],
        projectTitle: 'Quantum Edge Kernel',
        projectDescription: 'Sub-millisecond latency AI execution pipeline.',
        fieldValues: {},
      };

      const result = await submissionService.createSubmission(payload, baseCompetition);
      const stored = await submissionService.getSubmissionByReference(result.referenceId);

      expect(stored!.submissionType).toBe('TEAM');
      expect(stored!.teamName).toBe('Quantum Coders');
      // Blank row was cleaned; exactly 2 valid members remain
      expect(stored!.participants).toHaveLength(2);
      expect(stored!.participants.map((p) => p.name)).toEqual(['Lead Dev', 'Specialist Dev']);
    });

    it('rejects cross-participant tampering with mismatched management tokens', async () => {
      const sessionRes = await accessManagementService.validateAccessAndCreateSession('PF-CORNER');

      const subA = await submissionService.createSubmission({
        competitionId: compId,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'User A',
        projectTitle: 'Project A',
        projectDescription: 'Original description A',
        fieldValues: {},
      }, baseCompetition);

      const subB = await submissionService.createSubmission({
        competitionId: compId,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'User B',
        projectTitle: 'Project B',
        projectDescription: 'Original description B',
        fieldValues: {},
      }, baseCompetition);

      // User A attempts to edit Sub B using Token A -> MUST FAIL
      await expect(
        submissionService.updateSubmission({
          referenceId: subB.referenceId,
          rawToken: subA.rawManagementToken, // WRONG TOKEN!
          updatedPayload: { projectTitle: 'Hacked Title' },
          mockCompetition: baseCompetition,
        })
      ).rejects.toThrow(/invalid secret management token/i);

      // Verify Sub B was untouched
      const subBUnchanged = await submissionService.getSubmissionByReference(subB.referenceId);
      expect(subBUnchanged!.projectTitle).toBe('Project B');
    });

    it('increments version number and creates changelog when participant updates submission', async () => {
      const sessionRes = await accessManagementService.validateAccessAndCreateSession('PF-CORNER');

      const created = await submissionService.createSubmission({
        competitionId: compId,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Evolving Dev',
        projectTitle: 'Version 1 Project',
        projectDescription: 'Initial commit of project description.',
        fieldValues: {},
      }, baseCompetition);

      expect(created.submission.currentVersion).toBe(1);

      // Update project
      const updated = await submissionService.updateSubmission({
        referenceId: created.referenceId,
        rawToken: created.rawManagementToken,
        updatedPayload: {
          projectTitle: 'Version 2 Project Refined',
          projectDescription: 'Updated architecture and benchmarks.',
        },
        changeSummary: 'Refined architecture benchmarks',
        mockCompetition: baseCompetition,
      });

      expect(updated.currentVersion).toBe(2);
      expect(updated.projectTitle).toBe('Version 2 Project Refined');
      expect(updated.versions).toHaveLength(2);
      expect(updated.versions[1].changeSummary).toBe('Refined architecture benchmarks');
    });

    it('enforces organizer lock preventing further edits', async () => {
      const sessionRes = await accessManagementService.validateAccessAndCreateSession('PF-CORNER');

      const created = await submissionService.createSubmission({
        competitionId: compId,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Lock Dev',
        projectTitle: 'Pre-Lock Title',
        projectDescription: 'Description before lock.',
        fieldValues: {},
      }, baseCompetition);

      // Organizer locks submission
      await submissionService.lockSubmission(created.submission.id, 'org-admin-01');

      // Participant tries to edit -> MUST BE REJECTED
      await expect(
        submissionService.updateSubmission({
          referenceId: created.referenceId,
          rawToken: created.rawManagementToken,
          updatedPayload: { projectTitle: 'Post-Lock Hack' },
          mockCompetition: baseCompetition,
        })
      ).rejects.toThrow(/locked and can no longer be edited/i);
    });
  });

  // ─────────────────────────────────────────────
  // 5. Judge Gate & AI Pipeline Lifecycle
  // ─────────────────────────────────────────────
  describe('5. Judge Gate & AI Pipeline Lifecycle', () => {
    it('strictly locks judge workspace until AI evaluation completes or organizer applies override', async () => {
      const sessionRes = await accessManagementService.validateAccessAndCreateSession('PF-CORNER');

      const created = await submissionService.createSubmission({
        competitionId: compId,
        sessionToken: sessionRes.session!.sessionToken,
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Gate Dev',
        projectTitle: 'Gate Project',
        projectDescription: 'Automated gate check verification.',
        fieldValues: {},
      }, baseCompetition);

      // Current status: Queued for AI Evaluation
      const gateInitial = submissionLifecycleService.canJudgeReviewSubmission(created.submission);
      expect(gateInitial.allowed).toBe(false);
      expect(gateInitial.reason).toMatch(/requires automated AI pre-evaluation to complete first/i);

      // Simulate AI Failure
      const failedSub = {
        ...created.submission,
        status: 'AI Evaluation Failed' as const,
      };
      const gateFailed = submissionLifecycleService.canJudgeReviewSubmission(failedSub);
      expect(gateFailed.allowed).toBe(false);
      expect(gateFailed.reason).toMatch(/blocked until an organizer reviews the failure or applies an authorized AI-failure override/i);

      // Organizer applies documented AI-Failure Override
      const overriddenSub = submissionLifecycleService.applyAiFailureOverride(failedSub, {
        organizerUserId: 'organizer-lead',
        organizerName: 'Dr. Sarah Connor',
        reason: 'Local Gemini Nano inference timeout on large repository. Unlocking for manual review.',
      });

      expect(overriddenSub.status).toBe('Ready for Judge Review');
      expect(overriddenSub.aiFailureOverride).toBeDefined();
      expect(overriddenSub.aiFailureOverride!.overriddenByName).toBe('Dr. Sarah Connor');

      // Judge can now access review workspace!
      const gateOverridden = submissionLifecycleService.canJudgeReviewSubmission(overriddenSub);
      expect(gateOverridden.allowed).toBe(true);
    });
  });
});
