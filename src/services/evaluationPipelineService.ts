// ─────────────────────────────────────────────
// evaluationPipelineService.ts — 9-Step AI Evaluation Pipeline
// Proofly / Evalora — Phase 6
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginationOptions,
} from './firestorePersistenceService';
import type { ProjectSubmission } from '../types/submission';
import type { Competition } from '../types/authAndCompetition';
import type {
  AiEvaluationReport,
  StructuredEvidencePacket,
  RubricVersion,
} from '../types/aiEvaluation';
import { contentExtractionService } from './contentExtractionService';
import { rubricEngineService } from './rubricEngineService';
import { aiLogicService } from './aiLogicService';
import { competitionService } from './competitionService';
import { submissionService } from './submissionService';
import { submissionLifecycleService } from './submissionLifecycleService';
import { scoringLedgerService } from './scoringLedgerService';
import { InferenceMode } from 'firebase/ai';

export interface PipelineExecutionResult {
  success: boolean;
  submission: ProjectSubmission;
  report?: AiEvaluationReport;
  error?: string;
  stepReached: number;
}

export class EvaluationPipelineService {
  private memReports: Map<string, AiEvaluationReport> = new Map();

  /**
   * Executes the full 9-step evaluation pipeline for a submission:
   * 1. Submission is received.
   * 2. Validate files and metadata.
   * 3. Extract supported document content.
   * 4. Prepare a structured evidence packet.
   * 5. Load the exact rubric version.
   * 6. Run AI evaluation using Firebase AI Logic.
   * 7. Validate the returned structured result.
   * 8. Save the evaluation report.
   * 9. Mark the submission ready for judge review.
   */
  public async executePipeline(
    submission: ProjectSubmission,
    competition?: Competition,
    mode: InferenceMode = InferenceMode.PREFER_ON_DEVICE
  ): Promise<PipelineExecutionResult> {
    let currentSubmission = submission;
    let stepReached = 1;

    try {
      // ── STEP 1: Submission is received ──
      stepReached = 1;
      if (!currentSubmission || !currentSubmission.id) {
        throw new Error('Step 1 Failed: Invalid or missing submission object.');
      }

      // Transition submission to 'AI Evaluation In Progress'
      const startTransition = submissionLifecycleService.transitionStatus(
        currentSubmission,
        'AI Evaluation In Progress',
        { id: 'system' },
        'Automated 9-step AI evaluation pipeline initiated'
      );
      if (startTransition.valid && startTransition.updatedSubmission) {
        currentSubmission = startTransition.updatedSubmission;
        await submissionService.saveSubmission(currentSubmission);
      }

      // ── STEP 2: Validate files and metadata ──
      stepReached = 2;
      const filesValid = (currentSubmission.files || []).every((f) => Boolean(f.id && f.fileName && f.mimeType));
      if (!filesValid) {
        throw new Error('Step 2 Failed: Corrupted or unverified file metadata detected in submission.');
      }

      // ── STEP 3 & 4: Extract supported document content & prepare structured evidence packet ──
      stepReached = 3;
      const evidencePacket: StructuredEvidencePacket = await contentExtractionService.extractSubmissionEvidence(
        currentSubmission
      );
      stepReached = 4;

      // ── STEP 5: Load the exact rubric version ──
      stepReached = 5;
      let comp = competition;
      if (!comp) {
        comp = (await competitionService.getCompetition(currentSubmission.competitionId)) || undefined;
      }
      if (!comp) {
        // Fallback default competition mock if running isolated test
        comp = {
          id: currentSubmission.competitionId,
          organizationId: currentSubmission.organizationId,
          title: 'AI Competition',
          slug: 'ai-competition',
          tagline: 'AI Evaluation',
          description: 'Competition for AI Evaluation',
          type: 'HACKATHON',
          visibility: 'PUBLIC',
          status: 'ACTIVE',
          participationType: 'BOTH',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86400000 * 7).toISOString(),
          evaluationDeadline: new Date(Date.now() + 86400000 * 10).toISOString(),
          publicAccessCode: 'EVAL-DEMO',
          rubric: [
            { id: 'crit-tech', name: 'Technical Execution', description: 'Architecture, code quality, and engineering viability', weight: 35, maxScore: 35 },
            { id: 'crit-impact', name: 'Potential Impact', description: 'Real-world utility and problem significance', weight: 35, maxScore: 35 },
            { id: 'crit-design', name: 'Design & Presentation', description: 'User experience and clarity of submission artifacts', weight: 30, maxScore: 30 },
          ],
          tracks: ['Healthcare & Edge AI', 'Autonomous Agents'],
          rounds: [],
          policies: {
            teamSubmissionsEnabled: true,
            minTeamMembers: 1,
            maxTeamMembers: 5,
            individualSubmissionsAllowed: true,
            submissionDeadline: new Date(Date.now() + 86400000).toISOString(),
            allowLateSubmissions: false,
            allowSubmissionEdits: true,
            aiEvaluationEnabled: true,
            judgeFeedbackVisibleToParticipants: true,
            aiScoresVisibleToParticipants: true,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const validComp: Competition = comp;
      const rubricVersion: RubricVersion = await rubricEngineService.getOrCreateRubricVersion(validComp);

      // ── STEP 6: Run AI evaluation using Firebase AI Logic ──
      stepReached = 6;
      const report = await aiLogicService.evaluateSubmissionEvidence(evidencePacket, rubricVersion, mode);

      // ── STEP 7: Validate the returned structured result ──
      stepReached = 7;
      if (!report || !report.criteriaEvaluations || report.criteriaEvaluations.length === 0) {
        throw new Error('Step 7 Failed: AI Logic did not return a valid criteria evaluation breakdown.');
      }

      for (const crit of report.criteriaEvaluations) {
        if (crit.suggestedScore < 0 || crit.suggestedScore > crit.maxScore) {
          throw new Error(`Step 7 Failed: Score for ${crit.criterionName} (${crit.suggestedScore}) exceeds max allowable score (${crit.maxScore}).`);
        }
      }

      // ── STEP 8: Save the evaluation report ──
      stepReached = 8;
      await this.saveEvaluationReport(report);

      // Append immutable AI pre-evaluation criterion contributions to Scoring Ledger
      for (const crit of report.criteriaEvaluations) {
        scoringLedgerService.appendContribution({
          competitionId: report.competitionId,
          entryId: report.submissionId,
          referenceId: report.referenceId,
          evaluationId: report.id,
          criterionId: crit.criterionId,
          criterionName: crit.criterionName,
          score: crit.suggestedScore,
          maxScore: crit.maxScore,
          source: 'AI',
          actorId: report.telemetry?.modelUsed || 'evalora-ai-logic',
          actorName: `AI Logic (${report.telemetry?.actualInferenceSource || 'HYBRID'})`,
          reasonForAdjustment:
            crit.exactDeductionExplanations?.[0] ||
            `Automated AI pre-evaluation under Rubric v${report.rubricVersion.versionNumber}`,
          authorizedSource: 'EVALUATION_PIPELINE',
        });
      }

      // ── STEP 9: Mark the submission ready for judge review ──
      stepReached = 9;
      // Pipeline transition: AI Evaluation In Progress -> AI Evaluation Complete
      const completeTransition = submissionLifecycleService.transitionStatus(
        currentSubmission,
        'AI Evaluation Complete',
        { id: 'system' },
        `AI Evaluation completed successfully with score ${report.overallScore}/${report.totalMaxScore}`
      );
      if (completeTransition.valid && completeTransition.updatedSubmission) {
        currentSubmission = completeTransition.updatedSubmission;
      }

      // Pipeline transition: AI Evaluation Complete -> Ready for Judge Review
      const readyTransition = submissionLifecycleService.transitionStatus(
        currentSubmission,
        'Ready for Judge Review',
        { id: 'system' },
        'Automated gate passed; submission unlocked for human judge review workspace'
      );
      if (readyTransition.valid && readyTransition.updatedSubmission) {
        currentSubmission = readyTransition.updatedSubmission;
      }

      // Attach AI metadata to submission
      currentSubmission.aiEvaluationId = report.id;
      currentSubmission.aiScore = report.overallScore;
      currentSubmission.aiCompletedAt = report.evaluatedAt;
      currentSubmission.updatedAt = new Date().toISOString();

      await submissionService.saveSubmission(currentSubmission);

      return {
        success: true,
        submission: currentSubmission,
        report,
        stepReached: 9,
      };
    } catch (err: any) {
      const errorMessage = err?.message || String(err);

      // Mark submission as 'AI Evaluation Failed'
      try {
        const failTransition = submissionLifecycleService.transitionStatus(
          currentSubmission,
          'AI Evaluation Failed',
          { id: 'system' },
          `AI Evaluation Pipeline failed at Step ${stepReached}: ${errorMessage}`
        );
        if (failTransition.valid && failTransition.updatedSubmission) {
          currentSubmission = failTransition.updatedSubmission;
          currentSubmission.updatedAt = new Date().toISOString();
          await submissionService.saveSubmission(currentSubmission);
        }
      } catch {
        // preserve original error
      }

      return {
        success: false,
        submission: currentSubmission,
        error: errorMessage,
        stepReached,
      };
    }
  }

  /**
   * Saves an AI Evaluation Report to memory and Firestore.
   */
  public async saveEvaluationReport(
    report: AiEvaluationReport,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(
          doc(fs, 'aiEvaluationReports', report.id),
          withServerTimestamps(sanitizeFirestoreData(report), true)
        );
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'saveEvaluationReport', 'aiEvaluationReports');
      }
    }

