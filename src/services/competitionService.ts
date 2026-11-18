// ─────────────────────────────────────────────
// competitionService.ts — Competition Configuration & Lifecycle Management
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import type {
  Competition,
  CompetitionStatus,
  CompetitionMemberAssignment,
  CompetitionRole,
  CompetitionPolicies,
  RubricCriterion,
} from '../types/authAndCompetition';
import { competitionLifecycleService } from './competitionLifecycleService';
import { purgeLegacySampleStorageOnce } from '../utils/cleanSampleStorage';

const COMPETITIONS_STORAGE_KEY = 'proofly_competitions_v1';
const COMP_ROLES_STORAGE_KEY = 'proofly_competition_roles_v1';

const DEFAULT_POLICIES: CompetitionPolicies = {
  teamSubmissionsEnabled: true,
  minTeamMembers: 1,
  maxTeamMembers: 4,
  individualSubmissionsAllowed: true,
  submissionDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  allowLateSubmissions: false,
  allowSubmissionEdits: true,
  aiEvaluationEnabled: true,
  judgeFeedbackVisibleToParticipants: true,
  aiScoresVisibleToParticipants: true,
};

const DEFAULT_RUBRIC: RubricCriterion[] = [
  {
    id: 'crit-tech',
    name: 'Technological Implementation',
    description: 'Architecture robustness, code quality, edge/hybrid integration, and completeness.',
    maxScore: 25,
    weight: 25,
  },
  {
    id: 'crit-design',
    name: 'Design & User Experience',
    description: 'Interface clarity, accessibility, responsive ergonomics, and visual hierarchy.',
    maxScore: 25,
    weight: 25,
  },
  {
    id: 'crit-impact',
    name: 'Potential Impact',
    description: 'Relevance to real-world friction, scalability, and domain value.',
    maxScore: 25,
    weight: 25,
  },
  {
    id: 'crit-idea',
    name: 'Quality of the Idea',
    description: 'Novelty, creative problem-framing, and distinction from existing market offerings.',
    maxScore: 25,
    weight: 25,
  },
];

let localCompetitions: Competition[] = [];
let localCompetitionRoles: CompetitionMemberAssignment[] = [];

function loadCompetitionsFromStorage(): void {
  purgeLegacySampleStorageOnce();
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const rawComps = window.localStorage.getItem(COMPETITIONS_STORAGE_KEY);
    if (rawComps) {
      const parsed = JSON.parse(rawComps);
      if (Array.isArray(parsed)) {
        localCompetitions = parsed;
      }
    }
    const rawRoles = window.localStorage.getItem(COMP_ROLES_STORAGE_KEY);
    if (rawRoles) {
      const parsed = JSON.parse(rawRoles);
      if (Array.isArray(parsed)) {
        localCompetitionRoles = parsed;
      }
    }
  } catch {
    // Ignore storage errors
  }
}

function saveCompetitionsToStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(COMPETITIONS_STORAGE_KEY, JSON.stringify(localCompetitions));
    window.localStorage.setItem(COMP_ROLES_STORAGE_KEY, JSON.stringify(localCompetitionRoles));
  } catch {
    // Ignore storage errors
  }
}

loadCompetitionsFromStorage();

