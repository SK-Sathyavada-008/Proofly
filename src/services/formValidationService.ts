// ─────────────────────────────────────────────
// formValidationService.ts — Dynamic Submission Form Field & Schema Validator
// Proofly — Phase 4
// ─────────────────────────────────────────────

import type {
  SubmissionFormSchema,
  SubmissionFormField,
  FormSubmissionValidationResult,
  TeamMemberEntry,
} from '../types/formAndAccess';

export interface FileMetadataInput {
  name: string;
  sizeBytes: number;
  type?: string;
}

export const formValidationService = {
  /**
   * Validates a complete submission payload against a form schema.
   * Returns a map of fieldId -> error message.
   */
  validateSubmission(
    schema: SubmissionFormSchema,
    data: Record<string, any>
  ): FormSubmissionValidationResult {
    const errors: Record<string, string> = {};

    for (const field of schema.fields) {
      const val = data[field.id];
      const fieldError = this.validateFieldValue(field, val);
      if (fieldError) {
        errors[field.id] = fieldError;
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  },

  /**
   * Validates form values and returns formatted error list.
   */
  validateFormValues(
    schema: SubmissionFormSchema,
    data: Record<string, any>
  ): { valid: boolean; errors: { fieldId: string; fieldLabel: string; message: string }[] } {
    const res = this.validateSubmission(schema, data);
    const errorList = Object.entries(res.errors).map(([fieldId, msg]) => {
      const f = schema.fields.find((field) => field.id === fieldId);
      return {
        fieldId,
        fieldLabel: f?.label || fieldId,
        message: msg,
      };
    });
    return {
      valid: errorList.length === 0,
      errors: errorList,
    };
  },

  /**
   * Validates a single field value against its field definition.
   */
  validateFieldValue(field: SubmissionFormField, value: any): string | null {
    const { required, validation, type } = field;

    // 1. Required Check
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);

    if (required && isEmpty) {
      return `${field.label} is required.`;
    }

    // If empty and not required, skip further format checks
    if (isEmpty) {
      return null;
    }

    // 2. Type-Specific Validations
    switch (type) {
      case 'SHORT_TEXT':
      case 'LONG_TEXT': {
        const str = String(value).trim();
        if (validation.minLength && str.length < validation.minLength) {
          return `${field.label} must be at least ${validation.minLength} characters.`;
        }
        if (validation.maxLength && str.length > validation.maxLength) {
          return `${field.label} cannot exceed ${validation.maxLength} characters.`;
        }
        if (validation.pattern) {
          try {
            const regex = new RegExp(validation.pattern);
            if (!regex.test(str)) {
              return `${field.label} does not match required format.`;
            }
          } catch {
            // invalid regex configuration ignored
          }
        }
        break;
      }

      case 'EMAIL': {
        const emailStr = String(value).trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailStr)) {
          return `Please enter a valid email address for ${field.label}.`;
        }
        break;
      }

      case 'URL': {
        const urlStr = String(value).trim();
        try {
          const parsed = new URL(urlStr);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return `${field.label} must be an HTTP or HTTPS web URL.`;
          }
        } catch {
          return `Please enter a valid URL for ${field.label}.`;
        }
        break;
      }

      case 'GITHUB_URL': {
        const ghStr = String(value).trim();
        const ghRegex = /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\/.*)?$/i;
        if (!ghRegex.test(ghStr)) {
          return `${field.label} must be a valid GitHub repository URL (e.g. https://github.com/owner/repo).`;
        }
        break;
      }

      case 'VIDEO_URL': {
        const vidStr = String(value).trim();
        try {
          const parsed = new URL(vidStr);
          const isKnownVideoHost =
            parsed.hostname.includes('youtube.com') ||
            parsed.hostname.includes('youtu.be') ||
            parsed.hostname.includes('vimeo.com') ||
            parsed.hostname.includes('loom.com') ||
            vidStr.endsWith('.mp4') ||
            vidStr.endsWith('.webm');

          if (!isKnownVideoHost) {
            return `${field.label} must be a YouTube, Vimeo, Loom, or direct MP4/WebM video link.`;
          }
        } catch {
          return `Please enter a valid video link for ${field.label}.`;
        }
        break;
      }

      case 'NUMBER': {
        const num = Number(value);
        if (isNaN(num)) {
          return `${field.label} must be a valid number.`;
        }
        if (validation.min !== undefined && num < validation.min) {
          return `${field.label} must be at least ${validation.min}.`;
        }
        if (validation.max !== undefined && num > validation.max) {
          return `${field.label} cannot exceed ${validation.max}.`;
        }
        break;
      }

      case 'DROPDOWN': {
        if (field.id === 'field-track' || /track/i.test(field.id)) {
          // Track dropdown accepts any valid competition track string or Open Track
          if (!value || typeof value !== 'string' || value.trim().length === 0) {
            return `Please select a valid ${field.label}.`;
          }
          break;
        }
        if (validation.options && validation.options.length > 0) {
          if (!validation.options.includes(value)) {
            return `Selected option for ${field.label} is invalid.`;
          }
        }
        break;
      }

      case 'MULTI_SELECT': {
        if (!Array.isArray(value)) {
          return `${field.label} must be a list of selections.`;
        }
        if (validation.options && validation.options.length > 0) {
          for (const item of value) {
            if (!validation.options.includes(item)) {
              return `Option "${item}" is not an allowed choice for ${field.label}.`;
            }
          }
        }
        break;
      }

      case 'CHECKBOX': {
        if (required && value !== true) {
          return `You must check ${field.label} to proceed.`;
        }
        break;
      }

      case 'FILE_UPLOAD': {
        const fileErr = this.validateFileMetadata(field, value);
        if (fileErr) return fileErr;
        break;
      }

      case 'MULTIPLE_FILE_UPLOAD': {
        if (!Array.isArray(value)) {
          return `${field.label} expects multiple file attachments.`;
        }
        if (validation.maxFilesCount && value.length > validation.maxFilesCount) {
          return `${field.label} accepts at most ${validation.maxFilesCount} files.`;
        }
        for (const file of value) {
          const fileErr = this.validateFileMetadata(field, file);
          if (fileErr) return fileErr;
        }
        break;
      }

      case 'TEAM_MEMBER_REPEATER': {
        if (!Array.isArray(value)) {
          return `${field.label} must be a list of team members.`;
        }
        if (validation.minMembers && value.length < validation.minMembers) {
          return `At least ${validation.minMembers} team member(s) required for ${field.label}.`;
        }
        if (validation.maxMembers && value.length > validation.maxMembers) {
          return `Cannot exceed ${validation.maxMembers} team member(s) for ${field.label}.`;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        for (let i = 0; i < value.length; i++) {
          const member = value[i] as TeamMemberEntry;
          if (!member.fullName || member.fullName.trim() === '') {
            return `Team member #${i + 1} name is required.`;
          }
          if (!member.email || !emailRegex.test(member.email.trim())) {
            return `Team member #${i + 1} (${member.fullName}) must have a valid email address.`;
          }
        }
        break;
      }
    }

    return null;
  },

  /**
   * Validates file size and file extension against field restrictions.
   */
  validateFileMetadata(field: SubmissionFormField, file: FileMetadataInput | any): string | null {
    if (!file || typeof file !== 'object') {
      return `${field.label} contains an invalid file descriptor.`;
    }

    const name = file.name || file.fileName || '';
    const sizeBytes = file.sizeBytes ?? file.fileSize ?? file.size;
    const { validation } = field;

    if (!name) {
      return `File name missing for ${field.label}.`;
    }

    // 1. File Type Restriction
    if (validation.fileTypeRestrictions && validation.fileTypeRestrictions.length > 0) {
      const lowerName = name.toLowerCase();
      const hasValidExt = validation.fileTypeRestrictions.some((ext) => {
        const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        return lowerName.endsWith(normalized);
      });
      if (!hasValidExt) {
        return `File "${name}" has an invalid file type. Permitted types: ${validation.fileTypeRestrictions.join(', ')}.`;
      }
    }

    // 2. File Size Restriction (in MB)
    if (validation.maxFileSizeMb && sizeBytes !== undefined) {
      const maxBytes = validation.maxFileSizeMb * 1024 * 1024;
      if (sizeBytes > maxBytes) {
        return `File "${name}" exceeds the maximum allowed file size of ${validation.maxFileSizeMb} MB.`;
      }
    }

    return null;
  },
};
