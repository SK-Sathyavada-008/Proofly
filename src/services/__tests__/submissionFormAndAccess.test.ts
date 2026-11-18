// ─────────────────────────────────────────────
// submissionFormAndAccess.test.ts
// Unit & Integration Tests: Configurable Forms, Access Keys & Security Scoping
// Proofly — Phase 4
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { formValidationService } from '../formValidationService';
import { formBuilderService } from '../formBuilderService';
import { accessManagementService } from '../accessManagementService';
import { seedDataService, SEED_COMPETITIONS } from '../seedDataService';
import { sha256Hash } from '../../utils/cryptoUtils';
import type {
  SubmissionFormSchema,
  SubmissionFormField,
} from '../../types/formAndAccess';

describe('Phase 4: Configurable Submission Forms and Access Management', () => {
  const activeCompetitionId = 'comp-robotics-edge'; // Active competition from seed

  beforeEach(() => {
    seedDataService.seedLocalEnvironment();
    accessManagementService.resetInMemoryStore();
    formBuilderService.resetInMemoryStore();
  });

  // ─────────────────────────────────────────────
  // 1. Form Field Validation Tests
  // ─────────────────────────────────────────────

  describe('1. Form Field Validation Logic', () => {
    it('catches missing required fields', () => {
      const schema: SubmissionFormSchema = {
        id: 'test-schema',
        competitionId: activeCompetitionId,
        title: 'Test Form',
        fields: [
          {
            id: 'title',
            type: 'SHORT_TEXT',
            label: 'Project Title',
            required: true,
            order: 1,
            visibility: 'PUBLIC',
            validation: { required: true },
          },
          {
            id: 'email',
            type: 'EMAIL',
            label: 'Contact Email',
            required: true,
            order: 2,
            visibility: 'PUBLIC',
            validation: { required: true },
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = formValidationService.validateSubmission(schema, {
        title: '',
        // email omitted
      });

      expect(result.valid).toBe(false);
      expect(result.errors.title).toBe('Project Title is required.');
      expect(result.errors.email).toBe('Contact Email is required.');
    });

    it('rejects invalid file types and accepts permitted extensions', () => {
      const fileField: SubmissionFormField = {
        id: 'pitch-deck',
        type: 'FILE_UPLOAD',
        label: 'Presentation Slide Deck',
        required: true,
        order: 1,
        visibility: 'PUBLIC',
        validation: {
          required: true,
          fileTypeRestrictions: ['.pdf', '.ppt', '.pptx'],
          maxFileSizeMb: 20,
        },
      };

      // Disallowed extension (.exe / .zip)
      const invalidFile = { name: 'malware.exe', sizeBytes: 1024 * 100 };
      const invalidResult = formValidationService.validateFieldValue(fileField, invalidFile);
      expect(invalidResult).toContain('invalid file type');
      expect(invalidResult).toContain('.pdf, .ppt, .pptx');

      // Allowed extension (.pdf)
      const validFile = { name: 'presentation_deck_final.pdf', sizeBytes: 5 * 1024 * 1024 };
      const validResult = formValidationService.validateFieldValue(fileField, validFile);
      expect(validResult).toBeNull();
    });

    it('enforces maximum file size restrictions', () => {
      const fileField: SubmissionFormField = {
        id: 'large-asset',
        type: 'FILE_UPLOAD',
        label: 'Project Archive',
        required: true,
        order: 1,
        visibility: 'PUBLIC',
        validation: {
          required: true,
          fileTypeRestrictions: ['.zip'],
          maxFileSizeMb: 10, // 10 MB limit
        },
      };

      // 15 MB file (exceeds 10 MB)
      const oversized = { name: 'archive.zip', sizeBytes: 15 * 1024 * 1024 };
      const err = formValidationService.validateFieldValue(fileField, oversized);
      expect(err).toContain('exceeds the maximum allowed file size of 10 MB');

      // 8 MB file (acceptable)
      const withinLimit = { name: 'archive.zip', sizeBytes: 8 * 1024 * 1024 };
      expect(formValidationService.validateFieldValue(fileField, withinLimit)).toBeNull();
    });

    it('validates GitHub repository URLs and video links', () => {
      const githubField: SubmissionFormField = {
        id: 'github',
        type: 'GITHUB_URL',
        label: 'GitHub Codebase',
        required: true,
        order: 1,
        visibility: 'PUBLIC',
        validation: { required: true },
      };

      // Invalid GitHub URLs
      expect(formValidationService.validateFieldValue(githubField, 'not-a-url')).toContain('valid GitHub repository URL');
      expect(formValidationService.validateFieldValue(githubField, 'https://gitlab.com/owner/repo')).toContain('valid GitHub repository URL');

      // Valid GitHub URLs
      expect(formValidationService.validateFieldValue(githubField, 'https://github.com/SK-Sathyavada-008/Proofly')).toBeNull();
      expect(formValidationService.validateFieldValue(githubField, 'http://www.github.com/facebook/react/tree/main')).toBeNull();
    });

    it('validates Team Member Repeater entries', () => {
      const teamField: SubmissionFormField = {
        id: 'team',
        type: 'TEAM_MEMBER_REPEATER',
        label: 'Team Roster',
        required: true,
        order: 1,
        visibility: 'PUBLIC',
        validation: {
          required: true,
          minMembers: 2,
          maxMembers: 4,
        },
      };

      // Less than minMembers
      const singleMember = [{ fullName: 'Alice', email: 'alice@example.com' }];
      const tooFewErr = formValidationService.validateFieldValue(teamField, singleMember);
      expect(tooFewErr).toContain('At least 2 team member(s) required');

      // Invalid email within member entry
      const badEmailMembers = [
        { fullName: 'Alice', email: 'alice@example.com' },
        { fullName: 'Bob', email: 'not-an-email' },
      ];
      const badEmailErr = formValidationService.validateFieldValue(teamField, badEmailMembers);
      expect(badEmailErr).toContain('must have a valid email address');

      // Valid team of 2
      const validTeam = [
        { fullName: 'Alice', email: 'alice@example.com' },
        { fullName: 'Bob', email: 'bob@example.com' },
      ];
      expect(formValidationService.validateFieldValue(teamField, validTeam)).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // 2. Access Management & Security Tests
  // ─────────────────────────────────────────────

  describe('2. Access Management & Security Scoping', () => {
    it('allows access with a valid public competition access code', async () => {
      const activeComp = SEED_COMPETITIONS.find((c) => c.id === activeCompetitionId)!;
      await accessManagementService.getOrCreatePublicAccessKey(activeCompetitionId, activeComp.publicAccessCode);

      const validation = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        activeComp.publicAccessCode
      );

      expect(validation.valid).toBe(true);
      expect(validation.session).toBeDefined();
      expect(validation.session?.competitionId).toBe(activeCompetitionId);
      expect(validation.session?.scopeType).toBe('PUBLIC_LINK');
      expect(validation.formSchema).toBeDefined();
      expect(validation.accessKey?.tokenHash).toBeUndefined(); // Never exposed to client
    });

    it('rejects an invalid or non-existent access code', async () => {
      const validation = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        'PF-WRONG-CODE-999'
      );

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Invalid access code or submission token');
      expect(validation.session).toBeUndefined();
    });

    it('generates unique individual links and stores ONLY the SHA-256 hash (never raw token)', async () => {
      const generated = await accessManagementService.generateIndividualLink(activeCompetitionId, {
        email: 'invited.team@stanford.edu',
        teamName: 'Stanford BioEdge',
        maxSubmissions: 1,
      });

      expect(generated.rawToken).toBeDefined();
      expect(generated.rawToken.length).toBeGreaterThanOrEqual(64); // 32 bytes hex = 64 chars
      expect(generated.directSubmissionUrl).toContain(generated.rawToken);

      // Verify the stored record in database
      const storedKey = await accessManagementService.getAccessKey(generated.accessKey.id);
      expect(storedKey).toBeDefined();

      // Raw token must NEVER match stored fields
      expect(storedKey?.code).not.toContain(generated.rawToken);
      expect((storedKey as any).rawToken).toBeUndefined();

      // Stored tokenHash must equal SHA-256 of rawToken
      const expectedHash = await sha256Hash(generated.rawToken);
      expect(storedKey?.tokenHash).toBe(expectedHash);

      // Validate access using rawToken
      const validation = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        generated.rawToken
      );

      expect(validation.valid).toBe(true);
      expect(validation.session?.participantEmail).toBe('invited.team@stanford.edu');
      expect(validation.session?.teamName).toBe('Stanford BioEdge');
    });

    it('rejects revoked access keys immediately', async () => {
      const generated = await accessManagementService.generateIndividualLink(activeCompetitionId, {
        email: 'revoked.user@example.com',
      });

      // Revoke the key
      await accessManagementService.revokeAccessKey(generated.accessKey.id);

      // Attempt to access with the revoked token
      const validation = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        generated.rawToken
      );

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('has been revoked by the organizer');
    });

    it('rejects expired submission links', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago

      const generated = await accessManagementService.generateIndividualLink(activeCompetitionId, {
        email: 'late.user@example.com',
        expiresAt: pastDate,
      });

      const validation = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        generated.rawToken,
        new Date() // Current time
      );

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('expired on');
    });

    it('enforces submission limits on access keys', async () => {
      const generated = await accessManagementService.generateIndividualLink(activeCompetitionId, {
        email: 'single.use@example.com',
        maxSubmissions: 1, // Single-use cap
      });

      // First check passes
      const firstCheck = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        generated.rawToken
      );
      expect(firstCheck.valid).toBe(true);

      // Simulate a submission completing
      await accessManagementService.recordSubmissionUsage(generated.accessKey.id);

      // Second check must be rejected due to limit
      const secondCheck = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        generated.rawToken
      );
      expect(secondCheck.valid).toBe(false);
      expect(secondCheck.reason).toContain('Submission limit reached for this link (maximum 1 allowed)');
    });

    it('regenerates competition public access codes, invalidating previous code', async () => {
      const original = await accessManagementService.getOrCreatePublicAccessKey(activeCompetitionId, 'PF-ORIGINAL');
      expect(original.code).toBe('PF-ORIGINAL');

      // Regenerate code
      const regenerated = await accessManagementService.regenerateAccessCode(activeCompetitionId);
      expect(regenerated.code).not.toBe('PF-ORIGINAL');
      expect(regenerated.code.startsWith('PF-')).toBe(true);

      // Old code is now rejected
      const oldCheck = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        'PF-ORIGINAL'
      );
      expect(oldCheck.valid).toBe(false);

      // New code is accepted
      const newCheck = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        regenerated.code
      );
      expect(newCheck.valid).toBe(true);
    });

    it('issues ephemeral short-lived session tokens that expire after TTL', async () => {
      const generated = await accessManagementService.generateIndividualLink(activeCompetitionId, {});
      const now = new Date('2026-11-15T10:00:00.000Z');

      const validation = await accessManagementService.validateAccessAndCreateSession(
        activeCompetitionId,
        generated.rawToken,
        now
      );

      expect(validation.valid).toBe(true);
      const sessionToken = validation.session!.sessionToken;

      // Session valid within TTL (10 minutes later)
      const tenMinsLater = new Date('2026-11-15T10:10:00.000Z');
      expect(accessManagementService.verifySession(sessionToken, tenMinsLater)).not.toBeNull();

      // Session expired after 30-min TTL (45 minutes later)
      const fortyFiveMinsLater = new Date('2026-11-15T10:45:00.000Z');
      expect(accessManagementService.verifySession(sessionToken, fortyFiveMinsLater)).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // 3. Multi-Round & Form Schema Customization Tests
  // ─────────────────────────────────────────────

  describe('3. Form Customization Across Competitions and Rounds', () => {
    it('allows organizers to configure different form schemas for different rounds', async () => {
      const round1Fields: SubmissionFormField[] = [
        {
          id: 'f-pitch',
          type: 'LONG_TEXT',
          label: 'Executive Summary',
          required: true,
          order: 1,
          visibility: 'PUBLIC',
          validation: { required: true, minLength: 20 },
        },
      ];

      const round2Fields: SubmissionFormField[] = [
        {
          id: 'f-final-pdf',
          type: 'FILE_UPLOAD',
          label: 'Final Manuscript (PDF)',
          required: true,
          order: 1,
          visibility: 'PUBLIC',
          validation: { required: true, fileTypeRestrictions: ['.pdf'] },
        },
        {
          id: 'f-video',
          type: 'VIDEO_URL',
          label: 'Final Presentation Recording',
          required: true,
          order: 2,
          visibility: 'PUBLIC',
          validation: { required: true },
        },
      ];

      // Save Round 1 Schema
      const r1Schema = await formBuilderService.saveFormSchema(
        activeCompetitionId,
        'Preliminary Screening Form',
        round1Fields,
        'round-1'
      );

      // Save Round 2 Schema
      const r2Schema = await formBuilderService.saveFormSchema(
        activeCompetitionId,
        'Final Evaluation Form',
        round2Fields,
        'round-2'
      );

      // Verify Round 1 returns Round 1 fields
      const fetchedR1 = await formBuilderService.getFormSchema(activeCompetitionId, 'round-1');
      expect(fetchedR1.id).toBe(r1Schema.id);
      expect(fetchedR1.fields.length).toBe(1);
      expect(fetchedR1.fields[0].id).toBe('f-pitch');

      // Verify Round 2 returns Round 2 fields
      const fetchedR2 = await formBuilderService.getFormSchema(activeCompetitionId, 'round-2');
      expect(fetchedR2.id).toBe(r2Schema.id);
      expect(fetchedR2.fields.length).toBe(2);
      expect(fetchedR2.fields[0].id).toBe('f-final-pdf');
    });
  });
});
