# Proofly (Evalora) — Hackathon Submission & Evidence Report

**Project Name**: Proofly (working name: Evalora)  
**Tagline**: *Better reviews. Clearer decisions.*  
**Target Track**: Hybrid AI / Firebase AI Logic Web Applications  

---

## 1. Problem & Solution

Hackathon and innovation-challenge organizers face massive judging bottlenecks: dozens or hundreds of project submissions arrive right before deadlines, judges spend hours skimming inconsistent decks and repositories, and generic LLM prompts produce inflated, repetitive scores that cannot be trusted for official rankings.

**Proofly** solves this with an end-to-end competition evaluation platform powered by **Firebase AI Logic hybrid inference** (on-device Gemini Nano + cloud Gemini 2.5 Flash fallback) that strictly separates **AI pre-evaluation assistance** from **authoritative human judge decisions**:
* Participants submit frictionlessly with **zero accounts** via scoped access codes or single-use SHA-256 links.
* A 9-step evidence-grounded AI pipeline extracts text from PDFs, PPT/PPTX, Markdown, and accessible GitHub READMEs, enforces track relevance and calibrated anti-inflation critiques, and never invents unverified claims.
* Human judges review a distraction-free 10-point dossier, toggle Blind Review mode, Agree/Modify/Reject with rationales, and lock immutable scorecards.
* Organizers configure deterministic scoring policies (human-only default), audit an append-only scoring ledger, analyze AI vs. human score deltas, and explicitly authorize public leaderboard publication.

---

## 2. Verified Firebase AI Logic Evidence

### A. Actual SDK Imports & Singleton Initialization
* **Package**: `firebase` `^12.19.0` (`package.json`)
* **Initialization** (`src/config/firebase.ts`, lines 8–10 & 80–110):
  * `import { initializeAppCheck, ReCaptchaV3Provider, CustomProvider, type AppCheck } from 'firebase/app-check';`
  * `import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';`
  * `ai = getAI(app, { backend: new GoogleAIBackend() });`
* **Runtime Model & Hybrid Inference** (`src/services/aiLogicService.ts`, lines 7–16, 223–250, 560–621):
  * `import { getAI, getGenerativeModel, InferenceMode, InferenceSource, GoogleAIBackend, Schema, type AI, type GenerativeModel } from 'firebase/ai';`
  * Runtime call: `getGenerativeModel(aiInstance, { mode, inCloudParams: { model: 'gemini-2.5-flash', ... }, onDeviceParams: { ... } })` followed by `await model.generateContent(prompt)`.

