# Proofly Phase Tracker & Implementation Roadmap

**Project**: Proofly (formerly Evalora)  
**Tagline**: Better reviews. Clearer decisions.  
**Target Competition**: #BuildHybridAI 2026  
**Status**: Phase 5 Anonymous Participant Submissions Complete — Ready for Phase 6 (Automated AI Evaluation Pipeline)  

---

## Roadmap Overview

```
Phase 0: Project Audit and Preparation                    [COMPLETED]
Phase 1: Firebase AI Logic Hybrid Inference Spike        [COMPLETED]
Phase 2: Proofly UI Foundation & Design System           [COMPLETED]
Phase 3: Authentication & Competition Management         [COMPLETED]
Phase 4: Configurable Submission Forms & Access          [COMPLETED]
Phase 5: Anonymous Participant Submissions (Zero-Account) [COMPLETED]
Phase 6: Automated AI Evaluation Pipeline                [QUEUED]
Phase 7: Judge Workspace & Decision Review               [QUEUED]
Phase 8: Official Results, Security Rules & Sign-Off     [QUEUED]
```

---

## Phase Details & Checklists

### [x] Phase 0: Project Audit and Preparation
- [x] Comprehensive inspection of existing frontend, routes, and components.
- [x] Audit of Firebase configuration, Firestore schema, and auth vulnerabilities.
- [x] Security review of `firestore.rules` and exposed tokens.
- [x] Evaluation of existing scoring, faculty rubrics, and reconciliation engines.
- [x] Cataloging of test coverage (11 test files, 149 passing tests).
- [x] Creation of `docs/PROJECT_AUDIT.md`.
- [x] Creation of `docs/REUSE_AND_REPLACEMENT_PLAN.md`.
- [x] Creation of `docs/NEW_PRODUCT_ARCHITECTURE.md`.
- [x] Creation of `docs/PHASE_TRACKER.md`.
- [x] Baseline verification: tests pass, lint passes, build succeeds.
- [x] **Gate**: Present findings, recommendations, and wait for explicit approval.

---

