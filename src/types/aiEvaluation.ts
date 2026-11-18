// ─────────────────────────────────────────────
// aiEvaluation.ts — AI-Powered Evaluation Engine Domain Types
// Proofly / Evalora — Phase 6
// ─────────────────────────────────────────────

import type { InferenceTelemetry } from '../services/aiLogicService';

/**
 * Strict evidence classification per hackathon guidelines.
 * Models must never invent evidence or claim uninspected files were analyzed.
 */
export type EvidenceClassification =
  | 'EVIDENCE_VERIFIED'
  | 'FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED'
  | 'FEATURE_DEMONSTRABLY_ABSENT'
  | 'EVIDENCE_UNAVAILABLE'
  | 'CONTENT_UNCLEAR'
  | 'TECHNICAL_BEHAVIOR_NOT_TESTED';

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
  extractionStatus: 'EXTRACTED' | 'UNSUPPORTED_BINARY' | 'INACCESSIBLE' | 'EMPTY';
  notes?: string;
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
  };
  deploymentMetadata?: {
    url: string;
    accessible: boolean;
    inaccessibleReason?: string;
  };
  videoMetadata?: {
    url: string;
    platform: 'youtube' | 'vimeo' | 'loom' | 'direct' | 'other';
    disclaimer: string;
  };
  documentContents: ExtractedDocumentItem[];
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
  positiveObservations: string[];
  evidenceReferences: string[];
  weaknesses: string[];
  exactDeductionExplanations: string[];
  missingEvidence: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  limitations: string[];
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
}

/**
 * Concurrency-safe Evaluation Job for the background queue.
 */
export interface AiEvaluationJob {
  id: string;
  submissionId: string;
  referenceId: string;
  competitionId: string;
  status: 'QUEUED' | 'LEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  leaseOwnerId?: string;
  leaseExpiresAt?: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  reportId?: string;
  createdAt: string;
  updatedAt: string;
}
