// ─────────────────────────────────────────────
// evaluationQueueService.ts — Durable AI Evaluation Job Engine
// Proofly Phase 05 — Transactional Atomic Claims, 9-State Lifecycle,
// Bounded Backoff with Jitter, Stale Lease Recovery, and Governance Audit Logging
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
  where,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  clampPageSize,
  mapFirestoreError,
  PersistenceError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginationOptions,
} from './firestorePersistenceService';
import {
  isEvaluationErrorRetryable,
  type AiEvaluationJob,
  type AiEvaluationReport,
  type EvaluationJobErrorClassification,
  type EvaluationJobRetryEntry,
  type EvaluationJobStatus,
  type EvaluationJobType,
} from '../types/aiEvaluation';
import { submissionService } from './submissionService';
import { evaluationPipelineService } from './evaluationPipelineService';
import { governanceAuditService } from './governanceAuditService';

export interface EnqueueJobParams {
  submissionId: string;
  competitionId: string;
  organizationId?: string;
  referenceId?: string;
  rubricVersion?: number;
  jobType?: EvaluationJobType;
  maxAttempts?: number;
}

export interface ClaimJobParams {
  workerId: string;
  leaseDurationMs?: number;
  competitionId?: string;
}

export interface ManualRetryParams {
  jobId: string;
  organizerUserId: string;
  organizerName: string;
  auditReason: string;
  resetAttempts?: boolean;
}

export class EvaluationQueueService {
  // In-memory job cache strictly for standalone unit tests without Firestore/Emulators
  private memJobs: Map<string, AiEvaluationJob> = new Map();

  /**
   * Deterministic idempotency key generator for evaluation jobs.
   * Guarantees that the same (submissionId, rubricVersion) never creates duplicate active jobs.
   */
  public generateIdempotencyKey(submissionId: string, rubricVersion: number = 1): string {
    return `idemp_${submissionId}_v${rubricVersion}`;
  }

  /**
   * Deterministic job document ID.
   */
  public generateJobId(submissionId: string, rubricVersion: number = 1): string {
    return `job-${submissionId}-v${rubricVersion}`;
  }

  /**
   * Enqueues a submission for evaluation with transactional idempotency protection.
   * If an active or completed job already exists for (submissionId, rubricVersion),
   * returns the existing job without creating duplicate records.
   */
  public async enqueueSubmission(
    submissionIdOrParams: string | EnqueueJobParams,
    competitionId?: string,
    referenceId?: string,
    organizationId?: string,
    rubricVersion?: number,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationJob> {
    let params: EnqueueJobParams;
    let execOptions = options;

    if (typeof submissionIdOrParams === 'object') {
      params = submissionIdOrParams;
      execOptions = (competitionId as unknown as FirestoreExecutionOptions) || options;
    } else {
      params = {
        submissionId: submissionIdOrParams,
        competitionId: competitionId || '',
        referenceId: referenceId || submissionIdOrParams,
        organizationId: organizationId || 'org-default',
        rubricVersion: rubricVersion || 1,
      };
    }

    const subId = params.submissionId;
    const compId = params.competitionId;
    const refId = params.referenceId || subId;
    const orgId = params.organizationId || 'org-default';
    const rubricVer = params.rubricVersion || 1;
    const jobType: EvaluationJobType = params.jobType || 'EVALUATION';
    const maxAttempts = params.maxAttempts || 3;
    const idempKey = this.generateIdempotencyKey(subId, rubricVer);
    const jobId = this.generateJobId(subId, rubricVer);

    const fs = resolveFirestore(execOptions?.firestore);
    if (fs) {
      try {
        const jobRef = doc(fs, 'evaluationJobs', jobId);

        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(jobRef);
          if (snap.exists()) {
            const existing = snap.data() as AiEvaluationJob;

            // Idempotent return for completed jobs
            if (existing.status === 'COMPLETED') {
              return existing;
            }

            // Return existing active jobs
            const activeStatuses: EvaluationJobStatus[] = [
              'QUEUED',
              'CLAIMED',
              'EXTRACTING',
              'EVALUATING',
              'VALIDATING',
              'RETRY_WAIT',
              'LEASED',
              'IN_PROGRESS',
            ];
            if (activeStatuses.includes(existing.status)) {
              return existing;
            }

            // Re-activate failed job
            if (existing.status === 'FAILED') {
              const now = new Date().toISOString();
              const resetJob: AiEvaluationJob = {
                ...existing,
                status: 'QUEUED',
                leaseOwnerId: null,
                leaseExpiresAt: null,
                backoffUntilMs: undefined,
                errorClassification: null,
                errorDetails: null,
                lastError: undefined,
                attemptCount: 0,
                attempts: 0,
                updatedAt: now,
              };
              tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(resetJob), false));
              return resetJob;
            }

            // Re-activate cancelled job
            if (existing.status === 'CANCELLED') {
              const now = new Date().toISOString();
              const requeuedJob: AiEvaluationJob = {
                ...existing,
                status: 'QUEUED',
                leaseOwnerId: null,
                leaseExpiresAt: null,
                updatedAt: now,
              };
              tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(requeuedJob), false));
              return requeuedJob;
            }
          }