### [x] Phase 1: Firebase AI Logic Hybrid Inference Spike
*Objective: Implement a minimal working Firebase AI Logic hybrid inference experiment with Gemini Nano 4 and Gemini 2.5 Flash cloud fallback, App Check attestation, and live Chrome test page.*
- [x] Inspect official Firebase AI Logic documentation and verify Web SDK APIs (`firebase/ai`).
- [x] Initialize Firebase App Check in `src/config/firebase.ts` (`initializeAppCheck`).
- [x] Implement runtime hybrid inference engine in `src/services/aiLogicService.ts` with `InferenceMode.PREFER_ON_DEVICE`.
- [x] Implement Chrome Prompt API bridge for on-device Gemini Nano 4 (`LanguageModel` / `window.ai.languageModel`).
- [x] Configure cloud fallback to `gemini-2.5-flash` with structured output `responseSchema`.
- [x] Build Proofly AI Logic test page (`src/pages/AiLogicTestPage.tsx`) accessible at `/ai-test`.
- [x] Implement mandated prompt: "Evaluate this project summary for clarity, originality and technical feasibility. Return structured observations."
- [x] Implement mode switcher (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`).
- [x] Capture and render honest execution telemetry (`inferenceSource`, `latencyMs`, fallback notice, App Check status).
- [x] Handle unsupported browsers, missing Prompt API, and network error states.
- [x] Provide retry action and safe diagnostic dump.
- [x] Write unit tests in `src/services/__tests__/hybridAiLogic.test.ts` (14 passing tests; 163 total passing tests).
- [x] Document technical implementation in `docs/FIREBASE_AI_LOGIC_IMPLEMENTATION.md`.
- [x] Verification: `npm test`, `npm run lint`, `npm run build`.
- [x] **Gate**: Stop and report Phase 1 completion; wait for approval.

---

### [x] Phase 2: Proofly UI Foundation & Design System
*Objective: Completely replace legacy story/cyber visual interface with a professional, minimal SaaS design system and three distinct layouts (Organizer, Judge, Participant).*
- [x] Replace `src/index.css` with a light-first, clean, modern SaaS design system with slate text, blue accents, subtle shadows, and neutral borders.
- [x] Build reusable UI primitives in `src/components/ui/`: `Button`, `Badge`, `Input`, `Textarea`, `Select`, `Card`, `Table`, `Modal`, `ConfirmDialog`, `Breadcrumbs`, `PageHeader`, `EmptyState`, `Skeleton`, `Toast`, `Tabs`, and `GithubIcon`.
- [x] Build 3 distinct layouts:
  - **Organizer Layout** (`OrganizerLayout.tsx`): Overview, Competitions, Submissions, Evaluations, Judges, Results, Settings.
  - **Judge Layout** (`JudgeLayout.tsx`): My assignments, Review workspace, Evaluation history, progress meter.
  - **Participant Layout** (`ParticipantLayout.tsx`): Clean, friction-free submission container without account/login barrier.
- [x] Build realistic initial pages with temporary mock design data (`src/design-system/mockDesignData.ts`):
  - Organizer Overview (`/organizer`)
  - Competition List (`/organizer/competitions`)
  - Submission List & AI Dossier Modal (`/organizer/submissions`)
  - Judge Assignment Queue (`/judge/assignments`)
  - Split-Screen Judge Review Workspace (`/judge/review`) with side-by-side AI scores & human decision console
  - Participant Submission Page (`/submit`) with instant receipt token generator
  - Landing Hub (`/`) linking the three workspaces and hybrid AI spike
- [x] Verification: `npm test` (163/163 passing), `npm run lint` (0 errors), `npm run build` (successful compilation and bundle).
- [x] **Gate**: Stop after UI foundation is complete; wait for approval to begin Phase 3.

---

### [x] Phase 3: Authentication and Competition Management
*Objective: Implement the application's trusted user and organization foundation with competition-scoped authorization, lifecycle state machine, and multi-tenant security rules.*
- [x] **Authentication & Scoped Roles**:
  - Firebase Authentication integration for Platform Admins, Organization Owners/Admins, Competition Admins, and Judges.
  - **Zero participant registration**: Participants do not require accounts.
  - Implemented **competition-scoped authorization** (`src/services/scopedAuthService.ts`): users can be an organizer in competition A and a judge in competition B without privilege escalation; zero reliance on global `isAdmin` boolean.
- [x] **Multi-Tenant Organizations**:
  - Implemented `src/services/organizationService.ts` for organization profile, membership, roles (`OWNER`, `ADMIN`, `MEMBER`), and active organization switching.
  - Interactive Organization Switcher dropdown in `ProoflyGlobalHeader.tsx` allowing switching between `DeepMind Academic & Research Guild` and `Robotics Engineering Foundation`.
  - Added 1-click Demo Persona toggle ("Saikeerthana (Lead Organizer)" ⇄ "Dr. Elena Vance (Judge)") for live verification.
- [x] **Competitions & Lifecycle State Machine**:
  - Implemented `src/services/competitionService.ts` for competition creation, editing, status transitions, and archiving.
  - Implemented `src/services/competitionLifecycleService.ts` with strict state machine: `DRAFT` ➔ `ACTIVE` ➔ `SUBMISSIONS_CLOSED` ➔ `EVALUATION` ➔ `RESULTS_REVIEW` ➔ `PUBLISHED` ➔ `ARCHIVED`.
  - Comprehensive activation validation: 100% sum rubric weights, valid chronological dates, team constraints.
  - Full configuration parameters: Participation mode (`INDIVIDUAL`, `TEAM`, `BOTH`), team limits, submission deadline, late submission toggle, submission edit lock toggle, AI evaluation gate (mandatory), visibility (`PUBLIC`, `PRIVATE`, `UNLISTED`).
- [x] **Restrictive Security Rules**:
  - Rewrote `firestore.rules` enforcing multi-tenant isolation, scoped competition permissions, zero-account submission creation, and immutable AI scores.
- [x] **Unit & Integration Tests**:
  - Implemented `src/services/__tests__/roleAndTenantIsolation.test.ts` (11 passing tests).
  - Total test suite: **174 of 174 passing tests** across 13 test suites.
- [x] **UI Integration**:
  - Connected `ProoflyAuthProvider` into `App.tsx`.
  - Connected dynamic competition queries to `CompetitionListPage.tsx` and `OrganizerOverviewPage.tsx`.
  - Added lifecycle state transition buttons (`Activate`, `Close Submissions`, `Start Evaluation`, `Review Results`, `Publish`, `Archive`) with toast validation.
- [x] Verification: `npm test` (174/174 pass), `npm run lint` (0 errors), `npm run build` (clean bundle).
- [x] **Gate**: Present Phase 3 implementation, and wait for explicit approval before proceeding.

---

### [x] Phase 4: Configurable Submission Forms & Access Management
*Objective: Build a reusable submission form builder supporting 13 field types, multi-round schemas, public access codes, individual cryptographically random single-use tokens, SHA-256 hash storage, and short-lived scoped submission sessions.*
- [x] **Form Builder Engine**:
  - Implemented `src/types/formAndAccess.ts` supporting 13 field types: Short text, Long text, Email, URL, Number, Dropdown, Multi-select, Checkbox, File upload, Multiple file upload, GitHub repository URL, Video URL, Team member repeater.
  - Granular validation rules: regex, bounds, character limits, allowed file extensions, max file size in MB, team bounds.
  - Multi-round schema support (`roundId` scoping) and field visibility flags (`PUBLIC`, `ORGANIZER_ONLY`, `JUDGE_ONLY`).
  - Schema persistence and default hackathon template generator in `src/services/formBuilderService.ts`.
- [x] **Strict Form Validation Engine**:
  - Implemented `src/services/formValidationService.ts` verifying required fields, email formatting, GitHub/video URL patterns, numeric limits, allowed file types/sizes, and team sizes.
- [x] **Cryptographic Access Management**:
  - Implemented `src/utils/cryptoUtils.ts` (Web Crypto API `crypto.getRandomValues`, `crypto.subtle.digest` SHA-256, constant-time comparison).
  - Implemented `src/services/accessManagementService.ts`:
    - Public competition access codes (`PF-XXXX`).
    - Cryptographically random 256-bit entropy unique individual tokens.
    - **Zero raw tokens stored in Firestore**: Only SHA-256 hashes (`tokenHash`) and prefix previews (`tokenPrefix`) stored.
    - One-time raw token issuance to organizers.
    - Ephemeral short-lived submission session tokens (`SubmissionSessionToken`, 30-minute TTL).
    - Access revocation, submission limits, and expiration date enforcement.
- [x] **UI Components**:
  - Form Builder Canvas (`src/components/forms/FormBuilderCanvas.tsx`): 13-field palette, field reordering, validation inspector, live participant form preview.
  - Access Management Panel (`src/components/forms/AccessManagementPanel.tsx`): public code copy/regenerate, individual link generator with one-time reveal, and access keys table with revoke action.
  - Integrated Organizer Forms & Access Page (`src/pages/organizer/CompetitionFormsAndAccessPage.tsx`) routed at `/organizer/forms`.
- [x] **Firestore Security Rules**:
  - Added strict multi-tenant and role-scoped rules for `/formSchemas/{schemaId}` and `/accessKeys/{keyId}` in `firestore.rules`.
- [x] **Unit & Integration Tests**:
  - Implemented `src/services/__tests__/submissionFormAndAccess.test.ts` (14 passing tests) covering invalid codes, expired links, revoked tokens, invalid file types, missing required fields, submission limits, SHA-256 hash persistence, and multi-round schemas.
  - Total test suite: **188 passing tests** across 14 test suites.
- [x] Verification: `tsc -b` (0 errors), `npm run build` (clean production bundle), `npm run lint` (0 errors), `npm test` (188/188 pass).
- [x] **Gate**: Stop after form builder and access management are complete; wait for approval before building participant submission workflow.

---

### [x] Phase 5: Anonymous Participant Submissions (Zero-Account)
*Objective: Implement the complete participant-facing submission workflow without user accounts, secret management links, magic byte file validation, 11-status lifecycle state machine, and mandatory pre-judge AI evaluation gate.*
- [x] **Zero-Account Submissions**:
  - Participant opens competition link (`/submit?code=...` or `/submit?token=...`) or enters access code on `/submit`.
  - Configured form schema dynamically loaded and rendered (only organizer-enabled fields displayed).
  - Supports individual and team submissions, self-declared team names, participant names, optional emails, project title, description, problem statement, solution, tech stack tags, GitHub URL, live deployment URL, video demo link, and file uploads.
- [x] **Team & Participant Handling**:
  - Created `src/services/participantTeamService.ts` creating `TeamRecord` and `ParticipantRecord` documents.
  - Distinct handling for solo participants (never forced into a fake team).
  - CSV bulk importer (`importParticipantsFromCsv`) supporting pre-registered teams and participants with auto-validation.
- [x] **Submission Management & Cryptographic Security**:
  - Implemented `src/services/submissionService.ts`:
    - Draft submission (`Draft`) and final submit (`Submitted` ➔ `Validating` ➔ `Queued for AI Evaluation`).
    - Human-readable reference ID generator (`PF-SUB-2026-XXXXX`).
    - Cryptographically random 256-bit entropy token (`sec_[a-f0-9]{64}`).
    - **Zero raw tokens stored in Firestore**: Only SHA-256 hash (`managementTokenHash`) and prefix (`managementTokenPrefix`) persisted.
    - Confirmation screen (`SubmissionConfirmationView.tsx`) with copyable secret link and safety instructions.
    - Participant management portal (`/submit/manage`) with token verification, 11-status stepper tracker, editing before deadline, draft-to-final promotion, and multi-version snapshots (`versions`).
    - Late submission policy enforcement (`isLate`).
- [x] **Secure File Handling**:
  - Implemented `src/services/fileStorageService.ts`:
    - Binary header inspection via magic bytes (`%PDF-`, `PK\x03\x04` for ZIP, `\x89PNG`, `\xFF\xD8\xFF` for JPEG).
    - Dangerous executable blacklisting (`.exe`, `.dll`, `MZ`, ELF, Mach-O, Java class bytecode).
    - File size cap enforcement, SHA-256 content checksums, and metadata persistence.
- [x] **11-Status State Machine & AI Evaluation Gate**:
  - Implemented `src/services/submissionLifecycleService.ts` across all 11 statuses: `Draft`, `Submitted`, `Validating`, `Queued for AI Evaluation`, `AI Evaluation In Progress`, `AI Evaluation Complete`, `AI Evaluation Failed`, `Ready for Judge Review`, `Under Human Review`, `Evaluated`, `Finalized`.
  - **Mandatory AI Gate**: Judges cannot access normal review workspace before AI evaluation is complete (`canJudgeReviewSubmission`).
  - **Organizer AI-Failure Override**: Organizers can bypass failed AI evaluations (`applyAiFailureOverride`) with documented justification and immutable audit logging.
- [x] **UI & Workspaces Polish**:
  - Full-width, balanced Landing Hub (`src/pages/LandingHubPage.tsx`) with zero empty voids or cornering.
  - Organizer Submissions & Team Registry (`src/pages/organizer/SubmissionListPage.tsx`) with filterable status tabs, dossier modals, AI override modal, and CSV import modal.
  - Judge Review Queue & Split-Screen Studio (`src/pages/judge/JudgeAssignmentListPage.tsx` and `JudgeReviewWorkspacePage.tsx`) enforcing the AI evaluation gate.
- [x] **Unit & Integration Tests**:
  - Implemented `src/services/__tests__/anonymousParticipantSubmission.test.ts` (15 passing tests).
  - Total test suite: **203 passing tests** across 15 test suites.
- [x] Verification: `tsc -b` (0 errors), `npm run lint` (0 errors), `npx vitest run` (203/203 pass), `npm run build` (clean bundle).
- [x] **Gate**: Stop after the end-to-end submission flow works; wait for approval before beginning Phase 6.

---

### [ ] Phase 6: Automated AI Evaluation Pipeline
*Objective: Build and wire the automated Firebase AI Logic evaluation worker.*
- [ ] Implement AI worker queue processor polling submissions in `Queued for AI Evaluation`.
- [ ] Connect `aiLogicService` with Gemini Nano 4 on-device Prompt API and cloud Gemini 2.5 Flash fallback.
- [ ] Synthesize project dossier and execute evaluation against 4-dimensional competition rubric.
- [ ] Generate structured criterion scores, confidence ratings, and deduction rationales.
- [ ] Update submission status to `Ready for Judge Review` upon success or `AI Evaluation Failed` on timeout/error.
- [ ] Segregate AI evaluation documents from human judge score ledgers.
- [ ] Unit & integration tests for AI worker execution and fallback.
- [ ] **Gate**: Stop after AI evaluation pipeline is verified; wait for approval before Phase 7.

---

### [ ] Phase 7: Judge Workspace & Decision Review
*Objective: Split-screen human review workspace, side-by-side AI score transparency, and agree/modify/reject decision workflows.*
- [ ] Build judge scoring console and rubric sliders (0-25 per criterion, max 100).
- [ ] Implement Agree, Modify, and Reject actions with mandatory deduction rationales.
- [ ] Store judge evaluations in segregated ledger documents (`judgeReviews/{reviewId}`).
- [ ] Compute intra-competition judge progress metrics and history.
- [ ] Transition submission status to `Under Human Review` ➔ `Evaluated`.
- [ ] **Gate**: Stop after judge workspace is complete; wait for approval before Phase 8.

---

### [ ] Phase 8: Official Results, Security Rules & Production Sign-Off
*Objective: Multi-judge consensus aggregation, organizer sign-off, public results leaderboard, and production deployment.*
- [ ] Build Organizer Review & Consensus Board: AI vs Judge score divergence, standard deviation, and variance warnings.
- [ ] Build Official Results Publisher: authorized organizer sign-off, final ranking computation, and public results page.
- [ ] Finalize `firestore.rules` and App Check attestation for production deployment.
- [ ] End-to-end regression testing, TypeScript strict check, linting, and final production build.
- [ ] Final project sign-off and deployment guide.
