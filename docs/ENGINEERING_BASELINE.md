# Proofly — Engineering Baseline (Phase 00)

**Date:** 2026-11-18  
**Scope:** Complete pre-hardening architectural audit, toolchain verification, persistence/mock inventory, and Firebase readiness baseline.  
**Target Architecture:** React + Vite SPA hosted on **Firebase Hosting**, backed exclusively by **Firebase Auth, Cloud Firestore, Cloud Storage for Firebase, Firebase App Check, Firebase AI Logic, and Firebase Cloud Functions**.  
**Explicit Non-Goal:** Vercel (`api/`, `vercel.json`, `.vercel/`, `@vercel/node`) is legacy and strictly ignored.

---

## 1. Verified Local Environment & Baseline Checks

All checks below were executed directly against commit `7d600c8` on Windows (`c:\Keerthu\KL\NerdyGeeks\CompetitionOS_SaaS\competitionOS`):

| Check | Command Executed | Result | Observed Output / Notes |
|---|---|---|---|
| Node.js Runtime | `node -v` | **PASS** | `v24.14.1` |
| npm CLI | `npm -v` | **PASS** | `11.11.0` |
| Dependencies | `npm ls --depth=0` | **PASS** | All `dependencies` and `devDependencies` installed (`firebase@12.19.0`, `react@19.3.0`, `react-router-dom@7.18.4`, `vite@8.3.2`, `vitest@5.0.5`, `typescript@6.0.3`, `oxlint@1.87.0`, `tailwindcss@4.3.3`). Legacy `@vercel/node@21.0.0` remains in `devDependencies`; 5 extraneous `@emnapi`/`@napi-rs` wasm helper packages installed. |
| TypeScript Check | `npx tsc -b --noEmit` | **PASS** | Exit code `0` (0 errors). |
| Lint | `npm run lint` (`oxlint`) | **PASS (with warnings)** | Exit code `0`: **0 errors, 82 warnings** across 183 files (mostly React hook `set-state-in-effect` / `exhaustive-deps` and unused vars in legacy files). |
| Production Build | `npm run build` (`tsc -b && vite build`) | **PASS (with warnings)** | Exit code `0` in `9.74s`. `dist/index.html` (1.71 kB), `dist/assets/index-BMh4xvXF.css` (161.03 kB), `dist/assets/index-CoUB1ie7.js` (1,417.30 kB / 389.39 kB gzip — exceeds Vite's 500 kB chunk warning; no route code-splitting). **Critical security note:** `dist/assets/index-CoUB1ie7.js` currently inlines a live GitHub PAT from `.env` (`VITE_GITHUB_TOKEN`) — see `docs/SECURITY_FINDINGS.md` (`SEC-001`). |
| Automated Tests | `npm test -- --run` (`vitest run --run`) | **PASS (in-memory only)** | **25/25 test files, 291/291 tests passed** in `21.90s`. **Caveat:** `src/config/firebase.ts` forces `isFirebaseConfigured() === false` whenever `VITEST` or `NODE_ENV === 'test'`, so **0 tests exercise real Firestore, Storage, Auth, Rules, or Cloud Functions**. |
| Firebase CLI | `firebase --version` | **AVAILABLE** | `firebase-tools@15.25.1` installed globally (`C:\Users\saike\AppData\Roaming\npm\firebase.ps1`). |
| Java Runtime (for Emulators) | `java -version` | **AVAILABLE** | Oracle Java `25 LTS` (`build 25+37-LTS-3491`) — satisfies Firebase Emulator Suite JDK requirement. |
| Firebase Emulator Config | Inspected `firebase.json` | **NOT CONFIGURED** | `firebase.json` has `hosting`, `firestore`, and `storage` blocks only; **no `emulators` block**, **no `functions` block**, no `functions/` directory, and `@firebase/rules-unit-testing` is not installed. |
| Firebase Project Binding | Inspected `.firebaserc` | **CONFIGURED** | Default project: `prison-control`. Firebase Hosting (`https://prison-control.web.app`), Firestore rules, and Firestore indexes are deployed. **Firebase Storage is NOT initialized** on `prison-control` (free Spark plan blocks Storage setup without Blaze billing upgrade). |

---

## 2. Subsystem Architecture & Implementation Audit

### 2.1 React Application & Routing (`src/App.tsx`, `src/main.tsx`)
- **Working:** Clean React 19 + React Router v7 SPA with 3 active workspace shells (`OrganizerLayout`, `JudgeLayout`, `ParticipantLayout`), Light/Dark theme switcher (`ThemeContext`), toast notifications, and clean UI primitives (`src/components/ui/*`).
- **Active Routes:** `/`, `/ai-test`, `/organizer/*` (overview, competitions, forms, submissions, evaluations, judges, results, settings), `/judge/*` (assignments, review, history), `/submit`, `/submit/manage`, `/p/*`, `/leaderboard`, `/leaderboard/:competitionId`.
- **Legacy Redirect:** `/admin/*` redirects to `/organizer`, leaving 12 legacy admin pages in `src/pages/admin/*` completely unreachable from `App.tsx`.
- **Gap:** Single 1.42 MB JS bundle with zero `React.lazy` code-splitting. `package.json` is still named `"leaderboard"` (legacy name).

### 2.2 Firebase Initialization (`src/config/firebase.ts`)
- **Working:** Initializes `FirebaseApp`, `Firestore`, `Auth`, `AppCheck`, and `AI` (`getAI(app, { backend: new GoogleAIBackend() })`).
- **Missing:** Does **not** initialize `FirebaseStorage` (`getStorage`), `Functions` (`getFunctions`), or Emulator connections (`connectAuthEmulator`, `connectFirestoreEmulator`, `connectStorageEmulator`, `connectFunctionsEmulator`).
- **Critical Defect:** Line 21–23 assigns `(import.meta as any).env` to a runtime variable `env`, which causes Vite to serialize **every `VITE_*` variable from `.env`** into the public JS bundle instead of only statically referenced Firebase keys (see `SEC-001`).
- **Security Weakness:** Lines 101–113 attach a hardcoded `CustomProvider` returning `'proofly-dev-app-check-debug-token'` whenever `VITE_FIREBASE_RECAPTCHA_SITE_KEY` is absent or invalid (see `SEC-004`).

### 2.3 Authentication & Multi-Tenant Authorization (`src/context/ProoflyAuthContext.tsx`, `src/services/scopedAuthService.ts`)
- **Status:** **Incomplete / Dev-Bypassed in Live UI.**
- **What exists:** `ProoflyAuthProvider` listens to Firebase `onAuthStateChanged`, and `scopedAuthService` implements pure-function RBAC helpers (`resolveOrgRole`, `resolveCompetitionRole`, `canManageOrganization`, `canCreateCompetition`, `canEditCompetition`, `canEvaluateSubmission`, `canPublishResults`, `assertTenantIsolation`).
- **What is missing / broken:**
  - App boots automatically signed into an unauthenticated client-side `DEMO_ORGANIZER_USER` (`uid: 'user-organizer-01'`) with `activeOrgRole = 'OWNER'`.
  - There is **no Firebase Auth sign-in / sign-up / password-reset UI** anywhere in Proofly (only the legacy `src/components/admin/AdminLogin.tsx` for PRison-Break).
  - Because `request.auth == null` in Firestore when using the demo persona, **every authenticated Firestore read/write fails with `permission-denied`** and silently drops into `localStorage` fallback!
  - The header persona switcher (`loginDemoUser('organizer' | 'judge')`) flips client-side roles without any authentication.

### 2.4 Backend / Cloud Functions
- **Status:** **NOT PRESENT.** No `functions/` directory or `firebase.json` `functions` configuration exists.
- **Architectural Consequence:** Operations that **must** execute in a trusted server environment (Firebase Cloud Functions with Admin SDK) are currently attempted in the browser:
  1. Anonymous submission access-code/token validation and session issuance (`accessManagementService.ts`)
  2. Anonymous submission creation, rate limiting, and management-token verification/updates (`submissionService.ts`)
  3. Evaluation queue job leasing, heartbeat, retries, and background execution (`evaluationQueueService.ts`)
  4. Append-only scoring ledger writes & official result calculation/publication (`scoringLedgerService.ts`, `resultsAndAnalyticsService.ts`)
  5. Judge invite onboarding & competition role assignment (`judgeAssignmentService.ts`)
  6. Governance audit logging (`governanceAuditService.ts`)

### 2.5 Persistence & Fallback Matrix (Firestore vs `localStorage` vs In-Memory)

| Service | File | Firestore Reads/Writes? | `localStorage` Fallback? | In-Memory Store? | Reality Check / Assumption Gap |
|---|---|---|---|---|---|
| Organizations | `organizationService.ts` | Partial (`setDoc`/`getDoc`/`getDocs`/`updateDoc`/`deleteDoc` wrapped in silent `try/catch`; `getUserOrganizations` never queries Firestore!) | Yes (`proofly_organizations_v1`, `proofly_org_members_v1`, `proofly_active_org_id`) | Yes | **Silent fallback:** `getUserOrganizations` ONLY checks `localMembers`/`localOrganizations`. Even an authenticated Firebase user on a new device won't load their Firestore orgs! |
| Competitions | `competitionService.ts` | Yes (wrapped in silent `try/catch`) | Yes (`proofly_competitions_v1`, `proofly_competition_roles_v1`) | Yes | Writes silently succeed locally even when Firestore rejects them with `permission-denied`. |
| Form Schemas | `formBuilderService.ts` | Yes (wrapped in silent `try/catch`) | Yes (`proofly_form_schemas_v1`) | Yes | Writes silently fall back to `localStorage` on Firestore rejection. |
| Access Keys & Sessions | `accessManagementService.ts` | Yes for `accessKeys` (wrapped in silent `try/catch`); **NO Firestore for sessions or rate limits** | Yes (`proofly_access_keys_v1`) | Yes (`localActiveSessions`, `failedAttemptTimestamps`) | **Rate limiting & sessions are per-tab in-memory only** — refreshing the page or opening incognito resets rate limits and wipes sessions! |
| Submissions | `submissionService.ts` | Yes (wrapped in silent `try/catch`) | Yes (`proofly_submissions_v1`) | Yes (`memSubmissions`) | Anonymous updates (`ParticipantSubmissionManagePage`) call Firestore `getDocs` + `setDoc` directly, which `firestore.rules` denies; appears to succeed ONLY via same-browser `localStorage`. |
| Participants & Teams | `participantTeamService.ts` | Calls `teams` & `participants` collections (wrapped in silent `try/catch`) | **No** | Yes | `firestore.rules` has **NO rules for `/teams` or `/participants`** (default deny-all rejects every read/write!). Data disappears on page refresh! |
| File Uploads | `fileStorageService.ts` | **NO Firebase Storage SDK usage at all** | **No** | Ephemeral `URL.createObjectURL(blob)` | **Mock/Simulated Storage:** Files are NEVER uploaded to Cloud Storage. `blob:` URLs die on browser refresh and are completely invisible to judges/organizers on other devices. `storagePath` also mismatches `storage.rules`! |
| AI Logic | `aiLogicService.ts` | Calls `firebase/ai` (`getGenerativeModel`) with `3500ms` timeout | No | No | **Silent Mock Fallback + Aggressive Timeout:** `evaluateSubmissionEvidence()` uses a `3500ms` timeout (far too short for real LLM calls) and silently catches ANY error/timeout to return `generateDeterministicEvidenceEvaluation()` (a hardcoded rule-based heuristic scorer), while setting `telemetry.actualInferenceSource = 'IN_CLOUD'`! |
| Content Extraction | `contentExtractionService.ts` | None | No | No | Plain text works via `fetch`; PDF/PPTX extraction is a naive ASCII regex over raw binary (fails on compressed streams); ZIP archives are not unzipped; GitHub inspection uses unauthenticated `api.github.com` (60 req/hr IP limit); deployment URLs are marked `accessible: true` without any HTTP probe! |
| Rubric Versions | `rubricEngineService.ts` | Yes (`rubricVersions`, silent `try/catch`) | No | Yes | Memory lost on refresh if Firestore write fails. |
| AI Evaluation Pipeline | `evaluationPipelineService.ts` | Yes (`aiEvaluationReports`, silent `try/catch`) | No | Yes | Runs synchronously in browser; falls back to mock competition if competition not found; silently swallows Firestore errors. |
| Evaluation Queue | `evaluationQueueService.ts` | Calls `evaluationJobs` (silent `try/catch`) | No | Yes | `firestore.rules` has **NO rule for `/evaluationJobs`** (default deny-all!). Lease claiming is non-transactional read-then-write (`getDocs` + `setDoc`, no Firestore transaction) — vulnerable to race conditions! |
| Judge Management & Human Evals | `judgeAssignmentService.ts` | **NONE (0 Firestore calls!)** | Yes (`proofly_judges`, `proofly_judge_assignments`, `proofly_human_evaluations`) | Yes | **100% browser-local.** Firestore rules exist for `judgeAssignments` and `humanEvaluations`, but this service never calls Firestore at all! Multi-judge coordination across devices is impossible today. |
| Scoring Ledger | `scoringLedgerService.ts` | **NONE (0 Firestore calls!)** | Yes (`proofly_scoring_ledger_v1`) | Yes | **100% browser-local.** Firestore rules exist for `scoringLedger`, but nothing writes to Firestore. |
| Results & Publications | `resultsAndAnalyticsService.ts` | **NONE (0 Firestore calls!)** | Yes (`proofly_scoring_policies_v1`, `proofly_results_publications_v1`) | Yes | **100% browser-local.** Published public leaderboards are invisible to anyone outside the organizer's own browser! |
| Governance Audit | `governanceAuditService.ts` | **NONE directly** (mirrors into legacy `auditLogService` → `auditLogs` collection which has NO Firestore rule!) | Yes (`proofly_governance_audit_v1`) | Yes | **100% browser-local.** Firestore rules exist for `governanceAuditLogs`, but nothing writes to `governanceAuditLogs`; mirror writes to `auditLogs` fail silently against deny-all. |
| Organizer Settings | `OrganizerSettingsPage.tsx` | **NONE** | **NONE** | React `useState` only | Clicking "Save changes" shows a success toast without persisting anything anywhere! |

---

## 3. Existing Mock Implementations & Incorrect Success Assumptions

### 3.1 Mock / Simulated Implementations Active in Proofly
1. **Simulated File Upload (`src/services/fileStorageService.ts` L273–331):** Creates a local `Blob` object URL or fake `https://storage.proofly.internal/...` string and returns `isVerified: true` without uploading bytes anywhere.
2. **Deterministic AI Evaluator Fallback (`src/services/aiLogicService.ts` L624–631, L840–1628):** When real Firebase AI Logic times out (>3.5s) or errors, silently fabricates a full evaluation report using keyword/heuristic rules and labels `actualInferenceSource: 'IN_CLOUD'`. Furthermore, even when real AI succeeds, lines 660–700 override LLM scores/deductions with deterministic baseline deductions if any deduction text matches `/stress telemetry|performance benchmarks|under load/i`!
3. **Demo Auth Persona (`src/context/ProoflyAuthContext.tsx` L35–52):** Boots every visitor into a fake `Organizer` (`uid: 'user-organizer-01'`) with full `OWNER` UI privileges without Firebase Auth sign-in.
4. **App Check Dev Debug Token (`src/config/firebase.ts` L103–112):** Supplies a static string `'proofly-dev-app-check-debug-token'` via `CustomProvider` when reCAPTCHA is not configured.
5. **Demo Data Seeding Helpers (`src/services/seedDataService.ts`, `src/services/resultsAndAnalyticsService.ts#ensureDemoDataForUi`, `src/design-system/mockDesignData.ts`, `src/services/judgeAssignmentService.ts#INITIAL_SEED_JUDGES`):** No longer auto-injected into the live UI (cleaned prior to Phase 00), but still present in the codebase and relied upon by unit tests.

### 3.2 Incorrect Assumptions About Successful Operations
1. **Silent `try/catch` Swallowing Firestore Failures:** Almost every service (`organizationService`, `competitionService`, `formBuilderService`, `accessManagementService`, `submissionService`, `participantTeamService`, `evaluationPipelineService`, `evaluationQueueService`, `rubricEngineService`) catches Firestore `permission-denied` / network errors silently and returns a successful Promise backed by local memory/`localStorage`. The UI then displays green success toasts ("Competition Created & Active", "Form Schema Saved", "Submission Confirmed") when **zero bytes were persisted to Firestore**.
2. **`OrganizerSettingsPage.tsx` Save Handler (L17–20):** Displays `"Settings saved"` toast while discarding all state on page refresh.
3. **Deployment URL Reachability (`contentExtractionService.ts` L44–49):** Hardcodes `deploymentMetadata.accessible = true` without ever checking the URL.
4. **Unverified File Checksum (`fileStorageService.ts` L299–301):** Computes SHA-256 over `${sanitizedName}_${bytes.length}_${first1024Bytes}` rather than hashing the full binary buffer.
5. **Non-Atomic Queue Leasing (`evaluationQueueService.ts` L73–112):** Uses `listJobs()` + `setDoc()` instead of a Firestore `runTransaction`, allowing two workers to claim the same job simultaneously.
6. **Participant Self-Service Management (`ParticipantSubmissionManagePage.tsx`):** Assumes unauthenticated client can read and update `/submissions/{id}` in Firestore after validating a management token, contradicting `firestore.rules`.

---

## 4. Duplicate Services Identified

| Domain | Active Proofly Service | Legacy / Duplicate Service | Notes |
|---|---|---|---|
| Authentication | `src/context/ProoflyAuthContext.tsx` + `src/services/scopedAuthService.ts` | `src/context/AuthContext.tsx` + `src/services/authService.ts` + `src/config/adminConfig.ts` | Legacy PRison-Break admin login with hardcoded password (`SEC-002`). |
| Audit Logging | `src/services/governanceAuditService.ts` | `src/services/auditLogService.ts` | `governanceAuditService` mirrors into legacy `auditLogService` (`auditLogs` collection not in `firestore.rules`). |
| Scoring Engine | `src/services/resultsAndAnalyticsService.ts` + `src/services/scoringLedgerService.ts` | `src/services/scoringEngine.ts`, `src/services/scoreEventService.ts`, `src/services/scoreReconciliationService.ts`, `src/services/bonusService.ts` | Legacy GitHub PR XP scoring engine from PRison-Break. |
| AI Evaluation | `src/services/aiLogicService.ts` + `src/services/evaluationPipelineService.ts` | `src/services/aiValidationService.ts`, `src/services/buildFromScratchService.ts`, `src/services/facultyEvaluationService.ts`, `src/services/offlinePRValidationService.ts`, `src/services/prValidationPipeline.ts` | Legacy GitHub PR / Java grading evaluators. |
| Participants & Teams | `src/services/participantTeamService.ts` | `src/services/participantService.ts`, `src/services/teamService.ts` | Legacy PRison-Break participant/team CRUD tied to GitHub repos. |
| Seed Data | `src/services/seedDataService.ts` | `src/services/seedService.ts`, `src/data/mockData.ts`, `src/data/testSquads.ts`, `src/design-system/mockDesignData.ts` | Multiple overlapping mock/seed data modules. |

---

## 5. Required Manual Firebase Actions (Owner Console Tasks)

1. **IMMEDIATE (P0):** Revoke the exposed GitHub PAT (`VITE_GITHUB_TOKEN`) in GitHub Settings → Developer settings → Personal access tokens, remove `VITE_GITHUB_TOKEN` from `.env`, rebuild, and redeploy Firebase Hosting (`SEC-001`).
2. **Firebase Authentication:** Enable **Email/Password** (and optionally **Google**) sign-in provider in Firebase Console → Authentication → Sign-in method (`prison-control`).
3. **Firebase App Check:** Register your web app with **reCAPTCHA v3** in Firebase Console → App Check, set `VITE_FIREBASE_RECAPTCHA_SITE_KEY` in `.env`, add local debug token for localhost development, and enable enforcement for **Firebase AI Logic** (and Firestore/Storage when ready).
4. **Firebase AI Logic (Gemini Developer API):** Verify Firebase AI Logic API (`firebasevertexai.googleapis.com` / Generative Language API) is enabled on `prison-control` and linked cleanly.
5. **Google Cloud API Key Restrictions:** Restrict the Firebase Web API key in Google Cloud Console → APIs & Services → Credentials to HTTP referrers (`https://prison-control.web.app/*`, `https://prison-control.firebaseapp.com/*`, `http://localhost:*/*`).
6. **Firebase Blaze Plan (Pay-as-you-go with budget alert) — Required for Storage & Cloud Functions:**
   - Cloud Storage for Firebase (`prison-control.firebasestorage.app`) and Firebase Cloud Functions v2 **both require the Blaze plan** (with generous free-tier quotas).
   - Set a strict Google Cloud Billing budget alert (e.g., \$1 / \$5) before upgrading, then initialize Storage and deploy `storage.rules` + Cloud Functions.
7. **Super Admin Custom Claims:** Assign `{ platformRole: "SUPER_ADMIN" }` via Firebase Admin SDK script for platform operators instead of relying on `VITE_PLATFORM_ADMIN_EMAIL` or hardcoded email checks.
