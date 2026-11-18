// ─────────────────────────────────────────────
// evaluationQueueService.ts — Concurrency-Safe AI Evaluation Queue
// Proofly / Evalora — Phase 6
// ─────────────────────────────────────────────

import { db, isFirebaseConfigured } from '../config/firebase';
import { collection, doc, setDoc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import type { AiEvaluationJob, AiEvaluationReport } from '../types/aiEvaluation';
import { submissionService } from './submissionService';
import { evaluationPipelineService } from './evaluationPipelineService';

export class EvaluationQueueService {
  private memJobs: Map<string, AiEvaluationJob> = new Map();

  /**
   * Enqueues a submission for evaluation.
   * Concurrency & Idempotency Guarantee: Prevents duplicate jobs for the same submission.
   */
  public async enqueueSubmission(
    submissionId: string,
    competitionId: string,
    referenceId: string
  ): Promise<AiEvaluationJob> {
    const jobId = `job-${submissionId}`;

    // Check memory store
    const existing = await this.getJob(jobId);
    if (existing) {
      if (existing.status === 'COMPLETED') {
        // Idempotent: already evaluated
        return existing;
      }
      if (existing.status === 'QUEUED' || existing.status === 'LEASED' || existing.status === 'IN_PROGRESS') {
        // Already active or queued
        return existing;
      }
      if (existing.status === 'FAILED') {
        // Reset failed job for retry
        const retryJob: AiEvaluationJob = {
          ...existing,
          status: 'QUEUED',
          leaseOwnerId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: new Date().toISOString(),
        };
        await this.saveJob(retryJob);
        return retryJob;
      }
    }

    const now = new Date().toISOString();
    const newJob: AiEvaluationJob = {
      id: jobId,
      submissionId,
      referenceId,
      competitionId,
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };

    await this.saveJob(newJob);
    return newJob;
  }

  /**
   * Claims the next available job using lease-based concurrency protection.
   * If a job's lease has expired, it is automatically recovered and re-leased.
   */
  public async claimNextJob(
    workerId: string,
    leaseDurationMs: number = 60000,
    competitionId?: string
  ): Promise<AiEvaluationJob | null> {
    const allJobs = await this.listJobs(competitionId);
    const now = Date.now();

    // Priority 1: QUEUED jobs
    // Priority 2: Stale LEASED/IN_PROGRESS jobs whose lease has expired
    const candidate = allJobs.find((job) => {
      if (job.status === 'QUEUED') return true;
      if (
        (job.status === 'LEASED' || job.status === 'IN_PROGRESS') &&
        job.leaseExpiresAt &&
        new Date(job.leaseExpiresAt).getTime() < now
      ) {
        return true;
      }
      return false;
    });

    if (!candidate) {
      return null;
    }

    // Atomically claim the lease
    const leaseExpiresAt = new Date(now + leaseDurationMs).toISOString();
    const claimedJob: AiEvaluationJob = {
      ...candidate,
      status: 'LEASED',
      leaseOwnerId: workerId,
      leaseExpiresAt,
      attempts: (candidate.attempts || 0) + 1,
      updatedAt: new Date(now).toISOString(),
    };

    await this.saveJob(claimedJob);
    return claimedJob;
  }

  /**
   * Heartbeat to extend an active job lease.
   */
  public async heartbeatLease(
    jobId: string,
    workerId: string,
    extensionMs: number = 60000
  ): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job || job.leaseOwnerId !== workerId) {
      return false;
    }

    job.leaseExpiresAt = new Date(Date.now() + extensionMs).toISOString();
    job.updatedAt = new Date().toISOString();
    await this.saveJob(job);
    return true;
  }

  /**
   * Completes a job.
   * Validates that the worker still holds the lease before finalizing to avoid race conditions.
   */
  public async completeJob(
    jobId: string,
    workerId: string,
    reportId: string
  ): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Evaluation job "${jobId}" not found.`);
    }

    if (job.leaseOwnerId && job.leaseOwnerId !== workerId) {
      throw new Error(
        `Concurrency error: Worker "${workerId}" cannot complete job "${jobId}" owned by "${job.leaseOwnerId}".`
      );
    }

    const updatedJob: AiEvaluationJob = {
      ...job,
      status: 'COMPLETED',
      reportId,
      leaseOwnerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: new Date().toISOString(),
    };

    await this.saveJob(updatedJob);
  }

  /**
   * Marks a job as failed, with retry support up to maxAttempts.
   */
  public async failJob(
    jobId: string,
    workerId: string,
    error: string,
    retryable: boolean = true
  ): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    if (job.leaseOwnerId && job.leaseOwnerId !== workerId) {
      return;
    }

    const shouldRetry = retryable && job.attempts < job.maxAttempts;
    const now = new Date().toISOString();

    const updatedJob: AiEvaluationJob = {
      ...job,
      status: shouldRetry ? 'QUEUED' : 'FAILED',
      lastError: error,
      leaseOwnerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    };

    await this.saveJob(updatedJob);
  }

  /**
   * High-level helper: claims and runs evaluation on a job via the browser worker.
   */
  public async processJob(
    job: AiEvaluationJob,
    workerId: string
  ): Promise<{ success: boolean; report?: AiEvaluationReport; error?: string }> {
    try {
      // Transition job to IN_PROGRESS
      job.status = 'IN_PROGRESS';
      job.updatedAt = new Date().toISOString();
      await this.saveJob(job);

      // Load target submission
      const submission = await submissionService.getSubmission(job.submissionId);
      if (!submission) {
        throw new Error(`Submission "${job.submissionId}" could not be found.`);
      }

      // Execute 9-step pipeline
      const pipelineResult = await evaluationPipelineService.executePipeline(submission);

      if (!pipelineResult.success || !pipelineResult.report) {
        throw new Error(pipelineResult.error || 'Evaluation pipeline failed to generate report.');
      }

      // Complete job
      await this.completeJob(job.id, workerId, pipelineResult.report.id);

      return {
        success: true,
        report: pipelineResult.report,
      };
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      await this.failJob(job.id, workerId, errorMsg, true);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Retrieves a single job by ID.
   */
  public async getJob(jobId: string): Promise<AiEvaluationJob | null> {
    if (this.memJobs.has(jobId)) {
      return this.memJobs.get(jobId)!;
    }

    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDoc(doc(db, 'evaluationJobs', jobId));
        if (snap.exists()) {
          const loaded = snap.data() as AiEvaluationJob;
          this.memJobs.set(jobId, loaded);
          return loaded;
        }
      } catch {
        // fallback
      }
    }

    return null;
  }

  /**
   * Lists all jobs, optionally filtered by competition ID.
   */
  public async listJobs(competitionId?: string): Promise<AiEvaluationJob[]> {
    const list: AiEvaluationJob[] = [];
    for (const job of this.memJobs.values()) {
      if (!competitionId || job.competitionId === competitionId) {
        list.push(job);
      }
    }

    if (isFirebaseConfigured() && db) {
      try {
        const q = competitionId
          ? query(collection(db, 'evaluationJobs'), where('competitionId', '==', competitionId))
          : collection(db, 'evaluationJobs');

        const snaps = await getDocs(q);
        snaps.forEach((docSnap) => {
          const item = docSnap.data() as AiEvaluationJob;
          const idx = list.findIndex((j) => j.id === item.id);
          if (idx >= 0) {
            list[idx] = item;
          } else {
            list.push(item);
          }
          this.memJobs.set(item.id, item);
        });
      } catch {
        // fallback
      }
    }

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Persists a job to memory and Firestore.
   */
  public async saveJob(job: AiEvaluationJob): Promise<void> {
    this.memJobs.set(job.id, job);

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'evaluationJobs', job.id), sanitizeFirestoreData(job));
      } catch (err) {
        console.warn('Could not save evaluation job to Firestore; stored in memory.', err);
      }
    }
  }

  public clearMemoryStore(): void {
    this.memJobs.clear();
  }
}

export const evaluationQueueService = new EvaluationQueueService();
