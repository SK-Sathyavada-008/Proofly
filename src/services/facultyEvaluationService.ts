// ─────────────────────────────────────────────
// Faculty Academic Evaluation Service
// Authoritative academic scoring independent of AI & Git evaluation
// Rubric-based scoring, reviewer tracking, and audited revisions
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import type {
  FacultyEvaluation,
  FacultyEvaluationCriterion,
} from '../types';
import { auditLogService } from './auditLogService';
import { teamService } from './teamService';
import { eventConfigService } from './eventConfigService';

const COLLECTION_NAME = 'facultyScores';

export const DEFAULT_FACULTY_RUBRIC: Array<Omit<FacultyEvaluationCriterion, 'awardedScore' | 'comments'>> = [
  {
    id: 'problem_solving',
    name: 'Problem Solving & Logic',
    description: 'Effectiveness and algorithmic soundness in addressing the faculty problem statement.',
    maxScore: 25,
  },
  {
    id: 'architecture_design',
    name: 'Architecture & Modularity',
    description: 'Clean software architecture, separation of concerns, and system maintainability.',
    maxScore: 25,
  },
  {
    id: 'completeness_scope',
    name: 'Completeness & Core Features',
    description: 'Fulfillment of mandatory project requirements and working features.',
    maxScore: 25,
  },
  {
    id: 'presentation_demo',
    name: 'Technical Presentation & Demo',
    description: 'Live demonstration, code walkthrough, and team defense of design decisions.',
    maxScore: 25,
  },
];

const inMemoryFacultyEvaluations = new Map<string, FacultyEvaluation>();
const facultyListeners = new Set<(evaluations: FacultyEvaluation[]) => void>();

function notifyFacultyListeners() {
  const all = Array.from(inMemoryFacultyEvaluations.values());
  facultyListeners.forEach((fn) => {
    try {
      fn(all);
    } catch (err) {
      console.warn('[FacultyEvaluationService] Listener error:', err);
    }
  });
}

