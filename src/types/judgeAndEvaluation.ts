// ─────────────────────────────────────────────
// judgeAndEvaluation.ts — Domain Types for Phase 7 Human Judging Workspace
// Proofly / Evalora — Multi-Judge Coordination, Workload, & Immutability
// ─────────────────────────────────────────────

export type JudgeAssignmentStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CONFLICT' | 'REVOKED';

export type JudgeDecisionMode = 'AGREE' | 'MODIFY' | 'REJECT';

export type ConcernCategory =
  | 'PLAGIARISM'
  | 'INAPPROPRIATE_CONTENT'
  | 'INSUFFICIENT_EVIDENCE'
  | 'TECHNICAL_FRAUD'
  | 'CODE_ORIGINALITY'
  | 'OTHER';

export type ConflictType =
  | 'DIRECT_COLLABORATOR'
  | 'ADVISOR_STUDENT'
  | 'INSTITUTIONAL'
  | 'FINANCIAL_PERSONAL'
  | 'OTHER';

export interface ConflictDeclaration {
  declaredByJudgeId: string;
  declaredByJudgeName: string;
  declaredAt: string;
  conflictType: ConflictType;
  reason: string;
}

export interface ReassignmentAudit {
  previousJudgeId: string;
  previousJudgeName: string;
  newJudgeId: string;
  newJudgeName: string;
  reassignedBy: string;
  reassignedByName: string;
  reassignedAt: string;
  reason: string;
}

export type JudgeAssignmentSource = 'MANUAL' | 'BATCH' | 'AUTO_BALANCED' | 'REASSIGNMENT';

export interface JudgeRecord {
  id: string; // User UID or unique judge ID
  userId?: string; // Firebase Auth UID for profile ownership matching
  organizationId?: string;
  name: string;
  email: string;
  title?: string;
  organization?: string;
  assignedTracks: string[];
  competitionIds: string[];
  roundIds?: string[];
  maxQuota?: number; // Maximum submissions to assign
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
  invitedAt?: string;
  avatarUrl?: string;
}

export interface JudgeAssignment {
  id: string;
  organizationId?: string;
  competitionId: string;
  roundId?: string;
  submissionId: string;
  referenceId: string;
  projectTitle: string;
  track?: string;
  judgeId: string;
  judgeName: string;
  judgeEmail: string;
  assignedBy: string;
  assignedByName: string;
  assignedAt: string;
  assignmentSource?: JudgeAssignmentSource;
  deadline?: string; // ISO date string
  status: JudgeAssignmentStatus;
  conflict?: ConflictDeclaration;
  reassignmentHistory: ReassignmentAudit[];
  completedAt?: string;
  updatedAt?: string;
}

export interface FlaggedConcern {
  flagged: boolean;
  category: ConcernCategory;
  explanation: string;
  flaggedAt: string;
  flaggedByJudgeId: string;
  flaggedByJudgeName: string;
}

export interface CriterionComparisonDetail {
  criterionId: string;
  criterionName: string;
  maxScore: number;
  aiScore: number;
  humanScore: number;
  diff: number; // humanScore - aiScore
}

export interface ReopenAuditRecord {
  reopenedBy: string; // Organizer User ID
  reopenedByName: string;
  reopenedAt: string;
  auditReason: string;
}

/**
 * Proofly Phase 11 — Judge Evidence Annotation
 * Allows judges to mark relevance, flag incorrect associations, disagree with AI,
 * and record non-support rationales.
 * Stored strictly separate from the original extracted evidence and immutable AI output.
 */
export interface JudgeEvidenceAnnotation {
  evidenceId: string;
  judgeId: string;
  submissionId: string;
  isRelevant?: boolean;
  flaggedIncorrect?: boolean;
  disagreeWithAi?: boolean;
  notes?: string;
  nonSupportReason?: string;
  updatedAt: string;
}

/**
 * Human Judge Evaluation Record
 * STRICT RULE: Stored in isolation, NEVER overwrites the AI evaluation report.
 * Once submitted, locked and immutable unless reopened with organizer authorization.
 */
export interface HumanJudgeEvaluation {
  id: string;
  assignmentId?: string;
  organizationId?: string;
  submissionId: string;
  referenceId: string;
  competitionId: string;
  roundId?: string;
  judgeId: string;
  judgeName: string;
  judgeEmail: string;
  source?: 'HUMAN';
  rubricVersion?: number;

  // Score comparisons
  decisionMode: JudgeDecisionMode;
  scores: Record<string, number>; // criterionId -> humanScore
  criterionComments?: Record<string, string>; // criterionId -> per-criterion comment
  overallComments?: string;
  totalScore: number; // Human total
  aiTotalScore: number; // Preserved original AI score
  scoreDifference: number; // totalScore - aiTotalScore
  criterionDifferences: Record<string, CriterionComparisonDetail>;

  // Rationales
  deductionNotes: string; // Preserved deduction justifications
  privateNotes?: string; // Optional private notes

  // Flagged concern
  flaggedConcern?: FlaggedConcern;

  // Phase 11 — Judge Evidence Annotations (Separate from AI output)
  evidenceAnnotations?: Record<string, JudgeEvidenceAnnotation>;

  // Immutability & Status
  status: 'DRAFT' | 'SUBMITTED';
  isLocked: boolean;
  submittedAt?: string;
  savedAsDraftAt?: string;

  // Reopen audit trail
  reopenHistory: ReopenAuditRecord[];
  reopenReason?: string;
  reopenedBy?: string;
  reopenedAt?: string;

  evaluatorVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface JudgeWorkloadSummary {
  judgeId: string;
  judgeName: string;
  judgeEmail: string;
  assignedTracks: string[];
  totalAssigned: number;
  pendingReviews: number;
  inProgressReviews: number;
  completedReviews: number;
  conflictsDeclared: number;
  maxQuota: number;
  completionRate: number; // 0 - 100%
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
}
