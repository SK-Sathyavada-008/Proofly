// ─────────────────────────────────────────────
// appealService.ts — Phase 14 Participant Feedback & Evaluation Appeals Service
// Proofly — Secure Feedback Release, Criterion Appeals Workflow & Append-Only Score Adjustments
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
} from './firestorePersistenceService';
import { submissionService } from './submissionService';
import { competitionService } from './competitionService';
import { resultsAndAnalyticsService } from './resultsAndAnalyticsService';
import { judgeAssignmentService } from './judgeAssignmentService';
import { scoringLedgerService } from './scoringLedgerService';
import { governanceAuditService } from './governanceAuditService';
import { notificationService } from './notificationService';
import type { ProjectSubmission } from '../types/submission';
import type { RubricCriterion } from '../types/authAndCompetition';
import type {
  AppealAuditEntry,
  AppealInformationRequest,
  AppealScoreAdjustment,
  AppealStatus,
  CompetitionAnnouncement,
  EvaluationAppeal,
  ParticipantReleasedFeedback,
  ReleasedAiAssessment,
  ReleasedCriterionFeedback,
  ResolveAppealPayload,
  SubmitAppealPayload,
} from '../types/appealsAndNotifications';

export class AppealService {
  // In-memory cache for unit tests and offline environments
  private inMemoryAppeals = new Map<string, EvaluationAppeal>();
  private inMemoryAnnouncements = new Map<string, CompetitionAnnouncement[]>();

  public resetInMemoryState(): void {
    this.inMemoryAppeals.clear();
    this.inMemoryAnnouncements.clear();
  }

  // ─────────────────────────────────────────────────────────────────
  // 1. PARTICIPANT FEEDBACK RETRIEVAL
  // ─────────────────────────────────────────────────────────────────

