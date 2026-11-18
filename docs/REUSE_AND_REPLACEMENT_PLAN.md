# Evalora Reuse and Replacement Plan (Phase 0)

**Date**: November 2026  
**Auditor**: Lead Software Architect & Senior Full-Stack Engineer  
**Project**: Evalora (working name)  
**Tagline**: Better reviews. Clearer decisions.  

---

## 1. Executive Strategy

Evalora transforms the application from a single-competition Java bug hunt leaderboard into a multi-format, AI-assisted project evaluation SaaS platform for hackathons, innovation challenges, and research competitions.

This plan establishes strict boundaries between:
1. **Modules to Reuse Directly**: Well-tested, domain-agnostic utilities and UI primitives.
2. **Modules to Adapt / Refactor**: Proven architectural patterns (rubrics, audit logging, reconciliation) refactored for the Evalora domain.
3. **Modules to Retire / Replace**: Obsolete story-themed UI, gamification elements, and hardcoded coding-contest engines.
4. **Dangerous Anti-Patterns to Eliminate**: Client-side secrets, fake authentication, and permissive security rules.

---

## 2. Reusable Modules

### A. Direct Reuse (Zero or Minimal Changes)
* **`src/utils/githubUrl.ts`**:
  - *Utility*: `parseAndNormalizeGithubUrl()`
  - *Role*: Validates participant GitHub repository links in project submissions, strips `.git`, normalizes protocols, and prevents malicious path traversal.
* **`src/components/ui/ConfirmDialog.tsx`**:
  - *Role*: Modal dialog for critical actions (e.g. finalizing results, approving score overrides, closing submissions).
* **`src/components/ui/LoadingState.tsx`**:
  - *Role*: Standardized loading spinner and skeleton screen for async data fetching.
* **`src/components/ui/EmptyState.tsx`**:
  - *Role*: Consistent empty state representation when no submissions or reviews exist.
* **`src/components/ui/StatusBadge.tsx`**:
  - *Role*: Color-coded status badge for submission review states (`QUEUED`, `EVALUATING`, `READY_FOR_JUDGE`, `REVIEWED`, `PUBLISHED`).
* **Test Harness**:
  - *Files*: `vite.config.ts`, `vitest` configuration, in-memory Firestore mocking patterns.

### B. Architectural & Logic Adaptation
* **`src/services/facultyEvaluationService.ts` ➔ `src/services/judgeEvaluationService.ts`**:
  - *Existing*: Multi-criteria rubric evaluation (`FacultyEvaluationCriterion`), score normalization, reviewer attribution, and audit trail of adjustments.
  - *Adaptation*: Generalize into Evalora's Judge Workspace, supporting organizer-configured rubrics with criteria weights, judge comments, and side-by-side AI score comparison.
* **`src/services/auditLogService.ts` ➔ `src/services/evaloraAuditService.ts`**:
  - *Existing*: Immutable audit logging of score overrides, team adjustments, and review updates in Firestore with in-memory fallbacks.
  - *Adaptation*: Add events for competition creation, rubric updates, submission intake, AI evaluation execution, judge overrides, and official publishing sign-offs.
* **`src/services/scoreReconciliationService.ts` ➔ `src/services/consensusReconciliationService.ts`**:
  - *Existing*: Auditing engine comparing cached aggregates with immutable ledger events to detect duplicate awards or score drift.
  - *Adaptation*: Adapt to calculate inter-judge consensus, score standard deviations, and flag high-variance submissions for organizer review.
* **`src/config/firebase.ts`**:
  - *Existing*: Initializes Firebase App, Auth, and Firestore with environment variable resolution.
  - *Adaptation*: Add Firebase App Check initialization (`initializeAppCheck`) and Firebase AI Logic service (`getAI`, `GoogleAIBackend`).

---

## 3. Modules to Retire or Replace

