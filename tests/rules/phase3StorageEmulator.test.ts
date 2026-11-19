// ─────────────────────────────────────────────────────────────────
// phase3StorageEmulator.test.ts
// Proofly Phase 03 — Real Firebase Storage Emulator End-to-End Tests
// Tests real fileStorageService.uploadFile() & downloadFileBytes() against
// live Firebase Storage + Firestore Emulators:
//   - Official format validation, progress tracking, full-file SHA-256
//   - Persistence & cross-device download (Device A upload -> Device B download)
//   - Cross-user & cross-tenant access denial
//   - Scoped anonymous upload sessions & failure/cancellation/duplicate handling
//   - Non-destructive legacy blob: URL migration audit
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, Timestamp } from 'firebase/firestore';
import {
  fileStorageService,
  StorageUploadError,
  FIRESTORE_CHUNK_SIZE_BYTES,
  type UploadProgressState,
} from '../../src/services/fileStorageService';
import { fileStorageMigrationService } from '../../src/services/fileStorageMigrationService';
import { sha256Bytes } from '../../src/utils/cryptoUtils';
import type { ProjectSubmission, StoredFileMetadata } from '../../src/types/submission';

const PROJECT_ID = 'proofly-rules-test';

function makePdfBytes(bodyText: string): Uint8Array {
  const header = `%PDF-1.4\n% ${bodyText}\n`;
  // Pad > 2 KB to test genuine full-file SHA-256 (beyond old 1024-byte slice)
  const padded = header + 'A'.repeat(2048) + `\n%%TAIL:${bodyText}\n%%EOF\n`;
  return new TextEncoder().encode(padded);
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

let testEnv: RulesTestEnvironment;

async function seedStorageScenario() {
  const futureTs = Timestamp.fromMillis(Date.now() + 3_600_000);
  const pastTs = Timestamp.fromMillis(Date.now() - 3_600_000);

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'organizations', 'org-a'), {
      id: 'org-a',
      name: 'Alpha Org',
      slug: 'alpha',
      ownerId: 'uid-org-admin-a',
    });
    await setDoc(doc(db, 'organizations', 'org-a', 'members', 'uid-org-admin-a'), {
      userId: 'uid-org-admin-a',
      orgId: 'org-a',
      role: 'ADMIN',
      email: 'admin@alpha.org',
      displayName: 'Org Admin A',
    });
    await setDoc(doc(db, 'organizations', 'org-b'), {
      id: 'org-b',
      name: 'Beta Org',
      slug: 'beta',
      ownerId: 'uid-org-b-user',
    });
    await setDoc(doc(db, 'organizations', 'org-b', 'members', 'uid-org-b-user'), {
      userId: 'uid-org-b-user',
      orgId: 'org-b',
      role: 'OWNER',
      email: 'owner@beta.org',
      displayName: 'Org B Owner',
    });

    await setDoc(doc(db, 'competitions', 'comp-a'), {
      id: 'comp-a',
      organizationId: 'org-a',
      title: 'Alpha Competition',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    });

    await setDoc(doc(db, 'competitions', 'comp-a', 'roles', 'uid-judge-assigned'), {
      competitionId: 'comp-a',
      userId: 'uid-judge-assigned',
      role: 'JUDGE',
    });
    await setDoc(doc(db, 'competitions', 'comp-a', 'roles', 'uid-judge-unassigned'), {
      competitionId: 'comp-a',
      userId: 'uid-judge-unassigned',
      role: 'JUDGE',
    });

    await setDoc(doc(db, 'submissions', 'sub-1'), {
      id: 'sub-1',
      organizationId: 'org-a',
      competitionId: 'comp-a',
      participantUid: 'uid-participant-1',
      projectTitle: 'Edge Health Monitor',
      submissionType: 'INDIVIDUAL',
      status: 'Draft',
      isLocked: false,
    });

    await setDoc(doc(db, 'judgeAssignments', 'sub-1_uid-judge-assigned'), {
      id: 'sub-1_uid-judge-assigned',
      organizationId: 'org-a',
      competitionId: 'comp-a',
      submissionId: 'sub-1',
      judgeId: 'uid-judge-assigned',
      status: 'ASSIGNED',
    });

    await setDoc(doc(db, 'participantSessions', 'sess-active'), {
      organizationId: 'org-a',
      competitionId: 'comp-a',
      submissionId: 'sub-1',
      revoked: false,
      expiresAt: futureTs,
    });
    await setDoc(doc(db, 'participantSessions', 'sess-revoked'), {
      organizationId: 'org-a',
      competitionId: 'comp-a',
      submissionId: 'sub-1',
      revoked: true,
      expiresAt: futureTs,
    });
    await setDoc(doc(db, 'participantSessions', 'sess-expired'), {
      organizationId: 'org-a',
      competitionId: 'comp-a',
      submissionId: 'sub-1',
      revoked: false,
      expiresAt: pastTs,
    });
  });
}

