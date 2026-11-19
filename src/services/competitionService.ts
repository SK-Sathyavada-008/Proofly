// ─────────────────────────────────────────────
// competitionService.ts — Durable Firestore Competition Configuration & Lifecycle
// Proofly Phase 04 — Atomic Batches, Bounded Pagination, Zero Silent Fallbacks
// ─────────────────────────────────────────────

import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginatedResult,
  type PaginationOptions,
} from './firestorePersistenceService';
import type {
  Competition,
  CompetitionStatus,
  CompetitionMemberAssignment,
  CompetitionRole,
  CompetitionPolicies,
  RubricCriterion,
} from '../types/authAndCompetition';
import { competitionLifecycleService } from './competitionLifecycleService';

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

// Unit-test-only arrays (unused whenever Firestore is active)
let localCompetitions: Competition[] = [];
let localCompetitionRoles: CompetitionMemberAssignment[] = [];

export const competitionService = {
  /**
   * Atomically creates a competition + creator COMPETITION_ADMIN role in Firestore.
   * Throws PersistenceError if Firestore write fails (never falls back silently).
   */
  async createCompetition(
    orgId: string,
    creatorId: string,
    creatorEmail: string,
    creatorName: string,
    input: Partial<Competition>,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<Competition> {
    const compId = input.id || `comp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const title = input.title?.trim() || 'Untitled Competition';
    const slug =
      input.slug ||
      title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const now = new Date().toISOString();
    const accessCode =
      input.publicAccessCode || `PF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const newComp: Competition = {
      id: compId,
      organizationId: orgId,
      title,
      slug: slug || compId,
      tagline: input.tagline || '',
      description: input.description || '',
      type: input.type || 'HACKATHON',
      status: input.status || 'DRAFT', // Phase 08: All new competitions default to DRAFT
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
      lifecycleHistory: [
        {
          from: 'DRAFT',
          to: 'DRAFT',
          changedAt: now,
          changedBy: creatorId || options?.userId || 'system',
          reason: 'Initial competition creation in DRAFT state',
        },
      ],
      submissionCount: 0,
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

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const compRef = doc(fs, 'competitions', compId);
        const roleRef = doc(fs, 'competitions', compId, 'roles', creatorId);
        // Write competition first (firestore.rules checks competitionExists on roles create)
        await setDoc(
          compRef,
          withServerTimestamps(sanitizeFirestoreData(newComp), true)
        );
        const batch = writeBatch(fs);
        batch.set(
          roleRef,
          withServerTimestamps(
            sanitizeFirestoreData(creatorAssignment),
            true
          )
        );
        await batch.commit();
        return newComp;
      } catch (err) {
        throw mapFirestoreError(err, 'createCompetition', 'competitions');
      }
    }

    localCompetitions.push(newComp);
    localCompetitionRoles.push(creatorAssignment);
    return newComp;
  },

  async getCompetition(
    compId: string,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<Competition | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'competitions', compId));
        return snap.exists() ? (snap.data() as Competition) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getCompetition', 'competitions');
      }
    }
    return localCompetitions.find((c) => c.id === compId) || null;
  },

  getCompetitionSync(compId: string): Competition | null {
    return localCompetitions.find((c) => c.id === compId) || null;
  },

  async getCompetitionByAccessCode(
    code: string,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<Competition | null> {
    const upperCode = (code || '').trim().toUpperCase();
    if (!upperCode) return null;

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(
          collection(fs, 'competitions'),
          where('publicAccessCode', '==', upperCode),
          limit(1)
        );
        const snap = await getDocs(q);
        return snap.empty ? null : (snap.docs[0].data() as Competition);
      } catch (err) {
        throw mapFirestoreError(err, 'getCompetitionByAccessCode', 'competitions');
      }
    }

    return (
      localCompetitions.find((c) => (c.publicAccessCode || '').trim().toUpperCase() === upperCode) ||
      null
    );
  },

  async listAllCompetitionsPaginated(
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Competition>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);
    if (fs) {
      try {
        const constraints: QueryConstraint[] = [limit(pageSize + 1)];
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }
        const snap = await getDocs(query(collection(fs, 'competitions'), ...constraints));
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        return {
          items: pageDocs.map((d) => d.data() as Competition),
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listAllCompetitionsPaginated', 'competitions');
      }
    }

    return {
      items: localCompetitions.slice(0, pageSize),
      hasMore: localCompetitions.length > pageSize,
      nextCursor: null,
      pageSize,
    };
  },

  async listAllCompetitions(options?: PaginationOptions): Promise<Competition[]> {
    const page = await this.listAllCompetitionsPaginated(options);
    return page.items;
  },

  async listOrganizationCompetitionsPaginated(
    orgId: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Competition>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);
    if (fs) {
      try {
        const constraints: QueryConstraint[] = [
          where('organizationId', '==', orgId),
          limit(pageSize + 1),
        ];
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }
        const snap = await getDocs(query(collection(fs, 'competitions'), ...constraints));
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        return {
          items: pageDocs.map((d) => d.data() as Competition),
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listOrganizationCompetitionsPaginated', 'competitions');
      }
    }

    const filtered = localCompetitions.filter((c) => c.organizationId === orgId);
    return {
      items: filtered.slice(0, pageSize),
      hasMore: filtered.length > pageSize,
      nextCursor: null,
      pageSize,
    };
  },

  async listOrganizationCompetitions(
    orgId: string,
    options?: PaginationOptions
  ): Promise<Competition[]> {
    const page = await this.listOrganizationCompetitionsPaginated(orgId, options);
    return page.items;
  },

  async updateCompetition(
    compId: string,
    updates: Partial<Competition>,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<Competition> {
    const existing = await this.getCompetition(compId, options);
    if (!existing) {
      throw new Error(`Competition with id "${compId}" does not exist.`);
    }

    let updatedLifecycleHistory = existing.lifecycleHistory ? [...existing.lifecycleHistory] : [];

    if (updates.status && updates.status !== existing.status) {
      if (options?.callerRole && !['COMPETITION_ADMIN', 'ORGANIZER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(options.callerRole)) {
        throw new Error(`Unauthorized: Role "${options.callerRole}" is not permitted to modify competition status.`);
      }

      const transitionCheck = competitionLifecycleService.isValidTransition(
        existing.status,
        updates.status
      );
      if (!transitionCheck.valid) {
        throw new Error(transitionCheck.reason);
      }

      if (updates.status === 'ACTIVE' || updates.status === 'REGISTRATION_OPEN') {
        const fullToActivate = { ...existing, ...updates } as Competition;
        const activationCheck = competitionLifecycleService.validateForActivation(fullToActivate);
        if (!activationCheck.valid) {
          throw new Error(`Cannot activate competition:\n- ${activationCheck.errors.join('\n- ')}`);
        }
      }

      const nowIso = new Date().toISOString();
      updatedLifecycleHistory.push({
        from: existing.status,
        to: updates.status,
        changedAt: nowIso,
        changedBy: options?.userId || 'system',
        reason: (options as any)?.reason || `Lifecycle transition to ${updates.status}`,
      });
    }

    const updated: Competition = {
      ...existing,
      ...updates,
      lifecycleHistory: updatedLifecycleHistory,
      updatedAt: new Date().toISOString(),
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await updateDoc(
          doc(fs, 'competitions', compId),
          withServerTimestamps(sanitizeFirestoreData(updated), false)
        );
        return updated;
      } catch (err) {
        throw mapFirestoreError(err, 'updateCompetition', 'competitions');
      }
    }

    const idx = localCompetitions.findIndex((c) => c.id === compId);
    if (idx !== -1) {
      localCompetitions[idx] = updated;
    } else {
      localCompetitions.push(updated);
    }
    return updated;
  },

  async transitionStatus(
    compId: string,
    targetStatus: CompetitionStatus,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<Competition> {
    return this.updateCompetition(compId, { status: targetStatus }, options);
  },

  async archiveCompetition(
    compId: string,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<Competition> {
    const existing = await this.getCompetition(compId, options);
    if (!existing) {
      throw new Error(`Competition with id "${compId}" not found.`);
    }

    return this.updateCompetition(
      compId,
      {
        status: 'ARCHIVED',
        archivedAt: new Date().toISOString(),
      },
      options
    );
  },

  async assignCompetitionRole(
    compId: string,
    userId: string,
    email: string,
    displayName: string,
    role: CompetitionRole,
    assignedTracks?: string[],
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
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

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(
          doc(fs, 'competitions', compId, 'roles', userId),
          withServerTimestamps(sanitizeFirestoreData(assignment), true)
        );
        return assignment;
      } catch (err) {
        throw mapFirestoreError(err, 'assignCompetitionRole', 'competitions/roles');
      }
    }

    localCompetitionRoles = localCompetitionRoles.filter(
      (r) => !(r.competitionId === compId && r.userId === userId)
    );
    localCompetitionRoles.push(assignment);
    return assignment;
  },

  async listCompetitionRoles(
    compId: string,
    options?: PaginationOptions
  ): Promise<CompetitionMemberAssignment[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const snap = await getDocs(
          query(collection(fs, 'competitions', compId, 'roles'), limit(pageSize))
        );
        return snap.docs.map((d) => d.data() as CompetitionMemberAssignment);
      } catch (err) {
        throw mapFirestoreError(err, 'listCompetitionRoles', 'competitions/roles');
      }
    }
    return localCompetitionRoles.filter((r) => r.competitionId === compId);
  },

  async listUserCompetitionRoles(
    userId: string,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<CompetitionMemberAssignment[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(collectionGroup(fs, 'roles'), where('userId', '==', userId), limit(100));
        const snap = await getDocs(q);
        const byComp = new Map<string, CompetitionMemberAssignment>();
        snap.forEach((docSnap) => {
          const data = docSnap.data() as CompetitionMemberAssignment;
          const compId = data.competitionId || docSnap.ref.parent.parent?.id;
          if (compId && data.role) {
            byComp.set(compId, { ...data, competitionId: compId });
          }
        });
        return Array.from(byComp.values());
      } catch (err) {
        throw mapFirestoreError(err, 'listUserCompetitionRoles', 'competitions/roles');
      }
    }

    return localCompetitionRoles.filter((r) => r.userId === userId);
  },

  async removeCompetitionRole(
    compId: string,
    userId: string,
    options?: FirestoreExecutionOptions & { userId?: string; callerRole?: string; reason?: string }
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await deleteDoc(doc(fs, 'competitions', compId, 'roles', userId));
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'removeCompetitionRole', 'competitions/roles');
      }
    }
    localCompetitionRoles = localCompetitionRoles.filter(
      (r) => !(r.competitionId === compId && r.userId === userId)
    );
  },

  resetInMemoryStore(comps: Competition[] = [], roles: CompetitionMemberAssignment[] = []): void {
    localCompetitions = [...comps];
    localCompetitionRoles = [...roles];
  },
};
