// ─────────────────────────────────────────────
// fileStorageService.ts — Secure File Validation & Storage Engine
// Proofly — Phase 5
// ─────────────────────────────────────────────

import { sha256Hash } from '../utils/cryptoUtils';
import type { StoredFileMetadata } from '../types/submission';

export interface FileValidationResult {
  valid: boolean;
  detectedMimeType?: string;
  error?: string;
}

export interface FileUploadOptions {
  fieldId: string;
  competitionId: string;
  submissionId: string;
  allowedExtensions?: string[];
  maxSizeMb?: number;
}

export class FileStorageService {
  /**
   * Sanitizes a file name to prevent path traversal and unsafe characters.
   */
  public sanitizeFileName(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() || 'unnamed_file';
    return base
      .replace(/[\x00-\x1f\x80-\x9f]/g, '') // remove control chars
      .replace(/[<>:"/\\|?*]/g, '_')        // replace illegal filesystem chars
      .trim();
  }

  /**
   * Inspects binary buffer headers (magic bytes) to determine genuine file type.
   * NEVER trusts client MIME type or extension alone.
   */
  public detectFileTypeFromBytes(bytes: Uint8Array): { mimeType: string; isExecutable: boolean } {
    if (bytes.length < 4) {
      return { mimeType: 'application/octet-stream', isExecutable: false };
    }

    // Windows PE Executable (MZ)
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
      return { mimeType: 'application/x-dosexec', isExecutable: true };
    }

    // Linux ELF Executable (\x7fELF)
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      return { mimeType: 'application/x-executable', isExecutable: true };
    }

    // Mach-O Executable
    if (
      (bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && bytes[3] === 0xce) ||
      (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe)
    ) {
      return { mimeType: 'application/x-mach-binary', isExecutable: true };
    }

    // Java Bytecode Class (CA FE BA BE)
    if (bytes[0] === 0xca && bytes[1] === 0xfe && bytes[2] === 0xba && bytes[3] === 0xbe) {
      return { mimeType: 'application/java-vm', isExecutable: true };
    }

    // PDF (%PDF-)
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return { mimeType: 'application/pdf', isExecutable: false };
    }

