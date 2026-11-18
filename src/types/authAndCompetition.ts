// ─────────────────────────────────────────────
// authAndCompetition.ts — Multi-Tenant Scoped Types for Proofly
// ─────────────────────────────────────────────

export type PlatformRole = 'SUPER_ADMIN' | 'USER';

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export type CompetitionRole = 'COMPETITION_ADMIN' | 'ORGANIZER' | 'JUDGE' | 'VIEWER';

export type CompetitionType =
  | 'HACKATHON'
  | 'RESEARCH_EXHIBITION'
  | 'INNOVATION_CHALLENGE'
  | 'ACADEMIC_CONTEST';

export type CompetitionStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'SUBMISSIONS_CLOSED'
  | 'EVALUATION'
  | 'RESULTS_REVIEW'
  | 'PUBLISHED'
  | 'ARCHIVED';

export type CompetitionVisibility = 'PUBLIC' | 'PRIVATE' | 'UNLISTED';

export type ParticipationType = 'INDIVIDUAL' | 'TEAM' | 'BOTH';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  platformRole: PlatformRole;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  tagline?: string;
  logoUrl?: string;
  website?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  userId: string;
  orgId: string;
  role: OrgRole;
  email: string;
  displayName: string;
  avatarUrl?: string;
  joinedAt: string;
}

export interface CompetitionRound {
  id: string;
  name: string;
  order: number;
  type: 'AI_PRE_SCREENING' | 'JUDGE_EVALUATION' | 'FINAL_PITCH';
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED';
}

export interface CompetitionPolicies {
  teamSubmissionsEnabled: boolean;
  minTeamMembers: number;
  maxTeamMembers: number;
  individualSubmissionsAllowed: boolean;
  submissionDeadline: string; // ISO string
  allowLateSubmissions: boolean;
  allowSubmissionEdits: boolean;
  aiEvaluationEnabled: boolean; // Mandatory for hackathon demo
  judgeFeedbackVisibleToParticipants: boolean;
  aiScoresVisibleToParticipants: boolean;
}

export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  maxScore: number;
  weight: number; // Percentage, sum of weights = 100
}

export interface Competition {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  tagline: string;
  description: string;
  type: CompetitionType;
  status: CompetitionStatus;
  visibility: CompetitionVisibility;
  participationType: ParticipationType;
  startDate: string;
  endDate: string;
  evaluationDeadline: string;
  publicAccessCode: string;
  policies: CompetitionPolicies;
  rounds: CompetitionRound[];
  rubric: RubricCriterion[];
  tracks: string[];
  isOpenTrackEnabled?: boolean;
  openTrackDescription?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CompetitionMemberAssignment {
  competitionId: string;
  userId: string;
  email: string;
  displayName: string;
  role: CompetitionRole;
  assignedTracks?: string[];
  quota?: number;
  assignedAt: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  resolvedRole?: string;
}
