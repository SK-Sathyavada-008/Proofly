// ─────────────────────────────────────────────
// multiFileUploadAndJudgeSelection.test.ts
// Tests for Multi-File Participant Uploads & Judge Competition Selection
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { fileStorageService } from '../fileStorageService';
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

  describe('1. Batch Multi-File Upload & Magic-Byte Validation', () => {
    it('successfully uploads multiple diverse files (PDF, ZIP, PPTX, JSON, PNG) in batch', async () => {
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

      const allowedExtensions = [
        '.pdf', '.ppt', '.pptx', '.doc', '.docx', '.zip', '.tar', '.gz',
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json',
      ];

      const uploadedResults = [];
      const errors: string[] = [];

      for (let i = 0; i < filesToUpload.length; i++) {
        const item = filesToUpload[i];
        try {
          const validation = await fileStorageService.validateFile(item, {
            allowedExtensions,
            maxSizeMb: 50,
          });
          expect(validation.valid).toBe(true);

          const metadata = await fileStorageService.uploadFile(item as any, {
            fieldId: 'artifact_files',
            competitionId: 'comp-krivee',
            submissionId: `sub_krivee_${Date.now()}_${i}`,
            allowedExtensions,
            maxSizeMb: 50,
          });
          uploadedResults.push(metadata);
        } catch (err: any) {
          errors.push(err.message);
        }
      }

      expect(errors).toHaveLength(0);
      expect(uploadedResults).toHaveLength(4);
      expect(uploadedResults[0].fileName).toBe('architecture_diagram.png');
      expect(uploadedResults[1].fileName).toBe('pitch_deck.pdf');
      expect(uploadedResults[2].fileName).toBe('source_code.zip');
      expect(uploadedResults[3].fileName).toBe('config.json');

      // Verify each has distinct sha256 checksum and download URL
      const hashes = new Set(uploadedResults.map((u) => u.checksum));
      expect(hashes.size).toBe(4);
    });

    it('isolates invalid files during multi-file upload so valid files still succeed', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
      // Windows executable bytes (MZ)
      const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

      const files = [
        { name: 'valid_report.pdf', size: pdfBytes.length, bytes: pdfBytes },
        { name: 'malicious_tool.exe', size: exeBytes.length, bytes: exeBytes },
      ];

      const successfulFiles = [];
      const caughtErrors: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const metadata = await fileStorageService.uploadFile(file as any, {
            fieldId: 'artifact_files',
            competitionId: 'comp-krivee',
            submissionId: `sub_test_${i}`,
            allowedExtensions: ['.pdf', '.zip'],
            maxSizeMb: 25,
          });
          successfulFiles.push(metadata);
        } catch (err: any) {
          caughtErrors.push(`${file.name}: ${err.message}`);
        }
      }

      // Valid PDF succeeded
      expect(successfulFiles).toHaveLength(1);
      expect(successfulFiles[0].fileName).toBe('valid_report.pdf');

      // Malicious file was caught and rejected
      expect(caughtErrors).toHaveLength(1);
      expect(caughtErrors[0]).toContain('Executable file extensions are strictly prohibited');
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
