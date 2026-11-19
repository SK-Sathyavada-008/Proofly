// ─────────────────────────────────────────────
// extractors/archiveUtils.ts — Safe PKZip Extraction & Decompression Primitives
// Proofly Phase 06 — Zip-Bomb, Path-Traversal & Executable Protection
// ─────────────────────────────────────────────

import { sha256Bytes } from '../../utils/cryptoUtils';

export interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number; // 0 = store, 8 = deflate
  dataOffset: number;
  data: Uint8Array;
  isExecutable: boolean;
  isPathTraversal: boolean;
  isNestedArchive: boolean;
}

export interface ZipArchiveInspectionResult {
  valid: boolean;
  entries: ZipEntry[];
  totalUncompressedSize: number;
  totalCompressedSize: number;
  fileCount: number;
  isZipBomb: boolean;
  hasPathTraversal: boolean;
  executableFiles: string[];
  warnings: string[];
  errors: string[];
}

export interface ArchiveSafetyLimits {
  maxTotalUncompressedBytes?: number; // default: 25 MB
  maxFileCount?: number;              // default: 500
  maxCompressionRatio?: number;       // default: 100:1
}

const DEFAULT_MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024; // 25 MB
const DEFAULT_MAX_FILE_COUNT = 500;
const DEFAULT_MAX_COMPRESSION_RATIO = 100; // 100:1

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.dll', '.so', '.dylib', '.com', '.vbs', '.ps1', '.msi', '.scr'
]);

const NESTED_ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2'
]);

/**
 * Decompresses raw deflate bytes (RFC 1951).
 */
export function inflateRawBytes(compressed: Uint8Array): Uint8Array {
  const g = globalThis as any;
  if (typeof g.process !== 'undefined' && typeof g.require === 'function') {
    try {
      const zlib = g.require('node:zlib');
      const buf = g.Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength);
      const decompressed = zlib.inflateRawSync(buf);
      return new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    } catch (err: any) {
      throw new Error(`Deflate decompression failed: ${err.message}`);
    }
  }

  // Pure sync fallback if uncompressed or store
  throw new Error('Decompression environment requires node:zlib or async DecompressionStream.');
}

/**
 * Decompresses zlib-wrapped deflate bytes (RFC 1950, standard in PDF streams).
 */
export function inflateZlibBytes(compressed: Uint8Array): Uint8Array {
  const g = globalThis as any;
  if (typeof g.process !== 'undefined' && typeof g.require === 'function') {
    try {
      const zlib = g.require('node:zlib');
      const buf = g.Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength);
      const decompressed = zlib.inflateSync(buf);
      return new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    } catch {
      // Try raw inflate if standard zlib header fails
      try {
        const zlib = g.require('node:zlib');
        const buf = g.Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength);
        const decompressed = zlib.inflateRawSync(buf);
        return new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
      } catch (innerErr: any) {
        throw new Error(`Zlib stream decompression failed: ${innerErr.message}`);
      }
    }
  }

  throw new Error('Zlib decompression requires node:zlib runtime.');
}

/**
 * Safely inspects and extracts a PKZip archive (ZIP or PPTX) with strict security bounds.
 */