### A. Visual & UI Layer (100% Replacement)
* **`src/index.css` (The Void Theme)**:
  - *Retire*: Neon crimson, cyberpunk glowing borders, dark sci-fi background grid, and story classes (`.void-bg`, `.scanline`).
  - *Replace*: Modern, clean SaaS design system: Light-first surfaces (`#FFFFFF`, `#F8FAFC`), dark slate typography (`#0F172A`), restrained blue primary accent (`#2563EB`), thin borders (`#E2E8F0`), and clear typography.
* **`src/components/leaderboard/*`**:
  - *Retire*: `Podium.tsx`, `AwardsShowcase.tsx`, `EventMilestoneStatusBar.tsx`, and `LeaderboardTable.tsx` (prison cells, escaped participants, XP counts).
  - *Replace*: Clean, professional tabular results with category filtering, criteria breakdowns, and export functionality.
* **`src/components/layout/*` (`TopBar.tsx`, `Sidebar.tsx`)**:
  - *Retire*: "PRison Control" branding, Warden icons, automatic GitHub sync badges.
  - *Replace*: Role-specific navigation for Organizers, Judges, and Public Submission access.

### B. Obsolete Coding Contest & PR Grading Engines
* **`src/services/javaGradingEngine.ts` & `javaSolutionEvaluator.ts`**:
  - *Reason*: Evalora focuses on project-based competitions (hackathons, innovation challenges, research exhibitions). Coding contests with automated unit test execution are explicitly out of scope for Release 1.
* **`src/services/offlinePRValidationService.ts` & `prValidationPipeline.ts`**:
  - *Reason*: GitHub PR lifecycle and diff-based issue verification are replaced by project submission evaluation (descriptions, architecture, repositories, decks, live demos).
* **`src/services/autoSyncService.ts` & `githubMergeService.ts`**:
  - *Reason*: Client-side GitHub polling every 10 seconds causes rate-limit exhaustion and is unnecessary for project submissions.
* **`src/data/challengeCatalog.ts` & `testSquads.ts`**:
  - *Reason*: Hardcoded static data specific to the old bug hunt contest.

---

## 4. Dangerous Implementations to Eliminate

| Vulnerability / Anti-Pattern | File Location | Mitigation Plan |
| :--- | :--- | :--- |
| **Wide-Open Firestore Rules** (`isAdmin() { return true; }`) | `firestore.rules` | Rewrite rules with strict authentication checks, role separation (Organizer, Judge, Participant), and public write-only restrictions for submissions. |
| **Hardcoded Admin Credentials** (`password: '12345678'`) | `src/config/adminConfig.ts` | Remove `ADMIN_CONFIG.defaultAdmin` completely. Use Firebase Authentication with email/password and custom claims. |
| **Client-Side Plaintext Password Matching** | `src/services/authService.ts` | Eliminate checks against `admin/credentials`. Authenticate strictly via Firebase Auth tokens. |
| **Session Spoofing via `sessionStorage`** | `src/services/authService.ts` | Remove `sessionStorage` authentication bypass. Listen solely to verified Firebase Auth tokens. |
| **Exposed Client API Secrets** (`VITE_GITHUB_TOKEN`, `VITE_GEMINI_API_KEY`) | `.env`, `aiValidationService.ts` | Remove client tokens. Firebase AI Logic authenticates using Firebase App Check and Google Cloud IAM without client API keys. |
| **Simulated AI Grading Presented as Real** | `api/evaluate-repo.ts`, `aiValidationService.ts` | Implement actual runtime hybrid inference via `firebase/ai` (Gemini Nano 4 on-device + Gemini 2.5 Flash in cloud). |

---

## 5. Preservation & Phasing Safeguards

To maintain workspace stability and prevent regressions:
1. **Zero Destructive Deletions in Early Phases**: Legacy files will not be deleted until the new Evalora architecture is operational and verified.
2. **Coexistence of Domain Namespaces**: New Evalora domain models will live under `src/types/evalora.ts` and new services under dedicated namespaces (`src/services/aiLogicService.ts`, `src/services/submissionService.ts`, etc.).
3. **Continuous Build & Test Integrity**: Every phase must verify that `npm test`, `npm run lint`, and `npm run build` pass cleanly before phase sign-off.