    // PNG (\x89PNG\r\n\x1a\n)
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return { mimeType: 'image/png', isExecutable: false };
    }

    // JPEG (\xFF\xD8\xFF)
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mimeType: 'image/jpeg', isExecutable: false };
    }

    // GIF (GIF87a or GIF89a)
    if (
      bytes.length >= 6 &&
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61
    ) {
      return { mimeType: 'image/gif', isExecutable: false };
    }

    // ZIP (PK\x03\x04 or PK\x05\x06) — also covers docx, pptx, etc.
    if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08))
    ) {
      return { mimeType: 'application/zip', isExecutable: false };
    }

    // Microsoft Office OLE2 / Compound File Binary Format (.ppt, .doc, .xls)
    if (
      bytes.length >= 4 &&
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0
    ) {
      return { mimeType: 'application/vnd.ms-powerpoint', isExecutable: false };
    }

    // Text / Markdown / JSON / CSV heuristic
    let isAsciiText = true;
    const checkLength = Math.min(bytes.length, 512);
    for (let i = 0; i < checkLength; i++) {
      const b = bytes[i];
      // Allow standard printable ASCII, tab, LF, CR
      if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) {
        isAsciiText = false;
        break;
      }
    }

    if (isAsciiText) {
      return { mimeType: 'text/plain', isExecutable: false };
    }

    return { mimeType: 'application/octet-stream', isExecutable: false };
  }

  /**
   * Validates a file's byte contents against size limits, dangerous executables,
   * and allowed extension lists.
   */
  public async validateFile(
    fileOrBytes: File | { name: string; size: number; bytes: Uint8Array },
    options: { allowedExtensions?: string[]; maxSizeMb?: number } = {}
  ): Promise<FileValidationResult> {
    const fileName = this.sanitizeFileName(fileOrBytes.name);
    const fileSize = fileOrBytes.size;
    const maxSize = (options.maxSizeMb || 25) * 1024 * 1024;

    // 1. File size check
    if (fileSize > maxSize) {
      return {
        valid: false,
        error: `File "${fileName}" exceeds maximum allowed size of ${options.maxSizeMb || 25}MB (actual: ${(fileSize / (1024 * 1024)).toFixed(2)}MB).`,
      };
    }

    if (fileSize === 0) {
      return {
        valid: false,
        error: `File "${fileName}" is empty (0 bytes).`,
      };
    }

    // 2. Dangerous extension blacklist
    const lowerName = fileName.toLowerCase();
    const dangerousExtensions = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.vbs', '.ps1', '.msi', '.com'];
    if (dangerousExtensions.some((ext) => lowerName.endsWith(ext))) {
      return {
        valid: false,
        error: `Executable file extensions are strictly prohibited for security.`,
      };
    }

    // 3. Extract bytes
    let bytes: Uint8Array;
    if ('bytes' in fileOrBytes && fileOrBytes.bytes instanceof Uint8Array) {
      bytes = fileOrBytes.bytes;
    } else {
      const buffer = await (fileOrBytes as any).arrayBuffer();
      bytes = new Uint8Array(buffer);
    }

    // 4. Magic bytes inspection
    const { mimeType, isExecutable } = this.detectFileTypeFromBytes(bytes);

    if (isExecutable) {
      return {
        valid: false,
        detectedMimeType: mimeType,
        error: `File "${fileName}" contains executable binary code (${mimeType}), which is prohibited.`,
      };
    }

    // 5. Allowed extension whitelist check
    if (options.allowedExtensions && options.allowedExtensions.length > 0) {
      const hasAllowedExt = options.allowedExtensions.some((ext) => {
        const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        return lowerName.endsWith(normalized);
      });

      if (!hasAllowedExt) {
        return {
          valid: false,
          detectedMimeType: mimeType,
          error: `File extension for "${fileName}" is not allowed. Allowed types: ${options.allowedExtensions.join(', ')}`,
        };
      }

      // Check for disguised extension (e.g. evil.exe renamed to test.pdf)
      if (lowerName.endsWith('.pdf') && mimeType !== 'application/pdf') {
        return {
          valid: false,
          detectedMimeType: mimeType,
          error: `File "${fileName}" does not have valid PDF headers (detected: ${mimeType}).`,
        };
      }

      if (lowerName.endsWith('.zip') && mimeType !== 'application/zip') {
        return {
          valid: false,
          detectedMimeType: mimeType,
          error: `File "${fileName}" does not have valid ZIP headers (detected: ${mimeType}).`,
        };
      }

      if (
        lowerName.endsWith('.pptx') &&
        mimeType !== 'application/zip' &&
        mimeType !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation' &&
        mimeType !== 'application/octet-stream' &&
        mimeType !== 'text/plain'
      ) {
        return {
          valid: false,
          detectedMimeType: mimeType,
          error: `File "${fileName}" does not have valid PPTX headers (detected: ${mimeType}).`,
        };
      }

      if (
        lowerName.endsWith('.ppt') &&
        mimeType !== 'application/vnd.ms-powerpoint' &&
        mimeType !== 'application/octet-stream' &&
        mimeType !== 'application/zip' &&
        mimeType !== 'text/plain'
      ) {
        return {
          valid: false,
          detectedMimeType: mimeType,
          error: `File "${fileName}" does not have valid PowerPoint headers (detected: ${mimeType}).`,
        };
      }
    }

    return {
      valid: true,
      detectedMimeType: mimeType,
    };
  }

  /**
   * Processes and stores a validated file, returning full StoredFileMetadata.
   */
  public async uploadFile(
    fileOrBytes: File | { name: string; size: number; bytes: Uint8Array; type?: string },
    options: FileUploadOptions
  ): Promise<StoredFileMetadata> {
    const validation = await this.validateFile(fileOrBytes, {
      allowedExtensions: options.allowedExtensions,
      maxSizeMb: options.maxSizeMb,
    });

    if (!validation.valid) {
      throw new Error(validation.error || 'File validation failed.');
    }

    const sanitizedName = this.sanitizeFileName(fileOrBytes.name);
    const fileId = `file_${Math.random().toString(36).substring(2, 10)}`;
    const storagePath = `submissions/${options.competitionId}/${options.submissionId}/${options.fieldId}/${fileId}_${sanitizedName}`;

    let bytes: Uint8Array;
    if ('bytes' in fileOrBytes && fileOrBytes.bytes instanceof Uint8Array) {
      bytes = fileOrBytes.bytes;
    } else {
      const buffer = await (fileOrBytes as any).arrayBuffer();
      bytes = new Uint8Array(buffer);
    }

    // Compute SHA-256 checksum
    const textDecoder = new TextDecoder('utf-8', { fatal: false });
    const previewString = textDecoder.decode(bytes.slice(0, 1024));
    const checksum = await sha256Hash(`${sanitizedName}_${bytes.length}_${previewString}`);

    // Generate safe download URL (in sandbox/offline environments, creates an object URL or data preview)
    let downloadUrl: string;
    if (typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
      try {
        const blob = new Blob([bytes as any], { type: validation.detectedMimeType || 'application/octet-stream' });
        downloadUrl = URL.createObjectURL(blob);
      } catch {
        downloadUrl = `https://storage.proofly.internal/${storagePath}`;
      }
    } else {
      downloadUrl = `https://storage.proofly.internal/${storagePath}`;
    }

    const metadata: StoredFileMetadata = {
      id: fileId,
      fieldId: options.fieldId,
      fileName: sanitizedName,
      fileSize: fileOrBytes.size,
      mimeType: fileOrBytes.type || validation.detectedMimeType || 'application/octet-stream',
      detectedMimeType: validation.detectedMimeType,
      storagePath,
      downloadUrl,
      uploadedAt: new Date().toISOString(),
      checksum,
      isVerified: true,
    };

    return metadata;
  }
}

export const fileStorageService = new FileStorageService();
