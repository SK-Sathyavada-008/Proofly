// ─────────────────────────────────────────────
// extractors/videoInspector.ts — Explicit Uninspected Video Evidence Inspector
// Proofly Phase 06 — Honest Video Status: Explicitly Marks Video As Not Inspected
// ─────────────────────────────────────────────

import { sha256Bytes } from '../../utils/cryptoUtils';
import type {
  ArtifactExtractor,
  ArtifactType,
  NormalizedExtractionResult,
} from './types';

export class VideoInspector implements ArtifactExtractor<string> {
  public readonly name = 'VideoInspector';
  public readonly version = '1.0.0';
  public readonly supportedTypes: ArtifactType[] = ['VIDEO_URL'];

  public canHandle(_type: ArtifactType, filenameOrUrl: string): boolean {
    const lower = filenameOrUrl.toLowerCase();
    return (
      lower.includes('youtube.com') ||
      lower.includes('youtu.be') ||
      lower.includes('vimeo.com') ||
      lower.includes('loom.com') ||
      lower.endsWith('.mp4') ||
      lower.endsWith('.webm') ||
      lower.endsWith('.mov')
    );
  }

  public async extract(
    videoUrl: string,
    options?: { artifactId?: string }
  ): Promise<NormalizedExtractionResult> {
    const artifactId = options?.artifactId || `vid-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const cleanUrl = videoUrl.trim();
    const contentHash = await sha256Bytes(new TextEncoder().encode(cleanUrl));

    const lower = cleanUrl.toLowerCase();
    let platform: 'youtube' | 'vimeo' | 'loom' | 'direct' | 'other' = 'other';
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) platform = 'youtube';
    else if (lower.includes('vimeo.com')) platform = 'vimeo';
    else if (lower.includes('loom.com')) platform = 'loom';
    else if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) platform = 'direct';

    const disclaimer =
      'Video URL registered but not inspected: Video was not visually or auditorily inspected by the automated evaluation model. No score or credit is derived from uninspected video.';

    return {
      artifactId,
      artifactType: 'VIDEO_URL',
      originalNameOrUrl: cleanUrl,
      status: 'NOT_INSPECTED',
      extractedContent: '', // Strictly empty: zero fabricated visual or audio claims
      evidenceReferences: [], // Zero fabricated evidence
      metadata: {
        platform,
        url: cleanUrl,
        inspected: false,
      },
      extractionTimestamp: timestamp,
      extractorVersion: this.version,
      warnings: [disclaimer],
      errors: [],
      contentHash,
    };
  }
}

export const videoInspector = new VideoInspector();
