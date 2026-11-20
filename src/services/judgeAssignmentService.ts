// ─────────────────────────────────────────────
// judgeAssignmentService.ts — Durable Firestore Judge Profiles, Assignments & Evaluations
// Proofly Phase 04 — Transactional Multi-Device Persistence, Zero localStorage Primary Store
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  PersistenceError,
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginatedResult,
  type PaginationOptions,
} from './firestorePersistenceService';
import type {
  JudgeRecord,
  JudgeAssignment,
  JudgeAssignmentSource,
  JudgeAssignmentStatus,
  ConflictDeclaration,
  ConflictType,
  ReassignmentAudit,
  HumanJudgeEvaluation,
  JudgeWorkloadSummary,
  FlaggedConcern,
  CriterionComparisonDetail,
  JudgeEvidenceAnnotation,
} from '../types/judgeAndEvaluation';
import { submissionLifecycleService } from './submissionLifecycleService';
import { submissionService } from './submissionService';
import { scoringLedgerService } from './scoringLedgerService';
import { governanceAuditService } from './governanceAuditService';
import { getTrustedBackendExecutor } from './trustedBackendPersistence';

// Test-fixture constants (ONLY populated when resetForTesting() is explicitly called in unit tests;
// NEVER loaded automatically in production or Firestore runtime).
export const INITIAL_SEED_JUDGES: JudgeRecord[] = [
  {
    id: 'user-judge-01',
    name: 'Dr. Elena Vance',
    email: 'dr.elena.vance@stanford.edu',
    title: 'Associate Professor & AI Lab Director',
    organization: 'Stanford University',
    assignedTracks: ['Healthcare & Edge AI', 'Intelligent Agents', 'General'],
    competitionIds: ['comp-default-ai', 'comp-krivee-001'],
    maxQuota: 10,
    status: 'ACTIVE',
    invitedAt: '2026-09-15T00:00:00.000Z',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  },
  {
    id: 'judge-maya',
    name: 'Dr. Maya Patel',
    email: 'maya.patel@deepmind.academic',
    title: 'Principal AI Scientist',
    organization: 'DeepMind',
    assignedTracks: ['Healthcare & Edge AI', 'Fintech & Security', 'Developer Tools'],
    competitionIds: ['comp-default-ai'],
    maxQuota: 8,
    status: 'ACTIVE',
    invitedAt: '2026-09-16T00:00:00.000Z',
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
  },
  {
    id: 'judge-marcus',
    name: 'Prof. Marcus Brody',
    email: 'm.brody@oxford.ac.uk',
    title: 'Chair of Cybernetics & HCI',
    organization: 'University of Oxford',
    assignedTracks: ['Decentralized Science', 'Clean Energy', 'General'],
    competitionIds: ['comp-default-ai'],
    maxQuota: 8,
    status: 'ACTIVE',
    invitedAt: '2026-09-17T00:00:00.000Z',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  },
  {
    id: 'judge-chen',
    name: 'Dr. Wei Chen',
    email: 'w.chen@mit.edu',
    title: 'Principal Research Scientist',
    organization: 'MIT Media Lab',
    assignedTracks: ['Intelligent Agents', 'Developer Tools', 'Open Track'],
    competitionIds: ['comp-default-ai'],
    maxQuota: 6,
    status: 'ACTIVE',
    invitedAt: '2026-09-18T00:00:00.000Z',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  },
];

export const INITIAL_SEED_ASSIGNMENTS: JudgeAssignment[] = [
  {
    id: 'asgn-sub-cardio-elena',
    competitionId: 'comp-default-ai',
    submissionId: 'sub-nano-cardiopulse',
    referenceId: 'PF-SUB-2026-NC892',
    projectTitle: 'CardioPulse: Ultra-Low Latency Arrhythmia Detection',
    track: 'Healthcare & Edge AI',
    judgeId: 'user-judge-01',
    judgeName: 'Dr. Elena Vance',
    judgeEmail: 'dr.elena.vance@stanford.edu',
    assignedBy: 'user-organizer-01',
    assignedByName: 'Saikeerthana (Lead Organizer)',
    assignedAt: '2026-11-15T10:00:00.000Z',
    assignmentSource: 'MANUAL',
    deadline: '2026-11-20T23:59:59.000Z',
    status: 'IN_PROGRESS',
    reassignmentHistory: [],
  },
  {
    id: 'asgn-sub-cardio-maya',
    competitionId: 'comp-default-ai',
    submissionId: 'sub-nano-cardiopulse',
    referenceId: 'PF-SUB-2026-NC892',
    projectTitle: 'CardioPulse: Ultra-Low Latency Arrhythmia Detection',
    track: 'Healthcare & Edge AI',
    judgeId: 'judge-maya',
    judgeName: 'Dr. Maya Patel',
    judgeEmail: 'maya.patel@deepmind.academic',
    assignedBy: 'user-organizer-01',
    assignedByName: 'Saikeerthana (Lead Organizer)',
    assignedAt: '2026-11-15T10:00:00.000Z',
    assignmentSource: 'MANUAL',
    deadline: '2026-11-20T23:59:59.000Z',
    status: 'PENDING',
    reassignmentHistory: [],
  },
  {
    id: 'asgn-sub-quantum-elena',
    competitionId: 'comp-default-ai',
    submissionId: 'sub-quantum-ai',
    referenceId: 'PF-SUB-2026-Q9401',
    projectTitle: 'QuantumPulse: Quantum-Resistant Consensus Protocol',
    track: 'Fintech & Security',
    judgeId: 'user-judge-01',
    judgeName: 'Dr. Elena Vance',
    judgeEmail: 'dr.elena.vance@stanford.edu',
    assignedBy: 'user-organizer-01',
    assignedByName: 'Saikeerthana (Lead Organizer)',
    assignedAt: '2026-11-15T10:00:00.000Z',
    assignmentSource: 'MANUAL',
    deadline: '2026-11-20T23:59:59.000Z',
    status: 'PENDING',
    reassignmentHistory: [],
  },
  {
    id: 'asgn-sub-bio-marcus',
    competitionId: 'comp-default-ai',
    submissionId: 'sub-biomarker-hub',
    referenceId: 'PF-SUB-2026-B3219',
    projectTitle: 'BioScan AI: Realtime Multi-Modal Pathology',
    track: 'Healthcare & Edge AI',
    judgeId: 'judge-marcus',
    judgeName: 'Prof. Marcus Brody',
    judgeEmail: 'm.brody@oxford.ac.uk',
    assignedBy: 'user-organizer-01',
    assignedByName: 'Saikeerthana (Lead Organizer)',
    assignedAt: '2026-11-15T10:00:00.000Z',
    assignmentSource: 'MANUAL',
    deadline: '2026-11-20T23:59:59.000Z',
    status: 'COMPLETED',
    completedAt: '2026-11-16T14:30:00.000Z',
    reassignmentHistory: [],
  },
];

class JudgeAssignmentService {
  // Unit-test-only maps (strictly unused whenever Firestore is configured or injected)
  private judges = new Map<string, JudgeRecord>();
  private assignments = new Map<string, JudgeAssignment>();
  private evaluations = new Map<string, HumanJudgeEvaluation>();

  /**
   * Canonical deterministic assignment document ID aligned with firestore.rules & storage.rules:
   * `${submissionId}_${judgeId}`
   */
  public makeAssignmentId(submissionId: string, judgeId: string): string {
    return `${submissionId}_${judgeId}`;
  }

  /**
   * Canonical deterministic evaluation document ID preventing cross-judge overwrites:
   * `${submissionId}_${judgeId}`
   */
  public makeEvalKey(submissionId: string, judgeId: string): string {
    return `${submissionId}_${judgeId}`;
  }

  // ─────────────────────────────────────────────
  // 1. JUDGE PROFILES (Firestore: /judgeProfiles/{judgeId})
  // ─────────────────────────────────────────────