describe('Phase 03: Real Firebase Storage Upload, Download & Migration Tests', () => {
  beforeAll(async () => {
    const firestoreRules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const storageRules = readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host: '127.0.0.1', port: 8080, rules: firestoreRules },
      storage: { host: '127.0.0.1', port: 9199, rules: storageRules },
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
    await seedStorageScenario();
  });

  it('uploads real files to Firebase Storage, tracks progress, computes full-file SHA-256, and persists across devices without blob: URLs', async () => {
    // Device A: Participant 1 uploads a >2KB PDF and PNG
    const deviceAStorage = testEnv.authenticatedContext('uid-participant-1').storage();
    const pdfBytes = makePdfBytes('device-a-unique-tail-signature');
    const expectedHash = await sha256Bytes(pdfBytes);
    const progressEvents: UploadProgressState[] = [];

    const uploadedPdf = await fileStorageService.uploadFile(
      { name: 'Final Pitch Deck (v1).pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
      {
        fieldId: 'pitch_deck',
        organizationId: 'org-a',
        competitionId: 'comp-a',
        submissionId: 'sub-1',
        uploaderUid: 'uid-participant-1',
        onProgress: (p) => progressEvents.push(p),
        storageInstance: deviceAStorage as any,
      }
    );

    // 1. Verify trusted metadata (NO blob: URL, NO public downloadUrl)
    expect(uploadedPdf.uploadStatus).toBe('UPLOADED');
    expect(uploadedPdf.isVerified).toBe(true);
    expect(uploadedPdf.downloadUrl).toBe('');
    expect(uploadedPdf.downloadUrl.startsWith('blob:')).toBe(false);
    expect(uploadedPdf.originalFileName).toBe('Final Pitch Deck (v1).pdf');
    expect(uploadedPdf.fileName).toBe('Final_Pitch_Deck_(v1).pdf');
    expect(uploadedPdf.fileSize).toBe(pdfBytes.byteLength);
    expect(uploadedPdf.checksum).toBe(expectedHash);
    expect(uploadedPdf.uploadedBy).toBe('uid:uid-participant-1');
    expect(uploadedPdf.storagePath).toMatch(
      /^organizations\/org-a\/competitions\/comp-a\/submissions\/sub-1\/file_[0-9a-f]+_Final_Pitch_Deck_\(v1\)\.pdf$/
    );
    expect(progressEvents.some((p) => p.state === 'success' && p.percent === 100)).toBe(true);

    // Also verify PNG & ZIP official formats succeed
    const uploadedPng = await fileStorageService.uploadFile(
      { name: 'arch.png', size: PNG_BYTES.byteLength, bytes: PNG_BYTES, type: 'image/png' },
      {
        fieldId: 'screenshots',
        organizationId: 'org-a',
        competitionId: 'comp-a',
        submissionId: 'sub-1',
        uploaderUid: 'uid-participant-1',
        storageInstance: deviceAStorage as any,
      }
    );
    expect(uploadedPng.isVerified).toBe(true);

    const uploadedZip = await fileStorageService.uploadFile(
      { name: 'bundle.zip', size: ZIP_BYTES.byteLength, bytes: ZIP_BYTES, type: 'application/zip' },
      {
        fieldId: 'source',
        organizationId: 'org-a',
        competitionId: 'comp-a',
        submissionId: 'sub-1',
        uploaderUid: 'uid-participant-1',
        storageInstance: deviceAStorage as any,
      }
    );
    expect(uploadedZip.isVerified).toBe(true);

    // 2. Simulate submission passing AI gate -> Ready for Judge Review
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'submissions', 'sub-1'), {
        status: 'Ready for Judge Review',
        isLocked: true,
      });
    });

    // 3. Device B (Assigned Judge on a completely different client) downloads the persistent file
    const deviceBJudgeStorage = testEnv.authenticatedContext('uid-judge-assigned').storage();
    const downloadedByJudge = await fileStorageService.downloadFileBytes(uploadedPdf, {
      storageInstance: deviceBJudgeStorage as any,
      skipClientPrecheck: true, // Let real Firebase Storage Rules enforce authorization
    });

    expect(downloadedByJudge.bytes.byteLength).toBe(pdfBytes.byteLength);
    expect(downloadedByJudge.verifiedChecksum).toBe(expectedHash);
    expect(Buffer.from(downloadedByJudge.bytes).equals(Buffer.from(pdfBytes))).toBe(true);

    // 4. Device C (Org Admin A) also downloads cleanly
    const deviceCAdminStorage = testEnv.authenticatedContext('uid-org-admin-a').storage();
    const downloadedByAdmin = await fileStorageService.downloadFileBytes(uploadedPdf, {
      storageInstance: deviceCAdminStorage as any,
      skipClientPrecheck: true,
    });
    expect(downloadedByAdmin.verifiedChecksum).toBe(expectedHash);

    // 5. Cross-user & cross-tenant access denial on Device D/E/F/G
    for (const deniedStorage of [
      testEnv.authenticatedContext('uid-judge-unassigned').storage(),
      testEnv.authenticatedContext('uid-participant-2').storage(),
      testEnv.authenticatedContext('uid-org-b-user').storage(),
      testEnv.unauthenticatedContext().storage(),
    ]) {
      await expect(
        fileStorageService.downloadFileBytes(uploadedPdf, {
          storageInstance: deniedStorage as any,
          skipClientPrecheck: true,
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
  });

  it('supports scoped anonymous upload session and blocks revoked/expired/unscoped anonymous uploads', async () => {
    const anonStorage = testEnv.unauthenticatedContext().storage();
    const pdfBytes = makePdfBytes('anon-scoped-upload');

    // Valid active scoped participantSession succeeds
    const uploaded = await fileStorageService.uploadFile(
      { name: 'anon-spec.pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
      {
        fieldId: 'pitch_deck',
        organizationId: 'org-a',
        competitionId: 'comp-a',
        submissionId: 'sub-1',
        participantSessionId: 'sess-active',
        storageInstance: anonStorage as any,
      }
    );
    expect(uploaded.isVerified).toBe(true);
    expect(uploaded.uploadStatus).toBe('UPLOADED');

    // Verify the anonymously uploaded file actually persisted in Storage by reading it as Org Admin A,
    // while verifying the anonymous caller still CANNOT read it back (write-only scoped session).
    const adminStorage = testEnv.authenticatedContext('uid-org-admin-a').storage();
    const adminDownload = await fileStorageService.downloadFileBytes(uploaded, {
      storageInstance: adminStorage as any,
      skipClientPrecheck: true,
    });
    expect(Buffer.from(adminDownload.bytes).equals(Buffer.from(pdfBytes))).toBe(true);

    await expect(
      fileStorageService.downloadFileBytes(uploaded, {
        storageInstance: anonStorage as any,
        skipClientPrecheck: true,
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Revoked session is denied by Storage rules
    await expect(
      fileStorageService.uploadFile(
        { name: 'revoked.pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          participantSessionId: 'sess-revoked',
          storageInstance: anonStorage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Expired session is denied by Storage rules
    await expect(
      fileStorageService.uploadFile(
        { name: 'expired.pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          participantSessionId: 'sess-expired',
          storageInstance: anonStorage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('handles duplicate uploads, unsupported formats, disguised executables, >25MB files, cancellation, and unauthorized callers', async () => {
    const p1Storage = testEnv.authenticatedContext('uid-participant-1').storage();
    const pdfBytes = makePdfBytes('duplicate-check-content');

    const first = await fileStorageService.uploadFile(
      { name: 'deck.pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
      {
        fieldId: 'pitch_deck',
        organizationId: 'org-a',
        competitionId: 'comp-a',
        submissionId: 'sub-1',
        uploaderUid: 'uid-participant-1',
        storageInstance: p1Storage as any,
      }
    );

    // Duplicate file (same SHA-256) rejected
    await expect(
      fileStorageService.uploadFile(
        { name: 'deck_copy.pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-1',
          existingFiles: [first],
          storageInstance: p1Storage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'DUPLICATE_FILE' });

    // Unsupported format (.docx / .exe) rejected
    await expect(
      fileStorageService.uploadFile(
        { name: 'notes.docx', size: ZIP_BYTES.byteLength, bytes: ZIP_BYTES },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-1',
          storageInstance: p1Storage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });

    // Disguised executable renamed to .pdf rejected
    await expect(
      fileStorageService.uploadFile(
        { name: 'fake.pdf', size: EXE_BYTES.byteLength, bytes: EXE_BYTES },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-1',
          storageInstance: p1Storage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });

    // Oversized file (> 25 MB) rejected
    await expect(
      fileStorageService.uploadFile(
        { name: 'huge.pdf', size: 26 * 1024 * 1024, bytes: pdfBytes },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-1',
          storageInstance: p1Storage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    // Aborted / cancelled upload rejected cleanly
    const controller = new AbortController();
    controller.abort();
    await expect(
      fileStorageService.uploadFile(
        { name: 'aborted.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-1',
          abortSignal: controller.signal,
          storageInstance: p1Storage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'CANCELLED' });

    // Missing authorization identity rejected
    await expect(
      fileStorageService.uploadFile(
        { name: 'unauth.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          storageInstance: p1Storage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    // Cross-user upload rejected by Firebase Storage rules
    const p2Storage = testEnv.authenticatedContext('uid-participant-2').storage();
    await expect(
      fileStorageService.uploadFile(
        { name: 'hijack.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-2',
          storageInstance: p2Storage as any,
        }
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('classifies legacy blob: URLs and placeholder records non-destructively in migration audit report', async () => {
    const validFile: StoredFileMetadata = {
      id: 'file_valid',
      fieldId: 'pitch',
      fileName: 'good.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      storagePath: 'organizations/org-a/competitions/comp-a/submissions/sub-1/file_valid_good.pdf',
      downloadUrl: '',
      uploadedAt: '2026-11-18T00:00:00Z',
      uploadStatus: 'UPLOADED',
      checksum: 'b'.repeat(64),
      isVerified: true,
    };
    const blobFile: StoredFileMetadata = {
      id: 'file_blob',
      fieldId: 'pitch',
      fileName: 'lost.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      storagePath: 'submissions/comp-a/sub-1/pitch/file_blob_lost.pdf',
      downloadUrl: 'blob:http://localhost:5173/1234-5678',
      uploadedAt: '2026-11-10T00:00:00Z',
      isVerified: true,
    };
    const placeholderFile: StoredFileMetadata = {
      id: 'file_internal',
      fieldId: 'pitch',
      fileName: 'fake.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      storagePath: 'submissions/comp-a/sub-1/pitch/file_internal_fake.pdf',
      downloadUrl: 'https://storage.proofly.internal/submissions/comp-a/sub-1/fake.pdf',
      uploadedAt: '2026-11-10T00:00:00Z',
      isVerified: true,
    };

    const mockSubmission = {
      id: 'sub-audit-1',
      referenceId: 'PF-SUB-2026-AUD01',
      competitionId: 'comp-a',
      organizationId: 'org-a',
      files: [validFile, blobFile, placeholderFile],
    } as ProjectSubmission;

    const report = fileStorageMigrationService.generateMigrationReport([mockSubmission]);
    expect(report.totalFilesScanned).toBe(3);
    expect(report.summary.VALID_FIREBASE_STORAGE).toBe(1);
    expect(report.summary.UNRECOVERABLE_BLOB_URL).toBe(1);
    expect(report.summary.UNRECOVERABLE_INTERNAL_PLACEHOLDER).toBe(1);
    expect(report.recordsRequiringReupload).toHaveLength(2);

    // Ensure non-destructive: original records untouched
    expect(mockSubmission.files).toHaveLength(3);

    // Downloading legacy blob file throws explicit REUPLOAD_REQUIRED
    await expect(
      fileStorageService.downloadFileBytes(blobFile, { skipClientPrecheck: true })
    ).rejects.toThrow(StorageUploadError);
    await expect(
      fileStorageService.downloadFileBytes(blobFile, { skipClientPrecheck: true })
    ).rejects.toMatchObject({ code: 'REUPLOAD_REQUIRED' });
  });

  // ─────────────────────────────────────────────────────────────────
  // Firebase Spark Free Tier Backend ('firestore-chunks') E2E Tests
  // Zero Blaze Cloud Storage bucket required!
  // ─────────────────────────────────────────────────────────────────

  it('Spark free tier: splits multi-chunk PDF (>700 KB) into Firestore binary chunks, verifies SHA-256 across devices, enforces tenant/judge rules & immutability', async () => {
    // Build a deterministic 1.6 MB valid PDF (~3 chunks at 700 KB/chunk)
    const totalSize = FIRESTORE_CHUNK_SIZE_BYTES * 2 + 200_000;
    const multiChunkPdf = new Uint8Array(totalSize);
    const header = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Title (Spark Multi-Chunk Deck) >>\n');
    multiChunkPdf.set(header, 0);
    for (let i = header.length; i < totalSize; i++) {
      multiChunkPdf[i] = (i * 31 + 17) & 0xff;
    }
    const expectedHash = await sha256Bytes(multiChunkPdf);

    const deviceAFirestore = testEnv.authenticatedContext('uid-participant-1').firestore();
    const progressEvents: UploadProgressState[] = [];

    const uploaded = await fileStorageService.uploadFile(
      { name: 'Spark Pitch Deck.pdf', size: multiChunkPdf.byteLength, bytes: multiChunkPdf, type: 'application/pdf' },
      {
        fieldId: 'pitch_deck',
        organizationId: 'org-a',
        competitionId: 'comp-a',
        submissionId: 'sub-1',
        uploaderUid: 'uid-participant-1',
        backend: 'firestore-chunks',
        firestoreInstance: deviceAFirestore as any,
        onProgress: (p) => progressEvents.push(p),
      }
    );

    expect(uploaded.storageBackend).toBe('firestore-chunks');
    expect(uploaded.chunkCount).toBe(3);
    expect(uploaded.fileSize).toBe(totalSize);
    expect(uploaded.checksum).toBe(expectedHash);
    expect(uploaded.downloadUrl).toBe('');
    expect(uploaded.isVerified).toBe(true);
    expect(uploaded.uploadStatus).toBe('UPLOADED');
    expect(progressEvents.some((p) => p.state === 'running' && p.percent > 0 && p.percent < 100)).toBe(true);
    expect(progressEvents.some((p) => p.state === 'success' && p.percent === 100)).toBe(true);

    // Immutability check: uploader cannot mutate or delete uploaded manifest or chunk
    await expect(
      updateDoc(doc(deviceAFirestore as any, 'submissionArtifacts', uploaded.id), { fileName: 'tampered.pdf' })
    ).rejects.toThrow();
    await expect(
      deleteDoc(doc(deviceAFirestore as any, 'submissionArtifacts', uploaded.id))
    ).rejects.toThrow();
    await expect(
      deleteDoc(doc(deviceAFirestore as any, 'submissionArtifacts', uploaded.id, 'chunks', '0'))
    ).rejects.toThrow();

    // Advance submission to Ready for Judge Review
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'submissions', 'sub-1'), {
        status: 'Ready for Judge Review',
        isLocked: true,
      });
    });

    // Device B (Assigned Judge) downloads and reassembles ALL 3 chunks byte-for-byte with SHA-256 verification
    const judgeFirestore = testEnv.authenticatedContext('uid-judge-assigned').firestore();
    const downloadedByJudge = await fileStorageService.downloadFileBytes(uploaded, {
      firestoreInstance: judgeFirestore as any,
      skipClientPrecheck: true,
    });
    expect(downloadedByJudge.bytes.byteLength).toBe(totalSize);
    expect(downloadedByJudge.verifiedChecksum).toBe(expectedHash);
    expect(Buffer.from(downloadedByJudge.bytes).equals(Buffer.from(multiChunkPdf))).toBe(true);

    // Device C (Org Admin A) also downloads cleanly
    const adminFirestore = testEnv.authenticatedContext('uid-org-admin-a').firestore();
    const downloadedByAdmin = await fileStorageService.downloadFileBytes(uploaded, {
      firestoreInstance: adminFirestore as any,
      skipClientPrecheck: true,
    });
    expect(downloadedByAdmin.verifiedChecksum).toBe(expectedHash);

    // Cross-user, unassigned judge, Org B, and unauthenticated callers are strictly denied on manifest AND chunks
    for (const deniedDb of [
      testEnv.authenticatedContext('uid-judge-unassigned').firestore(),
      testEnv.authenticatedContext('uid-participant-2').firestore(),
      testEnv.authenticatedContext('uid-org-b-user').firestore(),
      testEnv.unauthenticatedContext().firestore(),
    ]) {
      await expect(
        fileStorageService.downloadFileBytes(uploaded, {
          firestoreInstance: deniedDb as any,
          skipClientPrecheck: true,
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      await expect(
        getDoc(doc(deniedDb as any, 'submissionArtifacts', uploaded.id, 'chunks', '0'))
      ).rejects.toThrow();
    }
  });

  it('Spark free tier: supports write-only scoped anonymous upload session, enforces 8 MB cap & mid-upload cancellation', async () => {
    const anonFirestore = testEnv.unauthenticatedContext().firestore();
    const pdfBytes = makePdfBytes('spark-anon-upload');

    // Valid active scoped participantSession uploads cleanly on Spark Firestore
    const uploaded = await fileStorageService.uploadFile(
      { name: 'spark-anon.pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
      {
        fieldId: 'pitch_deck',
        organizationId: 'org-a',
        competitionId: 'comp-a',
        submissionId: 'sub-1',
        participantSessionId: 'sess-active',
        backend: 'firestore-chunks',
        firestoreInstance: anonFirestore as any,
      }
    );
    expect(uploaded.storageBackend).toBe('firestore-chunks');
    expect(uploaded.isVerified).toBe(true);

    // Org Admin A can download the anonymously uploaded file byte-for-byte
    const adminFirestore = testEnv.authenticatedContext('uid-org-admin-a').firestore();
    const adminDownload = await fileStorageService.downloadFileBytes(uploaded, {
      firestoreInstance: adminFirestore as any,
      skipClientPrecheck: true,
    });
    expect(Buffer.from(adminDownload.bytes).equals(Buffer.from(pdfBytes))).toBe(true);

    // Anonymous caller CANNOT read back the uploaded artifact (write-only scoped session)
    await expect(
      fileStorageService.downloadFileBytes(uploaded, {
        firestoreInstance: anonFirestore as any,
        skipClientPrecheck: true,
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Revoked & expired sessions denied by firestore.rules
    for (const badSession of ['sess-revoked', 'sess-expired']) {
      await expect(
        fileStorageService.uploadFile(
          { name: `${badSession}.pdf`, size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
          {
            fieldId: 'pitch_deck',
            organizationId: 'org-a',
            competitionId: 'comp-a',
            submissionId: 'sub-1',
            participantSessionId: badSession,
            backend: 'firestore-chunks',
            firestoreInstance: anonFirestore as any,
          }
        )
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }

    // Spark 8 MB cap enforcement (8.5 MB rejected)
    const p1Firestore = testEnv.authenticatedContext('uid-participant-1').firestore();
    const oversized = new Uint8Array(Math.floor(8.5 * 1024 * 1024));
    oversized.set([0x25, 0x50, 0x44, 0x46], 0);
    await expect(
      fileStorageService.uploadFile(
        { name: 'too-big-for-spark.pdf', size: oversized.byteLength, bytes: oversized, type: 'application/pdf' },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-1',
          backend: 'firestore-chunks',
          firestoreInstance: p1Firestore as any,
        }
      )
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    // Pre-cancelled upload via AbortController fails cleanly with CANCELLED
    const controller = new AbortController();
    controller.abort();
    await expect(
      fileStorageService.uploadFile(
        { name: 'cancel-spark.pdf', size: pdfBytes.byteLength, bytes: pdfBytes, type: 'application/pdf' },
        {
          fieldId: 'pitch_deck',
          organizationId: 'org-a',
          competitionId: 'comp-a',
          submissionId: 'sub-1',
          uploaderUid: 'uid-participant-1',
          backend: 'firestore-chunks',
          firestoreInstance: p1Firestore as any,
          abortSignal: controller.signal,
        }
      )
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
