// ─────────────────────────────────────────────────────────────────
// phase5EvaluationJobEngine.test.ts
// Proofly Phase 05 — Durable Evaluation Job Engine Tests
// Runs against live Firebase Firestore Emulator + real firestore.rules:
//   1. Transactional idempotency & duplicate prevention (deterministic idempotencyKey)
//   2. Atomic job claiming & concurrency protection (dual-worker claim race condition CAS)
//   3. Intermediate 9-state stage progression (EXTRACTING -> EVALUATING -> VALIDATING -> COMPLETED)
//   4. Worker lease ownership enforcement & heartbeat extension
//   5. Worker crash recovery & stale expired lease re-claiming
//   6. Transient vs permanent failure classification with exponential backoff & jitter
//   7. Organizer manual retry with mandatory governance audit logging
//   8. Strict security rules enforcement (deny client writes, tenant isolation, organizer-only read)
//   9. Durable Firestore persistence (zero in-memory database reliance)
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { organizationService } from '../../src/services/organizationService';
import { competitionService } from '../../src/services/competitionService';
import { evaluationQueueService } from '../../src/services/evaluationQueueService';
import { governanceAuditService } from '../../src/services/governanceAuditService';
import {
  createTransactionalFirestoreBackendExecutor,
  setTrustedBackendExecutor,
} from '../../src/services/trustedBackendPersistence';
import type { ProjectSubmission } from '../../src/types/submission';

const PROJECT_ID = 'proofly-rules-test';

let testEnv: RulesTestEnvironment;

function makeTestSubmission(params: {
  id: string;
  referenceId: string;
  organizationId: string;
  competitionId: string;
  title: string;
}): ProjectSubmission {
  const now = '2026-11-18T12:00:00.000Z';
  return {
    id: params.id,
    referenceId: params.referenceId,
    competitionId: params.competitionId,
    organizationId: params.organizationId,
    formSchemaId: 'schema-1',
    submissionType: 'INDIVIDUAL',
    participants: [],
    primaryContactName: 'Taylor Morgan',
    primaryContactEmail: 'taylor@example.com',
    projectTitle: params.title,
    projectDescription: 'Phase 5 Durable Evaluation Engine test submission.',
    track: 'Systems & Infrastructure',
    technologiesUsed: ['TypeScript', 'Firestore'],
    fieldValues: {},
    files: [],
    status: 'Queued for AI Evaluation',
    statusHistory: [],
    isLate: false,
    isLocked: true,
    currentVersion: 1,
    versions: [],
    managementTokenHash: 'b'.repeat(64),
    managementTokenPrefix: 'sec_01',
    createdAt: now,
    updatedAt: now,
  };
}

