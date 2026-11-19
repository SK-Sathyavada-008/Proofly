// ─────────────────────────────────────────────
// phase6ArtifactExtraction.test.ts — Comprehensive Test Suite for Phase 06
// Reliable Artifact Extraction and Evidence Provenance
// ─────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import {
  textExtractor,
  pdfExtractor,
  pptxExtractor,
  zipExtractor,
  githubExtractor,
  urlInspector,
  videoInspector,
  inspectZipArchive,
} from '../extractors';
import { contentExtractionService } from '../contentExtractionService';
import type { ProjectSubmission } from '../../types/submission';
import type { NormalizedExtractionResult } from '../extractors/types';

// Helper: Constructs valid in-memory PKZip binary buffers
function createZipWithEntries(
  entries: {
    name: string;
    content: string | Uint8Array;
    uncompressedSizeOverride?: number;
    compressedSizeOverride?: number;
  }[]
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const cdEntries: { nameBytes: Uint8Array; offset: number; size: number }[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const dataBytes =
      typeof entry.content === 'string'
        ? new TextEncoder().encode(entry.content)
        : entry.content;
    const compSize = entry.compressedSizeOverride ?? dataBytes.length;
    const uncompSize = entry.uncompressedSizeOverride ?? dataBytes.length;

    // Local Header (30 bytes + name length)
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // signature
    view.setUint16(4, 20, true); // version
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // compression: store (0)
    view.setUint16(10, 0, true); // time
    view.setUint16(12, 0, true); // date
    view.setUint32(14, 0, true); // crc
    view.setUint32(18, compSize, true); // compressed size
    view.setUint32(22, uncompSize, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true); // name length
    view.setUint16(28, 0, true); // extra length
    header.set(nameBytes, 30);

    chunks.push(header);
    chunks.push(dataBytes);

    cdEntries.push({ nameBytes, offset: currentOffset, size: dataBytes.length });
    currentOffset += header.length + dataBytes.length;
  }

  const cdOffset = currentOffset;
  let cdSize = 0;
  for (const cd of cdEntries) {
    const cdHeader = new Uint8Array(46 + cd.nameBytes.length);
    const view = new DataView(cdHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, 0, true);
    view.setUint32(20, cd.size, true);
    view.setUint32(24, cd.size, true);
    view.setUint16(28, cd.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, cd.offset, true);
    cdHeader.set(cd.nameBytes, 46);

    chunks.push(cdHeader);
    cdSize += cdHeader.length;
  }

  // End of Central Directory
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, cdEntries.length, true);
  eocdView.setUint16(10, cdEntries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);
  eocdView.setUint16(20, 0, true);
  chunks.push(eocd);

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

