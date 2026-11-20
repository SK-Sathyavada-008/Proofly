// ─────────────────────────────────────────────
// appealsAndNotifications.ts — Domain Types for Proofly Phase 14
// Participant Feedback, Evaluation Appeals & Reliable Notification System
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// 1. PARTICIPANT FEEDBACK TYPES
// ─────────────────────────────────────────────────────────────────

export interface ReleasedCriterionFeedback {
  criterionId: string;
  criterionName: string;
  maxScore: number;
  awardedScore: number;
  weight?: number;
  /** Released judge feedback comments (strictly scrubbed of private discussions). */
  releasedComments: string[];
  /** Released evidence highlights if configured. */
  releasedEvidenceReferences?: string[];
}

export interface ReleasedAiAssessment {
  summary: string;
  score: number;
  strengths: string[];
  improvementAreas: string[];
  disclaimer: string;
}

export interface CompetitionAnnouncement {
  id: string;
  competitionId: string;
  title: string;
  content: string;
  publishedAt: string;
  authorName: string;
  isPinned?: boolean;
}

export interface ParticipantReleasedFeedback {
  submissionId: string;
  referenceId: string;
  projectTitle: string;
  competitionId: string;
  competitionTitle: string;
  isResultsReleased: boolean;
  releasedAt?: string;
  submissionStatus: string;
  /** Official published score (null if unreleased) */
  publishedScore: number | null;
  maxPossibleScore: number;
  percentageScore: number | null;
  criterionFeedback: ReleasedCriterionFeedback[];
  publishedAiAssessment?: ReleasedAiAssessment;
  announcements: CompetitionAnnouncement[];
  existingAppealsCount: number;
}

// ─────────────────────────────────────────────────────────────────
// 2. PARTICIPANT APPEALS TYPES
// ─────────────────────────────────────────────────────────────────

export type AppealReason =
  | 'SCORING_DISCREPANCY'
  | 'EVIDENCE_OVERLOOKED'
  | 'TECHNICAL_MALFUNCTION'
  | 'RUBRIC_MISINTERPRETATION'
  | 'OTHER';

export type AppealStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_INFORMATION'
  | 'RESOLVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface AppealParticipantIdentity {
  participantId?: string;
  participantName: string;
  participantEmail?: string;
  teamId?: string;
  teamName?: string;
}

export interface AppealInformationRequest {
  id: string;
  question: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  response?: string;
  respondedAt?: string;
}

export interface AppealScoreAdjustment {
  applied: boolean;
  previousScore: number;
  newScore: number;
  scoreDelta: number;
  criterionId: string;
  scoreLedgerEntryId?: string;
  adjudicationRecordId?: string;
  reasonForAdjustment: string;
}

export interface AppealAuditEntry {
  status: AppealStatus;
  actorId: string;
  actorName: string;
  actorRole: string;
  timestamp: string;
  notes?: string;
}

export interface EvaluationAppeal {
  id: string;
  submissionId: string;
  referenceId: string;
  competitionId: string;
  organizationId: string;
  participant: AppealParticipantIdentity;
  criterionId: string;
  criterionName: string;
  reason: AppealReason;
  supportingExplanation: string;
  evidenceReferences?: string[];
  submittedAt: string;
  status: AppealStatus;
  assignedReviewer?: {
    id: string;
    name: string;
    role?: string;
  };
  informationRequests: AppealInformationRequest[];
  resolution?: string;
  resolver?: {
    id: string;
    name: string;
    role: string;
  };
  resolvedAt?: string;
  scoreAdjustment?: AppealScoreAdjustment;
  auditHistory: AppealAuditEntry[];
  updatedAt: string;
}

export interface SubmitAppealPayload {
  submissionId: string;
  referenceId: string;
  competitionId: string;
  organizationId?: string;
  participant: AppealParticipantIdentity;
  criterionId: string;
  criterionName: string;
  reason: AppealReason;
  supportingExplanation: string;
  evidenceReferences?: string[];
  managementToken?: string;
}

export interface ResolveAppealPayload {
  appealId: string;
  resolution: string;
  acceptAppeal: boolean;
  resolver: {
    id: string;
    name: string;
    role: string;
  };
  /**
   * If accepting with a score adjustment, must be processed through the append-only ledger.
   */
  scoreAdjustment?: {
    criterionId: string;
    newScore: number;
    reason: string;
  };
}

// ─────────────────────────────────────────────────────────────────
// 3. IN-APP NOTIFICATIONS TYPES
// ─────────────────────────────────────────────────────────────────

export type NotificationEventType =
  | 'COMPETITION_INVITATION'
  | 'REGISTRATION_CONFIRMATION'
  | 'SUBMISSION_CONFIRMATION'
  | 'SUBMISSION_DEADLINE_REMINDER'
  | 'SUBMISSION_STATUS_CHANGE'
  | 'JUDGE_ASSIGNMENT'
  | 'EVALUATION_DEADLINE'
  | 'EVALUATION_COMPLETION'
  | 'APPEAL_STATUS_CHANGE'
  | 'RESULTS_PUBLICATION'
  | 'ORGANIZER_ANNOUNCEMENT';

export type NotificationResourceType =
  | 'COMPETITION'
  | 'SUBMISSION'
  | 'EVALUATION'
  | 'APPEAL'
  | 'LEADERBOARD'
  | 'ANNOUNCEMENT';

export interface AppNotification {
  id: string;
  recipientId: string; // userId, participantId, or email
  recipientEmail?: string;
  recipientRole?: 'PARTICIPANT' | 'JUDGE' | 'ORGANIZER' | 'ADMIN';
  eventType: NotificationEventType;
  title: string;
  message: string;
  competitionId?: string;
  competitionTitle?: string;
  resourceType?: NotificationResourceType;
  resourceId?: string;
  actionUrl?: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  deduplicationKey?: string;
  metadata?: Record<string, any>;
  emailDelivery?: {
    attempted: boolean;
    delivered: boolean;
    provider: string;
    error?: string;
    timestamp?: string;
  };
}

export interface CreateNotificationInput {
  recipientId: string;
  recipientEmail?: string;
  recipientRole?: 'PARTICIPANT' | 'JUDGE' | 'ORGANIZER' | 'ADMIN';
  eventType: NotificationEventType;
  title: string;
  message: string;
  competitionId?: string;
  competitionTitle?: string;
  resourceType?: NotificationResourceType;
  resourceId?: string;
  actionUrl?: string;
  deduplicationKey?: string;
  metadata?: Record<string, any>;
  /** Optional override to trigger background email dispatch if configured. */
  sendEmail?: boolean;
}

export interface NotificationQueryOptions {
  recipientId: string;
  unreadOnly?: boolean;
  competitionId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedNotifications {
  notifications: AppNotification[];
  total: number;
  unreadCount: number;
  hasMore: boolean;
}

// ─────────────────────────────────────────────────────────────────
// 4. EMAIL EXTENSION & PREFERENCES
// ─────────────────────────────────────────────────────────────────

export interface UserNotificationPreferences {
  userId: string;
  emailNotificationsEnabled: boolean;
  subscribedCategories: {
    submissions: boolean;
    evaluations: boolean;
    appeals: boolean;
    announcements: boolean;
    reminders: boolean;
  };
}

export interface EmailDispatchPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  eventType: NotificationEventType;
  metadata?: Record<string, any>;
}

export interface EmailDeliveryReceipt {
  success: boolean;
  messageId: string;
  provider: string;
  deliveredAt: string;
  error?: string;
}

export interface EmailTransportProvider {
  sendEmail(payload: EmailDispatchPayload): Promise<EmailDeliveryReceipt>;
}
