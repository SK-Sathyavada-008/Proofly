// ─────────────────────────────────────────────
// phase13SubmissionIntegrityAndProvenance.test.ts
// Unit & Integration Tests for Proofly Phase 13 — Submission Integrity & Provenance
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SubmissionIntegrityService,
} from '../submissionIntegrityService';
import { submissionService } from '../submissionService';
import { governanceAuditService } from '../governanceAuditService';
import { sha256Bytes } from '../../utils/cryptoUtils';
import type { ProjectSubmission, StoredFileMetadata } from '../../types/submission';

describe('Proofly Phase 13 — Submission Integrity and Provenance', () => {
  let service: SubmissionIntegrityService;

  beforeEach(() => {
    service = new SubmissionIntegrityService();
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. REPOSITORY SNAPSHOTS & EXACT COMMIT EVALUATION PROVENANCE
  // ─────────────────────────────────────────────────────────────────
  describe('1. Repository Snapshots & Provenance', () => {
    it('captures complete repository snapshot with identity, owner, branch, commit and files inspected', async () => {
      const repoUrl = 'https://github.com/omnitrack/omnitrack-sentinel';

      const snapshot = await service.captureRepositorySnapshot(repoUrl);

      expect(snapshot.repositoryIdentity).toBe('omnitrack/omnitrack-sentinel');
      expect(snapshot.owner).toBe('omnitrack');
      expect(snapshot.repoName).toBe('omnitrack-sentinel');
      expect(snapshot.defaultBranch).toBe('main');
      expect(snapshot.commitSha).toBe('c8f1a23e90b4d1872f567890abcdef1234567890');
      expect(snapshot.visibility).toBe('PUBLIC');
      expect(snapshot.accessMethod).toBe('FIXTURE_EVALUATION');
      expect(snapshot.inspectedFileCount).toBe(5);
      expect(snapshot.isPartialInspection).toBe(true);
      expect(snapshot.filesInspected.some((f) => f.path === 'package.json')).toBe(true);
    });

    it('uses exact pinned commit SHA as evaluation reference rather than a moving branch ref', async () => {
      const repoUrl = 'https://github.com/greentransit/ecoroute-cli';
      const pinnedCommit = 'abcdef1234567890abcdef1234567890abcdef12';

      const snapshot = await service.captureRepositorySnapshot(repoUrl, {
        pinnedCommitSha: pinnedCommit,
      });

      expect(snapshot.commitSha).toBe(pinnedCommit);
      expect(snapshot.isMovingBranchWarning).toBe(false);
    });

    it('warns when a moving branch is evaluated without a locked commit SHA', async () => {
      const repoUrl = 'https://github.com/greentransit/ecoroute-cli';

      const snapshot = await service.captureRepositorySnapshot(repoUrl);

      // Warning raised because no commit SHA was explicitly pinned up front
      expect(snapshot.isMovingBranchWarning).toBe(true);
      expect(snapshot.commitSha.length).toBe(40);
    });

    it('handles private repositories without leaking private metadata or crashing', async () => {
      const privateRepoUrl = 'https://github.com/stealth-corp/private-stealth-ai';

      const snapshot = await service.captureRepositorySnapshot(privateRepoUrl);

      expect(snapshot.visibility).toBe('PRIVATE');
      expect(snapshot.filesInspected).toHaveLength(0);
      expect(snapshot.isPartialInspection).toBe(true);
    });

    it('handles deleted or 404 repositories gracefully', async () => {
      const missingRepoUrl = 'https://github.com/deleted-org/not-found-project';

      const snapshot = await service.captureRepositorySnapshot(missingRepoUrl);

      expect(snapshot.commitSha).toBe('0000000000000000000000000000000000000000');
      expect(snapshot.inspectedFileCount).toBe(0);
    });

    it('handles unavailable network access by falling back to honest partial inspection', async () => {
      const customFetch = vi.fn().mockRejectedValue(new Error('Network connection timeout (offline sandbox)'));
      const repoUrl = 'https://github.com/offline-team/offline-project';

      const snapshot = await service.captureRepositorySnapshot(repoUrl, {
        fetchFn: customFetch,
      });

      expect(snapshot.inspectedFileCount).toBe(0);
      expect(snapshot.isPartialInspection).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. POST-DEADLINE CHANGE COMPARISON
  // ─────────────────────────────────────────────────────────────────
  describe('2. Post-Deadline Change Detection', () => {
    it('detects commits made after the deadline and lists changed files', async () => {
      const repoUrl = 'https://github.com/omnitrack/omnitrack-sentinel';
      const submittedSha = 'submitted-sha-123';
      const deadline = '2026-11-18T23:59:59Z'; // Commits on Nov 20 are after deadline

      const comparison = await service.comparePostDeadlineChanges(
        repoUrl,
        submittedSha,
        deadline
      );

      expect(comparison.hasPostDeadlineCommits).toBe(true);
      expect(comparison.postDeadlineCommitCount).toBe(1);
      expect(comparison.postDeadlineCommits[0].sha).toContain('late-sha');
      expect(comparison.changedFilesCount).toBe(1);
      expect(comparison.changedFiles[0].filename).toBe('README.md');
      expect(comparison.organizerAdvisoryNote).toContain(
        'automatically assumed to be misconduct'
      );
    });

    it('correctly reports no post-deadline changes when all activity occurred before deadline', async () => {
      const repoUrl = 'https://github.com/greentransit/ecoroute-cli';
      const submittedSha = '7b92c41d8e1234567890abcdef1234567890abcd';
      const deadline = '2026-11-25T00:00:00Z'; // Deadline in future

      const comparison = await service.comparePostDeadlineChanges(
        repoUrl,
        submittedSha,
        deadline
      );

      expect(comparison.hasPostDeadlineCommits).toBe(false);
      expect(comparison.postDeadlineCommitCount).toBe(0);
      expect(comparison.changedFilesCount).toBe(0);
    });

    it('distinguishes between commits made before and after deadline', async () => {
      const deadline = '2026-11-18T12:00:00Z';

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/commits')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  sha: 'sha-late',
                  commit: {
                    author: { name: 'Dev', date: '2026-11-19T10:00:00Z' },
                    message: 'feat: added post-deadline telemetry',
                  },
                },
                {
                  sha: 'sha-on-time',
                  commit: {
                    author: { name: 'Dev', date: '2026-11-17T15:00:00Z' },
                    message: 'chore: initial submission build',
                  },
                },
              ]),
          });
        }
        if (url.includes('/compare')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                files: [{ filename: 'src/telemetry.ts', status: 'added', additions: 45 }],
              }),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      const comp = await service.comparePostDeadlineChanges(
        'https://github.com/custom/repo',
        'sha-on-time',
        deadline,
        { fetchFn: mockFetch }
      );

      expect(comp.hasPostDeadlineCommits).toBe(true);
      expect(comp.postDeadlineCommitCount).toBe(1);
      expect(comp.postDeadlineCommits[0].sha).toBe('sha-late');
      expect(comp.changedFiles).toHaveLength(1);
      expect(comp.changedFiles[0].filename).toBe('src/telemetry.ts');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. ARTIFACT INTEGRITY & SHA-256 HASH VERIFICATION
  // ─────────────────────────────────────────────────────────────────
  describe('3. Artifact Integrity & SHA-256 Verification', () => {
    it('computes authentic SHA-256 binary hash digests for uploaded files', async () => {
      const content = new TextEncoder().encode('Proofly Submission Whitepaper — Architecture & Design');
      const expectedSha256 = await sha256Bytes(content);

      const file: StoredFileMetadata = {
        id: 'file-doc-1',
        fieldId: 'whitepaper',
        fileName: 'whitepaper.pdf',
        originalFileName: 'My Whitepaper v1.pdf',
        fileSize: content.byteLength,
        mimeType: 'application/pdf',
        storagePath: 'competitions/c1/submissions/s1/file-doc-1.pdf',
        downloadUrl: '',
        uploadedAt: '2026-11-18T10:00:00Z',
        isVerified: true,
      };

      const record = await service.recordArtifactIntegrity(file, content);

      expect(record.originalSha256).toBe(expectedSha256);
      expect(record.fileSize).toBe(content.byteLength);
      expect(record.isVerified).toBe(true);
      expect(record.versionHistory).toHaveLength(1);
      expect(record.versionHistory[0].versionNumber).toBe(1);
      expect(record.isTamperedOrModified).toBe(false);
    });

    it('detects altered or replaced artifacts and maintains full replacement audit trail', async () => {
      const originalBytes = new TextEncoder().encode('Original Slide Deck v1');
      const modifiedBytes = new TextEncoder().encode('Modified Slide Deck v2 — Content changed');

      const originalFile: StoredFileMetadata = {
        id: 'file-deck',
        fieldId: 'pitch_deck',
        fileName: 'deck.pptx',
        fileSize: originalBytes.byteLength,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        storagePath: 'competitions/c1/submissions/s1/deck.pptx',
        downloadUrl: '',
        uploadedAt: '2026-11-18T10:00:00Z',
        isVerified: true,
      };

      // 1. Initial record
      const initialRecord = await service.recordArtifactIntegrity(originalFile, originalBytes);
      expect(initialRecord.versionHistory).toHaveLength(1);
      expect(initialRecord.isTamperedOrModified).toBe(false);

      // 2. Replaced file with different bytes
      const updatedFile: StoredFileMetadata = {
        ...originalFile,
        fileSize: modifiedBytes.byteLength,
        uploadedAt: '2026-11-19T14:00:00Z',
      };

      const updatedRecord = await service.recordArtifactIntegrity(
        updatedFile,
        modifiedBytes,
        initialRecord,
        'Updated slides to add architecture diagram'
      );

      expect(updatedRecord.isTamperedOrModified).toBe(true);
      expect(updatedRecord.replacementHistory).toHaveLength(1);
      expect(updatedRecord.replacementHistory[0].previousSha256).toBe(initialRecord.originalSha256);
      expect(updatedRecord.replacementHistory[0].newSha256).toBe(updatedRecord.originalSha256);
      expect(updatedRecord.replacementHistory[0].reason).toContain('add architecture diagram');
      expect(updatedRecord.versionHistory).toHaveLength(2);
      expect(updatedRecord.versionHistory[1].versionNumber).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. DUPLICATE & SIMILARITY DETECTION
  // ─────────────────────────────────────────────────────────────────
  describe('4. Duplicate & Plagiarism Review Detection', () => {
    it('detects duplicate submissions with exact matching artifact SHA-256 hashes', () => {
      const sharedHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

      const targetSubmission: ProjectSubmission = {
        id: 'sub-target',
        referenceId: 'PF-SUB-2026-TARGET',
        competitionId: 'comp-dup-check',
        organizationId: 'org-1',
        formSchemaId: 'form-1',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Dave Submitter',
        projectTitle: 'Smart Solar Grid Controller',
        projectDescription: 'Distributed IoT edge controller for PV optimization.',
        technologiesUsed: ['Rust', 'MQTT', 'WebAssembly'],
        files: [
          {
            id: 'file-1',
            fieldId: 'doc',
            fileName: 'paper.pdf',
            fileSize: 45000,
            mimeType: 'application/pdf',
            storagePath: '',
            downloadUrl: '',
            uploadedAt: '2026-11-18T10:00:00Z',
            checksum: sharedHash,
            isVerified: true,
          },
        ],
        fieldValues: {},
        status: 'Submitted',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: '',
        managementTokenPrefix: '',
        createdAt: '2026-11-18T10:00:00Z',
        updatedAt: '2026-11-18T10:00:00Z',
      };

      const conflictingSubmission: ProjectSubmission = {
        ...targetSubmission,
        id: 'sub-conflicting',
        referenceId: 'PF-SUB-2026-OTHER',
        primaryContactName: 'Eve Clone',
        projectTitle: 'Solar Controller IoT Project',
        files: [
          {
            id: 'file-2',
            fieldId: 'doc',
            fileName: 'paper_copy.pdf',
            fileSize: 45000,
            mimeType: 'application/pdf',
            storagePath: '',
            downloadUrl: '',
            uploadedAt: '2026-11-18T11:00:00Z',
            checksum: sharedHash, // EXACT SAME HASH!
            isVerified: true,
          },
        ],
      };

      const duplicates = service.detectDuplicateSubmissions(targetSubmission, [
        targetSubmission,
        conflictingSubmission,
      ]);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].matchType).toBe('EXACT_ARTIFACT_HASH');
      expect(duplicates[0].confidenceScore).toBe(95);
      expect(duplicates[0].matchedReferenceId).toBe('PF-SUB-2026-OTHER');
      expect(duplicates[0].humanReviewNotice).toContain(
        'Flagged strictly for human organizer review. Do not interpret similarity as an automated plagiarism verdict.'
      );
    });

    it('detects multiple submissions using the exact same GitHub repository', () => {
      const sharedGhUrl = 'https://github.com/shared-team/collab-project';

      const sub1: ProjectSubmission = {
        id: 'sub-1',
        referenceId: 'PF-SUB-2026-AAA',
        competitionId: 'comp-gh-dup',
        organizationId: 'org-1',
        formSchemaId: 'form-1',
        submissionType: 'TEAM',
        teamName: 'Alpha Squad',
        participants: [],
        primaryContactName: 'Alice',
        projectTitle: 'Health Pulse AI',
        projectDescription: 'Cardio pulse diagnostic pipeline.',
        technologiesUsed: ['Python', 'PyTorch'],
        githubUrl: sharedGhUrl,
        fieldValues: {},
        files: [],
        status: 'Submitted',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: '',
        managementTokenPrefix: '',
        createdAt: '2026-11-18T10:00:00Z',
        updatedAt: '2026-11-18T10:00:00Z',
      };

      const sub2: ProjectSubmission = {
        ...sub1,
        id: 'sub-2',
        referenceId: 'PF-SUB-2026-BBB',
        teamName: 'Beta Squad',
        primaryContactName: 'Bob',
        githubUrl: sharedGhUrl, // SAME REPO URL!
      };

      const duplicates = service.detectDuplicateSubmissions(sub1, [sub1, sub2]);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].matchType).toBe('SHARED_REPOSITORY');
      expect(duplicates[0].confidenceScore).toBe(90);
      expect(duplicates[0].matchedReferenceId).toBe('PF-SUB-2026-BBB');
    });

    it('treats text similarity as an informational flag for human review without automated plagiarism verdicts', () => {
      const sub1: ProjectSubmission = {
        id: 'sub-text-1',
        referenceId: 'PF-SUB-2026-ORIG',
        competitionId: 'comp-sim',
        organizationId: 'org-1',
        formSchemaId: 'form-1',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Author 1',
        projectTitle: 'Decentralized Autonomous Water Desalination Controller',
        projectDescription:
          'Automated reverse osmosis membrane pressure regulation with predictive salinity gradient tracking.',
        technologiesUsed: ['Rust', 'Solana', 'IoT', 'Sensors'],
        fieldValues: {},
        files: [],
        status: 'Submitted',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: '',
        managementTokenPrefix: '',
        createdAt: '2026-11-18T10:00:00Z',
        updatedAt: '2026-11-18T10:00:00Z',
      };

      const sub2: ProjectSubmission = {
        ...sub1,
        id: 'sub-text-2',
        referenceId: 'PF-SUB-2026-COPY',
        primaryContactName: 'Author 2',
        projectTitle: 'Decentralized Autonomous Water Desalination Controller', // EXACT TITLE
        projectDescription:
          'Automated reverse osmosis membrane pressure regulation with predictive salinity gradient tracking.', // EXACT DESCRIPTION
      };

      const duplicates = service.detectDuplicateSubmissions(sub1, [sub1, sub2]);

      expect(duplicates.length).toBeGreaterThan(0);
      expect(duplicates[0].matchType).toBe('HIGH_SIMILARITY');
      expect(duplicates[0].humanReviewNotice).toContain(
        'Flagged strictly for human organizer review'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. COMPREHENSIVE INTEGRITY REPORT & ADMINISTRATIVE AUDIT
  // ─────────────────────────────────────────────────────────────────
  describe('5. Comprehensive Report & Administrative Actions', () => {
    it('generates a full integrity report combining snapshot, artifact hashes, and duplicate checks', async () => {
      const testSubmission: ProjectSubmission = {
        id: 'sub-report-demo',
        referenceId: 'PF-SUB-2026-REPORT',
        competitionId: 'comp-full-audit',
        organizationId: 'org-1',
        formSchemaId: 'form-1',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Frankie Lead',
        projectTitle: 'OmniTrack Sentinel',
        projectDescription: 'Edge ECG wasm inference protocol.',
        technologiesUsed: ['TypeScript', 'WebAssembly'],
        githubUrl: 'https://github.com/omnitrack/omnitrack-sentinel',
        fieldValues: {},
        files: [
          {
            id: 'file-report-1',
            fieldId: 'whitepaper',
            fileName: 'omnitrack_whitepaper.pdf',
            fileSize: 12000,
            mimeType: 'application/pdf',
            storagePath: 'competitions/c1/submissions/s1/omnitrack_whitepaper.pdf',
            downloadUrl: '',
            uploadedAt: '2026-11-18T10:00:00Z',
            checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            isVerified: true,
          },
        ],
        status: 'Submitted',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: '',
        managementTokenPrefix: '',
        createdAt: '2026-11-18T10:00:00Z',
        updatedAt: '2026-11-18T10:00:00Z',
      };

      // Mock submissionService.getSubmissionById
      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(testSubmission);

      const report = await service.generateIntegrityReport('sub-report-demo', {
        deadline: '2026-11-25T00:00:00Z',
        allCompetitionSubmissions: [testSubmission],
      });

      expect(report.id).toBe('integrity_sub-report-demo');
      expect(report.referenceId).toBe('PF-SUB-2026-REPORT');
      expect(report.status).toBe('VERIFIED_INTACT');
      expect(report.repositorySnapshot).toBeDefined();
      expect(report.repositorySnapshot?.commitSha).toBe('c8f1a23e90b4d1872f567890abcdef1234567890');
      expect(report.artifactIntegrityRecords).toHaveLength(1);
      expect(report.artifactIntegrityRecords[0].originalSha256).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
      expect(report.duplicateMatches).toHaveLength(0);
    });

    it('allows an organizer to dismiss a duplicate flag with documented justification and records audit trail', async () => {
      const testSubmission: ProjectSubmission = {
        id: 'sub-override-demo',
        referenceId: 'PF-SUB-2026-OVR',
        competitionId: 'comp-full-audit',
        organizationId: 'org-1',
        formSchemaId: 'form-1',
        submissionType: 'TEAM',
        teamName: 'Team Original',
        participants: [],
        primaryContactName: 'George',
        projectTitle: 'Carbon Offset Tracker',
        projectDescription: 'Verified carbon credits on distributed ledger.',
        technologiesUsed: ['Go'],
        fieldValues: {},
        files: [],
        status: 'Submitted',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: '',
        managementTokenPrefix: '',
        createdAt: '2026-11-18T10:00:00Z',
        updatedAt: '2026-11-18T10:00:00Z',
      };

      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(testSubmission);
      const auditSpy = vi.spyOn(governanceAuditService, 'recordEvent');

      // 1. Initial report with duplicate flag
      const report = await service.generateIntegrityReport('sub-override-demo', {
        allCompetitionSubmissions: [
          testSubmission,
          { ...testSubmission, id: 'sub-dup-2', referenceId: 'PF-SUB-2026-DUP2' },
        ],
      });

      expect(report.status).toBe('DUPLICATE_SUSPECTED');

      // 2. Organizer reviews and dismisses duplicate flag with documented justification
      const updatedReport = await service.dismissDuplicateFlag(
        'sub-override-demo',
        { id: 'admin-1', name: 'Lead Organizer' },
        'Reviewed with both teams. Team B is a spin-off with independent frontend architecture.'
      );

      expect(updatedReport.status).toBe('VERIFIED_INTACT');
      expect(updatedReport.administrativeActions).toHaveLength(1);
      expect(updatedReport.administrativeActions[0].action).toBe('DISMISS_DUPLICATE_FLAG');
      expect(updatedReport.administrativeActions[0].rationale).toContain('independent frontend architecture');

      // 3. Verifies governance audit trail was immutably recorded
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'ADMIN_OVERRIDE',
          action: 'DUPLICATE_FLAG_DISMISSED',
          actorName: 'Lead Organizer',
          reason: expect.stringContaining('independent frontend architecture'),
        })
      );
    });

    it('allows an organizer to accept post-deadline changes with recorded rationale', async () => {
      const testSubmission: ProjectSubmission = {
        id: 'sub-late-accept',
        referenceId: 'PF-SUB-2026-LATE',
        competitionId: 'comp-late',
        organizationId: 'org-1',
        formSchemaId: 'form-1',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Hannah',
        projectTitle: 'OmniTrack Sentinel',
        projectDescription: 'Edge inference protocol.',
        technologiesUsed: ['Rust'],
        githubUrl: 'https://github.com/omnitrack/omnitrack-sentinel',
        fieldValues: {},
        files: [],
        status: 'Submitted',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: '',
        managementTokenPrefix: '',
        createdAt: '2026-11-18T10:00:00Z',
        updatedAt: '2026-11-18T10:00:00Z',
      };

      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(testSubmission);
      const auditSpy = vi.spyOn(governanceAuditService, 'recordEvent');

      // Generate report with deadline set in past (triggering POST_DEADLINE_CHANGES)
      const report = await service.generateIntegrityReport('sub-late-accept', {
        deadline: '2026-11-18T00:00:00Z',
      });
      expect(report.status).toBe('POST_DEADLINE_CHANGES');

      // Organizer accepts late commit
      const updated = await service.acceptPostDeadlineChanges(
        'sub-late-accept',
        { id: 'admin-lead', name: 'Lead Organizer' },
        'Late commit was documentation-only (README fix) approved by organizing committee.'
      );

      expect(updated.status).toBe('VERIFIED_INTACT');
      expect(updated.administrativeActions).toHaveLength(1);
      expect(updated.administrativeActions[0].action).toBe('ACCEPT_POST_DEADLINE_CHANGES');

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'POST_DEADLINE_CHANGES_ACCEPTED',
          reason: expect.stringContaining('README fix'),
        })
      );
    });

    it('allows pinning a specific commit SHA to lock evaluation provenance against moving branch drift', async () => {
      const testSubmission: ProjectSubmission = {
        id: 'sub-pin-commit',
        referenceId: 'PF-SUB-2026-PIN',
        competitionId: 'comp-pin',
        organizationId: 'org-1',
        formSchemaId: 'form-1',
        submissionType: 'INDIVIDUAL',
        participants: [],
        primaryContactName: 'Ian',
        projectTitle: 'OmniTrack Sentinel',
        projectDescription: 'Edge inference protocol.',
        technologiesUsed: ['TypeScript'],
        githubUrl: 'https://github.com/omnitrack/omnitrack-sentinel',
        fieldValues: {},
        files: [],
        status: 'Submitted',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: '',
        managementTokenPrefix: '',
        createdAt: '2026-11-18T10:00:00Z',
        updatedAt: '2026-11-18T10:00:00Z',
      };

      vi.spyOn(submissionService, 'getSubmission').mockResolvedValue(testSubmission);

      await service.generateIntegrityReport('sub-pin-commit');
      const pinnedSha = '11223344556677889900aabbccddeeff00112233';

      const updated = await service.pinCommitSha(
        'sub-pin-commit',
        pinnedSha,
        { id: 'admin-lead', name: 'Lead Organizer' },
        'Locking commit SHA submitted on the official Google Form before repo rename.'
      );

      expect(updated.repositorySnapshot?.commitSha).toBe(pinnedSha);
      expect(updated.repositorySnapshot?.isMovingBranchWarning).toBe(false);
      expect(updated.administrativeActions.some((a) => a.action === 'PIN_COMMIT_OVERRIDE')).toBe(true);
    });

    it('rejects administrative actions without mandatory justification', async () => {
      await expect(
        service.dismissDuplicateFlag('sub-test', { id: 'admin', name: 'Admin' }, '')
      ).rejects.toThrow('Mandatory documented rationale is required');

      await expect(
        service.acceptPostDeadlineChanges('sub-test', { id: 'admin', name: 'Admin' }, '   ')
      ).rejects.toThrow('Mandatory justification is required');

      await expect(
        service.pinCommitSha('sub-test', '123', { id: 'admin', name: 'Admin' }, 'reason')
      ).rejects.toThrow('valid git commit SHA is required');
    });
  });
});
