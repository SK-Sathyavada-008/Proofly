// ─────────────────────────────────────────────
// extractors/zipExtractor.ts — Secure Archive Evidence Extractor
// Proofly Phase 06 — Zip Bomb, Path Traversal & Executable Code Protection
// ─────────────────────────────────────────────

import { sha256Bytes } from '../../utils/cryptoUtils';
import { inspectZipArchive } from './archiveUtils';
import type {
  ArtifactExtractor,
  ArtifactType,
  EvidenceReference,
  NormalizedExtractionResult,
} from './types';

export class ZipExtractor implements ArtifactExtractor<Uint8Array> {
  public readonly name = 'ZipExtractor';
  public readonly version = '1.0.0';
  public readonly supportedTypes: ArtifactType[] = ['ZIP_ARCHIVE'];

  public canHandle(_type: ArtifactType, filenameOrUrl: string): boolean {
    return filenameOrUrl.toLowerCase().endsWith('.zip');
  }

  public async extract(
    input: Uint8Array,
    options?: { filename?: string; artifactId?: string }
  ): Promise<NormalizedExtractionResult> {
    const artifactId = options?.artifactId || `zip-${Date.now()}`;
    const filename = options?.filename || 'archive.zip';
    const timestamp = new Date().toISOString();

    const contentHash = await sha256Bytes(input);

    const inspection = inspectZipArchive(input, {
      maxTotalUncompressedBytes: 25 * 1024 * 1024, // 25 MB limit
      maxFileCount: 500,
      maxCompressionRatio: 100, // 100:1 ratio limit
    });

    if (inspection.isZipBomb) {
      return {
        artifactId,
        artifactType: 'ZIP_ARCHIVE',
        originalNameOrUrl: filename,
        status: 'EXTRACTION_FAILED',
        extractedContent: '',
        evidenceReferences: [],
        metadata: {
          securityFlags: { zipBombDetected: true },
        },
        extractionTimestamp: timestamp,
        extractorVersion: this.version,
        warnings: inspection.warnings,
        errors: inspection.errors,
        contentHash,
      };
    }

    if (!inspection.valid) {
      return {
        artifactId,
        artifactType: 'ZIP_ARCHIVE',
        originalNameOrUrl: filename,
        status: 'EXTRACTION_FAILED',
        extractedContent: '',
        evidenceReferences: [],
        metadata: {},
        extractionTimestamp: timestamp,
        extractorVersion: this.version,
        warnings: inspection.warnings,
        errors: inspection.errors.length > 0 ? inspection.errors : ['Invalid or corrupted ZIP archive.'],
        contentHash,
      };
    }

    const evidenceReferences: EvidenceReference[] = [];
    const fileManifest: string[] = [];

    for (const entry of inspection.entries) {
      fileManifest.push(`${entry.filename} (${entry.uncompressedSize} bytes)`);

      evidenceReferences.push({
        id: `ref-${artifactId}-${encodeURIComponent(entry.filename).slice(0, 50)}`,
        artifactId,
        artifactType: 'ZIP_ARCHIVE',
        location: {
          filePath: entry.filename,
        },
        snippet: `Archive entry: ${entry.filename} (${entry.uncompressedSize} bytes, method ${entry.compressionMethod})`,
        description: `Verified archive file: ${entry.filename}`,
      });
    }

    // Static analysis disclaimer: archive is inspected as data; code is never executed
    const warnings = [...inspection.warnings];
    warnings.push('Code execution disclaimer: Archive contents were statically inspected and indexed. No executable code was run.');

    const summaryText = [
      `ZIP Archive Manifest (${inspection.fileCount} files, ${inspection.totalUncompressedSize} uncompressed bytes):`,
      ...fileManifest.slice(0, 100),
      fileManifest.length > 100 ? `... [and ${fileManifest.length - 100} more files]` : '',
    ].filter(Boolean).join('\n');

    return {
      artifactId,
      artifactType: 'ZIP_ARCHIVE',
      originalNameOrUrl: filename,
      status: inspection.hasPathTraversal ? 'PARTIALLY_EXTRACTED' : 'EXTRACTED',
      extractedContent: summaryText,
      evidenceReferences,
      metadata: {
        fileCount: inspection.fileCount,
        totalUncompressedSize: inspection.totalUncompressedSize,
        totalCompressedSize: inspection.totalCompressedSize,
        securityFlags: {
          zipBombDetected: false,
          pathTraversalDetected: inspection.hasPathTraversal,
          executableFilesDetected: inspection.executableFiles,
        },
      },
      extractionTimestamp: timestamp,
      extractorVersion: this.version,
      warnings,
      errors: [],
      contentHash,
    };
  }
}

export const zipExtractor = new ZipExtractor();
