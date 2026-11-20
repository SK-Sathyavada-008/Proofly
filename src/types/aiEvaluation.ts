// ─────────────────────────────────────────────
// aiEvaluation.ts — AI-Powered Evaluation Engine Domain Types
// Proofly / Evalora — Phase 6
// ─────────────────────────────────────────────

import type { InferenceTelemetry } from '../services/aiLogicService';
import type {
  EvidenceReference,
  NormalizedExtractionResult,
  ExtractionStatus,
  ArtifactType,
  EvidenceClassification,
} from '../services/extractors/types';

export type {
  EvidenceReference,
  NormalizedExtractionResult,
  ExtractionStatus,
  ArtifactType,
  EvidenceClassification,
};

/**
 * Explicit evaluation outcome separating real AI from fallbacks and failures.
 */
export type EvaluationOutcome =
  | 'AI_COMPLETED'
  | 'DETERMINISTIC_FALLBACK'
  | 'AI_FAILED'
  | 'EXTRACTION_INCOMPLETE'
  | 'AWAITING_REVIEW';

/**
 * Rubric criterion configured by organizers.
 */
export interface RubricCriterionConfig {
  id: string;
  name: string;
  description: string;
  weight: number; // Percentage (sum across rubric = 100%)
  maxScore: number; // e.g. 25
  scoringGuidance?: string;
  requiredEvidence?: string[];
}

/**
 * Immutable rubric version captured when an evaluation is performed.
 */
export interface RubricVersion {
  versionNumber: number;
  competitionId: string;
  criteria: RubricCriterionConfig[];
  totalMaxScore: number;
  capturedAt: string;
}

/**
 * Extracted document or artifact item from participant submission.
 */
export interface ExtractedDocumentItem {
  fileId: string;
  fileName: string;
  mimeType: string;
  extractedText?: string;
  wordCount: number;
  extractionStatus: ExtractionStatus;
  notes?: string;
  evidenceReferences?: EvidenceReference[];
  contentHash?: string;
  normalizedResult?: NormalizedExtractionResult;
  pageCount?: number;
  slideCount?: number;
}

/**
 * Structured evidence packet gathered across all submission inputs.
 */
export interface StructuredEvidencePacket {
  submissionId: string;
  referenceId: string;
  competitionId: string;
  projectTitle: string;
  projectDescription: string;
  track?: string;
  problemStatement?: string;
  solution?: string;
  technologiesUsed: string[];
  githubMetadata?: {
    repoUrl: string;
    accessible: boolean;
    owner?: string;
    repoName?: string;
    readmeContent?: string;
    starsCount?: number;
    inaccessibleReason?: string;
    commitSha?: string;
    branch?: string;
    inspectedFiles?: string[];
  };
  deploymentMetadata?: {
    url: string;
    accessible: boolean;
    inaccessibleReason?: string;
    httpStatus?: number;
    responseTimeMs?: number;
    reachabilityChecked?: boolean;
    disclaimer?: string;
  };
  videoMetadata?: {
    url: string;
    platform: 'youtube' | 'vimeo' | 'loom' | 'direct' | 'other';
    disclaimer: string;
    inspected?: boolean;
  };
  documentContents: ExtractedDocumentItem[];
  allEvidenceReferences?: EvidenceReference[];
  normalizedExtractions?: NormalizedExtractionResult[];
  evidenceDisclaimers: string[];
  assembledAt: string;
}

/**
 * Individual rubric dimension evaluation returned by AI Logic.
 */
export interface CriterionEvaluationResult {
  criterionId: string;
  criterionName: string;
  suggestedScore: number;
  maxScore: number;
  weight: number;
  explanation?: string;
  positiveObservations: string[];
  evidenceReferences: string[];
  weaknesses: string[];
  exactDeductionExplanations: string[];
  missingEvidence: string[];
  uncertainty?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceJustification?: string;
  limitations: string[];
  questionsForJudge?: string[];
  evidenceClassifications: {
    claim: string;
    classification: EvidenceClassification;
    rationale: string;
  }[];
}

export interface TrackRelevanceSummary {
  selectedTrack: string;
  isOpenTrack: boolean;
  isAligned: boolean;
  penaltyApplied: number;
  assessmentNote: string;
}

/**
 * Full AI Evaluation Report.
 */
export interface AiEvaluationReport {
  id: string;
  submissionId: string;
  referenceId: string;
  competitionId: string;
  rubricVersion: RubricVersion;
  overallScore: number;
  totalMaxScore: number;
  percentageScore: number;
  executiveSummary: string;
  strongestAspects: string[];
  areasToImprove: string[];
  evidenceGaps: string[];
  evaluationWarnings: string[];
  criteriaEvaluations: CriterionEvaluationResult[];
  trackRelevance?: TrackRelevanceSummary;
  telemetry: InferenceTelemetry;
  rawResponseText?: string;
  evaluatedAt: string;
  isImmutable: boolean;
  evaluationOutcome?: EvaluationOutcome;
  requestId?: string;
  disclosures?: string[];
}

/**
 * Canonical evaluation job lifecycle states per Phase 05 specification.
 */
export type EvaluationJobStatus =
  | 'QUEUED'
  | 'CLAIMED'
  | 'EXTRACTING'
  | 'EVALUATING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRY_WAIT'
  | 'CANCELLED'
  // Backward-compatibility aliases
  | 'LEASED'
  | 'IN_PROGRESS';

/**
 * Supported evaluation job types.
 */
export type EvaluationJobType =
  | 'EVALUATION'
  | 'VERIFICATION'
  | 'RE_EVALUATION'
  | 'STAGE_EXTRACTION'
  | 'STAGE_VALIDATION';

/**
 * Structured error classification for evaluation failures.
 * Distinguishes retryable transient failures from fatal permanent issues.
 */
export type EvaluationJobErrorClassification =
  | 'NETWORK_TRANSIENT'
  | 'RATE_LIMIT'
  | 'INVALID_INPUT'
  | 'PERMISSION_ERROR'
  | 'MODEL_ERROR'
  | 'UNSUPPORTED_ARTIFACT'
  | 'PERMANENT_FAILURE';

/**
 * Audit trail entry for evaluation job retries with backoff.
 */
export interface EvaluationJobRetryEntry {
  attempt: number;
  workerId: string;
  errorClassification: EvaluationJobErrorClassification;
  error: string;
  timestamp: string;
  backoffMs: number;
}

/**
 * Determines whether a classified evaluation error is eligible for retry with backoff.
 */
export function isEvaluationErrorRetryable(
  classification?: EvaluationJobErrorClassification | null
): boolean {
  if (!classification) return false;
  return (
    classification === 'NETWORK_TRANSIENT' ||
    classification === 'RATE_LIMIT' ||
    classification === 'MODEL_ERROR'
  );
}

/**
 * Concurrency-safe Evaluation Job for the background queue.
 * Stored in Firestore `/evaluationJobs/{jobId}` with server timestamps.
 */
export interface AiEvaluationJob {
  id: string;
  submissionId: string;
  referenceId: string;
  competitionId: string;
  organizationId: string;
  rubricVersion: number;
  jobType: EvaluationJobType;
  status: EvaluationJobStatus;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  leaseExpiresAt?: string | null;
  leaseOwnerId?: string | null;
  errorClassification?: EvaluationJobErrorClassification | null;
  errorDetails?: string | null;
  resultReportId?: string | null;
  idempotencyKey: string;
  backoffUntilMs?: number;
  retryHistory?: EvaluationJobRetryEntry[];

  // Backward-compatibility aliases
  attempts: number;
  lastError?: string;
  reportId?: string;
}