export const facultyEvaluationService = {
  /**
   * Generates a blank faculty rubric template for a team.
   */
  createBlankEvaluation(teamId: string, problemTitle: string = 'Assigned Faculty Project'): FacultyEvaluation {
    return {
      id: `faculty_${teamId}`,
      teamId,
      facultyProblemTitle: problemTitle,
      reviewerId: '',
      reviewerName: '',
      criteria: DEFAULT_FACULTY_RUBRIC.map((r) => ({
        ...r,
        awardedScore: 0,
        comments: '',
      })),
      totalScore: 0,
      maxScore: 100,
      normalizedScore: 0,
      notes: '',
      status: 'PENDING',
      evaluatedAt: new Date().toISOString(),
      auditHistory: [],
    };
  },

  /**
   * Submits or updates faculty score for a team.
   * Preserves reviewer details and appends to audit history.
   * Faculty evaluation remains strictly isolated and authoritative.
   */
  async submitFacultyEvaluation(
    teamId: string,
    evaluationData: {
      facultyProblemTitle?: string;
      reviewerName: string;
      reviewerId?: string;
      criteria: FacultyEvaluationCriterion[];
      notes?: string;
      status?: 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'FINALIZED';
      reason?: string;
    },
    adminOrFacultyUsername: string = 'faculty_reviewer'
  ): Promise<FacultyEvaluation> {
    eventConfigService.verifyAdminAccess(adminOrFacultyUsername);

    if (!evaluationData.reviewerName || !evaluationData.reviewerName.trim()) {
      throw new Error('Reviewer name or Faculty Identifier is required to record academic scores.');
    }

    if (!Array.isArray(evaluationData.criteria) || evaluationData.criteria.length === 0) {
      throw new Error('At least one evaluation rubric criterion is required.');
    }

    let totalScore = 0;
    let maxScore = 0;

    for (const c of evaluationData.criteria) {
      if (c.awardedScore < 0 || c.awardedScore > c.maxScore) {
        throw new Error(
          `Criterion "${c.name}" awarded score (${c.awardedScore}) must be between 0 and maximum (${c.maxScore}).`
        );
      }
      totalScore += c.awardedScore;
      maxScore += c.maxScore;
    }

    const normalizedScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    const now = new Date().toISOString();
    const evalId = `faculty_${teamId}`;

    const existing = await this.getFacultyEvaluation(teamId);
    const previousScore = existing ? existing.normalizedScore : undefined;

    const auditHistory = existing?.auditHistory ? [...existing.auditHistory] : [];
    if (previousScore !== undefined && previousScore !== normalizedScore) {
      auditHistory.push({
        editedBy: adminOrFacultyUsername,
        timestamp: now,
        previousScore,
        newScore: normalizedScore,
        reason: evaluationData.reason || 'Faculty score revision',
      });
    }

    const evaluation: FacultyEvaluation = {
      id: evalId,
      teamId,
      facultyProblemTitle: evaluationData.facultyProblemTitle || existing?.facultyProblemTitle || 'Assigned Faculty Project',
      reviewerId: evaluationData.reviewerId || adminOrFacultyUsername,
      reviewerName: evaluationData.reviewerName.trim(),
      criteria: evaluationData.criteria,
      totalScore,
      maxScore,
      normalizedScore,
      notes: evaluationData.notes || '',
      status: evaluationData.status || 'SUBMITTED',
      evaluatedAt: now,
      auditHistory,
    };

    inMemoryFacultyEvaluations.set(teamId, evaluation);
    notifyFacultyListeners();

    if (isFirebaseConfigured()) {
      try {
        const docRef = doc(db, COLLECTION_NAME, evalId);
        await setDoc(docRef, evaluation, { merge: true });
      } catch (err) {
        console.warn('[FacultyEvaluationService] Firestore write error:', err);
      }
    }

    // Record audit log
    await auditLogService.recordAuditLog({
      id: `audit_faculty_${teamId}_${Date.now()}`,
      action: 'FACULTY_SCORE_UPDATED',
      adminUsername: adminOrFacultyUsername,
      targetId: teamId,
      targetName: `Faculty Academic Evaluation`,
      reason: evaluationData.reason || `Faculty score recorded: ${normalizedScore}/100 by ${evaluationData.reviewerName}`,
      previousValue: previousScore,
      newValue: normalizedScore,
      details: {
        totalScore,
        maxScore,
        normalizedScore,
        reviewer: evaluationData.reviewerName,
        criteria: evaluationData.criteria,
      },
      timestamp: now,
    });

    // Update team document with faculty score without modifying Git process score or bonus XP
    await teamService.updateTeamDetails(
      teamId,
      {
        facultyScore: normalizedScore,
        facultyMaxScore: 100,
        facultyEvaluation: evaluation,
        problemTitle: evaluation.facultyProblemTitle,
      },
      adminOrFacultyUsername,
      `Updated faculty academic score: ${normalizedScore}/100`
    );

    return evaluation;
  },

  /**
   * Retrieves faculty evaluation for a team.
   */
  async getFacultyEvaluation(teamId: string): Promise<FacultyEvaluation | null> {
    const mem = inMemoryFacultyEvaluations.get(teamId);
    if (mem) return mem;

    if (!isFirebaseConfigured()) return null;

    try {
      const docRef = doc(db, COLLECTION_NAME, `faculty_${teamId}`);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return null;
      const data = snap.data() as FacultyEvaluation;
      inMemoryFacultyEvaluations.set(teamId, data);
      return data;
    } catch (err) {
      console.warn('[FacultyEvaluationService] Error fetching evaluation:', err);
      return null;
    }
  },

  /**
   * Subscribes to faculty evaluation updates.
   */
  subscribeToFacultyEvaluations(
    onUpdate: (evaluations: FacultyEvaluation[]) => void
  ): Unsubscribe {
    facultyListeners.add(onUpdate);
    onUpdate(Array.from(inMemoryFacultyEvaluations.values()));

    if (!isFirebaseConfigured()) {
      return () => {
        facultyListeners.delete(onUpdate);
      };
    }

    try {
      const q = collection(db, COLLECTION_NAME);
      const unsub = onSnapshot(q, (snap) => {
        const evaluations = snap.docs.map((d) => d.data() as FacultyEvaluation);
        evaluations.forEach((e) => inMemoryFacultyEvaluations.set(e.teamId, e));
        onUpdate(Array.from(inMemoryFacultyEvaluations.values()));
      });
      return () => {
        facultyListeners.delete(onUpdate);
        unsub();
      };
    } catch {
      return () => {
        facultyListeners.delete(onUpdate);
      };
    }
  },
};
