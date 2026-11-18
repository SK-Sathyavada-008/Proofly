// ─────────────────────────────────────────────
// domainAwareEvaluation.test.ts
// Tests for domain-aware human-like evaluation reasoning (e.g. EventScout vs MedTech)
// ─────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { aiLogicService } from '../aiLogicService';
import type { StructuredEvidencePacket, RubricVersion } from '../../types/aiEvaluation';

describe('Domain-Aware Human-Like AI Evaluation Engine', () => {
  const sampleRubric: RubricVersion = {
    competitionId: 'comp-1',
    versionNumber: 1,
    totalMaxScore: 100,
    capturedAt: new Date().toISOString(),
    criteria: [
      {
        id: 'crit-tech',
        name: 'Technological Implementation',
        description: 'Engineering viability, architecture soundness, and code quality',
        maxScore: 35,
        weight: 35,
      },
      {
        id: 'crit-impact',
        name: 'Potential Impact',
        description: 'Problem significance and real-world value',
        maxScore: 35,
        weight: 35,
      },
      {
        id: 'crit-design',
        name: 'Design & Presentation',
        description: 'User experience and presentation clarity',
        maxScore: 30,
        weight: 30,
      },
    ],
  };

  it('correctly classifies EventScout into Event Discovery & Community Engagement with tailored reasoning', () => {
    const eventScoutPacket: StructuredEvidencePacket = {
      submissionId: 'sub-eventscout',
      referenceId: 'PF-EVT-01',
      competitionId: 'comp-krivee',
      projectTitle: 'EventScout',
      projectDescription:
        'EventScout is an intelligent community event discovery platform that aggregates local meetups, campus hackathons, and tech conferences. Users can discover nearby events on an interactive map, filter by technical interests, and receive personalized notifications.',
      problemStatement:
        'Finding relevant tech meetups and student conferences is fragmented across multiple platforms, leading to missed opportunities and low attendee turnouts.',
      solution:
        'A unified web and mobile interface with automated event scraping, geolocation-based spatial search, and calendar synchronization.',
      technologiesUsed: ['React', 'Node.js', 'PostgreSQL', 'Mapbox GL', 'TailwindCSS'],
      githubMetadata: {
        repoUrl: 'https://github.com/eventscout/eventscout-core',
        accessible: true,
        repoName: 'eventscout-core',
      },
      deploymentMetadata: {
        url: 'https://eventscout-demo.web.app',
        accessible: true,
      },
      documentContents: [],
      evidenceDisclaimers: [],
      assembledAt: new Date().toISOString(),
    };

    const domain = aiLogicService.detectProjectDomain(eventScoutPacket);
    expect(domain.domainName).toBe('Event Discovery & Community Engagement');
    expect(domain.category).toBe('Event Tech & Social Discovery');
    expect(domain.keyThemes).toContain('Event Aggregation');

    const evalReport = aiLogicService.generateDeterministicEvidenceEvaluation(eventScoutPacket, sampleRubric);

    // Verify executive summary explicitly discusses EventScout and its domain
    expect(evalReport.executiveSummary).toContain('EventScout');
    expect(evalReport.executiveSummary).toContain('Event Discovery & Community Engagement');

    // Verify strongest aspects reflect event features and stack
    expect(evalReport.strongestAspects.some((a: string) => a.includes('Event Discovery') || a.includes('React') || a.includes('eventscout'))).toBe(true);

    // Verify tailored recommendations mention event tech (deduplication, calendar sync, edge caching)
    expect(evalReport.areasToImprove.some((rec: string) => rec.includes('calendar') || rec.includes('deduplication') || rec.includes('caching'))).toBe(true);
  });

  it('generates distinct, non-identical responses and differentiated scores across different projects', () => {
    // Project 1: EventScout
    const eventScoutPacket: StructuredEvidencePacket = {
      submissionId: 'sub-eventscout',
      referenceId: 'PF-EVT-01',
      competitionId: 'comp-krivee',
      projectTitle: 'EventScout',
      projectDescription: 'Event discovery aggregator with map search.',
      problemStatement: 'Event discovery is fragmented across platforms.',
      solution: 'Interactive map and event aggregation service.',
      technologiesUsed: ['React', 'Node.js', 'PostgreSQL'],
      githubMetadata: { repoUrl: 'https://github.com/eventscout/core', accessible: true },
      deploymentMetadata: { url: 'https://eventscout.dev', accessible: true },
      documentContents: [],
      evidenceDisclaimers: [],
      assembledAt: new Date().toISOString(),
    };

    // Project 2: MediPulse (Biomedical ECG)
    const mediPulsePacket: StructuredEvidencePacket = {
      submissionId: 'sub-medipulse',
      referenceId: 'PF-MED-01',
      competitionId: 'comp-krivee',
      projectTitle: 'MediPulse',
      projectDescription: 'Biomedical arrhythmia detection on wearable edge devices.',
      problemStatement: 'Delayed detection of cardiac arrhythmia causes preventable deaths.',
      solution: 'Real-time on-device ECG signal processing with quantized neural network.',
      technologiesUsed: ['Python', 'TensorFlow Lite', 'C++', 'FastAPI', 'WebAssembly'],
      githubMetadata: { repoUrl: 'https://github.com/medipulse/ecg-edge', accessible: true },
      deploymentMetadata: undefined,
      documentContents: [],
      evidenceDisclaimers: [],
      assembledAt: new Date().toISOString(),
    };

    const evalEventScout = aiLogicService.generateDeterministicEvidenceEvaluation(eventScoutPacket, sampleRubric);
    const evalMediPulse = aiLogicService.generateDeterministicEvidenceEvaluation(mediPulsePacket, sampleRubric);

    // 1. Domains are distinct
    expect(evalEventScout.executiveSummary).toContain('Event Discovery');
    expect(evalMediPulse.executiveSummary).toContain('Healthcare & Biomedical AI');

    // 2. Executive summaries are completely different
    expect(evalEventScout.executiveSummary).not.toEqual(evalMediPulse.executiveSummary);

    // 3. Strongest aspects are tailored
    expect(evalEventScout.strongestAspects).not.toEqual(evalMediPulse.strongestAspects);

    // 4. Areas to improve are domain-specific
    expect(evalMediPulse.areasToImprove.some((r: string) => r.includes('clinical') || r.includes('biometric'))).toBe(true);
    expect(evalEventScout.areasToImprove.some((r: string) => r.includes('calendar') || r.includes('event'))).toBe(true);
  });
});