describe('Proofly Phase 06 — Reliable Artifact Extraction and Evidence Provenance', () => {
  // ─────────────────────────────────────────────
  // 1. Text PDF Extraction & Page Provenance
  // ─────────────────────────────────────────────
  describe('PDF Extractor (Real Stream Parsing & Scanned Document OCR Detection)', () => {
    it('extracts text page-by-page from stream blocks and preserves page provenance', async () => {
      const validPdfString = `%PDF-1.4
1 0 obj
<< /Type /Page >>
endobj
2 0 obj
<< /Length 95 >>
stream
BT
/F1 14 Tf
72 712 Td
(System Architecture and Telemetry Pipeline) Tj
0 -20 Td
(Continuous cardiac telemetry processing via WebAssembly) Tj
ET
endstream
endobj
xref
0 3
0000000000 65535 f 
trailer
<< /Size 3 >>
startxref
250
%%EOF`;

      const bytes = new TextEncoder().encode(validPdfString);
      const result: NormalizedExtractionResult = await pdfExtractor.extract(bytes, {
        filename: 'architecture.pdf',
        artifactId: 'pdf-arch-01',
      });

      expect(result.status).toBe('EXTRACTED');
      expect(result.artifactType).toBe('PDF');
      expect(result.extractedContent).toContain('System Architecture and Telemetry Pipeline');
      expect(result.extractedContent).toContain('Continuous cardiac telemetry processing');
      expect(result.evidenceReferences.length).toBeGreaterThanOrEqual(1);

      const ref = result.evidenceReferences[0];
      expect(ref.artifactId).toBe('pdf-arch-01');
      expect(ref.location.pageNumber).toBe(1);
      expect(result.contentHash).toBeDefined();
      expect(result.contentHash.length).toBe(64);
    });

    it('detects scanned/rasterized PDF with image XObjects and returns REQUIRES_OCR without fabricating text', async () => {
      const scannedPdfString = `%PDF-1.4
1 0 obj
<< /Type /Page /Resources << /XObject << /Im1 2 0 R >> >> >>
endobj
2 0 obj
<< /Type /XObject /Subtype /Image /Width 800 /Height 600 >>
endobj
xref
trailer
<< /Root 1 0 R >>
%%EOF`;

      const bytes = new TextEncoder().encode(scannedPdfString);
      const result = await pdfExtractor.extract(bytes, {
        filename: 'scanned_receipt.pdf',
        artifactId: 'pdf-scanned-02',
      });

      expect(result.status).toBe('REQUIRES_OCR');
      expect(result.metadata?.ocrRequired).toBe(true);
      expect(result.metadata?.isScanned).toBe(true);
      expect(result.warnings.some((w) => w.includes('OCR service is required'))).toBe(true);
      expect(result.evidenceReferences.length).toBe(0); // Zero fabricated evidence
    });

    it('handles non-PDF / corrupt binary gracefully with EXTRACTION_FAILED', async () => {
      const corruptBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // PNG magic bytes
      const result = await pdfExtractor.extract(corruptBytes, {
        filename: 'not_a_pdf.pdf',
        artifactId: 'pdf-corrupt-03',
      });

      expect(result.status).toBe('EXTRACTION_FAILED');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.extractedContent).toBe('');
    });
  });

  // ─────────────────────────────────────────────
  // 2. PPTX Slide Extraction & XML Hierarchy
  // ─────────────────────────────────────────────
  describe('PPTX Extractor (Real XML Slide Parsing)', () => {
    it('extracts slide text from XML hierarchy (<a:t>), preserving slide numbers and titles', async () => {
      const slide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>OmniTrack: Real-Time Edge ECG Analysis</a:t></a:r></a:p>
          <a:p><a:r><a:t>Eliminating diagnostic latency in rural telemetry networks.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

      const slide2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Architecture & Benchmark Results</a:t></a:r></a:p>
          <a:p><a:r><a:t>Achieved 14ms latency on WebAssembly runtime under continuous stream.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

      const pptxBytes = createZipWithEntries([
        { name: '[Content_Types].xml', content: '<Types/>' },
        { name: 'ppt/slides/slide1.xml', content: slide1Xml },
        { name: 'ppt/slides/slide2.xml', content: slide2Xml },
      ]);

      const result = await pptxExtractor.extract(pptxBytes, {
        filename: 'pitch_deck.pptx',
        artifactId: 'pptx-deck-01',
      });

      expect(result.status).toBe('EXTRACTED');
      expect(result.artifactType).toBe('PPTX');
      expect(result.metadata?.slideCount).toBe(2);
      expect(result.extractedContent).toContain('Slide 1 (OmniTrack: Real-Time Edge ECG Analysis)');
      expect(result.extractedContent).toContain('Slide 2 (Architecture & Benchmark Results)');
      expect(result.evidenceReferences.length).toBe(2);

      const ref1 = result.evidenceReferences[0];
      expect(ref1.location.slideNumber).toBe(1);
      expect(ref1.location.sectionHeading).toBe('OmniTrack: Real-Time Edge ECG Analysis');

      const ref2 = result.evidenceReferences[1];
      expect(ref2.location.slideNumber).toBe(2);
      expect(ref2.location.sectionHeading).toBe('Architecture & Benchmark Results');
    });

    it('rejects legacy binary .ppt files with UNSUPPORTED status', async () => {
      const binaryPptBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]); // OLE2 Compound File Binary
      const result = await pptxExtractor.extract(binaryPptBytes, {
        filename: 'legacy.ppt',
        artifactId: 'pptx-legacy-02',
      });

      expect(result.status).toBe('UNSUPPORTED');
      expect(result.warnings.some((w) => w.includes('Legacy binary PPT format is unsupported'))).toBe(true);
    });

    it('handles malformed PPTX archive with EXTRACTION_FAILED', async () => {
      const corruptZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]); // truncated PKZip
      const result = await pptxExtractor.extract(corruptZip, {
        filename: 'corrupted.pptx',
        artifactId: 'pptx-corrupt-03',
      });

      expect(result.status).toBe('EXTRACTION_FAILED');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Secure ZIP Archive Inspector
  // ─────────────────────────────────────────────
  describe('Secure ZIP Extractor (Integrity, Bomb & Path Traversal Guards)', () => {
    it('safely indexes entries in a clean ZIP archive', async () => {
      const zipBytes = createZipWithEntries([
        { name: 'README.md', content: '# Project Documentation' },
        { name: 'src/index.ts', content: 'console.log("hello");' },
      ]);

      const result = await zipExtractor.extract(zipBytes, {
        filename: 'project_source.zip',
        artifactId: 'zip-clean-01',
      });

      expect(result.status).toBe('EXTRACTED');
      expect(result.metadata?.fileCount).toBe(2);
      expect(result.extractedContent).toContain('README.md');
      expect(result.extractedContent).toContain('src/index.ts');
      expect(result.warnings.some((w) => w.includes('No executable code was run'))).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('detects and warns on directory traversal sequences (../)', () => {
      const maliciousZip = createZipWithEntries([
        { name: '../../../../etc/shadow', content: 'root:*:12345' },
        { name: 'safe.txt', content: 'hello' },
      ]);

      const inspection = inspectZipArchive(maliciousZip);
      expect(inspection.hasPathTraversal).toBe(true);
      expect(inspection.warnings.some((w) => w.includes('Path traversal attempt detected'))).toBe(true);
    });

    it('detects potentially dangerous executable files in archives', () => {
      const exeZip = createZipWithEntries([
        { name: 'bin/worker.exe', content: 'MZ executable binary simulation' },
        { name: 'scripts/run.sh', content: '#!/bin/bash\necho 1' },
      ]);

      const inspection = inspectZipArchive(exeZip);
      expect(inspection.executableFiles).toContain('bin/worker.exe');
      expect(inspection.executableFiles).toContain('scripts/run.sh');
      expect(inspection.warnings.some((w) => w.includes('Potentially executable file detected'))).toBe(true);
    });

    it('triggers zip bomb protection when uncompressed size exceeds limit', () => {
      const bombZip = createZipWithEntries([
        {
          name: 'huge_file.dat',
          content: 'tiny',
          uncompressedSizeOverride: 30 * 1024 * 1024, // 30 MB (exceeds default 25MB limit)
          compressedSizeOverride: 4,
        },
      ]);

      const inspection = inspectZipArchive(bombZip);
      expect(inspection.isZipBomb).toBe(true);
      expect(inspection.errors.some((e) => e.includes('Zip bomb protection triggered'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Bounded GitHub Repository Extractor
  // ─────────────────────────────────────────────
  describe('GitHub Extractor (Bounded Inspection & Commit Provenance)', () => {
    it('fetches repo metadata, commit SHA, README, and candidate files with PARTIALLY_EXTRACTED status', async () => {
      const mockFetch: typeof fetch = vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/commits/')) {
          return new Response(
            JSON.stringify({ sha: '9f8e7d6c5b4a3210fedcba0987654321deadbeef' }),
            { status: 200 }
          );
        }
        if (u.includes('api.github.com/repos/deepmind/alpha-eval')) {
          return new Response(
            JSON.stringify({
              default_branch: 'main',
              stargazers_count: 512,
              description: 'AI Evaluation Harness',
            }),
            { status: 200 }
          );
        }
        if (u.includes('README.md')) {
          return new Response('# Alpha Eval\nHigh assurance automated evaluation pipeline.', { status: 200 });
        }
        if (u.includes('package.json')) {
          return new Response('{"name": "alpha-eval", "version": "2.0.0"}', { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      }) as any;

      const result = await githubExtractor.extract('https://github.com/deepmind/alpha-eval', {
        fetchFn: mockFetch,
        artifactId: 'gh-alpha-01',
      });

      expect(result.status).toBe('PARTIALLY_EXTRACTED');
      expect(result.artifactType).toBe('GITHUB_REPO');
      expect(result.metadata?.commitSha).toBe('9f8e7d6c5b4a3210fedcba0987654321deadbeef');
      expect(result.metadata?.branch).toBe('main');
      expect(result.metadata?.starsCount).toBe(512);
      expect(result.metadata?.inspectedFiles).toContain('package.json');
      expect(result.warnings.some((w) => w.includes('no runtime code execution sandbox was invoked'))).toBe(true);

      // Verify evidence references link to exact commit SHA and line numbers
      const readmeRef = result.evidenceReferences.find((r) => r.location.filePath === 'README.md');
      expect(readmeRef).toBeDefined();
      expect(readmeRef?.location.commitSha).toBe('9f8e7d6c5b4a3210fedcba0987654321deadbeef');
      expect(readmeRef?.location.startLine).toBe(1);
    });

    it('returns INACCESSIBLE for private or non-existent repositories', async () => {
      const mock404Fetch: typeof fetch = vi.fn(async () => {
        return new Response('Not Found', { status: 404 });
      }) as any;

      const result = await githubExtractor.extract('https://github.com/secret-org/non-existent-repo', {
        fetchFn: mock404Fetch,
        artifactId: 'gh-404-02',
      });

      expect(result.status).toBe('INACCESSIBLE');
      expect(result.warnings.some((w) => w.includes('Repository is private or does not exist'))).toBe(true);
      expect(result.extractedContent).toBe('');
    });

    it('handles rate limiting (429/403) honestly without crashing', async () => {
      const mockRateLimitFetch: typeof fetch = vi.fn(async () => {
        return new Response('API rate limit exceeded', { status: 403 });
      }) as any;

      const result = await githubExtractor.extract('https://github.com/busy-org/popular-repo', {
        fetchFn: mockRateLimitFetch,
        artifactId: 'gh-ratelimit-03',
      });

      expect(result.status).toBe('INACCESSIBLE');
      expect(result.warnings.some((w) => w.includes('GitHub API rate limit'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 5. SSRF-Protected Deployment URL Inspector
  // ─────────────────────────────────────────────
  describe('SSRF-Protected URL Inspector', () => {
    it('strictly blocks loopback addresses (127.0.0.1, localhost, 0.0.0.0)', async () => {
      const loopbackUrls = [
        'http://127.0.0.1:8080/metrics',
        'http://localhost:3000/api',
        'http://0.0.0.0:5000',
        'http://127.10.20.30:9000',
      ];

      for (const u of loopbackUrls) {
        const result = await urlInspector.extract(u);
        expect(result.status).toBe('INACCESSIBLE');
        expect(result.warnings.some((w) => w.includes('loopback') || w.includes('localhost'))).toBe(true);
      }
    });

    it('strictly blocks private RFC-1918 addresses (10.*, 172.16.*, 192.168.*)', async () => {
      const privateUrls = [
        'http://10.0.0.1/admin',
        'http://172.16.0.10/console',
        'http://172.31.255.255/internal',
        'http://192.168.1.1/router',
      ];

      for (const u of privateUrls) {
        const result = await urlInspector.extract(u);
        expect(result.status).toBe('INACCESSIBLE');
        expect(result.warnings.some((w) => w.includes('RFC-1918') || w.includes('private'))).toBe(true);
      }
    });

    it('strictly blocks cloud metadata and link-local addresses (169.254.169.254)', async () => {
      const cloudMetadataUrls = [
        'http://169.254.169.254/latest/meta-data/',
        'http://169.254.1.1/credentials',
      ];

      for (const u of cloudMetadataUrls) {
        const result = await urlInspector.extract(u);
        expect(result.status).toBe('INACCESSIBLE');
        expect(result.warnings.some((w) => w.includes('cloud metadata') || w.includes('link-local'))).toBe(true);
      }
    });

    it('rejects unsupported schemes (file:, gopher:, ftp:)', async () => {
      const invalidSchemes = ['file:///etc/passwd', 'ftp://ftp.example.com/file', 'gopher://gopher.floodgap.com'];
      for (const u of invalidSchemes) {
        const result = await urlInspector.extract(u);
        expect(result.status).toBe('UNSUPPORTED');
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('checks public URL reachability and attaches reachability vs functional verification disclaimer', async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response('<html><title>OmniTrack Sentinel</title><body>App Loaded</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }) as any;

      const result = await urlInspector.extract('https://omnitrack-sentinel.web.app', {
        fetchFn: mockFetch,
        artifactId: 'url-omni-01',
      });

      expect(result.status).toBe('EXTRACTED');
      expect((result.metadata as any)?.reachability?.isReachable).toBe(true);
      expect((result.metadata as any)?.reachability?.httpStatus).toBe(200);
      expect(result.extractedContent).toContain('OmniTrack Sentinel');
      expect(result.warnings.some((w) => w.includes('does not perform end-to-end functional UI verification'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 6. Explicit Uninspected Video Evidence Inspector
  // ─────────────────────────────────────────────
  describe('Video Inspector (Honest NOT_INSPECTED Status & Zero Hallucination)', () => {
    it('marks video URLs as NOT_INSPECTED with empty content and mandatory disclaimer', async () => {
      const videoUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/omnitrack-demo-2026',
        'https://vimeo.com/123456789',
        'https://www.loom.com/share/abcdef123456',
      ];

      for (const u of videoUrls) {
        const result = await videoInspector.extract(u);

        expect(result.status).toBe('NOT_INSPECTED');
        expect(result.extractedContent).toBe(''); // Strictly empty
        expect(result.evidenceReferences).toEqual([]); // Zero fabricated evidence
        expect((result.metadata as any)?.inspected).toBe(false);
        expect(result.warnings.some((w) => w.includes('Video was not visually or auditorily inspected'))).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────
  // 7. Plain Text & Markdown Extractor
  // ─────────────────────────────────────────────
  describe('Text & Markdown Extractor', () => {
    it('extracts Markdown and creates heading & line-range evidence references', async () => {
      const mdContent = `# Project Overview
OmniTrack provides edge-accelerated biomedical inference.

## Technical Architecture
Built with WebAssembly and Chrome Prompt API.

## Benchmark Validation
Validated on 1,200 patient records with sub-15ms latency.`;

      const result = await textExtractor.extract(mdContent, {
        filename: 'README.md',
        artifactId: 'txt-readme-01',
      });

      expect(result.status).toBe('EXTRACTED');
      expect(result.artifactType).toBe('TEXT_MARKDOWN');
      expect(result.evidenceReferences.length).toBeGreaterThanOrEqual(3);

      const headings = result.evidenceReferences.map((r) => r.location.sectionHeading);
      expect(headings).toContain('Project Overview');
      expect(headings).toContain('Technical Architecture');
      expect(headings).toContain('Benchmark Validation');

      const techRef = result.evidenceReferences.find((r) => r.location.sectionHeading === 'Technical Architecture');
      expect(techRef?.location.startLine).toBe(4);
    });
  });

  // ─────────────────────────────────────────────
  // 8. End-to-End Structured Evidence Packet Assembly
  // ─────────────────────────────────────────────
  describe('ContentExtractionService (Multi-Artifact Integration)', () => {
    it('assembles a structured evidence packet with full provenance across heterogeneous artifacts', async () => {
      const submission: ProjectSubmission = {
        id: 'sub-p6-integration',
        referenceId: 'PF-SUB-P6-01',
        competitionId: 'comp-global-ai',
        organizationId: 'org-proofly',
        formSchemaId: 'schema-default',
        submissionType: 'TEAM',
        teamName: 'Provenance Labs',
        primaryContactName: 'Lead Engineer',
        primaryContactEmail: 'lead@provenance.io',
        participants: [
          {
            id: 'p-p6-lead',
            competitionId: 'comp-global-ai',
            organizationId: 'org-proofly',
            name: 'Lead Engineer',
            email: 'lead@provenance.io',
            role: 'Architecture Lead',
            isLead: true,
            source: 'FORM_SUBMISSION',
            createdAt: new Date().toISOString(),
          },
        ],
        projectTitle: 'Provenance Verified Architecture',
        projectDescription: 'A verifiable end-to-end evidence pipeline for AI hackathon evaluation.',
        problemStatement: 'Unverified claims and hallucinated AI judging in competitive hackathons.',
        solution: 'Real parsers, bounded GitHub inspection, SSRF prevention, and exact line-range provenance.',
        technologiesUsed: ['TypeScript', 'PDF Stream Parser', 'PKZip', 'Vitest'],
        githubUrl: 'https://github.com/omnitrack/omnitrack-sentinel',
        deploymentUrl: 'https://omnitrack-sentinel.web.app',
        videoUrl: 'https://youtu.be/omnitrack-demo-2026',
        files: [
          {
            id: 'file-p6-pdf',
            fieldId: 'architecture_doc',
            fileName: 'Architecture_Blueprint.pdf',
            fileSize: 1024,
            mimeType: 'application/pdf',
            storagePath: 'competitions/comp-global-ai/Architecture_Blueprint.pdf',
            downloadUrl:
              'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvUGFnZT4+ZW5kb2JqCjIgMCBvYmo8PC9MZW5ndGggNTk+PnN0cmVhbQpCVAovRjEgMTIgVGYKKFByb3ZlbmFuY2UgVmVyaWZpZWQgQXJjaGl0ZWN0dXJlKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0Y=',
            uploadedAt: new Date().toISOString(),
            isVerified: true,
          },
        ],
        fieldValues: {},
        status: 'Queued for AI Evaluation',
        statusHistory: [],
        isLate: false,
        isLocked: false,
        currentVersion: 1,
        versions: [],
        managementTokenHash: 'hash-p6',
        managementTokenPrefix: 'sec_p6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const packet = await contentExtractionService.extractSubmissionEvidence(submission);

      expect(packet.submissionId).toBe('sub-p6-integration');
      expect(packet.documentContents.length).toBe(1);
      expect(packet.documentContents[0].extractionStatus).toBe('EXTRACTED');
      expect(packet.documentContents[0].contentHash).toBeDefined();

      expect(packet.githubMetadata).toBeDefined();
      expect(packet.githubMetadata?.branch).toBe('main');
      expect(packet.githubMetadata?.commitSha).toBeDefined();

      expect(packet.deploymentMetadata).toBeDefined();
      expect(packet.deploymentMetadata?.reachabilityChecked).toBe(true);

      expect(packet.videoMetadata).toBeDefined();
      expect(packet.videoMetadata?.inspected).toBe(false);
      expect(packet.videoMetadata?.disclaimer).toContain('Video was not visually or auditorily inspected');

      expect(packet.normalizedExtractions).toBeDefined();
      expect(packet.normalizedExtractions?.length).toBeGreaterThanOrEqual(4); // PDF, GitHub, URL, Video

      expect(packet.allEvidenceReferences).toBeDefined();
      expect(packet.allEvidenceReferences?.length).toBeGreaterThanOrEqual(1);

      // Verify mandatory code execution disclaimer
      expect(
        packet.evidenceDisclaimers.some((d) =>
          d.includes('no runtime code execution sandbox was invoked')
        )
      ).toBe(true);
    });
  });
});
