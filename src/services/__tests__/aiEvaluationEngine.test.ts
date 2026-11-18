// ─────────────────────────────────────────────
// aiEvaluationEngine.test.ts — Phase 6 Test Suite
// Proofly / Evalora — AI-Powered Evaluation Engine
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { contentExtractionService } from '../contentExtractionService';
import { rubricEngineService } from '../rubricEngineService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { evaluationQueueService } from '../evaluationQueueService';
import { submissionService } from '../submissionService';
import { submissionLifecycleService } from '../submissionLifecycleService';
import { competitionService } from '../competitionService';
import type { Competition } from '../../types/authAndCompetition';
import type { ProjectSubmission, StoredFileMetadata } from '../../types/submission';
import type { StructuredEvidencePacket, RubricVersion } from '../../types/aiEvaluation';
import { InferenceMode } from 'firebase/ai';

describe('Phase 6: AI-Powered Evaluation Engine', () => {
  const competitionId = 'comp_eval_engine_phase6';
  const orgId = 'org_eval_phase6';

  const sampleCompetition: Competition = {
    id: competitionId,
    organizationId: orgId,
    title: 'Hybrid AI Innovation Challenge 2026',
    slug: 'hybrid-ai-innovation-challenge-2026',
    tagline: 'Better reviews. Clearer decisions.',
    description: 'Competition testing on-device Gemini Nano 4 and Cloud Gemini 2.5 Flash evaluation.',
    type: 'HACKATHON',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    participationType: 'BOTH',
    startDate: new Date(Date.now() - 86400000).toISOString(),
    endDate: new Date(Date.now() + 86400000 * 7).toISOString(),
    evaluationDeadline: new Date(Date.now() + 86400000 * 10).toISOString(),
    publicAccessCode: 'EVAL-PHASE6',
    policies: {
      teamSubmissionsEnabled: true,
      minTeamMembers: 1,
      maxTeamMembers: 5,
      individualSubmissionsAllowed: true,
      submissionDeadline: new Date(Date.now() + 86400000 * 3).toISOString(),
      allowLateSubmissions: false,
      allowSubmissionEdits: true,
      aiEvaluationEnabled: true,
      judgeFeedbackVisibleToParticipants: true,
      aiScoresVisibleToParticipants: true,
    },
    rounds: [],
    rubric: [
      {
        id: 'crit-tech-arch',
        name: 'Technical Architecture & Execution',
        description: 'Soundness of technical design, performance, and implementation.',
        weight: 35,
        maxScore: 35,
      },
      {
        id: 'crit-problem-impact',
        name: 'Problem Statement & Impact',
        description: 'Significance of problem solved and measurable value to target users.',
        weight: 35,
        maxScore: 35,
      },
      {
        id: 'crit-design-ux',
        name: 'Design & Presentation',
        description: 'Usability, clarity of documentation, and presentation polish.',
        weight: 30,
        maxScore: 30,
      },
    ],
    tracks: ['Healthcare & Edge AI', 'Autonomous Agents'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const createSampleSubmission = (overrides?: Partial<ProjectSubmission>): ProjectSubmission => {
    const now = new Date().toISOString();
    return {
      id: `sub-phase6-${Math.random().toString(36).substring(2, 7)}`,
      referenceId: 'PF-SUB-2026-NANO99',
      competitionId,
      organizationId: orgId,
      formSchemaId: 'schema-test',
      submissionType: 'TEAM',
      teamName: 'EdgePulse Pioneers',
      primaryContactName: 'Aria Stark',
      primaryContactEmail: 'aria@edgepulse.dev',
      participants: [
        {
          id: 'p-1',
          name: 'Aria Stark',
          email: 'aria@edgepulse.dev',
          role: 'Lead ML Engineer',
          isLead: true,
          source: 'FORM_SUBMISSION',
          competitionId,
          organizationId: orgId,
          createdAt: now,
        },
      ],
      projectTitle: 'EdgePulse: Zero-Latency Cardiac Telemetry',
      projectDescription:
        'EdgePulse processes electrocardiogram (ECG) waveforms directly on local mobile devices using lightweight quantized edge models. It eliminates latency and protects patient privacy by performing automated arrhythmia classification on-device, falling back to hospital cloud inference only when severe anomalies require multi-lead secondary verification.',
      problemStatement:
        'Traditional ECG telemetry requires streaming sensitive unencrypted biometric feeds across wireless links to remote servers, incurring roundtrip latency of 1200ms+ and risking patient data leaks.',
      solution:
        'An on-device inference pipeline running within 85ms on Chrome Mobile/Android edge hardware, using dual-engine fallback.',
      technologiesUsed: ['TypeScript', 'Firebase AI Logic', 'Gemini Nano', 'WebAssembly', 'Tailwind CSS'],
      githubUrl: 'https://github.com/edgepulse/edgepulse-core',
      deploymentUrl: 'https://edgepulse.web.app',
      videoUrl: 'https://youtube.com/watch?v=demo-edgepulse-2026',
      fieldValues: {},
      files: [
        {
          id: 'file-1',
          fieldId: 'architecture_doc',
          fileName: 'Architecture_Blueprint.pdf',
          fileSize: 1024 * 500,
          mimeType: 'application/pdf',
          storagePath: 'competitions/comp_eval_engine_phase6/Architecture_Blueprint.pdf',
          downloadUrl: 'data:application/pdf;base64,JVBERi0xLjQKJUVDRyBNb2RlbCBJbmZlcmVuY2UgQXJjaGl0ZWN0dXJlIGFuZCBTdHJlYW0gUHJvY2Vzc2luZw==',
          uploadedAt: now,
          isVerified: true,
        },
        {
          id: 'file-2',
          fieldId: 'pitch_deck',
          fileName: 'EdgePulse_Deck.pptx',
          fileSize: 1024 * 1200,
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          storagePath: 'competitions/comp_eval_engine_phase6/EdgePulse_Deck.pptx',
          downloadUrl: 'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEtDBBQAAAAIAAAAAABPbkRldmljZSBDYXJkaW92YXNjdWxhciBQcmVzZW50YXRpb24gU2xpZGVz',
          uploadedAt: now,
          isVerified: true,
        },
      ],
      status: 'Queued for AI Evaluation',
      statusHistory: [
        {
          status: 'Submitted',
          changedAt: now,
          changedBy: 'participant',
          note: 'Final project submitted',
        },
        {
          status: 'Validating',
          changedAt: now,
          changedBy: 'system',
          note: 'Files validated',
        },
        {
          status: 'Queued for AI Evaluation',
          changedAt: now,
          changedBy: 'system',
          note: 'Enqueued for AI Logic',
        },
      ],
      isLate: false,
      isLocked: false,
      currentVersion: 1,
      versions: [],
      managementTokenHash: 'mock-hash-val',
      managementTokenPrefix: 'sec_test',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  };

  beforeEach(async () => {
    rubricEngineService.clearMemoryStore();
    evaluationQueueService.clearMemoryStore();
    evaluationPipelineService.clearMemoryStore();
    submissionService.clearMemoryStore();
    competitionService.resetInMemoryStore([sampleCompetition]);
  });

  // ─────────────────────────────────────────────
  // 1. Multimodal Content Extraction & Disclaimers
  // ─────────────────────────────────────────────
  describe('1. Multimodal Content Extraction & Evidence Rules', () => {
    it('extracts text from plain text and markdown documents accurately', async () => {
      const textFile: StoredFileMetadata = {
        id: 'f-txt-1',
        fieldId: 'readme_file',
        fileName: 'README.md',
        fileSize: 450,
        mimeType: 'text/markdown',
        storagePath: 'competitions/test/README.md',
        downloadUrl: 'data:text/markdown;charset=utf-8,#%20EdgePulse%20Core%0A%0AHigh%20performance%20on-device%20telemetry%20engine.',
        uploadedAt: new Date().toISOString(),
        isVerified: true,
      };

      const docItem = await contentExtractionService.extractFileContent(textFile);
      expect(docItem.extractionStatus).toBe('EXTRACTED');
      expect(docItem.wordCount).toBeGreaterThan(0);
      expect(docItem.extractedText).toContain('EdgePulse Core');
    });

    it('handles binary ZIP archives without penalizing submitters and notes inspection status', async () => {
      const zipFile: StoredFileMetadata = {
        id: 'f-zip-1',
        fieldId: 'source_code_archive',
        fileName: 'source_code.zip',
        fileSize: 1024 * 1024 * 5,
        mimeType: 'application/zip',
        storagePath: 'competitions/test/source_code.zip',
        downloadUrl: 'https://storage.googleapis.com/test-bucket/source_code.zip',
        uploadedAt: new Date().toISOString(),
        isVerified: true,
      };

      const docItem = await contentExtractionService.extractFileContent(zipFile);
      expect(docItem.extractionStatus).toBe('UNSUPPORTED_BINARY');
      expect(docItem.notes).toContain('ZIP archive verified');
    });

    it('attaches mandatory disclaimers for videos and code execution', async () => {
      const submission = createSampleSubmission();
      const packet: StructuredEvidencePacket = await contentExtractionService.extractSubmissionEvidence(submission);

      expect(packet.videoMetadata).toBeDefined();
      expect(packet.videoMetadata?.platform).toBe('youtube');
      expect(packet.videoMetadata?.disclaimer).toContain('Video was not visually or auditorily inspected');

      // Static code analysis disclaimer
      expect(packet.evidenceDisclaimers.some((d) => d.includes('no runtime code execution sandbox was invoked'))).toBe(true);
    });

    it('extracts text from PDF and PPTX slide presentation streams', async () => {
      const submission = createSampleSubmission();
      const packet = await contentExtractionService.extractSubmissionEvidence(submission);

      expect(packet.documentContents.length).toBe(2);
      const pdfDoc = packet.documentContents.find((d) => d.fileName.endsWith('.pdf'));
      const pptDoc = packet.documentContents.find((d) => d.fileName.endsWith('.pptx'));

      expect(pdfDoc).toBeDefined();
      expect(pptDoc).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // 2. Versioned Rubric Engine & Immutability
  // ─────────────────────────────────────────────
  describe('2. Versioned Rubric Engine & Immutability', () => {
    it('creates and snapshots an immutable RubricVersion with exact criteria and weights', async () => {
      const rubricVersion: RubricVersion = await rubricEngineService.getOrCreateRubricVersion(sampleCompetition, 1);

      expect(rubricVersion.versionNumber).toBe(1);
      expect(rubricVersion.competitionId).toBe(competitionId);
      expect(rubricVersion.criteria.length).toBe(3);
      expect(rubricVersion.totalMaxScore).toBe(100);

      const techCrit = rubricVersion.criteria.find((c) => c.id === 'crit-tech-arch');
      expect(techCrit).toBeDefined();
      expect(techCrit?.weight).toBe(35);
      expect(techCrit?.maxScore).toBe(35);
    });

    it('preserves existing RubricVersion so subsequent competition changes do not mutate past evaluation rubrics', async () => {
      const version1 = await rubricEngineService.getOrCreateRubricVersion(sampleCompetition, 1);
      expect(version1.versionNumber).toBe(1);

      // Mutate competition rubric
      const modifiedComp: Competition = {
        ...sampleCompetition,
        rubric: [
          { id: 'crit-tech-arch', name: 'Altered Criteria', description: 'Changed', weight: 50, maxScore: 50 },
          { id: 'crit-new', name: 'Brand New', description: 'Brand new criterion', weight: 50, maxScore: 50 },
        ],
        tracks: ['Healthcare & Edge AI'],
      };

      // Retrieving version 1 must remain identical
      const retrievedV1 = await rubricEngineService.getOrCreateRubricVersion(sampleCompetition, 1);
      expect(retrievedV1.criteria[0].name).toBe('Technical Architecture & Execution');
      expect(retrievedV1.criteria.length).toBe(3);

      // Creating version 2 captures the new schema
      const version2 = await rubricEngineService.getOrCreateRubricVersion(modifiedComp, 2);
      expect(version2.versionNumber).toBe(2);
      expect(version2.criteria.length).toBe(2);
      expect(version2.criteria[0].name).toBe('Altered Criteria');
    });
  });

  // ─────────────────────────────────────────────
  // 3. Reliable Evaluation Queue & Concurrency
  // ─────────────────────────────────────────────
  describe('3. Concurrency-Safe Evaluation Queue & Job Leases', () => {
    it('enqueues a submission and prevents duplicate jobs', async () => {
      const sub = createSampleSubmission();
      await submissionService.saveSubmission(sub);

      const job1 = await evaluationQueueService.enqueueSubmission(sub.id, sub.competitionId, sub.referenceId);
      expect(job1.status).toBe('QUEUED');
      expect(job1.attempts).toBe(0);

      // Attempt duplicate enqueue
      const job2 = await evaluationQueueService.enqueueSubmission(sub.id, sub.competitionId, sub.referenceId);
      expect(job2.id).toBe(job1.id);
      expect(job2.status).toBe('QUEUED');

      const allJobs = await evaluationQueueService.listJobs(competitionId);
      expect(allJobs.filter((j) => j.submissionId === sub.id).length).toBe(1);
    });

    it('claims a job with a time-limited lease preventing concurrent worker collisions', async () => {
      const sub = createSampleSubmission();
      await submissionService.saveSubmission(sub);
      await evaluationQueueService.enqueueSubmission(sub.id, sub.competitionId, sub.referenceId);

      const worker1 = 'worker-tab-alpha';
      const worker2 = 'worker-tab-beta';

      // Worker 1 claims job with 60s lease
      const claimedByW1 = await evaluationQueueService.claimNextJob(worker1, 60000, competitionId);
      expect(claimedByW1).not.toBeNull();
      expect(claimedByW1?.status).toBe('LEASED');
      expect(claimedByW1?.leaseOwnerId).toBe(worker1);
      expect(claimedByW1?.attempts).toBe(1);

      // Worker 2 attempts to claim next job — must be null because lease is active
      const claimedByW2 = await evaluationQueueService.claimNextJob(worker2, 60000, competitionId);
      expect(claimedByW2).toBeNull();
    });

    it('prevents worker 2 from finalizing a job leased to worker 1', async () => {
      const sub = createSampleSubmission();
      await submissionService.saveSubmission(sub);
      const job = await evaluationQueueService.enqueueSubmission(sub.id, sub.competitionId, sub.referenceId);

      const worker1 = 'worker-alpha';
      const worker2 = 'worker-imposter';

      await evaluationQueueService.claimNextJob(worker1, 60000, competitionId);

      // Worker 2 tries to complete the job
      await expect(
        evaluationQueueService.completeJob(job.id, worker2, 'rep-fake')
      ).rejects.toThrow('Concurrency error');
    });

    it('recovers stale expired leases so jobs do not hang if a browser worker crashes', async () => {
      const sub = createSampleSubmission();
      await submissionService.saveSubmission(sub);
      const job = await evaluationQueueService.enqueueSubmission(sub.id, sub.competitionId, sub.referenceId);

      const crashedWorker = 'crashed-browser-worker';
      // Claim job with negative lease duration so it immediately expires
      await evaluationQueueService.claimNextJob(crashedWorker, -1000, competitionId);

      // Fresh worker claims next job
      const recoveryWorker = 'recovery-worker';
      const claimed = await evaluationQueueService.claimNextJob(recoveryWorker, 60000, competitionId);

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.leaseOwnerId).toBe(recoveryWorker);
      expect(claimed?.attempts).toBe(2);
    });

    it('retries failed jobs up to maxAttempts before marking FAILED', async () => {
      const sub = createSampleSubmission();
      await submissionService.saveSubmission(sub);
      const job = await evaluationQueueService.enqueueSubmission(sub.id, sub.competitionId, sub.referenceId);

      const worker = 'worker-retry-test';
      await evaluationQueueService.claimNextJob(worker, 60000, competitionId);

      // Fail attempt 1 -> Reverts to QUEUED
      await evaluationQueueService.failJob(job.id, worker, 'Transient network error', true);
      let loaded = await evaluationQueueService.getJob(job.id);
      expect(loaded?.status).toBe('QUEUED');
      expect(loaded?.attempts).toBe(1);

      // Claim attempt 2 & Fail
      await evaluationQueueService.claimNextJob(worker, 60000, competitionId);
      await evaluationQueueService.failJob(job.id, worker, 'Transient error 2', true);

      // Claim attempt 3 & Fail -> Reaches maxAttempts (3) -> Marks FAILED
      await evaluationQueueService.claimNextJob(worker, 60000, competitionId);
      await evaluationQueueService.failJob(job.id, worker, 'Fatal error 3', true);

      loaded = await evaluationQueueService.getJob(job.id);
      expect(loaded?.status).toBe('FAILED');
      expect(loaded?.lastError).toBe('Fatal error 3');
    });
  });

  // ─────────────────────────────────────────────
  // 4. End-to-End 9-Step Evaluation Pipeline
  // ─────────────────────────────────────────────
  describe('4. End-to-End 9-Step Evaluation Pipeline', () => {
    it('executes full 9-step pipeline and transitions submission to Ready for Judge Review', async () => {
      const submission = createSampleSubmission();
      await submissionService.saveSubmission(submission);

      // Execute 9-step pipeline
      const result = await evaluationPipelineService.executePipeline(
        submission,
        sampleCompetition,
        InferenceMode.PREFER_ON_DEVICE
      );

      expect(result.success).toBe(true);
      expect(result.stepReached).toBe(9);
      expect(result.report).toBeDefined();

      const report = result.report!;
      expect(report.submissionId).toBe(submission.id);
      expect(report.referenceId).toBe(submission.referenceId);
      expect(report.overallScore).toBeGreaterThanOrEqual(0);
      expect(report.overallScore).toBeLessThanOrEqual(report.totalMaxScore);
      expect(report.percentageScore).toBeGreaterThan(0);
      expect(report.isImmutable).toBe(true);
      expect(report.criteriaEvaluations.length).toBe(3);

      // Check evidence classifications on criteria
      for (const crit of report.criteriaEvaluations) {
        expect(crit.suggestedScore).toBeGreaterThanOrEqual(0);
        expect(crit.suggestedScore).toBeLessThanOrEqual(crit.maxScore);
        expect(crit.evidenceClassifications.length).toBeGreaterThan(0);
        expect(crit.confidence).toBeDefined();
        if (crit.suggestedScore < crit.maxScore) {
          expect(crit.exactDeductionExplanations.length).toBeGreaterThan(0);
        }
      }

      // Check updated submission state
      const updatedSub = result.submission;
      expect(updatedSub.status).toBe('Ready for Judge Review');
      expect(updatedSub.aiEvaluationId).toBe(report.id);
      expect(updatedSub.aiScore).toBe(report.overallScore);
      expect(updatedSub.aiCompletedAt).toBeDefined();

      // Verify report persistence
      const loadedReport = await evaluationPipelineService.getEvaluationReport(report.id);
      expect(loadedReport).not.toBeNull();
      expect(loadedReport?.id).toBe(report.id);

      const loadedBySub = await evaluationPipelineService.getReportBySubmissionId(submission.id);
      expect(loadedBySub?.id).toBe(report.id);
    });

    it('evaluates real submission evidence without inventing ungrounded claims', async () => {
      const submission = createSampleSubmission({
        deploymentUrl: undefined, // Intentionally missing deployment
        technologiesUsed: ['TypeScript', 'Firebase AI Logic'],
      });
      await submissionService.saveSubmission(submission);

      const result = await evaluationPipelineService.executePipeline(submission, sampleCompetition);
      expect(result.success).toBe(true);
      const report = result.report!;

      // Check that missing evidence is noted honestly
      const techCrit = report.criteriaEvaluations.find((c) => c.criterionId === 'crit-tech-arch');
      expect(techCrit).toBeDefined();

      // Verified classifications reflect missing deployment URL accurately
      const unavailableClass = techCrit?.evidenceClassifications.find(
        (ec) => ec.classification === 'EVIDENCE_UNAVAILABLE'
      );
      expect(unavailableClass).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // 5. Judge Review Access Gate & Overrides
  // ─────────────────────────────────────────────
  describe('5. Judge Review Access Gate & Organizer Overrides', () => {
    it('blocks human judge access before AI evaluation is complete', () => {
      const queuedSub = createSampleSubmission({ status: 'Queued for AI Evaluation' });
      const inProgressSub = createSampleSubmission({ status: 'AI Evaluation In Progress' });
      const validatingSub = createSampleSubmission({ status: 'Validating' });

      expect(submissionLifecycleService.canJudgeReviewSubmission(queuedSub).allowed).toBe(false);
      expect(submissionLifecycleService.canJudgeReviewSubmission(inProgressSub).allowed).toBe(false);
      expect(submissionLifecycleService.canJudgeReviewSubmission(validatingSub).allowed).toBe(false);
    });

    it('blocks human judge access when AI evaluation fails', () => {
      const failedSub = createSampleSubmission({ status: 'AI Evaluation Failed' });
      const check = submissionLifecycleService.canJudgeReviewSubmission(failedSub);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('AI Evaluation failed');
    });

    it('allows human judge review once status reaches Ready for Judge Review', () => {
      const readySub = createSampleSubmission({
        status: 'Ready for Judge Review',
        aiScore: 88,
        aiEvaluationId: 'rep-valid-123',
      });
      const check = submissionLifecycleService.canJudgeReviewSubmission(readySub);
      expect(check.allowed).toBe(true);
    });

    it('allows human judge review when an organizer applies a documented AI-failure override', async () => {
      const failedSub = createSampleSubmission({ status: 'AI Evaluation Failed' });
      await submissionService.saveSubmission(failedSub);

      // Attempt override without justification reason (must fail)
      await expect(
        evaluationPipelineService.applyOrganizerOverride(failedSub.id, {
          id: 'org-admin-1',
          name: 'Platform Administrator',
          reason: '   ', // empty
        })
      ).rejects.toThrow('justification reason');

      // Apply valid documented override
      const overriddenSub = await evaluationPipelineService.applyOrganizerOverride(failedSub.id, {
        id: 'org-admin-1',
        name: 'Platform Administrator',
        reason: 'Provider rate limit exceeded during peak submission window; manually approved for human review.',
        justificationNotes: 'External repo contains comprehensive automated test suites verified by organizer.',
      });

      expect(overriddenSub.status).toBe('Ready for Judge Review');
      expect(overriddenSub.aiFailureOverride).toBeDefined();
      expect(overriddenSub.aiFailureOverride?.overriddenByName).toBe('Platform Administrator');

      // Gate check now passes
      const gateCheck = submissionLifecycleService.canJudgeReviewSubmission(overriddenSub);
      expect(gateCheck.allowed).toBe(true);
    });
  });
});
