// ─────────────────────────────────────────────
// extractors/types.ts — Normalized Artifact Extraction & Evidence Provenance Types
// Proofly Phase 06 — Modular Multi-Modal Extraction Engine
// ─────────────────────────────────────────────

/**
 * Supported artifact types for multimodal evaluation.
 */
export type ArtifactType =
  | 'PDF'
  | 'PPTX'
  | 'GITHUB_REPO'
  | 'DEPLOYMENT_URL'
  | 'VIDEO_URL'
  | 'ZIP_ARCHIVE'
  | 'TEXT_MARKDOWN';

/**
 * Honest, traceable extraction status taxonomy.
 * Extraction failures and uninspected assets are NEVER converted into verified evidence.
 */
export type ExtractionStatus =
  | 'EXTRACTED'
  | 'PARTIALLY_EXTRACTED'
  | 'UNSUPPORTED'
  | 'INACCESSIBLE'
  | 'EXTRACTION_FAILED'
  | 'REQUIRES_OCR'
  | 'NOT_INSPECTED'
  // Backward-compatibility aliases
  | 'UNSUPPORTED_BINARY'
  | 'EMPTY';

/**
 * Precise location pointer within an extracted artifact.
 * Examples: PDF page 4, PPTX slide 7, src/services/auth.ts lines 30-45 at commit SHA.
 */
export interface EvidenceLocation {
  pageNumber?: number;
  slideNumber?: number;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  commitSha?: string;
  sectionHeading?: string;
}

/**
 * Traceable, verified evidence reference linked to an exact source artifact.
 */
export interface EvidenceReference {
  id: string;
  artifactId: string;
  artifactType: ArtifactType;
  location: EvidenceLocation;
  snippet: string;
  description?: string;
}

/**
 * Structured metadata specific to an extraction run.
 */
export interface ExtractionMetadata {
  pageCount?: number;
  slideCount?: number;
  fileCount?: number;
  totalWordCount?: number;
  commitSha?: string;
  branch?: string;
  inspectedFiles?: string[];
  skippedFiles?: string[];
  isScanned?: boolean;
  ocrRequired?: boolean;
  reachability?: {
    httpStatus?: number;
    isReachable: boolean;
    redirectUrl?: string;
    responseTimeMs?: number;
    checkedUrl?: string;
  };
  securityFlags?: {
    zipBombDetected?: boolean;
    pathTraversalDetected?: boolean;
    executableFilesDetected?: string[];
    ssrfBlocked?: boolean;
  };
  [key: string]: unknown;
}

/**
 * Normalized extraction result returned by every extractor in the pipeline.
 */
export interface NormalizedExtractionResult {
  artifactId: string;
  artifactType: ArtifactType;
  originalNameOrUrl: string;
  status: ExtractionStatus;
  extractedContent: string;
  evidenceReferences: EvidenceReference[];
  metadata?: ExtractionMetadata;
  extractionTimestamp: string;
  extractorVersion: string;
  warnings: string[];
  errors: string[];
  contentHash: string; // SHA-256 of extracted text or input payload
}

/**
 * Contract for a modular artifact extractor.
 */
export interface ArtifactExtractor<TInput = unknown> {
  readonly name: string;
  readonly version: string;
  readonly supportedTypes: ArtifactType[];
  canHandle(type: ArtifactType, filenameOrUrl: string): boolean;
  extract(input: TInput, options?: Record<string, unknown>): Promise<NormalizedExtractionResult>;
}
