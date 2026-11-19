// ─────────────────────────────────────────────
// fileStorageService.ts — Real Persistent Artifact Storage Engine
// Proofly Phase 03 — Zero blob: URLs, Zero Mock Upload Success
// Default Backend: 'firestore-chunks' (100% Firebase Spark Free Tier, <= 8 MB/file)
// Optional Backend: 'firebase-storage' (Firebase Blaze Cloud Storage Bucket, <= 25 MB/file)
// Canonical path: organizations/{orgId}/competitions/{compId}/submissions/{subId}/{fileId}_{sanitizedName}
// ─────────────────────────────────────────────

import {
  ref,
  uploadBytesResumable,
  getMetadata,
  getBytes,
  type FirebaseStorage,
  type FullMetadata,
  type UploadTask,
} from 'firebase/storage';
import {
  doc,
  setDoc,
  getDoc,
  Bytes,
  type Firestore,
} from 'firebase/firestore';
import {
  db as defaultFirestore,
  storage as defaultStorage,
  isFirebaseConfigured,
} from '../config/firebase';
import { generateSecureToken, sha256Bytes } from '../utils/cryptoUtils';
import { authorizationService } from './authorizationService';
import type { VerifiedAuthSession } from './firebaseAuthService';
import type { StoredFileMetadata, StorageBackendType } from '../types/submission';

export const MAX_FIRESTORE_CHUNK_FILE_SIZE_MB = 8;
export const FIRESTORE_CHUNK_SIZE_BYTES = 700 * 1024; // 700 KB binary chunks (< 1 MiB Firestore doc cap)
export const MAX_STORAGE_FILE_SIZE_MB = 25;

export function getDefaultStorageBackend(): StorageBackendType {
  const configured =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_STORAGE_BACKEND as string | undefined)
      : undefined;
  return configured === 'firebase-storage' ? 'firebase-storage' : 'firestore-chunks';
}

/**
 * Officially supported file extensions & MIME mappings aligned with `storage.rules`.
 */
export const OFFICIAL_SUPPORTED_FORMATS: Readonly<Record<string, string>> = Object.freeze({
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
});

export const DANGEROUS_EXTENSIONS = Object.freeze([
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.vbs', '.ps1', '.msi', '.com',
  '.scr', '.js', '.mjs', '.html', '.htm', '.php', '.svg',
]);

export type StorageErrorCode =
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'UNAUTHORIZED'
  | 'DUPLICATE_FILE'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'STORAGE_UNAVAILABLE'
  | 'VERIFICATION_FAILED'
  | 'REUPLOAD_REQUIRED';

export class StorageUploadError extends Error {
  public readonly code: StorageErrorCode;
  public readonly retryable: boolean;

  constructor(code: StorageErrorCode, message: string, retryable: boolean = false) {
    super(message);
    this.name = 'StorageUploadError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface FileValidationResult {
  valid: boolean;
  detectedMimeType?: string;
  resolvedMimeType?: string;
  error?: string;
  errorCode?: StorageErrorCode;
}

export interface UploadProgressState {
  fileId: string;
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
  state: 'running' | 'paused' | 'success' | 'canceled' | 'error';
}

export interface FileUploadOptions {
  fieldId: string;
  organizationId: string;
  competitionId: string;
  submissionId: string;
  /** Authenticated uploader UID (for participant or admin upload). */
  uploaderUid?: string;
  /** Scoped participant session ID (for accountless participant uploads verified by storage.rules). */
  participantSessionId?: string;
  allowedExtensions?: string[];
  maxSizeMb?: number;
  /** Existing uploaded files for duplicate detection on the same submission. */
  existingFiles?: StoredFileMetadata[];
  /** Optional progress callback receiving real Firebase Storage transfer progress. */
  onProgress?: (progress: UploadProgressState) => void;
  /** Optional AbortSignal to cancel an in-flight upload cleanly. */
  abortSignal?: AbortSignal;
  /** Max automatic retries on transient network failure (default: 2). */
  maxRetries?: number;
  /** Storage backend override: 'firestore-chunks' (Spark free tier default) or 'firebase-storage' (Blaze). */
  backend?: StorageBackendType;
  /** Optional Firestore instance override (used by Firebase Emulator tests for Spark chunk storage). */
  firestoreInstance?: Firestore;
  /** Optional FirebaseStorage instance override (used by Firebase Emulator tests for Blaze Storage). */
  storageInstance?: FirebaseStorage;
}

export interface AuthorizedDownloadContext {
  verifiedSession?: VerifiedAuthSession | null;
  /** Authenticated participant UID (when participant owns the submission). */
  participantUid?: string;
  /** Assigned judge UIDs for the target submission (enforces judge assignment isolation). */
  assignedJudgeIds?: string[];
  /** Storage backend override: 'firestore-chunks' or 'firebase-storage'. */
  backend?: StorageBackendType;
  /** Optional Firestore instance override (used by Firebase Emulator tests). */
  firestoreInstance?: Firestore;
  /** Optional FirebaseStorage instance override (used by Firebase Emulator tests). */
  storageInstance?: FirebaseStorage;
  /** Skip client-side pre-check when testing raw Firebase Security Rules directly in emulator tests. */
  skipClientPrecheck?: boolean;
}

export interface DownloadedArtifact {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  storagePath: string;
  verifiedChecksum: string;
}

const CANONICAL_PATH_REGEX =
  /^organizations\/([^/]+)\/competitions\/([^/]+)\/submissions\/([^/]+)\/([^/]+)$/;

function mapFirebaseStorageError(err: unknown): StorageUploadError {
  if (err instanceof StorageUploadError) return err;
  const code = (err as { code?: string })?.code || '';
  const msg = (err as { message?: string })?.message || String(err);

  switch (code) {
    case 'storage/unauthorized':
    case 'storage/unauthenticated':
    case 'permission-denied':
    case 'unauthenticated':
      return new StorageUploadError(
        'PERMISSION_DENIED',
        'Permission denied by Firebase security rules. Verify your session, competition status, and submission ownership.',
        false
      );
    case 'storage/quota-exceeded':
    case 'resource-exhausted':
      return new StorageUploadError(
        'QUOTA_EXCEEDED',
        'Firebase storage quota exceeded. Contact the competition organizer.',
        false
      );
    case 'storage/canceled':
    case 'cancelled':
      return new StorageUploadError('CANCELLED', 'File upload was cancelled.', false);
    case 'storage/object-not-found':
    case 'not-found':
      return new StorageUploadError(
        'VERIFICATION_FAILED',
        'Artifact was not found in persistent storage.',
        false
      );
    case 'storage/retry-limit-exceeded':
    case 'storage/server-file-wrong-size':
    case 'unavailable':
    case 'deadline-exceeded':
    case 'aborted':
      return new StorageUploadError(
        'NETWORK_ERROR',
        'Network interruption occurred while transferring file. Please retry.',
        true
      );
    default:
      if (/permission[_ -]?denied|unauthorized|insufficient permissions/i.test(msg)) {
        return new StorageUploadError(
          'PERMISSION_DENIED',
          'Permission denied by Firebase security rules.',
          false
        );
      }
      if (/network|fetch|timeout|offline|abort/i.test(msg)) {
        return new StorageUploadError(
          'NETWORK_ERROR',
          `Network error during persistent storage operation: ${msg}`,
          true
        );
      }
      return new StorageUploadError('NETWORK_ERROR', `Persistent storage error: ${msg}`, true);
  }
}

export class FileStorageService {
  private inFlightKeys = new Set<string>();
  private activeTasks = new Map<string, UploadTask>();
  private activeFirestoreAborts = new Map<string, AbortController>();

