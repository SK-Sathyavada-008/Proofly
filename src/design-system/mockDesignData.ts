// ─────────────────────────────────────────────
// mockDesignData.ts — Realistic Mock Data for Phase 2 UI Prototyping
// Strictly segregated from production data stores
// ─────────────────────────────────────────────

export interface MockCompetition {
  id: string;
  title: string;
  slug: string;
  tagline: string;
  organization: string;
  status: 'DRAFT' | 'ACTIVE' | 'EVALUATION' | 'COMPLETED';
  startDate: string;
  endDate: string;
  evaluationDeadline: string;
  submissionsCount: number;
  judgesCount: number;
  allowEdits: boolean;
  publicAccessCode: string;
  rubricCriteria: {
    id: string;
    name: string;
    description: string;
    maxScore: number;
    weight: number;
  }[];
}

export interface MockSubmission {
  id: string;
  competitionId: string;
  competitionTitle: string;
  title: string;
  teamName: string;
  leadContact: string;
  members: string[];
  track: string;
  summary: string;
  githubUrl: string;
  demoUrl?: string;
  hasPdfDoc: boolean;
  submittedAt: string;
  aiStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  aiScore?: number;
  aiInferencePath?: 'ON_DEVICE' | 'IN_CLOUD';
  aiLatencyMs?: number;
  judgeStatus: 'UNASSIGNED' | 'ASSIGNED' | 'IN_REVIEW' | 'REVIEWED';
  judgeScore?: number;
  assignedJudgeName?: string;
  officialResult?: 'PENDING_APPROVAL' | 'APPROVED' | 'DISQUALIFIED';
}

export interface MockJudge {
  id: string;
  name: string;
  email: string;
  title: string;
  organization: string;
  avatarUrl: string;
  assignedTracks: string[];
  totalAssigned: number;
  completedReviews: number;
  status: 'ACTIVE' | 'INVITED' | 'IDLE';
}

export interface MockAiEvaluationDossier {
  submissionId: string;
  inferencePath: 'ON_DEVICE' | 'IN_CLOUD';
  modelIdentifier: string;
  latencyMs: number;
  appCheckVerified: boolean;
  totalScore: number;
  criteriaScores: {
    criteriaId: string;
    criteriaName: string;
    score: number;
    maxScore: number;
    observations: string[];
  }[];
  executiveSummary: string;
  keyStrengths: string[];
  potentialRisks: string[];
  recommendedDeductions: {
    area: string;
    points: number;
    rationale: string;
  }[];
}

