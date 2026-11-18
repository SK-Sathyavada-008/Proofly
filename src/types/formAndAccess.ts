// ─────────────────────────────────────────────
// formAndAccess.ts — Submission Form Builder & Access Management Domain Types
// Proofly — Phase 4
// ─────────────────────────────────────────────

export type FormFieldType =
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'EMAIL'
  | 'URL'
  | 'NUMBER'
  | 'DROPDOWN'
  | 'MULTI_SELECT'
  | 'CHECKBOX'
  | 'FILE_UPLOAD'
  | 'MULTIPLE_FILE_UPLOAD'
  | 'GITHUB_URL'
  | 'VIDEO_URL'
  | 'TEAM_MEMBER_REPEATER';

export type FieldVisibility = 'PUBLIC' | 'ORGANIZER_ONLY' | 'JUDGE_ONLY';

export interface FormFieldValidation {
  required: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string; // Regex pattern string
  options?: string[]; // Allowed dropdown or multi-select choices
  fileTypeRestrictions?: string[]; // e.g. ['.pdf', '.zip', '.ppt', '.png']
  fileExtensions?: string[]; // alias for fileTypeRestrictions
  maxFileSizeMb?: number; // e.g. 50 MB
  maxFilesCount?: number; // e.g. 5 files
  minMembers?: number; // For team member repeater
  maxMembers?: number;
}

export interface SubmissionFormField {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  order: number;
  visibility: FieldVisibility;
  validation: FormFieldValidation;
}

export interface SubmissionFormSchema {
  id: string;
  competitionId: string;
  roundId?: string; // Optional: allows round-specific forms
  title: string;
  description?: string;
  fields: SubmissionFormField[];
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Access Management Types
// ─────────────────────────────────────────────

export type AccessScopeType = 'PUBLIC_LINK' | 'ACCESS_CODE' | 'INDIVIDUAL_LINK';

export interface CompetitionAccessKey {
  id: string;
  competitionId: string;
  scopeType: AccessScopeType;
  code: string; // Public human-readable access code (e.g. 'PF-HYBRID26') or masked token identifier
  tokenHash?: string; // SHA-256 hash of unique individual secret token (NEVER plaintext)
  tokenPrefix?: string; // First 6 characters of raw token for organizer identification
  label?: string; // Human label, e.g. "Public Code", "VIP Team Alpha"
  targetParticipantEmail?: string; // For individual links
  targetTeamName?: string;
  submissionsCount: number;
  maxSubmissions?: number; // Cap on submissions (e.g. 1 for individual, 150 for hackathon)
  expiresAt?: string; // ISO date string
  revoked: boolean;
  revokedAt?: string;
  requireAuth: boolean; // Default false (zero participant account barrier)
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionSessionToken {
  sessionToken: string; // Ephemeral cryptographically random session token
  competitionId: string;
  roundId?: string;
  keyId: string;
  scopeType: AccessScopeType;
  participantEmail?: string;
  teamName?: string;
  expiresAt: string; // Short TTL (e.g. 30 minutes to complete submission)
  issuedAt: string;
}

export interface AccessValidationResult {
  valid: boolean;
  reason?: string;
  error?: string; // alias for reason
  accessKey?: CompetitionAccessKey;
  session?: SubmissionSessionToken;
  formSchema?: SubmissionFormSchema;
  competition?: any;
}

export interface FormSubmissionValidationResult {
  valid: boolean;
  errors: Record<string, string>; // fieldId -> error message
}

export interface TeamMemberEntry {
  fullName: string;
  email: string;
  role?: string;
  githubUsername?: string;
}
