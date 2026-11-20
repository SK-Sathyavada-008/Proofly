// ─────────────────────────────────────────────
// evidenceExplorerService.ts — Evidence Explorer & AI Traceability Service
// Proofly Phase 11 — Multimodal Evidence Provenance, Judge Annotations & Security
// ─────────────────────────────────────────────

import type {
  EvidenceReference,
  EvidenceClassification,
  StructuredEvidencePacket,
  CriterionEvaluationResult,
  ArtifactType,
  ExtractionStatus,
} from '../types/aiEvaluation';
import type { JudgeEvidenceAnnotation } from '../types/judgeAndEvaluation';
import type { StoredFileMetadata } from '../types/submission';
import { fileStorageService, type AuthorizedDownloadContext } from './fileStorageService';

export interface LocationValidationResult {
  isValid: boolean;
  error?: string;
  locationDetails: string;
}

export interface EvidenceClassificationDetails {
  classification: EvidenceClassification;
  label: string;
  explanation: string;
  badgeVariant: 'success' | 'warning' | 'danger' | 'neutral' | 'purple' | 'primary';
}

export interface EvidenceFilterOptions {
  searchQuery?: string;
  classification?: EvidenceClassification | 'ALL';
  artifactType?: ArtifactType | 'ALL';
  onlyFlagged?: boolean;
  onlyRelevant?: boolean;
}

export class EvidenceExplorerService {
  // In-memory cache of judge annotations: submissionId -> (judgeId -> (evidenceId -> JudgeEvidenceAnnotation))
  private annotationsMap = new Map<string, Map<string, Map<string, JudgeEvidenceAnnotation>>>();

  // ─────────────────────────────────────────────
  // 1. CONSISTENT EVIDENCE MODEL & NORMALIZATION
  // ─────────────────────────────────────────────

  /**
   * Normalizes an evidence reference into the canonical Proofly Phase 11 consistent evidence model.
   */
  public normalizeEvidenceReference(
    ref: Partial<EvidenceReference> & { id: string; artifactId: string; artifactType: ArtifactType },
    fallback?: Partial<EvidenceReference>
  ): EvidenceReference {
    const loc = ref.location || fallback?.location || {};
    const formattedLocation = this.formatSourceLocation({
      ...fallback,
      ...ref,
      location: loc,
    } as EvidenceReference);

    const locationRef = this.formatLocationReference({
      ...fallback,
      ...ref,
      location: loc,
    } as EvidenceReference);

    const passage =
      ref.extractedPassage ||
      ref.snippet ||
      fallback?.extractedPassage ||
      fallback?.snippet ||
      '';

    const status: ExtractionStatus =
      ref.extractionStatus || fallback?.extractionStatus || 'EXTRACTED';

    const classification =
      ref.classification ||
      fallback?.classification ||
      this.inferEvidenceClassification({
        artifactType: ref.artifactType,
        location: loc,
        status,
        passage,
      });

    return {
      id: ref.id,
      submissionId: ref.submissionId || fallback?.submissionId || '',
      artifactId: ref.artifactId,
      artifactType: ref.artifactType,
      sourceLocation: ref.sourceLocation || formattedLocation,
      locationReference: ref.locationReference || locationRef,
      location: loc,
      snippet: passage.slice(0, 300),
      extractedPassage: passage,
      contentHash: ref.contentHash || fallback?.contentHash || 'unhashed',
      extractionStatus: status,
      extractionTimestamp:
        ref.extractionTimestamp || fallback?.extractionTimestamp || new Date().toISOString(),
      classification,
      metadata: ref.metadata || fallback?.metadata || {},
      description: ref.description || fallback?.description || `${ref.artifactType} reference`,
    };
  }

  /**
   * Extracts and normalizes all evidence references from a structured evidence packet.
   */
  public buildConsistentEvidenceReferences(
    packet: StructuredEvidencePacket
  ): EvidenceReference[] {
    const results: EvidenceReference[] = [];
    const seenIds = new Set<string>();

    const candidateRefs = packet.allEvidenceReferences || [];

    for (const rawRef of candidateRefs) {
      if (seenIds.has(rawRef.id)) continue;
      seenIds.add(rawRef.id);

      const matchingDoc = packet.documentContents?.find((d) => d.fileId === rawRef.artifactId);

      const normalized = this.normalizeEvidenceReference(rawRef, {
        submissionId: packet.submissionId,
        contentHash: matchingDoc?.contentHash || rawRef.contentHash,
        extractionStatus: matchingDoc?.extractionStatus || rawRef.extractionStatus,
        extractionTimestamp: packet.assembledAt,
      });

      results.push(normalized);
    }

    return results;
  }

