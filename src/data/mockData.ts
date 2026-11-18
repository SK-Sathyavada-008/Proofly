// ─────────────────────────────────────────────
// PRison Control — Data Models (Clean / Empty State)
// ─────────────────────────────────────────────

import type {
  Participant,
  Repository,
  PullRequest,
  ScoreEvent,
  DashboardStats,
} from '../types';

export const mockParticipants: Participant[] = [];
export const mockRepositories: Repository[] = [];
export const mockPullRequests: PullRequest[] = [];
export const mockScoreEvents: ScoreEvent[] = [];

export const mockDashboardStats: DashboardStats = {
  totalParticipants: 0,
  totalRepositories: 0,
  totalPRs: 0,
  mergedPRs: 0,
  pendingReviews: 0,
  flaggedPRs: 0,
  totalXP: 0,
};