export const competitionService = {
  /**
   * Creates a new competition in DRAFT status tied to an organization.
   */
  async createCompetition(
    orgId: string,
    creatorId: string,
    creatorEmail: string,
    creatorName: string,
    input: Partial<Competition>
  ): Promise<Competition> {
    const compId = `comp-${Math.random().toString(36).substring(2, 9)}`;
    const title = input.title?.trim() || 'Untitled Competition';
    const slug =
      input.slug ||
      title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const now = new Date().toISOString();
    const accessCode = `PF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const newComp: Competition = {
      id: compId,
      organizationId: orgId,
      title,
      slug: slug || compId,
      tagline: input.tagline || '',
      description: input.description || '',
      type: input.type || 'HACKATHON',
      status: input.status || 'ACTIVE',
      visibility: input.visibility || 'PUBLIC',
      participationType: input.participationType || 'BOTH',
      startDate: input.startDate || now,
      endDate: input.endDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      evaluationDeadline:
        input.evaluationDeadline || new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      publicAccessCode: accessCode,
      policies: { ...DEFAULT_POLICIES, ...(input.policies || {}) },
      rounds: input.rounds || [
        {
          id: 'round-1',
          name: 'AI Preliminary Screening',
          order: 1,
          type: 'AI_PRE_SCREENING',
          startDate: now,
          endDate: input.endDate || now,
          status: 'PENDING',
        },
        {
          id: 'round-2',
          name: 'Human Judge Evaluation',
          order: 2,
          type: 'JUDGE_EVALUATION',
          startDate: input.endDate || now,
          endDate: input.evaluationDeadline || now,
          status: 'PENDING',
        },
      ],
      rubric: input.rubric || DEFAULT_RUBRIC,
      tracks: input.tracks || ['Healthcare & Edge AI', 'Event Tech & Community Discovery', 'Climate & Infrastructure'],
      isOpenTrackEnabled: input.isOpenTrackEnabled ?? true,
      openTrackDescription:
        input.openTrackDescription ||
        'Open Track: General innovation, cross-domain applications, and open-ended technical ideas with zero domain-relevance penalties.',
      createdAt: now,
      updatedAt: now,
    };

    const creatorAssignment: CompetitionMemberAssignment = {
      competitionId: compId,
      userId: creatorId,
      email: creatorEmail,
      displayName: creatorName,
      role: 'COMPETITION_ADMIN',
      assignedAt: now,
    };

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'competitions', compId), sanitizeFirestoreData(newComp));
        await setDoc(doc(db, 'competitions', compId, 'roles', creatorId), sanitizeFirestoreData(creatorAssignment));
      } catch {
        // Fallback to local store when Firestore rules reject unauthenticated writes
      }
    }

    localCompetitions.push(newComp);
    localCompetitionRoles.push(creatorAssignment);
    saveCompetitionsToStorage();

    return newComp;
  },

  /**
   * Retrieves a competition by ID.
   */
  async getCompetition(compId: string): Promise<Competition | null> {
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDoc(doc(db, 'competitions', compId));
        if (snap.exists()) {
          return snap.data() as Competition;
        }
      } catch {
        // Fallback to local store
      }
    }
    return localCompetitions.find((c) => c.id === compId) || null;
  },

  /**
   * Retrieves a competition by public access code (used for participant zero-account submissions).
   */
  async getCompetitionByAccessCode(code: string): Promise<Competition | null> {
    const upperCode = (code || '').trim().toUpperCase();
    if (!upperCode) return null;

    if (isFirebaseConfigured() && db) {
      try {
        const q = query(collection(db, 'competitions'), where('publicAccessCode', '==', upperCode));
        const snap = await getDocs(q);
        if (!snap.empty) {
          return snap.docs[0].data() as Competition;
        }
      } catch {
        // Fallback to local store
      }
    }
    return (
      localCompetitions.find((c) => (c.publicAccessCode || '').trim().toUpperCase() === upperCode) ||
      null
    );
  },

  /**
   * Lists all competitions across all organizations or the current environment.
   */
  async listAllCompetitions(): Promise<Competition[]> {
    const list: Competition[] = [...localCompetitions];
    if (isFirebaseConfigured() && db) {
      try {
        const q = collection(db, 'competitions');
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          const comp = docSnap.data() as Competition;
          const idx = list.findIndex((c) => c.id === comp.id);
          if (idx >= 0) {
            list[idx] = comp;
          } else {
            list.push(comp);
          }
        });
      } catch {
        // Fallback to local store
      }
    }
    return list;
  },

  /**
   * Lists competitions belonging to a specific organization.
   */
  async listOrganizationCompetitions(orgId: string): Promise<Competition[]> {
    const list: Competition[] = localCompetitions.filter((c) => c.organizationId === orgId);
    if (isFirebaseConfigured() && db) {
      try {
        const q = query(collection(db, 'competitions'), where('organizationId', '==', orgId));
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          const comp = docSnap.data() as Competition;
          const idx = list.findIndex((c) => c.id === comp.id);
          if (idx >= 0) {
            list[idx] = comp;
          } else {
            list.push(comp);
          }
        });
      } catch {
        // Fallback to local store
      }
    }
    return list;
  },

  /**
   * Updates an existing competition with state transition validation.
   */
  async updateCompetition(compId: string, updates: Partial<Competition>): Promise<Competition> {
    const existing = await this.getCompetition(compId);
    if (!existing) {
      throw new Error(`Competition with id "${compId}" does not exist.`);
    }

    // Lifecycle state transition validation
    if (updates.status && updates.status !== existing.status) {
      const transitionCheck = competitionLifecycleService.isValidTransition(existing.status, updates.status);
      if (!transitionCheck.valid) {
        throw new Error(transitionCheck.reason);
      }

      // If activating, run full activation schema checks
      if (updates.status === 'ACTIVE') {
        const fullToActivate = { ...existing, ...updates } as Competition;
        const activationCheck = competitionLifecycleService.validateForActivation(fullToActivate);
        if (!activationCheck.valid) {
          throw new Error(`Cannot activate competition:\n- ${activationCheck.errors.join('\n- ')}`);
        }
      }
    }

    const updated: Competition = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      try {
        await updateDoc(doc(db, 'competitions', compId), sanitizeFirestoreData(updated) as any);
      } catch {
        // Fallback to local store
      }
    }

    const idx = localCompetitions.findIndex((c) => c.id === compId);
    if (idx !== -1) {
      localCompetitions[idx] = updated;
    } else {
      localCompetitions.push(updated);
    }
    saveCompetitionsToStorage();

    return updated;
  },

  /**
   * Transitions a competition to the target status with lifecycle validation.
   */
  async transitionStatus(compId: string, targetStatus: CompetitionStatus): Promise<Competition> {
    return this.updateCompetition(compId, { status: targetStatus });
  },

  /**
   * Transitions a competition to ARCHIVED status.
   */
  async archiveCompetition(compId: string): Promise<Competition> {
    const existing = await this.getCompetition(compId);
    if (!existing) {
      throw new Error(`Competition with id "${compId}" not found.`);
    }

    return this.updateCompetition(compId, {
      status: 'ARCHIVED',
      archivedAt: new Date().toISOString(),
    });
  },

  /**
   * Assigns a role to a user within a competition (e.g. JUDGE or ORGANIZER).
   */
  async assignCompetitionRole(
    compId: string,
    userId: string,
    email: string,
    displayName: string,
    role: CompetitionRole,
    assignedTracks?: string[]
  ): Promise<CompetitionMemberAssignment> {
    const assignment: CompetitionMemberAssignment = {
      competitionId: compId,
      userId,
      email,
      displayName,
      role,
      assignedTracks: assignedTracks || [],
      assignedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'competitions', compId, 'roles', userId), assignment);
      } catch {
        // Fallback to local store
      }
    }

    localCompetitionRoles = localCompetitionRoles.filter(
      (r) => !(r.competitionId === compId && r.userId === userId)
    );
    localCompetitionRoles.push(assignment);
    saveCompetitionsToStorage();
    return assignment;
  },

  /**
   * Retrieves all assigned members and judges for a competition.
   */
  async listCompetitionRoles(compId: string): Promise<CompetitionMemberAssignment[]> {
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDocs(collection(db, 'competitions', compId, 'roles'));
        if (!snap.empty) {
          return snap.docs.map((d) => d.data() as CompetitionMemberAssignment);
        }
      } catch {
        // Fallback to local store
      }
    }
    return localCompetitionRoles.filter((r) => r.competitionId === compId);
  },

  /**
   * Reset in-memory competitions store (for test isolation).
   */
  resetInMemoryStore(comps: Competition[] = [], roles: CompetitionMemberAssignment[] = []): void {
    localCompetitions = [...comps];
    localCompetitionRoles = [...roles];
  },
};