          // Create new job
          const now = new Date().toISOString();
          const newJob: AiEvaluationJob = {
            id: jobId,
            submissionId: subId,
            referenceId: refId,
            competitionId: compId,
            organizationId: orgId,
            rubricVersion: rubricVer,
            jobType,
            status: 'QUEUED',
            attemptCount: 0,
            attempts: 0,
            maxAttempts,
            idempotencyKey: idempKey,
            createdAt: now,
            updatedAt: now,
            retryHistory: [],
          };

          tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(newJob), true));
          return newJob;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'enqueueSubmission', 'evaluationJobs');
      }
    }

    // In-memory fallback strictly for standalone unit tests
    const existing = this.memJobs.get(jobId);
    if (existing) {
      if (existing.status === 'COMPLETED') return existing;
      const activeStatuses: EvaluationJobStatus[] = [
        'QUEUED',
        'CLAIMED',
        'EXTRACTING',
        'EVALUATING',
        'VALIDATING',
        'RETRY_WAIT',
        'LEASED',
        'IN_PROGRESS',
      ];
      if (activeStatuses.includes(existing.status)) return existing;
      if (existing.status === 'FAILED' || existing.status === 'CANCELLED') {
        const now = new Date().toISOString();
        const resetJob: AiEvaluationJob = {
          ...existing,
          status: 'QUEUED',
          leaseOwnerId: null,
          leaseExpiresAt: null,
          backoffUntilMs: undefined,
          errorClassification: null,
          errorDetails: null,
          lastError: undefined,
          attemptCount: 0,
          attempts: 0,
          updatedAt: now,
        };
        this.memJobs.set(jobId, resetJob);
        return resetJob;
      }
    }

    const now = new Date().toISOString();
    const newJob: AiEvaluationJob = {
      id: jobId,
      submissionId: subId,
      referenceId: refId,
      competitionId: compId,
      organizationId: orgId,
      rubricVersion: rubricVer,
      jobType,
      status: 'QUEUED',
      attemptCount: 0,
      attempts: 0,
      maxAttempts,
      idempotencyKey: idempKey,
      createdAt: now,
      updatedAt: now,
      retryHistory: [],
    };
    this.memJobs.set(jobId, newJob);
    return newJob;
  }

  /**
   * Atomically claims the next available evaluation job using Firestore transactions.
   * Priority:
   *  1. Fresh QUEUED jobs
   *  2. RETRY_WAIT jobs whose backoff time has elapsed
   *  3. Stale leased/active jobs whose lease has expired (worker crash recovery)
   *
   * Guarantees: Two workers will NEVER successfully claim the same active job.
   */
  public async claimNextJob(
    workerIdOrParams: string | ClaimJobParams,
    leaseDurationMs: number = 60000,
    competitionId?: string,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationJob | null> {
    let workerId: string;
    let leaseMs = leaseDurationMs;
    let compId = competitionId;
    let execOptions = options;

    if (typeof workerIdOrParams === 'object') {
      workerId = workerIdOrParams.workerId;
      leaseMs = workerIdOrParams.leaseDurationMs ?? 60000;
      compId = workerIdOrParams.competitionId;
      execOptions = (leaseDurationMs as unknown as FirestoreExecutionOptions) || options;
    } else {
      workerId = workerIdOrParams;
    }

    const fs = resolveFirestore(execOptions?.firestore);
    if (fs) {
      try {
        const q = compId
          ? query(
              collection(fs, 'evaluationJobs'),
              where('competitionId', '==', compId),
              limit(50)
            )
          : query(collection(fs, 'evaluationJobs'), limit(50));

        const snap = await getDocs(q);
        const now = Date.now();

        // Identify candidates
        const candidates = snap.docs
          .map((d) => d.data() as AiEvaluationJob)
          .filter((job) => {
            if (job.status === 'QUEUED') return true;
            if (
              job.status === 'RETRY_WAIT' &&
              (!job.backoffUntilMs || job.backoffUntilMs <= now)
            ) {
              return true;
            }
            const activeLeased: EvaluationJobStatus[] = [
              'CLAIMED',
              'EXTRACTING',
              'EVALUATING',
              'VALIDATING',
              'LEASED',
              'IN_PROGRESS',
            ];
            if (
              activeLeased.includes(job.status) &&
              job.leaseExpiresAt &&
              new Date(job.leaseExpiresAt).getTime() < now
            ) {
              return true;
            }
            return false;
          });

        if (candidates.length === 0) {
          return null;
        }

        // Try to atomically claim a candidate via Firestore transaction (CAS)
        for (const candidate of candidates) {
          const jobRef = doc(fs, 'evaluationJobs', candidate.id);

          try {
            const claimed = await runTransaction(fs, async (tx) => {
              const liveSnap = await tx.get(jobRef);
              if (!liveSnap.exists()) return null;

              const live = liveSnap.data() as AiEvaluationJob;
              const liveNow = Date.now();

              // Verify candidacy inside the transaction
              const isQueued = live.status === 'QUEUED';
              const isRetryWaitReady =
                live.status === 'RETRY_WAIT' &&
                (!live.backoffUntilMs || live.backoffUntilMs <= liveNow);
              const activeLeased: EvaluationJobStatus[] = [
                'CLAIMED',
                'EXTRACTING',
                'EVALUATING',
                'VALIDATING',
                'LEASED',
                'IN_PROGRESS',
              ];
              const isStaleLease =
                activeLeased.includes(live.status) &&
                live.leaseExpiresAt != null &&
                new Date(live.leaseExpiresAt).getTime() < liveNow;

              if (!isQueued && !isRetryWaitReady && !isStaleLease) {
                // Lost race to another worker
                return null;
              }

              const attempts = (live.attemptCount || live.attempts || 0) + 1;
              const leaseExpiresAt = new Date(liveNow + leaseMs).toISOString();

              const updated: AiEvaluationJob = {
                ...live,
                status: 'CLAIMED',
                leaseOwnerId: workerId,
                leaseExpiresAt,
                attemptCount: attempts,
                attempts,
                updatedAt: new Date(liveNow).toISOString(),
              };

              tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(updated), false));
              return updated;
            });

            if (claimed) {
              return claimed;
            }
          } catch (txErr) {
            // Concurrent collision on this document, try next candidate
            console.debug(`[claimNextJob] Collision claiming job ${candidate.id}:`, txErr);
          }
        }

        return null;
      } catch (err) {
        throw mapFirestoreError(err, 'claimNextJob', 'evaluationJobs');
      }
    }

    // In-memory fallback strictly for standalone unit tests
    const now = Date.now();
    const candidate = Array.from(this.memJobs.values()).find((job) => {
      if (compId && job.competitionId !== compId) return false;
      if (job.status === 'QUEUED') return true;
      if (
        job.status === 'RETRY_WAIT' &&
        (!job.backoffUntilMs || job.backoffUntilMs <= now)
      ) {
        return true;
      }
      const activeLeased: EvaluationJobStatus[] = [
        'CLAIMED',
        'EXTRACTING',
        'EVALUATING',
        'VALIDATING',
        'LEASED',
        'IN_PROGRESS',
      ];
      if (
        activeLeased.includes(job.status) &&
        job.leaseExpiresAt &&
        new Date(job.leaseExpiresAt).getTime() < now
      ) {
        return true;
      }
      return false;
    });

    if (!candidate) return null;

    const attempts = (candidate.attemptCount || candidate.attempts || 0) + 1;
    const leaseExpiresAt = new Date(now + leaseMs).toISOString();
    const claimedJob: AiEvaluationJob = {
      ...candidate,
      status: 'CLAIMED',
      leaseOwnerId: workerId,
      leaseExpiresAt,
      attemptCount: attempts,
      attempts,
      updatedAt: new Date(now).toISOString(),
    };

    this.memJobs.set(claimedJob.id, claimedJob);
    return claimedJob;
  }

  /**
   * Heartbeat to extend an active job lease.
   * Validates worker ownership before extending.
   */
  public async heartbeatLease(
    jobId: string,
    workerId: string,
    extensionMs: number = 60000,
    options?: FirestoreExecutionOptions
  ): Promise<boolean> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const jobRef = doc(fs, 'evaluationJobs', jobId);
        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(jobRef);
          if (!snap.exists()) return false;
          const job = snap.data() as AiEvaluationJob;

          if (job.leaseOwnerId !== workerId) {
            return false;
          }
          if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
            return false;
          }

          const now = Date.now();
          const newExpiresAt = new Date(now + extensionMs).toISOString();
          tx.update(jobRef, {
            leaseExpiresAt: newExpiresAt,
            updatedAt: new Date(now).toISOString(),
          });
          return true;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'heartbeatLease', 'evaluationJobs');
      }
    }

    const job = this.memJobs.get(jobId);
    if (!job || job.leaseOwnerId !== workerId) {
      return false;
    }
    job.leaseExpiresAt = new Date(Date.now() + extensionMs).toISOString();
    job.updatedAt = new Date().toISOString();
    this.memJobs.set(jobId, job);
    return true;
  }

  /**
   * Updates intermediate job execution stage ('EXTRACTING' | 'EVALUATING' | 'VALIDATING').
   * Verifies worker lease ownership.
   */
  public async updateJobStage(
    jobId: string,
    workerId: string,
    stage: 'EXTRACTING' | 'EVALUATING' | 'VALIDATING',
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationJob> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const jobRef = doc(fs, 'evaluationJobs', jobId);
        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(jobRef);
          if (!snap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Evaluation job "${jobId}" not found.`,
              operation: 'updateJobStage',
              collection: 'evaluationJobs',
              retryable: false,
            });
          }

          const job = snap.data() as AiEvaluationJob;
          if (job.leaseOwnerId !== workerId) {
            throw new PersistenceError({
              code: 'CONFLICT',
              message: `Worker "${workerId}" cannot advance stage of job "${jobId}" owned by "${job.leaseOwnerId}".`,
              operation: 'updateJobStage',
              collection: 'evaluationJobs',
              retryable: false,
            });
          }

          const now = new Date().toISOString();
          const updated: AiEvaluationJob = {
            ...job,
            status: stage,
            updatedAt: now,
          };

          tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(updated), false));
          return updated;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'updateJobStage', 'evaluationJobs');
      }
    }

    const job = this.memJobs.get(jobId);
    if (!job) throw new Error(`Evaluation job "${jobId}" not found.`);
    if (job.leaseOwnerId !== workerId) {
      throw new Error(`Worker "${workerId}" cannot advance stage of job "${jobId}" owned by "${job.leaseOwnerId}".`);
    }

    job.status = stage;
    job.updatedAt = new Date().toISOString();
    this.memJobs.set(jobId, job);
    return job;
  }

  /**
   * Atomically marks a job as COMPLETED with its immutable evaluation report ID.
   * Enforces lease ownership check to prevent stale workers from overwriting active evaluations.
   */
  public async completeJob(
    jobId: string,
    workerId: string,
    reportId: string,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationJob> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const jobRef = doc(fs, 'evaluationJobs', jobId);
        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(jobRef);
          if (!snap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Evaluation job "${jobId}" not found.`,
              operation: 'completeJob',
              collection: 'evaluationJobs',
              retryable: false,
            });
          }

          const job = snap.data() as AiEvaluationJob;

          if (job.status === 'COMPLETED') {
            return job; // Idempotent completion
          }

          if (job.leaseOwnerId && job.leaseOwnerId !== workerId) {
            throw new PersistenceError({
              code: 'CONFLICT',
              message: `Concurrency error: Worker "${workerId}" cannot complete job "${jobId}" owned by "${job.leaseOwnerId}".`,
              operation: 'completeJob',
              collection: 'evaluationJobs',
              retryable: false,
            });
          }

          const now = new Date().toISOString();
          const updated: AiEvaluationJob = {
            ...job,
            status: 'COMPLETED',
            resultReportId: reportId,
            reportId,
            leaseOwnerId: null,
            leaseExpiresAt: null,
            updatedAt: now,
          };

          tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(updated), false));
          return updated;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'completeJob', 'evaluationJobs');
      }
    }

    const job = this.memJobs.get(jobId);
    if (!job) {
      throw new Error(`Evaluation job "${jobId}" not found.`);
    }

    if (job.status === 'COMPLETED') return job;

    if (job.leaseOwnerId && job.leaseOwnerId !== workerId) {
      throw new Error(
        `Concurrency error: Worker "${workerId}" cannot complete job "${jobId}" owned by "${job.leaseOwnerId}".`
      );
    }

    const updatedJob: AiEvaluationJob = {
      ...job,
      status: 'COMPLETED',
      resultReportId: reportId,
      reportId,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
    };

    this.memJobs.set(jobId, updatedJob);
    return updatedJob;
  }

  /**
   * Marks a job as failed, with structured error classification and bounded exponential backoff.
   * If error is retryable and attemptCount < maxAttempts:
   *   transitions to RETRY_WAIT with backoffUntilMs = now + (2^attempts * 1000) + jitter.
   * If error is permanent or maxAttempts reached:
   *   transitions to FAILED (dead-letter state).
   */
  public async failJob(
    jobId: string,
    workerId: string,
    error: string,
    classificationOrRetryable: EvaluationJobErrorClassification | boolean = true,
    maybeRetryable: boolean = true,
    options?: FirestoreExecutionOptions & { backoffMs?: number }
  ): Promise<AiEvaluationJob | null> {
    let classification: EvaluationJobErrorClassification;
    let retryableFlag: boolean;

    if (typeof classificationOrRetryable === 'string') {
      classification = classificationOrRetryable;
      retryableFlag = maybeRetryable && isEvaluationErrorRetryable(classification);
    } else {
      retryableFlag = classificationOrRetryable;
      classification = retryableFlag ? 'NETWORK_TRANSIENT' : 'PERMANENT_FAILURE';
    }

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const jobRef = doc(fs, 'evaluationJobs', jobId);
        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(jobRef);
          if (!snap.exists()) return null;

          const job = snap.data() as AiEvaluationJob;

          if (job.leaseOwnerId && job.leaseOwnerId !== workerId) {
            return null; // Ignore stale worker failure
          }
          if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
            return job;
          }

          const currentAttempts = job.attemptCount || job.attempts || 1;
          const shouldRetry = retryableFlag && currentAttempts < job.maxAttempts;
          const now = Date.now();

          let backoffUntilMs: number | undefined;
          let retryEntry: EvaluationJobRetryEntry | undefined;

          if (shouldRetry) {
            // Exponential backoff with jitter: 1s, 2s, 4s... + up to 500ms jitter
            const baseMs = 1000 * Math.pow(2, currentAttempts - 1);
            const jitterMs = Math.floor(Math.random() * 500);
            const computedBackoff = Math.min(30000, baseMs + jitterMs);
            const backoffMs = options?.backoffMs !== undefined ? options.backoffMs : computedBackoff;
            backoffUntilMs = now + backoffMs;

            retryEntry = {
              attempt: currentAttempts,
              workerId,
              errorClassification: classification,
              error,
              timestamp: new Date(now).toISOString(),
              backoffMs,
            };
          }

          const updated: AiEvaluationJob = {
            ...job,
            status: shouldRetry ? 'RETRY_WAIT' : 'FAILED',
            errorClassification: classification,
            errorDetails: error,
            lastError: error,
            leaseOwnerId: null,
            leaseExpiresAt: null,
            backoffUntilMs,
            retryHistory: [
              ...(job.retryHistory || []),
              ...(retryEntry ? [retryEntry] : []),
            ],
            updatedAt: new Date(now).toISOString(),
          };

          tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(updated), false));
          return updated;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'failJob', 'evaluationJobs');
      }
    }

    const job = this.memJobs.get(jobId);
    if (!job) return null;
    if (job.leaseOwnerId && job.leaseOwnerId !== workerId) return null;
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') return job;

    const currentAttempts = job.attemptCount || job.attempts || 1;
    const shouldRetry = retryableFlag && currentAttempts < job.maxAttempts;
    const now = Date.now();

    let backoffUntilMs: number | undefined;
    let retryEntry: EvaluationJobRetryEntry | undefined;

    if (shouldRetry) {
      const baseMs = 1000 * Math.pow(2, currentAttempts - 1);
      const jitterMs = Math.floor(Math.random() * 500);
      const isTestEnv =
        typeof (globalThis as any).process !== 'undefined' &&
        (globalThis as any).process?.env?.NODE_ENV === 'test';
      const computedBackoff = isTestEnv ? 0 : Math.min(30000, baseMs + jitterMs);
      const backoffMs = options?.backoffMs !== undefined ? options.backoffMs : computedBackoff;
      backoffUntilMs = now + backoffMs;

      retryEntry = {
        attempt: currentAttempts,
        workerId,
        errorClassification: classification,
        error,
        timestamp: new Date(now).toISOString(),
        backoffMs,
      };
    }

    const updatedJob: AiEvaluationJob = {
      ...job,
      status: shouldRetry ? 'RETRY_WAIT' : 'FAILED',
      errorClassification: classification,
      errorDetails: error,
      lastError: error,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      backoffUntilMs,
      retryHistory: [
        ...(job.retryHistory || []),
        ...(retryEntry ? [retryEntry] : []),
      ],
      updatedAt: new Date(now).toISOString(),
    };

    this.memJobs.set(jobId, updatedJob);
    return updatedJob;
  }

  /**
   * Manual retry of a failed evaluation job by an authorized organizer.
   * Resets status to QUEUED and logs a mandatory governance audit record.
   */
  public async retryJobManual(
    params: ManualRetryParams,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationJob> {
    if (!params.auditReason || params.auditReason.trim().length < 5) {
      throw new Error('A documented justification reason (minimum 5 characters) is required for manual retry.');
    }

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const jobRef = doc(fs, 'evaluationJobs', params.jobId);
        const resetJob = await runTransaction(fs, async (tx) => {
          const snap = await tx.get(jobRef);
          if (!snap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Evaluation job "${params.jobId}" not found.`,
              operation: 'retryJobManual',
              collection: 'evaluationJobs',
              retryable: false,
            });
          }

          const job = snap.data() as AiEvaluationJob;
          const now = new Date().toISOString();

          const updated: AiEvaluationJob = {
            ...job,
            status: 'QUEUED',
            attemptCount: params.resetAttempts !== false ? 0 : job.attemptCount,
            attempts: params.resetAttempts !== false ? 0 : job.attempts,
            leaseOwnerId: null,
            leaseExpiresAt: null,
            backoffUntilMs: undefined,
            errorClassification: null,
            errorDetails: null,
            lastError: undefined,
            updatedAt: now,
          };

          tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(updated), false));
          return updated;
        });

        // Record governance audit log
        try {
          await governanceAuditService.recordEventDurable(
            {
              organizationId: resetJob.organizationId,
              competitionId: resetJob.competitionId,
              category: 'ADMIN_OVERRIDE',
              action: 'EVALUATION_JOB_MANUAL_RETRY',
              actorId: params.organizerUserId,
              actorName: params.organizerName,
              actorRole: 'ORGANIZER',
              targetId: resetJob.id,
              targetLabel: resetJob.referenceId || resetJob.id,
              reason: params.auditReason,
              metadata: {
                previousStatus: 'FAILED',
                jobType: resetJob.jobType,
              },
            },
            options
          );
        } catch {
          // If durable audit fails in test without backend, record memory audit
          governanceAuditService.recordEvent({
            organizationId: resetJob.organizationId,
            competitionId: resetJob.competitionId,
            category: 'ADMIN_OVERRIDE',
            action: 'EVALUATION_JOB_MANUAL_RETRY',
            actorId: params.organizerUserId,
            actorName: params.organizerName,
            actorRole: 'ORGANIZER',
            targetId: resetJob.id,
            targetLabel: resetJob.referenceId || resetJob.id,
            reason: params.auditReason,
          });
        }

        return resetJob;
      } catch (err) {
        throw mapFirestoreError(err, 'retryJobManual', 'evaluationJobs');
      }
    }

    const job = this.memJobs.get(params.jobId);
    if (!job) throw new Error(`Evaluation job "${params.jobId}" not found.`);

    const now = new Date().toISOString();
    const updatedJob: AiEvaluationJob = {
      ...job,
      status: 'QUEUED',
      attemptCount: params.resetAttempts !== false ? 0 : job.attemptCount,
      attempts: params.resetAttempts !== false ? 0 : job.attempts,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      backoffUntilMs: undefined,
      errorClassification: null,
      errorDetails: null,
      lastError: undefined,
      updatedAt: now,
    };
    this.memJobs.set(params.jobId, updatedJob);

    governanceAuditService.recordEvent({
      organizationId: updatedJob.organizationId,
      competitionId: updatedJob.competitionId,
      category: 'ADMIN_OVERRIDE',
      action: 'EVALUATION_JOB_MANUAL_RETRY',
      actorId: params.organizerUserId,
      actorName: params.organizerName,
      actorRole: 'ORGANIZER',
      targetId: updatedJob.id,
      targetLabel: updatedJob.referenceId || updatedJob.id,
      reason: params.auditReason,
    });

    return updatedJob;
  }

  /**
   * Recovers stale jobs whose lease expired without a worker heartbeat or completion.
   */
  public async recoverStaleJobs(
    competitionId?: string,
    options?: FirestoreExecutionOptions
  ): Promise<number> {
    const allJobs = await this.listJobs(competitionId, options);
    const now = Date.now();
    let recoveredCount = 0;

    const activeLeased: EvaluationJobStatus[] = [
      'CLAIMED',
      'EXTRACTING',
      'EVALUATING',
      'VALIDATING',
      'LEASED',
      'IN_PROGRESS',
    ];

    for (const job of allJobs) {
      if (
        activeLeased.includes(job.status) &&
        job.leaseExpiresAt &&
        new Date(job.leaseExpiresAt).getTime() < now
      ) {
        const shouldRetry = (job.attemptCount || job.attempts || 0) < job.maxAttempts;
        const updated: AiEvaluationJob = {
          ...job,
          status: shouldRetry ? 'QUEUED' : 'FAILED',
          leaseOwnerId: null,
          leaseExpiresAt: null,
          errorClassification: shouldRetry ? null : 'PERMANENT_FAILURE',
          errorDetails: shouldRetry
            ? undefined
            : 'Job lease expired and maximum attempts exceeded without worker heartbeat.',
          updatedAt: new Date().toISOString(),
        };

        await this.saveJob(updated, options);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }

  /**
   * Cancels an evaluation job.
   */
  public async cancelJob(
    jobId: string,
    actorId: string,
    reason: string,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationJob> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const jobRef = doc(fs, 'evaluationJobs', jobId);
        return await runTransaction(fs, async (tx) => {
          const snap = await tx.get(jobRef);
          if (!snap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Evaluation job "${jobId}" not found.`,
              operation: 'cancelJob',
              collection: 'evaluationJobs',
              retryable: false,
            });
          }

          const job = snap.data() as AiEvaluationJob;
          if (job.status === 'COMPLETED') {
            throw new PersistenceError({
              code: 'CONFLICT',
              message: `Cannot cancel completed job "${jobId}".`,
              operation: 'cancelJob',
              collection: 'evaluationJobs',
              retryable: false,
            });
          }

          const updated: AiEvaluationJob = {
            ...job,
            status: 'CANCELLED',
            leaseOwnerId: null,
            leaseExpiresAt: null,
            errorDetails: `Cancelled by ${actorId}: ${reason}`,
            updatedAt: new Date().toISOString(),
          };

          tx.set(jobRef, withServerTimestamps(sanitizeFirestoreData(updated), false));
          return updated;
        });
      } catch (err) {
        throw mapFirestoreError(err, 'cancelJob', 'evaluationJobs');
      }
    }

    const job = this.memJobs.get(jobId);
    if (!job) throw new Error(`Evaluation job "${jobId}" not found.`);
    if (job.status === 'COMPLETED') throw new Error(`Cannot cancel completed job "${jobId}".`);

    job.status = 'CANCELLED';
    job.leaseOwnerId = null;
    job.leaseExpiresAt = null;
    job.errorDetails = `Cancelled by ${actorId}: ${reason}`;
    job.updatedAt = new Date().toISOString();
    this.memJobs.set(jobId, job);
    return job;
  }

  /**
   * High-level worker executor: advances through the 9-state lifecycle:
   * CLAIMED -> EXTRACTING -> EVALUATING -> VALIDATING -> COMPLETED (or RETRY_WAIT / FAILED)
   */
  public async processJob(
    job: AiEvaluationJob,
    workerId: string,
    options?: FirestoreExecutionOptions
  ): Promise<{ success: boolean; report?: AiEvaluationReport; error?: string }> {
    try {
      // 1. Advance to EXTRACTING stage
      await this.updateJobStage(job.id, workerId, 'EXTRACTING', options);

      // 2. Load target submission
      const submission = await submissionService.getSubmission(job.submissionId, options);
      if (!submission) {
        throw new PersistenceError({
          code: 'NOT_FOUND',
          message: `Submission "${job.submissionId}" could not be found.`,
          operation: 'processJob',
          collection: 'submissions',
          retryable: false,
        });
      }

      // 3. Advance to EVALUATING stage
      await this.updateJobStage(job.id, workerId, 'EVALUATING', options);

      // 4. Execute 9-step pipeline
      const pipelineResult = await evaluationPipelineService.executePipeline(submission);

      if (!pipelineResult.success || !pipelineResult.report) {
        throw new Error(pipelineResult.error || 'Evaluation pipeline failed to generate report.');
      }

      // 5. Advance to VALIDATING stage
      await this.updateJobStage(job.id, workerId, 'VALIDATING', options);

      // 6. Complete job
      await this.completeJob(job.id, workerId, pipelineResult.report.id, options);

      return {
        success: true,
        report: pipelineResult.report,
      };
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      let classification: EvaluationJobErrorClassification = 'MODEL_ERROR';

      if (errorMsg.includes('not found') || errorMsg.includes('NOT_FOUND')) {
        classification = 'INVALID_INPUT';
      } else if (errorMsg.includes('network') || errorMsg.includes('timeout')) {
        classification = 'NETWORK_TRANSIENT';
      } else if (errorMsg.includes('rate') || errorMsg.includes('429')) {
        classification = 'RATE_LIMIT';
      } else if (errorMsg.includes('permission') || errorMsg.includes('PERMISSION_DENIED')) {
        classification = 'PERMISSION_ERROR';
      }

      await this.failJob(job.id, workerId, errorMsg, classification, true, options);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Retrieves a single job by ID from Firestore.
   */
  public async getJob(
    jobId: string,
    options?: FirestoreExecutionOptions
  ): Promise<AiEvaluationJob | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'evaluationJobs', jobId));
        return snap.exists() ? (snap.data() as AiEvaluationJob) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getJob', 'evaluationJobs');
      }
    }
    return this.memJobs.get(jobId) || null;
  }

  /**
   * Lists evaluation jobs from Firestore with pagination and competition filter.
   */
  public async listJobs(
    competitionId?: string,
    options?: PaginationOptions
  ): Promise<AiEvaluationJob[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const q = competitionId
          ? query(
              collection(fs, 'evaluationJobs'),
              where('competitionId', '==', competitionId),
              limit(pageSize)
            )
          : query(collection(fs, 'evaluationJobs'), limit(pageSize));

        const snaps = await getDocs(q);
        return snaps.docs
          .map((d) => d.data() as AiEvaluationJob)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      } catch (err) {
        throw mapFirestoreError(err, 'listJobs', 'evaluationJobs');
      }
    }

    const list: AiEvaluationJob[] = [];
    for (const job of this.memJobs.values()) {
      if (!competitionId || job.competitionId === competitionId) {
        list.push(job);
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Saves a job document to Firestore.
   */
  public async saveJob(
    job: AiEvaluationJob,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(
          doc(fs, 'evaluationJobs', job.id),
          withServerTimestamps(sanitizeFirestoreData(job), true)
        );
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'saveJob', 'evaluationJobs');
      }
    }

    this.memJobs.set(job.id, job);
  }

  public clearMemoryStore(): void {
    this.memJobs.clear();
  }
}

export const evaluationQueueService = new EvaluationQueueService();
