// ─────────────────────────────────────────────
// evaluationWorkerService.ts — Authenticated Evaluation Worker Coordinator
// Proofly Phase 07 — Browser-Based Authenticated AI Worker Lifecycle
// ─────────────────────────────────────────────

import { auth } from '../config/firebase';
import { evaluationQueueService } from './evaluationQueueService';
import { submissionService } from './submissionService';
import { competitionService } from './competitionService';
import { rubricEngineService } from './rubricEngineService';
import { contentExtractionService } from './contentExtractionService';
import { aiLogicService } from './aiLogicService';
import { evaluationPipelineService } from './evaluationPipelineService';
import { InferenceMode } from 'firebase/ai';
import type {
  AiEvaluationJob,
  AiEvaluationReport,
  RubricVersion,
} from '../types/aiEvaluation';

export interface WorkerSessionState {
  workerId: string;
  isActive: boolean;
  activeJobId: string | null;
  processedCount: number;
  lastHeartbeat: string | null;
  error?: string;
}

export class EvaluationWorkerService {
  private activeWorkers: Map<string, WorkerSessionState> = new Map();
  private heartbeatIntervals: Map<string, any> = new Map();

  /**
   * Starts an authenticated browser worker session.
   * Requires an authenticated session in Firebase Auth (or test context).
   */
  public async startWorker(options: {
    workerId: string;
    competitionId?: string;
    leaseDurationMs?: number;
    inferenceMode?: InferenceMode;
  }): Promise<WorkerSessionState> {
    const user = auth?.currentUser;
    const isTestContext = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.env?.NODE_ENV === 'test';
    if (!user && !isTestContext) {
      throw new Error(
        'Unauthorized: An authenticated organizer or judge account is required to start an evaluation worker.'
      );
    }

    const state: WorkerSessionState = {
      workerId: options.workerId,
      isActive: true,
      activeJobId: null,
      processedCount: 0,
      lastHeartbeat: new Date().toISOString(),
    };
    this.activeWorkers.set(options.workerId, state);
    return state;
  }

  /**
   * Claims and processes a single evaluation job securely from the durable job queue.
   */
  public async claimAndProcessNextJob(
    workerId: string,
    options?: {
      competitionId?: string;
      leaseDurationMs?: number;
      inferenceMode?: InferenceMode;
      allowFallback?: boolean;
    }
  ): Promise<{
    processed: boolean;
    job?: AiEvaluationJob;
    report?: AiEvaluationReport;
    error?: string;
  }> {
    const worker = this.activeWorkers.get(workerId);
    if (!worker || !worker.isActive) {
      throw new Error(`Worker "${workerId}" is not registered or is inactive.`);
    }

    const leaseDurationMs = options?.leaseDurationMs ?? 60000;
    const mode = options?.inferenceMode ?? InferenceMode.PREFER_ON_DEVICE;

    // 1. Claim job atomically via CAS from evaluationQueueService
    const job = await evaluationQueueService.claimNextJob({
      workerId,
      leaseDurationMs,
      competitionId: options?.competitionId,
    });

    if (!job) {
      return { processed: false };
    }

    worker.activeJobId = job.id;

    // 2. Start heartbeat to maintain lease while inference runs in browser
    const heartbeatTimer = setInterval(async () => {
      try {
        await evaluationQueueService.heartbeatLease(job.id, workerId);
        worker.lastHeartbeat = new Date().toISOString();
      } catch {
        // Lease lost or worker disconnected
      }
    }, 15000);
    this.heartbeatIntervals.set(job.id, heartbeatTimer);

    try {
      // 3. Stage: EXTRACTING
      await evaluationQueueService.updateJobStage(job.id, workerId, 'EXTRACTING');
      const submission = await submissionService.getSubmission(job.submissionId);
      if (!submission) {
        throw new Error(`Submission "${job.submissionId}" not found for evaluation job.`);
      }

      const evidencePacket = await contentExtractionService.extractSubmissionEvidence(submission);

      // 4. Stage: EVALUATING
      await evaluationQueueService.updateJobStage(job.id, workerId, 'EVALUATING');
      const competition = await competitionService.getCompetition(job.competitionId);
      const rubricVersion: RubricVersion = await rubricEngineService.getOrCreateRubricVersion(
        competition ||
          ({
            id: job.competitionId,
            organizationId: job.organizationId,
            title: 'Competition',
            rubric: [],
            tracks: [],
            rounds: [],
          } as any)
      );

      // Run AI evaluation with cancellation and timeout protection
      const report = await aiLogicService.evaluateSubmissionEvidence(
        evidencePacket,
        rubricVersion,
        mode,
        {
          requestId: job.id,
          allowFallback: options?.allowFallback ?? true,
          workerIdentity: workerId,
        }
      );

      // 5. Stage: VALIDATING
      await evaluationQueueService.updateJobStage(job.id, workerId, 'VALIDATING');
      this.validateEvaluationReport(report);

      // 6. Save report immutably
      await evaluationPipelineService.saveEvaluationReport(report);

      // 7. Complete job atomically (verifies worker still holds lease to prevent duplicate submissions)
      const completedJob = await evaluationQueueService.completeJob(job.id, workerId, report.id);

      worker.processedCount++;
      worker.activeJobId = null;

      return {
        processed: true,
        job: completedJob || undefined,
        report,
      };
    } catch (err: any) {
      // Fail job with structured error classification
      const failedJob = await evaluationQueueService.failJob(
        job.id,
        workerId,
        err.message || 'Worker evaluation failed',
        err.classification || 'MODEL_ERROR',
        err.isRetryable ?? true
      );

      worker.activeJobId = null;
      return {
        processed: true,
        job: failedJob || undefined,
        error: err.message,
      };
    } finally {
      clearInterval(this.heartbeatIntervals.get(job.id));
      this.heartbeatIntervals.delete(job.id);
    }
  }

  /**
   * Recovers stale jobs left by crashed or disconnected workers and makes them available for claim.
   */
  public async recoverStaleWorkerJobs(): Promise<number> {
    const recoveredCount = await evaluationQueueService.recoverStaleJobs();
    return recoveredCount;
  }

  /**
   * Stops an active worker session.
   */
  public stopWorker(workerId: string): void {
    const worker = this.activeWorkers.get(workerId);
    if (worker) {
      worker.isActive = false;
      if (worker.activeJobId) {
        clearInterval(this.heartbeatIntervals.get(worker.activeJobId));
        this.heartbeatIntervals.delete(worker.activeJobId);
      }
    }
  }

  /**
   * Validates structured evaluation report against rubric bounds and integrity constraints.
   */
  private validateEvaluationReport(report: AiEvaluationReport): void {
    if (!report || !Array.isArray(report.criteriaEvaluations)) {
      throw new Error('Validation failed: Report does not contain criteria evaluations array.');
    }
    for (const crit of report.criteriaEvaluations) {
      if (typeof crit.suggestedScore !== 'number' || isNaN(crit.suggestedScore)) {
        throw new Error(
          `Validation failed: Invalid suggested score for criterion "${crit.criterionName}".`
        );
      }
      if (crit.suggestedScore < 0 || crit.suggestedScore > crit.maxScore) {
        throw new Error(
          `Validation failed: Score ${crit.suggestedScore} exceeds bounds [0, ${crit.maxScore}] for "${crit.criterionName}".`
        );
      }
    }
  }
}

export const evaluationWorkerService = new EvaluationWorkerService();
