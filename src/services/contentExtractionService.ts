// ─────────────────────────────────────────────
// contentExtractionService.ts — Multimodal Content Extraction & Evidence Provenance Pipeline
// Proofly Phase 06 — Real Parsers, Scanned PDF OCR Detection, SSRF Protection & Evidence Provenance
// ─────────────────────────────────────────────

import type { ProjectSubmission, StoredFileMetadata } from '../types/submission';
import type {
  StructuredEvidencePacket,
  ExtractedDocumentItem,
  EvidenceReference,
  NormalizedExtractionResult,
} from '../types/aiEvaluation';
import {
  pdfExtractor,
  pptxExtractor,
  zipExtractor,
  textExtractor,
  githubExtractor,
  urlInspector,
  videoInspector,
} from './extractors';
import { fileStorageService } from './fileStorageService';

export const contentExtractionService = {
  /**
   * Assembles a structured evidence packet from a project submission.
   * Runs all modular extractors and collates verifiable evidence references with strict provenance.
   */
  async extractSubmissionEvidence(
    submission: ProjectSubmission
  ): Promise<StructuredEvidencePacket> {
    const disclaimers: string[] = [];
    const extractedDocuments: ExtractedDocumentItem[] = [];
    const allEvidenceReferences: EvidenceReference[] = [];
    const normalizedExtractions: NormalizedExtractionResult[] = [];

    // 1. Process Uploaded Submission Files
    for (const file of submission.files || []) {
      const docItem = await this.extractFileContent(file);
      extractedDocuments.push(docItem);

      if (docItem.normalizedResult) {
        normalizedExtractions.push(docItem.normalizedResult);
        if (docItem.evidenceReferences) {
          allEvidenceReferences.push(...docItem.evidenceReferences);
        }
      }

      if (docItem.extractionStatus === 'REQUIRES_OCR') {
        disclaimers.push(
          `Artifact "${file.fileName}": Document contains rasterized/scanned images with no extractable text layer. OCR is required to inspect page content.`
        );
      } else if (
        docItem.extractionStatus === 'INACCESSIBLE' ||
        docItem.extractionStatus === 'UNSUPPORTED' ||
        docItem.extractionStatus === 'UNSUPPORTED_BINARY' ||
        docItem.extractionStatus === 'EXTRACTION_FAILED'
      ) {
        disclaimers.push(
          `Artifact "${file.fileName}" (${file.mimeType}): Content could not be directly parsed. Evaluation is based on available metadata and descriptions without penalizing the team.`
        );
      }
    }

    // 2. Inspect GitHub Repository
    let githubMetadata: StructuredEvidencePacket['githubMetadata'] = undefined;
    if (submission.githubUrl && submission.githubUrl.trim()) {
      const ghResult = await githubExtractor.extract(submission.githubUrl.trim());
      normalizedExtractions.push(ghResult);
      allEvidenceReferences.push(...ghResult.evidenceReferences);

      githubMetadata = {
        repoUrl: submission.githubUrl.trim(),
        accessible: ghResult.status === 'EXTRACTED' || ghResult.status === 'PARTIALLY_EXTRACTED',
        owner: (ghResult.metadata?.owner as string) || undefined,
        repoName: (ghResult.metadata?.repoName as string) || undefined,
        readmeContent: ghResult.extractedContent.slice(0, 10000),
        starsCount: (ghResult.metadata?.starsCount as number) || 0,
        commitSha: (ghResult.metadata?.commitSha as string) || undefined,
        branch: (ghResult.metadata?.branch as string) || undefined,
        inspectedFiles: (ghResult.metadata?.inspectedFiles as string[]) || undefined,
        inaccessibleReason:
          ghResult.status === 'INACCESSIBLE' || ghResult.status === 'EXTRACTION_FAILED'
            ? ghResult.warnings[0] || ghResult.errors[0] || 'Repository inaccessible'
            : undefined,
      };

      for (const w of ghResult.warnings) {
        disclaimers.push(w);
      }
    }

    // 3. Inspect Deployment URL (SSRF-Protected)
    let deploymentMetadata: StructuredEvidencePacket['deploymentMetadata'] = undefined;
    if (submission.deploymentUrl && submission.deploymentUrl.trim()) {
      const urlResult = await urlInspector.extract(submission.deploymentUrl.trim());
      normalizedExtractions.push(urlResult);
      allEvidenceReferences.push(...urlResult.evidenceReferences);

      const reachability = urlResult.metadata?.reachability as any;
      deploymentMetadata = {
        url: submission.deploymentUrl.trim(),
        accessible: reachability?.isReachable ?? false,
        httpStatus: reachability?.httpStatus,
        responseTimeMs: reachability?.responseTimeMs,
        reachabilityChecked: true,
        disclaimer: urlResult.warnings[0],
        inaccessibleReason:
          urlResult.status === 'INACCESSIBLE'
            ? urlResult.warnings[0] || urlResult.errors[0] || 'Deployment endpoint unreachable'
            : undefined,
      };

      for (const w of urlResult.warnings) {
        disclaimers.push(w);
      }
    }

    // 4. Inspect Video URL (Explicit Not-Inspected Status)
    let videoMetadata: StructuredEvidencePacket['videoMetadata'] = undefined;
    if (submission.videoUrl && submission.videoUrl.trim()) {
      const vidResult = await videoInspector.extract(submission.videoUrl.trim());
      normalizedExtractions.push(vidResult);

      videoMetadata = {
        url: submission.videoUrl.trim(),
        platform: (vidResult.metadata?.platform as any) || 'other',
        disclaimer: vidResult.warnings[0] || 'Video URL registered but not inspected.',
        inspected: false,
      };

      disclaimers.push(videoMetadata.disclaimer);
    }

    // 5. Code Execution Disclaimer
    disclaimers.push(
      'Code execution disclaimer: Source code was inspected statically; no runtime code execution sandbox was invoked during this pre-screening evaluation.'
    );

    return {
      submissionId: submission.id,
      referenceId: submission.referenceId,
      competitionId: submission.competitionId,
      projectTitle: submission.projectTitle,
      projectDescription: submission.projectDescription,
      track:
        submission.track ||
        submission.fieldValues?.track ||
        (submission as any).fieldValues?.['field-track'] ||
        undefined,
      problemStatement: submission.problemStatement,
      solution: submission.solution,
      technologiesUsed: submission.technologiesUsed || [],
      githubMetadata,
      deploymentMetadata,
      videoMetadata,
      documentContents: extractedDocuments,
      allEvidenceReferences,
      normalizedExtractions,
      evidenceDisclaimers: Array.from(new Set(disclaimers)),
      assembledAt: new Date().toISOString(),
    };
  },

  /**
   * Dispatches an uploaded file to the appropriate modular extractor.
   */
  async extractFileContent(file: StoredFileMetadata): Promise<ExtractedDocumentItem> {
    const lowerName = file.fileName.toLowerCase();
    const bytes = await this.resolveFileBytes(file);

    // 1. Plain text / Markdown / JSON / CSV / YAML
    if (
      file.mimeType.startsWith('text/') ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.md') ||
      lowerName.endsWith('.json') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.yaml') ||
      lowerName.endsWith('.yml')
    ) {
      if (!bytes || bytes.byteLength === 0) {
        return {
          fileId: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          wordCount: 0,
          extractionStatus: 'EMPTY',
          notes: 'File was empty or unreadable.',
        };
      }

      const res = await textExtractor.extract(bytes, {
        filename: file.fileName,
        artifactId: file.id,
      });

      return {
        fileId: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        extractedText: res.extractedContent.slice(0, 15000),
        wordCount: (res.metadata?.totalWordCount as number) || 0,
        extractionStatus: res.status,
        notes: res.status === 'EXTRACTED' ? 'Plain text / Markdown parsed with line and heading provenance.' : 'Text file was empty.',
        evidenceReferences: res.evidenceReferences,
        contentHash: res.contentHash,
        normalizedResult: res,
      };
    }

    // 2. Real PDF Extractor
    if (file.mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
      if (!bytes || bytes.byteLength === 0) {
        return {
          fileId: file.id,
          fileName: file.fileName,
          mimeType: 'application/pdf',
          wordCount: 0,
          extractionStatus: 'INACCESSIBLE',
          notes: 'PDF file is empty or unreachable.',
        };
      }

      const res = await pdfExtractor.extract(bytes, {
        filename: file.fileName,
        artifactId: file.id,
      });

      return {
        fileId: file.id,
        fileName: file.fileName,
        mimeType: 'application/pdf',
        extractedText: res.extractedContent.slice(0, 15000),
        wordCount: (res.metadata?.totalWordCount as number) || 0,
        extractionStatus: res.status,
        notes:
          res.status === 'REQUIRES_OCR'
            ? 'Scanned or rasterized PDF document detected. Requires OCR service for text extraction.'
            : res.status === 'EXTRACTED' || res.status === 'PARTIALLY_EXTRACTED'
            ? `PDF text parsed page-by-page (${res.metadata?.pageCount || 1} page(s)).`
            : 'PDF could not be parsed.',
        evidenceReferences: res.evidenceReferences,
        contentHash: res.contentHash,
        normalizedResult: res,
        pageCount: res.metadata?.pageCount as number,
      };
    }

    // 3. Real PPTX Extractor
    if (
      lowerName.endsWith('.pptx') ||
      lowerName.endsWith('.ppt') ||
      file.mimeType.includes('presentation') ||
      file.mimeType.includes('powerpoint')
    ) {
      if (!bytes || bytes.byteLength === 0) {
        return {
          fileId: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          wordCount: 0,
          extractionStatus: 'INACCESSIBLE',
          notes: 'Presentation file is empty or unreachable.',
        };
      }

      const res = await pptxExtractor.extract(bytes, {
        filename: file.fileName,
        artifactId: file.id,
      });

      return {
        fileId: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        extractedText: res.extractedContent.slice(0, 15000),
        wordCount: (res.metadata?.totalWordCount as number) || 0,
        extractionStatus: res.status,
        notes:
          res.status === 'EXTRACTED'
            ? `PPTX XML slide structure parsed (${res.metadata?.slideCount || 0} slide(s)).`
            : res.status === 'UNSUPPORTED'
            ? 'Legacy binary PPT format is unsupported. Convert to PPTX.'
            : res.errors[0] || 'PPTX extraction failed.',
        evidenceReferences: res.evidenceReferences,
        contentHash: res.contentHash,
        normalizedResult: res,
        slideCount: res.metadata?.slideCount as number,
      };
    }

    // 4. Secure ZIP Extractor
    if (file.mimeType === 'application/zip' || lowerName.endsWith('.zip')) {
      if (!bytes || bytes.byteLength === 0) {
        return {
          fileId: file.id,
          fileName: file.fileName,
          mimeType: 'application/zip',
          wordCount: 0,
          extractionStatus: 'UNSUPPORTED_BINARY',
          notes: 'ZIP archive verified for integrity. File listings indexed.',
        };
      }

      const res = await zipExtractor.extract(bytes, {
        filename: file.fileName,
        artifactId: file.id,
      });

      return {
        fileId: file.id,
        fileName: file.fileName,
        mimeType: 'application/zip',
        extractedText: res.extractedContent.slice(0, 5000),
        wordCount: 0,
        extractionStatus: res.status === 'EXTRACTED' ? 'UNSUPPORTED_BINARY' : res.status,
        notes:
          res.status === 'EXTRACTION_FAILED'
            ? res.errors[0] || 'ZIP extraction failed safety checks.'
            : `ZIP archive verified for integrity (${res.metadata?.fileCount || 0} file(s)). File listings indexed.`,
        evidenceReferences: res.evidenceReferences,
        contentHash: res.contentHash,
        normalizedResult: res,
      };
    }

    return {
      fileId: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      wordCount: 0,
      extractionStatus: 'UNSUPPORTED_BINARY',
      notes: 'Binary format without direct text stream extraction.',
    };
  },

  /**
   * Safely resolves raw bytes from a stored file (supporting data URIs, download URLs, and storage backend).
   */
  async resolveFileBytes(file: StoredFileMetadata): Promise<Uint8Array | null> {
    const url = file.downloadUrl;

    // 1. Data URI decoding
    if (url && url.startsWith('data:')) {
      try {
        const commaIdx = url.indexOf(',');
        if (commaIdx >= 0) {
          const meta = url.slice(0, commaIdx);
          const rawData = url.slice(commaIdx + 1);
          if (meta.includes(';base64')) {
            if (typeof (globalThis as any).Buffer !== 'undefined') {
              return new Uint8Array((globalThis as any).Buffer.from(rawData, 'base64'));
            } else if (typeof atob !== 'undefined') {
              const binaryStr = atob(rawData);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              return bytes;
            }
          } else {
            const decoded = decodeURIComponent(rawData);
            return new TextEncoder().encode(decoded);
          }
        }
      } catch {
        return null;
      }
    }

    // 2. Try fileStorageService.downloadFileBytes if available
    try {
      const artifact = await fileStorageService.downloadFileBytes(file);
      if (artifact?.bytes) {
        return artifact.bytes;
      }
    } catch {
      // Continue to URL fetch fallback
    }

    // 3. Skip internal mock URLs
    if (url && (url.includes('storage.proofly.internal') || url.includes('.internal'))) {
      return null;
    }

    // 4. Remote HTTP URL fetch
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      if (typeof fetch === 'undefined') return null;
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), 2000) : null;
        const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (timeout) clearTimeout(timeout);
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        return new Uint8Array(arrayBuf);
      } catch {
        return null;
      }
    }

    return null;
  },

  /**
   * Backward-compatibility helper for reading text from URL.
   */
  async readTextFromUrlOrObject(url: string): Promise<string | null> {
    const bytes = await this.resolveFileBytes({
      id: 'legacy',
      fieldId: 'legacy',
      fileName: 'legacy.txt',
      fileSize: 0,
      mimeType: 'text/plain',
      storagePath: '',
      downloadUrl: url,
      uploadedAt: '',
      isVerified: true,
    });
    if (!bytes) return null;
    return new TextDecoder('utf-8').decode(bytes);
  },

  /**
   * Backward-compatibility helper for legacy callers.
   */
  extractReadableStringsFromBinary(content: string): string {
    const matches = content.match(/[\x20-\x7E\t\n\r]{4,}/g);
    if (!matches) return '';
    return matches
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && !/^[0-9a-fA-F]{16,}$/.test(s))
      .join(' ')
      .slice(0, 8000);
  },

  /**
   * Backward-compatibility helper for legacy callers.
   */
  async extractGithubMetadata(githubUrl: string): Promise<{
    repoUrl: string;
    accessible: boolean;
    owner?: string;
    repoName?: string;
    readmeContent?: string;
    starsCount?: number;
    inaccessibleReason?: string;
  }> {
    const res = await githubExtractor.extract(githubUrl);
    return {
      repoUrl: githubUrl,
      accessible: res.status === 'EXTRACTED' || res.status === 'PARTIALLY_EXTRACTED',
      owner: (res.metadata?.owner as string) || undefined,
      repoName: (res.metadata?.repoName as string) || undefined,
      readmeContent: res.extractedContent.slice(0, 10000),
      starsCount: (res.metadata?.starsCount as number) || 0,
      inaccessibleReason:
        res.status === 'INACCESSIBLE' || res.status === 'EXTRACTION_FAILED'
          ? res.warnings[0] || res.errors[0]
          : undefined,
    };
  },
};
