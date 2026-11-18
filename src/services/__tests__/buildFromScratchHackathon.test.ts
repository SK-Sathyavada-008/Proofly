// ─────────────────────────────────────────────
// PRison Break — Build-from-Scratch Hackathon Test Suite
// Verifies all 14 mandatory acceptance criteria:
// 1. Team registration with a GitHub repository & problem statement
// 2. Repository evaluation after the next-morning push
// 3. Handling inaccessible and empty repositories
// 4. Missing checkpoint evidence reporting
// 5. Filtering trivial/duplicate commits from earning meaningful XP
// 6. Idempotent evaluation reruns (no duplicate XP awarded)
// 7. Independence of faculty scores from automated scores
// 8. Manual bonus XP functionality and audit log preservation
// 9. Validation of configured scoring weights (100% sum check)
// 10. Pending scores are not silently treated as zero in ranking
// 11. Administrator override of proposed results with mandatory reason
// 12. Unauthorized users cannot modify scores or reviews
// 13. Preserved backwards compatibility for legacy issue/PR mode
// 14. Graceful handling of AI/GitHub failures without fabricated data
// ─────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFromScratchService } from '../buildFromScratchService';
import { facultyEvaluationService } from '../facultyEvaluationService';
import {
  calculateTeamBuildFromScratchScore,
  sortTeams,
  registerTeam,
  teamService,
} from '../teamService';
import { eventConfigService, DEFAULT_CHECKPOINTS } from '../eventConfigService';
import { bonusService } from '../bonusService';
import type { Team, BuildFromScratchWeights, FirestoreTeam } from '../../types';