  /**
   * Formats a clean, human-readable source location string.
   * e.g. "Page 4", "Slide 7", "src/services/auth.ts lines 30–45", "README.md # Architecture"
   */
  public formatSourceLocation(ref: Partial<EvidenceReference>): string {
    const loc = ref.location;
    if (!loc) return ref.artifactType ? `${ref.artifactType} Asset` : 'Unknown Source';

    if (ref.artifactType === 'PDF' && loc.pageNumber !== undefined) {
      return loc.sectionHeading
        ? `PDF Page ${loc.pageNumber} (${loc.sectionHeading})`
        : `PDF Page ${loc.pageNumber}`;
    }

    if (ref.artifactType === 'PPTX' && loc.slideNumber !== undefined) {
      return loc.sectionHeading
        ? `Slide ${loc.slideNumber}: ${loc.sectionHeading}`
        : `Slide ${loc.slideNumber}`;
    }

    if (ref.artifactType === 'GITHUB_REPO' || ref.artifactType === 'TEXT_MARKDOWN') {
      const file = loc.filePath || 'Source File';
      if (loc.startLine !== undefined && loc.endLine !== undefined) {
        const lineSpan =
          loc.startLine === loc.endLine
            ? `line ${loc.startLine}`
            : `lines ${loc.startLine}–${loc.endLine}`;
        return loc.commitSha
          ? `${file} (${lineSpan}) @ ${loc.commitSha.slice(0, 7)}`
          : `${file} (${lineSpan})`;
      }
      if (loc.sectionHeading) {
        return `${file} #${loc.sectionHeading}`;
      }
      return file;
    }

    if (ref.artifactType === 'DEPLOYMENT_URL') {
      return 'Live Web Deployment';
    }

    if (ref.artifactType === 'VIDEO_URL') {
      return 'Submitted Demo Video';
    }

    if (ref.artifactType === 'ZIP_ARCHIVE') {
      return loc.filePath ? `ZIP / ${loc.filePath}` : 'ZIP Archive Root';
    }

    return 'Submitted Artifact';
  }

  /**
   * Formats a short location reference pointer (e.g. "p. 4", "slide 2", "lines 10–25").
   */
  public formatLocationReference(ref: Partial<EvidenceReference>): string {
    const loc = ref.location;
    if (!loc) return '';

    if (loc.pageNumber !== undefined) {
      return `p. ${loc.pageNumber}`;
    }
    if (loc.slideNumber !== undefined) {
      return `slide ${loc.slideNumber}`;
    }
    if (loc.startLine !== undefined && loc.endLine !== undefined) {
      return loc.startLine === loc.endLine
        ? `line ${loc.startLine}`
        : `lines ${loc.startLine}–${loc.endLine}`;
    }
    if (loc.sectionHeading) {
      return `#${loc.sectionHeading}`;
    }
    if (loc.filePath) {
      return loc.filePath.split('/').pop() || loc.filePath;
    }
    return '';
  }

  // ─────────────────────────────────────────────
  // 2. EVIDENCE CLASSIFICATION TAXONOMY
  // ─────────────────────────────────────────────