export const MOCK_COMPETITIONS: MockCompetition[] = [
  {
    id: 'comp-001',
    title: 'Global AI Innovation Challenge 2026',
    slug: 'global-ai-challenge-2026',
    tagline: 'Empowering on-device and cloud hybrid intelligence architectures',
    organization: 'DeepMind Academic & Research Guild',
    status: 'EVALUATION',
    startDate: '2026-10-01',
    endDate: '2026-11-10',
    evaluationDeadline: '2026-11-20',
    submissionsCount: 42,
    judgesCount: 8,
    allowEdits: false,
    publicAccessCode: 'GAIC-2026-ACTIVE',
    rubricCriteria: [
      {
        id: 'crit-tech',
        name: 'Technological Implementation',
        description: 'Robustness, code quality, edge/hybrid model integration, and execution completeness.',
        maxScore: 25,
        weight: 25,
      },
      {
        id: 'crit-design',
        name: 'Design & User Experience',
        description: 'Clarity, accessibility, responsive ergonomics, and visual hierarchy.',
        maxScore: 25,
        weight: 25,
      },
      {
        id: 'crit-impact',
        name: 'Potential Impact',
        description: 'Relevance to real-world friction, scalability, and societal or domain value.',
        maxScore: 25,
        weight: 25,
      },
      {
        id: 'crit-idea',
        name: 'Quality of the Idea',
        description: 'Novelty, creative problem-framing, and distinction from existing market offerings.',
        maxScore: 25,
        weight: 25,
      },
    ],
  },
  {
    id: 'comp-002',
    title: 'Autonomous Robotics & Edge AI Symposium',
    slug: 'autonomous-robotics-2026',
    tagline: 'Low-latency spatial awareness and decentralized control algorithms',
    organization: 'Robotics Engineering Foundation',
    status: 'ACTIVE',
    startDate: '2026-11-01',
    endDate: '2026-12-05',
    evaluationDeadline: '2026-12-15',
    submissionsCount: 19,
    judgesCount: 5,
    allowEdits: true,
    publicAccessCode: 'EDGE-ROBO-99',
    rubricCriteria: [
      {
        id: 'crit-tech',
        name: 'Technological Implementation',
        description: 'System efficiency, latency thresholds, hardware integration.',
        maxScore: 30,
        weight: 30,
      },
      {
        id: 'crit-design',
        name: 'Design & Hardware UX',
        description: 'Safety ergonomics and operator dashboard clarity.',
        maxScore: 20,
        weight: 20,
      },
      {
        id: 'crit-impact',
        name: 'Potential Impact',
        description: 'Deployment feasibility in industrial and emergency scenarios.',
        maxScore: 25,
        weight: 25,
      },
      {
        id: 'crit-idea',
        name: 'Quality of the Idea',
        description: 'Technical ingenuity in constraint-bound environments.',
        maxScore: 25,
        weight: 25,
      },
    ],
  },
  {
    id: 'comp-003',
    title: 'NextGen BioTech & Healthcare Summit',
    slug: 'biotech-summit-2026',
    tagline: 'Translational computational biology and personalized diagnostic tools',
    organization: 'International Health Informatics Consortium',
    status: 'DRAFT',
    startDate: '2026-12-01',
    endDate: '2027-01-15',
    evaluationDeadline: '2027-01-25',
    submissionsCount: 0,
    judgesCount: 3,
    allowEdits: true,
    publicAccessCode: 'BIO-2027-DRAFT',
    rubricCriteria: [
      {
        id: 'crit-tech',
        name: 'Technological Implementation',
        description: 'Algorithmic validity and data pipeline integrity.',
        maxScore: 25,
        weight: 25,
      },
      {
        id: 'crit-design',
        name: 'Design & Usability',
        description: 'Clinician workflows and patient-facing simplicity.',
        maxScore: 25,
        weight: 25,
      },
      {
        id: 'crit-impact',
        name: 'Potential Impact',
        description: 'Diagnostic precision and clinical utility.',
        maxScore: 25,
        weight: 25,
      },
      {
        id: 'crit-idea',
        name: 'Quality of the Idea',
        description: 'Novel biochemical or genomic insights.',
        maxScore: 25,
        weight: 25,
      },
    ],
  },
];

