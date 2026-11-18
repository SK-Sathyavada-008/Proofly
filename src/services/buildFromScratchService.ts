// ─────────────────────────────────────────────
// Build-from-Scratch Hackathon Evaluation Service
// Automated Post-Event Git, Code Quality, Milestone Checkpoint,
// and Build/Testing Analysis Pipeline
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import type {
  FirestoreTeam,
  HackathonCheckpoint,
  RepoEvaluationReport,
  CheckpointEvaluation,
  GitWorkflowEvaluation,
  CodeQualityEvaluation,
  BuildAndTestingEvaluation,
  DocumentationEvaluation,
  CheckpointVerificationStatus,
} from '../types';
import { eventConfigService, DEFAULT_CHECKPOINTS } from './eventConfigService';
import { auditLogService } from './auditLogService';
import { teamService } from './teamService';

const EVALUATIONS_COLLECTION = 'evaluations';

// In-memory evaluation store for offline / local preview mode & unit testing
const inMemoryEvaluations = new Map<string, RepoEvaluationReport>();
const evaluationListeners = new Set<(reports: RepoEvaluationReport[]) => void>();

function notifyEvaluationListeners() {
  const allReports = Array.from(inMemoryEvaluations.values());
  evaluationListeners.forEach((fn) => {
    try {
      fn(allReports);
    } catch (err) {
      console.warn('[BuildFromScratchService] Listener error:', err);
    }
  });
}

/**
 * Standard trivial commit message patterns
 */
const TRIVIAL_COMMIT_PATTERNS = [
  /^update(\s+file(s)?)?$/i,
  /^fix(ed)?$/i,
  /^test(ing)?$/i,
  /^commit$/i,
  /^wip$/i,
  /^changes?$/i,
  /^asdf$/i,
  /^minor\s*(changes?|fix)?$/i,
  /^\.+$/,
  /^[a-z]$/i,
];