  /**
   * Provides user-facing label, explanation, and visual badge variant for each classification.
   */
  public getClassificationDetails(
    classification?: EvidenceClassification
  ): EvidenceClassificationDetails {
    switch (classification) {
      case 'VERIFIED_EVIDENCE':
      case 'EVIDENCE_VERIFIED':
        return {
          classification: 'VERIFIED_EVIDENCE',
          label: 'Verified Evidence',
          explanation:
            'Independently verified against extracted source files, slides, or documents with traceable provenance.',
          badgeVariant: 'success',
        };

      case 'CLAIM_ONLY':
      case 'FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED':
        return {
          classification: 'CLAIM_ONLY',
          label: 'Claim Only',
          explanation:
            'Self-declared assertion (e.g. in README or project summary) without supporting implementation code or proof.',
          badgeVariant: 'warning',
        };

      case 'MISSING_EVIDENCE':
      case 'FEATURE_DEMONSTRABLY_ABSENT':
        return {
          classification: 'MISSING_EVIDENCE',
          label: 'Missing Evidence',
          explanation:
            'No trace or implementation was detected in submitted artifacts for this required rubric dimension.',
          badgeVariant: 'danger',
        };

      case 'INACCESSIBLE_EVIDENCE':
      case 'EVIDENCE_UNAVAILABLE':
        return {
          classification: 'INACCESSIBLE_EVIDENCE',
          label: 'Inaccessible Evidence',
          explanation:
            'Target repository, URL, or uploaded binary could not be parsed, was rate-limited, private, or unreachable.',
          badgeVariant: 'neutral',
        };

      case 'UNCLEAR_EVIDENCE':
      case 'CONTENT_UNCLEAR':
        return {
          classification: 'UNCLEAR_EVIDENCE',
          label: 'Unclear Evidence',
          explanation:
            'Extracted content is fragmented, ambiguous, corrupted, or lacks adequate context to substantiate the claim.',
          badgeVariant: 'purple',
        };

      case 'NOT_INSPECTED':
      case 'TECHNICAL_BEHAVIOR_NOT_TESTED':
      default:
        return {
          classification: 'NOT_INSPECTED',
          label: 'Not Inspected',
          explanation:
            'Artifact (e.g. video demo, external binary payload) was not statically decompiled or evaluated.',
          badgeVariant: 'primary',
        };
    }
  }

  /**
   * Automatically infers classification based on artifact metadata and extraction status.
   */
  private inferEvidenceClassification(params: {
    artifactType: ArtifactType;
    location: any;
    status: ExtractionStatus;
    passage: string;
  }): EvidenceClassification {
    if (params.status === 'INACCESSIBLE' || params.status === 'EXTRACTION_FAILED') {
      return 'INACCESSIBLE_EVIDENCE';
    }
    if (params.status === 'NOT_INSPECTED' || params.artifactType === 'VIDEO_URL') {
      return 'NOT_INSPECTED';
    }
    if (params.status === 'REQUIRES_OCR' || params.status === 'EMPTY') {
      return 'UNCLEAR_EVIDENCE';
    }

    // Critical Rule: README claims are NOT verified features!
    if (
      params.location?.filePath?.toLowerCase().includes('readme') ||
      params.location?.sectionHeading?.toLowerCase().includes('readme')
    ) {
      return 'CLAIM_ONLY';
    }

    if (params.passage && params.passage.trim().length > 15) {
      return 'VERIFIED_EVIDENCE';
    }

    return 'UNCLEAR_EVIDENCE';
  }

  // ─────────────────────────────────────────────
  // 3. LOCATION & BOUNDS VALIDATION
  // ─────────────────────────────────────────────