export function inspectZipArchive(
  bytes: Uint8Array,
  limits: ArchiveSafetyLimits = {}
): ZipArchiveInspectionResult {
  const maxBytes = limits.maxTotalUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  const maxFiles = limits.maxFileCount ?? DEFAULT_MAX_FILE_COUNT;
  const maxRatio = limits.maxCompressionRatio ?? DEFAULT_MAX_COMPRESSION_RATIO;

  const warnings: string[] = [];
  const errors: string[] = [];
  const entries: ZipEntry[] = [];
  const executableFiles: string[] = [];
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let isZipBomb = false;
  let hasPathTraversal = false;

  // PKZip magic number: 'PK\x03\x04' (0x04034b50 in LE)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + 30 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);

    // Stop at Central Directory or End of Central Directory
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }

    // Local file header: 0x04034b50
    if (signature !== 0x04034b50) {
      offset++;
      continue;
    }

    if (entries.length >= maxFiles) {
      warnings.push(`Archive contains more than ${maxFiles} files; inspection truncated to safety limit.`);
      break;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const filenameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameOffset = offset + 30;
    if (nameOffset + filenameLen > bytes.byteLength) {
      errors.push('Malformed ZIP: truncated filename in local header.');
      break;
    }

    const rawFilename = new TextDecoder('utf-8').decode(
      bytes.subarray(nameOffset, nameOffset + filenameLen)
    );

    // Path traversal check
    const isTraversal =
      rawFilename.includes('../') ||
      rawFilename.includes('..\\') ||
      rawFilename.startsWith('/') ||
      rawFilename.startsWith('\\') ||
      rawFilename.includes('\0') ||
      /^[a-zA-Z]:/.test(rawFilename);

    if (isTraversal) {
      hasPathTraversal = true;
      warnings.push(`Path traversal attempt detected in entry: "${rawFilename}".`);
    }

    // Executable check
    const lowerName = rawFilename.toLowerCase();
    const ext = lowerName.slice(lowerName.lastIndexOf('.'));
    const isExec = EXECUTABLE_EXTENSIONS.has(ext);
    if (isExec) {
      executableFiles.push(rawFilename);
      warnings.push(`Potentially executable file detected: "${rawFilename}". Execution is strictly prohibited.`);
    }

    // Nested archive check
    const isNested = NESTED_ARCHIVE_EXTENSIONS.has(ext);
    if (isNested) {
      warnings.push(`Nested archive detected: "${rawFilename}". Nested decompression is disabled.`);
    }

    // Zip bomb detection
    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;

    if (totalUncompressed > maxBytes) {
      isZipBomb = true;
      errors.push(`Zip bomb protection triggered: total uncompressed size (${totalUncompressed} bytes) exceeds limit (${maxBytes} bytes).`);
      break;
    }

    if (compressedSize > 0 && uncompressedSize / compressedSize > maxRatio && uncompressedSize > 100000) {
      isZipBomb = true;
      errors.push(`Zip bomb protection triggered: entry "${rawFilename}" compression ratio (${Math.round(uncompressedSize / compressedSize)}:1) exceeds limit (${maxRatio}:1).`);
      break;
    }

    const dataStart = nameOffset + filenameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > bytes.byteLength) {
      errors.push(`Malformed ZIP: entry "${rawFilename}" compressed data extends beyond archive boundary.`);
      break;
    }

    let uncompressedData: Uint8Array = new Uint8Array(0);

    // Decompress if requested and not directories or empty files
    if (!rawFilename.endsWith('/') && !rawFilename.endsWith('\\') && !isZipBomb) {
      const rawData = bytes.subarray(dataStart, dataEnd);
      try {
        if (compressionMethod === 0) {
          uncompressedData = rawData;
        } else if (compressionMethod === 8) {
          uncompressedData = inflateRawBytes(rawData);
        }
      } catch (decompErr: any) {
        warnings.push(`Failed to decompress "${rawFilename}": ${decompErr.message}`);
      }
    }

    entries.push({
      filename: rawFilename,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      dataOffset: dataStart,
      data: uncompressedData,
      isExecutable: isExec,
      isPathTraversal: isTraversal,
      isNestedArchive: isNested,
    });

    offset = dataEnd;
  }

  const valid = errors.length === 0 && entries.length > 0;

  return {
    valid,
    entries,
    totalUncompressedSize: totalUncompressed,
    totalCompressedSize: totalCompressed,
    fileCount: entries.length,
    isZipBomb,
    hasPathTraversal,
    executableFiles,
    warnings,
    errors,
  };
}

/**
 * Computes SHA-256 for bytes safely.
 */
export async function computeHash(bytes: Uint8Array): Promise<string> {
  return sha256Bytes(bytes);
}