export const MOCK_SUBMISSIONS: MockSubmission[] = [
  {
    id: 'sub-101',
    competitionId: 'comp-001',
    competitionTitle: 'Global AI Innovation Challenge 2026',
    title: 'AuraSense — Offline Edge Anomaly Detector for Clinical Telemetry',
    teamName: 'NeuralPulse Lab',
    leadContact: 'sarah.chen@neuralpulse.io',
    members: ['Sarah Chen', 'David Kim', 'Amara Okafor'],
    track: 'Healthcare & Edge AI',
    summary:
      'AuraSense leverages on-device Gemini Nano 4 to analyze multi-lead ECG telemetry in real-time on low-cost micro-gateways, flagging cardiac arrhythmias without transmitting sensitive patient vitals to the public cloud.',
    githubUrl: 'https://github.com/NeuralPulse/aurasense-edge',
    demoUrl: 'https://aurasense-demo.web.app',
    hasPdfDoc: true,
    submittedAt: '2026-11-09T14:22:00Z',
    aiStatus: 'COMPLETED',
    aiScore: 91,
    aiInferencePath: 'ON_DEVICE',
    aiLatencyMs: 340,
    judgeStatus: 'REVIEWED',
    judgeScore: 89,
    assignedJudgeName: 'Dr. Elena Vance',
    officialResult: 'APPROVED',
  },
  {
    id: 'sub-102',
    competitionId: 'comp-001',
    competitionTitle: 'Global AI Innovation Challenge 2026',
    title: 'DecentraGrid — Peer-to-Peer Renewable Microgrid Dispatcher',
    teamName: 'VoltForge Labs',
    leadContact: 'marcus.v@voltforge.dev',
    members: ['Marcus Vance', 'Elena Rostova'],
    track: 'Climate & Infrastructure',
    summary:
      'DecentraGrid orchestrates localized residential solar and battery storage distribution via algorithmic auction mechanisms, optimizing energy balance during peak transformer congestion.',
    githubUrl: 'https://github.com/VoltForge/decentragrid-contracts',
    demoUrl: 'https://decentragrid.io',
    hasPdfDoc: true,
    submittedAt: '2026-11-08T19:45:00Z',
    aiStatus: 'COMPLETED',
    aiScore: 86,
    aiInferencePath: 'IN_CLOUD',
    aiLatencyMs: 1420,
    judgeStatus: 'IN_REVIEW',
    assignedJudgeName: 'Prof. Julian Chen',
    officialResult: 'PENDING_APPROVAL',
  },
  {
    id: 'sub-103',
    competitionId: 'comp-001',
    competitionTitle: 'Global AI Innovation Challenge 2026',
    title: 'OmniSpeech — Zero-Shot Multilingual Screenplay Dubber',
    teamName: 'CineAcoustics',
    leadContact: 'priya.n@cineacoustics.org',
    members: ['Priya Nair', 'Taro Yamada', 'Lucas Silva'],
    track: 'Generative Media',
    summary:
      'OmniSpeech aligns vocal prosody, pitch, and lip-sync across 24 low-resource regional dialects using hybrid local phoneme clustering and cloud acoustic synthesis.',
    githubUrl: 'https://github.com/CineAcoustics/omnispeech-core',
    demoUrl: 'https://omnispeech.app',
    hasPdfDoc: false,
    submittedAt: '2026-11-10T08:12:00Z',
    aiStatus: 'COMPLETED',
    aiScore: 78,
    aiInferencePath: 'ON_DEVICE',
    aiLatencyMs: 410,
    judgeStatus: 'ASSIGNED',
    assignedJudgeName: 'Dr. Elena Vance',
    officialResult: 'PENDING_APPROVAL',
  },
  {
    id: 'sub-104',
    competitionId: 'comp-001',
    competitionTitle: 'Global AI Innovation Challenge 2026',
    title: 'SynthTrace — Deterministic Audit Trails for Code-Generating LLMs',
    teamName: 'Provenance Systems',
    leadContact: 'alex.meyer@synthtrace.tech',
    members: ['Alex Meyer'],
    track: 'AI Safety & Governance',
    summary:
      'SynthTrace cryptographically binds model weights, prompt tokens, and AST transformations into verifiable Merkle proofs, guaranteeing reproducible compiler lineages.',
    githubUrl: 'https://github.com/ProvenanceSystems/synthtrace',
    demoUrl: 'https://synthtrace.tech',
    hasPdfDoc: true,
    submittedAt: '2026-11-10T11:58:00Z',
    aiStatus: 'PROCESSING',
    judgeStatus: 'UNASSIGNED',
    officialResult: 'PENDING_APPROVAL',
  },
  {
    id: 'sub-105',
    competitionId: 'comp-001',
    competitionTitle: 'Global AI Innovation Challenge 2026',
    title: 'AgriVision — Drone Hyperspectral Soil Nutrient Mapping',
    teamName: 'TerraData Collective',
    leadContact: 'kofi.mensah@terradata.ag',
    members: ['Kofi Mensah', 'Fatima Zahra', 'Chen Wei'],
    track: 'Agriculture & IoT',
    summary:
      'Lightweight edge vision pipeline computing nitrogen, phosphorus, and moisture gradients from uncalibrated multispectral drone footage directly on low-power DJI payloads.',
    githubUrl: 'https://github.com/TerraData/agrivision-spectral',
    hasPdfDoc: true,
    submittedAt: '2026-11-07T16:30:00Z',
    aiStatus: 'COMPLETED',
    aiScore: 84,
    aiInferencePath: 'ON_DEVICE',
    aiLatencyMs: 380,
    judgeStatus: 'REVIEWED',
    judgeScore: 86,
    assignedJudgeName: 'Dr. Kenneth Stone',
    officialResult: 'APPROVED',
  },
];

