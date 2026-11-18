// ─────────────────────────────────────────────
// judgeAssignmentService.ts — Judge Coordination, Assignments, Workload, & Immutability
// Proofly / Evalora — Phase 7 Human Judging Workspace
// ─────────────────────────────────────────────

import type {
  JudgeRecord,
  JudgeAssignment,
  JudgeAssignmentStatus,
  ConflictDeclaration,
  ConflictType,
  ReassignmentAudit,
  HumanJudgeEvaluation,
  JudgeWorkloadSummary,
  FlaggedConcern,
  CriterionComparisonDetail,
} from '../types/judgeAndEvaluation';
import { submissionLifecycleService } from './submissionLifecycleService';
import { submissionService } from './submissionService';
import { scoringLedgerService } from './scoringLedgerService';
import { governanceAuditService } from './governanceAuditService';
import { purgeLegacySampleStorageOnce } from '../utils/cleanSampleStorage';

// Default initial judges
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

// Initial seed assignments for default submissions
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
    deadline: '2026-11-20T23:59:59.000Z',
    status: 'COMPLETED',
    completedAt: '2026-11-16T14:30:00.000Z',
    reassignmentHistory: [],
  },
];

class JudgeAssignmentService {
  private judges = new Map<string, JudgeRecord>();
  private assignments = new Map<string, JudgeAssignment>();
  private evaluations = new Map<string, HumanJudgeEvaluation>();
  private storageKeyJudges = 'proofly_judges';
  private storageKeyAssignments = 'proofly_judge_assignments';
  private storageKeyEvaluations = 'proofly_human_evaluations';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    purgeLegacySampleStorageOnce();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const storedJudges = localStorage.getItem(this.storageKeyJudges);
        if (storedJudges) {
          const list: JudgeRecord[] = JSON.parse(storedJudges);
          list.forEach((j) => this.judges.set(j.id, j));
        }

        const storedAssignments = localStorage.getItem(this.storageKeyAssignments);
        if (storedAssignments) {
          const list: JudgeAssignment[] = JSON.parse(storedAssignments);
          list.forEach((a) => this.assignments.set(a.id, a));
        }

