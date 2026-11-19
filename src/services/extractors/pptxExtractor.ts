// ─────────────────────────────────────────────
// extractors/pptxExtractor.ts — Real PPTX Slide Structure Evidence Extractor
// Proofly Phase 06 — XML Slide Hierarchy & Slide-Level Provenance
// ─────────────────────────────────────────────

import { sha256Bytes } from '../../utils/cryptoUtils';
import { inspectZipArchive } from './archiveUtils';
import type {
  ArtifactExtractor,
  ArtifactType,
  EvidenceReference,
  NormalizedExtractionResult,
} from './types';

export class PptxExtractor implements ArtifactExtractor<Uint8Array> {
  public readonly name = 'PptxExtractor';
  public readonly version = '1.0.0';
  public readonly supportedTypes: ArtifactType[] = ['PPTX'];

  public canHandle(_type: ArtifactType, filenameOrUrl: string): boolean {
    const lower = filenameOrUrl.toLowerCase();
    return lower.endsWith('.pptx') || lower.endsWith('.ppt');
  }

  public async extract(
    input: Uint8Array,
    options?: { filename?: string; artifactId?: string }
  ): Promise<NormalizedExtractionResult> {
    const artifactId = options?.artifactId || `pptx-${Date.now()}`;
    const filename = options?.filename || 'presentation.pptx';
    const timestamp = new Date().toISOString();

    const contentHash = await sha256Bytes(input);

    // Legacy binary PPT check
    if (filename.toLowerCase().endsWith('.ppt')) {
      return {
        artifactId,
        artifactType: 'PPTX',
        originalNameOrUrl: filename,
        status: 'UNSUPPORTED',
        extractedContent: '',
        evidenceReferences: [],
        metadata: { slideCount: 0, totalWordCount: 0 },
        extractionTimestamp: timestamp,
        extractorVersion: this.version,
        warnings: [
          'Legacy binary PPT format is unsupported. Please convert the presentation to modern PPTX format for automated evidence extraction.'
        ],
        errors: [],
        contentHash,
      };
    }

    // Inspect PKZip archive structure safely
    const zipResult = inspectZipArchive(input, {
      maxTotalUncompressedBytes: 25 * 1024 * 1024, // 25 MB max
      maxFileCount: 300,
      maxCompressionRatio: 100,
    });

    if (!zipResult.valid || zipResult.isZipBomb) {
      const errorMsg = zipResult.errors.join('; ') || 'Malformed PPTX archive: corrupt ZIP structure or missing slide definitions.';
      return {
        artifactId,
        artifactType: 'PPTX',
        originalNameOrUrl: filename,
        status: 'EXTRACTION_FAILED',
        extractedContent: '',
        evidenceReferences: [],
        metadata: { slideCount: 0, totalWordCount: 0 },
        extractionTimestamp: timestamp,
        extractorVersion: this.version,
        warnings: zipResult.warnings,
        errors: [errorMsg],
        contentHash,
      };
    }

    // Locate slide XML files: ppt/slides/slide{N}.xml
    const slideEntries = zipResult.entries.filter((entry) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(entry.filename)
    );

    if (slideEntries.length === 0) {
      return {
        artifactId,
        artifactType: 'PPTX',
        originalNameOrUrl: filename,
        status: 'INACCESSIBLE',
        extractedContent: '',
        evidenceReferences: [],
        metadata: { slideCount: 0, totalWordCount: 0 },
        extractionTimestamp: timestamp,
        extractorVersion: this.version,
        warnings: ['No slide XML files found in PPTX archive.'],
        errors: [],
        contentHash,
      };
    }

    // Sort slides numerically by slide number: slide1.xml, slide2.xml, ...
    slideEntries.sort((a, b) => {
      const numA = parseInt(a.filename.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      const numB = parseInt(b.filename.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      return numA - numB;
    });

    const slideTexts: { slideNumber: number; text: string; heading?: string }[] = [];
    const evidenceReferences: EvidenceReference[] = [];

    for (const slideEntry of slideEntries) {
      const slideNum = parseInt(slideEntry.filename.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      const xmlString = new TextDecoder('utf-8').decode(slideEntry.data);

      const parsedSlide = this.extractTextFromSlideXml(xmlString);
      if (parsedSlide.text.trim().length > 0) {
        slideTexts.push({
          slideNumber: slideNum,
          text: parsedSlide.text,
          heading: parsedSlide.heading,
        });

        evidenceReferences.push({
          id: `ref-${artifactId}-s${slideNum}`,
          artifactId,
          artifactType: 'PPTX',
          location: {
            slideNumber: slideNum,
            sectionHeading: parsedSlide.heading,
          },
          snippet: parsedSlide.text.slice(0, 300),
          description: parsedSlide.heading
            ? `Slide ${slideNum}: ${parsedSlide.heading}`
            : `Slide ${slideNum}`,
        });
      }
    }

    const fullExtractedContent = slideTexts
      .map((st) => `--- Slide ${st.slideNumber}${st.heading ? ` (${st.heading})` : ''} ---\n${st.text}`)
      .join('\n\n');

    const totalWordCount = fullExtractedContent.split(/\s+/).filter(Boolean).length;

    return {
      artifactId,
      artifactType: 'PPTX',
      originalNameOrUrl: filename,
      status: 'EXTRACTED',
      extractedContent: fullExtractedContent,
      evidenceReferences,
      metadata: {
        slideCount: slideEntries.length,
        extractedSlides: slideTexts.length,
        totalWordCount,
      },
      extractionTimestamp: timestamp,
      extractorVersion: this.version,
      warnings: zipResult.warnings,
      errors: [],
      contentHash,
    };
  }

  /**
   * Extracts text runs strictly from the XML structure of a PowerPoint slide.
   * Traverses paragraphs (<a:p>) and text runs (<a:r><a:t>...</a:t></a:r>).
   * Identifies slide titles (<p:sp> containing title type).
   */
  private extractTextFromSlideXml(xml: string): { text: string; heading?: string } {
    let heading: string | undefined;

    // Check for title placeholder
    const titleMatch = xml.match(/type="(?:title|ctrTitle)"[\s\S]*?<a:t>([^<]+)<\/a:t>/i);
    if (titleMatch) {
      heading = titleMatch[1].trim();
    }

    // Extract all paragraphs (<a:p>...</a:p>)
    const paragraphRegex = /<a:p\b[\s\S]*?<\/a:p>/g;
    const paragraphs: string[] = [];
    let pMatch: RegExpExecArray | null;

    while ((pMatch = paragraphRegex.exec(xml)) !== null) {
      const pXml = pMatch[0];
      // Extract all text elements (<a:t>text</a:t>) inside this paragraph
      const tRegex = /<a:t\b[^>]*>([^<]*)<\/a:t>/g;
      const textTokens: string[] = [];
      let tMatch: RegExpExecArray | null;

      while ((tMatch = tRegex.exec(pXml)) !== null) {
        textTokens.push(this.decodeXmlEntities(tMatch[1]));
      }

      const paragraphText = textTokens.join('').trim();
      if (paragraphText.length > 0) {
        paragraphs.push(paragraphText);
      }
    }

    const combined = paragraphs.join('\n');
    if (!heading && paragraphs.length > 0) {
      heading = paragraphs[0].slice(0, 60);
    }

    return {
      text: combined,
      heading,
    };
  }

  /**
   * Decodes XML entities: &amp;, &lt;, &gt;, &quot;, &apos;.
   */
  private decodeXmlEntities(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }
}

export const pptxExtractor = new PptxExtractor();
