// ─────────────────────────────────────────────
// Team Service — Offline Hackathon Squads & Live Leaderboard
// Deterministic Team Scoring · 4-Student Squads · Non-Duplicated Issue Tracking
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import type {
  Team,
  FirestoreTeam,
  FirestoreIssue,
  AdminAuditLog,
  AwardsSummary,
  EventMode,
  OfficialRankingPolicy,
  BuildFromScratchWeights,
} from '../types';

import { testMockTeams } from '../data/testSquads';

const COLLECTION_NAME = 'teams';

const proc = (globalThis as any).process;
const isVitest = typeof proc !== 'undefined' && (proc?.env?.VITEST || proc?.env?.NODE_ENV === 'test');

// In testing environments (Vitest), initialize with isolated test fixtures for regression testing.
// In real application environments (Browser, Dev Server, Production), start strictly clean with empty array.
export const initialMockTeams: FirestoreTeam[] = isVitest ? testMockTeams : [];

let inMemoryTeams: Team[] = sortTeams(initialMockTeams.map((t) => mapFirestoreToTeam(t)));
const listeners = new Set<(teams: Team[]) => void>();
const teamRankHistory = new Map<string, number>();

function notifyListeners() {
  const sorted = sortTeams(inMemoryTeams).map((t) => ({
    ...t,
    previousRank: teamRankHistory.get(t.id) ?? t.rank,
  }));
  sorted.forEach((t) => teamRankHistory.set(t.id, t.rank));
  listeners.forEach((fn) => fn(sorted));
}

export function getTeamVeryHardScore(team: Team | FirestoreTeam): number {
  if (team.veryHardScore !== undefined) return team.veryHardScore;
  return (team.solvedIssues || [])
    .filter((s) => s.difficulty === 'VERY_HARD')
    .reduce((sum, s) => sum + (s.points || 0), 0);
}

export function getTeamCorrectnessTotal(team: Team | FirestoreTeam): number {
  if (team.correctnessScoreTotal !== undefined) return team.correctnessScoreTotal;
  return (team.solvedIssues || []).reduce(
    (sum, s) => sum + (s.correctnessScore ?? 1.0),
    0
  );
}

/**
 * Phase 5 Deterministic Team Ranking Comparator:
 * 1. Total validated team XP, descending.
 * 2. Number of accurately solved Very Hard issues, descending.
 * 3. Total Very Hard issue score, descending.
 * 4. Total correctness score across validated issues, descending.
 * 5. If still tied, return 0 (display an explicit tie rather than inventing a winner).
 */
