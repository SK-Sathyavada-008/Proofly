import { describe, it, expect } from 'vitest';
import { aiLogicService } from '../aiLogicService';
import { evaluationPipelineService } from '../evaluationPipelineService';
import { competitionService } from '../competitionService';
import { submissionService } from '../submissionService';
import { accessManagementService } from '../accessManagementService';
import type { StructuredEvidencePacket, RubricVersion } from '../../types/aiEvaluation';

describe('Track & Theme Relevance Verification and Differentiated AI Evaluation', () => {
  const standardRubric: RubricVersion = {
    versionNumber: 1,
    competitionId: 'comp-track-test',
    totalMaxScore: 100,
    capturedAt: new Date().toISOString(),
    criteria: [
      { id: 'crit-tech', name: 'Technological Implementation', description: 'Architecture & code', weight: 25, maxScore: 25 },
      { id: 'crit-design', name: 'Design & User Experience', description: 'Usability & design', weight: 25, maxScore: 25 },
      { id: 'crit-impact', name: 'Potential Impact', description: 'Real-world utility & user value', weight: 25, maxScore: 25 },
      { id: 'crit-idea', name: 'Quality of the Idea', description: 'Novelty & track alignment', weight: 25, maxScore: 25 },
    ],
  };

  const eventScoutPacket: StructuredEvidencePacket = {
    submissionId: 'sub-eventscout',
    referenceId: 'PF-SUB-EVENTSCOUT',
    competitionId: 'comp-track-test',
    projectTitle: 'EventScout',
    projectDescription:
      'EventScout is a personal AI opportunity scout that continuously discovers events from fragmented sources, understands and ranks them based on the user, and proactively delivers the opportunities they are most likely to care about.',
    problemStatement:
      'Students and engineers miss critical hackathons, meetups, and grant deadlines because announcements are buried across scattered Discord channels, campus boards, and social feeds.',
    solution:
      'A continuous automated ingestion pipeline that parses and deduplicates event postings, scores relevance with vector embeddings, and delivers personalized opportunities directly to the user.',
    technologiesUsed: ['Python', 'MongoDB', 'React', 'FastAPI', 'TailwindCSS'],
    track: 'Healthcare & Edge AI', // Intentionally mismatched to test track penalty!
    githubMetadata: {
      repoUrl: 'https://github.com/SK-Sathyavada-008/eventscout_mobilefirst',
      accessible: true,
      repoName: 'eventscout_mobilefirst',
      readmeContent: 'EventScout Mobile-First Repository. Automated event discovery and ranking engine.',
    },
    deploymentMetadata: {
      url: 'https://eventscout-mobilefirst-git-main-sk-sathyavada.vercel.app/',
      accessible: true,
    },
    documentContents: [],
    evidenceDisclaimers: ['Static code inspection only; no live runtime sandbox.'],
    assembledAt: new Date().toISOString(),
  };

  it('detects track misalignment when EventScout is submitted under Healthcare & Edge AI and deducts points', () => {
    const domain = aiLogicService.detectProjectDomain(eventScoutPacket);
    expect(domain.domainName).toBe('Event Discovery & Community Engagement');

    const relevance = aiLogicService.checkTrackRelevance(eventScoutPacket.track, domain, eventScoutPacket);
    expect(relevance.isAligned).toBe(false);
    expect(relevance.isOpenTrack).toBe(false);
    expect(relevance.penaltyApplied).toBe(10);
    expect(relevance.detailedDeductions.ideaDeduction).toContain('Track Misalignment Penalty');
    expect(relevance.detailedDeductions.impactDeduction).toContain('Track Relevance Deduction');

    const evaluation = aiLogicService.generateDeterministicEvidenceEvaluation(eventScoutPacket, standardRubric);

    // Verify warnings
    expect(evaluation.evaluationWarnings.some((w: string) => w.includes('Track Misalignment Warning'))).toBe(true);

    // Verify Idea criterion has track deduction
    const ideaCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-idea');
    expect(ideaCrit).toBeDefined();
    expect(ideaCrit.suggestedScore).toBeLessThan(20); // 25 - 6 = 19 max
    expect(ideaCrit.exactDeductionExplanations.some((d: string) => d.includes('Track Misalignment Penalty'))).toBe(true);

    // Verify Impact criterion has track deduction
    const impactCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-impact');
    expect(impactCrit).toBeDefined();
    expect(impactCrit.suggestedScore).toBeLessThan(22); // 25 - 4 = 21 max
    expect(impactCrit.exactDeductionExplanations.some((d: string) => d.includes('Track Relevance Deduction'))).toBe(true);

    // Verify total score reflects the ~10 point penalty
    expect(evaluation.overallScore).toBeLessThan(90);
  });

  it('evaluates EventScout under Open Track with NO domain penalties and full marks', () => {
    const openTrackPacket: StructuredEvidencePacket = {
      ...eventScoutPacket,
      track: 'Open Track',
    };

    const domain = aiLogicService.detectProjectDomain(openTrackPacket);
    const relevance = aiLogicService.checkTrackRelevance(openTrackPacket.track, domain, openTrackPacket);
    expect(relevance.isOpenTrack).toBe(true);
    expect(relevance.isAligned).toBe(true);
    expect(relevance.penaltyApplied).toBe(0);

    const evaluation = aiLogicService.generateDeterministicEvidenceEvaluation(openTrackPacket, standardRubric);

    // No track misalignment penalty
    const ideaCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-idea');
    expect(ideaCrit.exactDeductionExplanations.some((d: string) => d.includes('Track Misalignment'))).toBe(false);

    // Score reflects realistic solid prototype performance without track penalty (avoiding grade inflation)
    expect(evaluation.overallScore).toBeGreaterThanOrEqual(75);
    expect(evaluation.overallScore).toBeLessThanOrEqual(85);

    // Positive observation confirms Open Track
    expect(ideaCrit.positiveObservations.some((o: string) => o.includes('Open Track'))).toBe(true);
  });

  it('evaluates EventScout under matching Event Tech track with strong alignment praise', () => {
    const matchedTrackPacket: StructuredEvidencePacket = {
      ...eventScoutPacket,
      track: 'Event Tech & Community Discovery',
    };

    const domain = aiLogicService.detectProjectDomain(matchedTrackPacket);
    const relevance = aiLogicService.checkTrackRelevance(matchedTrackPacket.track, domain, matchedTrackPacket);
    expect(relevance.isAligned).toBe(true);
    expect(relevance.isOpenTrack).toBe(false);
    expect(relevance.penaltyApplied).toBe(0);

    const evaluation = aiLogicService.generateDeterministicEvidenceEvaluation(matchedTrackPacket, standardRubric);
    const ideaCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-idea');
    expect(ideaCrit.positiveObservations.some((o: string) => o.includes('Strong Track Alignment'))).toBe(true);
  });

  it('enforces 100% unique, differentiated feedback across all criteria with concrete feature suggestions', () => {
    const openTrackPacket: StructuredEvidencePacket = {
      ...eventScoutPacket,
      track: 'Open Track',
    };

    const evaluation = aiLogicService.generateDeterministicEvidenceEvaluation(openTrackPacket, standardRubric);

    // 1. Check deduction uniqueness: no duplicate deduction strings across criteria
    const allDeductions = evaluation.criteriaEvaluations
      .map((c: any) => c.exactDeductionExplanations[0])
      .filter(Boolean);
    const uniqueDeductions = new Set(allDeductions);
    expect(uniqueDeductions.size).toBe(allDeductions.length);

    // 2. Check Tech criterion provides concrete engineering improvement
    const techCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-tech');
    expect(techCrit.exactDeductionExplanations[0]).toContain('Scraping and event ingestion pipeline requires documented rate-limiting resilience');

    // 3. Check Design criterion provides concrete UX improvement
    const designCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-design');
    expect(designCrit.exactDeductionExplanations[0]).toContain('Add to Google Calendar');

    // 4. Check Impact criterion provides concrete adoption workflow improvement
    const impactCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-impact');
    expect(impactCrit.exactDeductionExplanations[0]).toContain('multi-channel alerts');

    // 5. Check Idea criterion provides user preference modeling improvement
    const ideaCrit = evaluation.criteriaEvaluations.find((c: any) => c.criterionId === 'crit-idea');
    expect(ideaCrit.exactDeductionExplanations[0]).toContain('user preference modeling');

    // 6. Check Executive Summary contains deep real-world utility analysis
    expect(evaluation.executiveSummary).toContain('Real-World Utility & Helpfulness Analysis');
    expect(evaluation.executiveSummary).toContain('solves a major real-world friction for students, creators, and engineers');
  });

  it('supports organizer track configuration and participant track selection end-to-end', async () => {
    // 1. Create competition with custom tracks and open track enabled
    const comp = await competitionService.createCompetition('org-1', 'user-1', 'admin@example.com', 'Admin User', {
      title: 'Global Innovation Challenge 2026',
      tracks: ['Healthcare & Edge AI', 'Event Tech & Community Discovery', 'FinTech & Web3'],
      isOpenTrackEnabled: true,
    });

    expect(comp.tracks).toContain('Event Tech & Community Discovery');
    expect(comp.isOpenTrackEnabled).toBe(true);

    // Provision access and valid session token
    await accessManagementService.generatePublicAccessKey(comp.id, comp.publicAccessCode);
    const sessionRes = await accessManagementService.validateAccessAndCreateSession(comp.publicAccessCode);
    expect(sessionRes.valid).toBe(true);
    const sessionToken = sessionRes.session!.sessionToken;

    // 2. Participant submits project specifying Event Tech track
    const subPayload = {
      competitionId: comp.id,
      sessionToken,
      submissionType: 'INDIVIDUAL' as const,
      primaryContactName: 'Saikeerthana Sathyavada',
      projectTitle: 'EventScout',
      projectDescription: 'Personal AI opportunity scout that continuously discovers events from fragmented sources and ranks them for attendees.',
      track: 'Event Tech & Community Discovery',
      fieldValues: {
        track: 'Event Tech & Community Discovery',
      },
    };

    const subResult = await submissionService.createSubmission(subPayload, comp);
    expect(subResult.submission.track).toBe('Event Tech & Community Discovery');
    expect(subResult.submission.fieldValues.track).toBe('Event Tech & Community Discovery');

    // 3. Run execution pipeline
    const pipelineResult = await evaluationPipelineService.executePipeline(subResult.submission, comp);
    expect(pipelineResult.success).toBe(true);
    expect(pipelineResult.report).toBeDefined();
    expect(pipelineResult.report?.trackRelevance?.selectedTrack).toBe('Event Tech & Community Discovery');
    expect(pipelineResult.report?.trackRelevance?.isAligned).toBe(true);
  });
});
