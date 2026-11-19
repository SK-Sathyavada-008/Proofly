// ─────────────────────────────────────────────
// submission.ts — Anonymous Participant Submission Models
// Proofly — Phase 5
// ─────────────────────────────────────────────

export type SubmissionType = 'INDIVIDUAL' | 'TEAM';

export type SubmissionStatus =
  | 'Draft'
  | 'Submitted'
  | 'Validating'
  | 'Queued for AI Evaluation'
  | 'AI Evaluation In Progress'
  | 'AI Evaluation Complete'
  | 'AI Evaluation Failed'
  | 'Ready for Judge Review'
  | 'Under Human Review'
  | 'Evaluated'
  | 'Finalized';

export const ALL_SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'Draft',
  'Submitted',
  'Validating',
  'Queued for AI Evaluation',
  'AI Evaluation In Progress',
  'AI Evaluation Complete',
  'AI Evaluation Failed',
  'Ready for Judge Review',
  'Under Human Review',
  'Evaluated',
  'Finalized',
] as const;

export interface ParticipantRecord {
  id: string;
  competitionId: string;
  organizationId: string;
  submissionId?: string;
  teamId?: string;
  name: string;
  email?: string;
  role?: string; // e.g. "Lead Developer", "Designer", "Solo Creator"
  githubUsername?: string;
  isLead: boolean;
  source: 'FORM_SUBMISSION' | 'ORGANIZER_MANUAL' | 'CSV_IMPORT';
  createdAt: string;
}

export interface TeamRecord {
  id: string;
  competitionId: string;
  organizationId: string;
  submissionId?: string;
  name: string;
  memberCount: number;
  leadParticipantId?: string;
  leadEmail?: string;
  memberIds: string[];
  members: ParticipantRecord[];
  source: 'FORM_SUBMISSION' | 'ORGANIZER_MANUAL' | 'CSV_IMPORT';
  createdAt: string;
  updatedAt: string;
}

export type FileUploadStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REUPLOAD_REQUIRED';

export type StorageBackendType = 'firestore-chunks' | 'firebase-storage';

export interface StoredFileMetadata {
  id: string;
  fieldId: string;
  originalFileName?: string;
  fileName: string; // Sanitized filename
  fileSize: number; // in bytes
  mimeType: string;
  detectedMimeType?: string;
  storagePath: string; // Canonical: organizations/{orgId}/competitions/{compId}/submissions/{subId}/{fileId}_{sanitizedName}
  storageBackend?: StorageBackendType; // 'firestore-chunks' (Spark free tier default) | 'firebase-storage' (Blaze bucket)
  chunkCount?: number; // Populated for 'firestore-chunks' binary chunk artifacts
  /** Empty for private artifacts (never persist blob: URLs or permanent public URLs). */
  downloadUrl: string;
  uploadedAt: string;
  uploadedBy?: string; // Authenticated UID or scoped participant session identifier
  organizationId?: string;
  competitionId?: string;
  submissionId?: string;
  uploadStatus?: FileUploadStatus;
  checksum?: string; // Full-file SHA-256 hex digest
  isVerified: boolean;
}

export interface SubmissionVersion {
  versionNumber: number;
  submittedAt: string;
  statusAtVersion: SubmissionStatus;
  fieldValues: Record<string, any>;
  files: StoredFileMetadata[];
  changeSummary?: string;
}

export interface AiFailureOverride {
  overriddenBy: string; // Organizer user ID
  overriddenByName: string;
  overriddenAt: string;
  reason: string;
  justificationNotes?: string;
}

export interface ProjectSubmission {
  id: string;
  referenceId: string; // e.g. "PF-SUB-2026-X9K2L"
  competitionId: string;
  organizationId: string;
  roundId?: string;
  formSchemaId: string;
  
  // Access Attribution
  accessKeyId?: string;
  sessionTokenId?: string;
  participantSessionId?: string;
  
  // Submission Type & Team
  submissionType: SubmissionType;
  teamId?: string;
  teamName?: string;
  participants: ParticipantRecord[];
  primaryContactName: string;
  primaryContactEmail?: string;
  
  // Core Standard Artifacts (Mirrored for fast query, display, & AI prompt building)
  projectTitle: string;
  projectDescription: string;
  track?: string;
  problemStatement?: string;
  solution?: string;
  technologiesUsed: string[];
  githubUrl?: string;
  deploymentUrl?: string;
  videoUrl?: string;
  
  // Dynamic Form Field Answers (keyed by fieldId)
  fieldValues: Record<string, any>;
  
  // File Artifacts
  files: StoredFileMetadata[];
  
  // Status & State Machine
  status: SubmissionStatus;
  statusHistory: {
    status: SubmissionStatus;
    changedAt: string;
    changedBy: string; // "participant", "system", or user ID
    note?: string;
  }[];
  
  // Deadline & Late Policy
  submittedAt?: string;
  isLate: boolean;
  isLocked: boolean;
  
  // Versioning
  currentVersion: number;
  versions: SubmissionVersion[];
  
  // Cryptographic Access & Ownership
  // CRITICAL: Raw token is never saved in Firestore; only its SHA-256 hash!
  managementTokenHash: string;
  managementTokenPrefix: string; // e.g. "sec_ab"
  
  // AI Evaluation Gate
  aiEvaluationId?: string;
  aiScore?: number;
  aiCompletedAt?: string;
  aiFailureOverride?: AiFailureOverride;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionCreationPayload {
  competitionId: string;
  sessionToken: string;
  submissionType: SubmissionType;
  teamName?: string;
  primaryContactName: string;
  primaryContactEmail?: string;
  participants?: {
    name: string;
    email?: string;
    role?: string;
    githubUsername?: string;
    isLead?: boolean;
  }[];
  projectTitle: string;
  projectDescription: string;
  track?: string;
  problemStatement?: string;
  solution?: string;
  technologiesUsed?: string[];
  githubUrl?: string;
  deploymentUrl?: string;
  videoUrl?: string;
  fieldValues: Record<string, any>;
  files?: StoredFileMetadata[];
  isDraft?: boolean;
}

export interface SubmissionCreationResult {
  submission: ProjectSubmission;
  rawManagementToken: string; // Returned ONLY ONCE to participant
  referenceId: string;
  managementUrl: string;
}