  public async listJudges(
    competitionId?: string,
    options?: PaginationOptions & { organizationId?: string }
  ): Promise<JudgeRecord[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const constraints: QueryConstraint[] = [];
        if (options?.organizationId) {
          constraints.push(where('organizationId', '==', options.organizationId));
        }
        if (competitionId && competitionId !== 'ALL') {
          constraints.push(where('competitionIds', 'array-contains', competitionId));
        }
        constraints.push(limit(pageSize));
        if (options?.cursor) {
          constraints.push(startAfter(options.cursor));
        }
        const snap = await getDocs(query(collection(fs, 'judgeProfiles'), ...constraints));
        return snap.docs.map((d) => d.data() as JudgeRecord);
      } catch (err) {
        throw mapFirestoreError(err, 'listJudges', 'judgeProfiles');
      }
    }

    const all = Array.from(this.judges.values());
    if (!competitionId || competitionId === 'ALL') {
      return all;
    }
    return all.filter((j) => j.competitionIds.includes(competitionId));
  }

  public async getJudge(
    judgeId: string,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeRecord | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'judgeProfiles', judgeId));
        return snap.exists() ? (snap.data() as JudgeRecord) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getJudge', 'judgeProfiles');
      }
    }
    return this.judges.get(judgeId) || null;
  }

  public async getJudgeByEmail(
    email: string,
    options?: FirestoreExecutionOptions & { organizationId?: string }
  ): Promise<JudgeRecord | null> {
    const lower = email.toLowerCase().trim();
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const constraints: QueryConstraint[] = [where('email', '==', lower), limit(1)];
        if (options?.organizationId) {
          constraints.unshift(where('organizationId', '==', options.organizationId));
        }
        const snap = await getDocs(query(collection(fs, 'judgeProfiles'), ...constraints));
        return snap.empty ? null : (snap.docs[0].data() as JudgeRecord);
      } catch (err) {
        throw mapFirestoreError(err, 'getJudgeByEmail', 'judgeProfiles');
      }
    }

    for (const j of this.judges.values()) {
      if (j.email.toLowerCase().trim() === lower) {
        return j;
      }
    }
    return null;
  }

  public async addJudge(
    judgeData: Omit<JudgeRecord, 'id'> & { id?: string },
    options?: FirestoreExecutionOptions
  ): Promise<JudgeRecord> {
    const id = judgeData.id || `judge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const judge: JudgeRecord = {
      ...judgeData,
      id,
      userId: judgeData.userId || id,
      email: judgeData.email.toLowerCase().trim(),
      status: judgeData.status || 'ACTIVE',
      assignedTracks: judgeData.assignedTracks || ['General'],
      competitionIds: judgeData.competitionIds || [],
      maxQuota: judgeData.maxQuota || 10,
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(
          doc(fs, 'judgeProfiles', id),
          withServerTimestamps(sanitizeFirestoreData(judge), true)
        );
        return judge;
      } catch (err) {
        throw mapFirestoreError(err, 'addJudge', 'judgeProfiles');
      }
    }

    this.judges.set(id, judge);
    return judge;
  }

  public async inviteJudge(
    params: {
      id?: string;
      organizationId?: string;
      name: string;
      email: string;
      title?: string;
      organization?: string;
      assignedTracks?: string[];
      competitionIds?: string[];
      maxQuota?: number;
    },
    options?: FirestoreExecutionOptions
  ): Promise<JudgeRecord> {
    const existing = await this.getJudgeByEmail(params.email, {
      firestore: options?.firestore,
      organizationId: params.organizationId,
    });
    if (existing) {
      const updated: JudgeRecord = {
        ...existing,
        name: params.name || existing.name,
        title: params.title || existing.title,
        organization: params.organization || existing.organization,
        assignedTracks: Array.from(new Set([...existing.assignedTracks, ...(params.assignedTracks || [])])),
        competitionIds: Array.from(new Set([...existing.competitionIds, ...(params.competitionIds || [])])),
        maxQuota: params.maxQuota || existing.maxQuota,
        status: 'ACTIVE',
      };
      return this.updateJudge(existing.id, updated, options);
    }

    const newJudge: JudgeRecord = {
      id: params.id || `judge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId: params.id,
      organizationId: params.organizationId,
      name: params.name,
      email: params.email.toLowerCase().trim(),
      title: params.title || 'Domain Specialist',
      organization: params.organization || 'External Evaluation Panel',
      assignedTracks: params.assignedTracks && params.assignedTracks.length > 0 ? params.assignedTracks : ['General'],
      competitionIds: params.competitionIds && params.competitionIds.length > 0 ? params.competitionIds : [],
      maxQuota: params.maxQuota || 8,
      status: 'INVITED',
      invitedAt: new Date().toISOString(),
    };

    return this.addJudge(newJudge, options);
  }

  public async updateJudge(
    judgeId: string,
    updates: Partial<JudgeRecord>,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeRecord> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'judgeProfiles', judgeId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          throw new PersistenceError({
            code: 'NOT_FOUND',
            message: `Judge with ID "${judgeId}" not found.`,
            operation: 'updateJudge',
            collection: 'judgeProfiles',
          });
        }
        const merged = { ...(snap.data() as JudgeRecord), ...updates, id: judgeId };
        await updateDoc(
          ref,
          withServerTimestamps(sanitizeFirestoreData(updates), false)
        );
        return merged;
      } catch (err) {
        throw mapFirestoreError(err, 'updateJudge', 'judgeProfiles');
      }
    }

    const existing = this.judges.get(judgeId);
    if (!existing) {
      throw new Error(`Judge with ID "${judgeId}" not found.`);
    }
    const updated = { ...existing, ...updates };
    this.judges.set(judgeId, updated);
    return updated;
  }

  // ─────────────────────────────────────────────
  // 2. ASSIGNMENTS & REASSIGNMENT (Firestore: /judgeAssignments/{submissionId}_{judgeId})
  // ─────────────────────────────────────────────

  public async assignSubmission(
    params: {
      organizationId?: string;
      competitionId: string;
      roundId?: string;
      submissionId: string;
      referenceId?: string;
      projectTitle?: string;
      track?: string;
      judgeId: string;
      judgeName?: string;
      judgeEmail?: string;
      assignedBy: string;
      assignedByName: string;
      assignmentSource?: JudgeAssignmentSource;
      deadline?: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<JudgeAssignment> {
    const judge = await this.getJudge(params.judgeId, options);
    const resolvedJudgeName = judge?.name || params.judgeName;
    const resolvedJudgeEmail = judge?.email || params.judgeEmail;

    if (!judge && !resolvedJudgeName) {
      throw new Error(`Cannot assign: Judge with ID "${params.judgeId}" not found.`);
    }

    const fs = resolveFirestore(options?.firestore);
    const id = this.makeAssignmentId(params.submissionId, params.judgeId);
    const now = new Date().toISOString();

    if (fs) {
      const assignmentRef = doc(fs, 'judgeAssignments', id);
      try {
        const created = await runTransaction(fs, async (tx) => {
          const existingSnap = await tx.get(assignmentRef);
          if (existingSnap.exists()) {
            const existingData = existingSnap.data() as JudgeAssignment;
            if (existingData.status === 'CONFLICT') {
              throw new PersistenceError({
                code: 'CONFLICT',
                message: `Cannot assign: Judge "${resolvedJudgeName}" previously declared a conflict of interest on this submission.`,
                operation: 'assignSubmission',
                collection: 'judgeAssignments',
              });
            }
            return existingData;
          }

          let orgId = params.organizationId;
          if (!orgId) {
            const compSnap = await tx.get(doc(fs, 'competitions', params.competitionId));
            orgId = compSnap.exists() ? (compSnap.data().organizationId as string) : undefined;
          }
          if (!orgId) {
            throw new PersistenceError({
              code: 'INVALID_ARGUMENT',
              message: `Cannot assign submission: missing organizationId for competition "${params.competitionId}".`,
              operation: 'assignSubmission',
              collection: 'judgeAssignments',
            });
          }

          const assignment: JudgeAssignment = {
            id,
            organizationId: orgId,
            competitionId: params.competitionId,
            roundId: params.roundId,
            submissionId: params.submissionId,
            referenceId: params.referenceId || params.submissionId,
            projectTitle: params.projectTitle || 'Project Submission',
            track: params.track || 'General',
            judgeId: params.judgeId,
            judgeName: resolvedJudgeName || params.judgeId,
            judgeEmail: resolvedJudgeEmail || '',
            assignedBy: params.assignedBy,
            assignedByName: params.assignedByName,
            assignedAt: now,
            assignmentSource: params.assignmentSource || 'MANUAL',
            deadline: params.deadline,
            status: 'PENDING',
            reassignmentHistory: [],
            updatedAt: now,
          };

          tx.set(
            assignmentRef,
            withServerTimestamps(sanitizeFirestoreData(assignment), true)
          );
          return assignment;
        });

        // Append durable governance audit if a trusted backend executor is registered
        const trusted = getTrustedBackendExecutor();
        if (trusted && created.organizationId) {
          await governanceAuditService.recordEventDurable(
            {
              organizationId: created.organizationId,
              competitionId: created.competitionId,
              category: 'ASSIGNMENT_CHANGE',
              action: 'SUBMISSION_ASSIGNED_TO_JUDGE',
              actorId: params.assignedBy,
              actorName: params.assignedByName,
              actorRole: 'ORGANIZER',
              targetId: created.submissionId,
              targetLabel: created.projectTitle,
              reason: `Assigned submission ${created.referenceId} to judge ${created.judgeName}.`,
              metadata: {
                assignmentId: created.id,
                judgeId: created.judgeId,
                judgeName: created.judgeName,
                assignmentSource: created.assignmentSource,
                roundId: created.roundId,
              },
            },
            { trustedExecutor: trusted }
          );
        }

        return created;
      } catch (err) {
        throw mapFirestoreError(err, 'assignSubmission', 'judgeAssignments');
      }
    }

    // Unit-test-only in-memory mode
    const existing = Array.from(this.assignments.values()).find(
      (a) => a.submissionId === params.submissionId && a.judgeId === params.judgeId
    );
    if (existing) {
      if (existing.status === 'CONFLICT') {
        throw new Error(
          `Cannot assign: Judge "${resolvedJudgeName}" previously declared a conflict of interest on this submission.`
        );
      }
      return existing;
    }

    const assignment: JudgeAssignment = {
      id,
      organizationId: params.organizationId,
      competitionId: params.competitionId,
      roundId: params.roundId,
      submissionId: params.submissionId,
      referenceId: params.referenceId || params.submissionId,
      projectTitle: params.projectTitle || 'Project Submission',
      track: params.track || 'General',
      judgeId: params.judgeId,
      judgeName: resolvedJudgeName || params.judgeId,
      judgeEmail: resolvedJudgeEmail || '',
      assignedBy: params.assignedBy,
      assignedByName: params.assignedByName,
      assignedAt: now,
      assignmentSource: params.assignmentSource || 'MANUAL',
      deadline: params.deadline,
      status: 'PENDING',
      reassignmentHistory: [],
      updatedAt: now,
    };

    this.assignments.set(id, assignment);

    governanceAuditService.recordEvent({
      organizationId: assignment.organizationId,
      competitionId: assignment.competitionId,
      category: 'ASSIGNMENT_CHANGE',
      action: 'SUBMISSION_ASSIGNED_TO_JUDGE',
      actorId: params.assignedBy,
      actorName: params.assignedByName,
      actorRole: 'ORGANIZER',
      targetId: assignment.submissionId,
      targetLabel: assignment.projectTitle,
      reason: `Assigned submission ${assignment.referenceId} to judge ${assignment.judgeName}.`,
      metadata: {
        assignmentId: assignment.id,
        judgeId: assignment.judgeId,
        judgeName: assignment.judgeName,
        assignmentSource: assignment.assignmentSource,
        roundId: assignment.roundId,
      },
    });

    return assignment;
  }

  public async batchAssignSubmissions(
    params: {
      organizationId?: string;
      competitionId: string;
      submissionIds: string[];
      judgeId: string;
      assignedBy: string;
      assignedByName: string;
      deadline?: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<JudgeAssignment[]> {
    const results: JudgeAssignment[] = [];
    for (const subId of params.submissionIds) {
      const sub = await submissionService.getSubmission(subId, options);
      const asgn = await this.assignSubmission(
        {
          organizationId: params.organizationId || sub?.organizationId,
          competitionId: params.competitionId,
          submissionId: subId,
          referenceId: sub?.referenceId || subId,
          projectTitle: sub?.projectTitle || 'Project Submission',
          track: sub?.track,
          judgeId: params.judgeId,
          assignedBy: params.assignedBy,
          assignedByName: params.assignedByName,
          assignmentSource: 'BATCH',
          deadline: params.deadline,
        },
        options
      );
      results.push(asgn);
    }
    return results;
  }

  public async reassignSubmission(
    assignmentId: string,
    newJudgeId: string,
    reassignedBy: string,
    reassignedByName: string,
    reason: string,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeAssignment> {
    if (!reason || reason.trim().length < 5) {
      throw new Error('A documented reassignment reason (at least 5 characters) is required.');
    }

    const newJudge = await this.getJudge(newJudgeId, options);
    if (!newJudge) {
      throw new Error(`New judge with ID "${newJudgeId}" not found.`);
    }

    const fs = resolveFirestore(options?.firestore);
    const now = new Date().toISOString();

    if (fs) {
      try {
        const oldRef = doc(fs, 'judgeAssignments', assignmentId);
        const reassigned = await runTransaction(fs, async (tx) => {
          const oldSnap = await tx.get(oldRef);
          if (!oldSnap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Assignment with ID "${assignmentId}" not found.`,
              operation: 'reassignSubmission',
              collection: 'judgeAssignments',
            });
          }

          const oldAsgn = oldSnap.data() as JudgeAssignment;
          const auditEntry: ReassignmentAudit = {
            previousJudgeId: oldAsgn.judgeId,
            previousJudgeName: oldAsgn.judgeName,
            newJudgeId: newJudge.id,
            newJudgeName: newJudge.name,
            reassignedBy,
            reassignedByName,
            reassignedAt: now,
            reason: reason.trim(),
          };

          const newAsgnId = this.makeAssignmentId(oldAsgn.submissionId, newJudge.id);
          const newRef = doc(fs, 'judgeAssignments', newAsgnId);

          const nextAssignment: JudgeAssignment = {
            ...oldAsgn,
            id: newAsgnId,
            judgeId: newJudge.id,
            judgeName: newJudge.name,
            judgeEmail: newJudge.email,
            assignmentSource: 'REASSIGNMENT',
            status: 'PENDING',
            conflict: undefined,
            completedAt: undefined,
            reassignmentHistory: [...(oldAsgn.reassignmentHistory || []), auditEntry],
            updatedAt: now,
          };

          tx.set(
            newRef,
            withServerTimestamps(sanitizeFirestoreData(nextAssignment), true)
          );
          if (newAsgnId !== assignmentId) {
            tx.delete(oldRef);
          }
          return nextAssignment;
        });

        const trusted = getTrustedBackendExecutor();
        if (trusted && reassigned.organizationId) {
          await governanceAuditService.recordEventDurable(
            {
              organizationId: reassigned.organizationId,
              competitionId: reassigned.competitionId,
              category: 'ASSIGNMENT_CHANGE',
              action: 'SUBMISSION_REASSIGNED',
              actorId: reassignedBy,
              actorName: reassignedByName,
              actorRole: 'ORGANIZER',
              targetId: reassigned.submissionId,
              targetLabel: reassigned.projectTitle,
              reason: reason.trim(),
              metadata: {
                assignmentId: reassigned.id,
                newJudgeId: newJudge.id,
                newJudgeName: newJudge.name,
              },
            },
            { trustedExecutor: trusted }
          );
        }

        return reassigned;
      } catch (err) {
        throw mapFirestoreError(err, 'reassignSubmission', 'judgeAssignments');
      }
    }

    const assignment = this.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment with ID "${assignmentId}" not found.`);
    }

    const auditEntry: ReassignmentAudit = {
      previousJudgeId: assignment.judgeId,
      previousJudgeName: assignment.judgeName,
      newJudgeId: newJudge.id,
      newJudgeName: newJudge.name,
      reassignedBy,
      reassignedByName,
      reassignedAt: now,
      reason: reason.trim(),
    };

    assignment.reassignmentHistory.push(auditEntry);
    assignment.judgeId = newJudge.id;
    assignment.judgeName = newJudge.name;
    assignment.judgeEmail = newJudge.email;
    assignment.assignmentSource = 'REASSIGNMENT';
    assignment.status = 'PENDING';
    assignment.conflict = undefined;
    assignment.updatedAt = now;

    this.assignments.set(assignmentId, assignment);

    governanceAuditService.recordEvent({
      organizationId: assignment.organizationId,
      competitionId: assignment.competitionId,
      category: 'ASSIGNMENT_CHANGE',
      action: 'SUBMISSION_REASSIGNED',
      actorId: reassignedBy,
      actorName: reassignedByName,
      actorRole: 'ORGANIZER',
      targetId: assignment.submissionId,
      targetLabel: assignment.projectTitle,
      reason: reason.trim(),
      metadata: {
        assignmentId: assignment.id,
        previousJudgeId: auditEntry.previousJudgeId,
        previousJudgeName: auditEntry.previousJudgeName,
        newJudgeId: newJudge.id,
        newJudgeName: newJudge.name,
      },
    });

    return assignment;
  }

  public async listAssignmentsPaginated(
    filter?: {
      judgeId?: string;
      judgeEmail?: string;
      submissionId?: string;
      competitionId?: string;
      status?: JudgeAssignmentStatus;
    },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<JudgeAssignment>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);

    if (fs) {
      try {
        const constraints: QueryConstraint[] = [];
        if (filter?.competitionId && filter.competitionId !== 'ALL') {
          constraints.push(where('competitionId', '==', filter.competitionId));
        }
        if (filter?.judgeId) {
          constraints.push(where('judgeId', '==', filter.judgeId));
        }
        if (filter?.submissionId) {
          constraints.push(where('submissionId', '==', filter.submissionId));
        }
        if (filter?.status) {
          constraints.push(where('status', '==', filter.status));
        }
        constraints.push(limit(pageSize + 1));
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }

        const snap = await getDocs(query(collection(fs, 'judgeAssignments'), ...constraints));
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        let items = pageDocs.map((d) => d.data() as JudgeAssignment);
        if (filter?.judgeEmail) {
          const lower = filter.judgeEmail.toLowerCase().trim();
          items = items.filter((a) => (a.judgeEmail || '').toLowerCase().trim() === lower);
        }

        return {
          items,
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listAssignmentsPaginated', 'judgeAssignments');
      }
    }

    let list = Array.from(this.assignments.values());
    if (filter) {
      if (filter.judgeId) list = list.filter((a) => a.judgeId === filter.judgeId);
      if (filter.judgeEmail) {
        const lower = filter.judgeEmail.toLowerCase().trim();
        list = list.filter((a) => a.judgeEmail.toLowerCase().trim() === lower);
      }
      if (filter.submissionId) list = list.filter((a) => a.submissionId === filter.submissionId);
      if (filter.competitionId && filter.competitionId !== 'ALL') {
        list = list.filter((a) => a.competitionId === filter.competitionId);
      }
      if (filter.status) list = list.filter((a) => a.status === filter.status);
    }

    return {
      items: list.slice(0, pageSize),
      hasMore: list.length > pageSize,
      nextCursor: null,
      pageSize,
    };
  }

  public async listAssignments(
    filter?: {
      judgeId?: string;
      judgeEmail?: string;
      submissionId?: string;
      competitionId?: string;
      status?: JudgeAssignmentStatus;
    },
    options?: PaginationOptions
  ): Promise<JudgeAssignment[]> {
    const page = await this.listAssignmentsPaginated(filter, options);
    return page.items;
  }

  public async getAssignment(
    assignmentId: string,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeAssignment | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'judgeAssignments', assignmentId));
        return snap.exists() ? (snap.data() as JudgeAssignment) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getAssignment', 'judgeAssignments');
      }
    }
    return this.assignments.get(assignmentId) || null;
  }

  public async getAssignmentForSubmissionAndJudge(
    submissionId: string,
    judgeId: string,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeAssignment | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      return this.getAssignment(this.makeAssignmentId(submissionId, judgeId), options);
    }

    for (const a of this.assignments.values()) {
      if (a.submissionId === submissionId && a.judgeId === judgeId) {
        return a;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // 3. CONFLICT OF INTEREST
  // ─────────────────────────────────────────────

  public async declareConflictOfInterest(
    params: {
      assignmentId: string;
      judgeId: string;
      judgeName: string;
      conflictType: ConflictType;
      reason: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<JudgeAssignment> {
    if (!params.reason || params.reason.trim().length < 5) {
      throw new Error('A detailed reason is required when declaring a conflict of interest.');
    }

    const now = new Date().toISOString();
    const declaration: ConflictDeclaration = {
      declaredByJudgeId: params.judgeId,
      declaredByJudgeName: params.judgeName,
      declaredAt: now,
      conflictType: params.conflictType,
      reason: params.reason.trim(),
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'judgeAssignments', params.assignmentId);
        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Assignment with ID "${params.assignmentId}" not found.`,
              operation: 'declareConflictOfInterest',
              collection: 'judgeAssignments',
            });
          }
          const existing = snap.data() as JudgeAssignment;
          tx.update(
            ref,
            withServerTimestamps(
              {
                status: 'CONFLICT',
                conflict: sanitizeFirestoreData(declaration),
                updatedAt: now,
              },
              false
            )
          );
          return { ...existing, status: 'CONFLICT', conflict: declaration, updatedAt: now };
        });
      } catch (err) {
        throw mapFirestoreError(err, 'declareConflictOfInterest', 'judgeAssignments');
      }
    }

    const assignment = this.assignments.get(params.assignmentId);
    if (!assignment) {
      throw new Error(`Assignment with ID "${params.assignmentId}" not found.`);
    }

    assignment.status = 'CONFLICT';
    assignment.conflict = declaration;
    assignment.updatedAt = now;
    this.assignments.set(params.assignmentId, assignment);
    return assignment;
  }

  /**
   * Revokes an existing assignment with organizer authorization and mandatory reason.
   */
  public async revokeAssignment(
    assignmentId: string,
    revokedBy: string,
    revokedByName: string,
    reason: string,
    options?: FirestoreExecutionOptions
  ): Promise<JudgeAssignment> {
    if (!reason || reason.trim().length < 5) {
      throw new Error('A documented reason (at least 5 characters) is required to revoke an assignment.');
    }
    const fs = resolveFirestore(options?.firestore);
    const now = new Date().toISOString();
    if (fs) {
      try {
        const asgnRef = doc(fs, 'judgeAssignments', assignmentId);
        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(asgnRef);
          if (!snap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Assignment with ID "${assignmentId}" not found.`,
              operation: 'revokeAssignment',
              collection: 'judgeAssignments',
            });
          }
          const existing = snap.data() as JudgeAssignment;
          const updated: JudgeAssignment = {
            ...existing,
            status: 'REVOKED',
            updatedAt: now,
          };
          tx.update(
            asgnRef,
            withServerTimestamps({ status: 'REVOKED', updatedAt: now }, false)
          );
          return updated;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'revokeAssignment', 'judgeAssignments');
      }
    }

    const assignment = this.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment with ID "${assignmentId}" not found.`);
    }
    assignment.status = 'REVOKED';
    assignment.updatedAt = now;
    this.assignments.set(assignmentId, assignment);

    governanceAuditService.recordEvent({
      organizationId: assignment.organizationId,
      competitionId: assignment.competitionId,
      category: 'ASSIGNMENT_CHANGE',
      action: 'JUDGE_ASSIGNMENT_REVOKED',
      actorId: revokedBy,
      actorName: revokedByName,
      actorRole: 'ORGANIZER',
      targetId: assignment.submissionId,
      targetLabel: assignment.projectTitle,
      reason: reason.trim(),
      metadata: {
        assignmentId,
        judgeId: assignment.judgeId,
        judgeName: assignment.judgeName,
      },
    });

    return assignment;
  }

  // ─────────────────────────────────────────────
  // 4. JUDGE WORKLOAD & METRICS
  // ─────────────────────────────────────────────

  public async getJudgeWorkload(
    competitionId?: string,
    options?: PaginationOptions & { organizationId?: string }
  ): Promise<JudgeWorkloadSummary[]> {
    const judges = await this.listJudges(competitionId, options);
    const allAssignments = await this.listAssignments({ competitionId }, options);

    return judges.map((judge) => {
      const judgeAsgns = allAssignments.filter((a) => a.judgeId === judge.id);
      const total = judgeAsgns.length;
      const pending = judgeAsgns.filter((a) => a.status === 'PENDING').length;
      const inProgress = judgeAsgns.filter((a) => a.status === 'IN_PROGRESS').length;
      const completed = judgeAsgns.filter((a) => a.status === 'COMPLETED').length;
      const conflicts = judgeAsgns.filter((a) => a.status === 'CONFLICT').length;
      const quota = judge.maxQuota || 10;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        judgeId: judge.id,
        judgeName: judge.name,
        judgeEmail: judge.email,
        assignedTracks: judge.assignedTracks,
        totalAssigned: total,
        pendingReviews: pending,
        inProgressReviews: inProgress,
        completedReviews: completed,
        conflictsDeclared: conflicts,
        maxQuota: quota,
        completionRate,
        status: judge.status,
      };
    });
  }

  // ─────────────────────────────────────────────
  // 5. HUMAN JUDGE EVALUATION & IMMUTABILITY (Firestore: /humanEvaluations/{submissionId}_{judgeId})
  // ─────────────────────────────────────────────

  /**
   * Saves an in-progress draft evaluation durably to Firestore using a transaction.
   * Prevents one judge from overwriting another judge's evaluation and rejects edits on locked records.
   */
  public async saveEvaluationDraft(
    payload: {
      organizationId?: string;
      submissionId: string;
      referenceId: string;
      competitionId: string;
      roundId?: string;
      judgeId: string;
      judgeName: string;
      judgeEmail: string;
      rubricVersion?: number;
      decisionMode: 'AGREE' | 'MODIFY' | 'REJECT';
      scores: Record<string, number>;
      criterionComments?: Record<string, string>;
      overallComments?: string;
      totalScore: number;
      aiTotalScore: number;
      criterionDifferences: Record<string, CriterionComparisonDetail>;
      deductionNotes: string;
      privateNotes?: string;
      assignmentId?: string;
      evidenceAnnotations?: Record<string, JudgeEvidenceAnnotation>;
    },
    options?: FirestoreExecutionOptions
  ): Promise<HumanJudgeEvaluation> {
    const key = this.makeEvalKey(payload.submissionId, payload.judgeId);
    const now = new Date().toISOString();
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      const evalRef = doc(fs, 'humanEvaluations', key);
      const asgnId = payload.assignmentId || this.makeAssignmentId(payload.submissionId, payload.judgeId);
      const asgnRef = doc(fs, 'judgeAssignments', asgnId);

      try {
        return await runTransaction(fs, async (tx) => {
          const [existingSnap, asgnSnap] = await Promise.all([
            tx.get(evalRef),
            tx.get(asgnRef),
          ]);

          const existing = existingSnap.exists()
            ? (existingSnap.data() as HumanJudgeEvaluation)
            : null;

          if (existing && existing.judgeId !== payload.judgeId) {
            throw new PersistenceError({
              code: 'PERMISSION_DENIED',
              message: 'Cannot overwrite another judge’s evaluation draft.',
              operation: 'saveEvaluationDraft',
              collection: 'humanEvaluations',
            });
          }

          if (existing && existing.isLocked) {
            throw new PersistenceError({
              code: 'CONFLICT',
              message:
                'Cannot modify this evaluation: It has been submitted and locked. Reopening requires organizer authorization and a logged audit reason.',
              operation: 'saveEvaluationDraft',
              collection: 'humanEvaluations',
            });
          }

          let orgId =
            payload.organizationId ||
            existing?.organizationId ||
            (asgnSnap.exists() ? (asgnSnap.data().organizationId as string) : undefined);

          if (!orgId) {
            try {
              const compSnap = await tx.get(doc(fs, 'competitions', payload.competitionId));
              orgId = compSnap.exists() ? (compSnap.data().organizationId as string) : undefined;
            } catch {
              // fallback below
            }
          }
          if (!orgId) {
            orgId = 'org-krivee';
          }

          const evaluation: HumanJudgeEvaluation = {
            id: key,
            assignmentId: asgnId,
            organizationId: orgId,
            submissionId: payload.submissionId,
            referenceId: payload.referenceId,
            competitionId: payload.competitionId,
            roundId: payload.roundId,
            judgeId: payload.judgeId,
            judgeName: payload.judgeName,
            judgeEmail: payload.judgeEmail,
            source: 'HUMAN',
            rubricVersion: payload.rubricVersion ?? existing?.rubricVersion ?? 1,
            decisionMode: payload.decisionMode,
            scores: payload.scores,
            criterionComments: payload.criterionComments || existing?.criterionComments || {},
            overallComments: payload.overallComments ?? payload.deductionNotes,
            totalScore: payload.totalScore,
            aiTotalScore: payload.aiTotalScore,
            scoreDifference: payload.totalScore - payload.aiTotalScore,
            criterionDifferences: payload.criterionDifferences,
            deductionNotes: payload.deductionNotes,
            privateNotes: payload.privateNotes,
            evidenceAnnotations: payload.evidenceAnnotations || existing?.evidenceAnnotations || {},
            status: 'DRAFT',
            isLocked: false,
            savedAsDraftAt: now,
            reopenHistory: existing ? existing.reopenHistory || [] : [],
            evaluatorVersion: (existing?.evaluatorVersion || 0) + 1,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
          };

          const stamped = withServerTimestamps(
            sanitizeFirestoreData(evaluation),
            !existing
          );

          if (existing) {
            tx.update(evalRef, stamped);
          } else {
            tx.set(evalRef, stamped);
          }

          if (asgnSnap.exists() && asgnSnap.data().status === 'PENDING') {
            tx.update(
              asgnRef,
              withServerTimestamps({ status: 'IN_PROGRESS', updatedAt: now }, false)
            );
          }

          return evaluation;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'saveEvaluationDraft', 'humanEvaluations');
      }
    }

    // Unit-test-only in-memory mode
    const existing = this.evaluations.get(key);
    if (existing && existing.isLocked) {
      throw new Error(
        'Cannot modify this evaluation: It has been submitted and locked. Reopening requires organizer authorization and a logged audit reason.'
      );
    }

    const evaluation: HumanJudgeEvaluation = {
      id: existing ? existing.id : key,
      assignmentId: payload.assignmentId,
      organizationId: payload.organizationId,
      submissionId: payload.submissionId,
      referenceId: payload.referenceId,
      competitionId: payload.competitionId,
      roundId: payload.roundId,
      judgeId: payload.judgeId,
      judgeName: payload.judgeName,
      judgeEmail: payload.judgeEmail,
      source: 'HUMAN',
      rubricVersion: payload.rubricVersion ?? existing?.rubricVersion ?? 1,
      decisionMode: payload.decisionMode,
      scores: payload.scores,
      criterionComments: payload.criterionComments || existing?.criterionComments || {},
      overallComments: payload.overallComments ?? payload.deductionNotes,
      totalScore: payload.totalScore,
      aiTotalScore: payload.aiTotalScore,
      scoreDifference: payload.totalScore - payload.aiTotalScore,
      criterionDifferences: payload.criterionDifferences,
      deductionNotes: payload.deductionNotes,
      privateNotes: payload.privateNotes,
      evidenceAnnotations: payload.evidenceAnnotations || existing?.evidenceAnnotations || {},
      status: 'DRAFT',
      isLocked: false,
      savedAsDraftAt: now,
      reopenHistory: existing ? existing.reopenHistory : [],
      evaluatorVersion: (existing?.evaluatorVersion || 0) + 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.evaluations.set(key, evaluation);

    const asgn = await this.getAssignmentForSubmissionAndJudge(payload.submissionId, payload.judgeId);
    if (asgn && asgn.status === 'PENDING') {
      asgn.status = 'IN_PROGRESS';
      asgn.updatedAt = now;
      this.assignments.set(asgn.id, asgn);
    }

    const sub = await submissionService.getSubmission(payload.submissionId);
    if (sub && sub.status === 'Ready for Judge Review') {
      const trans = submissionLifecycleService.transitionStatus(
        sub,
        'Under Human Review',
        { id: payload.judgeId },
        `Review draft initiated by ${payload.judgeName}`
      );
      if (trans.updatedSubmission) {
        await submissionService.saveSubmission(trans.updatedSubmission);
      }
    }

    return evaluation;
  }

  /**
   * Atomically finalizes and locks an official human judge evaluation in Firestore.
   * Prevents duplicate submission and atomically marks the judge assignment COMPLETED.
   */
  public async submitFinalEvaluation(
    payload: {
      organizationId?: string;
      submissionId: string;
      referenceId: string;
      competitionId: string;
      roundId?: string;
      judgeId: string;
      judgeName: string;
      judgeEmail: string;
      rubricVersion?: number;
      decisionMode: 'AGREE' | 'MODIFY' | 'REJECT';
      scores: Record<string, number>;
      criterionComments?: Record<string, string>;
      overallComments?: string;
      totalScore: number;
      aiTotalScore: number;
      criterionDifferences: Record<string, CriterionComparisonDetail>;
      deductionNotes: string;
      privateNotes?: string;
      assignmentId?: string;
      evidenceAnnotations?: Record<string, JudgeEvidenceAnnotation>;
    },
    options?: FirestoreExecutionOptions
  ): Promise<HumanJudgeEvaluation> {
    if (
      payload.decisionMode === 'REJECT' &&
      (!payload.deductionNotes || payload.deductionNotes.trim().length < 5)
    ) {
      throw new Error(
        'Deduction rationale and score modification justification are required when modifying or rejecting AI scores.'
      );
    }

    if (payload.decisionMode === 'MODIFY' && (!payload.deductionNotes || payload.deductionNotes.trim().length < 5)) {
      payload.deductionNotes = payload.deductionNotes?.trim() || 'Manual score adjustment by judge during review.';
    }

    const key = this.makeEvalKey(payload.submissionId, payload.judgeId);
    const now = new Date().toISOString();
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      // Ensure a draft doc exists first (matches firestore.rules canCreateHumanDraftEvaluation -> lock update)
      const evalRef = doc(fs, 'humanEvaluations', key);
      const preSnap = await getDoc(evalRef).catch((err) => {
        throw mapFirestoreError(err, 'submitFinalEvaluation', 'humanEvaluations');
      });

      if (!preSnap.exists()) {
        await this.saveEvaluationDraft(payload, options);
      } else if ((preSnap.data() as HumanJudgeEvaluation).isLocked) {
        throw new PersistenceError({
          code: 'CONFLICT',
          message:
            'Evaluation is already finalized and locked. Duplicate submission rejected; reopening requires organizer authorization.',
          operation: 'submitFinalEvaluation',
          collection: 'humanEvaluations',
        });
      }

      const asgnId = payload.assignmentId || this.makeAssignmentId(payload.submissionId, payload.judgeId);
      const asgnRef = doc(fs, 'judgeAssignments', asgnId);

      try {
        const finalEvaluation = await runTransaction(fs, async (tx) => {
          const [existingSnap, asgnSnap] = await Promise.all([
            tx.get(evalRef),
            tx.get(asgnRef),
          ]);

          if (!existingSnap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Evaluation draft "${key}" disappeared before finalization.`,
              operation: 'submitFinalEvaluation',
              collection: 'humanEvaluations',
            });
          }

          const existing = existingSnap.data() as HumanJudgeEvaluation;
          if (existing.isLocked) {
            throw new PersistenceError({
              code: 'CONFLICT',
              message: 'Evaluation is already finalized and locked. Duplicate submission rejected.',
              operation: 'submitFinalEvaluation',
              collection: 'humanEvaluations',
            });
          }

          const lockedEval: HumanJudgeEvaluation = {
            ...existing,
            assignmentId: asgnId,
            rubricVersion: payload.rubricVersion ?? existing.rubricVersion ?? 1,
            decisionMode: payload.decisionMode,
            scores: payload.scores,
            criterionComments: payload.criterionComments || existing.criterionComments || {},
            overallComments: payload.overallComments ?? payload.deductionNotes,
            totalScore: payload.totalScore,
            aiTotalScore: payload.aiTotalScore,
            scoreDifference: payload.totalScore - payload.aiTotalScore,
            criterionDifferences: payload.criterionDifferences,
            deductionNotes: payload.deductionNotes,
            privateNotes: payload.privateNotes,
            evidenceAnnotations: payload.evidenceAnnotations || existing.evidenceAnnotations || {},
            source: 'HUMAN',
            status: 'SUBMITTED',
            isLocked: true,
            submittedAt: now,
            evaluatorVersion: (existing.evaluatorVersion || 0) + 1,
            updatedAt: now,
          };

          tx.update(
            evalRef,
            withServerTimestamps(
              sanitizeFirestoreData({
                rubricVersion: lockedEval.rubricVersion,
                decisionMode: lockedEval.decisionMode,
                scores: lockedEval.scores,
                criterionComments: lockedEval.criterionComments,
                overallComments: lockedEval.overallComments,
                totalScore: lockedEval.totalScore,
                aiTotalScore: lockedEval.aiTotalScore,
                scoreDifference: lockedEval.scoreDifference,
                criterionDifferences: lockedEval.criterionDifferences,
                deductionNotes: lockedEval.deductionNotes,
                privateNotes: lockedEval.privateNotes,
                source: 'HUMAN',
                status: 'SUBMITTED',
                isLocked: true,
                submittedAt: now,
                evaluatorVersion: lockedEval.evaluatorVersion,
                updatedAt: now,
              }),
              false
            )
          );

          if (asgnSnap.exists()) {
            tx.update(
              asgnRef,
              withServerTimestamps(
                { status: 'COMPLETED', completedAt: now, updatedAt: now },
                false
              )
            );
          }

          return lockedEval;
        });

        // If a trusted backend executor is active, also persist immutable ledger + audit entries durably
        const trusted = getTrustedBackendExecutor();
        if (trusted && finalEvaluation.organizationId) {
          const scoreEntries = Object.entries(payload.scores || {});
          for (const [criterionId, scoreValue] of scoreEntries) {
            const detail = payload.criterionDifferences?.[criterionId];
            const maxScore = Math.max(detail?.maxScore || 25, scoreValue || 1);
            await scoringLedgerService.appendContributionDurable(
              {
                organizationId: finalEvaluation.organizationId,
                competitionId: payload.competitionId,
                entryId: payload.submissionId,
                referenceId: payload.referenceId,
                evaluationId: finalEvaluation.id,
                rubricVersion: finalEvaluation.rubricVersion,
                criterionId,
                criterionName: detail?.criterionName || criterionId,
                score: scoreValue,
                maxScore,
                source: 'HUMAN',
                actorId: payload.judgeId,
                actorName: payload.judgeName,
                reasonForAdjustment:
                  payload.deductionNotes?.trim() ||
                  `Human judge final evaluation (${payload.decisionMode})`,
                roundId: payload.roundId,
                authorizedSource: 'JUDGE_SUBMISSION',
              },
              { trustedExecutor: trusted }
            );
          }

          await governanceAuditService.recordEventDurable(
            {
              organizationId: finalEvaluation.organizationId,
              competitionId: payload.competitionId,
              category: 'EVALUATION_SUBMISSION',
              action: 'HUMAN_EVALUATION_SUBMITTED',
              actorId: payload.judgeId,
              actorName: payload.judgeName,
              actorRole: 'JUDGE',
              targetId: payload.submissionId,
              targetLabel: payload.referenceId,
              reason:
                payload.deductionNotes?.trim() ||
                `Submitted final human evaluation (${payload.decisionMode}): ${payload.totalScore} pts`,
              metadata: {
                evaluationId: finalEvaluation.id,
                decisionMode: payload.decisionMode,
                totalScore: payload.totalScore,
                evaluatorVersion: finalEvaluation.evaluatorVersion,
              },
            },
            { trustedExecutor: trusted }
          );
        }

        return finalEvaluation;
      } catch (err) {
        throw mapFirestoreError(err, 'submitFinalEvaluation', 'humanEvaluations');
      }
    }

    // Unit-test-only in-memory mode
    const existing = this.evaluations.get(key);
    if (existing && existing.isLocked) {
      throw new Error(
        'Evaluation is already finalized and locked. Changes require explicit organizer authorization.'
      );
    }

    const finalEvaluation: HumanJudgeEvaluation = {
      id: existing ? existing.id : key,
      assignmentId: payload.assignmentId,
      organizationId: payload.organizationId,
      submissionId: payload.submissionId,
      referenceId: payload.referenceId,
      competitionId: payload.competitionId,
      roundId: payload.roundId,
      judgeId: payload.judgeId,
      judgeName: payload.judgeName,
      judgeEmail: payload.judgeEmail,
      source: 'HUMAN',
      rubricVersion: payload.rubricVersion ?? existing?.rubricVersion ?? 1,
      decisionMode: payload.decisionMode,
      scores: payload.scores,
      criterionComments: payload.criterionComments || existing?.criterionComments || {},
      overallComments: payload.overallComments ?? payload.deductionNotes,
      totalScore: payload.totalScore,
      aiTotalScore: payload.aiTotalScore,
      scoreDifference: payload.totalScore - payload.aiTotalScore,
      criterionDifferences: payload.criterionDifferences,
      deductionNotes: payload.deductionNotes,
      privateNotes: payload.privateNotes,
      evidenceAnnotations: payload.evidenceAnnotations || existing?.evidenceAnnotations || {},
      status: 'SUBMITTED',
      isLocked: true,
      submittedAt: now,
      reopenHistory: existing ? existing.reopenHistory : [],
      evaluatorVersion: (existing?.evaluatorVersion || 0) + 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.evaluations.set(key, finalEvaluation);

    const asgn = await this.getAssignmentForSubmissionAndJudge(payload.submissionId, payload.judgeId);
    if (asgn) {
      asgn.status = 'COMPLETED';
      asgn.completedAt = now;
      asgn.updatedAt = now;
      this.assignments.set(asgn.id, asgn);
    }

    const sub = await submissionService.getSubmission(payload.submissionId);
    if (sub) {
      if (sub.status === 'Ready for Judge Review' || sub.status === 'Under Human Review') {
        const trans = submissionLifecycleService.transitionStatus(
          sub,
          'Evaluated',
          { id: payload.judgeId },
          `Final evaluation submitted by ${payload.judgeName}. Score: ${payload.totalScore}/${payload.aiTotalScore || 100}. Mode: ${payload.decisionMode}`
        );
        if (trans.updatedSubmission) {
          await submissionService.saveSubmission(trans.updatedSubmission);
        }
      }
    }

    const scoreEntries = Object.entries(payload.scores || {});
    if (scoreEntries.length > 0) {
      for (const [criterionId, scoreValue] of scoreEntries) {
        const detail = payload.criterionDifferences?.[criterionId];
        const maxScore = Math.max(detail?.maxScore || 25, scoreValue || 1);
        scoringLedgerService.appendContribution({
          organizationId: payload.organizationId,
          competitionId: payload.competitionId,
          entryId: payload.submissionId,
          referenceId: payload.referenceId,
          evaluationId: finalEvaluation.id,
          rubricVersion: finalEvaluation.rubricVersion,
          criterionId,
          criterionName: detail?.criterionName || criterionId,
          score: scoreValue,
          maxScore,
          source: 'HUMAN',
          actorId: payload.judgeId,
          actorName: payload.judgeName,
          reasonForAdjustment:
            payload.deductionNotes?.trim() ||
            `Human judge final evaluation (${payload.decisionMode})`,
          roundId: payload.roundId,
          authorizedSource: 'JUDGE_SUBMISSION',
        });
      }
    }

    governanceAuditService.recordEvent({
      organizationId: payload.organizationId,
      competitionId: payload.competitionId,
      category: 'EVALUATION_SUBMISSION',
      action: 'HUMAN_EVALUATION_SUBMITTED',
      actorId: payload.judgeId,
      actorName: payload.judgeName,
      actorRole: 'JUDGE',
      targetId: payload.submissionId,
      targetLabel: payload.referenceId,
      reason:
        payload.deductionNotes?.trim() ||
        `Submitted final human evaluation (${payload.decisionMode}): ${payload.totalScore} pts`,
      metadata: {
        evaluationId: finalEvaluation.id,
        decisionMode: payload.decisionMode,
        totalScore: payload.totalScore,
        aiTotalScore: payload.aiTotalScore,
        scoreDifference: finalEvaluation.scoreDifference,
        evaluatorVersion: finalEvaluation.evaluatorVersion,
        roundId: payload.roundId,
      },
    });

    return finalEvaluation;
  }

  /**
   * Reopens a locked evaluation with organizer authorization and mandatory audit reason.
   */
  public async reopenEvaluation(
    params: {
      evaluationId: string;
      organizerUserId: string;
      organizerName: string;
      auditReason: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<HumanJudgeEvaluation> {
    const fs = resolveFirestore(options?.firestore);
    const minLen = fs ? 10 : 5;
    if (!params.auditReason || params.auditReason.trim().length < minLen) {
      throw new Error(
        `A detailed audit justification (at least ${minLen} characters) is required to reopen an evaluation.`
      );
    }

    const now = new Date().toISOString();
    const trimmedReason = params.auditReason.trim();

    if (fs) {
      const evalRef = doc(fs, 'humanEvaluations', params.evaluationId);
      try {
        const reopened = await runTransaction(fs, async (tx) => {
          const snap = await tx.get(evalRef);
          if (!snap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Evaluation with ID "${params.evaluationId}" not found.`,
              operation: 'reopenEvaluation',
              collection: 'humanEvaluations',
            });
          }

          const existing = snap.data() as HumanJudgeEvaluation;
          const nextHistory = [
            ...(existing.reopenHistory || []),
            {
              reopenedBy: params.organizerUserId,
              reopenedByName: params.organizerName,
              reopenedAt: now,
              auditReason: trimmedReason,
            },
          ];

          const asgnRef = doc(
            fs,
            'judgeAssignments',
            this.makeAssignmentId(existing.submissionId, existing.judgeId)
          );
          const asgnSnap = await tx.get(asgnRef);

          tx.update(
            evalRef,
            withServerTimestamps(
              {
                isLocked: false,
                status: 'DRAFT',
                reopenReason: trimmedReason,
                reopenedBy: params.organizerUserId,
                reopenedAt: now,
                reopenHistory: nextHistory,
                updatedAt: now,
              },
              false
            )
          );

          if (asgnSnap.exists()) {
            tx.update(
              asgnRef,
              withServerTimestamps({ status: 'IN_PROGRESS', updatedAt: now }, false)
            );
          }

          return {
            ...existing,
            isLocked: false,
            status: 'DRAFT' as const,
            reopenReason: trimmedReason,
            reopenedBy: params.organizerUserId,
            reopenedAt: now,
            reopenHistory: nextHistory,
            updatedAt: now,
          };
        });

        const trusted = getTrustedBackendExecutor();
        if (trusted && reopened.organizationId) {
          await governanceAuditService.recordEventDurable(
            {
              organizationId: reopened.organizationId,
              competitionId: reopened.competitionId,
              category: 'REOPENED_EVALUATION',
              action: 'EVALUATION_REOPENED_BY_ORGANIZER',
              actorId: params.organizerUserId,
              actorName: params.organizerName,
              actorRole: 'ORGANIZER',
              targetId: reopened.submissionId,
              targetLabel: reopened.referenceId,
              reason: trimmedReason,
              metadata: {
                evaluationId: reopened.id,
                judgeId: reopened.judgeId,
                reopenCount: reopened.reopenHistory.length,
              },
            },
            { trustedExecutor: trusted }
          );
        }

        return reopened;
      } catch (err) {
        throw mapFirestoreError(err, 'reopenEvaluation', 'humanEvaluations');
      }
    }

    // Unit-test-only in-memory mode
    let targetEval: HumanJudgeEvaluation | null = null;
    for (const e of this.evaluations.values()) {
      if (e.id === params.evaluationId) {
        targetEval = e;
        break;
      }
    }

    if (!targetEval) {
      throw new Error(`Evaluation with ID "${params.evaluationId}" not found.`);
    }

    targetEval.isLocked = false;
    targetEval.status = 'DRAFT';
    targetEval.reopenReason = trimmedReason;
    targetEval.reopenedBy = params.organizerUserId;
    targetEval.reopenedAt = now;
    targetEval.updatedAt = now;
    targetEval.reopenHistory.push({
      reopenedBy: params.organizerUserId,
      reopenedByName: params.organizerName,
      reopenedAt: now,
      auditReason: trimmedReason,
    });

    const asgn = await this.getAssignmentForSubmissionAndJudge(targetEval.submissionId, targetEval.judgeId);
    if (asgn) {
      asgn.status = 'IN_PROGRESS';
      asgn.updatedAt = now;
      this.assignments.set(asgn.id, asgn);
    }

    const sub = await submissionService.getSubmission(targetEval.submissionId);
    if (sub && sub.status === 'Evaluated') {
      const trans = submissionLifecycleService.transitionStatus(
        sub,
        'Under Human Review',
        { id: params.organizerUserId },
        `Evaluation reopened by organizer ${params.organizerName}. Audit Reason: ${trimmedReason}`
      );
      if (trans.updatedSubmission) {
        await submissionService.saveSubmission(trans.updatedSubmission);
      }
    }

    governanceAuditService.recordEvent({
      organizationId: targetEval.organizationId,
      competitionId: targetEval.competitionId,
      category: 'REOPENED_EVALUATION',
      action: 'EVALUATION_REOPENED_BY_ORGANIZER',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      actorRole: 'ORGANIZER',
      targetId: targetEval.submissionId,
      targetLabel: targetEval.referenceId,
      reason: trimmedReason,
      metadata: {
        evaluationId: targetEval.id,
        judgeId: targetEval.judgeId,
        judgeName: targetEval.judgeName,
        reopenCount: targetEval.reopenHistory.length,
      },
    });

    return targetEval;
  }

  /**
   * Flags an integrity or rule concern on a submission.
   */
  public async flagConcern(
    params: {
      organizationId?: string;
      competitionId?: string;
      submissionId: string;
      judgeId: string;
      judgeName: string;
      category: FlaggedConcern['category'];
      explanation: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    if (!params.explanation || params.explanation.trim().length < 5) {
      throw new Error('A detailed explanation is required to flag a concern.');
    }

    const key = this.makeEvalKey(params.submissionId, params.judgeId);
    const now = new Date().toISOString();
    const flagged: FlaggedConcern = {
      flagged: true,
      category: params.category,
      explanation: params.explanation.trim(),
      flaggedAt: now,
      flaggedByJudgeId: params.judgeId,
      flaggedByJudgeName: params.judgeName,
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const evalRef = doc(fs, 'humanEvaluations', key);
        const snap = await getDoc(evalRef);
        if (snap.exists()) {
          await updateDoc(
            evalRef,
            withServerTimestamps(
              { flaggedConcern: sanitizeFirestoreData(flagged), updatedAt: now },
              false
            )
          );
          return;
        }
        if (!params.organizationId || !params.competitionId) {
          throw new PersistenceError({
            code: 'INVALID_ARGUMENT',
            message: 'Flagging a concern without an existing draft requires organizationId and competitionId.',
            operation: 'flagConcern',
            collection: 'humanEvaluations',
          });
        }
        const draftEval: HumanJudgeEvaluation = {
          id: key,
          organizationId: params.organizationId,
          submissionId: params.submissionId,
          referenceId: params.submissionId,
          competitionId: params.competitionId,
          judgeId: params.judgeId,
          judgeName: params.judgeName,
          judgeEmail: '',
          source: 'HUMAN',
          decisionMode: 'MODIFY',
          scores: {},
          totalScore: 0,
          aiTotalScore: 0,
          scoreDifference: 0,
          criterionDifferences: {},
          deductionNotes: '',
          status: 'DRAFT',
          isLocked: false,
          flaggedConcern: flagged,
          reopenHistory: [],
          evaluatorVersion: 1,
          createdAt: now,
          updatedAt: now,
        };
        await setDoc(
          evalRef,
          withServerTimestamps(sanitizeFirestoreData(draftEval), true)
        );
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'flagConcern', 'humanEvaluations');
      }
    }

    const existing = this.evaluations.get(key);
    if (existing) {
      existing.flaggedConcern = flagged;
      existing.updatedAt = now;
      this.evaluations.set(key, existing);
    } else {
      const draftEval: HumanJudgeEvaluation = {
        id: key,
        organizationId: params.organizationId,
        submissionId: params.submissionId,
        referenceId: params.submissionId,
        competitionId: params.competitionId || 'comp-default-ai',
        judgeId: params.judgeId,
        judgeName: params.judgeName,
        judgeEmail: '',
        source: 'HUMAN',
        decisionMode: 'MODIFY',
        scores: {},
        totalScore: 0,
        aiTotalScore: 0,
        scoreDifference: 0,
        criterionDifferences: {},
        deductionNotes: '',
        status: 'DRAFT',
        isLocked: false,
        flaggedConcern: flagged,
        reopenHistory: [],
        evaluatorVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.evaluations.set(key, draftEval);
    }
  }

  /**
   * Retrieves an evaluation for a specific submission and judge directly from Firestore.
   */
  public async getEvaluation(
    submissionId: string,
    judgeId: string,
    options?: FirestoreExecutionOptions
  ): Promise<HumanJudgeEvaluation | null> {
    const key = this.makeEvalKey(submissionId, judgeId);
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'humanEvaluations', key));
        return snap.exists() ? (snap.data() as HumanJudgeEvaluation) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getEvaluation', 'humanEvaluations');
      }
    }
    return this.evaluations.get(key) || null;
  }

  /**
   * Lists evaluations for a submission with strict privacy controls.
   */
  public async listEvaluationsForSubmission(
    submissionId: string,
    requestingJudgeId?: string,
    isOrganizer: boolean = false,
    options?: PaginationOptions
  ): Promise<HumanJudgeEvaluation[]> {
    const fs = resolveFirestore(options?.firestore);
    let all: HumanJudgeEvaluation[];

    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const constraints: QueryConstraint[] = [where('submissionId', '==', submissionId)];
        if (!isOrganizer && requestingJudgeId) {
          constraints.push(where('judgeId', '==', requestingJudgeId));
        }
        constraints.push(limit(pageSize));
        const snap = await getDocs(query(collection(fs, 'humanEvaluations'), ...constraints));
        all = snap.docs.map((d) => d.data() as HumanJudgeEvaluation);
      } catch (err) {
        throw mapFirestoreError(err, 'listEvaluationsForSubmission', 'humanEvaluations');
      }
    } else {
      all = Array.from(this.evaluations.values()).filter((e) => e.submissionId === submissionId);
    }

    if (isOrganizer) {
      return all;
    }

    return all.filter((e) => {
      if (requestingJudgeId && e.judgeId === requestingJudgeId) {
        return true;
      }
      return e.status === 'SUBMITTED';
    });
  }

  public async listEvaluationsByJudge(
    judgeId: string,
    options?: PaginationOptions
  ): Promise<HumanJudgeEvaluation[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const snap = await getDocs(
          query(collection(fs, 'humanEvaluations'), where('judgeId', '==', judgeId), limit(pageSize))
        );
        return snap.docs.map((d) => d.data() as HumanJudgeEvaluation);
      } catch (err) {
        throw mapFirestoreError(err, 'listEvaluationsByJudge', 'humanEvaluations');
      }
    }
    return Array.from(this.evaluations.values()).filter((e) => e.judgeId === judgeId);
  }

  public async listAllEvaluations(
    competitionId?: string,
    options?: PaginationOptions
  ): Promise<HumanJudgeEvaluation[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const constraints: QueryConstraint[] = [];
        if (competitionId) {
          constraints.push(where('competitionId', '==', competitionId));
        }
        constraints.push(limit(pageSize));
        if (options?.cursor) {
          constraints.push(startAfter(options.cursor));
        }
        const snap = await getDocs(query(collection(fs, 'humanEvaluations'), ...constraints));
        return snap.docs.map((d) => d.data() as HumanJudgeEvaluation);
      } catch (err) {
        throw mapFirestoreError(err, 'listAllEvaluations', 'humanEvaluations');
      }
    }

    const all = Array.from(this.evaluations.values());
    if (!competitionId) return all;
    return all.filter((e) => e.competitionId === competitionId);
  }

  /**
   * Resets unit-test-only in-memory maps for unit testing purposes.
   */
  public resetForTesting(): void {
    this.judges.clear();
    this.assignments.clear();
    this.evaluations.clear();
    INITIAL_SEED_JUDGES.forEach((j) => this.judges.set(j.id, j));
    INITIAL_SEED_ASSIGNMENTS.forEach((a) => this.assignments.set(a.id, a));
  }
}

export const judgeAssignmentService = new JudgeAssignmentService();