function roundToTwoDecimals(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function getTeamTotalXP(team: Team | FirestoreTeam): number {
  if (team.totalXP !== undefined) return team.totalXP;
  if (team.earnedXP !== undefined || team.bonusXP !== undefined) {
    const earned = team.earnedXP ?? (team.totalScore ?? 0);
    const bonus = team.bonusXP ?? 0;
    return roundToTwoDecimals(earned + bonus);
  }
  return team.totalScore ?? 0;
}

export function getTeamEarnedXP(team: Team | FirestoreTeam): number {
  if (team.earnedXP !== undefined) return team.earnedXP;
  if (team.totalScore !== undefined && team.bonusXP !== undefined) {
    return Math.max(0, roundToTwoDecimals(team.totalScore - team.bonusXP));
  }
  return team.totalScore ?? 0;
}

export function getTeamBonusXP(team: Team | FirestoreTeam): number {
  return team.bonusXP ?? 0;
}

/**
 * Phase 5 Deterministic Team Ranking Comparator:
 * 1. Total validated team XP (earnedXP + bonusXP), descending.
 * 2. Number of accurately solved Very Hard issues, descending.
 * 3. Total Very Hard issue score, descending.
 * 4. Total correctness score across validated issues, descending.
 * 5. If still tied, return 0 (display an explicit tie rather than inventing a winner).
 */
export function compareTeamsPhase5(a: Team, b: Team): number {
  // 1. Total validated team XP (totalXP = earnedXP + bonusXP), descending
  const aTotal = getTeamTotalXP(a);
  const bTotal = getTeamTotalXP(b);
  const scoreDiff = bTotal - aTotal;
  if (scoreDiff !== 0) return scoreDiff;

  // 2. Number of accurately solved Very Hard issues, descending
  const vhCountDiff = (b.veryHardSolvedCount ?? 0) - (a.veryHardSolvedCount ?? 0);
  if (vhCountDiff !== 0) return vhCountDiff;

  // 3. Total Very Hard issue score, descending
  const vhScoreDiff = getTeamVeryHardScore(b) - getTeamVeryHardScore(a);
  if (vhScoreDiff !== 0) return vhScoreDiff;

  // 4. Total correctness score across validated issues, descending
  const correctnessDiff = getTeamCorrectnessTotal(b) - getTeamCorrectnessTotal(a);
  if (correctnessDiff !== 0) return correctnessDiff;

  // 5. Explicit tie
  return 0;
}

/**
 * Calculates official Build-from-Scratch composite score based on configured policy.
 * Does NOT treat missing scores as zero!
 */
export function calculateTeamBuildFromScratchScore(
  team: Team | FirestoreTeam,
  arg2?: OfficialRankingPolicy | BuildFromScratchWeights,
  arg3?: OfficialRankingPolicy | BuildFromScratchWeights
): {
  rankingScore: number;
  finalScore: number;
  facultyContribution: number;
  gitProcessContribution: number;
  bonusXP: number;
  isPendingFaculty: boolean;
  isPendingGit: boolean;
  isFinalized: boolean;
  status: 'PENDING_FACULTY' | 'PENDING_EVALUATION' | 'REVIEW_REQUIRED' | 'FINALIZED';
  rankingStatus: 'PENDING_FACULTY' | 'PENDING_EVALUATION' | 'REVIEW_REQUIRED' | 'FINALIZED';
  breakdown: {
    explanation: string;
    facultyWeight: number;
    gitWeight: number;
  };
} {
  // Resolve flexible argument order
  let policy: OfficialRankingPolicy = 'FACULTY_PRIMARY';
  let weights: BuildFromScratchWeights = { faculty: 0.70, gitProcess: 0.30 };

  if (typeof arg2 === 'string') {
    policy = arg2 as OfficialRankingPolicy;
    if (arg3 && typeof arg3 === 'object') {
      weights = arg3 as BuildFromScratchWeights;
    }
  } else if (arg2 && typeof arg2 === 'object') {
    weights = arg2 as BuildFromScratchWeights;
    if (typeof arg3 === 'string') {
      policy = arg3 as OfficialRankingPolicy;
    }
  }

  // Normalize weights (if passed as 70/30 instead of 0.70/0.30)
  const normFacultyWeight = weights.faculty > 1 ? weights.faculty / 100 : weights.faculty;
  const normGitWeight = weights.gitProcess > 1 ? weights.gitProcess / 100 : weights.gitProcess;

  const isPendingFaculty = team.facultyScore === undefined || team.facultyScore === null;
  const isPendingGit = team.gitProcessScore === undefined || team.gitProcessScore === null;
  const bonusXP = team.bonusXP || 0;

  let facultyContribution = 0;
  let gitProcessContribution = 0;
  let rankingScore = 0;

  let status: 'PENDING_FACULTY' | 'PENDING_EVALUATION' | 'REVIEW_REQUIRED' | 'FINALIZED' = 'FINALIZED';

  if (team.latestEvaluationReport?.manualReviewRequired || team.evaluationStatus === 'REVIEW_REQUIRED') {
    status = 'REVIEW_REQUIRED';
  } else if (policy === 'FACULTY_PRIMARY' || (policy as string) === 'COMBINED_WEIGHTED') {
    if (isPendingFaculty) status = 'PENDING_FACULTY';
    else if (isPendingGit) status = 'PENDING_EVALUATION';
  } else if (policy === 'FACULTY_ONLY') {
    if (isPendingFaculty) status = 'PENDING_FACULTY';
  } else if (policy === 'GIT_PROCESS_ONLY') {
    if (isPendingGit) status = 'PENDING_EVALUATION';
  }

  const fScore = team.facultyScore ?? 0;
  const gScore = team.gitProcessScore ?? 0;

  if (policy === 'FACULTY_PRIMARY' || (policy as string) === 'COMBINED_WEIGHTED') {
    facultyContribution = roundToTwoDecimals(fScore * normFacultyWeight);
    gitProcessContribution = roundToTwoDecimals(gScore * normGitWeight);
    rankingScore = roundToTwoDecimals(facultyContribution + gitProcessContribution + (bonusXP * 0.1));
  } else if (policy === 'FACULTY_ONLY') {
    facultyContribution = roundToTwoDecimals(fScore);
    rankingScore = roundToTwoDecimals(facultyContribution + (bonusXP * 0.1));
  } else {
    gitProcessContribution = roundToTwoDecimals(gScore);
    rankingScore = roundToTwoDecimals(gitProcessContribution + (bonusXP * 0.1));
  }

  const explanation = status === 'PENDING_FACULTY'
    ? 'Faculty academic evaluation pending.'
    : status === 'PENDING_EVALUATION'
    ? 'Git process evaluation pending.'
    : status === 'REVIEW_REQUIRED'
    ? 'Manual review required by administrator.'
    : `Final score: ${rankingScore} pts (${Math.round(normFacultyWeight * 100)}% Faculty: ${facultyContribution} pts, ${Math.round(normGitWeight * 100)}% Git: ${gitProcessContribution} pts, Bonus: +${bonusXP} XP).`;

  return {
    rankingScore,
    finalScore: rankingScore,
    facultyContribution,
    gitProcessContribution,
    bonusXP,
    isPendingFaculty,
    isPendingGit,
    isFinalized: status === 'FINALIZED',
    status,
    rankingStatus: status,
    breakdown: {
      explanation,
      facultyWeight: Math.round(normFacultyWeight * 100),
      gitWeight: Math.round(normGitWeight * 100),
    },
  };
}

/**
 * Deterministic sorting and rank assignment for team leaderboard.
 * Preserves explicit ties (e.g. rankText 'T-1', isTied: true) when teams are tied across all criteria.
 * Supports configurable team sizes (4 or 5 students).
 * Seamlessly supports both Build-from-Scratch and Legacy Issue/PR scoring modes.
 */
export function sortTeams(
  teams: Team[],
  options?:
    | {
        mode?: EventMode;
        policy?: OfficialRankingPolicy;
        weights?: BuildFromScratchWeights;
      }
    | EventMode
): Team[] {
  const mode = typeof options === 'string' ? options : options?.mode;
  const policy: OfficialRankingPolicy =
    typeof options === 'object' && options?.policy ? options.policy : 'FACULTY_PRIMARY';
  const weights: BuildFromScratchWeights =
    typeof options === 'object' && options?.weights
      ? options.weights
      : { faculty: 0.70, gitProcess: 0.30 };

  // If explicitly requested or if teams contain Build-from-Scratch scores and mode is not set to LEGACY_ISSUE_PR
  const isBuildFromScratch =
    mode === 'BUILD_FROM_SCRATCH' ||
    (mode !== 'LEGACY_ISSUE_PR' &&
      teams.some((t) => t.facultyScore !== undefined || t.gitProcessScore !== undefined));

  if (!isBuildFromScratch) {
    const sorted = [...teams].sort(compareTeamsPhase5);
    const ranked: Team[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const raw = sorted[i];
      const earnedXP = getTeamEarnedXP(raw);
      const bonusXP = getTeamBonusXP(raw);
      const totalXP = getTeamTotalXP(raw);
      const targetSize = raw.configuredTeamSize || 4;
      const validCount = (raw.members || []).filter((m) => m.prSubmitted).length;

      const current: Team = {
        ...raw,
        earnedXP,
        bonusXP,
        totalXP,
        totalScore: totalXP, // Backward compatibility
        configuredTeamSize: targetSize,
        veryHardScore: getTeamVeryHardScore(raw),
        correctnessScoreTotal: getTeamCorrectnessTotal(raw),
        validSubmissionsCount: validCount,
        submissionStatus:
          validCount === targetSize
            ? 'ALL_VALID'
            : validCount > 0
            ? 'PARTIAL'
            : 'PENDING_PRS',
      };

      if (i > 0) {
        const prev = ranked[i - 1];
        if (compareTeamsPhase5(prev, current) === 0) {
          // True tie!
          current.rank = prev.rank;
          current.isTied = true;
          prev.isTied = true;
          current.rankText = `T-${prev.rank}`;
          prev.rankText = `T-${prev.rank}`;
        } else {
          const actualRank = i + 1;
          current.rank = actualRank;
          current.isTied = false;
          current.rankText = `#${actualRank}`;
        }
      } else {
        current.rank = 1;
        current.isTied = false;
        current.rankText = '#1';
      }
      ranked.push(current);
    }

    return ranked;
  }

  // ── BUILD-FROM-SCRATCH HACKATHON RANKING ───────────────────

  // Calculate scores for all teams
  const teamsWithBreakdown: Team[] = teams.map((raw) => {
    const breakdown = calculateTeamBuildFromScratchScore(raw, policy, weights);
    const earnedXP = raw.earnedXP ?? (raw.latestEvaluationReport?.earnedXP ?? raw.totalScore ?? 0);
    const bonusXP = getTeamBonusXP(raw);
    const totalXP = roundToTwoDecimals(earnedXP + bonusXP);

    return {
      ...raw,
      earnedXP,
      bonusXP,
      totalXP,
      totalScore: totalXP,
      rankingScore: breakdown.rankingScore,
      rankingStatus: breakdown.status,
      scoreBreakdown: breakdown,
      facultyScore: raw.facultyScore,
      gitProcessScore: raw.gitProcessScore,
    };
  });

  // Separate evaluated teams from pending teams to prevent treating missing scores as zero
  const completedTeams = teamsWithBreakdown.filter((t) => {
    const b = t.scoreBreakdown!;
    if (policy === 'FACULTY_PRIMARY') return !b.isPendingFaculty && !b.isPendingGit;
    if (policy === 'FACULTY_ONLY') return !b.isPendingFaculty;
    if (policy === 'GIT_PROCESS_ONLY') return !b.isPendingGit;
    return true;
  });

  const pendingTeams = teamsWithBreakdown.filter((t) => {
    const b = t.scoreBreakdown!;
    if (policy === 'FACULTY_PRIMARY') return b.isPendingFaculty || b.isPendingGit;
    if (policy === 'FACULTY_ONLY') return b.isPendingFaculty;
    if (policy === 'GIT_PROCESS_ONLY') return b.isPendingGit;
    return false;
  });

  // Sort completed teams deterministically
  completedTeams.sort((a, b) => {
    // 1. Ranking score descending
    const diff = (b.rankingScore ?? 0) - (a.rankingScore ?? 0);
    if (Math.abs(diff) > 0.001) return diff;

    // 2. Faculty score descending
    const fDiff = (b.facultyScore ?? 0) - (a.facultyScore ?? 0);
    if (fDiff !== 0) return fDiff;

    // 3. Git process score descending
    const gDiff = (b.gitProcessScore ?? 0) - (a.gitProcessScore ?? 0);
    if (gDiff !== 0) return gDiff;

    // 4. Manual bonus XP descending
    const bonusDiff = (b.bonusXP ?? 0) - (a.bonusXP ?? 0);
    if (bonusDiff !== 0) return bonusDiff;

    return 0;
  });

  const ranked: Team[] = [];

  // Assign ranks to completed teams with explicit ties support
  for (let i = 0; i < completedTeams.length; i++) {
    const current = completedTeams[i];
    if (i > 0) {
      const prev = ranked[i - 1];
      const isTied =
        Math.abs((prev.rankingScore ?? 0) - (current.rankingScore ?? 0)) < 0.001 &&
        (prev.facultyScore ?? 0) === (current.facultyScore ?? 0) &&
        (prev.gitProcessScore ?? 0) === (current.gitProcessScore ?? 0) &&
        (prev.bonusXP ?? 0) === (current.bonusXP ?? 0);

      if (isTied) {
        current.rank = prev.rank;
        current.isTied = true;
        prev.isTied = true;
        current.rankText = `T-${prev.rank}`;
        prev.rankText = `T-${prev.rank}`;
      } else {
        const actualRank = i + 1;
        current.rank = actualRank;
        current.isTied = false;
        current.rankText = `#${actualRank}`;
      }
    } else {
      current.rank = 1;
      current.isTied = false;
      current.rankText = '#1';
    }
    ranked.push(current);
  }

  // Pending teams are NOT assigned zero points or finalized rankings!
  const startPendingIndex = ranked.length + 1;
  pendingTeams.forEach((pTeam, idx) => {
    ranked.push({
      ...pTeam,
      rank: startPendingIndex + idx,
      rankText: 'Pending',
      isTied: false,
    });
  });

  return ranked;
}

/**
 * Special Award — Very Hard Specialist ranking.
 * Ranked separately from the main leaderboard:
 * 1. Number of accurately solved unique Very Hard issues (descending)
 * 2. Total Very Hard issue score (descending)
 * 3. Total Very Hard correctness score (descending)
 * 4. Transparent ties if equal.
 */
export function rankVeryHardSpecialists(teams: Team[]): {
  rankedTeams: Team[];
  winners: Team[];
  isTied: boolean;
} {
  const sorted = [...teams].sort((a, b) => {
    const countDiff = (b.veryHardSolvedCount ?? 0) - (a.veryHardSolvedCount ?? 0);
    if (countDiff !== 0) return countDiff;

    const vhScoreDiff = getTeamVeryHardScore(b) - getTeamVeryHardScore(a);
    if (vhScoreDiff !== 0) return vhScoreDiff;

    const vhCorrectnessA = (a.solvedIssues || [])
      .filter((s) => s.difficulty === 'VERY_HARD')
      .reduce((sum, s) => sum + (s.correctnessScore ?? 1.0), 0);
    const vhCorrectnessB = (b.solvedIssues || [])
      .filter((s) => s.difficulty === 'VERY_HARD')
      .reduce((sum, s) => sum + (s.correctnessScore ?? 1.0), 0);
    if (vhCorrectnessB !== vhCorrectnessA) return vhCorrectnessB - vhCorrectnessA;

    return 0;
  });

  const validVHTeams = sorted.filter((t) => (t.veryHardSolvedCount ?? 0) > 0);
  if (validVHTeams.length === 0) {
    return { rankedTeams: sorted, winners: [], isTied: false };
  }

  const topVH = validVHTeams[0];
  const winners = validVHTeams.filter(
    (t) =>
      (t.veryHardSolvedCount ?? 0) === (topVH.veryHardSolvedCount ?? 0) &&
      getTeamVeryHardScore(t) === getTeamVeryHardScore(topVH)
  );

  return {
    rankedTeams: sorted,
    winners,
    isTied: winners.length > 1,
  };
}

/**
 * Computes all 4 official awards for display on the leaderboard:
 * 1st Place — PRison Break Champions
 * 2nd Place — Runner-Up
 * 3rd Place — Third Place
 * Special Award — Very Hard Specialist
 */
export function getAwardsSummary(teams: Team[]): AwardsSummary {
  const sorted = sortTeams(teams);
  const champions = sorted.filter((t) => t.rank === 1);
  const runnerUp = sorted.filter((t) => t.rank === 2);
  const thirdPlace = sorted.filter((t) => t.rank === 3);

  const vhRanking = rankVeryHardSpecialists(teams);

  return {
    champions,
    runnerUp,
    thirdPlace,
    veryHardSpecialist: {
      winners: vhRanking.winners,
      highestCount: vhRanking.winners[0]?.veryHardSolvedCount ?? 0,
      highestScore: vhRanking.winners[0] ? getTeamVeryHardScore(vhRanking.winners[0]) : 0,
      isTied: vhRanking.isTied,
    },
  };
}

export function mapFirestoreToTeam(data: FirestoreTeam, rank: number = 0, prevRank: number = 0): Team {
  const earnedXP = getTeamEarnedXP(data);
  const bonusXP = getTeamBonusXP(data);
  const totalXP = getTeamTotalXP(data);
  const configuredTeamSize = data.configuredTeamSize || 4;

  return {
    ...data,
    earnedXP,
    bonusXP,
    totalXP,
    totalScore: totalXP,
    configuredTeamSize,
    rank: rank || 1,
    previousRank: prevRank || rank || 1,
  };
}

export const teamService = {
  /**
   * Subscribes to the live Teams leaderboard in real time.
   */
  subscribeToTeamsLeaderboard(
    onUpdate: (teams: Team[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    if (!isFirebaseConfigured()) {
      listeners.add(onUpdate);
      const sorted = sortTeams(inMemoryTeams).map((t, index) => ({
        ...t,
        rank: index + 1,
        previousRank: teamRankHistory.get(t.id) ?? index + 1,
      }));
      onUpdate(sorted);
      return () => {
        listeners.delete(onUpdate);
      };
    }

    try {
      const colRef = collection(db, COLLECTION_NAME);
      return onSnapshot(
        colRef,
        (snapshot) => {
          if (snapshot.empty) {
            onUpdate([]);
            return;
          }

          const rawTeams: Team[] = snapshot.docs.map((docSnap) => {
            const data = { id: docSnap.id, ...docSnap.data() } as FirestoreTeam;
            return mapFirestoreToTeam(data);
          });

          const sorted = sortTeams(rawTeams);
          const ranked: Team[] = sorted.map((t, index) => {
            const currentRank = index + 1;
            const previousRank = teamRankHistory.get(t.id) ?? currentRank;
            return {
              ...t,
              rank: currentRank,
              previousRank,
            };
          });

          ranked.forEach((t) => teamRankHistory.set(t.id, t.rank));
          onUpdate(ranked);
        },
        (error) => {
          console.error('[TeamService] Firestore subscription error:', error);
          if (onError) onError(error);
          else {
            const fallback = sortTeams(inMemoryTeams).map((t, i) => ({
              ...t,
              rank: i + 1,
            }));
            onUpdate(fallback);
          }
        }
      );
    } catch (err) {
      console.warn('[TeamService] Failed to establish real-time listener:', err);
      const fallback = sortTeams(inMemoryTeams).map((t, i) => ({
        ...t,
        rank: i + 1,
      }));
      onUpdate(fallback);
      return () => {};
    }
  },

  /**
   * Fetches all teams once.
   */
  async getTeams(): Promise<Team[]> {
    if (!isFirebaseConfigured()) {
      return sortTeams(inMemoryTeams).map((t, i) => ({
        ...t,
        rank: i + 1,
      }));
    }

    try {
      const colRef = collection(db, COLLECTION_NAME);
      const snapshot = await getDocs(colRef);
      if (snapshot.empty) {
        return [];
      }

      const raw = snapshot.docs.map((docSnap) => {
        const data = { id: docSnap.id, ...docSnap.data() } as FirestoreTeam;
        return mapFirestoreToTeam(data);
      });

      return sortTeams(raw).map((t, index) => ({
        ...t,
        rank: index + 1,
      }));
    } catch (error) {
      console.error('[TeamService] Error fetching teams:', error);
      return sortTeams(inMemoryTeams).map((t, i) => ({
        ...t,
        rank: i + 1,
      }));
    }
  },

  /**
   * Fetches a team by its ID.
   */
  async getTeamById(teamId: string): Promise<Team | null> {
    if (!isFirebaseConfigured()) {
      const found = inMemoryTeams.find((t) => t.id === teamId || t.repositoryId === teamId);
      return found ?? null;
    }
    try {
      const docSnap = await getDoc(doc(db, COLLECTION_NAME, teamId));
      if (!docSnap.exists()) return null;
      return mapFirestoreToTeam({ id: docSnap.id, ...docSnap.data() } as FirestoreTeam);
    } catch {
      const found = inMemoryTeams.find((t) => t.id === teamId || t.repositoryId === teamId);
      return found ?? null;
    }
  },

  /**
   * Updates partial fields of a team document.
   */
  async updateTeam(teamId: string, updates: Partial<FirestoreTeam>): Promise<void> {
    if (isFirebaseConfigured()) {
      await updateDoc(doc(db, COLLECTION_NAME, teamId), updates);
    } else {
      inMemoryTeams = inMemoryTeams.map((t) => (t.id === teamId ? { ...t, ...updates } : t));
      notifyListeners();
    }
  },

  /**
   * Updates team details, recalculates rankings/scores, and returns updated team document.
   */
  async updateTeamDetails(
    teamId: string,
    updates: Partial<FirestoreTeam>,
    _adminUsername: string = 'admin',
    _reason: string = 'Team details updated'
  ): Promise<FirestoreTeam> {
    const existing = await this.getTeamById(teamId);
    if (!existing) {
      throw new Error(`Team not found: "${teamId}".`);
    }

    const merged: FirestoreTeam = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured()) {
      await updateDoc(doc(db, COLLECTION_NAME, teamId), updates);
    } else {
      inMemoryTeams = inMemoryTeams.map((t) => (t.id === teamId ? { ...t, ...merged } : t));
      notifyListeners();
    }

    return merged;
  },

  /**
   * Fetches a team by ID or by repository name (e.g. "squard_1").
   */
  async getTeamByRepository(repoNameOrId: string): Promise<Team | null> {
    const clean = repoNameOrId.trim().toLowerCase().replace(/^repo_/, '');

    if (!isFirebaseConfigured()) {
      const found = inMemoryTeams.find(
        (t) =>
          t.repositoryId.toLowerCase() === clean ||
          t.repositoryName.toLowerCase() === clean ||
          t.id.toLowerCase() === `team_${clean}`
      );
      return found ?? null;
    }

    try {
      const colRef = collection(db, COLLECTION_NAME);
      const snapshot = await getDocs(colRef);
      const matched = snapshot.docs.find((d) => {
        const data = d.data() as FirestoreTeam;
        return (
          data.repositoryId.toLowerCase() === clean ||
          data.repositoryName?.toLowerCase() === clean ||
          d.id.toLowerCase() === `team_${clean}`
        );
      });

      if (!matched) return null;
      return mapFirestoreToTeam({ id: matched.id, ...matched.data() } as FirestoreTeam);
    } catch (error) {
      console.error('[TeamService] Error finding team by repo:', error);
      return null;
    }
  },

  /**
   * Registers or updates a team.
   */
  async saveTeam(team: Partial<FirestoreTeam> & { name: string; repositoryId: string }): Promise<string> {
    const cleanRepo = team.repositoryId.trim().replace(/^repo_/, '');
    const id = team.id || `team_${cleanRepo.toLowerCase()}`;
    const now = new Date().toISOString();

    const teamDoc: FirestoreTeam = {
      id,
      name: team.name.trim(),
      repositoryId: team.repositoryId.trim(),
      repositoryName: team.repositoryName || cleanRepo,
      repositoryFullName: team.repositoryFullName || cleanRepo,
      githubUrl: team.githubUrl,
      repoOwner: team.repoOwner,
      repoName: team.repoName,
      problemTitle: team.problemTitle,
      facultyScore: team.facultyScore,
      gitProcessScore: team.gitProcessScore,
      bonusXP: team.bonusXP ?? 0,
      earnedXP: team.earnedXP,
      totalXP: team.totalXP,
      rankingStatus: team.rankingStatus,
      buildSubmissionStatus: team.buildSubmissionStatus,
      latestEvaluationReport: team.latestEvaluationReport,
      checkpoints: team.checkpoints,
      members: team.members || [],
      totalScore: team.totalScore ?? 0,
      solvedIssues: team.solvedIssues || [],
      validatedIssueCount: team.validatedIssueCount ?? (team.solvedIssues?.length || 0),
      assignedIssueCount: team.assignedIssueCount ?? (team.members?.reduce((acc, m) => acc + (m.assignedIssues?.length || 0), 0) || 4),
      correctlySolvedIssuesCount: team.correctlySolvedIssuesCount ?? team.validatedIssueCount ?? (team.solvedIssues?.length || 0),
      veryHardSolvedCount: team.veryHardSolvedCount ?? (team.solvedIssues?.filter((s) => s.difficulty === 'VERY_HARD').length || 0),
      prsSubmitted: team.prsSubmitted ?? 0,
      lastMergedAt: team.lastMergedAt ?? null,
      active: team.active ?? true,
      createdAt: team.createdAt ?? now,
      updatedAt: now,
    };

    if (isFirebaseConfigured()) {
      const docRef = doc(db, COLLECTION_NAME, id);
      await setDoc(docRef, teamDoc, { merge: true });
    } else {
      const mapped = mapFirestoreToTeam(teamDoc);
      inMemoryTeams = [mapped, ...inMemoryTeams.filter((t) => t.id !== id)];
      notifyListeners();
    }

    return id;
  },

  /**
   * Deletes a team.
   */
  async deleteTeam(teamId: string): Promise<void> {
    if (isFirebaseConfigured()) {
      await deleteDoc(doc(db, COLLECTION_NAME, teamId));
    } else {
      inMemoryTeams = inMemoryTeams.filter((t) => t.id !== teamId);
      notifyListeners();
    }
  },

  /**
   * Approves a 5-member team with an administrative justification reason.
   */
  async approveFiveMemberTeam(
    teamId: string,
    reason: string,
    adminUsername: string
  ): Promise<AdminAuditLog> {
    return this.setTeamConfiguredSize(teamId, 5, reason, adminUsername);
  },

  /**
   * Sets the configured team size (4 or 5) for a team with mandatory reason and audit logging.
   */
  async setTeamConfiguredSize(
    teamId: string,
    size: 4 | 5,
    reason: string,
    adminUsername: string
  ): Promise<AdminAuditLog> {
    if (size !== 4 && size !== 5) {
      throw new Error('Configurable allowed team sizes are strictly 4 or 5 members.');
    }
    if (!reason || !reason.trim()) {
      throw new Error("A mandatory justification reason is required when changing a team's configured size.");
    }
    if (!adminUsername || !adminUsername.trim()) {
      throw new Error('Unauthorized: Admin username is required to change team size.');
    }

    const now = new Date().toISOString();
    const auditId = `audit_team_size_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const team = await this.getTeamById(teamId);
    if (!team) {
      throw new Error(`Team with ID "${teamId}" not found.`);
    }

    const previousSize = team.configuredTeamSize || 4;

    const auditLog: AdminAuditLog = {
      id: auditId,
      action: 'TEAM_SIZE_CHANGED',
      teamId,
      performedBy: adminUsername.trim(),
      adminUsername: adminUsername.trim(),
      targetId: teamId,
      targetName: team.name,
      previousValue: { configuredTeamSize: previousSize },
      newValue: { configuredTeamSize: size },
      details: {
        previousSize,
        newSize: size,
        reason: reason.trim(),
      },
      reason: reason.trim(),
      timestamp: now,
    };

    if (isFirebaseConfigured()) {
      await setDoc(doc(db, 'auditLogs', auditId), auditLog);
      await updateDoc(doc(db, COLLECTION_NAME, teamId), {
        configuredTeamSize: size,
        sizeChangeReason: reason.trim(),
        sizeApprovedBy: adminUsername.trim(),
        updatedAt: now,
      });
    }

    await this.updateTeam(teamId, {
      configuredTeamSize: size,
      sizeChangeReason: reason.trim(),
      sizeApprovedBy: adminUsername.trim(),
      updatedAt: now,
    });

    return auditLog;
  },

  /**
   * Server-side validation for team activation:
   * Prevents activation unless the team has its configured number of registered members (default 4, or approved 5),
   * a valid repository, no duplicate repository assignment, and no duplicate student memberships.
   */
  validateTeamForActivation(
    team: Partial<FirestoreTeam>,
    allTeams: FirestoreTeam[] = []
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Configured registered members check (default 4, or approved 5)
    const targetSize = team.configuredTeamSize || 4;
    if (targetSize !== 4 && targetSize !== 5) {
      errors.push(`Configured team size must be either 4 or 5 students (received ${targetSize}).`);
    }

    const memberCount = team.members ? team.members.length : 0;
    if (memberCount !== targetSize) {
      if (targetSize === 4) {
        errors.push(`A competition team must have exactly 4 registered members (currently has ${memberCount}).`);
      } else {
        errors.push(`A competition team must have its configured ${targetSize} registered members (currently has ${memberCount}).`);
      }
    }

    // 2. Exactly one assigned repository
    if (!team.repositoryId || !team.repositoryId.trim()) {
      errors.push('A competition team must have an assigned repository.');
    }

    // 3. Repository must not be assigned to multiple active teams
    if (team.repositoryId) {
      const cleanRepo = team.repositoryId.trim().toLowerCase();
      const duplicateRepoTeam = allTeams.find(
        (t) =>
          t.id !== team.id &&
          t.active !== false &&
          (t.repositoryId.toLowerCase() === cleanRepo || (t.repositoryName || '').toLowerCase() === cleanRepo)
      );
      if (duplicateRepoTeam) {
        errors.push(
          `Repository "${team.repositoryId}" is already assigned to active team "${duplicateRepoTeam.name}". A repository cannot be assigned to multiple active teams.`
        );
      }
    }

    // 4. A student may belong to only one active team
    if (team.members && team.members.length > 0) {
      for (const member of team.members) {
        const cleanUser = member.githubUsername.trim().toLowerCase();
        const duplicateStudentTeam = allTeams.find(
          (t) =>
            t.id !== team.id &&
            t.active !== false &&
            t.members.some(
              (m) =>
                m.studentId === member.studentId ||
                m.githubUsername.trim().toLowerCase() === cleanUser
            )
        );
        if (duplicateStudentTeam) {
          errors.push(
            `Student @${member.githubUsername} is already registered in active team "${duplicateStudentTeam.name}". A student may belong to only one active team.`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Auditable replacement of a team member:
   * Replaces a student member with a documented admin reason and writes an immutable audit record.
   */
  async replaceParticipantWithAudit(
    teamId: string,
    oldUsername: string,
    newMember: { name: string; githubUsername: string; studentId?: string },
    adminName: string,
    reason: string
  ): Promise<void> {
    if (!reason || !reason.trim()) {
      throw new Error('A documented justification reason is required for participant replacement.');
    }

    const cleanOld = oldUsername.trim().toLowerCase();
    const cleanNew = newMember.githubUsername.trim().toLowerCase();
    const now = new Date().toISOString();

    // Check if new student is already in an active team
    const allTeams = await this.getTeams();
    const duplicateTeam = allTeams.find(
      (t) =>
        t.active !== false &&
        t.members.some((m) => m.githubUsername.toLowerCase() === cleanNew)
    );
    if (duplicateTeam) {
      throw new Error(
        `Replacement student @${newMember.githubUsername} is already active in team "${duplicateTeam.name}".`
      );
    }

    const targetTeam = allTeams.find((t) => t.id === teamId);
    if (!targetTeam) {
      throw new Error(`Team with ID "${teamId}" not found.`);
    }

    const memberIdx = targetTeam.members.findIndex(
      (m) => m.githubUsername.toLowerCase() === cleanOld
    );
    if (memberIdx < 0) {
      throw new Error(`Student @${oldUsername} was not found in team "${targetTeam.name}".`);
    }

    const oldMemberData = targetTeam.members[memberIdx];
    const newStudentId = newMember.studentId || `s_${cleanNew.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    // Update team member
    const updatedMembers = [...targetTeam.members];
    updatedMembers[memberIdx] = {
      ...oldMemberData,
      studentId: newStudentId,
      name: newMember.name.trim(),
      githubUsername: newMember.githubUsername.trim(),
      validationStatus: `Audited replacement for @${oldUsername}`,
    };

    // 1. Write audit log
    const auditId = `audit_rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const auditLog: AdminAuditLog = {
      id: auditId,
      action: 'PARTICIPANT_REPLACEMENT',
      teamId,
      repositoryId: targetTeam.repositoryId,
      performedBy: adminName,
      details: {
        oldMember: oldMemberData,
        newMember: {
          studentId: newStudentId,
          name: newMember.name,
          githubUsername: newMember.githubUsername,
        },
      },
      reason: reason.trim(),
      timestamp: now,
    };

    if (isFirebaseConfigured()) {
      await setDoc(doc(db, 'auditLogs', auditId), auditLog);
      await updateDoc(doc(db, COLLECTION_NAME, teamId), {
        members: updatedMembers,
        updatedAt: now,
      });
    } else {
      targetTeam.members = updatedMembers;
      targetTeam.updatedAt = now;
      notifyListeners();
    }
  },

  /**
   * Auditable repository reassignment:
   * Validates that the new repository is not assigned to another active squad.
   */
  async reassignRepositoryWithAudit(
    teamId: string,
    newRepository: { id: string; name: string; fullName?: string },
    adminName: string,
    reason: string
  ): Promise<void> {
    if (!reason || !reason.trim()) {
      throw new Error('A documented justification is required for repository reassignment.');
    }

    const allTeams = await this.getTeams();
    const cleanRepo = newRepository.id.trim().toLowerCase();

    const otherActive = allTeams.find(
      (t) =>
        t.id !== teamId &&
        t.active !== false &&
        (t.repositoryId.toLowerCase() === cleanRepo || t.repositoryName.toLowerCase() === cleanRepo)
    );
    if (otherActive) {
      throw new Error(
        `Repository "${newRepository.name}" is already assigned to active team "${otherActive.name}".`
      );
    }

    const now = new Date().toISOString();
    const auditId = `audit_repo_${Date.now()}`;
    const auditLog: AdminAuditLog = {
      id: auditId,
      action: 'REPOSITORY_REASSIGNMENT',
      teamId,
      repositoryId: newRepository.id,
      performedBy: adminName,
      details: { newRepository },
      reason: reason.trim(),
      timestamp: now,
    };

    if (isFirebaseConfigured()) {
      await setDoc(doc(db, 'auditLogs', auditId), auditLog);
      await updateDoc(doc(db, COLLECTION_NAME, teamId), {
        repositoryId: newRepository.id,
        repositoryName: newRepository.name,
        repositoryFullName: newRepository.fullName || newRepository.name,
        updatedAt: now,
      });
    } else {
      const t = inMemoryTeams.find((item) => item.id === teamId);
      if (t) {
        t.repositoryId = newRepository.id;
        t.repositoryName = newRepository.name;
        t.repositoryFullName = newRepository.fullName || newRepository.name;
        t.updatedAt = now;
        notifyListeners();
      }
    }
  },

  /**
   * Comprehensive integrity diagnostics across teams, repositories, and issue assignments:
   * Detects duplicate students, duplicate repos, duplicate issues, and team size anomalies.
   */
  detectConfigurationErrors(
    teams: FirestoreTeam[],
    _repositories: any[] = [],
    issues: FirestoreIssue[] = []
  ): {
    invalidMemberCounts: Array<{ teamId: string; teamName: string; count: number }>;
    duplicateRepositories: Array<{ repository: string; teamNames: string[] }>;
    duplicateStudents: Array<{ username: string; teamNames: string[] }>;
    duplicateIssues: Array<{ issueNumber: number; repositoryId: string; assignedTo: string[] }>;
    teamsWithoutRepo: Array<{ teamId: string; teamName: string }>;
    studentsWithoutIssues: Array<{ username: string; teamName: string }>;
  } {
    const invalidMemberCounts: Array<{ teamId: string; teamName: string; count: number }> = [];
    const duplicateRepositories: Array<{ repository: string; teamNames: string[] }> = [];
    const duplicateStudents: Array<{ username: string; teamNames: string[] }> = [];
    const teamsWithoutRepo: Array<{ teamId: string; teamName: string }> = [];
    const studentsWithoutIssues: Array<{ username: string; teamName: string }> = [];

    // Track repository usage
    const repoUsage = new Map<string, string[]>();
    // Track student usage
    const studentUsage = new Map<string, string[]>();

    for (const t of teams) {
      if (t.active !== false) {
        // 1. Member count check (respects configuredTeamSize: 4 or 5)
        const targetSize = t.configuredTeamSize || 4;
        const count = t.members ? t.members.length : 0;
        if (count !== targetSize) {
          invalidMemberCounts.push({ teamId: t.id, teamName: t.name, count });
        }

        // 2. Repo check
        if (!t.repositoryId || !t.repositoryId.trim()) {
          teamsWithoutRepo.push({ teamId: t.id, teamName: t.name });
        } else {
          const rKey = (t.repositoryName || t.repositoryId).toLowerCase();
          const list = repoUsage.get(rKey) || [];
          list.push(t.name);
          repoUsage.set(rKey, list);
        }

        // 3. Student uniqueness & issue check
        if (t.members) {
          for (const m of t.members) {
            const uKey = m.githubUsername.toLowerCase().trim();
            const list = studentUsage.get(uKey) || [];
            list.push(t.name);
            studentUsage.set(uKey, list);

            if (!m.assignedIssues || m.assignedIssues.length === 0) {
              studentsWithoutIssues.push({ username: m.githubUsername, teamName: t.name });
            }
          }
        }
      }
    }

    repoUsage.forEach((teamNames, repository) => {
      if (teamNames.length > 1) {
        duplicateRepositories.push({ repository, teamNames });
      }
    });

    studentUsage.forEach((teamNames, username) => {
      if (teamNames.length > 1) {
        duplicateStudents.push({ username, teamNames });
      }
    });

    // 4. Duplicate issue assignments
    const issueMap = new Map<string, string[]>();
    for (const issue of issues) {
      if (issue.active && (issue.assignedStudentUsername || issue.assignedStudentId)) {
        const key = `${issue.repositoryId}#${issue.issueNumber}`;
        const list = issueMap.get(key) || [];
        const student = issue.assignedStudentUsername || issue.assignedStudentId || 'unknown';
        if (!list.includes(student)) list.push(student);
        issueMap.set(key, list);
      }
    }

    const duplicateIssues: Array<{ issueNumber: number; repositoryId: string; assignedTo: string[] }> = [];
    issueMap.forEach((assignedTo, key) => {
      if (assignedTo.length > 1) {
        const [repositoryId, numStr] = key.split('#');
        duplicateIssues.push({
          repositoryId,
          issueNumber: parseInt(numStr, 10),
          assignedTo,
        });
      }
    });

    return {
      invalidMemberCounts,
      duplicateRepositories,
      duplicateStudents,
      duplicateIssues,
      teamsWithoutRepo,
      studentsWithoutIssues,
    };
  },

  /**
   * Exports team assignments to JSON or CSV format.
   */
  exportTeamAssignments(
    teams: FirestoreTeam[],
    issues: FirestoreIssue[] = [],
    format: 'json' | 'csv' = 'json'
  ): string {
    if (format === 'json') {
      const data = teams.map((t) => ({
        teamId: t.id,
        teamName: t.name,
        repositoryName: t.repositoryName,
        repositoryFullName: t.repositoryFullName,
        active: t.active,
        totalScore: t.totalScore,
        assignedIssueCount: t.assignedIssueCount || t.members.reduce((acc, m) => acc + (m.assignedIssues?.length || 0), 0),
        solvedIssueCount: t.validatedIssueCount || t.solvedIssues?.length || 0,
        veryHardSolvedCount: t.veryHardSolvedCount || 0,
        members: t.members.map((m) => {
          const studentIssues = issues.filter(
            (i) =>
              (i.assignedStudentUsername?.toLowerCase() === m.githubUsername.toLowerCase() ||
                m.assignedIssues?.includes(i.issueNumber)) &&
              i.repositoryId === t.repositoryId
          );
          return {
            name: m.name,
            githubUsername: m.githubUsername,
            assignedIssues: m.assignedIssues || [],
            issueDetails: studentIssues.map((i) => ({
              number: i.issueNumber,
              title: i.title,
              difficulty: i.difficulty,
              points: i.basePoints,
            })),
            prSubmitted: !!m.prSubmitted,
            score: m.score || 0,
          };
        }),
      }));
      return JSON.stringify(data, null, 2);
    }

    // CSV format
    const rows = [
      ['Team ID', 'Team Name', 'Repository', 'Student Name', 'GitHub Username', 'Assigned Issues', 'PR Submitted', 'Score'].join(','),
    ];

    for (const t of teams) {
      for (const m of t.members) {
        rows.push([
          `"${t.id}"`,
          `"${t.name}"`,
          `"${t.repositoryName}"`,
          `"${m.name}"`,
          `"${m.githubUsername}"`,
          `"${(m.assignedIssues || []).join(';')}"`,
          `"${m.prSubmitted ? 'YES' : 'NO'}"`,
          `"${m.score || 0}"`,
        ].join(','));
      }
    }

    return rows.join('\n');
  },

  /**
   * Seeds initial squads into Firestore if empty.
   */
  async seedInitialTeams(): Promise<void> {
    if (!isFirebaseConfigured()) return;

    for (const t of initialMockTeams) {
      await setDoc(doc(db, COLLECTION_NAME, t.id), t, { merge: true });
    }
  },

  /**
   * Registers a new team with GitHub repository and problem statement details.
   */
  async registerTeam(teamData: {
    name: string;
    repositoryName?: string;
    repositoryId?: string;
    githubUrl?: string;
    problemTitle?: string;
    members?: Array<{ studentId: string; name: string; githubUsername: string; assignedIssues?: number[]; prSubmitted?: boolean }>;
    configuredTeamSize?: 4 | 5;
  }): Promise<Team> {
    const repositoryId = teamData.repositoryId || teamData.repositoryName || `repo_${teamData.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const id = `team_${repositoryId.replace(/^repo_/, '').toLowerCase()}`;
    const now = new Date().toISOString();

    const firestoreTeam: FirestoreTeam = {
      id,
      name: teamData.name,
      repositoryId,
      repositoryName: teamData.repositoryName || repositoryId,
      repositoryFullName: teamData.repositoryName || repositoryId,
      githubUrl: teamData.githubUrl,
      problemTitle: teamData.problemTitle,
      configuredTeamSize: teamData.configuredTeamSize || 4,
      members: (teamData.members || []).map((m) => ({
        ...m,
        assignedIssues: m.assignedIssues || [],
        prSubmitted: m.prSubmitted ?? false,
      })),
      totalScore: 0,
      earnedXP: 0,
      bonusXP: 0,
      totalXP: 0,
      rankingStatus: 'AWAITING_PUSH',
      buildSubmissionStatus: 'AWAITING_PUSH',
      evaluationStatus: 'NOT_STARTED',
      solvedIssues: [],
      validatedIssueCount: 0,
      assignedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.saveTeam(firestoreTeam);
    const saved = await this.getTeamById(id);
    return saved || mapFirestoreToTeam(firestoreTeam);
  },
};

export const registerTeam = teamService.registerTeam.bind(teamService);
export const updateTeamDetails = teamService.updateTeamDetails.bind(teamService);