    this.memReports.set(report.id, report);
    this.memReports.set(`sub_${report.submissionId}`, report);
  }

  /**
   * Retrieves an AI Evaluation Report by report ID.
   */
  public async getEvaluationReport(
    reportId: string,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationReport | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'aiEvaluationReports', reportId));
        return snap.exists() ? (snap.data() as AiEvaluationReport) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getEvaluationReport', 'aiEvaluationReports');
      }
    }

    return this.memReports.get(reportId) || null;
  }

  /**
   * Retrieves an AI Evaluation Report for a given submission ID.
   */
  public async getReportBySubmissionId(
    submissionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationReport | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(
          collection(fs, 'aiEvaluationReports'),
          where('submissionId', '==', submissionId),
          limit(1)
        );
        const snaps = await getDocs(q);
        return snaps.empty ? null : (snaps.docs[0].data() as AiEvaluationReport);
      } catch (err) {
        console.warn('getReportBySubmissionId failed in Firestore, checking fallback:', err);
      }
    }

    const memoryKey = `sub_${submissionId}`;
    if (this.memReports.has(memoryKey)) {
      return this.memReports.get(memoryKey)!;
    }

    for (const report of this.memReports.values()) {
      if (report.submissionId === submissionId) {
        return report;
      }
    }

    return null;
  }

  /**
   * Lists all unique AI Evaluation Reports for a given competition (bounded via limit()).
   */
  public async listReportsByCompetition(
    competitionId: string,
    options?: PaginationOptions
  ): Promise<AiEvaluationReport[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const q = query(
          collection(fs, 'aiEvaluationReports'),
          where('competitionId', '==', competitionId),
          limit(pageSize)
        );
        const snaps = await getDocs(q);
        return snaps.docs.map((d) => d.data() as AiEvaluationReport);
      } catch (err) {
        throw mapFirestoreError(err, 'listReportsByCompetition', 'aiEvaluationReports');
      }
    }

    const byId = new Map<string, AiEvaluationReport>();
    for (const report of this.memReports.values()) {
      if (report.competitionId === competitionId) {
        byId.set(report.id, report);
      }
    }
    return Array.from(byId.values());
  }

  /**
   * Applies an organizer AI-failure override to unlock a failed submission for judges.
   */
  public async applyOrganizerOverride(
    submissionId: string,
    organizer: { id: string; name: string; reason: string; justificationNotes?: string }
  ): Promise<ProjectSubmission> {
    const submission = await submissionService.getSubmission(submissionId);
    if (!submission) {
      throw new Error(`Submission "${submissionId}" not found.`);
    }

    const overridden = submissionLifecycleService.applyAiFailureOverride(submission, {
      organizerUserId: organizer.id,
      organizerName: organizer.name,
      reason: organizer.reason,
      justificationNotes: organizer.justificationNotes,
    });

    await submissionService.saveSubmission(overridden);
    return overridden;
  }

  public clearMemoryStore(): void {
    this.memReports.clear();
  }
}

export const evaluationPipelineService = new EvaluationPipelineService();