  public getActiveStorageBackend(): StorageBackendType {
    return getDefaultStorageBackend();
  }

  public getActiveMaxFileSizeMb(backend?: StorageBackendType): number {
    const active = backend || this.getActiveStorageBackend();
    return active === 'firebase-storage' ? MAX_STORAGE_FILE_SIZE_MB : MAX_FIRESTORE_CHUNK_FILE_SIZE_MB;
  }

  private resolveUploadBackend(options: FileUploadOptions): StorageBackendType {
    if (options.backend) return options.backend;
    if (options.firestoreInstance) return 'firestore-chunks';
    if (options.storageInstance) return 'firebase-storage';
    return this.getActiveStorageBackend();
  }

  private resolveDownloadBackend(
    fileMeta: StoredFileMetadata,
    authCtx: AuthorizedDownloadContext
  ): StorageBackendType {
    if (authCtx.backend) return authCtx.backend;
    if (authCtx.firestoreInstance) return 'firestore-chunks';
    if (authCtx.storageInstance) return 'firebase-storage';
    if (fileMeta.storageBackend) return fileMeta.storageBackend;
    return this.getActiveStorageBackend();
  }

  /**
   * Sanitizes a file name to prevent path traversal and unsafe characters.
   */
  public sanitizeFileName(fileName: string): string {
    const base = (fileName || '').split(/[\\/]/).pop() || 'unnamed_file';
    let withoutControls = '';
    for (let i = 0; i < base.length; i++) {
      const code = base.charCodeAt(i);
      if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) continue;
      withoutControls += base[i];
    }
    const cleaned = withoutControls
      .replace(/\.\.+/g, '.')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .trim();
    return cleaned.slice(0, 140) || 'unnamed_file';
  }

  /**
   * Generates the canonical tenant-scoped Firebase Storage path matching `storage.rules`.
   */
  public buildCanonicalStoragePath(params: {
    organizationId: string;
    competitionId: string;
    submissionId: string;
    fileId: string;
    sanitizedFileName: string;
  }): string {
    const seg = (val: string, label: string) => {
      const clean = (val || '').trim();
      if (!clean || clean.includes('/') || clean.includes('\\') || clean.includes('..')) {
        throw new StorageUploadError(
          'INVALID_FILE',
          `Invalid storage path segment for ${label}.`
        );
      }
      return clean;
    };

    const orgId = seg(params.organizationId, 'organizationId');
    const compId = seg(params.competitionId, 'competitionId');
    const subId = seg(params.submissionId, 'submissionId');
    const fId = seg(params.fileId, 'fileId');
    const name = seg(params.sanitizedFileName, 'sanitizedFileName');

    return `organizations/${orgId}/competitions/${compId}/submissions/${subId}/${fId}_${name}`;
  }

  /**
   * Parses and validates a canonical tenant-scoped storage path.
   */
  public parseCanonicalStoragePath(storagePath: string): {
    organizationId: string;
    competitionId: string;
    submissionId: string;
    objectName: string;
  } | null {
    const match = CANONICAL_PATH_REGEX.exec((storagePath || '').trim());
    if (!match) return null;
    return {
      organizationId: match[1],
      competitionId: match[2],
      submissionId: match[3],
      objectName: match[4],
    };
  }

