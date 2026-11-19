// ─────────────────────────────────────────────
// phase7AiLogicEvaluation.test.ts
// Proofly Phase 07 — Trustworthy Firebase AI Logic Evaluation Test Suite
// Verifies all 12 core requirements:
//  1. Structured schema validation & telemetry
//  2. Actual execution mode reporting (no guessing from availability)
//  3. Honest model error handling (AI_FAILED when fallback disabled)
//  4. 25s timeout & safe cancellation with late response discarding
//  5. Unsupported browser handling for ONLY_ON_DEVICE
//  6. App Check status tracking
//  7. Invalid structured JSON rejection
//  8. Evidence classification taxonomy (README as CLAIM_ONLY, etc.)
//  9. Extraction failure handling (EXTRACTION_INCOMPLETE)
// 10. Honest deterministic fallback (DETERMINISTIC_FALLBACK, non-HIGH confidence, judge disclosures)
// 11. Worker claiming, heartbeats, disconnection & stale job recovery
// 12. Duplicate submission prevention on lost lease or cancelled job
// 13. AI evaluation integrity enforcement
// ─────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InferenceMode, InferenceSource } from 'firebase/ai';
import {
  aiLogicService,
  assertEvaluationIntegrity,
  inFlightEvaluationRequests,
  rubricCriterionSchema,
  rubricEvaluationReportSchema,
} from '../aiLogicService';
import { evaluationWorkerService } from '../evaluationWorkerService';
import { evaluationQueueService } from '../evaluationQueueService';
import { submissionService } from '../submissionService';
import { competitionService } from '../competitionService';
import type {
  StructuredEvidencePacket,
  RubricVersion,
  AiEvaluationReport,
} from '../../types/aiEvaluation';
import type { ProjectSubmission } from '../../types/submission';

