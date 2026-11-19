// ─────────────────────────────────────────────
// multiFileUploadAndJudgeSelection.test.ts
// Tests for Multi-File Participant Uploads & Judge Competition Selection
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { fileStorageService, StorageUploadError } from '../fileStorageService';
import { sha256Bytes } from '../../utils/cryptoUtils';
import { submissionService } from '../submissionService';
import { competitionService } from '../competitionService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { SEED_SUBMISSIONS } from '../seedDataService';
import type { ProjectSubmission } from '../../types/submission';
import type { Competition } from '../../types/authAndCompetition';

describe('Multi-File Upload & Judge Competition Queue Switching', () => {
  beforeEach(() => {
    submissionService.resetInMemoryStore(SEED_SUBMISSIONS);
  });

  describe('1. Batch Multi-File Validation, Canonical Paths & No Mock Upload Success', () => {
    it('validates multiple diverse official formats (PDF, ZIP, PNG, JSON), computes distinct full-file SHA-256 hashes, and refuses mock upload when Storage is unavailable', async () => {
      // 1. PDF bytes (%PDF-)
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
      // 2. ZIP bytes (PK\x03\x04)
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
      // 3. PNG bytes (\x89PNG\r\n\x1a\n)
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // 4. JSON / text bytes
      const jsonBytes = new TextEncoder().encode('{"name": "krivee-project", "version": "1.0.0"}');

      const filesToUpload = [
        { name: 'architecture_diagram.png', size: pngBytes.length, bytes: pngBytes },
        { name: 'pitch_deck.pdf', size: pdfBytes.length, bytes: pdfBytes },
        { name: 'source_code.zip', size: zipBytes.length, bytes: zipBytes },
        { name: 'config.json', size: jsonBytes.length, bytes: jsonBytes },
      ];

      const allowedExtensions = ['.pdf', '.ppt', '.pptx', '.zip', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md', '.json'];

      const hashes = new Set<string>();
      for (let i = 0; i < filesToUpload.length; i++) {
        const item = filesToUpload[i];
        const validation = await fileStorageService.validateFile(item, {
          allowedExtensions,
          maxSizeMb: 25,
          strictStorageFormats: true,
        });
        expect(validation.valid).toBe(true);

        const hash = await sha256Bytes(item.bytes);
        expect(hash).toHaveLength(64);
        hashes.add(hash);

        const canonicalPath = fileStorageService.buildCanonicalStoragePath({
          organizationId: 'org-krivee',
          competitionId: 'comp-krivee',
          submissionId: `sub_krivee_${i}`,
          fileId: `file_${i}`,
          sanitizedFileName: fileStorageService.sanitizeFileName(item.name),
        });
        expect(canonicalPath).toBe(
          `organizations/org-krivee/competitions/comp-krivee/submissions/sub_krivee_${i}/file_${i}_${item.name}`
        );

        // Without live Firebase Storage / Emulator, uploadFile MUST fail cleanly (no mock success!)
        await expect(
          fileStorageService.uploadFile(item as any, {
            fieldId: 'artifact_files',
            organizationId: 'org-krivee',
            competitionId: 'comp-krivee',
            submissionId: `sub_krivee_${i}`,
            uploaderUid: 'uid-participant-1',
            allowedExtensions,
            maxSizeMb: 25,
          })
        ).rejects.toThrow(StorageUploadError);
      }

      expect(hashes.size).toBe(4);
    });

    it('rejects malicious executables and unsupported formats cleanly during validation', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
      // Windows executable bytes (MZ)
      const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

      const validPdf = await fileStorageService.validateFile(
        { name: 'valid_report.pdf', size: pdfBytes.length, bytes: pdfBytes },
        { allowedExtensions: ['.pdf', '.zip'], maxSizeMb: 25, strictStorageFormats: true }
      );
      expect(validPdf.valid).toBe(true);

      const badExe = await fileStorageService.validateFile(
        { name: 'malicious_tool.exe', size: exeBytes.length, bytes: exeBytes },
        { allowedExtensions: ['.pdf', '.zip'], maxSizeMb: 25, strictStorageFormats: true }
      );
      expect(badExe.valid).toBe(false);
      expect(badExe.error).toContain('Executable file extensions are strictly prohibited');
    });
  });

  describe('2. Judge Hackathon / Competition Selection & Filtering', () => {
    it('allows listing submissions across all competitions or filtered by specific competition (e.g. krivee)', async () => {
      // Create user hackathon "krivee"
      const kriveeCompetitionData: Partial<Competition> = {
        title: 'Krivee Hackathon 2026',
        tagline: 'Next-gen intelligence and autonomous agent systems',
        description: 'Next-gen intelligence and autonomous agent systems',
        type: 'HACKATHON',
        tracks: ['Full-Stack AI', 'Autonomous Agents'],
      };

      const createdComp = await competitionService.createCompetition(
        'org-krivee',
        'user-krivee-org',
        'organizer@krivee.io',
        'Krivee Organizer',
        kriveeCompetitionData
      );

      // Create a submission specifically for the krivee hackathon
      const kriveeSubmission: ProjectSubmission = {
        id: 'sub-krivee-001',
        referenceId: 'REF-KRIVEE-100',
        competitionId: createdComp.id,
        organizationId: 'org-krivee',
        formSchemaId: 'schema-krivee',
        submissionType: 'TEAM',
        teamName: 'Krivee Innovators',
        primaryContactName: 'Krivee Lead',
        primaryContactEmail: 'lead@krivee.io',
        participants: [
          {
            id: 'part-1',
            competitionId: createdComp.id,
            organizationId: 'org-krivee',
            name: 'Krivee Lead',
            email: 'lead@krivee.io',
            isLead: true,
            source: 'FORM_SUBMISSION',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'part-2',
            competitionId: createdComp.id,
            organizationId: 'org-krivee',
            name: 'Krivee Dev',
            email: 'dev@krivee.io',
            isLead: false,
            source: 'FORM_SUBMISSION',
            createdAt: new Date().toISOString(),
          },
        ],
        projectTitle: 'Krivee Autonomous Assistant',
        projectDescription: 'End-to-end autonomous evaluation workflow system.',
        technologiesUsed: ['React', 'Firebase AI', 'TypeScript'],
        status: 'Ready for Judge Review',
        currentVersion: 1,
        versions: [],
        isLate: false,
        isLocked: false,
        fieldValues: {},
        files: [],
        statusHistory: [],
        submittedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        managementTokenHash: 'hash_123',
        managementTokenPrefix: 'sec_12',
      };

      await submissionService.saveSubmission(kriveeSubmission);

      // 1. Test "ALL" Hackathons filter: should return both seed submissions and krivee submission
      const allSubmissions = await submissionService.listAllSubmissions();
      expect(allSubmissions.some((s) => s.id === 'sub-krivee-001')).toBe(true);
      expect(allSubmissions.length).toBeGreaterThan(SEED_SUBMISSIONS.length);

      // 2. Test specific Hackathon filter: should ONLY return submissions for createdComp.id
      const kriveeSubmissions = await submissionService.listCompetitionSubmissions(createdComp.id);
      expect(kriveeSubmissions).toHaveLength(1);
      expect(kriveeSubmissions[0].id).toBe('sub-krivee-001');
      expect(kriveeSubmissions[0].projectTitle).toBe('Krivee Autonomous Assistant');

      // 3. Test listing all competitions includes the created "Krivee Hackathon 2026"
      const allCompetitions = await competitionService.listAllCompetitions();
      expect(allCompetitions.some((c) => c.id === createdComp.id)).toBe(true);
      expect(allCompetitions.find((c) => c.id === createdComp.id)?.title).toBe('Krivee Hackathon 2026');
    });

    it('identifies submissions awaiting AI evaluation before judge review', async () => {
      const queuedSub: ProjectSubmission = {
        id: 'sub-queued-ai',
        referenceId: 'REF-QUEUED-001',
        competitionId: 'comp-krivee-custom',
        organizationId: 'org-krivee',
        formSchemaId: 'schema-krivee',
        submissionType: 'INDIVIDUAL',
        primaryContactName: 'Solo Dev',
        participants: [
          {
            id: 'part-solo',
            competitionId: 'comp-krivee-custom',
            organizationId: 'org-krivee',
            name: 'Solo Dev',
            isLead: true,
            source: 'FORM_SUBMISSION',
            createdAt: new Date().toISOString(),
          },
        ],
        projectTitle: 'Pending AI Project',
        projectDescription: 'Project currently waiting for AI analysis.',
        technologiesUsed: ['AI Logic'],
        status: 'Queued for AI Evaluation',
        currentVersion: 1,
        versions: [],
        isLate: false,
        isLocked: false,
        fieldValues: {},
        files: [],
        statusHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        managementTokenHash: 'hash_queued',
        managementTokenPrefix: 'sec_qu',
      };

      await submissionService.saveSubmission(queuedSub);

      const kriveeSubs = await submissionService.listCompetitionSubmissions('comp-krivee-custom');
      const queuedList = kriveeSubs.filter((s) => s.status === 'Queued for AI Evaluation');
      expect(queuedList).toHaveLength(1);
      expect(queuedList[0].id).toBe('sub-queued-ai');
    });

    it('executes high-speed batch AI evaluation on multiple selected projects concurrently', async () => {
      const batchProjects: ProjectSubmission[] = [1, 2, 3].map((num) => ({
        id: `sub-batch-${num}`,
        referenceId: `REF-BATCH-00${num}`,
        competitionId: 'comp-krivee-custom',
        organizationId: 'org-krivee',
        formSchemaId: 'schema-krivee',
        submissionType: 'INDIVIDUAL',
        primaryContactName: `Dev ${num}`,
        projectTitle: `Batch Project ${num}`,
        projectDescription: `Comprehensive overview for batch submission number ${num}.`,
        problemStatement: `Problem addressed by batch project ${num}.`,
        solution: `Technical solution implemented for batch project ${num}.`,
        technologiesUsed: ['React', 'Firebase AI', 'Node.js'],
        status: 'Queued for AI Evaluation',
        currentVersion: 1,
        versions: [],
        isLate: false,
        isLocked: false,
        fieldValues: {},
        files: [],
        statusHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        managementTokenHash: `hash_batch_${num}`,
        managementTokenPrefix: 'sec_ba',
        participants: [
          {
            id: `part-b-${num}`,
            competitionId: 'comp-krivee-custom',
            organizationId: 'org-krivee',
            name: `Dev ${num}`,
            isLead: true,
            source: 'FORM_SUBMISSION',
            createdAt: new Date().toISOString(),
          },
        ],
      }));

      for (const p of batchProjects) {
        await submissionService.saveSubmission(p);
      }

      // Simulate Batch Execution
      const startTime = performance.now();
      const results = await Promise.all(
        batchProjects.map((sub) => evaluationPipelineService.executePipeline(sub))
      );
      const durationMs = performance.now() - startTime;

      // High-speed verification: 3 concurrent evaluations must complete rapidly
      expect(durationMs).toBeLessThan(10000);
      expect(results).toHaveLength(3);

      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.report).toBeDefined();
        expect(res.report?.overallScore).toBeGreaterThan(0);
        expect(res.submission.status).toBe('Ready for Judge Review');
        expect(res.submission.aiScore).toBeDefined();
      }
    });
  });
});
