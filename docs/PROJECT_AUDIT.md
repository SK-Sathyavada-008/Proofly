# Evalora Technical Audit & Codebase Inspection (Phase 0)

**Date**: November 2026  
**Auditor**: Lead Software Architect & Senior Full-Stack Engineer  
**Project**: Evalora (formerly PRison Control / Leaderboard)  
**Target Platform**: Chrome Web Application (#BuildHybridAI 2026)  

---

## Executive Summary

Evalora is transitioning from a story-themed, gamified GitHub PR tracking application ("PRison Control") to a production-minded competition submission and AI-assisted evaluation SaaS platform ("Evalora — Better reviews. Clearer decisions.").

This technical audit examines all 12 key facets of the existing repository, cataloging its frontend architecture, state management, component tree, Firebase configuration, Firestore schema, authentication mechanisms, security posture, evaluation engines, test suites, and deployment infrastructure.

Critical security vulnerabilities, architectural anti-patterns, and salvageable business logic modules have been cataloged to inform the phased modernization plan without breaking existing operational dependencies prematurely.

---

## 1. Current Frontend Architecture and Routing

### Routing Framework
* **Package**: `react-router-dom@^7.18.4`
* **Entry Point**: `src/main.tsx` mounts `<App />` within React 19 `createRoot`.
* **Root Router**: `src/App.tsx` defines client-side routes under `<BrowserRouter>` wrapped in `<AuthProvider>`.

### Existing Route Map
| Path | Component | Guard / Access Level | Purpose in Old App |
| :--- | :--- | :--- | :--- |
| `/` | `LeaderboardPage` | Public / Unauthenticated | Cyberpunk leaderboard with podium & live stats |
| `/leaderboard` | `LeaderboardPage` | Public / Unauthenticated | Alias for root leaderboard |
| `/admin/login` | `AdminLogin` | Public / Unauthenticated | Admin login form with username/password |
| `/admin` | `DashboardPage` | `AdminRoute` | Overview stats, system health, quick links |
| `/admin/teams` | `TeamsPage` | `AdminRoute` | Squad management, issue assignment, size override |
| `/admin/evaluations` | `EvaluationCenterPage` | `AdminRoute` | Post-event repo analysis & approval queue |
| `/admin/faculty-scores` | `FacultyScoresPage` | `AdminRoute` | Faculty academic scoring & rubric entries |
| `/admin/participants` | `ParticipantsPage` | `AdminRoute` | Student roster, XP values, escaped status |
| `/admin/repositories` | `RepositoriesPage` | `AdminRoute` | Git repository registration and link status |
| `/admin/pull-requests` | `PullRequestsPage` | `AdminRoute` | GitHub PR queue, diff review, auto-merge trigger |
| `/admin/leaderboard` | `AdminLeaderboardPage` | `AdminRoute` | Admin view of leaderboard with override buttons |
| `/admin/score-events` | `ScoreEventsPage` | `AdminRoute` | Append-only ledger of score events |
| `/admin/webhook-events`| `WebhookEventsPage` | `AdminRoute` | GitHub webhook deliveries and status |
| `/admin/settings` | `SettingsPage` | `AdminRoute` | Event config, checkpoint definitions, rubric weights |

### Global Side Effects
* `App.tsx` executes `autoSyncService.start(10)` inside `useEffect`, creating an unprompted 10-second polling interval against GitHub APIs from the client browser.

---

## 2. Existing React Components and Pages

The repository contains 13 pages and 27 component modules across 10 directories:

```
src/
├── components/
│   ├── admin/             (AdminLogin, BonusXPModal, TeamSizeModal)
│   ├── auth/              (AdminRoute)
│   ├── dashboard/         (StatCard)
│   ├── layout/            (Sidebar, TopBar)
│   ├── leaderboard/       (AwardsShowcase, EventMilestoneStatusBar, LeaderboardTable, Podium, TeamDetailModal)
│   ├── participants/      (ParticipantProfileModal, ParticipantTable)
│   ├── pull-requests/     (GitHubSyncModal, PullRequestReviewModal, PullRequestTable)
│   ├── repositories/      (RepositoryCard, RepositoryModal, RepositoryTable)
│   ├── score-events/      (ScoreEventTable)
│   ├── scoring/           (ScoreTransparencyCard)
│   └── ui/                (ConfirmDialog, EmptyState, LoadingState, StatusBadge)
└── pages/
    ├── LeaderboardPage.tsx
    └── admin/             (12 admin pages)
```

### Visual Styling & Theme
* **Theme**: Sci-fi cyberpunk / digital void (`src/index.css`), neon crimson (`#FF0A3B`), cyan, emerald, dark background (`#05060A`).
* **Design Philosophy**: High contrast dark theme with story metaphors ("PRison Break", "Cell", "Warden", "Contraband", "Escapees").
* **Alignment with Evalora**: 0% alignment. The entire visual theme violates Evalora's requirement for a restrained, professional, light-first SaaS interface with dark slate typography and subtle borders.

---

## 3. Firebase Initialization and Configuration

### Configuration File: `src/config/firebase.ts`
* Reads environment variables via `import.meta.env.VITE_FIREBASE_*`.
* Initializes Firebase App (`initializeApp`), Cloud Firestore (`getFirestore`), and Firebase Auth (`getAuth`).
* Includes a dummy fallback config (`AIzaSyPlaceholderForPRisonBreakDevMode`) for development when environment variables are missing.
* Exposes `isFirebaseConfigured(): boolean` to toggle between Firestore and in-memory mock storage.

### Gaps for #BuildHybridAI 2026:
1. **Firebase App Check**: Not initialized. Firebase AI Logic requires App Check to validate caller authenticity.
2. **Firebase AI Logic**: `@firebase/ai` is installed in `node_modules` and exported by `firebase/ai`, but not imported or initialized in `src/config/firebase.ts`.
3. **Firebase Storage**: `getStorage()` is not initialized, which will be required for participant artifact uploads (PDFs, PPTs, ZIPs, screenshots).

---

## 4. Firestore Collections and Document Structures

The existing system interacts with 15 Firestore collections:

| Collection Name | Document ID Pattern | Schema / Purpose | State in Evalora |
| :--- | :--- | :--- | :--- |
| `teams` | `team_squard_X` | Squad info, members, earnedXP, bonusXP, totalXP, repo URL | Replace with competition teams/participants |
| `participants` | `part_XXX` | Student details, GitHub username, totalScore, escaped status | Replace (No participant accounts in Evalora) |
| `repositories` | `repo_XXX` | Repository URLs, owner, name, team assignment | Adapt into Submission Artifacts |
| `pullRequests` | `pr_{repo}_{num}` | PR diffs, validation signals, AI validation verdict | Replace with Submissions schema |
| `scoreEvents` | `se_XXX` | Append-only ledger for points and component scores | Adapt for Evalora Scoring Ledger |
| `eventConfig` | `main` | Event name, tagline, mode, weights, checkpoints | Adapt into `competitions` collection |
| `reviews` | `rev_XXX` | Manual PR review decisions | Replace with `judgeReviews` |
| `issues` | `issue_squard_X_Y`| Coding issue difficulty, student assignment, test status | Deprecate (no coding contest in release 1) |
| `bonusTransactions`| `bonus_tx_XXX` | Manual bonus points with admin username & reason | Adapt for audit logging |
| `challengeMappings`| `map_XXX` | Issue-to-file starter/solution mappings | Deprecate |
| `evaluations` | `eval_XXX` | Build-from-scratch evaluation reports | Adapt into AI evaluation records |
| `facultyScores` | `faculty_{teamId}`| Academic rubric scoring (4 criteria, 100 max) | Direct conceptual model for Judge Workspace |
| `checkpoints` | `chk_XXX` | Configurable milestone checkpoints | Adapt into Submission Form Requirements |
| `referenceSolutions`| `sol_XXX` | Hidden test cases & expected outputs | Deprecate |
| `webhookEvents` | `wh_XXX` | GitHub webhook payload audit | Deprecate |

---

## 5. Firebase Authentication Implementation

### Files:
* `src/config/adminConfig.ts`
* `src/services/authService.ts`
* `src/context/AuthContext.tsx`
* `src/components/admin/AdminLogin.tsx`
* `src/components/auth/AdminRoute.tsx`

### Critical Vulnerabilities & Anti-Patterns:
1. **Hardcoded Credentials in Client Bundle**:
   - `ADMIN_CONFIG.defaultAdmin` contains plaintext credentials (`username: 'unknown'`, `password: '12345678'`).
   - `ADMIN_CONFIG.allowlistEmails` and `allowlistUsernames` are hardcoded in client JavaScript.
2. **Plaintext Password Storage in Firestore**:
   - `authService.signIn()` attempts to fetch `doc(db, 'admin', 'credentials')` and compares `pass === dbPassword` in client code!
3. **Session Spoofing via sessionStorage**:
   - Successful client login writes an arbitrary object to `sessionStorage.setItem('prison_admin_session', ...)`.
   - `onAuthStateChanged()` checks `sessionStorage` first and trusts it blindly without verifying a Firebase Auth token.
4. **Client-Side Authorization**:
   - Any user can edit their `sessionStorage` in DevTools to grant themselves admin status.

---

## 6. Existing Security Rules

### File: `firestore.rules`

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return true; // <-- CRITICAL VULNERABILITY: Bypasses all authorization
    }

    match /teams/{teamId} {
      allow read: if true;
      allow write: if isAdmin(); // Effectively allow write: if true;
    }
    ...