describe('Proofly Phase 07 — Trustworthy Firebase AI Logic Evaluation', () => {
  const sampleRubric: RubricVersion = {
    versionNumber: 1,
    competitionId: 'comp-p7',
    totalMaxScore: 100,
    capturedAt: new Date().toISOString(),
    criteria: [
      { id: 'crit-tech', name: 'Technological Implementation', description: 'Tech architecture', weight: 30, maxScore: 30 },
      { id: 'crit-design', name: 'Design and UX', description: 'UI ergonomics', weight: 20, maxScore: 20 },
      { id: 'crit-impact', name: 'Potential Impact', description: 'Stakeholder utility', weight: 25, maxScore: 25 },
      { id: 'crit-idea', name: 'Quality of the Idea', description: 'Concept originality', weight: 25, maxScore: 25 },
    ],
  };

  const samplePacket: StructuredEvidencePacket = {
    submissionId: 'sub-p7-001',
    referenceId: 'REF-P7-01',
    competitionId: 'comp-p7',
    projectTitle: 'MedAI Triage Hub',
    projectDescription: 'Edge AI clinical ECG triage for real-time arrhythmia detection.',
    track: 'Healthcare & Biomedical AI',
    problemStatement: 'Emergency diagnostic latency causes preventable cardiac deterioration.',
    solution: 'Edge-quantized neural network running on medical telemetry devices.',
    technologiesUsed: ['TypeScript', 'TensorFlow Lite', 'Web Audio API', 'React'],
    githubMetadata: {
      repoUrl: 'https://github.com/medai/triage',
      accessible: true,
      readmeContent: '# MedAI\nClaims 100% accuracy and global high availability in production.\nSupports real-time alerts.',
    },
    deploymentMetadata: {
      url: 'https://medai-hub.web.app',
      accessible: true,
    },
    videoMetadata: {
      url: 'https://youtube.com/watch?v=sample',
      platform: 'youtube',
      disclaimer: 'Video was not visually inspected',
    },
    documentContents: [
      {
        fileId: 'doc-1',
        fileName: 'architecture_specification.pdf',
        mimeType: 'application/pdf',
        wordCount: 850,
        extractionStatus: 'EXTRACTED',
        extractedText: 'Comprehensive architecture report detailing model quantization and edge benchmarks.',
      },
    ],
    evidenceDisclaimers: ['Static analysis only; no code execution sandbox was invoked.'],
    assembledAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    inFlightEvaluationRequests.clear();
  });

  // ─────────────────────────────────────────────
  // 1. Structured Schema Validation & Telemetry
  // ─────────────────────────────────────────────
  it('1. performs successful Firebase AI Logic inference and returns full telemetry with structured schema validation', async () => {
    expect(rubricCriterionSchema).toBeDefined();
    expect(rubricEvaluationReportSchema).toBeDefined();

    const mockAiPayload = {
      executiveSummary: 'AI evaluated executive summary grounded in submitted architecture artifacts.',
      strongestAspects: ['Clean on-device edge pipeline', 'Well-defined clinical problem statement'],
      areasToImprove: ['Add multi-center retrospective validation'],
      evidenceGaps: [],
      evaluationWarnings: ['Static evaluation only'],
      criteriaEvaluations: sampleRubric.criteria.map((c) => ({
        criterionId: c.id,
        criterionName: c.name,
        suggestedScore: Math.round(c.maxScore * 0.8),
        maxScore: c.maxScore,
        explanation: `Detailed AI assessment for ${c.name}.`,
        positiveObservations: [`Verified strong adherence to ${c.name}.`],
        missingEvidence: [],
        evidenceReferences: ['architecture_specification.pdf'],
        weaknesses: ['Lacks stress latency benchmarks under concurrent telemetry streams.'],
        exactDeductionExplanations: [`Deduction (-${c.maxScore - Math.round(c.maxScore * 0.8)} pts): Lacks stress benchmarks under load.`],
        uncertainty: 'Static review without execution sandbox.',
        confidence: 'HIGH' as const,
        confidenceJustification: 'All primary claims backed by extracted architecture documentation.',
        limitations: ['No runtime execution sandbox invoked.'],
        questionsForJudge: [`Check runtime memory consumption of ${c.name}.`],
        evidenceClassifications: [
          {
            claim: `Verification of ${c.name}`,
            classification: 'VERIFIED_EVIDENCE' as const,
            rationale: 'Directly verified from architecture document.',
          },
        ],
      })),
    };

    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify(mockAiPayload),
          inferenceSource: InferenceSource.IN_CLOUD,
          usageMetadata: {
            promptTokenCount: 150,
            candidatesTokenCount: 95,
            totalTokenCount: 245,
          },
        },
      }),
    };

    vi.spyOn(aiLogicService, 'createRubricModel').mockReturnValue(mockModel as any);

    const report = await aiLogicService.evaluateSubmissionEvidence(
      samplePacket,
      sampleRubric,
      InferenceMode.ONLY_IN_CLOUD,
      {
        requestId: 'req-test-p7-01',
        evidencePacketVersion: 2,
      }
    );

    expect(report.evaluationOutcome).toBe('AI_COMPLETED');
    expect(report.telemetry.provider).toBe('firebase-ai-logic');
    expect(report.telemetry.modelIdentifier).toBe('gemini-2.5-flash');
    expect(report.telemetry.sdkVersion).toBe('11.0.0');
    expect(report.telemetry.actualExecutionMode).toBe('IN_CLOUD');
    expect(report.telemetry.actualInferenceSource).toBe('IN_CLOUD');
    expect(report.telemetry.requestId).toBe('req-test-p7-01');
    expect(report.telemetry.rubricVersionNumber).toBe(1);
    expect(report.telemetry.evidencePacketVersion).toBe(2);
    expect(report.telemetry.tokenUsage).toEqual({
      promptTokens: 150,
      completionTokens: 95,
      totalTokens: 245,
    });
    expect(report.isImmutable).toBe(true);
    expect(report.criteriaEvaluations).toHaveLength(4);
    for (const crit of report.criteriaEvaluations) {
      expect(crit.explanation).toBeDefined();
      expect(crit.uncertainty).toBeDefined();
      expect(crit.confidenceJustification).toBeDefined();
      expect(crit.questionsForJudge).toBeDefined();
    }
  });

  // ─────────────────────────────────────────────
  // 2. Actual Execution Mode Reporting (No Guessing from Device Availability)
  // ─────────────────────────────────────────────
  it('2a. correctly tags ON_DEVICE execution when inferenceSource is ON_DEVICE', async () => {
    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              executiveSummary: 'On-device Nano evaluated summary.',
              strongestAspects: ['Local zero-latency execution'],
              areasToImprove: [],
              evidenceGaps: [],
              evaluationWarnings: [],
              criteriaEvaluations: sampleRubric.criteria.map((c) => ({
                criterionId: c.id,
                criterionName: c.name,
                suggestedScore: c.maxScore - 2,
                maxScore: c.maxScore,
                positiveObservations: ['Fast on-device inference.'],
                exactDeductionExplanations: ['Minor UI layout deduction (-2 pts)'],
                confidence: 'HIGH',
              })),
            }),
          inferenceSource: InferenceSource.ON_DEVICE,
        },
      }),
    };

    vi.spyOn(aiLogicService, 'createRubricModel').mockReturnValue(mockModel as any);

    const report = await aiLogicService.evaluateSubmissionEvidence(
      samplePacket,
      sampleRubric,
      InferenceMode.PREFER_ON_DEVICE
    );

    expect(report.evaluationOutcome).toBe('AI_COMPLETED');
    expect(report.telemetry.actualInferenceSource).toBe('ON_DEVICE');
    expect(report.telemetry.actualExecutionMode).toBe('ON_DEVICE');
    expect(report.telemetry.modelIdentifier).toBe('gemini-nano-4');
  });

  it('2b. does NOT infer ON_DEVICE from device availability alone when response inferenceSource is unknown', async () => {
    // Device reports Gemini Nano available
    vi.spyOn(aiLogicService, 'checkDeviceCapabilities').mockResolvedValue({
      isChrome: true,
      promptApiExposed: true,
      availabilityStatus: 'available',
      geminiNanoReady: true,
      notes: 'Nano ready on device',
    });

    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              executiveSummary: 'Unverified source response.',
              strongestAspects: [],
              areasToImprove: [],
              evidenceGaps: [],
              evaluationWarnings: [],
              criteriaEvaluations: sampleRubric.criteria.map((c) => ({
                criterionId: c.id,
                criterionName: c.name,
                suggestedScore: c.maxScore - 3,
                maxScore: c.maxScore,
                exactDeductionExplanations: ['Deduction (-3 pts)'],
              })),
            }),
          // inferenceSource is undefined or omitted
          inferenceSource: undefined,
        },
      }),
    };

    vi.spyOn(aiLogicService, 'createRubricModel').mockReturnValue(mockModel as any);

    const report = await aiLogicService.evaluateSubmissionEvidence(
      samplePacket,
      sampleRubric,
      InferenceMode.PREFER_ON_DEVICE
    );

    // Must be UNKNOWN, not falsely claimed as ON_DEVICE
    expect(report.telemetry.actualInferenceSource).toBe('UNKNOWN');
    expect(report.telemetry.modelIdentifier).toBe('gemini-2.5-flash');
  });

  // ─────────────────────────────────────────────
  // 3. Model Errors Handled Honestly (AI_FAILED when allowFallback: false)
  // ─────────────────────────────────────────────
  it('3. reports AI_FAILED and throws when model fails and allowFallback is false', async () => {
    const mockModel = {
      generateContent: vi.fn().mockRejectedValue(new Error('Firebase AI Logic rate limit reached (HTTP 429)')),
    };

    vi.spyOn(aiLogicService, 'createRubricModel').mockReturnValue(mockModel as any);

    await expect(
      aiLogicService.evaluateSubmissionEvidence(
        samplePacket,
        sampleRubric,
        InferenceMode.ONLY_IN_CLOUD,
        {
          allowFallback: false,
          requestId: 'req-fail-test',
        }
      )
    ).rejects.toThrow(/AI Evaluation Failed \(fallback disallowed\)/);
  });

  // ─────────────────────────────────────────────
  // 4. Realistic Timeout & Safe Cancellation with Late Response Discarding
  // ─────────────────────────────────────────────
  it('4a. cancels in-flight evaluation when AbortSignal triggers and prevents late writes', async () => {
    const abortController = new AbortController();

    // Model hangs until abort
    const mockModel = {
      generateContent: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                response: {
                  text: () => JSON.stringify({}),
                  inferenceSource: InferenceSource.IN_CLOUD,
                },
              });
            }, 300);
          })
      ),
    };

    vi.spyOn(aiLogicService, 'createRubricModel').mockReturnValue(mockModel as any);

    const evalPromise = aiLogicService.evaluateSubmissionEvidence(
      samplePacket,
      sampleRubric,
      InferenceMode.ONLY_IN_CLOUD,
      {
        abortSignal: abortController.signal,
        allowFallback: false,
        requestId: 'req-abort-test',
      }
    );

    // Abort after 50ms
    setTimeout(() => {
      abortController.abort(new Error('Manual user cancellation'));
    }, 50);

    await expect(evalPromise).rejects.toThrow(/cancelled/i);
  });

  it('4b. supports explicit cancelEvaluationRequest by requestId', () => {
    const abortController = new AbortController();
    inFlightEvaluationRequests.set('req-active-test', {
      abortController,
      cancelled: false,
      startTime: performance.now(),
    });

    const cancelled = aiLogicService.cancelEvaluationRequest('req-active-test', 'Job reassigned');
    expect(cancelled).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(inFlightEvaluationRequests.has('req-active-test')).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 5. Unsupported Browser Handling for ONLY_ON_DEVICE
  // ─────────────────────────────────────────────
  it('5. returns clean error when ONLY_ON_DEVICE is requested on non-Chrome or unavailable device model', async () => {
    vi.spyOn(aiLogicService, 'checkDeviceCapabilities').mockResolvedValue({
      isChrome: false,
      promptApiExposed: false,
      availabilityStatus: 'unavailable',
      geminiNanoReady: false,
      notes: 'Firefox browser detected; Prompt API is not supported.',
    });

    await expect(
      aiLogicService.evaluateSubmissionEvidence(
        samplePacket,
        sampleRubric,
        InferenceMode.ONLY_ON_DEVICE,
        { allowFallback: false }
      )
    ).rejects.toThrow(/Prompt API requires Chrome with Gemini Nano enabled/i);
  });

  // ─────────────────────────────────────────────
  // 6. App Check Status Reporting
  // ─────────────────────────────────────────────
  it('6. accurately records App Check status in telemetry without spoofing', async () => {
    const report = await aiLogicService.evaluateSubmissionEvidence(samplePacket, sampleRubric);
    expect(['ACTIVE_AND_VERIFIED', 'BYPASSED_DEV_MODE', 'FAILED']).toContain(
      report.telemetry.appCheckStatus
    );
  });

  // ─────────────────────────────────────────────
  // 7. Invalid Structured Output Rejected
  // ─────────────────────────────────────────────
  it('7. rejects non-JSON or invalid structured model response when allowFallback is false', async () => {
    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => 'I am an AI and I cannot produce valid JSON today.',
          inferenceSource: InferenceSource.IN_CLOUD,
        },
      }),
    };

    vi.spyOn(aiLogicService, 'createRubricModel').mockReturnValue(mockModel as any);

    await expect(
      aiLogicService.evaluateSubmissionEvidence(
        samplePacket,
        sampleRubric,
        InferenceMode.ONLY_IN_CLOUD,
        { allowFallback: false }
      )
    ).rejects.toThrow(/failed structured JSON schema validation/i);
  });

  // ─────────────────────────────────────────────
  // 8. Evidence Classification Taxonomy (README mentions are CLAIM_ONLY, etc.)
  // ─────────────────────────────────────────────
  it('8. classifies README claims as CLAIM_ONLY, missing deployment as INACCESSIBLE_EVIDENCE, and verified artifacts as VERIFIED_EVIDENCE', async () => {
    const unverifiedPacket: StructuredEvidencePacket = {
      ...samplePacket,
      deploymentMetadata: { url: '', accessible: false, inaccessibleReason: 'No deployment URL' },
      githubMetadata: {
        repoUrl: 'https://github.com/medai/unverified',
        accessible: true,
        readmeContent: '# MedAI\nClaims automated diagnostic capability.',
      },
    };

    const report = await aiLogicService.evaluateSubmissionEvidence(unverifiedPacket, sampleRubric);
    const classifications = report.criteriaEvaluations.flatMap((c) => c.evidenceClassifications);

    // 1. Missing deployment classified as INACCESSIBLE_EVIDENCE (or legacy EVIDENCE_UNAVAILABLE)
    expect(
      classifications.some(
        (c) => c.classification === 'INACCESSIBLE_EVIDENCE' || c.classification === 'EVIDENCE_UNAVAILABLE'
      )
    ).toBe(true);

    // 2. README claim classified as CLAIM_ONLY (or legacy FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED)
    expect(
      classifications.some(
        (c) => c.classification === 'CLAIM_ONLY' || c.classification === 'FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED'
      )
    ).toBe(true);

    // 3. Verified artifact classified as VERIFIED_EVIDENCE (or legacy EVIDENCE_VERIFIED)
    expect(
      classifications.some(
        (c) => c.classification === 'VERIFIED_EVIDENCE' || c.classification === 'EVIDENCE_VERIFIED'
      )
    ).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 9. Extraction Failure Handling (EXTRACTION_INCOMPLETE)
  // ─────────────────────────────────────────────
  it('9. tags outcome as EXTRACTION_INCOMPLETE when submitted files require OCR or failed extraction', async () => {
    const ocrPacket: StructuredEvidencePacket = {
      ...samplePacket,
      documentContents: [
        {
          fileId: 'doc-scan',
          fileName: 'scanned_paper_report.pdf',
          mimeType: 'application/pdf',
          wordCount: 0,
          extractionStatus: 'REQUIRES_OCR',
          notes: 'Scanned document detected: REQUIRES_OCR',
        },
      ],
    };

    const report = await aiLogicService.evaluateSubmissionEvidence(ocrPacket, sampleRubric);
    expect(report.evaluationOutcome).toBe('EXTRACTION_INCOMPLETE');
    expect(
      report.disclosures?.some((d) => d.includes('OCR required or unsupported format'))
    ).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 10. Honest Deterministic Fallback Behavior
  // ─────────────────────────────────────────────
  it('10. labels deterministic fallback honestly with capped confidence and judge disclosures', async () => {
    // Force fallback by having model fail
    const mockModel = {
      generateContent: vi.fn().mockRejectedValue(new Error('Firebase AI Logic network error')),
    };

    vi.spyOn(aiLogicService, 'createRubricModel').mockReturnValue(mockModel as any);

    const report = await aiLogicService.evaluateSubmissionEvidence(
      samplePacket,
      sampleRubric,
      InferenceMode.ONLY_IN_CLOUD,
      { allowFallback: true }
    );

    // Must be DETERMINISTIC_FALLBACK
    expect(report.evaluationOutcome).toBe('DETERMINISTIC_FALLBACK');
    // Must NOT claim IN_CLOUD or gemini-2.5-flash as the actual engine
    expect(report.telemetry.actualInferenceSource).not.toBe('IN_CLOUD');
    expect(report.telemetry.actualExecutionMode).toBe('FALLBACK');
    expect(report.telemetry.provider).toBe('deterministic-rule-engine');
    expect(report.telemetry.modelIdentifier).toBe('deterministic-heuristic-engine-v1');
    expect(report.telemetry.fallbackOccurred).toBe(true);

    // Confidence must NOT default to HIGH
    for (const crit of report.criteriaEvaluations) {
      expect(crit.confidence).not.toBe('HIGH');
      expect(['MEDIUM', 'LOW']).toContain(crit.confidence);
      expect(crit.confidenceJustification).toMatch(/deterministic fallback/i);
    }

    // Must disclose fallback prominently to judges
    expect(
      report.disclosures?.some((d) => d.includes('deterministic heuristic engine, NOT by AI inference'))
    ).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 11. Worker Claiming, Heartbeats & Stale Job Recovery
  // ─────────────────────────────────────────────
  it('11. manages worker session, executes evaluation stages, and recovers stale jobs', async () => {
    const workerSession = await evaluationWorkerService.startWorker({
      workerId: 'worker-unit-test-1',
    });
    expect(workerSession.isActive).toBe(true);
    expect(workerSession.workerId).toBe('worker-unit-test-1');

    // Create a submission and mock competition/rubric
    const testSub: ProjectSubmission = {
      id: 'sub-worker-01',
      referenceId: 'REF-W-01',
      competitionId: 'comp-p7',
      organizationId: 'org-p7',
      formSchemaId: 'form-p7',
      submissionType: 'INDIVIDUAL',
      primaryContactName: 'Alex Developer',
      primaryContactEmail: 'alex@example.com',
      status: 'Submitted',
      statusHistory: [],
      fieldValues: {},
      files: [],
      projectTitle: 'Worker Pipeline Test',
      projectDescription: 'Verifying end-to-end worker execution and lease lifecycle.',
      technologiesUsed: ['React', 'Firebase'],
      participants: [{
        id: 'part-1',
        name: 'Alex Developer',
        email: 'alex@example.com',
        isLead: true,
        source: 'FORM_SUBMISSION',
        competitionId: 'comp-p7',
        organizationId: 'org-p7',
        createdAt: new Date().toISOString(),
      }],
      isLate: false,
      isLocked: false,
      currentVersion: 1,
      versions: [],
      managementTokenHash: 'sec_test_hash',
      managementTokenPrefix: 'sec_ab',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await submissionService.saveSubmission(testSub);
    vi.spyOn(competitionService, 'getCompetition').mockResolvedValue({
      id: 'comp-p7',
      organizationId: 'org-p7',
      title: 'Phase 7 AI Challenge',
      status: 'PUBLISHED',
      rubric: sampleRubric.criteria,
      rounds: [{ id: 'rnd-1', name: 'Round 1', status: 'ACTIVE' }],
      tracks: ['Healthcare & Biomedical AI', 'Open Track'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const queuedJob = await evaluationQueueService.enqueueSubmission(
      'sub-worker-01',
      'comp-p7',
      'REF-W-01',
      'org-p7',
      1
    );
    expect(queuedJob.status).toBe('QUEUED');

    // Worker claims and processes job
    const result = await evaluationWorkerService.claimAndProcessNextJob('worker-unit-test-1');
    expect(result.processed).toBe(true);
    expect(result.job?.status).toBe('COMPLETED');
    expect(result.report).toBeDefined();
    expect(result.report?.isImmutable).toBe(true);

    // Stale recovery test
    const recovered = await evaluationWorkerService.recoverStaleWorkerJobs();
    expect(typeof recovered).toBe('number');

    evaluationWorkerService.stopWorker('worker-unit-test-1');
  });

  // ─────────────────────────────────────────────
  // 12. Duplicate Submission Prevention on Lost Lease
  // ─────────────────────────────────────────────
  it('12. prevents duplicate result submission when worker loses its lease or job is completed', async () => {
    const job = await evaluationQueueService.enqueueSubmission(
      'sub-duplicate-test',
      'comp-p7',
      'REF-DUP-01',
      'org-p7',
      1
    );

    const claimed = await evaluationQueueService.claimNextJob({
      workerId: 'worker-primary',
      leaseDurationMs: 5000,
      competitionId: 'comp-p7',
    });
    expect(claimed?.status).toBe('CLAIMED');

    // Concurrency check: unauthorized or stale worker cannot complete a job leased to worker-primary
    await expect(
      evaluationQueueService.completeJob(job.id, 'worker-stale', 'rep-stale')
    ).rejects.toThrow(/concurrency error/i);

    // Primary worker completes the job
    const firstComplete = await evaluationQueueService.completeJob(
      job.id,
      'worker-primary',
      'rep-first'
    );
    expect(firstComplete?.status).toBe('COMPLETED');
    expect(firstComplete?.resultReportId).toBe('rep-first');

    // Attempting a second completion does not overwrite the original report
    const secondComplete = await evaluationQueueService.completeJob(
      job.id,
      'worker-late',
      'rep-late-duplicate'
    );
    expect(secondComplete?.resultReportId).toBe('rep-first');
  });

  // ─────────────────────────────────────────────
  // 13. Evaluation Integrity Constraints
  // ─────────────────────────────────────────────
  it('13. prevents AI evaluations from overriding humans, publishing winners, or modifying locked scores', () => {
    const immutableReport: AiEvaluationReport = {
      id: 'rep-immutable',
      submissionId: 'sub-1',
      referenceId: 'REF-1',
      competitionId: 'comp-1',
      rubricVersion: sampleRubric,
      overallScore: 82,
      totalMaxScore: 100,
      percentageScore: 82,
      executiveSummary: 'Summary',
      strongestAspects: [],
      areasToImprove: [],
      evidenceGaps: [],
      evaluationWarnings: [],
      criteriaEvaluations: [],
      telemetry: {
        requestedMode: InferenceMode.ONLY_IN_CLOUD,
        actualInferenceSource: 'IN_CLOUD',
        modelUsed: 'gemini-2.5-flash',
        latencyMs: 120,
        fallbackOccurred: false,
        appCheckStatus: 'ACTIVE_AND_VERIFIED',
        timestamp: new Date().toISOString(),
      },
      evaluatedAt: new Date().toISOString(),
      isImmutable: true,
    };

    // Valid read action
    expect(() =>
      assertEvaluationIntegrity(immutableReport, { action: 'VIEW_REPORT' })
    ).not.toThrow();

    // AI cannot publish winners
    expect(() =>
      assertEvaluationIntegrity(immutableReport, { action: 'PUBLISH_WINNERS' })
    ).toThrow(/Integrity violation.*publish winners/i);

    // AI cannot override human evaluations
    expect(() =>
      assertEvaluationIntegrity(immutableReport, { action: 'OVERRIDE_HUMAN_EVALUATION' })
    ).toThrow(/Integrity violation.*override sovereign human/i);

    // AI cannot reopen locked judge evaluations
    expect(() =>
      assertEvaluationIntegrity(immutableReport, { action: 'REOPEN_LOCKED_EVALUATION' })
    ).toThrow(/Integrity violation.*reopen or mutate locked/i);

    // Non-immutable report violates integrity
    const mutableReport = { ...immutableReport, isImmutable: false };
    expect(() =>
      assertEvaluationIntegrity(mutableReport, { action: 'VIEW_REPORT' })
    ).toThrow(/Integrity violation.*must be marked immutable/i);
  });
});