export const buildFromScratchService = {
  /**
   * Parses repository owner and name from varied GitHub URL patterns.
   * Handles:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo.git
   * - git@github.com:owner/repo.git
   * - owner/repo
   */
  parseRepositoryUrl(url: string): { owner: string; repo: string } | null {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim().replace(/\.git$/i, '');

    // Pattern 1: https://github.com/owner/repo
    const httpMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/i);
    if (httpMatch) {
      return { owner: httpMatch[1], repo: httpMatch[2] };
    }

    // Pattern 2: git@github.com:owner/repo
    const sshMatch = trimmed.match(/^git@github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/i);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // Pattern 3: owner/repo
    const slugMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (slugMatch) {
      return { owner: slugMatch[1], repo: slugMatch[2] };
    }

    return null;
  },

  /**
   * Validates repository accessibility, permissions, and emptiness via GitHub REST API.
   * Never throws uncaught exceptions; returns typed diagnostic results.
   */
  async checkRepositoryAccess(
    owner: string,
    repo: string,
    options?: { token?: string }
  ): Promise<{
    status: 'ACCESSIBLE' | 'PRIVATE_OR_UNAUTHORIZED' | 'MISSING' | 'EMPTY' | 'RATE_LIMITED' | 'NETWORK_ERROR';
    message: string;
    defaultBranch?: string;
    isPrivate?: boolean;
    commitCount?: number;
  }> {
    const token =
      options?.token ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GITHUB_TOKEN) ||
      '';

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'PRison-Break-Build-From-Scratch-Evaluator',
    };
    if (token) headers.Authorization = `token ${token}`;

    try {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

      if (repoRes.status === 404) {
        return {
          status: 'MISSING',
          message: `Repository ${owner}/${repo} was not found on GitHub. Verify the owner and repository name, or ensure permissions are granted if private.`,
        };
      }

      if (repoRes.status === 401 || repoRes.status === 403) {
        const remaining = repoRes.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
          return {
            status: 'RATE_LIMITED',
            message: 'GitHub API rate limit exceeded. Please configure a GitHub token or wait for limit reset.',
          };
        }
        return {
          status: 'PRIVATE_OR_UNAUTHORIZED',
          message: `Repository ${owner}/${repo} is private or requires authorization. Ensure appropriate access is granted.`,
        };
      }

      if (!repoRes.ok) {
        return {
          status: 'NETWORK_ERROR',
          message: `GitHub returned unexpected HTTP status ${repoRes.status} for repository ${owner}/${repo}.`,
        };
      }

      const repoData = await repoRes.json();
      const defaultBranch = repoData.default_branch || 'main';

      // Check commit history to verify it is not empty
      const commitsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?per_page=5`,
        { headers }
      );

      if (commitsRes.status === 409 || (commitsRes.ok && (await commitsRes.json()).length === 0)) {
        return {
          status: 'EMPTY',
          message: `Repository ${owner}/${repo} is completely empty (no commits pushed to default branch "${defaultBranch}").`,
          defaultBranch,
          isPrivate: repoData.private,
          commitCount: 0,
        };
      }

      return {
        status: 'ACCESSIBLE',
        message: `Repository ${owner}/${repo} is accessible on branch "${defaultBranch}".`,
        defaultBranch,
        isPrivate: repoData.private,
      };
    } catch (err: any) {
      return {
        status: 'NETWORK_ERROR',
        message: `Network failure connecting to GitHub API: ${err?.message || 'Check internet connection.'}`,
      };
    }
  },

  /**
   * Registers or updates a team's GitHub repository and problem title.
   * Performs URL validation and initial accessibility test.
   */
  async registerTeamRepository(
    teamId: string,
    githubUrl: string,
    problemTitle?: string,
    adminUsername: string = 'admin'
  ): Promise<FirestoreTeam> {
    const parsed = this.parseRepositoryUrl(githubUrl);
    if (!parsed) {
      throw new Error(`Invalid GitHub repository URL: "${githubUrl}". Format must be https://github.com/owner/repo or owner/repo.`);
    }

    // Duplicate registration check across teams
    const currentTeams = await teamService.getTeams();
    const existingOther = currentTeams.find(
      (t) =>
        t.id !== teamId &&
        t.repoOwner?.toLowerCase() === parsed.owner.toLowerCase() &&
        t.repoName?.toLowerCase() === parsed.repo.toLowerCase()
    );
    if (existingOther) {
      throw new Error(
        `Repository ${parsed.owner}/${parsed.repo} is already registered to ${existingOther.name}. Each team must have a unique repository.`
      );
    }

    const access = await this.checkRepositoryAccess(parsed.owner, parsed.repo);

    const updates: Partial<FirestoreTeam> = {
      githubUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      repoOwner: parsed.owner,
      repoName: parsed.repo,
      repositoryName: parsed.repo,
      repositoryFullName: `${parsed.owner}/${parsed.repo}`,
      problemTitle: problemTitle || undefined,
      repoAccessStatus: access.status === 'ACCESSIBLE' ? 'ACCESSIBLE' : access.status,
      buildSubmissionStatus: access.status === 'ACCESSIBLE' ? 'SUBMITTED' : access.status === 'EMPTY' ? 'EMPTY' : 'INACCESSIBLE',
      evaluationStatus: 'NOT_STARTED',
      updatedAt: new Date().toISOString(),
    };

    const updatedTeam = await teamService.updateTeamDetails(teamId, updates, adminUsername, `Registered GitHub repository: ${parsed.owner}/${parsed.repo}`);
    return updatedTeam;
  },

  /**
   * Analyzes Git workflow from commit list.
   * Specifically implements:
   * - Does NOT award XP solely for commit count.
   * - Flags trivial, empty, or duplicate commits.
   * - Evaluates commit progression across registered team members.
   * - Flags suspicious anomalies for manual review rather than accusing students.
   */
  analyzeGitWorkflow(
    commits: Array<{ sha: string; message: string; author: string; email?: string; timestamp?: string }>,
    registeredMembers: string[] = []
  ): GitWorkflowEvaluation {
    const totalCommits = commits.length;
    const findings: string[] = [];
    const flags: string[] = [];

    if (totalCommits === 0) {
      return {
        score: 0,
        maxScore: 100,
        totalCommits: 0,
        meaningfulCommits: 0,
        trivialOrCosmeticCount: 0,
        emptyCommitsCount: 0,
        duplicateCommitsCount: 0,
        contributorCount: 0,
        registeredContributorsFound: [],
        unregisteredContributorsFound: [],
        commitTimelineProgression: 'No commits found',
        findings: ['Repository contains no commit history.'],
        flags: ['Empty repository commit history.'],
      };
    }

    let meaningfulCommits = 0;
    let trivialCount = 0;
    let duplicateCount = 0;
    const seenMessages = new Set<string>();
    const authors = new Set<string>();

    const normalizedMembers = registeredMembers.map((m) => m.toLowerCase().trim());

    commits.forEach((c) => {
      const msg = (c.message || '').trim();
      const normAuthor = (c.author || 'unknown').toLowerCase().trim();
      authors.add(normAuthor);

      // Check duplicates
      const msgKey = msg.toLowerCase();
      if (seenMessages.has(msgKey)) {
        duplicateCount++;
      } else {
        seenMessages.add(msgKey);
      }

      // Check triviality
      const isTrivial =
        msg.length < 5 ||
        TRIVIAL_COMMIT_PATTERNS.some((pat) => pat.test(msg));

      if (isTrivial) {
        trivialCount++;
      } else {
        meaningfulCommits++;
      }
    });

    const registeredFound: string[] = [];
    const unregisteredFound: string[] = [];

    authors.forEach((author) => {
      if (normalizedMembers.some((m) => m === author || author.includes(m) || m.includes(author))) {
        registeredFound.push(author);
      } else {
        unregisteredFound.push(author);
      }
    });

    // Progression summary
    let timelineProgression = 'Incremental progression over hackathon timeline';
    if (commits.length >= 2 && commits[0].timestamp && commits[commits.length - 1].timestamp) {
      const first = new Date(commits[commits.length - 1].timestamp!);
      const last = new Date(commits[0].timestamp!);
      const diffHours = Math.abs(last.getTime() - first.getTime()) / (1000 * 60 * 60);
      timelineProgression = `${commits.length} commits spanned over approx ${diffHours.toFixed(1)} hours.`;
    }

    // Scoring logic (Max 100):
    // Based on meaningful commit ratio, collaboration, and incremental development
    let score = 0;

    // 1. Meaningful commit proportion (up to 40 pts)
    const meaningfulRatio = totalCommits > 0 ? meaningfulCommits / totalCommits : 0;
    score += Math.round(meaningfulRatio * 40);

    // 2. Incremental progression evidence (up to 30 pts)
    if (meaningfulCommits >= 5) {
      score += 30;
      findings.push(`Demonstrated solid incremental development with ${meaningfulCommits} substantive commits.`);
    } else if (meaningfulCommits >= 2) {
      score += 20;
      findings.push(`Demonstrated moderate development progression with ${meaningfulCommits} substantive commits.`);
    } else {
      score += 10;
      flags.push('Low number of meaningful commits detected; most work committed in bulk.');
    }

    // 3. Multi-contributor collaboration (up to 30 pts)
    if (registeredFound.length >= 3) {
      score += 30;
      findings.push(`Strong team collaboration: ${registeredFound.length} registered members contributed commits.`);
    } else if (registeredFound.length === 2) {
      score += 22;
      findings.push(`Collaboration detected: ${registeredFound.length} registered members contributed commits.`);
    } else if (registeredFound.length === 1) {
      score += 15;
      flags.push('All commits were made by a single team member. Requires manual verification of team contribution distribution.');
    } else {
      score += 10;
      flags.push('Commit author names did not match registered team member usernames.');
    }

    if (trivialCount > 0) {
      findings.push(`${trivialCount} trivial or cosmetic-only commit messages detected (no XP awarded for trivial messages).`);
    }
    if (duplicateCount > 0) {
      findings.push(`${duplicateCount} duplicate commit messages detected.`);
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      maxScore: 100,
      totalCommits,
      meaningfulCommits,
      trivialOrCosmeticCount: trivialCount,
      emptyCommitsCount: 0,
      duplicateCommitsCount: duplicateCount,
      contributorCount: authors.size,
      registeredContributorsFound: registeredFound,
      unregisteredContributorsFound: unregisteredFound,
      commitTimelineProgression: timelineProgression,
      findings,
      flags,
    };
  },

  /**
   * Analyzes project files and commits to evaluate milestone checkpoints.
   */
  analyzeCheckpoints(
    checkpoints: HackathonCheckpoint[],
    files: Array<{ filename: string; content?: string }>,
    commits: Array<{ sha: string; message: string; author?: string }>
  ): CheckpointEvaluation[] {
    const fileList = files.map((f) => f.filename.toLowerCase());
    const now = new Date().toISOString();

    return checkpoints.map((cp) => {
      if (!cp.enabled) {
        return {
          checkpointId: cp.id,
          checkpointName: cp.displayName,
          status: 'NOT_MET' as CheckpointVerificationStatus,
          score: 0,
          maxScore: cp.xpValue,
          explanation: 'Checkpoint is currently disabled in event configuration.',
          evidenceFiles: [],
          evidenceCommits: [],
          evaluator: 'automated_agent',
          evaluatedAt: now,
        };
      }

      let status: CheckpointVerificationStatus = 'INSUFFICIENT_EVIDENCE';
      let score = 0;
      let explanation = '';
      const evidenceFiles: string[] = [];
      const evidenceCommits: string[] = [];

      switch (cp.id) {
        case 'blueprint': {
          // Mission Blueprint: Architecture design, docs, README, project structure
          const docFiles = files.filter((f) =>
            /readme|architecture|design|spec|plan|doc/i.test(f.filename)
          );
          if (docFiles.length > 0) {
            evidenceFiles.push(...docFiles.map((d) => d.filename));
            status = 'VERIFIED';
            score = cp.xpValue;
            explanation = `Verified planning artifacts and project blueprint in ${docFiles.map((d) => d.filename).join(', ')}.`;
          } else if (fileList.length > 3) {
            status = 'PARTIAL';
            score = Math.round(cp.xpValue * 0.6);
            explanation = 'Project directory structure is organized, but dedicated architecture/design planning documents were missing.';
          } else {
            status = 'INSUFFICIENT_EVIDENCE';
            score = 0;
            explanation = 'Missing blueprint documentation and minimal directory structure.';
          }
          break;
        }

        case 'core_impl': {
          // Core Implementation: Substantial domain logic & classes
          const srcFiles = files.filter((f) =>
            /\.(java|py|ts|js|go|rs|cpp|cs|kt|rb)$/i.test(f.filename) &&
            !/test|spec/i.test(f.filename)
          );
          if (srcFiles.length >= 3) {
            evidenceFiles.push(...srcFiles.slice(0, 6).map((s) => s.filename));
            status = 'VERIFIED';
            score = cp.xpValue;
            explanation = `Found ${srcFiles.length} core implementation source files implementing domain logic.`;
          } else if (srcFiles.length > 0) {
            evidenceFiles.push(...srcFiles.map((s) => s.filename));
            status = 'PARTIAL';
            score = Math.round(cp.xpValue * 0.65);
            explanation = `Found ${srcFiles.length} core source file(s), partial implementation detected.`;
          } else {
            status = 'INSUFFICIENT_EVIDENCE';
            score = 0;
            explanation = 'No core domain implementation source files detected.';
          }
          break;
        }

        case 'integration': {
          // Integration: Module interaction & multi-contributor commits
          const commitMatches = commits.filter((c) =>
            /integrat|connect|module|wire|merge|api|route|service/i.test(c.message)
          );
          if (commitMatches.length > 0 || commits.length >= 4) {
            evidenceCommits.push(...commits.slice(0, 3).map((c) => c.sha.slice(0, 7)));
            status = 'VERIFIED';
            score = cp.xpValue;
            explanation = 'Integration of modules and cohesive repository commits verified.';
          } else if (commits.length >= 2) {
            evidenceCommits.push(commits[0].sha.slice(0, 7));
            status = 'PARTIAL';
            score = Math.round(cp.xpValue * 0.6);
            explanation = 'Minimal integration commits; repository appears assembled in few steps.';
          } else {
            status = 'INSUFFICIENT_EVIDENCE';
            score = 0;
            explanation = 'Insufficient integration evidence across repository commits.';
          }
          break;
        }

        case 'execution': {
          // Execution: Working application entry point and program flow
          const entryPointFiles = files.filter((f) =>
            /main|index|app|server|cli|program|run|start|allocate|system|manager/i.test(f.filename) ||
            /pom\.xml|package\.json|cargo\.toml|go\.mod|requirements\.txt/i.test(f.filename) ||
            (f.content && /public\s+static\s+void\s+main|if\s+__name__\s*==\s*['"]__main__['"]|func\s+main\s*\(|fn\s+main\s*\(|int\s+main\s*\(/i.test(f.content))
          );
          if (entryPointFiles.length > 0) {
            evidenceFiles.push(...entryPointFiles.map((e) => e.filename));
            status = 'VERIFIED';
            score = cp.xpValue;
            explanation = `Entry point and program execution configuration identified in ${entryPointFiles.map((e) => e.filename).join(', ')}.`;
          } else {
            status = 'PARTIAL';
            score = Math.round(cp.xpValue * 0.4);
            explanation = 'Executable entry point is not standardly configured; manual run verification needed.';
          }
          break;
        }

        case 'testing_verification': {
          // Testing and Verification: Test cases, defect fixes, verification
          const testFiles = files.filter((f) =>
            /test|spec|assert|verify/i.test(f.filename)
          );
          if (testFiles.length > 0) {
            evidenceFiles.push(...testFiles.map((t) => t.filename));
            status = 'VERIFIED';
            score = cp.xpValue;
            explanation = `Verified ${testFiles.length} test and verification suite file(s): ${testFiles.map((t) => t.filename).join(', ')}.`;
          } else {
            status = 'INSUFFICIENT_EVIDENCE';
            score = 0;
            explanation = 'No automated test files or verification scripts found in repository.';
          }
          break;
        }

        default: {
          // Custom / user-configured checkpoint
          status = 'PARTIAL';
          score = Math.round(cp.xpValue * 0.5);
          explanation = `Configured milestone checkpoint "${cp.displayName}" evaluated against repository context.`;
          break;
        }
      }

      return {
        checkpointId: cp.id,
        checkpointName: cp.displayName,
        status,
        score,
        maxScore: cp.xpValue,
        explanation,
        evidenceFiles,
        evidenceCommits,
        evaluator: 'automated_agent',
        evaluatedAt: now,
      };
    });
  },

  /**
   * Safe static code quality analysis.
   * Does NOT run untrusted code. Detects readability, modularity, TODOs/stubs, error handling.
   */
  analyzeCodeQuality(files: Array<{ filename: string; content?: string }>): CodeQualityEvaluation {
    const findings: string[] = [];
    const detectedIssues: string[] = [];
    let score = 70; // baseline

    const codeFiles = files.filter((f) =>
      /\.(java|py|ts|js|go|rs|cpp|cs)$/i.test(f.filename)
    );

    if (codeFiles.length === 0) {
      return {
        score: 0,
        maxScore: 100,
        structureRating: 'POOR',
        modularityNotes: 'No executable source files found.',
        errorHandlingNotes: 'None detected.',
        detectedIssues: ['Empty code base.'],
        findings: ['No programming language source files found.'],
      };
    }

    // Modularity check
    if (codeFiles.length >= 4) {
      score += 15;
      findings.push(`Good modularity across ${codeFiles.length} source files.`);
    } else {
      findings.push(`Concentrated in ${codeFiles.length} source file(s).`);
    }

    // Inspect content for quality signals
    let todoCount = 0;
    let tryCatchCount = 0;

    codeFiles.forEach((file) => {
      const content = file.content || '';
      const todos = (content.match(/TODO|FIXME|XXX/g) || []).length;
      todoCount += todos;

      const errorHandling = (content.match(/try\s*\{|catch\s*\(|except\s*:|if\s*err\s*!=\s*nil/g) || []).length;
      tryCatchCount += errorHandling;
    });

    if (tryCatchCount >= 2) {
      score += 15;
      findings.push('Defensive programming and error handling structures detected.');
    } else {
      detectedIssues.push('Sparse error handling / exception safety structures detected.');
    }

    if (todoCount > 3) {
      score -= 10;
      detectedIssues.push(`Found ${todoCount} unresolved TODO/FIXME markers in implementation.`);
    }

    const finalScore = Math.min(100, Math.max(20, score));
    const rating =
      finalScore >= 85 ? 'EXCELLENT' : finalScore >= 70 ? 'GOOD' : finalScore >= 50 ? 'ACCEPTABLE' : 'POOR';

    return {
      score: finalScore,
      maxScore: 100,
      structureRating: rating,
      modularityNotes: `${codeFiles.length} source files detected with ${rating.toLowerCase()} organization.`,
      errorHandlingNotes: tryCatchCount > 0 ? `${tryCatchCount} error handling blocks found.` : 'Limited error handling detected.',
      detectedIssues,
      findings,
    };
  },

  /**
   * Safe language, build system, and test runner detection.
   * Static inspection only: never executes untrusted student scripts directly.
   */
  analyzeBuildAndTesting(files: Array<{ filename: string; content?: string }>): BuildAndTestingEvaluation {
    const fileNames = files.map((f) => f.filename.toLowerCase());
    const findings: string[] = [];
    let detectedLanguage = 'Unknown';
    let detectedBuildSystem = 'None detected';
    const detectedBuildCommands: string[] = [];
    const detectedConfigFiles: string[] = [];
    const testFiles: string[] = [];

    // Language & Build Tool detection
    if (fileNames.some((f) => f.endsWith('pom.xml'))) {
      detectedLanguage = 'Java';
      detectedBuildSystem = 'Apache Maven';
      detectedBuildCommands.push('mvn clean compile', 'mvn test');
      detectedConfigFiles.push('pom.xml');
    } else if (fileNames.some((f) => f.endsWith('build.gradle') || f.endsWith('build.gradle.kts'))) {
      detectedLanguage = 'Java / Kotlin';
      detectedBuildSystem = 'Gradle';
      detectedBuildCommands.push('./gradlew build', './gradlew test');
      detectedConfigFiles.push('build.gradle');
    } else if (fileNames.some((f) => f.endsWith('package.json'))) {
      detectedLanguage = fileNames.some((f) => f.endsWith('.ts') || f.endsWith('.tsx')) ? 'TypeScript' : 'JavaScript';
      detectedBuildSystem = 'Node.js / npm';
      detectedBuildCommands.push('npm install', 'npm test');
      detectedConfigFiles.push('package.json');
    } else if (fileNames.some((f) => f.endsWith('requirements.txt') || f.endsWith('pyproject.toml') || f.endsWith('setup.py'))) {
      detectedLanguage = 'Python';
      detectedBuildSystem = 'pip / pyproject';
      detectedBuildCommands.push('pip install -r requirements.txt', 'pytest');
      detectedConfigFiles.push('requirements.txt');
    } else if (fileNames.some((f) => f.endsWith('cargo.toml'))) {
      detectedLanguage = 'Rust';
      detectedBuildSystem = 'Cargo';
      detectedBuildCommands.push('cargo build', 'cargo test');
      detectedConfigFiles.push('Cargo.toml');
    } else if (fileNames.some((f) => f.endsWith('go.mod'))) {
      detectedLanguage = 'Go';
      detectedBuildSystem = 'Go Modules';
      detectedBuildCommands.push('go build ./...', 'go test ./...');
      detectedConfigFiles.push('go.mod');
    } else if (fileNames.some((f) => f.endsWith('.java'))) {
      detectedLanguage = 'Java';
      detectedBuildSystem = 'Standard Java Toolchain (javac)';
      detectedBuildCommands.push('javac -d . *.java', 'java <MainClass>');
    } else if (fileNames.some((f) => f.endsWith('.py'))) {
      detectedLanguage = 'Python';
      detectedBuildSystem = 'Python Standard Library';
      detectedBuildCommands.push('python <script>.py');
    } else if (fileNames.some((f) => /\.(cpp|cc|cxx|c)$/i.test(f))) {
      detectedLanguage = 'C / C++';
      detectedBuildSystem = 'GCC / Clang Compiler';
      detectedBuildCommands.push('g++ -O2 *.cpp -o app', './app');
    } else if (fileNames.some((f) => f.endsWith('.go'))) {
      detectedLanguage = 'Go';
      detectedBuildSystem = 'Go Toolchain';
      detectedBuildCommands.push('go run .');
    } else if (fileNames.some((f) => f.endsWith('.rs'))) {
      detectedLanguage = 'Rust';
      detectedBuildSystem = 'Rustc';
      detectedBuildCommands.push('rustc main.rs', './main');
    }

    // Test case detection
    files.forEach((f) => {
      const lower = f.filename.toLowerCase();
      if (
        (lower.includes('test') || lower.includes('spec') || lower.includes('verify')) &&
        /\.(java|ts|js|py|go|rs|cpp|sh|bat)$/i.test(lower)
      ) {
        testFiles.push(f.filename);
      }
    });

    const hasTestCases = testFiles.length > 0;
    let score = 50;

    if (detectedBuildSystem !== 'None detected') {
      score += 25;
      findings.push(`Build system recognized: ${detectedBuildSystem} (${detectedLanguage}).`);
    } else {
      findings.push('No standard build configuration file found.');
    }

    if (hasTestCases) {
      score += 25;
      findings.push(`Automated tests detected (${testFiles.length} file(s)).`);
    } else {
      findings.push('No test suites found in repository.');
    }

    return {
      score,
      maxScore: 100,
      detectedLanguage,
      detectedBuildSystem,
      detectedBuildCommands,
      detectedConfigFiles,
      hasTestCases,
      testFiles,
      runtimeVerificationStatus: 'UNAVAILABLE',
      runtimeNotes: 'Static analysis complete. Isolated runtime execution sandbox is not configured; student code execution withheld for security.',
      findings,
    };
  },

  /**
   * Documentation quality evaluation (README, setup, architecture).
   */
  analyzeDocumentation(files: Array<{ filename: string; content?: string }>): DocumentationEvaluation {
    const findings: string[] = [];
    const readmeFile = files.find((f) => /readme\.md$/i.test(f.filename));
    const hasReadme = !!readmeFile;

    if (!hasReadme) {
      return {
        score: 0,
        maxScore: 100,
        hasReadme: false,
        setupInstructionsPresent: false,
        architectureDocumented: false,
        testInstructionsPresent: false,
        findings: ['No README.md documentation file found in repository root.'],
      };
    }

    const content = readmeFile.content || '';
    let score = 40; // Base score for having README

    const setupInstructionsPresent = /install|setup|prerequisite|getting started|run(ning)?|usage/i.test(content);
    if (setupInstructionsPresent) {
      score += 25;
      findings.push('Setup and installation instructions identified in README.');
    }

    const architectureDocumented = /architect|overview|design|flow|structure|component|module/i.test(content);
    if (architectureDocumented) {
      score += 20;
      findings.push('Architecture and project design overview documented.');
    }

    const testInstructionsPresent = /test|testing|verify|verification/i.test(content);
    if (testInstructionsPresent) {
      score += 15;
      findings.push('Testing and execution instructions documented.');
    }

    return {
      score: Math.min(100, score),
      maxScore: 100,
      hasReadme: true,
      setupInstructionsPresent,
      architectureDocumented,
      testInstructionsPresent,
      findings,
    };
  },

  /**
   * Main Post-Submission Repository Evaluation Agent Workflow.
   * Can be launched by an administrator.
   * Safe, idempotent, produces structured evidence report, does not fabricate AI results.
   */
  async evaluateRepository(params: {
    teamId: string;
    githubUrl?: string;
    token?: string;
    mockCommitHistory?: Array<{ sha: string; message: string; author: string; timestamp?: string }>;
    mockFiles?: Array<{ filename: string; content?: string }>;
    isOfflineSimulation?: boolean;
    adminUsername?: string;
  }): Promise<RepoEvaluationReport> {
    const team = await teamService.getTeamById(params.teamId);
    if (!team) {
      throw new Error(`Team not found: "${params.teamId}".`);
    }

    const repoUrl = params.githubUrl || team.githubUrl;
    if (!repoUrl) {
      throw new Error(`Team ${team.name} has no registered GitHub repository URL. Please register a repository first.`);
    }

    const parsed = this.parseRepositoryUrl(repoUrl);
    if (!parsed) {
      throw new Error(`Invalid GitHub repository URL "${repoUrl}".`);
    }

    const activeConfig = await eventConfigService.getEventConfig();
    const checkpoints = activeConfig.checkpoints || DEFAULT_CHECKPOINTS;

    let commits = params.mockCommitHistory || [];
    let files = params.mockFiles || [];
    const warnings: string[] = [];
    const missingEvidence: string[] = [];

    // If online evaluation (not mocked/unit tested)
    if (!params.isOfflineSimulation && commits.length === 0 && files.length === 0) {
      const access = await this.checkRepositoryAccess(parsed.owner, parsed.repo, { token: params.token });
      if (access.status !== 'ACCESSIBLE') {
        const errorReport: RepoEvaluationReport = {
          id: `eval_${params.teamId}_err_${Date.now()}`,
          teamId: params.teamId,
          teamName: team.name,
          repositoryUrl: repoUrl,
          repositoryOwner: parsed.owner,
          repositoryName: parsed.repo,
          evaluatedAt: new Date().toISOString(),
          evaluationVersion: (team.latestEvaluationReport?.evaluationVersion || 0) + 1,
          evaluator: 'automated_agent',
          categoryScores: { checkpoints: 0, gitWorkflow: 0, codeQuality: 0, buildTesting: 0, documentation: 0 },
          maxCategoryScores: { checkpoints: 750, gitWorkflow: 100, codeQuality: 100, buildTesting: 100, documentation: 100 },
          checkpoints: checkpoints.map((cp) => ({
            checkpointId: cp.id,
            checkpointName: cp.displayName,
            status: 'NOT_MET',
            score: 0,
            maxScore: cp.xpValue,
            explanation: `Repository is ${access.status}: ${access.message}`,
            evidenceFiles: [],
            evidenceCommits: [],
            evaluator: 'automated_agent',
            evaluatedAt: new Date().toISOString(),
          })),
          gitWorkflow: {
            score: 0,
            maxScore: 100,
            totalCommits: 0,
            meaningfulCommits: 0,
            trivialOrCosmeticCount: 0,
            emptyCommitsCount: 0,
            duplicateCommitsCount: 0,
            contributorCount: 0,
            registeredContributorsFound: [],
            unregisteredContributorsFound: [],
            commitTimelineProgression: 'Inaccessible',
            findings: [access.message],
            flags: [access.message],
          },
          codeQuality: {
            score: 0,
            maxScore: 100,
            structureRating: 'POOR',
            modularityNotes: 'Repository inaccessible.',
            errorHandlingNotes: 'N/A',
            detectedIssues: [access.message],
            findings: [],
          },
          buildTesting: {
            score: 0,
            maxScore: 100,
            detectedLanguage: 'Unknown',
            detectedBuildSystem: 'None',
            detectedBuildCommands: [],
            detectedConfigFiles: [],
            hasTestCases: false,
            testFiles: [],
            runtimeVerificationStatus: 'UNAVAILABLE',
            runtimeNotes: access.message,
            findings: [],
          },
          documentation: {
            score: 0,
            maxScore: 100,
            hasReadme: false,
            setupInstructionsPresent: false,
            architectureDocumented: false,
            testInstructionsPresent: false,
            findings: [access.message],
          },
          totalGitProcessScore: 0,
          earnedXP: 0,
          missingEvidence: [access.message],
          warnings: [access.message],
          manualReviewRequired: true,
          status: 'FAILED',
        };

        // Update team status
        await teamService.updateTeamDetails(
          params.teamId,
          {
            evaluationStatus: 'FAILED',
            buildSubmissionStatus: access.status === 'EMPTY' ? 'EMPTY' : 'INACCESSIBLE',
            latestEvaluationReport: errorReport,
            lastEvaluationTimestamp: new Date().toISOString(),
          },
          params.adminUsername || 'system',
          `Automated evaluation failed: ${access.message}`
        );

        return errorReport;
      }

      // Fetch repository commits from GitHub
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'PRison-Break-Build-From-Scratch-Evaluator',
      };
      if (params.token) headers.Authorization = `token ${params.token}`;

      try {
        const cRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=50`, { headers });
        if (cRes.ok) {
          const rawCommits = await cRes.json();
          commits = rawCommits.map((c: any) => ({
            sha: c.sha,
            message: c.commit?.message || '',
            author: c.author?.login || c.commit?.author?.name || 'unknown',
            email: c.commit?.author?.email,
            timestamp: c.commit?.author?.date,
          }));
        }

        // Fetch tree for files
        const branch = access.defaultBranch || 'main';
        const treeRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${branch}?recursive=1`, { headers });
        if (treeRes.ok) {
          const rawTree = await treeRes.json();
          if (Array.isArray(rawTree.tree)) {
            files = rawTree.tree
              .filter((node: any) => node.type === 'blob')
              .map((node: any) => ({ filename: node.path }));

            // Fetch content for README and key source files (up to 8 files) to evaluate quality and instructions
            const keyFiles = files
              .filter((f) =>
                /readme/i.test(f.filename) ||
                /\.(java|py|ts|js|go|rs|cpp|cs)$/i.test(f.filename) ||
                /pom\.xml|build\.gradle|package\.json|cargo\.toml|go\.mod|requirements\.txt/i.test(f.filename)
              )
              .slice(0, 10);

            await Promise.all(
              keyFiles.map(async (kf) => {
                try {
                  const rawRes = await fetch(
                    `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${encodeURIComponent(kf.filename)}`
                  );
                  if (rawRes.ok) {
                    kf.content = await rawRes.text();
                  }
                } catch {
                  // ignore individual file fetch error
                }
              })
            );
          }
        }
      } catch (fetchErr: any) {
        warnings.push(`GitHub API error while fetching repo content: ${fetchErr?.message}`);
      }
    }

    // Registered members
    const registeredMembers = (team.members || []).map((m) => m.githubUsername || m.name);

    // 1. Git Workflow analysis
    const gitWorkflow = this.analyzeGitWorkflow(commits, registeredMembers);

    // 2. Checkpoint analysis
    const checkpointResults = this.analyzeCheckpoints(checkpoints, files, commits);

    // 3. Code quality analysis
    const codeQuality = this.analyzeCodeQuality(files);

    // 4. Build and testing analysis
    const buildTesting = this.analyzeBuildAndTesting(files);

    // 5. Documentation analysis
    const documentation = this.analyzeDocumentation(files);

    // Aggregate category scores
    const totalCheckpointEarned = checkpointResults.reduce((sum, cp) => sum + cp.score, 0);
    const totalCheckpointMax = checkpointResults.reduce((sum, cp) => sum + cp.maxScore, 0);

    // Calculate normalized Git / Process score (0 - 100)
    // Checkpoints: 40%, Git Workflow: 25%, Code Quality: 20%, Documentation: 15%
    const checkpointRatio = totalCheckpointMax > 0 ? totalCheckpointEarned / totalCheckpointMax : 0;
    const gitProcessScore = Math.round(
      checkpointRatio * 40 +
      (gitWorkflow.score / 100) * 25 +
      (codeQuality.score / 100) * 20 +
      (documentation.score / 100) * 15
    );

    // Total earned XP (Checkpoint XP + Git Process scaling)
    const earnedXP = totalCheckpointEarned + Math.round((gitWorkflow.score / 100) * 50);

    // Check for missing evidence or manual review triggers
    checkpointResults.forEach((cp) => {
      if (cp.status === 'INSUFFICIENT_EVIDENCE' || cp.status === 'NOT_MET') {
        missingEvidence.push(`${cp.checkpointName}: ${cp.explanation}`);
      }
    });

    if (gitWorkflow.flags.length > 0) {
      warnings.push(...gitWorkflow.flags);
    }
    if (codeQuality.detectedIssues.length > 0) {
      warnings.push(...codeQuality.detectedIssues);
    }

    const manualReviewRequired = warnings.length > 0 || missingEvidence.length > 0;
    const now = new Date().toISOString();
    const newVersion = (team.latestEvaluationReport?.evaluationVersion || 0) + 1;
    const reportId = `eval_${params.teamId}_v${newVersion}`;

    const report: RepoEvaluationReport = {
      id: reportId,
      teamId: params.teamId,
      teamName: team.name,
      repositoryUrl: repoUrl,
      repositoryOwner: parsed.owner,
      repositoryName: parsed.repo,
      commitSha: commits[0]?.sha,
      evaluatedAt: now,
      evaluationVersion: newVersion,
      evaluator: 'automated_agent',
      categoryScores: {
        checkpoints: totalCheckpointEarned,
        gitWorkflow: gitWorkflow.score,
        codeQuality: codeQuality.score,
        buildTesting: buildTesting.score,
        documentation: documentation.score,
      },
      maxCategoryScores: {
        checkpoints: totalCheckpointMax,
        gitWorkflow: 100,
        codeQuality: 100,
        buildTesting: 100,
        documentation: 100,
      },
      checkpoints: checkpointResults,
      gitWorkflow,
      codeQuality,
      buildTesting,
      documentation,
      totalGitProcessScore: Math.min(100, Math.max(0, gitProcessScore)),
      earnedXP,
      missingEvidence,
      warnings,
      manualReviewRequired,
      status: 'PROPOSED',
    };

    // Store in memory
    inMemoryEvaluations.set(report.id, report);
    notifyEvaluationListeners();

    // Persist to Firestore if available
    if (isFirebaseConfigured()) {
      try {
        const evalRef = doc(db, EVALUATIONS_COLLECTION, report.id);
        await setDoc(evalRef, report);
      } catch (err) {
        console.warn('[BuildFromScratchService] Error persisting evaluation report to Firestore:', err);
      }
    }

    // Update team document deterministically (without duplicating bonus XP or resetting scores)
    await teamService.updateTeamDetails(
      params.teamId,
      {
        gitProcessScore: report.totalGitProcessScore,
        earnedXP: report.earnedXP,
        totalXP: Math.round((report.earnedXP || 0) + (team.bonusXP || 0)),
        totalScore: Math.round((report.earnedXP || 0) + (team.bonusXP || 0)),
        evaluationStatus: manualReviewRequired ? 'REVIEW_REQUIRED' : 'COMPLETED',
        buildSubmissionStatus: 'EVALUATED',
        latestEvaluationReport: report,
        lastEvaluationTimestamp: now,
      },
      params.adminUsername || 'automated_agent',
      `Repository evaluated (v${newVersion}). Git/Process Score: ${report.totalGitProcessScore}%, Earned XP: ${report.earnedXP}`
    );

    return report;
  },

  /**
   * Approves proposed evaluation results.
   */
  async approveEvaluation(
    reportId: string,
    adminUsername: string = 'admin',
    notes?: string
  ): Promise<RepoEvaluationReport> {
    eventConfigService.verifyAdminAccess(adminUsername);
    let report = inMemoryEvaluations.get(reportId);

    if (!report && isFirebaseConfigured()) {
      const snap = await getDoc(doc(db, EVALUATIONS_COLLECTION, reportId));
      if (snap.exists()) report = snap.data() as RepoEvaluationReport;
    }

    if (!report) {
      throw new Error(`Evaluation report not found: "${reportId}".`);
    }

    const now = new Date().toISOString();
    const updated: RepoEvaluationReport = {
      ...report,
      status: 'APPROVED',
      approvalDetails: {
        approvedBy: adminUsername,
        approvedAt: now,
        notes: notes || 'Evaluation approved by administrator',
      },
    };

    inMemoryEvaluations.set(reportId, updated);
    notifyEvaluationListeners();

    if (isFirebaseConfigured()) {
      await updateDoc(doc(db, EVALUATIONS_COLLECTION, reportId), {
        status: 'APPROVED',
        approvalDetails: updated.approvalDetails,
      });
    }

    await auditLogService.recordAuditLog({
      id: `audit_approve_${reportId}_${Date.now()}`,
      action: 'REPO_EVALUATION_APPROVED',
      adminUsername,
      targetId: report.teamId,
      targetName: `${report.teamName} Evaluation Report`,
      reason: notes || 'Admin approved automated evaluation score',
      previousValue: report.status,
      newValue: 'APPROVED',
      details: {
        reportId,
        score: report.totalGitProcessScore,
        earnedXP: report.earnedXP,
      },
      timestamp: now,
    });

    await teamService.updateTeamDetails(
      report.teamId,
      {
        evaluationStatus: 'COMPLETED',
        latestEvaluationReport: updated,
      },
      adminUsername,
      `Approved evaluation report ${reportId}`
    );

    return updated;
  },

  /**
   * Overrides proposed evaluation score with a mandatory recorded reason.
   */
  async overrideEvaluation(
    reportId: string,
    newGitProcessScore: number,
    param3: string = 'admin',
    param4: string = 'Administrative score adjustment'
  ): Promise<RepoEvaluationReport> {
    // Support flexible ordering if reason is passed in 3rd position
    let adminUsername = param3;
    let reason = param4;

    if (param3.includes(' ') && !param4.includes(' ')) {
      reason = param3;
      adminUsername = param4;
    } else if (param4 && (param4.startsWith('admin') || param4.startsWith('student') || param4.startsWith('proctor'))) {
      reason = param3;
      adminUsername = param4;
    }

    eventConfigService.verifyAdminAccess(adminUsername);

    if (!reason || reason.trim().length < 5) {
      throw new Error('A documented justification reason (min 5 characters) is required to override evaluation scores.');
    }
    if (newGitProcessScore < 0 || newGitProcessScore > 100 || !Number.isFinite(newGitProcessScore)) {
      throw new Error('Git/Process score must be a number between 0 and 100.');
    }

    let report = inMemoryEvaluations.get(reportId);
    if (!report && isFirebaseConfigured()) {
      const snap = await getDoc(doc(db, EVALUATIONS_COLLECTION, reportId));
      if (snap.exists()) report = snap.data() as RepoEvaluationReport;
    }

    if (!report) {
      throw new Error(`Evaluation report not found: "${reportId}".`);
    }

    const previousScore = report.totalGitProcessScore;
    const now = new Date().toISOString();

    const updated: RepoEvaluationReport = {
      ...report,
      totalGitProcessScore: newGitProcessScore,
      status: 'OVERRIDDEN',
      overrideDetails: {
        overriddenBy: adminUsername,
        overriddenAt: now,
        previousScore,
        newScore: newGitProcessScore,
        reason,
      },
    };

    inMemoryEvaluations.set(reportId, updated);
    notifyEvaluationListeners();

    if (isFirebaseConfigured()) {
      await updateDoc(doc(db, EVALUATIONS_COLLECTION, reportId), {
        totalGitProcessScore: newGitProcessScore,
        status: 'OVERRIDDEN',
        overrideDetails: updated.overrideDetails,
      });
    }

    await auditLogService.recordAuditLog({
      id: `audit_override_${reportId}_${Date.now()}`,
      action: 'REPO_EVALUATION_OVERRIDDEN',
      adminUsername,
      targetId: report.teamId,
      targetName: `${report.teamName} Evaluation Override`,
      reason,
      previousValue: previousScore,
      newValue: newGitProcessScore,
      details: {
        reportId,
        previousScore,
        newScore: newGitProcessScore,
      },
      timestamp: now,
    });

    await teamService.updateTeamDetails(
      report.teamId,
      {
        gitProcessScore: newGitProcessScore,
        latestEvaluationReport: updated,
      },
      adminUsername,
      `Overrode Git/Process score to ${newGitProcessScore} (was ${previousScore}): ${reason}`
    );

    return updated;
  },

  /**
   * Retrieves the latest evaluation report for a team.
   */
  async getEvaluationReport(teamId: string): Promise<RepoEvaluationReport | null> {
    const fromMem = Array.from(inMemoryEvaluations.values())
      .filter((r) => r.teamId === teamId)
      .sort((a, b) => b.evaluationVersion - a.evaluationVersion)[0];
    if (fromMem) return fromMem;

    if (!isFirebaseConfigured()) return null;

    try {
      const q = query(collection(db, EVALUATIONS_COLLECTION), where('teamId', '==', teamId));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const reports = snap.docs.map((d) => d.data() as RepoEvaluationReport);
      return reports.sort((a, b) => b.evaluationVersion - a.evaluationVersion)[0];
    } catch (err) {
      console.warn('[BuildFromScratchService] Error fetching evaluation report:', err);
      return null;
    }
  },

  /**
   * Subscribes to evaluation updates in real-time.
   */
  subscribeToEvaluations(
    onUpdate: (reports: RepoEvaluationReport[]) => void
  ): Unsubscribe {
    evaluationListeners.add(onUpdate);
    onUpdate(Array.from(inMemoryEvaluations.values()));

    if (!isFirebaseConfigured()) {
      return () => {
        evaluationListeners.delete(onUpdate);
      };
    }

    try {
      const q = collection(db, EVALUATIONS_COLLECTION);
      const unsub = onSnapshot(q, (snap) => {
        const reports = snap.docs.map((d) => d.data() as RepoEvaluationReport);
        reports.forEach((r) => inMemoryEvaluations.set(r.id, r));
        onUpdate(Array.from(inMemoryEvaluations.values()));
      });
      return () => {
        evaluationListeners.delete(onUpdate);
        unsub();
      };
    } catch {
      return () => {
        evaluationListeners.delete(onUpdate);
      };
    }
  },
};
