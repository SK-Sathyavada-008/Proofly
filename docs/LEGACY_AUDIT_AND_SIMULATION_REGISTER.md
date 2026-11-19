# Proofly — Legacy Audit, Mock/Simulation Register & Production Invariants (Phase 10)

**Platform:** Proofly / Evalora — Multi-Tenant Competition Management & Hybrid Evaluation SaaS  
**Architecture:** Pure Firebase Backend (Firebase Hosting, Firebase Authentication, Cloud Firestore, Cloud Storage for Firebase, Firebase App Check, Firebase AI Logic, Firebase Cloud Functions v2)  
**Date:** 2026-11-19  

---

## 1. Executive Summary

During Phase 10, a comprehensive engineering cleanup of legacy artifacts from the older **PRison-Break** (GitHub PR leaderboard / Java CTF grading) project and deprecated **Vercel serverless** architecture was conducted.

Legacy functionality has been strictly quarantined, decommissioned, or explicitly labeled so that **no legacy code can misrepresent itself as production-ready Proofly functionality**. In particular:
1. **Arbitrary untrusted code execution is strictly marked as UNSUPPORTED in production**: `sandboxRunner.ts` defaults to `isSandboxAvailable() === false`. All fake passing tests and misleading success indicators were removed.
2. **Deprecated Vercel API routes were completely eliminated**: `api/evaluate-repo.ts` (which claimed AI evaluation without real inference) and `api/github/webhook.ts` were permanently deleted after proving zero active dependencies. The dev server middleware in `vite.config.ts` was stripped, and `@vercel/node` was uninstalled.
3. **Mocks, simulations, placeholders, and fallbacks across the codebase were audited and classified**: Every occurrence is documented with its operational boundary (Test-Only, Explicit Demo-Only, Development-Only, Production Path, or Unused Legacy Code).
4. **Automated Testing Suite**: Proofly now possesses **31 test files with 391 passing unit/integration tests**, **4 Firebase Emulator security test suites with 32 passing tests** (423 total automated tests), and an automated **11-step end-to-end workflow verification suite**.

---

## 2. Legacy Audit & Code Decisions

### A. Java Sandbox Runner (`src/services/sandboxRunner.ts`)
- **Legacy Issue**: `sandboxRunner.ts` previously defaulted to `sandboxEnvironmentConfigured = true` and synthesized passing test results (`testsPassed: 5, testsFailed: 0, log: Compilation: OK`) when no mock execution was specified, creating a false impression of live code execution in a browser/serverless environment.
- **Production Decision**:
  - `sandboxEnvironmentConfigured` now **defaults to `false`** in production.
  - Calling `executeJavaTests()` without an isolated runner returns `status: 'SANDBOX_UNAVAILABLE'`, `success: false`, `compilationPassed: false`, and an explicit diagnostic explaining that arbitrary code execution is disabled without a dedicated container daemon (e.g. gVisor, Firecracker).
  - Test fixtures supplied in unit tests are explicitly labeled with `executionMode: 'SIMULATED'` and `isSimulated: true`.
  - Reusable security algorithms—**test tampering detection** (`detectTestTampering`) and **environment sanitization** (`sanitizeEnvironment`)—are preserved intact.

### B. Vercel Serverless Functions (`api/evaluate-repo.ts`, `api/github/webhook.ts`, `api/webhook.ts`)
- **Legacy Issue**: `api/evaluate-repo.ts` accepted unauthenticated requests, read environment tokens, and returned `aiAvailable: true` without performing actual AI inference. `api/github/webhook.ts` was an unauthenticated legacy webhook receiver for GitHub App PR events.
- **Production Decision**:
  - Proofly relies exclusively on **Firebase AI Logic (`firebase/ai`)** and **Firebase Cloud Functions**.
  - Proved zero active imports or references in `src/App.tsx` or any active Proofly module.
  - Stripped `githubWebhookDevPlugin` from `vite.config.ts`.
  - Permanently removed `api/evaluate-repo.ts`, `api/github/webhook.ts`, and `api/webhook.ts`.
  - Permanently removed `vercel.json`, `.vercelignore`, and local `.vercel/` cache folder (eliminating stale `VERCEL_OIDC_TOKEN`).
  - Removed `@vercel/node` from `package.json` devDependencies and renamed package to `"proofly"`.

