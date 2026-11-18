// ─────────────────────────────────────────────
// sampleProjectsEvaluationVerification.test.ts
// Verification of 5 sample projects across the quality spectrum,
// checking hallucination prevention, evidence classifications,
// hybrid inference telemetry, and separation of AI vs judge scores.
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { contentExtractionService } from '../contentExtractionService';
import { rubricEngineService } from '../rubricEngineService';
import { aiLogicService } from '../aiLogicService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { evaluationQueueService } from '../evaluationQueueService';
import { submissionService } from '../submissionService';
import { submissionLifecycleService } from '../submissionLifecycleService';
import { competitionService } from '../competitionService';
import type { Competition } from '../../types/authAndCompetition';
import type { ProjectSubmission } from '../../types/submission';
import { InferenceMode } from 'firebase/ai';

describe('Manual Evaluation Verification: 5 Sample Projects & Score Separation', () => {
  const competitionId = 'comp-global-ai';
  const orgId = 'org-deepmind';

  const testCompetition: Competition = {
    id: competitionId,
    organizationId: orgId,
    title: 'Global AI Innovation Challenge 2026',
    slug: 'global-ai-challenge-2026',
    tagline: 'Empowering on-device Gemini Nano 4 and hybrid intelligence architectures',
    description: 'Premier hackathon testing automated AI pre-evaluation before human judge review.',
    type: 'INNOVATION_CHALLENGE',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    participationType: 'BOTH',
    startDate: new Date(Date.now() - 86400000).toISOString(),
    endDate: new Date(Date.now() + 86400000 * 7).toISOString(),
    evaluationDeadline: new Date(Date.now() + 86400000 * 10).toISOString(),
    publicAccessCode: 'GAIC-2026-ACTIVE',
    policies: {
      teamSubmissionsEnabled: true,
      minTeamMembers: 1,
      maxTeamMembers: 4,
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
        id: 'crit-tech',
        name: 'Technological Implementation',
        description: 'Architecture robustness, code quality, edge/hybrid integration, and completeness.',
        maxScore: 35,
        weight: 35,
      },
      {
        id: 'crit-impact',
        name: 'Potential Impact',
        description: 'Problem significance and measurable utility to end-users.',
        maxScore: 35,
        weight: 35,
      },
      {
        id: 'crit-design',
        name: 'Design & Presentation',
        description: 'Clarity of documentation, presentation deck, and user experience.',
        maxScore: 30,
        weight: 30,
      },
    ],
    tracks: ['Healthcare & Edge AI', 'Climate & Infrastructure', 'Generative Media'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // ── 5 DISTINCT SAMPLE PROJECTS ──

  // 1. Strong Submission: OmniTrack Health
  const strongSubmission: ProjectSubmission = {
    id: 'sub-sample-1-strong',
    referenceId: 'PF-SUB-2026-STR01',
    competitionId,
    organizationId: orgId,
    formSchemaId: 'schema-test',
    submissionType: 'TEAM',
    teamName: 'OmniTrack Health Labs',
    primaryContactName: 'Dr. Sarah Connor',
    primaryContactEmail: 'sarah@omnitrack.health',
    participants: [
      {
        id: 'p-str-1',
        name: 'Dr. Sarah Connor',
        email: 'sarah@omnitrack.health',
        role: 'Biomedical AI Lead',
        isLead: true,
        source: 'FORM_SUBMISSION',
        competitionId,
        organizationId: orgId,
        createdAt: new Date().toISOString(),
      },
    ],
    projectTitle: 'OmniTrack Health: On-Device Cardiac & Metabolic Anomaly Sentinel',
    projectDescription:
      'OmniTrack executes real-time 12-lead electrocardiogram and photoplethysmogram signal classification locally on client edge devices using quantized Gemini Nano 4. It achieves 65ms inference latency, preserving complete patient data sovereignty under HIPAA/GDPR while escalating anomalous arrhythmia patterns to clinical teams.',
    problemStatement:
      'Continuous biometric monitoring traditionally streams unencrypted raw vitals over cellular links, causing high latency (>1500ms) and exposing sensitive patient records to interception.',
    solution:
      'A WebAssembly and Chrome Prompt API edge pipeline processing continuous waveforms with zero cloud transmission of raw data.',
    technologiesUsed: ['Gemini Nano 4', 'Chrome Prompt API', 'WebAssembly', 'TensorFlow.js', 'React', 'TypeScript'],
    githubUrl: 'https://github.com/omnitrack/omnitrack-sentinel',
    deploymentUrl: 'https://omnitrack-sentinel.web.app',
    videoUrl: 'https://youtu.be/omnitrack-demo-2026',
    fieldValues: {},
    files: [
      {
        id: 'f-str-blueprint',
        fieldId: 'architecture_pdf',
        fileName: 'OmniTrack_Architecture_Blueprint.pdf',
        fileSize: 1024 * 1024 * 1.5,
        mimeType: 'application/pdf',
        storagePath: 'competitions/comp-global-ai/OmniTrack_Blueprint.pdf',
        downloadUrl: 'data:application/pdf;base64,JVBERi0xLjQKJUVDRyBNb2RlbCBJbmZlcmVuY2UgQXJjaGl0ZWN0dXJlIGFuZCBTdHJlYW0gUHJvY2Vzc2luZyBXZWJBc3NlbWJseQ==',
        uploadedAt: new Date().toISOString(),
        isVerified: true,
      },
    ],
    status: 'Queued for AI Evaluation',
    statusHistory: [],
    isLate: false,
    isLocked: false,
    currentVersion: 1,
    versions: [],
    managementTokenHash: 'hash-str01',
    managementTokenPrefix: 'sec_str',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 2. Moderate Submission: EcoRoute Logistics
  const moderateSubmission: ProjectSubmission = {
    id: 'sub-sample-2-moderate',
    referenceId: 'PF-SUB-2026-MOD02',
    competitionId,
    organizationId: orgId,
    formSchemaId: 'schema-test',
    submissionType: 'TEAM',
    teamName: 'GreenTransit',
    primaryContactName: 'Carlos Gomez',
    primaryContactEmail: 'carlos@greentransit.org',
    participants: [
      {
        id: 'p-mod-1',
        name: 'Carlos Gomez',
        email: 'carlos@greentransit.org',
        role: 'Software Developer',
        isLead: true,
        source: 'FORM_SUBMISSION',
        competitionId,
        organizationId: orgId,
        createdAt: new Date().toISOString(),
      },
    ],
    projectTitle: 'EcoRoute: Local Delivery Carbon Optimization Tool',
    projectDescription:
      'EcoRoute is a Python tool that computes fuel-efficient multi-stop routes for urban delivery couriers. It takes address lists and uses basic graph algorithms to find short delivery loops.',
    problemStatement: 'Courier drivers often follow sub-optimal routes leading to extra fuel consumption.',
    solution: 'A simple CLI and route optimizer written in Python using NetworkX.',
    technologiesUsed: ['Python', 'NetworkX', 'OpenStreetMap'],
    githubUrl: 'https://github.com/greentransit/ecoroute-cli',
    // Deployment URL intentionally omitted
    deploymentUrl: undefined,
    videoUrl: undefined,
    fieldValues: {},
    files: [],
    status: 'Queued for AI Evaluation',
    statusHistory: [],
    isLate: false,
    isLocked: false,
    currentVersion: 1,
    versions: [],
    managementTokenHash: 'hash-mod02',
    managementTokenPrefix: 'sec_mod',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 3. Weak Submission: QuickIdea App
  const weakSubmission: ProjectSubmission = {
    id: 'sub-sample-3-weak',
    referenceId: 'PF-SUB-2026-WEAK03',
    competitionId,
    organizationId: orgId,
    formSchemaId: 'schema-test',
    submissionType: 'INDIVIDUAL',
    primaryContactName: 'John Doe',
    primaryContactEmail: 'johndoe@email.com',
    participants: [
      {
        id: 'p-weak-1',
        name: 'John Doe',
        email: 'johndoe@email.com',
        role: 'Participant',
        isLead: true,
        source: 'FORM_SUBMISSION',
        competitionId,
        organizationId: orgId,
        createdAt: new Date().toISOString(),
      },
    ],
    projectTitle: 'QuickIdea App: Simple Notes with AI',
    projectDescription: 'An app where you type things to do and maybe AI gives an idea.',
    // Problem and solution missing
    problemStatement: '',
    solution: '',
    technologiesUsed: ['HTML', 'JavaScript'],
    githubUrl: undefined,
    deploymentUrl: undefined,
    videoUrl: undefined,
    fieldValues: {},
    files: [],
    status: 'Queued for AI Evaluation',
    statusHistory: [],
    isLate: false,
    isLocked: false,
    currentVersion: 1,
    versions: [],
    managementTokenHash: 'hash-weak03',
    managementTokenPrefix: 'sec_weak',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 4. Incomplete Evidence Submission: QuantumEdge
  const incompleteSubmission: ProjectSubmission = {
    id: 'sub-sample-4-incomplete',
    referenceId: 'PF-SUB-2026-INC04',
    competitionId,
    organizationId: orgId,
    formSchemaId: 'schema-test',
    submissionType: 'TEAM',
    teamName: 'HyperEdge Research',
    primaryContactName: 'Dr. Viktor Vance',
    primaryContactEmail: 'viktor@hyperedge.ai',
    participants: [
      {
        id: 'p-inc-1',
        name: 'Dr. Viktor Vance',
        email: 'viktor@hyperedge.ai',
        role: 'Chief Scientist',
        isLead: true,
        source: 'FORM_SUBMISSION',
        competitionId,
        organizationId: orgId,
        createdAt: new Date().toISOString(),
      },
    ],
    projectTitle: 'QuantumEdge: Neuromorphic Multi-Modal Edge Reasoning Engine',
    projectDescription:
      'We have developed a revolutionary quantum neuromorphic co-processor system that achieves 99.99% accuracy on edge video analytics with zero milliwatt power consumption.',
    problemStatement: 'Edge devices consume too much energy for vision tasks.',
    solution: 'Our proprietary quantum algorithm runs everywhere without battery drain.',
    technologiesUsed: ['Quantum Computing', 'Neuromorphic Silicon', 'PyTorch'],
    githubUrl: 'https://github.com/hyperedge-private/quantum-core-private-not-found', // inaccesssible / broken
    deploymentUrl: undefined,
    videoUrl: 'https://youtube.com/watch?v=uninspected-quantum-video-demo',
    fieldValues: {},
    files: [
      {
        id: 'f-corrupt-1',
        fieldId: 'paper',
        fileName: 'Quantum_Neuromorphic_Proof.pdf',
        fileSize: 1024 * 50,
        mimeType: 'application/pdf',
        storagePath: 'competitions/comp-global-ai/Quantum_Proof.pdf',
        // Inaccessible raw stream without text
        downloadUrl: 'data:application/pdf;base64,AAAA',
        uploadedAt: new Date().toISOString(),
        isVerified: true,
      },
    ],
    status: 'Queued for AI Evaluation',
    statusHistory: [],
    isLate: false,
    isLocked: false,
    currentVersion: 1,
    versions: [],
    managementTokenHash: 'hash-inc04',
    managementTokenPrefix: 'sec_inc',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 5. Creative / Edge-Case Solo Creator: SoundScape Assist
  const soloVideoSubmission: ProjectSubmission = {
    id: 'sub-sample-5-video-solo',
    referenceId: 'PF-SUB-2026-SND05',
    competitionId,
    organizationId: orgId,
    formSchemaId: 'schema-test',
    submissionType: 'INDIVIDUAL',
    primaryContactName: 'Kiran Patel',
    primaryContactEmail: 'kiran@soundscape.dev',
    participants: [
      {
        id: 'p-snd-1',
        name: 'Kiran Patel',
        email: 'kiran@soundscape.dev',
        role: 'Solo Accessibility Engineer',
        isLead: true,
        source: 'FORM_SUBMISSION',
        competitionId,
        organizationId: orgId,
        createdAt: new Date().toISOString(),
      },
    ],
    projectTitle: 'SoundScape Assist: Acoustic Spatial Guidance for the Blind',
    projectDescription:
      'SoundScape Assist converts real-time LiDAR and stereo camera point clouds into 3D binaural spatial audio beacons on mobile edge chips. Blind users navigate unfamiliar indoor environments by listening to synthetic spatialized audio pulses.',
    problemStatement: 'Visually impaired individuals face disorientation in indoor transit hubs without tactile guides.',
    solution: 'On-device spatial sound synthesis running within 45ms over ordinary stereo headphones.',
    technologiesUsed: ['Web Audio API', 'Spatial Audio', 'Gemini Nano', 'TypeScript'],
    githubUrl: 'https://github.com/soundscape-assist/acoustic-beacon',
    deploymentUrl: undefined,
    videoUrl: 'https://youtu.be/soundscape-assist-demo',
    fieldValues: {},
    files: [
      {
        id: 'f-snd-spec',
        fieldId: 'specification_markdown',
        fileName: 'Acoustic_Beacon_Spec.md',
        fileSize: 1200,
        mimeType: 'text/markdown',
        storagePath: 'competitions/comp-global-ai/Acoustic_Beacon_Spec.md',
        downloadUrl: 'data:text/markdown;charset=utf-8,#%20SoundScape%20Acoustic%20Protocol%0A%0AHRTF%20binaural%20filtering%20specification%20for%20spatial%20beacons.',
        uploadedAt: new Date().toISOString(),
        isVerified: true,
      },
    ],
    status: 'Queued for AI Evaluation',
    statusHistory: [],
    isLate: false,
    isLocked: false,
    currentVersion: 1,
    versions: [],
    managementTokenHash: 'hash-snd05',
    managementTokenPrefix: 'sec_snd',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    rubricEngineService.clearMemoryStore();
    evaluationQueueService.clearMemoryStore();
    evaluationPipelineService.clearMemoryStore();
    submissionService.clearMemoryStore();
    competitionService.resetInMemoryStore([testCompetition]);
  });

  // ─────────────────────────────────────────────
  // 1. Evaluate All 5 Projects & Verify Score Differentiation
  // ─────────────────────────────────────────────
  it('evaluates all 5 sample projects across the quality spectrum with accurate score ordering', async () => {
    // 1. Strong Project
    await submissionService.saveSubmission(strongSubmission);
    const strongResult = await evaluationPipelineService.executePipeline(strongSubmission, testCompetition);
    expect(strongResult.success).toBe(true);
    const strongReport = strongResult.report!;

    // 2. Moderate Project
    await submissionService.saveSubmission(moderateSubmission);
    const modResult = await evaluationPipelineService.executePipeline(moderateSubmission, testCompetition);
    expect(modResult.success).toBe(true);
    const modReport = modResult.report!;

    // 3. Weak Project
    await submissionService.saveSubmission(weakSubmission);
    const weakResult = await evaluationPipelineService.executePipeline(weakSubmission, testCompetition);
    expect(weakResult.success).toBe(true);
    const weakReport = weakResult.report!;

    // 4. Incomplete Evidence Project
    await submissionService.saveSubmission(incompleteSubmission);
    const incResult = await evaluationPipelineService.executePipeline(incompleteSubmission, testCompetition);
    expect(incResult.success).toBe(true);
    const incReport = incResult.report!;

    // 5. Solo Video Demo Project
    await submissionService.saveSubmission(soloVideoSubmission);
    const soloResult = await evaluationPipelineService.executePipeline(soloVideoSubmission, testCompetition);
    expect(soloResult.success).toBe(true);
    const soloReport = soloResult.report!;

    // Assert Score Differentiation:
    // Strong (>85) > Moderate (65-85) > Weak (<70)
    expect(strongReport.overallScore).toBeGreaterThanOrEqual(85);
    expect(strongReport.overallScore).toBeGreaterThan(modReport.overallScore);
    expect(modReport.overallScore).toBeGreaterThan(weakReport.overallScore);
    expect(strongReport.percentageScore).toBeGreaterThanOrEqual(85);
    expect(incReport.overallScore).toBeLessThan(strongReport.overallScore);
    expect(soloReport.overallScore).toBeGreaterThan(weakReport.overallScore);
  }, 20000);

  // ─────────────────────────────────────────────
  // 2. Compare Generated Explanations with Actual Uploaded Material
  // ─────────────────────────────────────────────
  it('compares generated observations directly with submitted evidence without hallucination', async () => {
    // Evaluate Strong Project
    await submissionService.saveSubmission(strongSubmission);
    const { report: strongReport } = await evaluationPipelineService.executePipeline(strongSubmission, testCompetition);

    // Verify positive observations ground in actual submitted title and technologies
    const techObs = strongReport!.criteriaEvaluations[0].positiveObservations.join(' ');
    expect(techObs).toContain(strongSubmission.projectTitle);

    // Evaluate Moderate Project (Deployment intentionally missing)
    await submissionService.saveSubmission(moderateSubmission);
    const { report: modReport } = await evaluationPipelineService.executePipeline(moderateSubmission, testCompetition);

    // Verify deduction explicitly notes missing deployment URL
    const techCrit = modReport!.criteriaEvaluations.find((c) => c.criterionId === 'crit-tech');
    expect(techCrit?.exactDeductionExplanations.some((d) => d.includes('deployment URL'))).toBe(true);

    // Verify evidence gap correctly reported
    expect(modReport!.evidenceGaps.some((g) => g.includes('deployment'))).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 3. Verify Strict Evidence Rules & No Invented Claims
  // ─────────────────────────────────────────────
  it('enforces strict evidence rules: disclaims videos, handles corrupt files, never invents features', async () => {
    await submissionService.saveSubmission(incompleteSubmission);
    const { report: incReport } = await evaluationPipelineService.executePipeline(incompleteSubmission, testCompetition);

    // 1. Video disclaimer: model does not claim to have visually watched video
    expect(incReport!.evaluationWarnings.some((w) => w.includes('Video was not visually or auditorily inspected'))).toBe(true);

    // 2. Static code analysis disclaimer: model does not claim runtime execution
    expect(incReport!.evaluationWarnings.some((w) => w.includes('no runtime code execution sandbox was invoked'))).toBe(true);

    // 3. Unparseable PDF: model does NOT penalize solely because file is binary/inaccessible
    expect(incReport!.evaluationWarnings.some((w) => w.includes('without penalizing the team'))).toBe(true);

    // 4. Missing deployment & unverified claims: classified as EVIDENCE_UNAVAILABLE
    const classifications = incReport!.criteriaEvaluations.flatMap((c) => c.evidenceClassifications);
    expect(classifications.some((c) => c.classification === 'EVIDENCE_UNAVAILABLE')).toBe(true);
    expect(classifications.some((c) => c.classification === 'FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED')).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 4. Test Both Hybrid Inference Paths & Probing
  // ─────────────────────────────────────────────
  it('verifies device capability probing and supports hybrid inference telemetry', async () => {
    // Probing device capabilities returns structured status
    const caps = await aiLogicService.checkDeviceCapabilities();
    expect(caps).toBeDefined();
    expect(['available', 'downloadable', 'downloading', 'unavailable', 'unknown']).toContain(caps.availabilityStatus);
    expect(typeof caps.isChrome).toBe('boolean');
    expect(typeof caps.geminiNanoReady).toBe('boolean');

    // Run evaluation with PREFER_ON_DEVICE mode
    const packet = await contentExtractionService.extractSubmissionEvidence(strongSubmission);
    const rubricVersion = await rubricEngineService.getOrCreateRubricVersion(testCompetition, 1);

    const report = await aiLogicService.evaluateSubmissionEvidence(
      packet,
      rubricVersion,
      InferenceMode.PREFER_ON_DEVICE
    );

    expect(report.telemetry).toBeDefined();
    expect(report.telemetry.requestedMode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(['ON_DEVICE', 'IN_CLOUD', 'UNKNOWN']).toContain(report.telemetry.actualInferenceSource);
    expect(report.telemetry.latencyMs).toBeGreaterThan(0);
    expect(report.telemetry.modelUsed).toBeDefined();
  });

  // ─────────────────────────────────────────────
  // 5. Confirm AI Score is Stored Separately from Judge Score
  // ─────────────────────────────────────────────
  it('confirms AI evaluation report is immutable and stored separately from human judge evaluation', async () => {
    // 1. Run AI Evaluation Pipeline
    await submissionService.saveSubmission(strongSubmission);
    const { submission: subAfterAi, report: aiReport } = await evaluationPipelineService.executePipeline(
      strongSubmission,
      testCompetition
    );

    const initialAiScore = aiReport!.overallScore;
    expect(subAfterAi.status).toBe('Ready for Judge Review');
    expect(subAfterAi.aiScore).toBe(initialAiScore);
    expect(subAfterAi.aiEvaluationId).toBe(aiReport!.id);
    expect(aiReport!.isImmutable).toBe(true);

    // 2. Human Judge Review: Judge modifies scores (e.g. awards 88 vs AI suggested 92)
    const humanJudgeScore = 88;
    const humanDeductionNotes =
      'Judge modification: Minor deduction (-4 pts) for incomplete edge stress-testing benchmarks on clinical cohorts.';

    // Transition status to Under Human Review -> Evaluated
    const reviewStep = submissionLifecycleService.transitionStatus(
      subAfterAi,
      'Under Human Review',
      { id: 'judge-dr-vance' },
      'Dr. Elena Vance commenced human scoring'
    );
    let updatedSub = reviewStep.updatedSubmission!;

    const evalStep = submissionLifecycleService.transitionStatus(
      updatedSub,
      'Evaluated',
      { id: 'judge-dr-vance' },
      `Human judge recorded score: ${humanJudgeScore}/100. Notes: ${humanDeductionNotes}`
    );
    updatedSub = evalStep.updatedSubmission!;

    // Save human review submission
    await submissionService.saveSubmission(updatedSub);

    // 3. Confirm Strict Separation of AI and Human Evaluation:
    // Reload report from database/memory
    const persistedAiReport = await evaluationPipelineService.getEvaluationReport(aiReport!.id);
    expect(persistedAiReport).not.toBeNull();
    // AI Report score is untouched and strictly immutable
    expect(persistedAiReport?.overallScore).toBe(initialAiScore);
    expect(persistedAiReport?.isImmutable).toBe(true);

    // Reload submission
    const finalSub = await submissionService.getSubmission(strongSubmission.id);
    expect(finalSub?.status).toBe('Evaluated');
    // AI score remains preserved on the record
    expect(finalSub?.aiScore).toBe(initialAiScore);
    expect(finalSub?.aiEvaluationId).toBe(aiReport!.id);

    // Human evaluation audit entry is in status history, separate from AI report
    const humanAuditEntry = finalSub?.statusHistory.find((h) => h.status === 'Evaluated');
    expect(humanAuditEntry).toBeDefined();
    expect(humanAuditEntry?.changedBy).toBe('judge-dr-vance');
    expect(humanAuditEntry?.note).toContain(`Human judge recorded score: ${humanJudgeScore}`);
  });
});
