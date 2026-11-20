// ─────────────────────────────────────────────
// phase11EvidenceExplorer.test.ts
// Unit & Integration Tests for Proofly Phase 11 — Evidence Explorer
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceExplorerService,
} from '../evidenceExplorerService';
import type {
  EvidenceReference,
  CriterionEvaluationResult,
  ArtifactType,
} from '../../types/aiEvaluation';
import type { JudgeEvidenceAnnotation } from '../../types/judgeAndEvaluation';

describe('Proofly Phase 11 — Evidence Explorer & AI Traceability', () => {
  let service: EvidenceExplorerService;

  beforeEach(() => {
    service = new EvidenceExplorerService();
  });

  // ─────────────────────────────────────────────
  // 1. EVIDENCE MODEL CONSISTENCY
  // ─────────────────────────────────────────────
  describe('1. Evidence Model Consistency', () => {
    it('creates a consistent evidence reference containing all 10 required fields', () => {
      const rawRef: Partial<EvidenceReference> & { id: string; artifactId: string; artifactType: ArtifactType } = {
        id: 'ref-pdf-001',
        artifactId: 'art-arch-spec',
        artifactType: 'PDF',
        location: {
          pageNumber: 3,
          sectionHeading: 'Architecture Overview',
        },
        snippet: 'Hybrid edge-cloud architecture with on-device Gemini Nano inference.',
      };

      const normalized = service.normalizeEvidenceReference(rawRef, {
        submissionId: 'sub-2026-xyz',
        contentHash: 'hash-abc-1234567890',
        extractionStatus: 'EXTRACTED',
        extractionTimestamp: '2026-11-20T10:00:00.000Z',
      });

      // 1. Evidence ID
      expect(normalized.id).toBe('ref-pdf-001');
      // 2. Submission ID
      expect(normalized.submissionId).toBe('sub-2026-xyz');
      // 3. Artifact ID
      expect(normalized.artifactId).toBe('art-arch-spec');
      // 4. Artifact type
      expect(normalized.artifactType).toBe('PDF');
      // 5. Source location
      expect(normalized.sourceLocation).toBe('PDF Page 3 (Architecture Overview)');
      // 6. Extracted passage or metadata
      expect(normalized.extractedPassage).toBe('Hybrid edge-cloud architecture with on-device Gemini Nano inference.');
      // 7. Page, slide, file or line reference
      expect(normalized.locationReference).toBe('p. 3');
      // 8. Content hash
      expect(normalized.contentHash).toBe('hash-abc-1234567890');
      // 9. Extraction status
      expect(normalized.extractionStatus).toBe('EXTRACTED');
      // 10. Extraction timestamp
      expect(normalized.extractionTimestamp).toBe('2026-11-20T10:00:00.000Z');
    });
  });

  // ─────────────────────────────────────────────
  // 2. REFERENCES FOR EACH SUPPORTED ARTIFACT TYPE
  // ─────────────────────────────────────────────
  describe('2. References Across Supported Artifact Types', () => {
    it('supports PDF page references with section headings', () => {
      const pdfRef = service.normalizeEvidenceReference({
        id: 'ref-pdf-p4',
        artifactId: 'art-paper',
        artifactType: 'PDF',
        location: { pageNumber: 4, sectionHeading: 'Performance Benchmarks' },
        snippet: 'Table 2: Latency measured at 42ms on Chrome Canary 134.',
      });

      expect(pdfRef.artifactType).toBe('PDF');
      expect(pdfRef.location.pageNumber).toBe(4);
      expect(pdfRef.locationReference).toBe('p. 4');
      expect(pdfRef.sourceLocation).toContain('Page 4');
      expect(pdfRef.classification).toBe('VERIFIED_EVIDENCE');
    });

    it('supports PPTX slide references with slide titles', () => {
      const pptxRef = service.normalizeEvidenceReference({
        id: 'ref-pptx-s7',
        artifactId: 'art-pitch',
        artifactType: 'PPTX',
        location: { slideNumber: 7, sectionHeading: 'Market Traction & Validation' },
        snippet: 'Pilot running across 3 healthcare hospital networks.',
      });

      expect(pptxRef.artifactType).toBe('PPTX');
      expect(pptxRef.location.slideNumber).toBe(7);
      expect(pptxRef.locationReference).toBe('slide 7');
      expect(pptxRef.sourceLocation).toContain('Slide 7');
      expect(pptxRef.classification).toBe('VERIFIED_EVIDENCE');
    });

    it('supports README section references and flags them as CLAIM_ONLY', () => {
      const readmeRef = service.normalizeEvidenceReference({
        id: 'ref-gh-readme',
        artifactId: 'art-repo',
        artifactType: 'GITHUB_REPO',
        location: {
          filePath: 'README.md',
          sectionHeading: 'Features',
          startLine: 12,
          endLine: 45,
          commitSha: 'c286024abcdef',
        },
        snippet: 'Features: Real-time fraud detection with 99.9% accuracy.',
      });

      expect(readmeRef.artifactType).toBe('GITHUB_REPO');
      expect(readmeRef.location.filePath).toBe('README.md');
      expect(readmeRef.locationReference).toBe('lines 12–45');
      // Crucial requirement: README claim must NOT be presented as verified proof
      expect(readmeRef.classification).toBe('CLAIM_ONLY');
    });

    it('supports source code file and line references', () => {
      const codeRef = service.normalizeEvidenceReference({
        id: 'ref-code-auth',
        artifactId: 'art-repo',
        artifactType: 'GITHUB_REPO',
        location: {
          filePath: 'src/services/authService.ts',
          startLine: 35,
          endLine: 68,
          commitSha: 'c286024abcdef',
        },
        snippet: 'export async function verifySignature(token: string): Promise<boolean> { ... }',
      });

      expect(codeRef.artifactType).toBe('GITHUB_REPO');
      expect(codeRef.location.filePath).toBe('src/services/authService.ts');
      expect(codeRef.locationReference).toBe('lines 35–68');
      expect(codeRef.sourceLocation).toContain('src/services/authService.ts (lines 35–68)');
      expect(codeRef.classification).toBe('VERIFIED_EVIDENCE');
    });

    it('supports deployment URL reachability references', () => {
      const urlRef = service.normalizeEvidenceReference({
        id: 'ref-dep-url',
        artifactId: 'art-deploy',
        artifactType: 'DEPLOYMENT_URL',
        location: {},
        snippet: 'HTTP 200 OK — Response time 185ms.',
        extractionStatus: 'EXTRACTED',
      });

      expect(urlRef.artifactType).toBe('DEPLOYMENT_URL');
      expect(urlRef.sourceLocation).toBe('Live Web Deployment');
      expect(urlRef.classification).toBe('VERIFIED_EVIDENCE');
    });

    it('supports video URL references and marks them as NOT_INSPECTED', () => {
      const vidRef = service.normalizeEvidenceReference({
        id: 'ref-video-loom',
        artifactId: 'art-loom',
        artifactType: 'VIDEO_URL',
        location: {},
        snippet: 'Demo video hosted on Loom (https://loom.com/share/abc).',
        extractionStatus: 'NOT_INSPECTED',
      });

      expect(vidRef.artifactType).toBe('VIDEO_URL');
      expect(vidRef.classification).toBe('NOT_INSPECTED');
      expect(vidRef.extractionStatus).toBe('NOT_INSPECTED');
    });

    it('supports ZIP archive internal path references', () => {
      const zipRef = service.normalizeEvidenceReference({
        id: 'ref-zip-main',
        artifactId: 'art-archive',
        artifactType: 'ZIP_ARCHIVE',
        location: { filePath: 'package/contracts/Token.sol', startLine: 1, endLine: 50 },
        snippet: 'contract Token is ERC20 { ... }',
      });

      expect(zipRef.artifactType).toBe('ZIP_ARCHIVE');
      expect(zipRef.sourceLocation).toBe('ZIP / package/contracts/Token.sol');
      expect(zipRef.classification).toBe('VERIFIED_EVIDENCE');
    });

    it('supports plain text and markdown references', () => {
      const textRef = service.normalizeEvidenceReference({
        id: 'ref-txt-spec',
        artifactId: 'art-spec',
        artifactType: 'TEXT_MARKDOWN',
        location: { filePath: 'SPEC.md', sectionHeading: 'Protocol', startLine: 5, endLine: 20 },
        snippet: '## Protocol Specification',
      });

      expect(textRef.artifactType).toBe('TEXT_MARKDOWN');
      expect(textRef.locationReference).toBe('lines 5–20');
      expect(textRef.sourceLocation).toContain('SPEC.md (lines 5–20)');
    });
  });

  // ─────────────────────────────────────────────
  // 3. EVIDENCE CLASSIFICATIONS TAXONOMY
  // ─────────────────────────────────────────────
  describe('3. Evidence Classifications Taxonomy', () => {
    it('provides clear labels and explanations for each classification', () => {
      const verified = service.getClassificationDetails('VERIFIED_EVIDENCE');
      expect(verified.label).toBe('Verified Evidence');
      expect(verified.badgeVariant).toBe('success');

      const claim = service.getClassificationDetails('CLAIM_ONLY');
      expect(claim.label).toBe('Claim Only');
      expect(claim.badgeVariant).toBe('warning');

      const missing = service.getClassificationDetails('MISSING_EVIDENCE');
      expect(missing.label).toBe('Missing Evidence');
      expect(missing.badgeVariant).toBe('danger');

      const inaccessible = service.getClassificationDetails('INACCESSIBLE_EVIDENCE');
      expect(inaccessible.label).toBe('Inaccessible Evidence');
      expect(inaccessible.badgeVariant).toBe('neutral');

      const unclear = service.getClassificationDetails('UNCLEAR_EVIDENCE');
      expect(unclear.label).toBe('Unclear Evidence');
      expect(unclear.badgeVariant).toBe('purple');

      const notInspected = service.getClassificationDetails('NOT_INSPECTED');
      expect(notInspected.label).toBe('Not Inspected');
      expect(notInspected.badgeVariant).toBe('info');
    });
  });

  // ─────────────────────────────────────────────
  // 4. BOUNDS & ERROR VALIDATION
  // ─────────────────────────────────────────────
  describe('4. Bounds and Error Validation', () => {
    it('detects and flags missing or deleted artifact files', () => {
      const ref = service.normalizeEvidenceReference({
        id: 'ref-missing-f',
        artifactId: 'art-deleted',
        artifactType: 'PDF',
        location: { pageNumber: 2 },
        snippet: 'Some text',
      });

      const deletedCheck = service.validateEvidenceLocation(ref, { isDeleted: true });
      expect(deletedCheck.isValid).toBe(false);
      expect(deletedCheck.error).toContain('deleted');

      const missingCheck = service.validateEvidenceLocation(ref, { fileExists: false });
      expect(missingCheck.isValid).toBe(false);
      expect(missingCheck.error).toContain('not found');
    });

    it('detects invalid and out-of-range PDF page numbers', () => {
      const zeroPageRef = service.normalizeEvidenceReference({
        id: 'ref-p0',
        artifactId: 'art-pdf',
        artifactType: 'PDF',
        location: { pageNumber: 0 },
        snippet: '',
      });
      const zeroCheck = service.validateEvidenceLocation(zeroPageRef, { pageCount: 10 });
      expect(zeroCheck.isValid).toBe(false);
      expect(zeroCheck.error).toContain('must be >= 1');

      const outOfBoundsRef = service.normalizeEvidenceReference({
        id: 'ref-p15',
        artifactId: 'art-pdf',
        artifactType: 'PDF',
        location: { pageNumber: 15 },
        snippet: '',
      });
      const boundCheck = service.validateEvidenceLocation(outOfBoundsRef, { pageCount: 10 });
      expect(boundCheck.isValid).toBe(false);
      expect(boundCheck.error).toContain('exceeds total PDF document page count (10)');
    });

    it('detects invalid and out-of-range PPTX slide numbers', () => {
      const slideRef = service.normalizeEvidenceReference({
        id: 'ref-s25',
        artifactId: 'art-pptx',
        artifactType: 'PPTX',
        location: { slideNumber: 25 },
        snippet: '',
      });
      const check = service.validateEvidenceLocation(slideRef, { slideCount: 12 });
      expect(check.isValid).toBe(false);
      expect(check.error).toContain('exceeds total presentation slide count (12)');
    });

    it('detects invalid source code line ranges', () => {
      const invertedRef = service.normalizeEvidenceReference({
        id: 'ref-inverted',
        artifactId: 'art-repo',
        artifactType: 'GITHUB_REPO',
        location: { filePath: 'index.ts', startLine: 50, endLine: 20 },
        snippet: '',
      });
      const invertedCheck = service.validateEvidenceLocation(invertedRef, { totalLines: 100 });
      expect(invertedCheck.isValid).toBe(false);
      expect(invertedCheck.error).toContain('end line (20) cannot be smaller than start line (50)');

      const overLinesRef = service.normalizeEvidenceReference({
        id: 'ref-over',
        artifactId: 'art-repo',
        artifactType: 'GITHUB_REPO',
        location: { filePath: 'index.ts', startLine: 10, endLine: 250 },
        snippet: '',
      });
      const overCheck = service.validateEvidenceLocation(overLinesRef, { totalLines: 100 });
      expect(overCheck.isValid).toBe(false);
      expect(overCheck.error).toContain('exceeds file total lines count (100)');
    });

    it('detects inaccessible artifacts and extraction failures', () => {
      const inaccRef = service.normalizeEvidenceReference({
        id: 'ref-inacc',
        artifactId: 'art-private',
        artifactType: 'GITHUB_REPO',
        location: { filePath: 'src/secret.ts' },
        snippet: '',
        extractionStatus: 'INACCESSIBLE',
      });
      const check = service.validateEvidenceLocation(inaccRef);
      expect(check.isValid).toBe(false);
      expect(check.error).toContain('inaccessible');
    });

    it('enforces judge authorization to inspect evidence', () => {
      // Unauthenticated judge
      const anonCheck = service.checkJudgeArtifactAccess({
        judgeId: '',
        submissionId: 'sub-1',
      });
      expect(anonCheck.allowed).toBe(false);
      expect(anonCheck.reason).toContain('Authentication required');

      // Unassigned judge
      const unassignedCheck = service.checkJudgeArtifactAccess({
        judgeId: 'judge-intruder',
        submissionId: 'sub-1',
        assignedJudgeIds: ['judge-authorized-1', 'judge-authorized-2'],
      });
      expect(unassignedCheck.allowed).toBe(false);
      expect(unassignedCheck.reason).toContain('not assigned');

      // Assigned judge
      const assignedCheck = service.checkJudgeArtifactAccess({
        judgeId: 'judge-authorized-1',
        submissionId: 'sub-1',
        assignedJudgeIds: ['judge-authorized-1', 'judge-authorized-2'],
      });
      expect(assignedCheck.allowed).toBe(true);

      // Organizer bypass
      const organizerCheck = service.checkJudgeArtifactAccess({
        judgeId: 'organizer-uid',
        submissionId: 'sub-1',
        isOrganizer: true,
        assignedJudgeIds: ['judge-1'],
      });
      expect(organizerCheck.allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 5. AI TRACEABILITY RESOLUTION
  // ─────────────────────────────────────────────
  describe('5. AI Traceability Resolution', () => {
    it('resolves concrete evidence references supporting a criterion', () => {
      const allRefs: EvidenceReference[] = [
        service.normalizeEvidenceReference({
          id: 'ref-code-ml',
          artifactId: 'art-code',
          artifactType: 'GITHUB_REPO',
          location: { filePath: 'src/model.py', startLine: 10, endLine: 40 },
          snippet: 'def infer(features): return model.predict(features)',
        }),
        service.normalizeEvidenceReference({
          id: 'ref-pdf-doc',
          artifactId: 'art-doc',
          artifactType: 'PDF',
          location: { pageNumber: 2 },
          snippet: 'Architecture diagram',
        }),
      ];

      const criterion: CriterionEvaluationResult = {
        criterionId: 'crit-tech',
        criterionName: 'Technical Execution',
        suggestedScore: 23,
        maxScore: 25,
        weight: 25,
        positiveObservations: ['Solid ML inference implementation.'],
        evidenceReferences: ['ref-code-ml'],
        weaknesses: [],
        exactDeductionExplanations: [],
        missingEvidence: [],
        confidence: 'HIGH',
        evidenceClassifications: [],
        limitations: [],
      };

      const result = service.resolveCriterionTraceability(criterion, allRefs);
      expect(result.hasSupportingEvidence).toBe(true);
      expect(result.supportingReferences.length).toBe(1);
      expect(result.supportingReferences[0].id).toBe('ref-code-ml');
      expect(result.missingEvidenceNotice).toBeUndefined();
    });

    it('clearly reports when no supporting evidence exists and prevents fabrication', () => {
      const allRefs: EvidenceReference[] = [];

      const criterion: CriterionEvaluationResult = {
        criterionId: 'crit-impact',
        criterionName: 'Real World Impact',
        suggestedScore: 10,
        maxScore: 25,
        weight: 25,
        positiveObservations: [],
        evidenceReferences: [], // Empty
        weaknesses: ['Zero customer validation artifacts found.'],
        exactDeductionExplanations: ['No user survey or pilot metrics submitted.'],
        missingEvidence: ['Customer validation data'],
        confidence: 'LOW',
        evidenceClassifications: [],
        limitations: [],
      };

      const result = service.resolveCriterionTraceability(criterion, allRefs);
      expect(result.hasSupportingEvidence).toBe(false);
      expect(result.supportingReferences).toEqual([]);
      expect(result.missingEvidenceNotice).toContain('No direct supporting evidence detected in submitted artifacts');
    });

    it('warns when an evidence reference is only a README claim rather than working code', () => {
      const allRefs: EvidenceReference[] = [
        service.normalizeEvidenceReference({
          id: 'ref-readme-claim',
          artifactId: 'art-repo',
          artifactType: 'GITHUB_REPO',
          location: { filePath: 'README.md', sectionHeading: 'Scaling' },
          snippet: 'Scales to 1 million requests per second.',
        }),
      ];

      const criterion: CriterionEvaluationResult = {
        criterionId: 'crit-scale',
        criterionName: 'Scalability',
        suggestedScore: 18,
        maxScore: 25,
        weight: 25,
        positiveObservations: [],
        evidenceReferences: ['ref-readme-claim'],
        weaknesses: [],
        exactDeductionExplanations: [],
        missingEvidence: [],
        confidence: 'MEDIUM',
        evidenceClassifications: [],
        limitations: [],
      };

      const result = service.resolveCriterionTraceability(criterion, allRefs);
      expect(result.claimOnlyWarnings.length).toBe(1);
      expect(result.claimOnlyWarnings[0]).toContain('self-declared claim (e.g. from README)');
    });
  });

  // ─────────────────────────────────────────────
  // 6. JUDGE INTERACTIONS & ANNOTATION SEPARATION
  // ─────────────────────────────────────────────
  describe('6. Judge Interactions and Annotation Separation', () => {
    it('records judge annotations completely separate from original evidence and AI output', () => {
      const initialAnnotation: JudgeEvidenceAnnotation = {
        evidenceId: 'ref-code-ml',
        judgeId: 'judge-42',
        submissionId: 'sub-2026-xyz',
        isRelevant: true,
        flaggedIncorrect: false,
        disagreeWithAi: true,
        nonSupportReason: 'The code is a mock stub and does not call real weights.',
        notes: 'Needs organizer review during deliberation.',
        updatedAt: '2026-11-20T10:30:00.000Z',
      };

      const saved = service.saveJudgeAnnotation(initialAnnotation);
      expect(saved.isRelevant).toBe(true);
      expect(saved.disagreeWithAi).toBe(true);
      expect(saved.nonSupportReason).toContain('mock stub');

      const retrieved = service.getJudgeAnnotations('sub-2026-xyz', 'judge-42');
      expect(retrieved['ref-code-ml']).toBeDefined();
      expect(retrieved['ref-code-ml'].notes).toBe('Needs organizer review during deliberation.');
    });

    it('allows marking relevance, flagging incorrect associations, and disagreeing with AI', () => {
      // Relevance toggle
      const rel = service.markEvidenceRelevance({
        evidenceId: 'ref-doc-1',
        judgeId: 'judge-42',
        submissionId: 'sub-1',
        isRelevant: true,
      });
      expect(rel.isRelevant).toBe(true);

      // Flag incorrect association
      const flagged = service.flagIncorrectEvidence({
        evidenceId: 'ref-doc-1',
        judgeId: 'judge-42',
        submissionId: 'sub-1',
        notes: 'AI associated this paper with frontend UX instead of backend.',
      });
      expect(flagged.flaggedIncorrect).toBe(true);
      expect(flagged.notes).toContain('frontend UX');

      // Disagree with AI
      const disagree = service.recordInterpretationDisagreement({
        evidenceId: 'ref-doc-1',
        judgeId: 'judge-42',
        submissionId: 'sub-1',
        disagreeWithAi: true,
        nonSupportReason: 'The author explicitly states this algorithm was not yet implemented.',
      });
      expect(disagree.disagreeWithAi).toBe(true);
      expect(disagree.nonSupportReason).toContain('not yet implemented');
    });

    it('isolates annotations between different judges and different submissions', () => {
      service.saveJudgeAnnotation({
        evidenceId: 'ref-shared-1',
        judgeId: 'judge-alpha',
        submissionId: 'sub-alpha',
        notes: 'Alpha notes',
        updatedAt: new Date().toISOString(),
      });

      service.saveJudgeAnnotation({
        evidenceId: 'ref-shared-1',
        judgeId: 'judge-beta',
        submissionId: 'sub-alpha',
        notes: 'Beta notes',
        updatedAt: new Date().toISOString(),
      });

      const alphaAnn = service.getJudgeAnnotations('sub-alpha', 'judge-alpha');
      const betaAnn = service.getJudgeAnnotations('sub-alpha', 'judge-beta');

      expect(alphaAnn['ref-shared-1'].notes).toBe('Alpha notes');
      expect(betaAnn['ref-shared-1'].notes).toBe('Beta notes');
    });
  });
});