### B. Hybrid Inference Behavior
* Supports all four Firebase AI Logic modes: `PREFER_ON_DEVICE` (default), `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, and `ONLY_IN_CLOUD`.
* Probes Chrome Prompt API capability (`LanguageModel` / `window.ai.languageModel`) via `aiLogicService.checkDeviceCapabilities()`.
* Reads `response.inferenceSource` (`InferenceSource.ON_DEVICE` vs `InferenceSource.IN_CLOUD`) directly from the SDK response and surfaces honest execution telemetry (`actualInferenceSource`, `modelUsed`, `fallbackOccurred`, `fallbackReason`, `latencyMs`, `appCheckStatus`).
* Verified interactively via the dedicated Hybrid Inference Test Harness at `/ai-test` (`src/pages/AiLogicTestPage.tsx`) and automated unit tests (`src/services/__tests__/hybridAiLogic.test.ts`).

### C. App Check Setup
* Configured in `src/config/firebase.ts`: uses `ReCaptchaV3Provider(VITE_FIREBASE_RECAPTCHA_SITE_KEY)` with `isTokenAutoRefreshEnabled: true` whenever production Firebase + reCAPTCHA v3 env vars are set.
* Falls back safely to a local dev `CustomProvider` when running unconfigured local demos or Vitest suites, and surfaces `appCheckStatus` honestly in evaluation telemetry.

---

## 3. Features Built During the Submission Period (Phases 0–9)

| Phase | Delivered Scope | Key Files |
| :--- | :--- | :--- |
| **Phase 0** | Codebase audit, security review, reuse/replacement blueprint | `docs/PROJECT_AUDIT.md`, `docs/REUSE_AND_REPLACEMENT_PLAN.md` |
| **Phase 1** | Firebase AI Logic hybrid inference engine + App Check + `/ai-test` harness | `src/config/firebase.ts`, `src/services/aiLogicService.ts`, `src/pages/AiLogicTestPage.tsx` |
| **Phase 2** | Complete light-first SaaS UI foundation, 16 reusable UI primitives, 3 role layouts | `src/index.css`, `src/components/ui/*`, `src/layouts/*` |
| **Phase 3** | Multi-tenant organizations, competition-scoped RBAC, competition lifecycle state machine | `src/services/scopedAuthService.ts`, `src/services/organizationService.ts`, `src/services/competitionService.ts`, `src/services/competitionLifecycleService.ts` |
| **Phase 4** | 13-field dynamic form builder, validation engine, public codes & SHA-256 single-use access links | `src/services/formBuilderService.ts`, `src/services/formValidationService.ts`, `src/services/accessManagementService.ts` |
| **Phase 5** | Zero-account participant submissions, multi-file magic-byte validation, SHA-256 management tokens, submission lifecycle & AI gate | `src/services/submissionService.ts`, `src/services/fileStorageService.ts`, `src/services/submissionLifecycleService.ts`, `src/pages/participant/*` |
| **Phase 6** | 9-step AI evaluation pipeline, PDF/PPTX/MD/GitHub extraction, immutable rubric versions, concurrency queue, anti-inflation senior critique & track relevance penalties, batch multi-select evaluation | `src/services/contentExtractionService.ts`, `src/services/rubricEngineService.ts`, `src/services/evaluationQueueService.ts`, `src/services/evaluationPipelineService.ts` |
| **Phase 7** | Judge panel management, workload tracking, distraction-free 10-point review workspace, Blind Review mode, draft isolation, conflict-of-interest recusal, reassignment audit, locked scorecards & organizer reopening | `src/services/judgeAssignmentService.ts`, `src/pages/judge/*`, `src/pages/organizer/OrganizerJudgesPage.tsx` |
| **Phase 8** | 5 aggregation policies (human-only default), append-only scoring ledger, deterministic tie-breakers, authorized publish/unpublish, Public Leaderboard (`/leaderboard`), CSV export, live analytics & AI vs. human report, governance audit trail | `src/services/scoringLedgerService.ts`, `src/services/governanceAuditService.ts`, `src/services/resultsAndAnalyticsService.ts`, `src/pages/organizer/OrganizerResultsPage.tsx`, `src/pages/PublicLeaderboardPage.tsx` |
| **Phase 9** | Production hardening: tightened `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json` headers, brute-force rate limiting, secret/PII removal, 13-step E2E + 10-scenario reliability tests, full docs suite | `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`, root `*.md` docs |

---

## 4. Pre-Existing Code Reused & How It Was Changed

This workspace evolved from an earlier single-competition coding-contest repository (*PRison Control*). In accordance with full hackathon transparency:

* **Reused with Minimal Changes**:
  * `src/utils/githubUrl.ts` — GitHub URL normalization and path validation helper.
  * Base Vite + Vitest + Tailwind tooling setup (`vite.config.ts`, `tsconfig*.json`).
  * Core UI dialog/empty/loading primitive patterns (`ConfirmDialog.tsx`, `LoadingState.tsx`, `EmptyState.tsx`, `StatusBadge.tsx`), restyled into the new light-first SaaS design system.
* **Adapted / Extended**:
  * `src/config/firebase.ts` — Extended to initialize `initializeAppCheck` (`ReCaptchaV3Provider` / dev fallback) and `getAI(app, { backend: new GoogleAIBackend() })`, and removed placeholder patterns that trigger secret scanners.
  * `src/services/auditLogService.ts` — Kept for backward compatibility; mirrored by the new immutable `governanceAuditService.ts`.
* **Replaced / Eliminated**:
  * Replaced the entire legacy dark/story theme (`src/index.css`), legacy navigation, and single-competition UI with three scoped workspaces (Organizer, Judge, Participant) + Public Leaderboard.
  * Eliminated insecure legacy `firestore.rules` patterns, hardcoded admin credentials, and personal email hardcoding.
  * Legacy PR/Java grading services remain isolated in the repo with passing regression tests so nothing was destructively broken, but are decoupled from Proofly's active competition evaluation routes.

---

## 5. Actual Tested Functionality & Verification Evidence

All verification commands run cleanly on this repository:
* **TypeScript Compiler (`tsc -b`)**: `0` errors
* **Linter (`npm run lint` / `oxlint`)**: `0` errors across 181+ files
* **Production Bundle (`npm run build`)**: Clean Vite production build
* **Automated Test Suites (`npm test`)**: **25 test files, 291 passing tests (`0` failures)** covering:
  * Hybrid AI Logic & telemetry (`hybridAiLogic.test.ts`)
  * Multi-tenant & competition-scoped RBAC (`roleAndTenantIsolation.test.ts`)
  * Dynamic forms, expiry & single-use tokens (`submissionFormAndAccess.test.ts`, `comprehensiveCornerCases.test.ts`)
  * Zero-account anonymous submissions & token hashing (`anonymousParticipantSubmission.test.ts`)
  * Multi-file uploads & judge queue switching (`multiFileUploadAndJudgeSelection.test.ts`)
  * 9-step AI pipeline, 5 sample projects, track relevance & anti-inflation (`aiEvaluationEngine.test.ts`, `sampleProjectsEvaluationVerification.test.ts`, `trackRelevanceAndDifferentiatedEvaluation.test.ts`)
  * Phase 7 human judging workspace, immutability & conflicts (`judgeManagementAndEvaluationWorkspace.test.ts`, `exhaustiveSystemAuditAndCornerCases.test.ts`)
  * Phase 8 scoring policies, append-only ledger, ranking determinism, publication & analytics (`phase8ScoringResultsAndAnalytics.test.ts`)
  * Phase 9 complete 13-step E2E workflow & 10 reliability/failure scenarios (`phase9ProductionReadinessAndReliability.test.ts`)

---

## 6. Honest Scope Disclosures & Screenshots Guide

* **What is NOT claimed**:
  * Proofly does **not** visually watch video files or execute arbitrary untrusted participant code in a live cloud container; both limitations are explicitly disclaimed in every generated evidence packet and AI dossier.
  * When run without live Firebase credentials (`.env`), data persists in browser `localStorage`/in-memory sandbox and AI rubric evaluation uses its deterministic evidence-calibrated fallback rather than faking a cloud response.
* **Capturing Real Application Screenshots for Submission**:
  * Start the local dev server (`npm run dev`) or deployed Firebase Hosting URL and capture screenshots of:
    1. `/ai-test` — Firebase AI Logic Hybrid Inference console showing mode selector and execution telemetry.
    2. `/submit` — Zero-account participant portal with multi-file upload and instant reference token receipt.
    3. `/organizer/submissions` — Multi-select batch AI pre-evaluation queue and calibrated AI critique dossier.
    4. `/judge/review` — Split-screen Human Judge Workspace with 10-point dossier, Blind Review toggle, and locked scorecard.
    5. `/organizer/results` — Scoring policy configurator, AI vs. Human comparison report, append-only ledger, and publish dialog.
    6. `/leaderboard/<competitionId>` — Published Official Public Leaderboard with podium, category filters, and CSV export.