  /**
   * Validates whether an evidence reference points to valid bounds within an artifact.
   * Catches invalid page numbers, missing/deleted files, and out-of-range lines.
   */
  public validateEvidenceLocation(
    evidence: EvidenceReference,
    artifactMeta?: {
      fileExists?: boolean;
      isDeleted?: boolean;
      pageCount?: number;
      slideCount?: number;
      totalLines?: number;
    }
  ): LocationValidationResult {
    const loc = evidence.location;

    // 1. Missing or deleted file check
    if (artifactMeta?.isDeleted) {
      return {
        isValid: false,
        error: `Artifact file has been deleted from competition storage.`,
        locationDetails: this.formatSourceLocation(evidence),
      };
    }
    if (artifactMeta && artifactMeta.fileExists === false) {
      return {
        isValid: false,
        error: `Artifact file not found in submission payload.`,
        locationDetails: this.formatSourceLocation(evidence),
      };
    }

    // 2. Inaccessible artifact check
    if (evidence.extractionStatus === 'INACCESSIBLE' || evidence.extractionStatus === 'EXTRACTION_FAILED') {
      return {
        isValid: false,
        error: `Evidence is inaccessible: extraction failed or resource was unreachable.`,
        locationDetails: this.formatSourceLocation(evidence),
      };
    }

    // 3. PDF Page bounds check
    if (evidence.artifactType === 'PDF') {
      if (loc.pageNumber === undefined || loc.pageNumber <= 0) {
        return {
          isValid: false,
          error: `Invalid PDF page reference (${loc.pageNumber}). Page numbers must be >= 1.`,
          locationDetails: this.formatSourceLocation(evidence),
        };
      }
      if (artifactMeta?.pageCount !== undefined && loc.pageNumber > artifactMeta.pageCount) {
        return {
          isValid: false,
          error: `Page number ${loc.pageNumber} exceeds total PDF document page count (${artifactMeta.pageCount}).`,
          locationDetails: this.formatSourceLocation(evidence),
        };
      }
    }

    // 4. PPTX Slide bounds check
    if (evidence.artifactType === 'PPTX') {
      if (loc.slideNumber === undefined || loc.slideNumber <= 0) {
        return {
          isValid: false,
          error: `Invalid PPTX slide reference (${loc.slideNumber}). Slide numbers must be >= 1.`,
          locationDetails: this.formatSourceLocation(evidence),
        };
      }
      if (artifactMeta?.slideCount !== undefined && loc.slideNumber > artifactMeta.slideCount) {
        return {
          isValid: false,
          error: `Slide number ${loc.slideNumber} exceeds total presentation slide count (${artifactMeta.slideCount}).`,
          locationDetails: this.formatSourceLocation(evidence),
        };
      }
    }

    // 5. Source code line bounds check
    if (evidence.artifactType === 'GITHUB_REPO' || evidence.artifactType === 'TEXT_MARKDOWN') {
      if (loc.startLine !== undefined && loc.startLine <= 0) {
        return {
          isValid: false,
          error: `Invalid start line (${loc.startLine}). Line numbers must be >= 1.`,
          locationDetails: this.formatSourceLocation(evidence),
        };
      }
      if (loc.startLine !== undefined && loc.endLine !== undefined && loc.endLine < loc.startLine) {
        return {
          isValid: false,
          error: `Invalid line range: end line (${loc.endLine}) cannot be smaller than start line (${loc.startLine}).`,
          locationDetails: this.formatSourceLocation(evidence),
        };
      }
      if (artifactMeta?.totalLines !== undefined && loc.endLine !== undefined && loc.endLine > artifactMeta.totalLines) {
        return {
          isValid: false,
          error: `End line ${loc.endLine} exceeds file total lines count (${artifactMeta.totalLines}).`,
          locationDetails: this.formatSourceLocation(evidence),
        };
      }
    }

    return {
      isValid: true,
      locationDetails: this.formatSourceLocation(evidence),
    };
  }

  // ─────────────────────────────────────────────
  // 4. SECURITY & AUTHORIZATION GATE
  // ─────────────────────────────────────────────

