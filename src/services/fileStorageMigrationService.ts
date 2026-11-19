// ─────────────────────────────────────────────
// fileStorageMigrationService.ts — Non-Destructive File Metadata Audit & Migration Classifier
// Proofly Phase 03 — Identifies legacy blob: / placeholder URLs that MUST be re-uploaded.
// NEVER pretends old browser blob: URLs can be recovered. NEVER deletes old records automatically.
// ─────────────────────────────────────────────

import type { ProjectSubmission, StoredFileMetadata } from '../types/submission';
import { fileStorageService } from './fileStorageService';

export type FileMigrationClassification =
  | 'VALID_FIREBASE_STORAGE'
  | 'UNRECOVERABLE_BLOB_URL'
  | 'UNRECOVERABLE_INTERNAL_PLACEHOLDER'
  | 'LEGACY_PATH_REQUIRES_MIGRATION'
  | 'INCOMPLETE_OR_UNVERIFIED';

export interface FileMigrationRecord {
  submissionId: string;
  referenceId: string;
  competitionId: string;
  organizationId: string;
  fileId: string;
  fileName: string;
  storagePath: string;
  classification: FileMigrationClassification;
  requiresReupload: boolean;
  reason: string;
}

export interface StorageMigrationReport {
  generatedAt: string;
  totalSubmissionsScanned: number;
  totalFilesScanned: number;
  summary: Record<FileMigrationClassification, number>;
  recordsRequiringReupload: FileMigrationRecord[];
  allRecords: FileMigrationRecord[];
}

export const fileStorageMigrationService = {
  /**
   * Classifies a single file metadata record without mutating or deleting it.
   */
  classifyFile(
    submission: Pick<ProjectSubmission, 'id' | 'referenceId' | 'competitionId' | 'organizationId'>,
    file: StoredFileMetadata
  ): FileMigrationRecord {
    const url = (file.downloadUrl || '').trim();
    const path = (file.storagePath || '').trim();
    const base = {
      submissionId: submission.id,
      referenceId: submission.referenceId,
      competitionId: submission.competitionId,
      organizationId: submission.organizationId,
      fileId: file.id,
      fileName: file.fileName,
      storagePath: path,
    };

    if (url.startsWith('blob:')) {
      return {
        ...base,
        classification: 'UNRECOVERABLE_BLOB_URL',
        requiresReupload: true,
        reason:
          'File references an ephemeral browser blob: URL that cannot be recovered across page refresh or devices. Participant must re-upload.',
      };
    }

    if (
      url.includes('storage.proofly.internal') ||
      url.includes('storage.googleapis.com/proofly/')
    ) {
      return {
        ...base,
        classification: 'UNRECOVERABLE_INTERNAL_PLACEHOLDER',
        requiresReupload: true,
        reason:
          'File references a synthetic placeholder URL that was never persisted to Firebase Storage. Participant must re-upload.',
      };
    }

    const parsedCanonical = fileStorageService.parseCanonicalStoragePath(path);
    if (!parsedCanonical) {
      return {
        ...base,
        classification: 'LEGACY_PATH_REQUIRES_MIGRATION',
        requiresReupload: true,
        reason:
          `Storage path "${path || '(empty)'}" does not match canonical tenant path organizations/{orgId}/competitions/{compId}/submissions/{subId}/{fileId}_{name}. Must be migrated or re-uploaded.`,
      };
    }

    if (
      !file.isVerified ||
      (file.uploadStatus && file.uploadStatus !== 'UPLOADED') ||
      !file.checksum ||
      file.checksum.length !== 64
    ) {
      return {
        ...base,
        classification: 'INCOMPLETE_OR_UNVERIFIED',
        requiresReupload: true,
        reason:
          'File upload was not confirmed complete with a verified full-file SHA-256 checksum. Must be re-uploaded.',
      };
    }

    return {
      ...base,
      classification: 'VALID_FIREBASE_STORAGE',
      requiresReupload: false,
      reason: 'Persisted in Firebase Storage under canonical tenant path with verified SHA-256.',
    };
  },

  /**
   * Produces a read-only migration report across a list of submissions.
   * Never deletes or overwrites source records.
   */
  generateMigrationReport(submissions: ProjectSubmission[]): StorageMigrationReport {
    const summary: Record<FileMigrationClassification, number> = {
      VALID_FIREBASE_STORAGE: 0,
      UNRECOVERABLE_BLOB_URL: 0,
      UNRECOVERABLE_INTERNAL_PLACEHOLDER: 0,
      LEGACY_PATH_REQUIRES_MIGRATION: 0,
      INCOMPLETE_OR_UNVERIFIED: 0,
    };

    const allRecords: FileMigrationRecord[] = [];
    for (const sub of submissions) {
      for (const file of sub.files || []) {
        const record = this.classifyFile(sub, file);
        summary[record.classification] += 1;
        allRecords.push(record);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      totalSubmissionsScanned: submissions.length,
      totalFilesScanned: allRecords.length,
      summary,
      recordsRequiringReupload: allRecords.filter((r) => r.requiresReupload),
      allRecords,
    };
  },
};
