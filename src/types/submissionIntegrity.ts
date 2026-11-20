// ─────────────────────────────────────────────
// submissionIntegrity.ts — Domain Types for Proofly Phase 13
// Submission Integrity, Repository Snapshots, Provenance & Duplicate Detection
// ─────────────────────────────────────────────

export type RepositoryVisibility = 'PUBLIC' | 'PRIVATE' | 'UNKNOWN';

export type RepositoryAccessMethod =
  | 'ANONYMOUS_PUBLIC'
  | 'AUTHENTICATED_TOKEN'
  | 'FIXTURE_EVALUATION'
  | 'SIMULATED';

export interface InspectedFileDetail {
  path: string;
  lineCount?: number;
  byteSize?: number;
  inspectedAt: string;
}

/**
 * 1. REPOSITORY SNAPSHOT
 * Exact commit reference captured during submission and evaluation.
 * Never evaluates a moving branch without locking the exact commit SHA.
 */
export interface RepositorySnapshot {
  repositoryIdentity: string; // e.g. "owner/repo"
  owner: string;
  repoName: string;
  repoUrl: string;
  defaultBranch: string;
  commitSha: string; // Exact 40-character commit SHA used for evaluation
  commitTimestamp: string;
  commitMessage?: string;
  commitAuthor?: string;
  snapshotTimestamp: string;
  visibility: RepositoryVisibility;
  accessMethod: RepositoryAccessMethod;
  filesInspected: InspectedFileDetail[];
  inspectedFileCount: number;
  /** Explicit indicator: statically inspected candidate files only; not a full repository clone. */
  isPartialInspection: boolean;
  /** Warning if submission provided a moving branch name without explicit commit locking. */
  isMovingBranchWarning?: boolean;
}

export interface CommitSummary {
  sha: string;
  timestamp: string;
  message: string;
  author: string;
  isAfterDeadline: boolean;
}

export interface ChangedFileDetail {
  filename: string;
  status: 'added' | 'modified' | 'removed';
  additions?: number;
  deletions?: number;
}

/**
 * 2. POST-DEADLINE CHANGE COMPARISON
 * Compares submitted commit against current latest commit.
 * Mandatory advisory: Never automatically assumes a post-deadline commit is misconduct.
 */
export interface PostDeadlineComparison {
  deadline: string;
  submittedCommitSha: string;
  submittedCommitTimestamp: string;
  currentCommitSha: string;
  currentCommitTimestamp: string;
  hasPostDeadlineCommits: boolean;
  postDeadlineCommitCount: number;
  postDeadlineCommits: CommitSummary[];
  changedFilesCount: number;
  changedFiles: ChangedFileDetail[];
  organizerAdvisoryNote: string;
}

export interface FileReplacementAudit {
  replacementTimestamp: string;
  previousSha256: string;
  newSha256: string;
  reason?: string;
  replacedBy: string;
}

export interface FileVersionRecord {
  versionNumber: number;
  sha256: string;
  fileSize: number;
  timestamp: string;
}

/**
 * 3. ARTIFACT INTEGRITY
 * Verifies uploaded artifacts using cryptographic SHA-256 digests.
 */
export interface ArtifactIntegrityRecord {
  fileId: string;
  originalFileName: string;
  sanitizedFileName: string;
  fileSize: number;
  mimeType: string;
  originalSha256: string;
  uploadTimestamp: string;
  isVerified: boolean;
  verifiedAt?: string;
  replacementHistory: FileReplacementAudit[];
  versionHistory: FileVersionRecord[];
  isTamperedOrModified?: boolean;
}

export type DuplicateMatchType =
  | 'EXACT_ARTIFACT_HASH'
  | 'SHARED_REPOSITORY'
  | 'SHARED_COMMIT_SHA'
  | 'HIGH_SIMILARITY';

/**
 * 4. DUPLICATE & SIMILARITY DETECTION
 * Flagged strictly for human review. Never treated as an automated plagiarism verdict.
 */
export interface DuplicateDetectionMatch {
  matchedSubmissionId: string;
  matchedReferenceId: string;
  matchedProjectTitle: string;
  matchedTeamOrAuthor: string;
  matchType: DuplicateMatchType;
  confidenceScore: number; // 0 to 100
  matchedArtifacts?: string[];
  matchedCommitSha?: string;
  matchedRepoUrl?: string;
  similarityDetails?: {
    titleSimilarity: number;
    descriptionSimilarity: number;
    technologiesOverlap: number;
  };
  humanReviewNotice: string;
}

export type IntegrityVerificationStatus =
  | 'VERIFIED_INTACT'
  | 'POST_DEADLINE_CHANGES'
  | 'DUPLICATE_SUSPECTED'
  | 'ARTIFACT_TAMPERED_OR_MODIFIED'
  | 'ACCESS_LIMITED'
  | 'PENDING_INSPECTION';

export interface IntegrityAdministrativeAction {
  id: string;
  action: 'ACCEPT_POST_DEADLINE_CHANGES' | 'DISMISS_DUPLICATE_FLAG' | 'PIN_COMMIT_OVERRIDE' | 'RE_VERIFY';
  actorId: string;
  actorName: string;
  actorRole: string;
  timestamp: string;
  rationale: string;
  metadata?: Record<string, unknown>;
}

/**
 * 5. COMPREHENSIVE SUBMISSION INTEGRITY REPORT
 */
export interface SubmissionIntegrityReport {
  id: string;
  submissionId: string;
  referenceId: string;
  projectTitle: string;
  competitionId: string;
  organizationId: string;
  status: IntegrityVerificationStatus;
  repositorySnapshot?: RepositorySnapshot;
  postDeadlineComparison?: PostDeadlineComparison;
  artifactIntegrityRecords: ArtifactIntegrityRecord[];
  duplicateMatches: DuplicateDetectionMatch[];
  accessLimitations: string[];
  warnings: string[];
  administrativeActions: IntegrityAdministrativeAction[];
  generatedAt: string;
  lastVerifiedAt: string;
}