        const storedEvaluations = localStorage.getItem(this.storageKeyEvaluations);
        if (storedEvaluations) {
          const list: HumanJudgeEvaluation[] = JSON.parse(storedEvaluations);
          list.forEach((e) => this.evaluations.set(e.id, e));
        }
      }
    } catch (e) {
      console.warn('Could not read judge assignment cache from localStorage:', e);
    }
  }

  private saveToStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(this.storageKeyJudges, JSON.stringify(Array.from(this.judges.values())));
        localStorage.setItem(this.storageKeyAssignments, JSON.stringify(Array.from(this.assignments.values())));
        localStorage.setItem(this.storageKeyEvaluations, JSON.stringify(Array.from(this.evaluations.values())));
      }
    } catch (e) {
      console.warn('Could not persist judge assignment cache to localStorage:', e);
    }
  }

  // ─────────────────────────────────────────────
  // 1. JUDGE MANAGEMENT
  // ─────────────────────────────────────────────

  public async listJudges(competitionId?: string): Promise<JudgeRecord[]> {
    const all = Array.from(this.judges.values());
    if (!competitionId || competitionId === 'ALL') {
      return all;
    }
    return all.filter((j) => j.competitionIds.includes(competitionId));
  }

  public async getJudge(judgeId: string): Promise<JudgeRecord | null> {
    return this.judges.get(judgeId) || null;
  }

  public async getJudgeByEmail(email: string): Promise<JudgeRecord | null> {
    const lower = email.toLowerCase().trim();
    for (const j of this.judges.values()) {
      if (j.email.toLowerCase().trim() === lower) {
        return j;
      }
    }
    return null;
  }

  public async addJudge(judgeData: Omit<JudgeRecord, 'id'> & { id?: string }): Promise<JudgeRecord> {
    const id = judgeData.id || `judge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const judge: JudgeRecord = {
      ...judgeData,
      id,
      status: judgeData.status || 'ACTIVE',
      assignedTracks: judgeData.assignedTracks || ['General'],
      competitionIds: judgeData.competitionIds || ['comp-default-ai'],
      maxQuota: judgeData.maxQuota || 10,
    };
    this.judges.set(id, judge);
    this.saveToStorage();
    return judge;
  }

  public async inviteJudge(params: {
    name: string;
    email: string;
    title?: string;
    organization?: string;
    assignedTracks?: string[];
    competitionIds?: string[];
    maxQuota?: number;
  }): Promise<JudgeRecord> {
    const existing = await this.getJudgeByEmail(params.email);
    if (existing) {
      // Update existing record
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
      this.judges.set(existing.id, updated);
      this.saveToStorage();
      return updated;
    }

    const newJudge: JudgeRecord = {
      id: `judge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: params.name,
      email: params.email,
      title: params.title || 'Domain Specialist',
      organization: params.organization || 'External Evaluation Panel',
      assignedTracks: params.assignedTracks && params.assignedTracks.length > 0 ? params.assignedTracks : ['General'],
      competitionIds: params.competitionIds && params.competitionIds.length > 0 ? params.competitionIds : ['comp-default-ai'],
      maxQuota: params.maxQuota || 8,
      status: 'INVITED',
      invitedAt: new Date().toISOString(),
    };
    this.judges.set(newJudge.id, newJudge);
    this.saveToStorage();
    return newJudge;
  }

  public async updateJudge(judgeId: string, updates: Partial<JudgeRecord>): Promise<JudgeRecord> {
    const existing = this.judges.get(judgeId);
    if (!existing) {
      throw new Error(`Judge with ID "${judgeId}" not found.`);
    }
    const updated = { ...existing, ...updates };
    this.judges.set(judgeId, updated);
    this.saveToStorage();
    return updated;
  }

  // ─────────────────────────────────────────────
  // 2. ASSIGNMENTS & REASSIGNMENT
  // ─────────────────────────────────────────────

  public async assignSubmission(params: {
    competitionId: string;
    roundId?: string;
    submissionId: string;
    referenceId?: string;
    projectTitle?: string;
    track?: string;
    judgeId: string;
    assignedBy: string;
    assignedByName: string;
    deadline?: string;
  }): Promise<JudgeAssignment> {
    const judge = await this.getJudge(params.judgeId);
    if (!judge) {
      throw new Error(`Cannot assign: Judge with ID "${params.judgeId}" not found.`);
    }

    // Check if assignment already exists
    const existing = Array.from(this.assignments.values()).find(
      (a) => a.submissionId === params.submissionId && a.judgeId === params.judgeId
    );

    if (existing) {
      if (existing.status === 'CONFLICT') {
        throw new Error(`Cannot assign: Judge "${judge.name}" previously declared a conflict of interest on this submission.`);
      }
      return existing;
    }

    const id = `asgn-${params.submissionId}-${params.judgeId}`;
    const assignment: JudgeAssignment = {
      id,
      competitionId: params.competitionId,
      roundId: params.roundId,
      submissionId: params.submissionId,
      referenceId: params.referenceId || params.submissionId,
      projectTitle: params.projectTitle || 'Project Submission',
      track: params.track || 'General',
      judgeId: judge.id,
      judgeName: judge.name,
      judgeEmail: judge.email,
      assignedBy: params.assignedBy,
      assignedByName: params.assignedByName,
      assignedAt: new Date().toISOString(),
      deadline: params.deadline,
      status: 'PENDING',
      reassignmentHistory: [],
    };

    this.assignments.set(id, assignment);
    this.saveToStorage();

    governanceAuditService.recordEvent({
      competitionId: assignment.competitionId,
      category: 'ASSIGNMENT_CHANGE',
      action: 'SUBMISSION_ASSIGNED_TO_JUDGE',
      actorId: params.assignedBy,
      actorName: params.assignedByName,
      actorRole: 'ORGANIZER',
      targetId: assignment.submissionId,
      targetLabel: assignment.projectTitle,
      reason: `Assigned submission ${assignment.referenceId} to judge ${judge.name}.`,
      metadata: {
        assignmentId: assignment.id,
        judgeId: judge.id,
        judgeName: judge.name,
        roundId: assignment.roundId,
      },
    });

    return assignment;
  }

  public async batchAssignSubmissions(params: {
    competitionId: string;
    submissionIds: string[];
    judgeId: string;
    assignedBy: string;
    assignedByName: string;
    deadline?: string;
  }): Promise<JudgeAssignment[]> {
    const results: JudgeAssignment[] = [];
    for (const subId of params.submissionIds) {
      const sub = await submissionService.getSubmission(subId);
      const asgn = await this.assignSubmission({
        competitionId: params.competitionId,
        submissionId: subId,
        referenceId: sub?.referenceId || subId,
        projectTitle: sub?.projectTitle || 'Project Submission',
        track: sub?.track,
        judgeId: params.judgeId,
        assignedBy: params.assignedBy,
        assignedByName: params.assignedByName,
        deadline: params.deadline,
      });
      results.push(asgn);
    }
    return results;
  }

  public async reassignSubmission(
    assignmentId: string,
    newJudgeId: string,
    reassignedBy: string,
    reassignedByName: string,
    reason: string
  ): Promise<JudgeAssignment> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment with ID "${assignmentId}" not found.`);
    }

    const newJudge = await this.getJudge(newJudgeId);
    if (!newJudge) {
      throw new Error(`New judge with ID "${newJudgeId}" not found.`);
    }

    if (!reason || reason.trim().length < 5) {
      throw new Error('A documented reassignment reason (at least 5 characters) is required.');
    }

    const auditEntry: ReassignmentAudit = {
      previousJudgeId: assignment.judgeId,
      previousJudgeName: assignment.judgeName,
      newJudgeId: newJudge.id,
      newJudgeName: newJudge.name,
      reassignedBy,
      reassignedByName,
      reassignedAt: new Date().toISOString(),
      reason: reason.trim(),
    };

    assignment.reassignmentHistory.push(auditEntry);
    assignment.judgeId = newJudge.id;
    assignment.judgeName = newJudge.name;
    assignment.judgeEmail = newJudge.email;
    assignment.status = 'PENDING';
    assignment.conflict = undefined;
    assignment.updatedAt = new Date().toISOString();

    this.assignments.set(assignmentId, assignment);
    this.saveToStorage();

    governanceAuditService.recordEvent({
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

  public async listAssignments(filter?: {
    judgeId?: string;
    judgeEmail?: string;
    submissionId?: string;
    competitionId?: string;
    status?: JudgeAssignmentStatus;
  }): Promise<JudgeAssignment[]> {
    let list = Array.from(this.assignments.values());

    if (filter) {
      if (filter.judgeId) {
        list = list.filter((a) => a.judgeId === filter.judgeId);
      }
      if (filter.judgeEmail) {
        const lower = filter.judgeEmail.toLowerCase().trim();
        list = list.filter((a) => a.judgeEmail.toLowerCase().trim() === lower);
      }
      if (filter.submissionId) {
        list = list.filter((a) => a.submissionId === filter.submissionId);
      }
      if (filter.competitionId && filter.competitionId !== 'ALL') {
        list = list.filter((a) => a.competitionId === filter.competitionId);
      }
      if (filter.status) {
        list = list.filter((a) => a.status === filter.status);
      }
    }

    return list;
  }

  public async getAssignment(assignmentId: string): Promise<JudgeAssignment | null> {
    return this.assignments.get(assignmentId) || null;
  }

  public async getAssignmentForSubmissionAndJudge(submissionId: string, judgeId: string): Promise<JudgeAssignment | null> {
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

  public async declareConflictOfInterest(params: {
    assignmentId: string;
    judgeId: string;
    judgeName: string;
    conflictType: ConflictType;
    reason: string;
  }): Promise<JudgeAssignment> {
    const assignment = this.assignments.get(params.assignmentId);
    if (!assignment) {
      throw new Error(`Assignment with ID "${params.assignmentId}" not found.`);
    }

    if (!params.reason || params.reason.trim().length < 5) {
      throw new Error('A detailed reason is required when declaring a conflict of interest.');
    }

    const declaration: ConflictDeclaration = {
      declaredByJudgeId: params.judgeId,
      declaredByJudgeName: params.judgeName,
      declaredAt: new Date().toISOString(),
      conflictType: params.conflictType,
      reason: params.reason.trim(),
    };

    assignment.status = 'CONFLICT';
    assignment.conflict = declaration;
    assignment.updatedAt = new Date().toISOString();

    this.assignments.set(params.assignmentId, assignment);
    this.saveToStorage();
    return assignment;
  }

  // ─────────────────────────────────────────────
  // 4. JUDGE WORKLOAD & METRICS
  // ─────────────────────────────────────────────

  public async getJudgeWorkload(competitionId?: string): Promise<JudgeWorkloadSummary[]> {
    const judges = await this.listJudges(competitionId);
    const allAssignments = await this.listAssignments({ competitionId });

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
  // 5. HUMAN JUDGE EVALUATION & IMMUTABILITY
  // ─────────────────────────────────────────────

  /**
   * Generates a unique key for an evaluation by submission + judge
   */
  private makeEvalKey(submissionId: string, judgeId: string): string {
    return `heval_${submissionId}_${judgeId}`;
  }

  /**
   * Saves an in-progress draft evaluation.
   */
  public async saveEvaluationDraft(payload: {
    submissionId: string;
    referenceId: string;
    competitionId: string;
    roundId?: string;
    judgeId: string;
    judgeName: string;
    judgeEmail: string;
    decisionMode: 'AGREE' | 'MODIFY' | 'REJECT';
    scores: Record<string, number>;
    totalScore: number;
    aiTotalScore: number;
    criterionDifferences: Record<string, CriterionComparisonDetail>;
    deductionNotes: string;
    privateNotes?: string;
    assignmentId?: string;
  }): Promise<HumanJudgeEvaluation> {
    const key = this.makeEvalKey(payload.submissionId, payload.judgeId);
    const existing = this.evaluations.get(key);

    // IMMUTABILITY CHECK
    if (existing && existing.isLocked) {
      throw new Error(
        'Cannot modify this evaluation: It has been submitted and locked. Reopening requires organizer authorization and a logged audit reason.'
      );
    }

    const now = new Date().toISOString();
    const evaluation: HumanJudgeEvaluation = {
      id: existing ? existing.id : key,
      assignmentId: payload.assignmentId,
      submissionId: payload.submissionId,
      referenceId: payload.referenceId,
      competitionId: payload.competitionId,
      roundId: payload.roundId,
      judgeId: payload.judgeId,
      judgeName: payload.judgeName,
      judgeEmail: payload.judgeEmail,
      decisionMode: payload.decisionMode,
      scores: payload.scores,
      totalScore: payload.totalScore,
      aiTotalScore: payload.aiTotalScore,
      scoreDifference: payload.totalScore - payload.aiTotalScore,
      criterionDifferences: payload.criterionDifferences,
      deductionNotes: payload.deductionNotes,
      privateNotes: payload.privateNotes,
      status: 'DRAFT',
      isLocked: false,
      savedAsDraftAt: now,
      reopenHistory: existing ? existing.reopenHistory : [],
      evaluatorVersion: (existing?.evaluatorVersion || 0) + 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.evaluations.set(key, evaluation);

    // Update assignment status to IN_PROGRESS if currently PENDING
    const asgn = await this.getAssignmentForSubmissionAndJudge(payload.submissionId, payload.judgeId);
    if (asgn && asgn.status === 'PENDING') {
      asgn.status = 'IN_PROGRESS';
      asgn.updatedAt = now;
      this.assignments.set(asgn.id, asgn);
    }

    // Update submission status to Under Human Review if currently Ready for Judge Review
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

    this.saveToStorage();
    return evaluation;
  }

  /**
   * Finalizes and submits official human judge evaluation.
   * LOCKS the evaluation against silent modifications.
   */
  public async submitFinalEvaluation(payload: {
    submissionId: string;
    referenceId: string;
    competitionId: string;
    roundId?: string;
    judgeId: string;
    judgeName: string;
    judgeEmail: string;
    decisionMode: 'AGREE' | 'MODIFY' | 'REJECT';
    scores: Record<string, number>;
    totalScore: number;
    aiTotalScore: number;
    criterionDifferences: Record<string, CriterionComparisonDetail>;
    deductionNotes: string;
    privateNotes?: string;
    assignmentId?: string;
  }): Promise<HumanJudgeEvaluation> {
    const key = this.makeEvalKey(payload.submissionId, payload.judgeId);
    const existing = this.evaluations.get(key);

    // IMMUTABILITY CHECK
    if (existing && existing.isLocked) {
      throw new Error(
        'Evaluation is already finalized and locked. Changes require explicit organizer authorization.'
      );
    }

    // Require deduction notes if modified or rejected
    if (payload.decisionMode !== 'AGREE' && (!payload.deductionNotes || payload.deductionNotes.trim().length < 5)) {
      throw new Error('Deduction rationale and score modification justification are required when modifying or rejecting AI scores.');
    }

    const now = new Date().toISOString();
    const finalEvaluation: HumanJudgeEvaluation = {
      id: existing ? existing.id : key,
      assignmentId: payload.assignmentId,
      submissionId: payload.submissionId,
      referenceId: payload.referenceId,
      competitionId: payload.competitionId,
      roundId: payload.roundId,
      judgeId: payload.judgeId,
      judgeName: payload.judgeName,
      judgeEmail: payload.judgeEmail,
      decisionMode: payload.decisionMode,
      scores: payload.scores,
      totalScore: payload.totalScore,
      aiTotalScore: payload.aiTotalScore,
      scoreDifference: payload.totalScore - payload.aiTotalScore,
      criterionDifferences: payload.criterionDifferences,
      deductionNotes: payload.deductionNotes,
      privateNotes: payload.privateNotes,
      status: 'SUBMITTED',
      isLocked: true, // IMMUTABLE LOCK
      submittedAt: now,
      reopenHistory: existing ? existing.reopenHistory : [],
      evaluatorVersion: (existing?.evaluatorVersion || 0) + 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.evaluations.set(key, finalEvaluation);

    // Update assignment status to COMPLETED
    const asgn = await this.getAssignmentForSubmissionAndJudge(payload.submissionId, payload.judgeId);
    if (asgn) {
      asgn.status = 'COMPLETED';
      asgn.completedAt = now;
      asgn.updatedAt = now;
      this.assignments.set(asgn.id, asgn);
    }

    // Check if submission itself should transition to 'Evaluated'
    // A submission is 'Evaluated' if at least one judge has submitted or all active assigned judges have completed
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

    this.saveToStorage();

    // Append immutable criterion-level HUMAN score contributions to the Scoring Ledger
    const scoreEntries = Object.entries(payload.scores || {});
    if (scoreEntries.length > 0) {
      for (const [criterionId, scoreValue] of scoreEntries) {
        const detail = payload.criterionDifferences?.[criterionId];
        const maxScore = Math.max(detail?.maxScore || 25, scoreValue || 1);
        scoringLedgerService.appendContribution({
          competitionId: payload.competitionId,
          entryId: payload.submissionId,
          referenceId: payload.referenceId,
          evaluationId: finalEvaluation.id,
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

    // Record Governance Audit event for Evaluation Submission
    governanceAuditService.recordEvent({
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
  public async reopenEvaluation(params: {
    evaluationId: string;
    organizerUserId: string;
    organizerName: string;
    auditReason: string;
  }): Promise<HumanJudgeEvaluation> {
    if (!params.auditReason || params.auditReason.trim().length < 5) {
      throw new Error('A detailed audit justification (at least 5 characters) is required to reopen an evaluation.');
    }

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

    const now = new Date().toISOString();
    targetEval.isLocked = false;
    targetEval.status = 'DRAFT';
    targetEval.updatedAt = now;
    targetEval.reopenHistory.push({
      reopenedBy: params.organizerUserId,
      reopenedByName: params.organizerName,
      reopenedAt: now,
      auditReason: params.auditReason.trim(),
    });

    // Also update assignment status back to IN_PROGRESS
    const asgn = await this.getAssignmentForSubmissionAndJudge(targetEval.submissionId, targetEval.judgeId);
    if (asgn) {
      asgn.status = 'IN_PROGRESS';
      asgn.updatedAt = now;
      this.assignments.set(asgn.id, asgn);
    }

    // Update submission lifecycle status back to Under Human Review if previously Evaluated
    const sub = await submissionService.getSubmission(targetEval.submissionId);
    if (sub && sub.status === 'Evaluated') {
      const trans = submissionLifecycleService.transitionStatus(
        sub,
        'Under Human Review',
        { id: params.organizerUserId },
        `Evaluation reopened by organizer ${params.organizerName}. Audit Reason: ${params.auditReason.trim()}`
      );
      if (trans.updatedSubmission) {
        await submissionService.saveSubmission(trans.updatedSubmission);
      }
    }

    this.saveToStorage();

    governanceAuditService.recordEvent({
      competitionId: targetEval.competitionId,
      category: 'REOPENED_EVALUATION',
      action: 'EVALUATION_REOPENED_BY_ORGANIZER',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      actorRole: 'ORGANIZER',
      targetId: targetEval.submissionId,
      targetLabel: targetEval.referenceId,
      reason: params.auditReason.trim(),
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
  public async flagConcern(params: {
    submissionId: string;
    judgeId: string;
    judgeName: string;
    category: FlaggedConcern['category'];
    explanation: string;
  }): Promise<void> {
    if (!params.explanation || params.explanation.trim().length < 5) {
      throw new Error('A detailed explanation is required to flag a concern.');
    }

    const key = this.makeEvalKey(params.submissionId, params.judgeId);
    const existing = this.evaluations.get(key);

    const flagged: FlaggedConcern = {
      flagged: true,
      category: params.category,
      explanation: params.explanation.trim(),
      flaggedAt: new Date().toISOString(),
      flaggedByJudgeId: params.judgeId,
      flaggedByJudgeName: params.judgeName,
    };

    if (existing) {
      existing.flaggedConcern = flagged;
      existing.updatedAt = new Date().toISOString();
      this.evaluations.set(key, existing);
    } else {
      const now = new Date().toISOString();
      const draftEval: HumanJudgeEvaluation = {
        id: key,
        submissionId: params.submissionId,
        referenceId: params.submissionId,
        competitionId: 'comp-default-ai',
        judgeId: params.judgeId,
        judgeName: params.judgeName,
        judgeEmail: '',
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

    this.saveToStorage();
  }

  /**
   * Retrieves an evaluation for a specific submission and judge.
   */
  public async getEvaluation(submissionId: string, judgeId: string): Promise<HumanJudgeEvaluation | null> {
    const key = this.makeEvalKey(submissionId, judgeId);
    return this.evaluations.get(key) || null;
  }

  /**
   * Lists evaluations for a submission with strict privacy controls:
   * "Do not expose other judges' draft scores unless the organizer explicitly configures that behavior."
   */
  public async listEvaluationsForSubmission(
    submissionId: string,
    requestingJudgeId?: string,
    isOrganizer: boolean = false
  ): Promise<HumanJudgeEvaluation[]> {
    const all = Array.from(this.evaluations.values()).filter((e) => e.submissionId === submissionId);

    if (isOrganizer) {
      return all; // Organizers see all evaluations
    }

    // If a judge is requesting:
    return all.filter((e) => {
      // Always allow viewing own evaluation (draft or submitted)
      if (requestingJudgeId && e.judgeId === requestingJudgeId) {
        return true;
      }
      // Never expose other judges' drafts! Only show other judges if submitted!
      return e.status === 'SUBMITTED';
    });
  }

  /**
   * Lists all evaluations completed or drafted by a specific judge.
   */
  public async listEvaluationsByJudge(judgeId: string): Promise<HumanJudgeEvaluation[]> {
    return Array.from(this.evaluations.values()).filter((e) => e.judgeId === judgeId);
  }

  /**
   * Lists all evaluations across a competition (for organizer scoring, results & analytics).
   */
  public async listAllEvaluations(competitionId?: string): Promise<HumanJudgeEvaluation[]> {
    const all = Array.from(this.evaluations.values());
    if (!competitionId) return all;
    return all.filter((e) => e.competitionId === competitionId);
  }

  /**
   * Resets local storage for unit testing purposes.
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