  /**
   * Safe participant feedback access.
   * STRICT SECURITY RULE:
   * If results are unreleased, official scores, judge scores, and private deliberations
   * are STRICTLY WITHHELD. Only submission status and competition announcements are returned.
   */
  public async getParticipantFeedback(
    submissionOrId: string | ProjectSubmission,
    authContext?: {
      token?: string;
      participantId?: string;
      isOrganizer?: boolean;
    },
    options?: FirestoreExecutionOptions
  ): Promise<ParticipantReleasedFeedback> {
    const sub =
      typeof submissionOrId === 'string'
        ? await submissionService.getSubmission(submissionOrId, options)
        : submissionOrId;

    if (!sub) {
      throw new Error('Submission not found.');
    }

    // Verify participant authorization if token is provided
    if (authContext?.token) {
      const isValid = await submissionService.verifyManagementToken(sub.referenceId, authContext.token);
      if (!isValid && !authContext.isOrganizer) {
        throw new Error('Access denied: Invalid management token.');
      }
    }

    const comp = await competitionService.getCompetition(sub.competitionId, options);
    const announcements = await this.listAnnouncements(sub.competitionId, options);
    const existingAppeals = await this.listAppealsForSubmission(sub.id, options);

    // 1. Check if official results or feedback are released
    let isReleased = false;
    let releasedAt: string | undefined;
    let publishedScore: number | null = null;
    let maxPossibleScore = 100;
    let percentageScore: number | null = null;
    let criterionFeedback: ReleasedCriterionFeedback[] = [];
    let publishedAiAssessment: ReleasedAiAssessment | undefined;

    // Check official publication record
    let pubRecord = null;
    try {
      pubRecord =
        (await resultsAndAnalyticsService.getPublicationStatusFromFirestore(sub.competitionId, options)) ||
        resultsAndAnalyticsService.getPublicationStatus(sub.competitionId);
    } catch {
      // Publication may not exist yet
    }

    if (pubRecord && pubRecord.status === 'PUBLISHED') {
      isReleased = true;
      releasedAt = pubRecord.publishedAt;
    } else if (comp && (comp as any).resultsPublished === true) {
      isReleased = true;
      releasedAt = (comp as any).resultsPublishedAt || new Date().toISOString();
    }

    // If results are NOT released, return scrubbed unreleased status
    if (!isReleased) {
      return {
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        competitionId: sub.competitionId,
        competitionTitle: comp?.title || 'Competition',
        isResultsReleased: false,
        submissionStatus: sub.status,
        publishedScore: null,
        maxPossibleScore: 100,
        percentageScore: null,
        criterionFeedback: [],
        announcements,
        existingAppealsCount: existingAppeals.length,
      };
    }

    // 2. Compile released feedback when publication is active
    if (pubRecord && pubRecord.entries) {
      const publishedEntry = pubRecord.entries.find(
        (e) => e.submissionId === sub.id || e.referenceId === sub.referenceId
      );

      if (publishedEntry) {
        publishedScore = publishedEntry.officialScore;
        maxPossibleScore = publishedEntry.maxPossibleScore || 100;
        percentageScore = publishedEntry.percentageScore;

        // Populate criterion summaries from published snapshot
        if (publishedEntry.criterionSummaries) {
          criterionFeedback = Object.values(publishedEntry.criterionSummaries).map((crit) => ({
            criterionId: crit.criterionId,
            criterionName: crit.criterionName,
            maxScore: crit.maxScore,
            awardedScore: crit.averageScore,
            weight: crit.weight,
            releasedComments: (crit as any).judgeComments || [],
            releasedEvidenceReferences: [],
          }));
        }
      }
    }

    // If criterionFeedback wasn't in snapshot, load from completed human evaluations
    const compRubric: RubricCriterion[] = (comp as any)?.rubricCriteria || comp?.rubric || [];
    if (criterionFeedback.length === 0 && comp && compRubric.length > 0) {
      const evaluations = await judgeAssignmentService.listEvaluationsForSubmission(sub.id, undefined, true);

      criterionFeedback = compRubric.map((crit) => {
        const scoresForCrit = evaluations
          .map((e) => e.scores?.[crit.id])
          .filter((s): s is number => typeof s === 'number');

        const avgScore =
          scoresForCrit.length > 0
            ? Math.round((scoresForCrit.reduce((a, b) => a + b, 0) / scoresForCrit.length) * 10) / 10
            : 0;

        // Released judge comments (exclude internal private deliberations)
        const comments = evaluations
          .map((e) => e.criterionComments?.[crit.id])
          .filter((c): c is string => Boolean(c && c.trim().length > 0));

        return {
          criterionId: crit.id,
          criterionName: crit.name || (crit as any).title,
          maxScore: crit.maxScore || 25,
          awardedScore: avgScore,
          weight: crit.weight,
          releasedComments: comments,
        };
      });

      if (publishedScore === null && criterionFeedback.length > 0) {
        publishedScore = criterionFeedback.reduce((acc, c) => acc + c.awardedScore, 0);
        maxPossibleScore = criterionFeedback.reduce((acc, c) => acc + c.maxScore, 0);
        percentageScore = maxPossibleScore > 0 ? Math.round((publishedScore / maxPossibleScore) * 100) : 0;
      }
    }

    // Published AI Assessment (only if explicitly enabled on competition)
    const subAny = sub as any;
    if (comp && (comp as any).includeAiInPublishedFeedback && subAny.aiEvaluation) {
      publishedAiAssessment = {
        summary: subAny.aiEvaluation.executiveSummary || 'Automated rubric evaluation.',
        score: subAny.aiScore || 0,
        strengths: subAny.aiEvaluation.strengths || [],
        improvementAreas: subAny.aiEvaluation.deductionNotes ? [subAny.aiEvaluation.deductionNotes] : [],
        disclaimer: 'AI assessment is automated guidance and does not replace human panel evaluation.',
      };
    }

    return {
      submissionId: sub.id,
      referenceId: sub.referenceId,
      projectTitle: sub.projectTitle,
      competitionId: sub.competitionId,
      competitionTitle: comp?.title || 'Competition',
      isResultsReleased: true,
      releasedAt,
      submissionStatus: sub.status,
      publishedScore,
      maxPossibleScore,
      percentageScore,
      criterionFeedback,
      publishedAiAssessment,
      announcements,
      existingAppealsCount: existingAppeals.length,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. SUBMITTING AN APPEAL
  // ─────────────────────────────────────────────────────────────────

  public async submitAppeal(
    payload: SubmitAppealPayload,
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal> {
    if (!payload.submissionId || !payload.submissionId.trim()) {
      throw new Error('Submission ID is required to submit an appeal.');
    }
    if (!payload.criterionId || !payload.criterionId.trim()) {
      throw new Error('Specific criterion ID must be selected for the appeal.');
    }
    if (!payload.reason) {
      throw new Error('Appeal reason category must be specified.');
    }
    if (!payload.supportingExplanation || payload.supportingExplanation.trim().length < 10) {
      throw new Error('Detailed supporting explanation (minimum 10 characters) is required.');
    }

    // 1. Verify Submission
    const sub = await submissionService.getSubmission(payload.submissionId, options);
    if (!sub) {
      throw new Error(`Submission "${payload.submissionId}" was not found.`);
    }

    // 2. Verify Management Token if supplied
    if (payload.managementToken) {
      const valid = await submissionService.verifyManagementToken(sub.referenceId, payload.managementToken);
      if (!valid) {
        throw new Error('Access denied: Invalid management token.');
      }
    }

    // 3. Verify Competition Rubric contains Criterion
    const comp = await competitionService.getCompetition(sub.competitionId, options);
    const rubricItems: RubricCriterion[] = (comp as any)?.rubricCriteria || comp?.rubric || [];
    const criterion = rubricItems.find((c: any) => c.id === payload.criterionId);
    const criterionName = payload.criterionName || criterion?.name || (criterion as any)?.title || payload.criterionId;

    // 4. Duplicate Active Appeal Guard
    const existing = await this.listAppealsForSubmission(sub.id, options);
    const activeAppealForCriterion = existing.find(
      (a) =>
        a.criterionId === payload.criterionId &&
        (a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW' || a.status === 'NEEDS_INFORMATION')
    );
    if (activeAppealForCriterion) {
      throw new Error(
        `An active appeal (${activeAppealForCriterion.id}) already exists for criterion "${criterionName}". Please wait for organizer resolution.`
      );
    }

    const id = `appl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const auditEntry: AppealAuditEntry = {
      status: 'SUBMITTED',
      actorId: payload.participant.participantId || 'participant',
      actorName: payload.participant.participantName,
      actorRole: 'PARTICIPANT',
      timestamp: now,
      notes: 'Initial appeal submission.',
    };

    const appeal: EvaluationAppeal = {
      id,
      submissionId: sub.id,
      referenceId: sub.referenceId,
      competitionId: sub.competitionId,
      organizationId: payload.organizationId || comp?.organizationId || '',
      participant: payload.participant,
      criterionId: payload.criterionId,
      criterionName,
      reason: payload.reason,
      supportingExplanation: payload.supportingExplanation.trim(),
      evidenceReferences: payload.evidenceReferences || [],
      submittedAt: now,
      status: 'SUBMITTED',
      informationRequests: [],
      auditHistory: [auditEntry],
      updatedAt: now,
    };

    // Persist appeal
    this.inMemoryAppeals.set(id, appeal);

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'appeals', id);
        await setDoc(ref, withServerTimestamps(sanitizeFirestoreData(appeal), true));
      } catch (err) {
        throw mapFirestoreError(err, 'submitAppeal', 'appeals');
      }
    }

    // Notify organizers regarding new appeal
    try {
      await notificationService.notifyAppealStatusChange({
        recipientId: (comp as any)?.ownerId || comp?.organizationId || 'organizer',
        recipientRole: 'ORGANIZER',
        appealId: id,
        referenceId: sub.referenceId,
        criterionName,
        newStatus: 'SUBMITTED',
        notes: `New appeal submitted by ${payload.participant.participantName}.`,
        competitionId: sub.competitionId,
        competitionTitle: comp?.title || 'Competition',
      });
    } catch {
      // Non-blocking notification dispatch
    }

    return appeal;
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. RETRIEVAL & QUERYING
  // ─────────────────────────────────────────────────────────────────

  public async getAppealById(
    appealId: string,
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'appeals', appealId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          return snap.data() as EvaluationAppeal;
        }
      } catch (err) {
        throw mapFirestoreError(err, 'getAppealById', 'appeals');
      }
    }
    return this.inMemoryAppeals.get(appealId) || null;
  }

  public async listAppealsForCompetition(
    competitionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(collection(fs, 'appeals'), where('competitionId', '==', competitionId));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => d.data() as EvaluationAppeal);
        list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
        return list;
      } catch (err) {
        // Fall back to in-memory
      }
    }

    return Array.from(this.inMemoryAppeals.values())
      .filter((a) => a.competitionId === competitionId)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  public async listAppealsForSubmission(
    submissionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(collection(fs, 'appeals'), where('submissionId', '==', submissionId));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => d.data() as EvaluationAppeal);
        list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
        return list;
      } catch (err) {
        // Fall back to in-memory
      }
    }

    return Array.from(this.inMemoryAppeals.values())
      .filter((a) => a.submissionId === submissionId)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. ORGANIZER REVIEW WORKFLOW
  // ─────────────────────────────────────────────────────────────────

  /**
   * Assigns an appeal reviewer. Moves status to UNDER_REVIEW.
   */
  public async assignAppealReviewer(
    appealId: string,
    reviewer: { id: string; name: string; role?: string },
    actor: { id: string; name: string; role: string },
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal> {
    const appeal = await this.getAppealById(appealId, options);
    if (!appeal) {
      throw new Error(`Appeal "${appealId}" was not found.`);
    }

    const now = new Date().toISOString();
    const newStatus: AppealStatus = appeal.status === 'SUBMITTED' ? 'UNDER_REVIEW' : appeal.status;

    const auditEntry: AppealAuditEntry = {
      status: newStatus,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      timestamp: now,
      notes: `Assigned reviewer: ${reviewer.name}.`,
    };

    const updated: EvaluationAppeal = {
      ...appeal,
      assignedReviewer: reviewer,
      status: newStatus,
      auditHistory: [...appeal.auditHistory, auditEntry],
      updatedAt: now,
    };

    await this.persistAppeal(updated, options);
    return updated;
  }

  /**
   * Organizer requests clarification or additional evidence from the participant.
   * Moves status to NEEDS_INFORMATION.
   */
  public async requestAppealInformation(
    appealId: string,
    question: string,
    actor: { id: string; name: string; role: string },
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal> {
    if (!question || question.trim().length < 5) {
      throw new Error('Clarification question is required.');
    }

    const appeal = await this.getAppealById(appealId, options);
    if (!appeal) {
      throw new Error(`Appeal "${appealId}" was not found.`);
    }

    const now = new Date().toISOString();
    const req: AppealInformationRequest = {
      id: `req_${Date.now()}`,
      question: question.trim(),
      requestedBy: actor.id,
      requestedByName: actor.name,
      requestedAt: now,
    };

    const auditEntry: AppealAuditEntry = {
      status: 'NEEDS_INFORMATION',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      timestamp: now,
      notes: `Requested more information: ${question.trim()}`,
    };

    const updated: EvaluationAppeal = {
      ...appeal,
      status: 'NEEDS_INFORMATION',
      informationRequests: [...appeal.informationRequests, req],
      auditHistory: [...appeal.auditHistory, auditEntry],
      updatedAt: now,
    };

    await this.persistAppeal(updated, options);

    // Notify participant that information is requested
    try {
      await notificationService.notifyAppealStatusChange({
        recipientId: appeal.participant.participantId || appeal.participant.participantEmail || appeal.submissionId,
        recipientEmail: appeal.participant.participantEmail,
        recipientRole: 'PARTICIPANT',
        appealId: appeal.id,
        referenceId: appeal.referenceId,
        criterionName: appeal.criterionName,
        newStatus: 'NEEDS_INFORMATION',
        notes: `The organizers have requested additional information: "${question.trim()}"`,
        competitionId: appeal.competitionId,
        competitionTitle: 'Competition',
      });
    } catch {
      // Non-blocking
    }

    return updated;
  }

  /**
   * Participant responds to an information request.
   * Moves status back to UNDER_REVIEW.
   */
  public async respondToInformationRequest(
    appealId: string,
    requestId: string,
    response: string,
    participant: { id?: string; name: string },
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal> {
    if (!response || response.trim().length < 5) {
      throw new Error('Response explanation is required.');
    }

    const appeal = await this.getAppealById(appealId, options);
    if (!appeal) {
      throw new Error(`Appeal "${appealId}" was not found.`);
    }

    const now = new Date().toISOString();
    const updatedRequests = appeal.informationRequests.map((req) => {
      if (req.id === requestId) {
        return {
          ...req,
          response: response.trim(),
          respondedAt: now,
        };
      }
      return req;
    });

    const auditEntry: AppealAuditEntry = {
      status: 'UNDER_REVIEW',
      actorId: participant.id || 'participant',
      actorName: participant.name,
      actorRole: 'PARTICIPANT',
      timestamp: now,
      notes: 'Participant provided requested information.',
    };

    const updated: EvaluationAppeal = {
      ...appeal,
      status: 'UNDER_REVIEW',
      informationRequests: updatedRequests,
      auditHistory: [...appeal.auditHistory, auditEntry],
      updatedAt: now,
    };

    await this.persistAppeal(updated, options);
    return updated;
  }

  /**
   * Participant or organizer withdraws the appeal.
   */
  public async withdrawAppeal(
    appealId: string,
    actor: { id: string; name: string; role: string },
    reason?: string,
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal> {
    const appeal = await this.getAppealById(appealId, options);
    if (!appeal) {
      throw new Error(`Appeal "${appealId}" was not found.`);
    }

    const now = new Date().toISOString();
    const auditEntry: AppealAuditEntry = {
      status: 'WITHDRAWN',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      timestamp: now,
      notes: reason ? `Appeal withdrawn: ${reason}` : 'Appeal withdrawn by user.',
    };

    const updated: EvaluationAppeal = {
      ...appeal,
      status: 'WITHDRAWN',
      auditHistory: [...appeal.auditHistory, auditEntry],
      updatedAt: now,
    };

    await this.persistAppeal(updated, options);
    return updated;
  }

  /**
   * Resolves an appeal (accept or reject).
   * STRICT GOVERNANCE RULE:
   * An appeal must NEVER directly or silently modify official scores.
   * If a score change is approved, it is routed through the append-only scoring ledger
   * (`scoringLedgerService.appendContributionDurable`) and recorded with immutable governance audit.
   */
  public async resolveAppeal(
    payload: ResolveAppealPayload,
    options?: FirestoreExecutionOptions
  ): Promise<EvaluationAppeal> {
    if (!payload.resolution || payload.resolution.trim().length < 5) {
      throw new Error('Written final resolution explanation is required.');
    }
    if (payload.resolver.role !== 'ORGANIZER' && payload.resolver.role !== 'ADMIN') {
      throw new Error('Only authorized organizers or administrators can resolve evaluation appeals.');
    }

    const appeal = await this.getAppealById(payload.appealId, options);
    if (!appeal) {
      throw new Error(`Appeal "${payload.appealId}" was not found.`);
    }

    const now = new Date().toISOString();
    const finalStatus: AppealStatus = payload.acceptAppeal ? 'RESOLVED' : 'REJECTED';

    let scoreAdjustmentRecord: AppealScoreAdjustment | undefined;

    // Process Score Adjustment if Appeal was Accepted with score change
    if (payload.acceptAppeal && payload.scoreAdjustment) {
      const adj = payload.scoreAdjustment;
      const comp = await competitionService.getCompetition(appeal.competitionId, options);
      const rubricItems: RubricCriterion[] = (comp as any)?.rubricCriteria || comp?.rubric || [];
      const criterion = rubricItems.find((c: any) => c.id === adj.criterionId);
      const maxScore = criterion?.maxScore || 25;

      if (adj.newScore < 0 || adj.newScore > maxScore) {
        throw new Error(`Adjusted score (${adj.newScore}) exceeds permissible range (0 - ${maxScore}).`);
      }

      // 1. Append immutable adjustment record to authoritative scoring ledger
      const ledgerEntry = await scoringLedgerService.appendContributionDurable({
        organizationId: appeal.organizationId || 'org-default',
        competitionId: appeal.competitionId,
        entryId: appeal.submissionId,
        referenceId: appeal.referenceId,
        evaluationId: `appeal_${appeal.id}`,
        criterionId: adj.criterionId,
        criterionName: appeal.criterionName,
        score: adj.newScore,
        maxScore,
        source: 'HUMAN',
        actorId: payload.resolver.id,
        actorName: payload.resolver.name,
        reasonForAdjustment: `Appeal Resolved (${appeal.id}): ${adj.reason || payload.resolution}`,
        isAdjustment: true,
        authorizedSource: 'ORGANIZER_AUTHORIZED_WORKFLOW',
      });

      scoreAdjustmentRecord = {
        applied: true,
        previousScore: 0,
        newScore: adj.newScore,
        scoreDelta: adj.newScore,
        criterionId: adj.criterionId,
        scoreLedgerEntryId: ledgerEntry.id,
        reasonForAdjustment: adj.reason || payload.resolution,
      };

      // 2. Record immutable governance audit event
      governanceAuditService.recordEvent({
        category: 'ADMIN_OVERRIDE',
        action: 'SCORE_OVERRIDDEN',
        actorId: payload.resolver.id,
        actorName: payload.resolver.name,
        actorRole: (payload.resolver.role as 'ORGANIZER' | 'JUDGE' | 'SYSTEM') || 'ORGANIZER',
        competitionId: appeal.competitionId,
        targetId: `appeal/${appeal.id}`,
        targetLabel: `Appeal ${appeal.id}`,
        reason: payload.resolution,
        metadata: {
          submissionId: appeal.submissionId,
          referenceId: appeal.referenceId,
          criterionId: adj.criterionId,
          newScore: adj.newScore,
          scoreLedgerEntryId: ledgerEntry.id,
        },
      });
    }

    const auditEntry: AppealAuditEntry = {
      status: finalStatus,
      actorId: payload.resolver.id,
      actorName: payload.resolver.name,
      actorRole: payload.resolver.role,
      timestamp: now,
      notes: `Appeal ${finalStatus}: ${payload.resolution.trim()}`,
    };

    const updated: EvaluationAppeal = {
      ...appeal,
      status: finalStatus,
      resolution: payload.resolution.trim(),
      resolver: payload.resolver,
      resolvedAt: now,
      scoreAdjustment: scoreAdjustmentRecord,
      auditHistory: [...appeal.auditHistory, auditEntry],
      updatedAt: now,
    };

    await this.persistAppeal(updated, options);

    // Notify participant of resolution
    try {
      await notificationService.notifyAppealStatusChange({
        recipientId: appeal.participant.participantId || appeal.participant.participantEmail || appeal.submissionId,
        recipientEmail: appeal.participant.participantEmail,
        recipientRole: 'PARTICIPANT',
        appealId: appeal.id,
        referenceId: appeal.referenceId,
        criterionName: appeal.criterionName,
        newStatus: finalStatus,
        notes: payload.resolution.trim(),
        competitionId: appeal.competitionId,
        competitionTitle: 'Competition',
      });
    } catch {
      // Non-blocking
    }

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. ANNOUNCEMENTS
  // ─────────────────────────────────────────────────────────────────

  public async createAnnouncement(
    params: {
      competitionId: string;
      title: string;
      content: string;
      authorName: string;
      isPinned?: boolean;
    },
    options?: FirestoreExecutionOptions
  ): Promise<CompetitionAnnouncement> {
    const id = `ann_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const announcement: CompetitionAnnouncement = {
      id,
      competitionId: params.competitionId,
      title: params.title.trim(),
      content: params.content.trim(),
      publishedAt: new Date().toISOString(),
      authorName: params.authorName,
      isPinned: params.isPinned,
    };

    const existing = this.inMemoryAnnouncements.get(params.competitionId) || [];
    this.inMemoryAnnouncements.set(params.competitionId, [announcement, ...existing]);

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'announcements', id);
        await setDoc(ref, withServerTimestamps(sanitizeFirestoreData(announcement), true));
      } catch (err) {
        throw mapFirestoreError(err, 'createAnnouncement', 'announcements');
      }
    }

    return announcement;
  }

  public async listAnnouncements(
    competitionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<CompetitionAnnouncement[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(collection(fs, 'announcements'), where('competitionId', '==', competitionId));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => d.data() as CompetitionAnnouncement);
        list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
        return list;
      } catch {
        // Fall back to in-memory
      }
    }

    return this.inMemoryAnnouncements.get(competitionId) || [];
  }

  // ─────────────────────────────────────────────────────────────────
  // PERSISTENCE HELPER
  // ─────────────────────────────────────────────────────────────────

  private async persistAppeal(
    appeal: EvaluationAppeal,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    this.inMemoryAppeals.set(appeal.id, appeal);

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'appeals', appeal.id);
        await setDoc(ref, withServerTimestamps(sanitizeFirestoreData(appeal), false), { merge: true });
      } catch (err) {
        throw mapFirestoreError(err, 'persistAppeal', 'appeals');
      }
    }
  }
}

export const appealService = new AppealService();