export const MOCK_JUDGES: MockJudge[] = [
  {
    id: 'judge-01',
    name: 'Dr. Elena Vance',
    email: 'elena.vance@stanford.edu',
    title: 'Associate Professor of Computer Science',
    organization: 'Stanford AI Lab',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    assignedTracks: ['Healthcare & Edge AI', 'Generative Media'],
    totalAssigned: 12,
    completedReviews: 8,
    status: 'ACTIVE',
  },
  {
    id: 'judge-02',
    name: 'Prof. Julian Chen',
    email: 'j.chen@mit.edu',
    title: 'Principal Research Scientist',
    organization: 'MIT Energy Initiative',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
    assignedTracks: ['Climate & Infrastructure', 'AI Safety & Governance'],
    totalAssigned: 10,
    completedReviews: 5,
    status: 'ACTIVE',
  },
  {
    id: 'judge-03',
    name: 'Dr. Kenneth Stone',
    email: 'kstone@deepmind.com',
    title: 'Staff Applied Scientist',
    organization: 'Google DeepMind',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
    assignedTracks: ['Agriculture & IoT', 'Healthcare & Edge AI'],
    totalAssigned: 10,
    completedReviews: 10,
    status: 'ACTIVE',
  },
];

export const MOCK_AI_DOSSIER: MockAiEvaluationDossier = {
  submissionId: 'sub-101',
  inferencePath: 'ON_DEVICE',
  modelIdentifier: 'Gemini Nano 4 (Chrome Prompt API via Firebase AI Logic)',
  latencyMs: 340,
  appCheckVerified: true,
  totalScore: 91,
  criteriaScores: [
    {
      criteriaId: 'crit-tech',
      criteriaName: 'Technological Implementation',
      score: 23,
      maxScore: 25,
      observations: [
        'Exemplary on-device Prompt API integration using browser-native inference.',
        'Clean client-side buffer management preventing UI thread stalling during high-frequency ECG streaming.',
        'Minor deduction (-2 pts): Missing fallback test suite for environments where WebGPU acceleration is disabled.',
      ],
    },
    {
      criteriaId: 'crit-design',
      criteriaName: 'Design & User Experience',
      score: 23,
      maxScore: 25,
      observations: [
        'Clear clinical visual hierarchy adhering to medical telemetry standards.',
        'High-contrast accessible color palette for alert badges.',
        'Minor deduction (-2 pts): Waveform rendering lacks manual pan-and-zoom controls on tablet viewports.',
      ],
    },
    {
      criteriaId: 'crit-impact',
      criteriaName: 'Potential Impact',
      score: 24,
      maxScore: 25,
      observations: [
        'Directly addresses clinical patient privacy compliance (HIPAA/GDPR) by avoiding telemetry transmission to external cloud servers.',
        'Extremely low unit cost makes it viable for rural and emergency medical clinics.',
      ],
    },
    {
      criteriaId: 'crit-idea',
      criteriaName: 'Quality of the Idea',
      score: 21,
      maxScore: 25,
      observations: [
        'Novel formulation of hybrid local triage with remote escalation.',
        'Deduction (-4 pts): Underlying beat-classification model relies on standard MIT-BIH dataset with limited multi-ethnic validation.',
      ],
    },
  ],
  executiveSummary:
    'AuraSense represents a compelling, production-ready demonstration of hybrid AI. By executing primary inference locally via Gemini Nano, it achieves zero-latency anomaly alerts while strictly maintaining patient privacy. Technical documentation and repo structure are outstanding.',
  keyStrengths: [
    'True zero-latency edge inference with zero network dependency during telemetry analysis.',
    'Strict patient data isolation satisfying clinical regulatory frameworks.',
    'Comprehensive TypeScript architecture with clean separation of concerns.',
  ],
  potentialRisks: [
    'Model drift under non-standard pediatric ECG rhythm morphologies.',
    'Browser compatibility limited to Chromium environments supporting Prompt API.',
  ],
  recommendedDeductions: [
    {
      area: 'Cross-Browser Fallback Verification',
      points: 2,
      rationale: 'Telemetry simulator does not gracefully degrade on non-Chromium clients when offline.',
    },
    {
      area: 'Dataset Generalization Scope',
      points: 4,
      rationale: 'Training references skewed toward MIT-BIH arrhythmia benchmarks without diverse noise baselines.',
    },
  ],
};