```

### Risk Assessment:
* **Severity: CRITICAL**. `isAdmin()` returns `true` unconditionally.
* Every public internet user has unrestricted read and write access to `teams`, `participants`, `pullRequests`, `scoreEvents`, `eventConfig`, `evaluations`, and `facultyScores`.
* Any client can modify scores, delete teams, or alter event rules directly via the Firestore REST/Web SDK.

---

## 7. Cloud Functions and API Endpoints

### Vercel Serverless Functions (`api/`):
1. `api/evaluate-repo.ts`:
   - Endpoint: `POST /api/evaluate-repo`
   - Purpose: Fetches GitHub repo metadata, commit tree, and reads README / source files.
   - Flaw: Does not invoke a real Gemini API. It sets `aiAvailable = Boolean(GEMINI_API_KEY)` and returns static fallback strings.
2. `api/webhook.ts` & `api/github/webhook.ts`:
   - Handles GitHub webhook payloads (`pull_request`, `push`).
   - Verifies HMAC signatures when `GITHUB_WEBHOOK_SECRET` is set.
   - Updates Firestore `webhookEvents` and `pullRequests`.

### Firebase Cloud Functions:
* Currently, there is **no** `functions/` directory configured in `firebase.json`. All backend operations either run as Vercel serverless functions or client-side service calls.

---

## 8. Existing Scoring and Evaluation Logic

### Services:
1. `src/services/scoringEngine.ts`:
   - Implements multi-component scoring formula: `awardedPoints = basePoints * (0.70 * C + 0.20 * Q + 0.10 * M)`.
   - Well-tested deterministic formula with deduction tracking.
2. `src/services/facultyEvaluationService.ts`:
   - Authoritative human evaluation rubric:
     - Problem Solving & Logic (25 pts)
     - Architecture & Modularity (25 pts)
     - Completeness & Core Features (25 pts)
     - Technical Presentation & Demo (25 pts)
   - Tracks `reviewerId`, `reviewerName`, and an audit trail of adjustments.
3. `src/services/aiValidationService.ts`:
   - Calls Gemini directly from the client browser with `fetch('https://generativelanguage.googleapis.com/...')`.
   - Incomplete and dangerous: Exposes API keys in client network requests; falls back to regex heuristics.
4. `src/services/scoreReconciliationService.ts`:
   - Mathematical auditor: compares cached aggregates with append-only ledger entries, detecting duplicate awards or tampering.

---

## 9. GitHub Integration

### Files:
* `src/services/githubSyncService.ts`
* `src/services/githubMergeService.ts`
* `src/services/autoSyncService.ts`
* `src/utils/githubUrl.ts`

### Findings:
* `src/utils/githubUrl.ts`: Excellent, production-ready utility for validating, sanitizing, and normalizing GitHub URLs.
* `autoSyncService.ts`: Polling GitHub API every 10 seconds from client browsers causes immediate rate-limiting (`HTTP 403 API rate limit exceeded`) without an enterprise token.
* Tokens are read from `import.meta.env.VITE_GITHUB_TOKEN`, bundling personal access tokens into the public frontend bundle.

---

## 10. Existing Tests and Test Coverage

### Test Runner: Vitest v5.0.5 (`vitest run`)
* **Status**: 11 test files, **149 tests passed** (100% passing).
* **Test Inventory**:
  1. `buildFromScratchHackathon.test.ts` (14 tests): Repository evaluation, checkpoint verification.
  2. `eventConfigurationAndAudit.test.ts` (9 tests): Configuration management and audit log integrity.
  3. `javaGradingEngine.test.ts` (20 tests): Java source parsing and test execution.
  4. `multiAccountTeamScoring.test.ts` (2 tests): Contributor attribution.
  5. `offlinePRValidation.test.ts` (14 tests): PR validation rules.
  6. `phase7SystemValidation.test.ts` (34 tests): End-to-end integration and tie-breakers.
  7. `referenceAwareGradingAndBonus.test.ts` (25 tests): Answer key matching.
  8. `regression.test.ts` (11 tests): Edge cases and boundary conditions.
  9. `studentHostelAllocationEvaluation.test.ts` (1 test): Domain-specific benchmark.
  10. `teamLeaderboardAndAwards.test.ts` (13 tests): Ranking and awards logic.
  11. `userTestingRepoScoring.test.ts` (6 tests): Repository scoring.

---

## 11. Environment Variables and Exposed Credentials

### Inspection of `.env` and `.env.example`:
* `.env` contains:
  - `VITE_FIREBASE_*`: Firebase project configuration for `prison-control`.
  - `GITHUB_TOKEN` and `VITE_GITHUB_TOKEN`: Personal access token prefixed with `ghp_`.
* **Security Hazard**: Any environment variable prefixed with `VITE_` is inlined into the client-side JavaScript bundle during Vite build, allowing anyone viewing source code to extract the token.

---

## 12. Build, Lint, and Deployment Configuration

### Tooling:
* **Vite**: v8.3.0
* **TypeScript**: ~6.0.2 (Strict mode configured in `tsconfig.app.json`)
* **Tailwind CSS**: v4.3.3 via `@tailwindcss/vite`
* **Linter**: `oxlint@^1.81.0` (0 errors, 50 warnings)
* **Build Check**: `npm run build` succeeds in 4.3 seconds.

---

## Summary of Audit Findings

| Category | Strength | Vulnerability / Deficiency |
| :--- | :--- | :--- |
| **Architecture** | Solid TypeScript setup; fast Vite build. | Story-themed UI; aggressive GitHub polling loop. |
| **Firebase / AI** | Firebase SDK 12.19 installed with `@firebase/ai`. | App Check missing; Firebase AI Logic not wired up. |
| **Auth & Security** | AuthContext structure exists. | `firestore.rules` wide open; plaintext credentials in code. |
| **Scoring Logic** | Faculty rubric and reconciliation logic are solid. | AI evaluation is simulated or client-key-dependent. |
| **Testing** | 149 passing Vitest unit tests. | Tests focus on legacy coding contest / Java problems. |