  /**
   * Verifies that the judge has permission to inspect evidence from this submission.
   * Respects organization boundaries, competition admin roles, and judge assignments.
   */
  public checkJudgeArtifactAccess(params: {
    judgeId: string;
    submissionId: string;
    organizationId?: string;
    isOrganizer?: boolean;
    assignedJudgeIds?: string[];
  }): { allowed: boolean; reason?: string } {
    if (!params.judgeId || !params.judgeId.trim()) {
      return { allowed: false, reason: 'Authentication required. Missing judge identifier.' };
    }

    if (params.isOrganizer) {
      return { allowed: true };
    }

    if (params.assignedJudgeIds && params.assignedJudgeIds.length > 0) {
      if (params.assignedJudgeIds.includes(params.judgeId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Access denied: You are not assigned to evaluate this submission.',
      };
    }

    // If no specific assignment array passed, allow authenticated review (e.g. self-assigned judge)
    return { allowed: true };
  }

  /**
   * Securely loads file bytes for evidence preview using transient memory, never exposing raw storage paths.
   */
  public async getSecureArtifactPreview(
    fileMeta: StoredFileMetadata,
    authCtx: AuthorizedDownloadContext
  ): Promise<{ bytes: Uint8Array; mimeType: string; verifiedChecksum: string }> {
    return fileStorageService.downloadFileBytes(fileMeta, authCtx);
  }

  // ─────────────────────────────────────────────
  // 5. JUDGE INTERACTIONS & ANNOTATIONS (SEPARATE FROM AI)
  // ─────────────────────────────────────────────

  /**
   * Saves or updates a judge's annotation on an evidence reference.
   * STRICT GUARANTEE: Stored separately; NEVER mutates original evidence references or AI report.
   */
  public saveJudgeAnnotation(annotation: JudgeEvidenceAnnotation): JudgeEvidenceAnnotation {
    const { submissionId, judgeId, evidenceId } = annotation;

    if (!submissionId || !judgeId || !evidenceId) {
      throw new Error('Invalid annotation: submissionId, judgeId, and evidenceId are required.');
    }

    if (!this.annotationsMap.has(submissionId)) {
      this.annotationsMap.set(submissionId, new Map());
    }
    const subMap = this.annotationsMap.get(submissionId)!;

    if (!subMap.has(judgeId)) {
      subMap.set(judgeId, new Map());
    }
    const judgeMap = subMap.get(judgeId)!;

    const existing = judgeMap.get(evidenceId) || {
      evidenceId,
      judgeId,
      submissionId,
      updatedAt: new Date().toISOString(),
    };

    const updated: JudgeEvidenceAnnotation = {
      ...existing,
      ...annotation,
      updatedAt: new Date().toISOString(),
    };

    judgeMap.set(evidenceId, updated);
    return updated;
  }

  /**
   * Retrieves all annotations created by a judge for a specific submission.
   */
  public getJudgeAnnotations(
    submissionId: string,
    judgeId: string
  ): Record<string, JudgeEvidenceAnnotation> {
    const result: Record<string, JudgeEvidenceAnnotation> = {};
    const subMap = this.annotationsMap.get(submissionId);
    if (!subMap) return result;

    const judgeMap = subMap.get(judgeId);
    if (!judgeMap) return result;

    for (const [k, v] of judgeMap.entries()) {
      result[k] = { ...v };
    }
    return result;
  }

  /**
   * Helper: toggles relevance of an evidence item.
   */
  public markEvidenceRelevance(params: {
    evidenceId: string;
    judgeId: string;
    submissionId: string;
    isRelevant: boolean;
  }): JudgeEvidenceAnnotation {
    return this.saveJudgeAnnotation({
      ...params,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Helper: flags an incorrect evidence association made by the AI.
   */
  public flagIncorrectEvidence(params: {
    evidenceId: string;
    judgeId: string;
    submissionId: string;
    notes?: string;
  }): JudgeEvidenceAnnotation {
    return this.saveJudgeAnnotation({
      evidenceId: params.evidenceId,
      judgeId: params.judgeId,
      submissionId: params.submissionId,
      flaggedIncorrect: true,
      notes: params.notes,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Helper: records disagreement with the AI interpretation and reason for non-support.
   */
  public recordInterpretationDisagreement(params: {
    evidenceId: string;
    judgeId: string;
    submissionId: string;
    disagreeWithAi: boolean;
    nonSupportReason?: string;
    notes?: string;
  }): JudgeEvidenceAnnotation {
    return this.saveJudgeAnnotation({
      ...params,
      updatedAt: new Date().toISOString(),
    });
  }

  // ─────────────────────────────────────────────
  // 6. AI TRACEABILITY RESOLUTION
  // ─────────────────────────────────────────────

  /**
   * Resolves criterion evaluations against concrete evidence references.
   * If a criterion lacks supporting evidence, clearly reports it without fabricating references.
   */
  public resolveCriterionTraceability(
    criterion: CriterionEvaluationResult,
    allReferences: EvidenceReference[]
  ): {
    supportingReferences: EvidenceReference[];
    hasSupportingEvidence: boolean;
    missingEvidenceNotice?: string;
    claimOnlyWarnings: string[];
  } {
    const refIdOrLocationList = criterion.evidenceReferences || [];
    const supportingReferences: EvidenceReference[] = [];
    const claimOnlyWarnings: string[] = [];

    for (const refStr of refIdOrLocationList) {
      const trimmed = refStr.trim();
      // Match by exact ID or substring of source location/filePath/description
      const matched = allReferences.find(
        (r) =>
          r.id === trimmed ||
          (r.sourceLocation && r.sourceLocation.includes(trimmed)) ||
          (r.location?.filePath && r.location.filePath.includes(trimmed)) ||
          (r.description && r.description.includes(trimmed))
      );

      if (matched) {
        supportingReferences.push(matched);
        if (matched.classification === 'CLAIM_ONLY') {
          claimOnlyWarnings.push(
            `Reference "${matched.sourceLocation || matched.description}" is a self-declared claim (e.g. from README) and does not verify a functioning implementation.`
          );
        }
      }
    }

    const hasSupportingEvidence = supportingReferences.length > 0;
    const missingEvidenceNotice = !hasSupportingEvidence
      ? 'No direct supporting evidence detected in submitted artifacts for this criterion.'
      : undefined;

    return {
      supportingReferences,
      hasSupportingEvidence,
      missingEvidenceNotice,
      claimOnlyWarnings,
    };
  }
}

export const evidenceExplorerService = new EvidenceExplorerService();