### C. Legacy PRison-Break Admin Pages & Components (`src/pages/admin/*`, `src/components/admin/*`)
- **Legacy Issue**: 12 pages in `src/pages/admin/*` and components in `src/components/admin/*`, `src/components/pull-requests/*`, `src/components/repositories/*` were built for GitHub PR issue tracking and XP awarding.
- **Production Decision**:
  - `src/App.tsx` redirects all `/admin/*` requests to `/organizer`.
  - Proofly routes are strictly divided into `/organizer/*`, `/judge/*`, `/submit/*`, and `/leaderboard/*`.
  - Zero active Proofly user journeys touch legacy PRison-Break pages.

### D. Legacy Java Grading & XP Services (`javaGradingEngine.ts`, `bonusService.ts`, etc.)
- **Legacy Issue**: Services for evaluating beginner Java syllabus assignments with mathematical XP formulas (`0.70*C + 0.20*Q + 0.10*M`).
- **Production Decision**:
  - Quarantined to legacy unit tests (`javaGradingEngine.test.ts`, `referenceAwareGradingAndBonus.test.ts`).
  - Kept isolated from the active Proofly competition lifecycle and scoring pipeline (`competitionService.ts`, `scoringLedgerService.ts`, `resultsAndAnalyticsService.ts`).
  - Retained tests to ensure zero regressions on mathematical rounding and deterministic formula invariants.

---

## 3. Mock and Simulation Identification & Classification

| Occurrence / Artifact | File Path | Classification | Operational Boundary & Production Invariant |
|---|---|---|---|
| `makeMockSubmission`, `makeMockAiReport` | `phase9JudgeEvaluationScoringAndResults.test.ts`, `phase10LegacyCleanupAndE2E.test.ts`, etc. | **Test-Only** | Vitest test fixtures used exclusively in `src/services/__tests__/`. Never exported or used in runtime code. |
| `mockExecutionResult` fixture input | `src/services/sandboxRunner.ts`, `javaGradingEngine.test.ts` | **Test-Only** | Test harness inputs to verify deterministic grading logic without container execution. Output explicitly flags `isSimulated: true`. |
| `isDemoModeEnabled()` | `src/config/firebase.ts`, `ProoflyAuthContext.tsx` | **Explicit Demo-Only** | Strictly gated by `import.meta.env.VITE_ENABLE_DEMO_MODE === 'true'`. Automatically disabled in all production builds (`import.meta.env.PROD === true`). |
| `purgeLegacySampleStorageOnce()` | `src/utils/cleanSampleStorage.ts` | **Development-Only** | One-time cleanup script running per browser profile to purge pre-seeded test fixtures (`sub-omnitrack-demo`, etc.) from early phases. |
| Form field labels (`Demo Video Link`, `Website / Demo URL`) | `FormBuilderCanvas.tsx`, `formValidationService.ts` | **Production Path** | Configurable participant submission fields. Represents participant project URLs, not platform simulations. |
| App Check debug token fallback | `src/config/firebase.ts` | **Development-Only** | Used only during local development on `localhost` when debug tokens are supplied. Disabled in production. |
| Active organization pointer in `localStorage` | `src/services/organizationService.ts` | **Production Path (Client Preference)** | Stores only `proofly_active_org_id` string for UX persistence across tab reloads. Authoritative organization data is strictly read from Cloud Firestore. |
| Theme preference in `localStorage` | `src/context/ThemeContext.tsx` | **Production Path (UI Preference)** | Stores `proofly-theme` (`'light'` / `'dark'`). Zero business or security data stored. |
| Legacy Warden `sessionStorage` | `src/services/authService.ts`, `AuthContext.tsx` | **Unused Legacy Code** | Legacy PRison-Break warden authentication. Completely superseded by `ProoflyAuthContext.tsx` and `firebaseAuthService.ts`. |
| Legacy hardcoded warden password | `src/config/adminConfig.ts` | **Unused Legacy Code** | Quarantined legacy config from PRison-Break (`SEC-002`). Unused by Proofly. |
| Deterministic Heuristic AI Fallback | `src/services/aiLogicService.ts` | **Production Path (Transparent Fallback)** | Transparent fallback when AI models encounter quota exhaustion. Explicitly labeled `DETERMINISTIC_FALLBACK` (never claims real AI or `IN_CLOUD`), with low confidence and prominent judge disclosures. |

---

## 4. Automated Test Strategy & Regression Coverage

