// ─────────────────────────────────────────────
// extractors/textExtractor.ts — Plain Text & Markdown Evidence Extractor
// Proofly Phase 06 — Traceable Line & Section Heading Provenance
// ─────────────────────────────────────────────

import { sha256Bytes } from '../../utils/cryptoUtils';
import type {
  ArtifactExtractor,
  ArtifactType,
  EvidenceReference,
  NormalizedExtractionResult,
} from './types';

export class TextExtractor implements ArtifactExtractor<Uint8Array | string> {
  public readonly name = 'TextExtractor';
  public readonly version = '1.0.0';
  public readonly supportedTypes: ArtifactType[] = ['TEXT_MARKDOWN'];

  public canHandle(_type: ArtifactType, filenameOrUrl: string): boolean {
    const lower = filenameOrUrl.toLowerCase();
    return (
      lower.endsWith('.txt') ||
      lower.endsWith('.md') ||
      lower.endsWith('.markdown') ||
      lower.endsWith('.json') ||
      lower.endsWith('.csv') ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml')
    );
  }

  public async extract(
    input: Uint8Array | string,
    options?: { filename?: string; artifactId?: string }
  ): Promise<NormalizedExtractionResult> {
    const artifactId = options?.artifactId || `text-${Date.now()}`;
    const filename = options?.filename || 'document.txt';
    const timestamp = new Date().toISOString();

    let text: string;
    let rawBytes: Uint8Array;

    if (typeof input === 'string') {
      text = input;
      rawBytes = new TextEncoder().encode(input);
    } else {
      rawBytes = input;
      text = new TextDecoder('utf-8').decode(input);
    }

    const contentHash = await sha256Bytes(rawBytes);

    if (!text || text.trim().length === 0) {
      return {
        artifactId,
        artifactType: 'TEXT_MARKDOWN',
        originalNameOrUrl: filename,
        status: 'EMPTY',
        extractedContent: '',
        evidenceReferences: [],
        metadata: {
          totalWordCount: 0,
          fileCount: 1,
        },
        extractionTimestamp: timestamp,
        extractorVersion: this.version,
        warnings: ['Text document is empty.'],
        errors: [],
        contentHash,
      };
    }

    const lines = text.split(/\r?\n/);
    const evidenceReferences: EvidenceReference[] = [];
    let currentSectionHeading: string | undefined;

    // Track markdown headings and section line ranges
    let sectionStartLine = 1;
    let sectionSnippet: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);

      if (headingMatch) {
        // Flush previous section
        if (sectionSnippet.length > 0) {
          evidenceReferences.push({
            id: `ref-${artifactId}-l${sectionStartLine}-${lineNum - 1}`,
            artifactId,
            artifactType: 'TEXT_MARKDOWN',
            location: {
              filePath: filename,
              startLine: sectionStartLine,
              endLine: lineNum - 1,
              sectionHeading: currentSectionHeading,
            },
            snippet: sectionSnippet.join('\n').slice(0, 300),
            description: currentSectionHeading
              ? `Section: ${currentSectionHeading}`
              : `Lines ${sectionStartLine}–${lineNum - 1}`,
          });
        }

        currentSectionHeading = headingMatch[1].trim();
        sectionStartLine = lineNum;
        sectionSnippet = [line];
      } else {
        sectionSnippet.push(line);
      }
    }

    // Flush final section
    if (sectionSnippet.length > 0) {
      evidenceReferences.push({
        id: `ref-${artifactId}-l${sectionStartLine}-${lines.length}`,
        artifactId,
        artifactType: 'TEXT_MARKDOWN',
        location: {
          filePath: filename,
          startLine: sectionStartLine,
          endLine: lines.length,
          sectionHeading: currentSectionHeading,
        },
        snippet: sectionSnippet.join('\n').slice(0, 300),
        description: currentSectionHeading
          ? `Section: ${currentSectionHeading}`
          : `Lines ${sectionStartLine}–${lines.length}`,
      });
    }

    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

    return {
      artifactId,
      artifactType: 'TEXT_MARKDOWN',
      originalNameOrUrl: filename,
      status: 'EXTRACTED',
      extractedContent: text,
      evidenceReferences,
      metadata: {
        totalWordCount: wordCount,
        lineCount: lines.length,
        headingsCount: evidenceReferences.length,
      },
      extractionTimestamp: timestamp,
      extractorVersion: this.version,
      warnings: [],
      errors: [],
      contentHash,
    };
  }
}

export const textExtractor = new TextExtractor();