  /**
   * Inspects binary buffer headers (magic bytes) to determine genuine file type.
   * NEVER trusts client MIME type or extension alone.
   */
  public detectFileTypeFromBytes(bytes: Uint8Array): { mimeType: string; isExecutable: boolean } {
    if (bytes.length < 4) {
      // Allow tiny valid plain-text / JSON files (>= 1 byte printable ASCII)
      let isAscii = bytes.length > 0;
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) {
          isAscii = false;
          break;
        }
      }
      return { mimeType: isAscii ? 'text/plain' : 'application/octet-stream', isExecutable: false };
    }

    // Windows PE Executable (MZ)
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
      return { mimeType: 'application/x-dosexec', isExecutable: true };
    }

    // Linux ELF Executable (\x7fELF)
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      return { mimeType: 'application/x-executable', isExecutable: true };
    }

    // Mach-O Executable
    if (
      (bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && bytes[3] === 0xce) ||
      (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe)
    ) {
      return { mimeType: 'application/x-mach-binary', isExecutable: true };
    }

    // Java Bytecode Class (CA FE BA BE)
    if (bytes[0] === 0xca && bytes[1] === 0xfe && bytes[2] === 0xba && bytes[3] === 0xbe) {
      return { mimeType: 'application/java-vm', isExecutable: true };
    }

    // PDF (%PDF-)
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return { mimeType: 'application/pdf', isExecutable: false };
    }

    // PNG (\x89PNG\r\n\x1a\n)
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return { mimeType: 'image/png', isExecutable: false };
    }

    // JPEG (\xFF\xD8\xFF)
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mimeType: 'image/jpeg', isExecutable: false };
    }

    // WEBP (RIFF....WEBP)
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return { mimeType: 'image/webp', isExecutable: false };
    }

    // ZIP (PK\x03\x04 / PK\x05\x06 / PK\x07\x08) — also covers .pptx
    if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08))
    ) {
      return { mimeType: 'application/zip', isExecutable: false };
    }

    // Microsoft Office OLE2 (.ppt)
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      return { mimeType: 'application/vnd.ms-powerpoint', isExecutable: false };
    }

    // Text / Markdown / JSON heuristic
    let isAsciiText = true;
    const checkLength = Math.min(bytes.length, 512);
    for (let i = 0; i < checkLength; i++) {
      const b = bytes[i];
      if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) {
        isAsciiText = false;
        break;
      }
    }

    if (isAsciiText) {
      return { mimeType: 'text/plain', isExecutable: false };
    }

    return { mimeType: 'application/octet-stream', isExecutable: false };
  }

  /**
   * Validates a file's byte contents against size limits, dangerous executables,
   * officially supported formats, magic-byte headers, and allowed extension lists.
   */
  public async validateFile(
    fileOrBytes: File | { name: string; size: number; bytes: Uint8Array; type?: string },
    options: { allowedExtensions?: string[]; maxSizeMb?: number; strictStorageFormats?: boolean } = {}
  ): Promise<FileValidationResult> {
    const fileName = this.sanitizeFileName(fileOrBytes.name);
    const fileSize = fileOrBytes.size;
    const effectiveMaxMb = Math.min(options.maxSizeMb || MAX_STORAGE_FILE_SIZE_MB, MAX_STORAGE_FILE_SIZE_MB);
    const maxSizeBytes = effectiveMaxMb * 1024 * 1024;

    if (fileSize > maxSizeBytes) {
      return {
        valid: false,
        errorCode: 'FILE_TOO_LARGE',
        error: `File "${fileName}" exceeds maximum allowed size of ${effectiveMaxMb}MB (actual: ${(fileSize / (1024 * 1024)).toFixed(2)}MB).`,
      };
    }

    if (fileSize <= 0) {
      return {
        valid: false,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" is empty (0 bytes).`,
      };
    }

    const lowerName = fileName.toLowerCase();
    if (DANGEROUS_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      return {
        valid: false,
        errorCode: 'UNSUPPORTED_FORMAT',
        error: 'Executable file extensions are strictly prohibited for security.',
      };
    }

    const extMatch = /\.([a-z0-9]+)$/i.exec(lowerName);
    const fileExt = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
    if (!fileExt) {
      return {
        valid: false,
        errorCode: 'UNSUPPORTED_FORMAT',
        error: `File "${fileName}" must have a valid supported file extension.`,
      };
    }

    // Always enforce officially supported format list when strictStorageFormats is true (default for uploads)
    const officialMime = OFFICIAL_SUPPORTED_FORMATS[fileExt];
    if (options.strictStorageFormats && !officialMime) {
      return {
        valid: false,
        errorCode: 'UNSUPPORTED_FORMAT',
        error: `Unsupported file format "${fileExt}". Supported formats: ${Object.keys(OFFICIAL_SUPPORTED_FORMATS).join(', ')}.`,
      };
    }

    if (options.allowedExtensions && options.allowedExtensions.length > 0) {
      const normalizedAllowed = options.allowedExtensions.map((ext) =>
        ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
      );
      if (!normalizedAllowed.includes(fileExt)) {
        return {
          valid: false,
          errorCode: 'UNSUPPORTED_FORMAT',
          error: `File extension for "${fileName}" is not allowed. Allowed types: ${options.allowedExtensions.join(', ')}`,
        };
      }
    } else if (!officialMime) {
      return {
        valid: false,
        errorCode: 'UNSUPPORTED_FORMAT',
        error: `Unsupported file format "${fileExt}". Supported formats: ${Object.keys(OFFICIAL_SUPPORTED_FORMATS).join(', ')}.`,
      };
    }

    const bytes = await this.extractBytes(fileOrBytes);
    const { mimeType, isExecutable } = this.detectFileTypeFromBytes(bytes);

    if (isExecutable) {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" contains executable binary code (${mimeType}), which is prohibited.`,
      };
    }

    // Check for disguised extensions against magic bytes
    if (fileExt === '.pdf' && mimeType !== 'application/pdf') {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" does not have valid PDF headers (detected: ${mimeType}).`,
      };
    }
    if (fileExt === '.zip' && mimeType !== 'application/zip') {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" does not have valid ZIP headers (detected: ${mimeType}).`,
      };
    }
    if (fileExt === '.png' && mimeType !== 'image/png') {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" does not have valid PNG headers (detected: ${mimeType}).`,
      };
    }
    if ((fileExt === '.jpg' || fileExt === '.jpeg') && mimeType !== 'image/jpeg') {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" does not have valid JPEG headers (detected: ${mimeType}).`,
      };
    }
    if (fileExt === '.webp' && mimeType !== 'image/webp') {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" does not have valid WEBP headers (detected: ${mimeType}).`,
      };
    }
    if (
      fileExt === '.pptx' &&
      mimeType !== 'application/zip' &&
      mimeType !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation' &&
      mimeType !== 'application/octet-stream' &&
      mimeType !== 'text/plain'
    ) {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" does not have valid PPTX headers (detected: ${mimeType}).`,
      };
    }
    if (
      fileExt === '.ppt' &&
      mimeType !== 'application/vnd.ms-powerpoint' &&
      mimeType !== 'application/octet-stream' &&
      mimeType !== 'application/zip' &&
      mimeType !== 'text/plain'
    ) {
      return {
        valid: false,
        detectedMimeType: mimeType,
        errorCode: 'INVALID_FILE',
        error: `File "${fileName}" does not have valid PowerPoint headers (detected: ${mimeType}).`,
      };
    }

    return {
      valid: true,
      detectedMimeType: mimeType,
      resolvedMimeType: officialMime || mimeType,
    };
  }

  /**
   * Executes the real 9-step persistent upload workflow:
   * - Default backend `'firestore-chunks'` (Firebase Spark 100% free tier, <= 8 MB/file, 700 KB native binary chunks)
   * - Optional backend `'firebase-storage'` (Firebase Blaze Cloud Storage bucket, <= 25 MB/file)
   *
   * 1. Validate file, magic bytes, backend-specific size limit, and allowed extensions.
   * 2. Verify submission authorization context (org, competition, submission, uploader/session).
   * 3. Compute genuine full-file SHA-256 checksum.
   * 4. Detect duplicate uploads (existing & in-flight).
   * 5. Generate safe unique tenant-scoped canonical path.
   * 6. Upload actual bytes with progress tracking, cancellation, and retry on transient failures.
   * 7. Confirm persistence & exact byte length (getDoc/getMetadata for authenticated uploaders, server commit for write-only sessions).
   * 8. Construct trusted metadata (NEVER blob: URLs, NEVER permanent public download URLs).
   * 9. Return persistent StoredFileMetadata reference.
   */
  public async uploadFile(
    fileOrBytes: File | { name: string; size: number; bytes: Uint8Array; type?: string },
    options: FileUploadOptions
  ): Promise<StoredFileMetadata> {
    const backend = this.resolveUploadBackend(options);
    const backendMaxSizeMb = this.getActiveMaxFileSizeMb(backend);
    const effectiveMaxSizeMb = options.maxSizeMb
      ? Math.min(options.maxSizeMb, backendMaxSizeMb)
      : backendMaxSizeMb;

    // 1. Validate file format, magic bytes, and size
    const validation = await this.validateFile(fileOrBytes, {
      allowedExtensions: options.allowedExtensions,
      maxSizeMb: effectiveMaxSizeMb,
      strictStorageFormats: true,
    });

    if (!validation.valid) {
      throw new StorageUploadError(
        validation.errorCode || 'INVALID_FILE',
        validation.error || 'File validation failed.'
      );
    }

    // 2. Verify authorization context before uploading
    if (!options.organizationId || !options.competitionId || !options.submissionId) {
      throw new StorageUploadError(
        'UNAUTHORIZED',
        'Upload requires organizationId, competitionId, and submissionId.'
      );
    }
    if (!options.uploaderUid && !options.participantSessionId) {
      throw new StorageUploadError(
        'UNAUTHORIZED',
        'Participant submission authorization (authenticated user or scoped participant session) is required before uploading files.'
      );
    }

    if (options.abortSignal?.aborted) {
      throw new StorageUploadError('CANCELLED', 'Upload was cancelled before transfer began.');
    }

    // 3. Resolve real Firebase backend instance (ZERO mock success!)
    const firestoreInstance =
      backend === 'firestore-chunks'
        ? options.firestoreInstance || (isFirebaseConfigured() ? defaultFirestore : null)
        : null;
    const storageInstance =
      backend === 'firebase-storage'
        ? options.storageInstance || (isFirebaseConfigured() ? defaultStorage : null)
        : null;

    if (backend === 'firestore-chunks' && !firestoreInstance) {
      throw new StorageUploadError(
        'STORAGE_UNAVAILABLE',
        'Cloud Firestore is not initialized or configured. Files cannot be marked as uploaded without live Firestore.'
      );
    }
    if (backend === 'firebase-storage' && !storageInstance) {
      throw new StorageUploadError(
        'STORAGE_UNAVAILABLE',
        'Firebase Storage is not initialized or configured. Files cannot be marked as uploaded without live Firebase Storage.'
      );
    }

    const originalFileName = fileOrBytes.name;
    const sanitizedName = this.sanitizeFileName(originalFileName);
    const bytes = await this.extractBytes(fileOrBytes);

    // 4. Compute full-file SHA-256 checksum
    const checksum = await sha256Bytes(bytes);

    // 5. Duplicate upload protection (already uploaded or currently uploading)
    const duplicateExisting = (options.existingFiles || []).find(
      (f) => f.uploadStatus === 'UPLOADED' && f.checksum && f.checksum === checksum
    );
    if (duplicateExisting) {
      throw new StorageUploadError(
        'DUPLICATE_FILE',
        `File "${sanitizedName}" is a duplicate of already uploaded file "${duplicateExisting.fileName}" (matching SHA-256).`
      );
    }

    const inflightKey = `${options.submissionId}:${checksum}`;
    if (this.inFlightKeys.has(inflightKey)) {
      throw new StorageUploadError(
        'DUPLICATE_FILE',
        `Upload for "${sanitizedName}" is already in progress.`
      );
    }

    // 6. Generate unique tenant-scoped canonical storage path
    const fileId = `file_${generateSecureToken(8)}`;
    const storagePath = this.buildCanonicalStoragePath({
      organizationId: options.organizationId,
      competitionId: options.competitionId,
      submissionId: options.submissionId,
      fileId,
      sanitizedFileName: sanitizedName,
    });

    const resolvedMimeType =
      validation.resolvedMimeType ||
      OFFICIAL_SUPPORTED_FORMATS[
        `.${sanitizedName.split('.').pop()?.toLowerCase() || ''}`
      ] ||
      validation.detectedMimeType ||
      'application/octet-stream';

    const uploadedBy = options.uploaderUid
      ? `uid:${options.uploaderUid}`
      : `session:${options.participantSessionId!.slice(0, 8)}`;

    const maxRetries = options.maxRetries ?? 2;

    this.inFlightKeys.add(inflightKey);
    try {
      if (backend === 'firestore-chunks') {
        return await this.uploadViaFirestoreChunks({
          firestore: firestoreInstance!,
          fileId,
          fieldId: options.fieldId,
          organizationId: options.organizationId,
          competitionId: options.competitionId,
          submissionId: options.submissionId,
          originalFileName,
          sanitizedName,
          bytes,
          checksum,
          resolvedMimeType,
          detectedMimeType: validation.detectedMimeType,
          storagePath,
          uploadedBy,
          uploaderUid: options.uploaderUid,
          participantSessionId: options.participantSessionId,
          maxRetries,
          onProgress: options.onProgress,
          abortSignal: options.abortSignal,
        });
      }

      // Optional Firebase Storage (Blaze) backend
      const customMetadata: Record<string, string> = {
        fileId,
        originalFileName: originalFileName.slice(0, 180),
        sanitizedFileName: sanitizedName,
        organizationId: options.organizationId,
        competitionId: options.competitionId,
        submissionId: options.submissionId,
        checksum,
        uploadedBy,
      };
      if (options.participantSessionId) {
        customMetadata.sessionId = options.participantSessionId;
      }

      const storageRef = ref(storageInstance!, storagePath);
      let lastError: StorageUploadError | null = null;
      let commitMeta: FullMetadata | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (options.abortSignal?.aborted) {
          throw new StorageUploadError('CANCELLED', 'Upload cancelled by user.');
        }

        try {
          commitMeta = await this.executeResumableUpload(
            storageRef,
            bytes,
            {
              contentType: resolvedMimeType,
              contentDisposition: `attachment; filename="${sanitizedName}"`,
              customMetadata,
            },
            fileId,
            sanitizedName,
            options.onProgress,
            options.abortSignal
          );
          break;
        } catch (err) {
          const mapped = mapFirebaseStorageError(err);
          lastError = mapped;
          if (!mapped.retryable || attempt === maxRetries) {
            throw mapped;
          }
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }

      if (!commitMeta) {
        throw lastError || new StorageUploadError('NETWORK_ERROR', 'Upload failed.');
      }

      // 7. Confirm actual existence and exact byte size in Firebase Storage.
      let remoteMeta: FullMetadata = commitMeta;
      if (options.uploaderUid) {
        try {
          remoteMeta = await getMetadata(storageRef);
        } catch (err) {
          throw mapFirebaseStorageError(err);
        }
      }

      if (
        !remoteMeta ||
        remoteMeta.size !== bytes.byteLength ||
        remoteMeta.fullPath !== storagePath
      ) {
        throw new StorageUploadError(
          'VERIFICATION_FAILED',
          `Stored artifact verification mismatch (expected ${bytes.byteLength} bytes at ${storagePath}, stored ${remoteMeta?.size ?? 0} bytes at ${remoteMeta?.fullPath ?? 'unknown'}).`
        );
      }

      // 8 & 9. Return trusted persistent metadata (NO blob: URL, NO public download URL)
      return {
        id: fileId,
        fieldId: options.fieldId,
        originalFileName,
        fileName: sanitizedName,
        fileSize: remoteMeta.size,
        mimeType: resolvedMimeType,
        detectedMimeType: validation.detectedMimeType,
        storagePath,
        storageBackend: 'firebase-storage',
        downloadUrl: '', // Private artifacts never expose permanent public download URLs
        uploadedAt: remoteMeta.timeCreated || new Date().toISOString(),
        uploadedBy,
        organizationId: options.organizationId,
        competitionId: options.competitionId,
        submissionId: options.submissionId,
        uploadStatus: 'UPLOADED',
        checksum,
        isVerified: true,
      };
    } finally {
      this.inFlightKeys.delete(inflightKey);
      this.activeTasks.delete(fileId);
      this.activeFirestoreAborts.delete(fileId);
    }
  }

  /**
   * Cancels an active in-flight upload task by fileId (works for both Spark Firestore chunks & Firebase Storage).
   */
  public cancelUpload(fileId: string): boolean {
    const task = this.activeTasks.get(fileId);
    if (task) {
      return task.cancel();
    }
    const controller = this.activeFirestoreAborts.get(fileId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Spark-compatible persistent binary upload: splits bytes into <= 700 KB native Firestore `Bytes` chunks,
   * writes chunks first (with per-chunk progress, cancellation & retry), and commits the immutable manifest last
   * so partial/abandoned uploads NEVER appear as uploaded.
   */
  private async uploadViaFirestoreChunks(params: {
    firestore: Firestore;
    fileId: string;
    fieldId: string;
    organizationId: string;
    competitionId: string;
    submissionId: string;
    originalFileName: string;
    sanitizedName: string;
    bytes: Uint8Array;
    checksum: string;
    resolvedMimeType: string;
    detectedMimeType?: string;
    storagePath: string;
    uploadedBy: string;
    uploaderUid?: string;
    participantSessionId?: string;
    maxRetries: number;
    onProgress?: (progress: UploadProgressState) => void;
    abortSignal?: AbortSignal;
  }): Promise<StoredFileMetadata> {
    const {
      firestore,
      fileId,
      fieldId,
      organizationId,
      competitionId,
      submissionId,
      originalFileName,
      sanitizedName,
      bytes,
      checksum,
      resolvedMimeType,
      detectedMimeType,
      storagePath,
      uploadedBy,
      uploaderUid,
      participantSessionId,
      maxRetries,
      onProgress,
      abortSignal,
    } = params;

    const totalBytes = bytes.byteLength;
    const chunkCount = Math.ceil(totalBytes / FIRESTORE_CHUNK_SIZE_BYTES);
    const internalAbort = new AbortController();
    this.activeFirestoreAborts.set(fileId, internalAbort);

    const isAborted = () => Boolean(abortSignal?.aborted || internalAbort.signal.aborted);

    const writeWithRetry = async (writeOp: () => Promise<void>) => {
      let lastErr: StorageUploadError | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (isAborted()) {
          throw new StorageUploadError('CANCELLED', 'File upload was cancelled.');
        }
        try {
          await writeOp();
          return;
        } catch (err) {
          const mapped = mapFirebaseStorageError(err);
          lastErr = mapped;
          if (!mapped.retryable || attempt === maxRetries) {
            throw mapped;
          }
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
      throw lastErr || new StorageUploadError('NETWORK_ERROR', 'Chunk write failed.');
    };

    try {
      onProgress?.({
        fileId,
        fileName: sanitizedName,
        bytesTransferred: 0,
        totalBytes,
        percent: 0,
        state: 'running',
      });

      let bytesTransferred = 0;

      // 1. Write binary chunks 0..chunkCount-1 concurrently (3 in-flight parallel writes)
      const CONCURRENCY = Math.min(3, chunkCount);
      let nextChunkIndex = 0;

      const uploadWorker = async () => {
        while (nextChunkIndex < chunkCount) {
          if (isAborted()) {
            throw new StorageUploadError('CANCELLED', 'File upload was cancelled.');
          }
          const chunkIndex = nextChunkIndex++;
          const start = chunkIndex * FIRESTORE_CHUNK_SIZE_BYTES;
          const end = Math.min(start + FIRESTORE_CHUNK_SIZE_BYTES, totalBytes);
          const slice = bytes.subarray(start, end);

          const chunkDocRef = doc(
            firestore,
            'submissionArtifacts',
            fileId,
            'chunks',
            String(chunkIndex)
          );
          const chunkPayload: Record<string, unknown> = {
            artifactId: fileId,
            organizationId,
            competitionId,
            submissionId,
            chunkIndex,
            byteLength: slice.byteLength,
            data: Bytes.fromUint8Array(slice),
          };
          if (participantSessionId) {
            chunkPayload.sessionId = participantSessionId;
          }

          await writeWithRetry(() => setDoc(chunkDocRef, chunkPayload));

          bytesTransferred += slice.byteLength;
          const percent = Math.min(95, Math.round((bytesTransferred / totalBytes) * 95));
          onProgress?.({
            fileId,
            fileName: sanitizedName,
            bytesTransferred,
            totalBytes,
            percent,
            state: 'running',
          });
        }
      };

      const workers = Array.from({ length: CONCURRENCY }, () => uploadWorker());
      await Promise.all(workers);

      if (isAborted()) {
        throw new StorageUploadError('CANCELLED', 'File upload was cancelled.');
      }

      // 2. Commit immutable artifact manifest doc AFTER all chunks succeed
      const uploadedAt = new Date().toISOString();
      const manifestRef = doc(firestore, 'submissionArtifacts', fileId);
      const manifestPayload: Record<string, unknown> = {
        id: fileId,
        fieldId,
        organizationId,
        competitionId,
        submissionId,
        originalFileName: originalFileName.slice(0, 180),
        fileName: sanitizedName,
        fileSize: totalBytes,
        mimeType: resolvedMimeType,
        detectedMimeType: detectedMimeType || resolvedMimeType,
        storagePath,
        storageBackend: 'firestore-chunks',
        chunkCount,
        chunkSizeBytes: FIRESTORE_CHUNK_SIZE_BYTES,
        checksum,
        uploadedBy,
        uploadedAt,
        uploadStatus: 'UPLOADED',
        isVerified: true,
      };
      if (participantSessionId) {
        manifestPayload.sessionId = participantSessionId;
      }

      await writeWithRetry(() => setDoc(manifestRef, manifestPayload));

      // 3. For authenticated uploaders (who hold read permission), confirm persistence via getDoc()
      if (uploaderUid) {
        try {
          const snap = await getDoc(manifestRef);
          const remote = snap.data();
          if (
            !snap.exists() ||
            !remote ||
            remote.fileSize !== totalBytes ||
            remote.chunkCount !== chunkCount ||
            remote.checksum !== checksum
          ) {
            throw new StorageUploadError(
              'VERIFICATION_FAILED',
              'Firestore artifact manifest verification failed after upload.'
            );
          }
        } catch (err) {
          throw mapFirebaseStorageError(err);
        }
      }

      onProgress?.({
        fileId,
        fileName: sanitizedName,
        bytesTransferred: totalBytes,
        totalBytes,
        percent: 100,
        state: 'success',
      });

      return {
        id: fileId,
        fieldId,
        originalFileName,
        fileName: sanitizedName,
        fileSize: totalBytes,
        mimeType: resolvedMimeType,
        detectedMimeType,
        storagePath,
        storageBackend: 'firestore-chunks',
        chunkCount,
        downloadUrl: '', // Private artifacts never expose permanent public download URLs
        uploadedAt,
        uploadedBy,
        organizationId,
        competitionId,
        submissionId,
        uploadStatus: 'UPLOADED',
        checksum,
        isVerified: true,
      };
    } catch (err) {
      const mapped = mapFirebaseStorageError(err);
      onProgress?.({
        fileId,
        fileName: sanitizedName,
        bytesTransferred: 0,
        totalBytes,
        percent: 0,
        state: mapped.code === 'CANCELLED' ? 'canceled' : 'error',
      });
      throw mapped;
    }
  }

  /**
   * Securely downloads an artifact's raw bytes from Firebase Storage after verifying
   * caller authorization (org/comp role, judge assignment, or participant ownership)
   * AND verifying full-file SHA-256 checksum integrity.
   */
  public async downloadFileBytes(
    fileMeta: StoredFileMetadata,
    authCtx: AuthorizedDownloadContext = {}
  ): Promise<DownloadedArtifact> {
    if (
      (fileMeta.downloadUrl && fileMeta.downloadUrl.startsWith('blob:')) ||
      (fileMeta.downloadUrl && fileMeta.downloadUrl.includes('storage.proofly.internal')) ||
      fileMeta.uploadStatus === 'REUPLOAD_REQUIRED'
    ) {
      throw new StorageUploadError(
        'REUPLOAD_REQUIRED',
        `File "${fileMeta.fileName}" references an unrecoverable legacy local/blob URL and must be re-uploaded.`
      );
    }

    const parsedPath = this.parseCanonicalStoragePath(fileMeta.storagePath);
    if (!parsedPath) {
      throw new StorageUploadError(
        'REUPLOAD_REQUIRED',
        `File "${fileMeta.fileName}" has a non-canonical legacy storage path ("${fileMeta.storagePath}") and must be migrated or re-uploaded.`
      );
    }

    // 1. Client-side pre-authorization check (in addition to server-side storage.rules!)
    if (!authCtx.skipClientPrecheck) {
      const isParticipantOwner =
        Boolean(authCtx.participantUid) &&
        fileMeta.uploadedBy === `uid:${authCtx.participantUid}`;

      if (!isParticipantOwner) {
        if (!authCtx.verifiedSession) {
          throw new StorageUploadError(
            'UNAUTHORIZED',
            'Sign in with an authorized organizer, assigned judge, or owner account to download private submission artifacts.'
          );
        }

        const decision = await authorizationService.authorizeOperation(authCtx.verifiedSession, {
          operation: 'SUBMISSION_READ',
          organizationId: parsedPath.organizationId,
          competitionId: parsedPath.competitionId,
        });

        if (!decision.allowed) {
          throw new StorageUploadError(
            'PERMISSION_DENIED',
            decision.reason || 'Access denied to submission artifact.'
          );
        }

        // Enforce strict Judge assignment isolation when caller's resolved role is JUDGE
        if (
          decision.resolvedCompetitionRole === 'JUDGE' &&
          decision.resolvedOrgRole !== 'OWNER' &&
          decision.resolvedOrgRole !== 'ADMIN' &&
          decision.resolvedOrgRole !== 'SUPER_ADMIN'
        ) {
          if (
            !Array.isArray(authCtx.assignedJudgeIds) ||
            !authCtx.assignedJudgeIds.includes(authCtx.verifiedSession.uid)
          ) {
            throw new StorageUploadError(
              'PERMISSION_DENIED',
              'Judges may only access artifacts for submissions explicitly assigned to them.'
            );
          }
        }
      }
    }

    const backend = this.resolveDownloadBackend(fileMeta, authCtx);

    // 2A. Spark Free Tier Backend: Fetch manifest + native Bytes chunks from Firestore (enforces firestore.rules!)
    if (backend === 'firestore-chunks') {
      const firestoreInstance =
        authCtx.firestoreInstance || (isFirebaseConfigured() ? defaultFirestore : null);
      if (!firestoreInstance) {
        throw new StorageUploadError('STORAGE_UNAVAILABLE', 'Cloud Firestore is not configured.');
      }

      try {
        const manifestRef = doc(firestoreInstance, 'submissionArtifacts', fileMeta.id);
        const manifestSnap = await getDoc(manifestRef);
        if (!manifestSnap.exists()) {
          throw new StorageUploadError(
            'VERIFICATION_FAILED',
            `Artifact manifest for "${fileMeta.fileName}" was not found in Firestore.`
          );
        }

        const manifest = manifestSnap.data() as {
          fileSize: number;
          chunkCount: number;
          checksum: string;
          mimeType?: string;
          fileName?: string;
        };

        if (
          typeof manifest.chunkCount !== 'number' ||
          manifest.chunkCount < 1 ||
          typeof manifest.fileSize !== 'number' ||
          manifest.fileSize <= 0
        ) {
          throw new StorageUploadError(
            'VERIFICATION_FAILED',
            `Artifact manifest for "${fileMeta.fileName}" is malformed.`
          );
        }

        const chunkSnaps = await Promise.all(
          Array.from({ length: manifest.chunkCount }, (_, idx) =>
            getDoc(
              doc(firestoreInstance, 'submissionArtifacts', fileMeta.id, 'chunks', String(idx))
            )
          )
        );

        const assembled = new Uint8Array(manifest.fileSize);
        let offset = 0;

        for (let idx = 0; idx < manifest.chunkCount; idx++) {
          const snap = chunkSnaps[idx];
          if (!snap.exists()) {
            throw new StorageUploadError(
              'VERIFICATION_FAILED',
              `Missing chunk ${idx + 1}/${manifest.chunkCount} for "${fileMeta.fileName}".`
            );
          }
          const chunkData = snap.data() as { data?: Bytes | Uint8Array; byteLength?: number };
          const rawBytes =
            chunkData.data instanceof Uint8Array
              ? chunkData.data
              : typeof chunkData.data?.toUint8Array === 'function'
                ? chunkData.data.toUint8Array()
                : null;

          if (!rawBytes || rawBytes.byteLength === 0) {
            throw new StorageUploadError(
              'VERIFICATION_FAILED',
              `Corrupt binary chunk ${idx + 1}/${manifest.chunkCount} for "${fileMeta.fileName}".`
            );
          }
          if (offset + rawBytes.byteLength > manifest.fileSize) {
            throw new StorageUploadError(
              'VERIFICATION_FAILED',
              `Chunk byte overflow while reassembling "${fileMeta.fileName}".`
            );
          }
          assembled.set(rawBytes, offset);
          offset += rawBytes.byteLength;
        }

        if (offset !== manifest.fileSize) {
          throw new StorageUploadError(
            'VERIFICATION_FAILED',
            `Reassembled byte length mismatch for "${fileMeta.fileName}" (expected ${manifest.fileSize}, got ${offset}).`
          );
        }

        // 3. Verify full-file SHA-256 integrity against BOTH Firestore manifest and submission metadata
        const actualChecksum = await sha256Bytes(assembled);
        if (manifest.checksum && actualChecksum !== manifest.checksum) {
          throw new StorageUploadError(
            'VERIFICATION_FAILED',
            `Checksum mismatch against Firestore manifest for "${fileMeta.fileName}".`
          );
        }
        if (
          fileMeta.checksum &&
          fileMeta.checksum.length === 64 &&
          actualChecksum !== fileMeta.checksum
        ) {
          throw new StorageUploadError(
            'VERIFICATION_FAILED',
            `Checksum mismatch while downloading "${fileMeta.fileName}". Artifact integrity check failed.`
          );
        }

        return {
          bytes: assembled,
          mimeType: manifest.mimeType || fileMeta.mimeType || 'application/octet-stream',
          fileName: manifest.fileName || fileMeta.fileName,
          storagePath: fileMeta.storagePath,
          verifiedChecksum: actualChecksum,
        };
      } catch (err) {
        throw mapFirebaseStorageError(err);
      }
    }

    // 2B. Optional Blaze Backend: Fetch bytes directly through Firebase Storage SDK (enforces storage.rules!)
    const storageInstance =
      authCtx.storageInstance || (isFirebaseConfigured() ? defaultStorage : null);
    if (!storageInstance) {
      throw new StorageUploadError(
        'STORAGE_UNAVAILABLE',
        'Firebase Storage is not configured.'
      );
    }

    try {
      const storageRef = ref(storageInstance, fileMeta.storagePath);
      const buffer = await getBytes(storageRef, MAX_STORAGE_FILE_SIZE_MB * 1024 * 1024);
      const bytes = new Uint8Array(buffer);

      // 3. Verify SHA-256 integrity
      const actualChecksum = await sha256Bytes(bytes);
      if (fileMeta.checksum && fileMeta.checksum.length === 64 && actualChecksum !== fileMeta.checksum) {
        throw new StorageUploadError(
          'VERIFICATION_FAILED',
          `Checksum mismatch while downloading "${fileMeta.fileName}". Artifact integrity check failed.`
        );
      }

      return {
        bytes,
        mimeType: fileMeta.mimeType || 'application/octet-stream',
        fileName: fileMeta.fileName,
        storagePath: fileMeta.storagePath,
        verifiedChecksum: actualChecksum,
      };
    } catch (err) {
      throw mapFirebaseStorageError(err);
    }
  }

  /**
   * Triggers a secure browser download dialog using transient memory that is immediately revoked.
   * Never persists blob: URLs or exposes permanent public Storage URLs.
   */
  public async triggerBrowserDownload(
    fileMeta: StoredFileMetadata,
    authCtx: AuthorizedDownloadContext
  ): Promise<void> {
    const artifact = await this.downloadFileBytes(fileMeta, authCtx);
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const copy = new Uint8Array(artifact.bytes.byteLength);
    copy.set(artifact.bytes);
    const transientBlob = new Blob([copy.buffer], { type: artifact.mimeType });
    const transientUrl = URL.createObjectURL(transientBlob);
    try {
      const link = document.createElement('a');
      link.href = transientUrl;
      link.download = artifact.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(transientUrl), 1000);
    }
  }

  private async extractBytes(
    fileOrBytes: File | { name: string; size: number; bytes: Uint8Array }
  ): Promise<Uint8Array> {
    if ('bytes' in fileOrBytes && fileOrBytes.bytes instanceof Uint8Array) {
      return fileOrBytes.bytes;
    }
    const buffer = await (fileOrBytes as File).arrayBuffer();
    return new Uint8Array(buffer);
  }

  private executeResumableUpload(
    storageRef: ReturnType<typeof ref>,
    bytes: Uint8Array,
    metadata: {
      contentType: string;
      contentDisposition: string;
      customMetadata: Record<string, string>;
    },
    fileId: string,
    fileName: string,
    onProgress?: (progress: UploadProgressState) => void,
    abortSignal?: AbortSignal
  ): Promise<FullMetadata> {
    return new Promise<FullMetadata>((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, bytes, metadata);
      this.activeTasks.set(fileId, task);

      const handleAbort = () => {
        task.cancel();
      };
      if (abortSignal) {
        if (abortSignal.aborted) {
          task.cancel();
          reject(new StorageUploadError('CANCELLED', 'Upload cancelled.'));
          return;
        }
        abortSignal.addEventListener('abort', handleAbort, { once: true });
      }

      const cleanup = () => {
        if (abortSignal) {
          abortSignal.removeEventListener('abort', handleAbort);
        }
      };

      task.on(
        'state_changed',
        (snapshot) => {
          const percent =
            snapshot.totalBytes > 0
              ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
              : 0;
          onProgress?.({
            fileId,
            fileName,
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
            percent,
            state: snapshot.state as UploadProgressState['state'],
          });
        },
        (err) => {
          cleanup();
          onProgress?.({
            fileId,
            fileName,
            bytesTransferred: 0,
            totalBytes: bytes.byteLength,
            percent: 0,
            state: (err as { code?: string })?.code === 'storage/canceled' ? 'canceled' : 'error',
          });
          reject(mapFirebaseStorageError(err));
        },
        () => {
          cleanup();
          onProgress?.({
            fileId,
            fileName,
            bytesTransferred: bytes.byteLength,
            totalBytes: bytes.byteLength,
            percent: 100,
            state: 'success',
          });
          resolve(task.snapshot.metadata);
        }
      );
    });
  }
}

export const fileStorageService = new FileStorageService();