### A. Unit Tests (31 Test Files, 391 Tests Passing)
- **Validation & Form Engine**: Form schemas, field validations, team member caps, deadline constraints (`submissionFormAndAccess.test.ts`, `phase8CompetitionLifecycleAndSubmission.test.ts`).
- **Scoring & Rubric Aggregation**: Multi-policy aggregation (`AVERAGE_JUDGE`, `WEIGHTED_JUDGE`, `MEDIAN`, `TRIMMED_MEAN` Olympic scoring), tie-breaker resolution (`phase9JudgeEvaluationScoringAndResults.test.ts`, `phase8ScoringResultsAndAnalytics.test.ts`).
- **Lifecycle State Machine**: Explicit 9-state competition progression with prerequisite activation checks and authorized role guards (`phase8CompetitionLifecycleAndSubmission.test.ts`).
- **Cryptographic Token Security**: Raw tokens returned once, SHA-256 hashed storage, zero plaintext persistence (`anonymousParticipantSubmission.test.ts`, `phase10LegacyCleanupAndE2E.test.ts`).
- **Evidence Extraction & Provenance**: Modular extractors for PDF, PPTX, ZIP, GitHub, SSRF-protected URL inspection, and video disclaimers (`phase6ArtifactExtraction.test.ts`).
- **Structured Schema & Inference Telemetry**: Strict schema verification, transparent execution mode reporting (`ON_DEVICE` vs `IN_CLOUD`), timeout handling (`phase7AiLogicEvaluation.test.ts`).

### B. Firebase Emulator Security Rules Tests (4 Test Files, 32 Tests Passing)
- **Firestore Security Rules**: Strict least-privilege tenant isolation, role verification without custom-claim trust, backend-only collections (`/scoreContributions`, `/scoringLedger`, `/governanceAuditLogs`), and judge draft privacy (`tests/rules/firebaseSecurityRules.test.ts`).
- **Storage Security Rules**: Tenant-scoped upload paths, MIME & magic-byte verification, cross-tenant isolation, deletion blocks (`tests/rules/phase3StorageEmulator.test.ts`).
- **Multi-Device Persistence & CAS Locking**: Atomic organization creation with initial OWNER membership, judge assignment locking, atomicCAS evaluation job claims (`tests/rules/phase4FirestorePersistence.test.ts`, `tests/rules/phase5EvaluationJobEngine.test.ts`).

### C. Complete 11-Step End-to-End Workflow (`phase10LegacyCleanupAndE2E.test.ts`)
Automated test verifying the complete end-to-end lifecycle:
1. **Organizer Signs In**: Authenticated organizer profile initialized.
2. **Organization Created**: Created with initial `OWNER` membership in Cloud Firestore.
3. **Competition Created**: Initialized strictly as `DRAFT`.
4. **Rubric Configured**: Organizer updates rubric to 100% total weight and activates competition.
5. **Anonymous Participant Submits**: Participant accesses competition via public code, receives ephemeral session, and submits without an account.
6. **Files Uploaded**: File bytes validated with magic-byte checking and persistent chunk storage.
7. **AI Evaluation Performed**: Firebase AI Logic executes, saves immutable report, and gates human review.
8. **Judge Reviews Submission**: Submission assigned to authorized judge; unassigned/conflict judges blocked.
9. **Judge Submits Evaluation**: Locked human evaluation record created without overwriting AI evaluation report.
10. **Organizer Approves Results**: Organizer reviews preview and explicitly publishes official results.
11. **Public Leaderboard Displays Results**: Authoritative public leaderboard renders verified rankings; unpublished competitions return null.

---

## 5. Quality Verification Sign-Off

| Check | Tool / Command | Result | Details |
|---|---|---|---|
| **TypeScript Typecheck** | `npx tsc -b --noEmit` | **PASSED (0 errors)** | Full repository type checked without errors. |
| **ESLint / Linter** | `npm run lint` (`oxlint`) | **PASSED (0 errors)** | 214 files inspected; 0 errors. |
| **Unit & Integration Suite** | `npm test -- --run` | **PASSED (391/391)** | 31 test files, 391 tests passing (100%). |
| **Security Rules Suite** | `npm run test:rules` | **PASSED (32/32)** | 4 emulator test files, 32 tests passing (100%). |
| **Production Build** | `npm run build` | **PASSED (code 0)** | Clean Vite production bundle (`dist/`). |