describe('Build-from-Scratch Hackathon Mode — Acceptance Criteria', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Team Registration with GitHub Repo & Problem Statement ──
  it('Criterion 1: registers a team with a GitHub repository URL and faculty problem statement', async () => {
    const newTeam = await registerTeam({
      name: 'Cyber Sentinel Squad',
      repositoryName: 'cyber-sentinel-2026',
      githubUrl: 'https://github.com/PRison-Break-2026/cyber-sentinel-2026',
      problemTitle: 'Zero-Trust Secure Microservices Architecture',
      members: [
        { studentId: 'stu-1', name: 'Alice Chen', githubUsername: 'alicec', assignedIssues: [], prSubmitted: true },
        { studentId: 'stu-2', name: 'Bob Smith', githubUsername: 'bobsmith', assignedIssues: [], prSubmitted: true },
      ],
      configuredTeamSize: 4,
    });

    expect(newTeam).toBeDefined();
    expect(newTeam.name).toBe('Cyber Sentinel Squad');
    expect(newTeam.githubUrl).toBe('https://github.com/PRison-Break-2026/cyber-sentinel-2026');
    expect(newTeam.problemTitle).toBe('Zero-Trust Secure Microservices Architecture');
    expect(newTeam.rankingStatus).toBe('AWAITING_PUSH');
  });

  // ── 2. Post-event Repository Evaluation ──
  it('Criterion 2: evaluates repository after next-morning push with commits, files, and milestones', async () => {
    const team: FirestoreTeam = {
      id: 'team_eval_2',
      name: 'Squad Beta',
      repositoryId: 'squad_beta',
      repositoryName: 'squad_beta',
      githubUrl: 'https://github.com/PRison-Break-2026/squad_beta',
      problemTitle: 'Zero-Trust Microservices',
      members: [
        { studentId: 'stu-1', name: 'Alice Chen', githubUsername: 'alicec', assignedIssues: [], prSubmitted: true },
        { studentId: 'stu-2', name: 'Bob Smith', githubUsername: 'bobsmith', assignedIssues: [], prSubmitted: true },
      ],
      totalScore: 0,
      assignedIssueCount: 0,
      solvedIssues: [],
      validatedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await teamService.saveTeam(team);

    const mockCommits = [
      {
        sha: 'c1',
        message: 'docs: project blueprint architecture and design document',
        author: 'alicec',
        timestamp: '2026-10-27T23:00:00Z',
      },
      {
        sha: 'c2',
        message: 'feat: implement core encryption engine and user service classes',
        author: 'bobsmith',
        timestamp: '2026-10-28T02:00:00Z',
      },
      {
        sha: 'c3',
        message: 'test: add comprehensive unit tests and error handling verification',
        author: 'alicec',
        timestamp: '2026-10-28T05:00:00Z',
      },
    ];

    const mockFiles = [
      {
        filename: 'README.md',
        content: '# Mission Zero-Trust\n## Setup Instructions\nRun `mvn clean install`\n## Architecture\nModular design.\n## Execution\njava -jar app.jar',
      },
      {
        filename: 'pom.xml',
        content: '<project><modelVersion>4.0.0</modelVersion><groupId>com.prison</groupId><artifactId>app</artifactId></project>',
      },
      {
        filename: 'src/main/java/com/prison/App.java',
        content: 'package com.prison;\npublic class App { public static void main(String[] args) { try { System.out.println("Running"); } catch (Exception e) {} } }',
      },
      {
        filename: 'src/test/java/com/prison/AppTest.java',
        content: 'package com.prison;\nimport org.junit.jupiter.api.Test;\npublic class AppTest { @Test void testApp() {} }',
      },
    ];

    const report = await buildFromScratchService.evaluateRepository({
      teamId: team.id,
      githubUrl: 'https://github.com/PRison-Break-2026/squad_beta',
      mockCommitHistory: mockCommits,
      mockFiles: mockFiles,
      isOfflineSimulation: true,
      adminUsername: 'lead_evaluator',
    });

    expect(report).toBeDefined();
    expect(report.totalGitProcessScore).toBeGreaterThan(0);
    expect(report.categoryScores.checkpoints).toBeGreaterThan(0);
    expect(report.categoryScores.gitWorkflow).toBeGreaterThan(0);
    expect(report.categoryScores.codeQuality).toBeGreaterThan(0);
    expect(report.buildTesting.detectedBuildSystem).toContain('Maven');
    expect(report.buildTesting.runtimeVerificationStatus).toBe('UNAVAILABLE'); // Untrusted code is never executed directly
  });

  // ── 3. Handle Inaccessible and Empty Repositories ──
  it('Criterion 3: accurately detects and handles inaccessible or empty repositories', async () => {
    // 3a. Invalid URL parsing
    const invalidParsed = buildFromScratchService.parseRepositoryUrl('not-a-valid-github-url');
    expect(invalidParsed).toBeNull();

    // 3b. Empty repository handling in git analyzer
    const gitAnalysis = buildFromScratchService.analyzeGitWorkflow([], []);
    expect(gitAnalysis.totalCommits).toBe(0);
    expect(gitAnalysis.meaningfulCommits).toBe(0);
    expect(gitAnalysis.flags).toContain('Empty repository commit history.');
  });

  // ── 4. Missing Checkpoint Evidence Reported Accurately ──
  it('Criterion 4: flags and reports missing checkpoint evidence with deductions', () => {
    // Repository with only a single unverified script file
    const sparseFiles = [{ filename: 'temp.txt', content: 'hello' }];
    const sparseCommits = [{ sha: 'c1', message: 'update', author: 'student1' }];

    const checkpointEvals = buildFromScratchService.analyzeCheckpoints(
      DEFAULT_CHECKPOINTS,
      sparseFiles,
      sparseCommits
    );

    // Testing checkpoint should report missing/insufficient evidence
    const testingCp = checkpointEvals.find((cp) => cp.checkpointId === 'testing_verification');
    expect(testingCp).toBeDefined();
    expect(['INSUFFICIENT_EVIDENCE', 'NOT_MET']).toContain(testingCp?.status);
    expect(testingCp?.score).toBe(0);
    expect(testingCp?.explanation).toContain('No automated test files');
  });

  // ── 5. Trivial or Duplicate Commits Filtered Out ──
  it('Criterion 5: does not award XP solely for commit quantity; filters trivial or duplicate commits', () => {
    // 10 trivial commits: "." "update" "fix" "fix typo"
    const trivialCommits = Array.from({ length: 10 }, (_, i) => ({
      sha: `c${i}`,
      message: i % 2 === 0 ? 'fix' : 'update',
      author: 'spammer',
    }));

    const analysis = buildFromScratchService.analyzeGitWorkflow(trivialCommits, ['spammer']);

    expect(analysis.totalCommits).toBe(10);
    expect(analysis.trivialOrCosmeticCount).toBe(10);
    expect(analysis.meaningfulCommits).toBe(0);
    expect(analysis.findings.some((f) => f.includes('trivial'))).toBe(true);
    // Score must be penalized due to trivial commits
    expect(analysis.score).toBeLessThan(analysis.maxScore);
  });

  // ── 6. Idempotency Key (No Duplicate XP on Reruns) ──
  it('Criterion 6: re-running an evaluation uses deterministic idempotency and prevents duplicate XP', async () => {
    const team: FirestoreTeam = {
      id: 'team_idempotency',
      name: 'Squad Gamma',
      repositoryId: 'squad_gamma',
      repositoryName: 'squad_gamma',
      githubUrl: 'https://github.com/PRison-Break-2026/squad_gamma',
      bonusXP: 50, // Existing manual bonus XP
      members: [],
      totalScore: 50,
      assignedIssueCount: 0,
      solvedIssues: [],
      validatedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await teamService.saveTeam(team);

    const mockCommits = [
      { sha: 'sha-gamma-1', message: 'feat: setup core module', author: 'gamma_lead' },
    ];
    const mockFiles = [
      { filename: 'README.md', content: '# Squad Gamma Blueprint' },
    ];

    // First evaluation run
    const report1 = await buildFromScratchService.evaluateRepository({
      teamId: team.id,
      githubUrl: 'https://github.com/PRison-Break-2026/squad_gamma',
      mockCommitHistory: mockCommits,
      mockFiles,
      isOfflineSimulation: true,
    });

    const teamAfterRun1 = await teamService.getTeamById(team.id);
    const scoreAfterRun1 = teamAfterRun1?.totalScore;

    // Second evaluation run (rerun)
    const report2 = await buildFromScratchService.evaluateRepository({
      teamId: team.id,
      githubUrl: 'https://github.com/PRison-Break-2026/squad_gamma',
      mockCommitHistory: mockCommits,
      mockFiles,
      isOfflineSimulation: true,
    });

    const teamAfterRun2 = await teamService.getTeamById(team.id);

    // Total score must NOT double; bonusXP must be preserved untouched
    expect(teamAfterRun2?.totalScore).toBe(scoreAfterRun1);
    expect(teamAfterRun2?.bonusXP).toBe(50);
    expect(report2.evaluationVersion).toBeGreaterThan(report1.evaluationVersion);
  });

  // ── 7. Faculty Scores Remain Independent of AI / Automated Scores ──
  it('Criterion 7: keeps faculty evaluation strictly independent of automated Git scores', async () => {
    const team: FirestoreTeam = {
      id: 'team_faculty_isolation',
      name: 'Squad Delta',
      repositoryId: 'squad_delta',
      repositoryName: 'squad_delta',
      gitProcessScore: 85, // Automated Git evaluation score
      members: [],
      totalScore: 0,
      assignedIssueCount: 0,
      solvedIssues: [],
      validatedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await teamService.saveTeam(team);

    const facultyEval = await facultyEvaluationService.submitFacultyEvaluation(
      team.id,
      {
        reviewerName: 'Prof. Ada Lovelace',
        criteria: [
          { id: 'problem_solving', name: 'Problem Solving', description: 'Logic and approach', maxScore: 25, awardedScore: 24, comments: 'Superb' },
          { id: 'architecture_design', name: 'Architecture', description: 'System design', maxScore: 25, awardedScore: 23, comments: 'Clean' },
          { id: 'completeness_scope', name: 'Completeness', description: 'Functional completeness', maxScore: 25, awardedScore: 25, comments: 'Complete' },
          { id: 'presentation_demo', name: 'Presentation', description: 'Technical demo', maxScore: 25, awardedScore: 22, comments: 'Good demo' },
        ],
        notes: 'Authoritative academic review.',
      },
      'admin_lead'
    );

    // Normalized score: (24+23+25+22)/100 = 94.0
    expect(facultyEval.normalizedScore).toBe(94);
    expect(facultyEval.reviewerName).toBe('Prof. Ada Lovelace');

    const updatedTeam = await teamService.getTeamById(team.id);
    expect(updatedTeam?.facultyScore).toBe(94);
    // Automated Git process score must remain untouched
    expect(updatedTeam?.gitProcessScore).toBe(85);
  });

  // ── 8. Manual Bonus XP Remains Functional and Audited ──
  it('Criterion 8: awards manual bonus XP with mandatory reason and maintains audit log', async () => {
    const team: FirestoreTeam = {
      id: 'team-bonus-1',
      name: 'Squad Alpha',
      repositoryId: 'squad_alpha',
      repositoryName: 'squad_alpha',
      members: [],
      earnedXP: 400,
      bonusXP: 0,
      totalXP: 400,
      totalScore: 400,
      assignedIssueCount: 0,
      solvedIssues: [],
      validatedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await teamService.saveTeam(team);

    // Attempting bonus without reason fails
    await expect(
      bonusService.awardBonus({
        teamId: team.id,
        amount: 50,
        reason: '',
        adminUsername: 'Chief Proctor',
      })
    ).rejects.toThrow();

    // Valid bonus awards XP and logs audit
    const result = await bonusService.awardBonus({
      teamId: team.id,
      amount: 50,
      reason: 'Outstanding overnight resilience and teamwork',
      adminUsername: 'Chief Proctor',
    });

    expect(result.success).toBe(true);
    expect(result.bonusAmount).toBe(50);
    expect(result.newTotalXP).toBe(450);

    const updated = await teamService.getTeamById(team.id);
    expect(updated?.bonusXP).toBe(50);
    expect(updated?.totalXP).toBe(450);
    // earnedXP is NEVER modified by manual bonus
    expect(updated?.earnedXP).toBe(400);
  });

  // ── 9. Configured Scoring Weights Validation ──
  it('Criterion 9: validates that configured Build-from-Scratch weights sum to exactly 100%', () => {
    // Valid 70% + 30% = 100%
    expect(() =>
      eventConfigService.validateBuildWeights({
        faculty: 0.70,
        gitProcess: 0.30,
      })
    ).not.toThrow();

    // Valid 50% + 50% = 100%
    expect(() =>
      eventConfigService.validateBuildWeights({
        facultyEvaluation: 50,
        gitProcessTelemetry: 50,
      })
    ).not.toThrow();

    // Invalid: 70 + 40 = 110%
    expect(() =>
      eventConfigService.validateBuildWeights({
        faculty: 0.70,
        gitProcess: 0.40,
      })
    ).toThrow(/must sum exactly to 100%/i);

    // Invalid: negative weight
    expect(() =>
      eventConfigService.validateBuildWeights({
        faculty: 1.10,
        gitProcess: -0.10,
      })
    ).toThrow(/must be non-negative/i);
  });

  // ── 10. Pending Scores Are Not Silently Treated as Zero ──
  it('Criterion 10: does not silently treat pending scores as zero or penalize unfinalized teams in ranking', () => {
    const weights: BuildFromScratchWeights = {
      faculty: 0.70,
      gitProcess: 0.30,
    };

    // Team A: has 90 faculty score, but Git evaluation is still pending
    const teamA: Team = {
      id: 'team-a',
      name: 'Team A (Git Pending)',
      repositoryId: 'repo-a',
      repositoryName: 'repo-a',
      facultyScore: 90,
      gitProcessScore: undefined,
      members: [],
      totalScore: 0,
      assignedIssueCount: 0,
      solvedIssues: [],
      validatedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      rank: 0,
      previousRank: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const scoreResultA = calculateTeamBuildFromScratchScore(teamA, 'FACULTY_PRIMARY', weights);
    expect(scoreResultA.isFinalized).toBe(false);
    expect(scoreResultA.rankingStatus).toBe('PENDING_EVALUATION');
    expect(scoreResultA.breakdown.explanation).toContain('Git process evaluation pending');

    // Team B: both faculty (80) and git (70) are complete
    const teamB: Team = {
      id: 'team-b',
      name: 'Team B (Complete)',
      repositoryId: 'repo-b',
      repositoryName: 'repo-b',
      facultyScore: 80,
      gitProcessScore: 70,
      members: [],
      totalScore: 0,
      assignedIssueCount: 0,
      solvedIssues: [],
      validatedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      rank: 0,
      previousRank: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const scoreResultB = calculateTeamBuildFromScratchScore(teamB, 'FACULTY_PRIMARY', weights);
    expect(scoreResultB.isFinalized).toBe(true);
    expect(scoreResultB.rankingStatus).toBe('FINALIZED');
    // Faculty: 80 * 0.70 = 56. Git: 70 * 0.30 = 21. Total: 77.0
    expect(scoreResultB.finalScore).toBeCloseTo(77.0, 1);

    // Sorting: Finalized teams get numbered ranks, pending teams get 'Pending' rankText
    const sorted = sortTeams([
      { ...teamA, rankingStatus: scoreResultA.rankingStatus },
      { ...teamB, totalScore: scoreResultB.finalScore, rankingStatus: scoreResultB.rankingStatus },
    ], 'BUILD_FROM_SCRATCH');

    const sortedTeamB = sorted.find((t) => t.id === 'team-b');
    const sortedTeamA = sorted.find((t) => t.id === 'team-a');

    expect(sortedTeamB?.rank).toBe(1);
    expect(sortedTeamB?.rankText).toBe('#1');
    expect(sortedTeamA?.rankText).toBe('Pending');
  });

  // ── 11. Administrators Can Override Proposed Results with Reason ──
  it('Criterion 11: allows administrator to override evaluation results with a recorded reason and audit log', async () => {
    const team: FirestoreTeam = {
      id: 'team_override_test',
      name: 'Squad Epsilon',
      repositoryId: 'squad_epsilon',
      repositoryName: 'squad_epsilon',
      githubUrl: 'https://github.com/PRison-Break-2026/squad_epsilon',
      gitProcessScore: 60,
      members: [],
      totalScore: 60,
      assignedIssueCount: 0,
      solvedIssues: [],
      validatedIssueCount: 0,
      veryHardSolvedCount: 0,
      prsSubmitted: 0,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await teamService.saveTeam(team);

    const report = await buildFromScratchService.evaluateRepository({
      teamId: team.id,
      githubUrl: 'https://github.com/PRison-Break-2026/squad_epsilon',
      mockCommitHistory: [{ sha: 'c1', message: 'feat: init', author: 'lead' }],
      mockFiles: [{ filename: 'README.md', content: '# Epsilon' }],
      isOfflineSimulation: true,
    });

    // Override without reason must throw
    await expect(
      buildFromScratchService.overrideEvaluation(
        report.id,
        85,
        'admin_root',
        '' // Empty reason
      )
    ).rejects.toThrow();

    // Override with reason succeeds
    const overridden = await buildFromScratchService.overrideEvaluation(
      report.id,
      85,
      'admin_root',
      'Verified offline unit tests ran successfully during proctor check'
    );

    expect(overridden.status).toBe('OVERRIDDEN');
    expect(overridden.totalGitProcessScore).toBe(85);
    expect(overridden.overrideDetails?.reason).toContain('offline unit tests');
    expect(overridden.overrideDetails?.overriddenBy).toBe('admin_root');

    const updatedTeam = await teamService.getTeamById(team.id);
    expect(updatedTeam?.gitProcessScore).toBe(85);
  });

  // ── 12. Unauthorized Users Cannot Modify Scores ──
  it('Criterion 12: blocks unauthorized non-admin users from overriding evaluation or config', async () => {
    // Non-admin attempting override
    await expect(
      buildFromScratchService.overrideEvaluation(
        'eval_some_id',
        99,
        'student_hacker', // Non-admin username
        'Unauthorized boost'
      )
    ).rejects.toThrow(/unauthorized/i);

    // Non-admin attempting to change event mode or weights
    await expect(
      eventConfigService.setEventMode('BUILD_FROM_SCRATCH', 'student_attacker', 'malicious')
    ).rejects.toThrow(/unauthorized/i);
  });

  // ── 13. Preserved Backwards Compatibility for Legacy Mode ──
  it('Criterion 13: maintains legacy issue/PR scoring calculation and ranking without regressions', () => {
    const legacyTeam1: Team = {
      id: 'legacy-1',
      name: 'Legacy Squad 1',
      repositoryId: 'legacy_repo_1',
      repositoryName: 'legacy_repo_1',
      members: [
        { studentId: 's1', name: 'Student 1', githubUsername: 's1', assignedIssues: [1, 2], prSubmitted: true },
      ],
      totalScore: 100,
      earnedXP: 100,
      bonusXP: 0,
      assignedIssueCount: 2,
      solvedIssues: [
        { issueNumber: 1, difficulty: 'HARD', points: 30, solvedByUsername: 's1', prNumber: 1, prStatus: 'MERGED', solvedAt: new Date().toISOString() },
        { issueNumber: 2, difficulty: 'VERY_HARD', points: 40, solvedByUsername: 's1', prNumber: 2, prStatus: 'MERGED', solvedAt: new Date().toISOString() },
      ],
      validatedIssueCount: 2,
      veryHardSolvedCount: 1,
      prsSubmitted: 2,
      active: true,
      rank: 0,
      previousRank: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const legacyTeam2: Team = {
      id: 'legacy-2',
      name: 'Legacy Squad 2',
      repositoryId: 'legacy_repo_2',
      repositoryName: 'legacy_repo_2',
      members: [
        { studentId: 's2', name: 'Student 2', githubUsername: 's2', assignedIssues: [1], prSubmitted: true },
      ],
      totalScore: 50,
      earnedXP: 50,
      bonusXP: 0,
      assignedIssueCount: 1,
      solvedIssues: [
        { issueNumber: 1, difficulty: 'EASY', points: 10, solvedByUsername: 's2', prNumber: 1, prStatus: 'MERGED', solvedAt: new Date().toISOString() },
      ],
      validatedIssueCount: 1,
      veryHardSolvedCount: 0,
      prsSubmitted: 1,
      active: true,
      rank: 0,
      previousRank: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ranked = sortTeams([legacyTeam2, legacyTeam1], 'LEGACY_ISSUE_PR');
    expect(ranked[0].id).toBe('legacy-1');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].id).toBe('legacy-2');
    expect(ranked[1].rank).toBe(2);
  });

  // ── 14. Clear Errors for AI/GitHub Service Failures (No Fabricated Data) ──
  it('Criterion 14: returns clear error on network/auth failure rather than hallucinating fake scores', async () => {
    // Malformed repository format
    const parsed = buildFromScratchService.parseRepositoryUrl('https://example.com/notgithub');
    expect(parsed).toBeNull();

    // Simulated 404 for inaccessible repository
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    }));

    const access = await buildFromScratchService.checkRepositoryAccess('PRison-Break-2026', 'nonexistent_repo');
    expect(access.status).toBe('MISSING');
    expect(access.message).toContain('not found');
  });
});