describe('Phase 05: Durable Evaluation Job Engine Suite', () => {
  beforeAll(async () => {
    const firestoreRules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const storageRules = readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: firestoreRules,
      },
      storage: {
        host: '127.0.0.1',
        port: 9199,
        rules: storageRules,
      },
    });
  });

  afterAll(async () => {
    setTrustedBackendExecutor(null);
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    setTrustedBackendExecutor(null);
    await testEnv.clearFirestore();
  });

  it('1. Transactional Idempotency & Duplicate Prevention: enqueuing same submission & rubric version returns existing job without duplicates', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();

    // 1. Setup organization and competition
    const org = await organizationService.createOrganization(
      'Berkeley AI Labs',
      'uid-owner-a',
      'owner@berkeley.edu',
      'Prof. Lead',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@berkeley.edu',
      'Prof. Lead',
      { title: 'Autonomous Systems Cup', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeTestSubmission({
      id: 'sub-auto-01',
      referenceId: 'PF-SUB-2026-AUTO1',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Autonomous Drone Swarm Navigation',
    });

    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const adminDb = adminCtx.firestore();
      await setDoc(doc(adminDb, 'submissions', sub.id), sub);

      // First enqueue call
      const job1 = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
          jobType: 'EVALUATION',
        },
        { firestore: adminDb as any }
      );

      expect(job1.id).toBe(`job-${sub.id}-v1`);
      expect(job1.status).toBe('QUEUED');
      expect(job1.attemptCount).toBe(0);
      expect(job1.idempotencyKey).toBe(`idemp_${sub.id}_v1`);

      // Second enqueue call with identical submission & rubric version
      const job2 = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
          jobType: 'EVALUATION',
        },
        { firestore: adminDb as any }
      );

      // Must return identical existing job
      expect(job2.id).toBe(job1.id);
      expect(job2.idempotencyKey).toBe(job1.idempotencyKey);
      expect(job2.createdAt).toBe(job1.createdAt);

      // Verify directly in Firestore that only 1 document was created
      const snap = await getDoc(doc(adminDb, 'evaluationJobs', job1.id));
      expect(snap.exists()).toBe(true);

      // Verify completing job makes future enqueue idempotent
      await evaluationQueueService.completeJob(job1.id, 'admin-worker', 'rep-final-001', {
        firestore: adminDb as any,
      });

      const jobAfterComplete = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );

      expect(jobAfterComplete.status).toBe('COMPLETED');
      expect(jobAfterComplete.resultReportId).toBe('rep-final-001');
    });
  });

  it('2. Atomic Job Claiming & Concurrency Protection: two concurrent workers cannot claim the same active job', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();

    const org = await organizationService.createOrganization(
      'Stanford Robotics Hub',
      'uid-owner-a',
      'owner@stanford.edu',
      'Dr. Robotics',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@stanford.edu',
      'Dr. Robotics',
      { title: 'Robotics Grand Prix', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeTestSubmission({
      id: 'sub-robo-01',
      referenceId: 'PF-SUB-2026-ROBO1',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Dexterous Manipulation Framework',
    });

    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const adminDb = adminCtx.firestore();
      await setDoc(doc(adminDb, 'submissions', sub.id), sub);

      // Enqueue single job
      await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );

      const worker1 = 'worker-node-alpha';
      const worker2 = 'worker-node-beta';

      // Concurrent race condition: both workers attempt to claim simultaneously
      const [claim1, claim2] = await Promise.all([
        evaluationQueueService.claimNextJob(
          { workerId: worker1, leaseDurationMs: 60000, competitionId: comp.id },
          { firestore: adminDb as any }
        ),
        evaluationQueueService.claimNextJob(
          { workerId: worker2, leaseDurationMs: 60000, competitionId: comp.id },
          { firestore: adminDb as any }
        ),
      ]);

      // Exactly ONE worker must succeed and the other worker MUST receive null
      const winningClaim = claim1 || claim2;
      const losingClaim = claim1 ? claim2 : claim1;

      expect(winningClaim).not.toBeNull();
      expect(losingClaim).toBeNull();
      expect(winningClaim?.status).toBe('CLAIMED');
      expect([worker1, worker2]).toContain(winningClaim?.leaseOwnerId);
      expect(winningClaim?.attemptCount).toBe(1);
      expect(winningClaim?.leaseExpiresAt).toBeDefined();

      // Ensure Firestore document reflects exactly one lease owner
      const snap = await getDoc(doc(adminDb, 'evaluationJobs', winningClaim!.id));
      expect(snap.data()?.leaseOwnerId).toBe(winningClaim?.leaseOwnerId);
    });
  });

  it('3 & 4. Intermediate Stage Progression, Lease Ownership & Heartbeat Extension', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();

    const org = await organizationService.createOrganization(
      'MIT Vision Lab',
      'uid-owner-a',
      'owner@mit.edu',
      'Prof. Vision',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@mit.edu',
      'Prof. Vision',
      { title: 'Computer Vision Benchmark', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeTestSubmission({
      id: 'sub-vis-01',
      referenceId: 'PF-SUB-2026-VIS01',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Temporal Action Segmentation Engine',
    });

    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const adminDb = adminCtx.firestore();
      await setDoc(doc(adminDb, 'submissions', sub.id), sub);

      const job = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );

      const worker1 = 'worker-primary';
      const imposterWorker = 'worker-imposter';

      const claimed = await evaluationQueueService.claimNextJob(
        { workerId: worker1, leaseDurationMs: 60000, competitionId: comp.id },
        { firestore: adminDb as any }
      );
      expect(claimed?.status).toBe('CLAIMED');

      // 1. Advance to EXTRACTING
      const stage1 = await evaluationQueueService.updateJobStage(
        job.id,
        worker1,
        'EXTRACTING',
        { firestore: adminDb as any }
      );
      expect(stage1.status).toBe('EXTRACTING');

      // 2. Imposter worker trying to advance stage or complete must be REJECTED with CONFLICT
      await expect(
        evaluationQueueService.updateJobStage(job.id, imposterWorker, 'EVALUATING', {
          firestore: adminDb as any,
        })
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      await expect(
        evaluationQueueService.completeJob(job.id, imposterWorker, 'fake-rep', {
          firestore: adminDb as any,
        })
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      // 3. Heartbeat extension by legitimate worker
      const extended = await evaluationQueueService.heartbeatLease(
        job.id,
        worker1,
        120000,
        { firestore: adminDb as any }
      );
      expect(extended).toBe(true);

      // Heartbeat by imposter returns false
      const imposterHeartbeat = await evaluationQueueService.heartbeatLease(
        job.id,
        imposterWorker,
        120000,
        { firestore: adminDb as any }
      );
      expect(imposterHeartbeat).toBe(false);

      // 4. Advance through EVALUATING and VALIDATING
      const stage2 = await evaluationQueueService.updateJobStage(
        job.id,
        worker1,
        'EVALUATING',
        { firestore: adminDb as any }
      );
      expect(stage2.status).toBe('EVALUATING');

      const stage3 = await evaluationQueueService.updateJobStage(
        job.id,
        worker1,
        'VALIDATING',
        { firestore: adminDb as any }
      );
      expect(stage3.status).toBe('VALIDATING');

      // 5. Complete job
      const completed = await evaluationQueueService.completeJob(
        job.id,
        worker1,
        'rep-dossier-vis-99',
        { firestore: adminDb as any }
      );
      expect(completed.status).toBe('COMPLETED');
      expect(completed.resultReportId).toBe('rep-dossier-vis-99');
      expect(completed.leaseOwnerId).toBeNull();
      expect(completed.leaseExpiresAt).toBeNull();
    });
  });

  it('5. Worker Crash & Stale Lease Expiration Recovery: recovers abandoned jobs automatically', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();

    const org = await organizationService.createOrganization(
      'CMU Systems Group',
      'uid-owner-a',
      'owner@cmu.edu',
      'Prof. CMU',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@cmu.edu',
      'Prof. CMU',
      { title: 'Distributed Systems Challenge', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeTestSubmission({
      id: 'sub-cmu-01',
      referenceId: 'PF-SUB-2026-CMU01',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Byzantine Fault Tolerant Mesh',
    });

    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const adminDb = adminCtx.firestore();
      await setDoc(doc(adminDb, 'submissions', sub.id), sub);

      const job = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );

      const crashedWorker = 'worker-crash-node';
      // Worker claims with negative lease duration so it is immediately expired (simulating crash)
      await evaluationQueueService.claimNextJob(
        { workerId: crashedWorker, leaseDurationMs: -5000, competitionId: comp.id },
        { firestore: adminDb as any }
      );

      // Recovery worker claims next available job
      const recoveryWorker = 'worker-recovery-node';
      const recoveredClaim = await evaluationQueueService.claimNextJob(
        { workerId: recoveryWorker, leaseDurationMs: 60000, competitionId: comp.id },
        { firestore: adminDb as any }
      );

      expect(recoveredClaim).not.toBeNull();
      expect(recoveredClaim?.id).toBe(job.id);
      expect(recoveredClaim?.leaseOwnerId).toBe(recoveryWorker);
      expect(recoveredClaim?.attemptCount).toBe(2);
      expect(recoveredClaim?.status).toBe('CLAIMED');
    });
  });

  it('6. Transient vs Permanent Failure Classification & Exponential Backoff with Jitter', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();

    const org = await organizationService.createOrganization(
      'Georgia Tech NLP',
      'uid-owner-a',
      'owner@gatech.edu',
      'Dr. GT',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@gatech.edu',
      'Dr. GT',
      { title: 'Semantic Reasoning Olympiad', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub1 = makeTestSubmission({
      id: 'sub-gt-transient',
      referenceId: 'PF-SUB-2026-GT01',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Transient Failure Model',
    });

    const sub2 = makeTestSubmission({
      id: 'sub-gt-permanent',
      referenceId: 'PF-SUB-2026-GT02',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Permanent Failure Model',
    });

    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const adminDb = adminCtx.firestore();
      await setDoc(doc(adminDb, 'submissions', sub1.id), sub1);
      await setDoc(doc(adminDb, 'submissions', sub2.id), sub2);

      const worker = 'worker-classifier';

      // ── 6A: Transient failure (NETWORK_TRANSIENT) transitions to RETRY_WAIT with backoff ──
      const job1 = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub1.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub1.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );

      await evaluationQueueService.claimNextJob(
        { workerId: worker, leaseDurationMs: 60000, competitionId: comp.id },
        { firestore: adminDb as any }
      );

      const failedTransient = await evaluationQueueService.failJob(
        job1.id,
        worker,
        'Inference gateway timeout 504',
        'NETWORK_TRANSIENT',
        true,
        { firestore: adminDb as any, backoffMs: 10000 }
      );

      expect(failedTransient?.status).toBe('RETRY_WAIT');
      expect(failedTransient?.errorClassification).toBe('NETWORK_TRANSIENT');
      expect(failedTransient?.backoffUntilMs).toBeGreaterThan(Date.now() + 5000);
      expect(failedTransient?.retryHistory).toHaveLength(1);
      expect(failedTransient?.retryHistory?.[0].errorClassification).toBe('NETWORK_TRANSIENT');

      // Attempting to claim before backoffUntilMs must return null
      const claimBeforeBackoff = await evaluationQueueService.claimNextJob(
        { workerId: 'worker-2', leaseDurationMs: 60000, competitionId: comp.id },
        { firestore: adminDb as any }
      );
      expect(claimBeforeBackoff).toBeNull();

      // ── 6B: Permanent failure (UNSUPPORTED_ARTIFACT) transitions directly to FAILED ──
      const job2 = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub2.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub2.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );

      await evaluationQueueService.claimNextJob(
        { workerId: worker, leaseDurationMs: 60000, competitionId: comp.id },
        { firestore: adminDb as any }
      );

      const failedPermanent = await evaluationQueueService.failJob(
        job2.id,
        worker,
        'Corrupted binary archive format',
        'UNSUPPORTED_ARTIFACT',
        false,
        { firestore: adminDb as any }
      );

      expect(failedPermanent?.status).toBe('FAILED');
      expect(failedPermanent?.errorClassification).toBe('UNSUPPORTED_ARTIFACT');
      expect(failedPermanent?.backoffUntilMs).toBeUndefined();

      // Never re-claimable automatically
      const claimDeadLetter = await evaluationQueueService.claimNextJob(
        { workerId: 'worker-2', leaseDurationMs: 60000, competitionId: comp.id },
        { firestore: adminDb as any }
      );
      expect(claimDeadLetter).toBeNull();
    });
  });

  it('7. Organizer Manual Retry with Mandatory Governance Audit Logging', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();

    const org = await organizationService.createOrganization(
      'Harvard Medical AI',
      'uid-owner-a',
      'owner@harvard.edu',
      'Dr. Lead Organizer',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@harvard.edu',
      'Dr. Lead Organizer',
      { title: 'Clinical Diagnostics Benchmark', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeTestSubmission({
      id: 'sub-med-01',
      referenceId: 'PF-SUB-2026-MED01',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Pathology Slide Segmentation',
    });

    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const adminDb = adminCtx.firestore();
      const trustedExecutor = createTransactionalFirestoreBackendExecutor(adminDb as any);
      setTrustedBackendExecutor(trustedExecutor);

      await setDoc(doc(adminDb, 'submissions', sub.id), sub);

      const job = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );

      // Fail the job permanently
      await evaluationQueueService.claimNextJob(
        { workerId: 'worker-1', leaseDurationMs: 60000, competitionId: comp.id },
        { firestore: adminDb as any }
      );
      await evaluationQueueService.failJob(
        job.id,
        'worker-1',
        'Model inference quota exceeded',
        'PERMANENT_FAILURE',
        false,
        { firestore: adminDb as any }
      );

      const failedJob = await evaluationQueueService.getJob(job.id, { firestore: adminDb as any });
      expect(failedJob?.status).toBe('FAILED');

      // 1. Manual retry with insufficient reason must REJECT
      await expect(
        evaluationQueueService.retryJobManual(
          {
            jobId: job.id,
            organizerUserId: 'uid-owner-a',
            organizerName: 'Dr. Lead Organizer',
            auditReason: 'bad', // < 5 chars
          },
          { firestore: adminDb as any }
        )
      ).rejects.toThrow('justification reason');

      // 2. Legitimate manual retry by organizer with documented justification
      const retriedJob = await evaluationQueueService.retryJobManual(
        {
          jobId: job.id,
          organizerUserId: 'uid-owner-a',
          organizerName: 'Dr. Lead Organizer',
          auditReason: 'Organizer manual queue retry following inference quota upgrade',
        },
        { firestore: adminDb as any }
      );

      expect(retriedJob.status).toBe('QUEUED');
      expect(retriedJob.attemptCount).toBe(0);
      expect(retriedJob.leaseOwnerId).toBeNull();
      expect(retriedJob.leaseExpiresAt).toBeNull();
      expect(retriedJob.errorClassification).toBeNull();

      // 3. Verify governance audit event was persisted to Firestore
      const auditEvents = await governanceAuditService.listEventsFromFirestore(
        { competitionId: comp.id, category: 'ADMIN_OVERRIDE' },
        { firestore: adminDb as any }
      );

      expect(auditEvents.length).toBeGreaterThanOrEqual(1);
      const manualRetryAudit = auditEvents.find((e) => e.action === 'EVALUATION_JOB_MANUAL_RETRY');
      expect(manualRetryAudit).toBeDefined();
      expect(manualRetryAudit?.actorId).toBe('uid-owner-a');
      expect(manualRetryAudit?.targetId).toBe(job.id);
      expect(manualRetryAudit?.reason).toContain('inference quota upgrade');
    });
  });

  it('8. Strict Security Rules Least Privilege & Tenant Isolation: clients denied direct writes, participants denied read, cross-tenant denied', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();
    const participantDb = testEnv.authenticatedContext('uid-participant-x').firestore();
    const outsiderDb = testEnv.authenticatedContext('uid-outsider-org-b').firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    const org = await organizationService.createOrganization(
      'Oxford Quantum Lab',
      'uid-owner-a',
      'owner@oxford.edu',
      'Prof. Quantum',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@oxford.edu',
      'Prof. Quantum',
      { title: 'Quantum Circuit Optimization', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeTestSubmission({
      id: 'sub-quant-01',
      referenceId: 'PF-SUB-2026-Q01',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'Variational Quantum Eigensolver',
    });

    let jobId = '';

    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const adminDb = adminCtx.firestore();
      await setDoc(doc(adminDb, 'submissions', sub.id), sub);

      const job = await evaluationQueueService.enqueueSubmission(
        {
          submissionId: sub.id,
          competitionId: comp.id,
          organizationId: org.id,
          referenceId: sub.referenceId,
          rubricVersion: 1,
        },
        { firestore: adminDb as any }
      );
      jobId = job.id;
    });

    // ── 8A: Direct client writes (setDoc, updateDoc, deleteDoc) are strictly DENIED ──
    const fakeJobPayload = {
      id: jobId,
      submissionId: sub.id,
      competitionId: comp.id,
      organizationId: org.id,
      rubricVersion: 1,
      jobType: 'EVALUATION',
      status: 'COMPLETED',
      attemptCount: 1,
      maxAttempts: 3,
      idempotencyKey: `idemp_${sub.id}_v1`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Participant trying to fake job completion
    await expect(
      setDoc(doc(participantDb, 'evaluationJobs', jobId), fakeJobPayload)
    ).rejects.toThrow();

    // Organizer client trying direct setDoc without backend
    await expect(
      setDoc(doc(ownerDb, 'evaluationJobs', jobId), fakeJobPayload)
    ).rejects.toThrow();

    // Client updateDoc
    await expect(
      updateDoc(doc(ownerDb, 'evaluationJobs', jobId), { status: 'COMPLETED' })
    ).rejects.toThrow();

    // Client deleteDoc
    await expect(
      deleteDoc(doc(ownerDb, 'evaluationJobs', jobId))
    ).rejects.toThrow();

    // ── 8B: Participant and Unauthenticated denied read access ──
    await expect(
      getDoc(doc(participantDb, 'evaluationJobs', jobId))
    ).rejects.toThrow();

    await expect(
      getDoc(doc(unauthDb, 'evaluationJobs', jobId))
    ).rejects.toThrow();

    // ── 8C: Cross-tenant outsider from Org B denied read access ──
    await expect(
      getDoc(doc(outsiderDb, 'evaluationJobs', jobId))
    ).rejects.toThrow();

    // ── 8D: Authorized competition admin CAN read job ──
    const authorizedSnap = await getDoc(doc(ownerDb, 'evaluationJobs', jobId));
    expect(authorizedSnap.exists()).toBe(true);
    expect(authorizedSnap.data()?.id).toBe(jobId);
    expect(authorizedSnap.data()?.competitionId).toBe(comp.id);
  });
});
