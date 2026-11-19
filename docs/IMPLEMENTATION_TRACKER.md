# Proofly — Hardening Implementation Tracker

**Architecture:** Firebase-Only Backend (Firebase Hosting, Firebase Auth, Cloud Firestore, Cloud Storage for Firebase, Firebase App Check, Firebase AI Logic, Firebase Cloud Functions v2).  
**Legacy Vercel Stack:** Explicitly deprecated and excluded.

---

## Current Phase Status

| Phase | Name | Status | Exit Gate / Notes |
|---|---|---|---|
| **Phase 00** | Engineering Baseline & Secret Cleanup | **COMPLETED (Pending Owner PAT Revocation)** | Baseline verified. `.gitignore` and `.env.example` hardened. All 4 baseline docs created. **Owner action:** Revoke previously exposed `VITE_GITHUB_TOKEN` PAT (`SEC-001`) and remove it from `.env`. |
| **Phase 01** | Authentication & Authorization Foundation | **COMPLETED** | Real Firebase Auth (Email/Password, Google, Sign-up, Password Reset, `onIdTokenChanged`, token refresh & session expiration), zero demo auto-login, static `import.meta.env` in `firebase.ts` (stops `VITE_GITHUB_TOKEN` bundle leak), scoped 6-role model (`authorizationService`, `scopedAuthService`, `invitationService`), protected Organizer & Judge routes (`ProtectedRoute`, `AuthPage`), and 16 new security tests (307/307 total passing). |
| **Phase 02** | Firebase Security Rules & Tenant Isolation | **COMPLETED (Not Deployed Automatically)** | Strict least-privilege `firestore.rules` (20+ collections, backend-only `/platformAdmins`, status-bypass fix, public PII elimination, judge-assignment isolation, backend-only ledger/audit/leaderboard writes) + cross-service `storage.rules` (tenant-scoped paths, Firestore-verified uploads/reads, zero wildcard auth reads) + Firebase Emulator config (`firebase.json`) + 14/14 real Firestore & Storage Emulator tests (`npm run test:rules`) + `docs/SECURITY_RULES_MATRIX.md`. |
| **Phase 03** | Real Submission File Storage (Spark Free Tier + Optional Blaze) | **COMPLETED (Not Deployed Automatically)** | Replaced browser `blob:` URL mock uploads in `fileStorageService.ts` with real persistent **Firebase Spark Free Tier** Firestore binary chunk storage (`firestore-chunks` default, 700 KB native `Bytes` chunks, <= 8 MB/file, immutable `/submissionArtifacts/{fileId}/chunks/{chunkIndex}` enforced by `firestore.rules` Section 19) + optional `firebase-storage` Blaze backend (<= 25 MB/file). Includes official format & magic-byte validation, full-file SHA-256 (`sha256Bytes`), canonical paths, progress/cancel/retry/duplicate handling, authorized cross-device downloads, non-destructive legacy audit (`fileStorageMigrationService.ts`, `docs/STORAGE_MIGRATION_REPORT.md`), and 6/6 real Emulator end-to-end tests (`20/20` total in `npm run test:rules`, `307/307` in `npm test`). |
| **Phase 04** | Durable Firestore Persistence | **COMPLETED (Not Deployed Automatically)** | Eliminated `localStorage` primary stores & silent Firestore write fallbacks across `organizationService`, `judgeAssignmentService`, `scoringLedgerService`, `resultsAndAnalyticsService`, `governanceAuditService`, `auditLogService`, `competitionService`, `submissionService`, `formBuilderService`, `accessManagementService`, `participantTeamService`, `evaluationPipelineService`, `evaluationQueueService`, and `OrganizerSettingsPage`. Added `firestorePersistenceService.ts` (`PersistenceError`, bounded pagination, `serverTimestamp()`), `trustedBackendPersistence.ts` (immutable transactional ledger, leaderboard snapshots & audit logs), atomic org+owner creation (`existsAfter`/`getAfter`), canonical deterministic assignment/evaluation IDs, non-destructive `localStorageMigrationService.ts`, `docs/PERSISTENCE_MIGRATION_REPORT.md`, and 5 multi-device Firestore Emulator tests (`25/25` total in `npm run test:rules`, `307/307` in `npm test`). |
| **Phase 05** | Durable Evaluation Job Engine | **COMPLETED (Not Deployed Automatically)** | Built transactional Firestore evaluation queue in `evaluationQueueService.ts` and `src/types/aiEvaluation.ts`. Replaced in-memory queue fallback with durable Firestore `/evaluationJobs/{jobId}` (`serverTimestamp()`), 9 canonical lifecycle states (`QUEUED`, `CLAIMED`, `EXTRACTING`, `EVALUATING`, `VALIDATING`, `COMPLETED`, `FAILED`, `RETRY_WAIT`, `CANCELLED`), atomic CAS claims (`runTransaction` with lease timers), dual-worker claim race prevention, stale/crash lease recovery, structured error classification (`NETWORK_TRANSIENT`, `RATE_LIMIT`, `INVALID_INPUT`, `PERMISSION_ERROR`, `MODEL_ERROR`, `UNSUPPORTED_ARTIFACT`, `PERMANENT_FAILURE`), bounded exponential backoff with jitter (`RETRY_WAIT`), organizer manual retry with mandatory governance audit logging (`governanceAuditLogs`), and least-privilege security rules (participants & untrusted clients denied writes & reads; competition admin reads). 7 new Emulator integration tests (32/32 passing in `npm run test:rules`, 307/307 in `npm test`). |
| **Phase 06** | Reliable Artifact Extraction & Evidence Provenance | **COMPLETED** | Rebuilt extraction engine into modular architecture under `src/services/extractors/` (`types.ts`, `pdfExtractor.ts`, `pptxExtractor.ts`, `zipExtractor.ts`, `githubExtractor.ts`, `urlInspector.ts`, `videoInspector.ts`, `textExtractor.ts`, `archiveUtils.ts`). Real PDF text stream parsing (`BT...ET`) with page preservation and scanned image OCR detection (`REQUIRES_OCR`, zero text fabrication). Real PPTX PKZip XML parsing (`<a:t>`) with slide number & title provenance. Bounded GitHub inspection (max 15 files, max 50KB/file, exact commit SHA, default branch, honest `PARTIALLY_EXTRACTED`, zero code execution). SSRF-protected deployment URL inspector (blocks loopback, RFC 1918 private IPs, cloud metadata `169.254.169.254`, IPv6, non-HTTP schemes; verifies redirect safety; separates reachability from functional verification). Explicit uninspected video evidence (`NOT_INSPECTED`, empty content, zero hallucination). Secure ZIP archive inspection (zip bomb detection, path traversal protection, executable detection, zero execution). Strict provenance schema (`NormalizedExtractionResult`, `EvidenceReference`, SHA-256 `contentHash`). 21 new unit tests in `phase6ArtifactExtraction.test.ts` (328/328 unit tests passing, 32/32 emulator tests passing, clean `tsc` and `build`). |
| **Phase 07** | Trustworthy Firebase AI Logic Evaluation & Worker Engine | **COMPLETED** | Official Firebase AI Logic integration via `firebase/ai` (`getAI`, `getGenerativeModel`, `InferenceMode`, `InferenceSource`, `Schema`), structured output JSON schemas, comprehensive inference telemetry, honest `ON_DEVICE` / `IN_CLOUD` reporting, transparent model error handling (`allowFallback: false`), 25s timeout with `AbortController`, non-penalizing OCR incompleteness handling, prominent judge fallback disclosures, authenticated browser evaluation worker (`evaluationWorkerService.ts`), and non-binding AI suggested scores. 15 unit tests in `phase7AiLogicEvaluation.test.ts` (343/343 unit tests passing, 32/32 emulator tests passing). |
| **Phase 08** | Competition Lifecycle & Submission Integrity | **COMPLETED** | Audited and repaired complete lifecycle state machine (`DRAFT` $\to$ `REGISTRATION_OPEN` $\to$ `REGISTRATION_CLOSED` $\to$ `ACTIVE` $\to$ `SUBMISSIONS_CLOSED` $\to$ `EVALUATION` $\to$ `RESULTS_REVIEW` $\to$ `PUBLISHED` $\to$ `ARCHIVED`), default `DRAFT` creation, authorization validation (`COMPETITION_ADMIN`, `ORGANIZER`, `SUPER_ADMIN`), full `lifecycleHistory` audit logging. Eliminated content fabrication in `submissionService.ts` (zero synthetic text, fake URLs, or filler emails). Anonymous participant session tokens via secure random bytes (`crypto.getRandomValues`), storing only SHA-256 hashes in Firestore. Enforced registration/submission deadlines, late submission policy (`isLate: true`), atomic `maxSubmissions` limit under concurrent bursts, team size caps (`minTeamMembers` .. `maxTeamMembers`), editing locks (`isLocked: true`), and participant status privilege separation (cannot mutate to judge/AI statuses). 20 new comprehensive tests in `phase8CompetitionLifecycleAndSubmission.test.ts` (363/363 unit tests passing, 32/32 emulator tests passing, clean `tsc` and `build`). |
| **Phase 09** | Judge Evaluation, Scoring & Official Results | **COMPLETED** | Complete human judging workflow, independent draft evaluations (`heval_{submissionId}_{judgeId}`), strict judge scoping & cross-judge draft isolation, conflict declarations, organizer reassignment & revocation (`REVOKED`), explicit AI acceptance/modification/rejection (`decisionMode`), append-only score ledger capturing `previousScore` and `previousEntryId`, multi-policy aggregation (`AVERAGE_JUDGE`, `WEIGHTED_JUDGE`, `MEDIAN`, `TRIMMED_MEAN` Olympic scoring, `CRITERION_WEIGHTED`, `ROUND_WISE`, `AI_ASSISTED`), deterministic tie-breakers, organizer-gated publication (`PUBLISHED`), and hidden/delayed leaderboards (`isLeaderboardHidden`, `leaderboardPublishDate`). 19 new tests in `phase9JudgeEvaluationScoringAndResults.test.ts` (382/382 unit tests, 32/32 emulator tests passing, clean `tsc` and `build`). |
| **Phase 10** | Legacy Cleanup, Simulation Governance & E2E Verification | **COMPLETED** | Complete engineering cleanup of legacy PRison-Break / Vercel artifacts. Arbitrary untrusted code execution marked strictly `UNSUPPORTED` in production (`sandboxRunner.ts` defaults to `isSandboxAvailable() === false`; misleading fake passing tests removed; tampering detection & environment sanitization preserved). Permanently eliminated `api/evaluate-repo.ts` (fake AI evaluator), `api/github/webhook.ts`, `api/webhook.ts`, `vercel.json`, `.vercelignore`, and `.vercel/` cache; stripped webhook plugin from `vite.config.ts`; uninstalled `@vercel/node`; renamed package to `"proofly"`. Quarantined legacy admin pages/services. Authored comprehensive mock/simulation classification in `docs/LEGACY_AUDIT_AND_SIMULATION_REGISTER.md`. Created automated 11-step E2E verification test in `phase10LegacyCleanupAndE2E.test.ts`. All 31 test files / 391 unit tests passing, all 4 rules test files / 32 emulator tests passing (423 total passing), clean `tsc -b`, clean linter, and clean production build. |

---

## Phase 00 Checklist

- [x] Inspect complete repository (React SPA, Firebase config, Firestore rules/indexes, Storage rules, Auth, Evaluation pipeline, Submission pipeline, Judge/Scoring services, Org/Competition services, tests, env config)
- [x] Identify working features, incomplete implementations, mocks, `localStorage`/in-memory fallbacks, security weaknesses, duplicate services, legacy code, and false-success assumptions
- [x] Scan codebase, `.env` variable names (without printing values), `.vercel/.env.production.local`, built `dist/` bundle, and Git history for secret exposure
- [x] Harden `.gitignore` for all secret/private-key patterns and clean `.env.example` to safe Firebase-only placeholders
- [x] Execute baseline checks: `npm ls`, `npx tsc -b --noEmit`, `npm run lint`, `npm test -- --run`, `npm run build`, `firebase --version`, `java -version`
- [x] Author `docs/ENGINEERING_BASELINE.md`
- [x] Author `docs/SECURITY_FINDINGS.md`
- [x] Author `docs/IMPLEMENTATION_TRACKER.md`
- [x] Author `docs/LEGACY_CODE_REGISTER.md`
- [ ] **Manual Owner Action (P0):** Revoke exposed GitHub PAT (`SEC-001`), remove `VITE_GITHUB_TOKEN` from `.env`, rebuild, and redeploy Firebase Hosting

---

## Phase 01 Checklist (Authentication & Authorization Foundation)

- [x] Implement real Firebase Authentication for organizers and judges (`firebaseAuthService.ts`)
- [x] Eliminate demo organizer auto-login; require explicit authenticated session
- [x] Implement token refresh, expired session clearing, and signed-out state handling (`onIdTokenChanged`)
- [x] Implement 6-role hierarchical authorization model (`authorizationService.ts`, `scopedAuthService.ts`)
- [x] Protect Organizer and Judge routes (`ProtectedRoute.tsx`, `AuthPage.tsx`)
- [x] Author 16 unit and security tests in `phase1AuthAndAuthorization.test.ts` (307/307 passing)

---

## Phase 02 Checklist (Firebase Security Rules & Tenant Isolation)

- [x] Rewrite `firestore.rules` for 20+ collections with default deny, strict tenant binding, and backend-only collections
- [x] Block unassigned/conflict judges from accessing submissions and evaluations
- [x] Enforce backend-only writes for `/platformAdmins`, `/scoreContributions`, `/scoringLedger`, `/governanceAuditLogs`, `/auditLogs`, `/leaderboardSnapshots`
- [x] Rewrite `storage.rules` for tenant-scoped submission uploads with Firestore validation and zero wildcard reads
- [x] Configure Firebase Emulators (`firebase.json`) for Firestore, Storage, and Auth
- [x] Author 14 Emulator security rules tests in `tests/rules/firebaseSecurityRules.test.ts`
- [x] Author `docs/SECURITY_RULES_MATRIX.md`

---

## Phase 03 Checklist (Real Submission File Storage)

- [x] Replace browser `blob:` URL mock uploads with real persistent storage in `fileStorageService.ts`
- [x] Default to 100% Spark Free Tier compatible binary chunk storage in Firestore (`firestore-chunks`, 700 KB native Bytes, <= 8 MB)
- [x] Support optional Blaze Cloud Storage backend (`firebase-storage`, <= 25 MB)
- [x] Implement MIME and magic-byte format validation for PDF, PPT, PPTX, ZIP, PNG, JPEG, JSON, and CSV
- [x] Compute full-file SHA-256 hash across chunks (`sha256Bytes`) and verify integrity
- [x] Support upload progress tracking, cancellation, retry, and deduplication
- [x] Enforce tenant-scoped canonical storage paths and Firestore security rules (Section 19)
- [x] Author 6 Emulator tests in `tests/rules/phase3StorageEmulator.test.ts`
- [x] Author `docs/STORAGE_MIGRATION_REPORT.md`

---

## Phase 04 Checklist (Durable Firestore Persistence)

- [x] Eliminate `localStorage` primary stores and silent fallbacks across all business services
- [x] Implement `firestorePersistenceService.ts` with typed `PersistenceError`, bounded pagination, and `serverTimestamp()`
- [x] Implement `trustedBackendPersistence.ts` for append-only score contributions, versioned publications, and audit logs
- [x] Fix atomic organization creation with initial OWNER membership using `existsAfter`/`getAfter`
- [x] Implement canonical deterministic document IDs for judge assignments (`{submissionId}_{judgeId}`) and evaluations
- [x] Support evaluation locking and auditable organizer reopening (`reopenHistory`)
- [x] Author non-destructive `localStorageMigrationService.ts` with ownership validation
- [x] Author 5 multi-device Emulator tests in `tests/rules/phase4FirestorePersistence.test.ts`
- [x] Author `docs/PERSISTENCE_MIGRATION_REPORT.md`

---

## Phase 05 Checklist (Durable Evaluation Job Engine)

- [x] Store all evaluation jobs in Cloud Firestore `/evaluationJobs/{jobId}` with `serverTimestamp()`
- [x] Eliminate in-memory job queues and browser tab reliance for job persistence
- [x] Implement 9-state lifecycle: `QUEUED`, `CLAIMED`, `EXTRACTING`, `EVALUATING`, `VALIDATING`, `COMPLETED`, `FAILED`, `RETRY_WAIT`, `CANCELLED`
- [x] Implement atomic CAS job claiming via Firestore `runTransaction` with lease timers (`leaseOwnerId`, `leaseExpiresAt`)
- [x] Prevent concurrent worker collision: dual-worker claim race guarantees exactly one worker wins
- [x] Implement intermediate stage progression (`updateJobStage`) and lease ownership checks
- [x] Implement lease heartbeat (`heartbeatLease`) and worker crash / stale lease recovery (`recoverStaleJobs`)
- [x] Implement structured error classification (`NETWORK_TRANSIENT`, `RATE_LIMIT`, `INVALID_INPUT`, `PERMISSION_ERROR`, `MODEL_ERROR`, `UNSUPPORTED_ARTIFACT`, `PERMANENT_FAILURE`)
- [x] Implement bounded exponential backoff with jitter (`RETRY_WAIT` until `backoffUntilMs`)
- [x] Implement organizer manual retry (`retryJobManual`) with mandatory governance audit logging (`governanceAuditLogs`)
- [x] Update `firestore.rules` (Section 13) to deny direct client writes, block participant access, and allow competition admin reads
- [x] Author 7 real Emulator integration tests in `tests/rules/phase5EvaluationJobEngine.test.ts` (32/32 rules tests passing)
- [x] Verify complete test suite (307/307 unit/integration tests passing) and production build (clean build)

---

## Phase 06 Checklist (Reliable Artifact Extraction & Evidence Provenance)

- [x] Create modular extraction pipeline under `src/services/extractors/` with unified `ArtifactExtractor<T>` contract
- [x] Define standardized `NormalizedExtractionResult` schema with `EvidenceReference[]`, `EvidenceLocation`, timestamps, warnings, errors, and SHA-256 `contentHash`
- [x] Build real PDF parser (`pdfExtractor.ts`): page-by-page text stream parsing (`BT...ET`, `Tj`, `TJ`), page number preservation, section headings, and automatic scanned image OCR detection (`REQUIRES_OCR`, zero text fabrication)
- [x] Build real PPTX parser (`pptxExtractor.ts`): decompress PKZip archive, parse XML hierarchy (`ppt/slides/slide*.xml`), extract `<a:t>` inside paragraph/run nodes, preserve slide numbers and titles, reject raw byte ASCII scraping, flag legacy `.ppt` as `UNSUPPORTED`
- [x] Build bounded GitHub repository extractor (`githubExtractor.ts`): fetch metadata, default branch, latest commit SHA, README, and bounded allowlisted source/config files (max 15 files, max 50KB/file); record exact commit SHA; never claim full inspection (`PARTIALLY_EXTRACTED`); never execute repository code; handle 404/private/rate-limits honestly (`INACCESSIBLE`)
- [x] Build SSRF-protected deployment URL inspector (`urlInspector.ts`): strictly block loopback (`127.0.0.1`, `localhost`, `0.0.0.0`), private RFC-1918 IPs (`10.*`, `172.16.*`, `192.168.*`), cloud metadata (`169.254.169.254`), IPv6 private/link-local, and non-HTTP schemes; validate redirect targets against SSRF gate; separate reachability from functional verification
- [x] Build honest video evidence inspector (`videoInspector.ts`): explicitly mark video URLs as `NOT_INSPECTED`, return empty content and zero fabricated references, attach mandatory disclaimer (`Video was not visually or auditorily inspected by the automated evaluation model`)
- [x] Build secure ZIP archive inspector (`zipExtractor.ts` / `archiveUtils.ts`): enforce zip bomb limits (25MB uncompressed, 100:1 ratio), path traversal protection (`../`, null bytes), file count caps (500), detect executable extensions (`.exe`, `.sh`, `.bat`, `.dll`), and prevent arbitrary code execution
- [x] Rebuild `contentExtractionService.ts` to coordinate all modular extractors and assemble `StructuredEvidencePacket`
- [x] Enforce honest extraction status taxonomy (`EXTRACTED`, `PARTIALLY_EXTRACTED`, `UNSUPPORTED`, `INACCESSIBLE`, `EXTRACTION_FAILED`, `REQUIRES_OCR`, `NOT_INSPECTED`) with zero conversion of failures into verified evidence
- [x] Author comprehensive test suite in `src/services/__tests__/phase6ArtifactExtraction.test.ts` (21 tests) covering text PDF, scanned PDF, PPTX, malformed PPTX, large ZIP/zip-bomb/traversal, safe GitHub, private GitHub, unreachable URL, SSRF attacks, video inspector, markdown provenance, and structured evidence assembly
- [x] Verify complete test suite (328/328 unit tests passing across 27 files, 32/32 emulator tests passing across 4 files, zero TypeScript errors in `tsc -b`, clean linter, and clean production build)

---

## Phase 07 Checklist (Trustworthy Firebase AI Logic Evaluation)

- [x] Official Firebase AI Logic integration via `firebase/ai` (`getAI`, `getGenerativeModel`, `InferenceMode`, `InferenceSource`, `GoogleAIBackend`, `Schema`); verified models: Cloud (`gemini-2.5-flash`), On-Device (`gemini-nano-4` via Chrome Prompt API); direct Gemini API calls and raw client API keys strictly eliminated
- [x] Strict structured output JSON schema validation (`rubricCriterionSchema`, `rubricEvaluationReportSchema`, `projectEvaluationSchema`) built using official `Schema.object(...)`
- [x] Comprehensive inference telemetry tracking: `provider`, `modelIdentifier`, `sdkVersion`, `actualExecutionMode`, `actualInferenceSource`, `latencyMs`, `tokenUsage`, `appCheckStatus`, `requestId`, `rubricVersionNumber`, `evidencePacketVersion`, `evaluationOutcome`
- [x] Honest execution mode reporting: `ON_DEVICE` is strictly reported only when confirmed by SDK (`response.inferenceSource === InferenceSource.ON_DEVICE`); never guessed from client device availability alone
- [x] Transparent model failure handling: when `allowFallback: false`, model exceptions are not masked and record `AI_FAILED`
- [x] Realistic 25-second configurable timeout protection with `AbortController` cancellation signal and late response discarding
- [x] Unsupported browser detection: graceful failure and clean diagnostic error when `ONLY_ON_DEVICE` is invoked on non-Chrome or when Prompt API is disabled
- [x] App Check status transparency (`ACTIVE_AND_VERIFIED`, `BYPASSED_DEV_MODE`, `FAILED`) without client forgery
- [x] Invalid structured model output rejection: malformed or schema-violating outputs trigger validation error or safe fallback with judge disclosures
- [x] Evidence classification taxonomy: strict distinction between `VERIFIED_EVIDENCE`, `CLAIM_ONLY`, `MISSING_EVIDENCE`, `INACCESSIBLE_EVIDENCE`, `UNCLEAR_EVIDENCE`, and `NOT_INSPECTED`; README claims categorized as `CLAIM_ONLY` (not verified evidence)
- [x] Incomplete extraction handling: unreadable documents (`REQUIRES_OCR`, `EXTRACTION_FAILED`) result in `EXTRACTION_INCOMPLETE` outcome without penalizing participant scores
- [x] Honest deterministic fallback: fallback is explicitly labeled as `DETERMINISTIC_FALLBACK` (never labeled as AI evaluation, never claims `IN_CLOUD` or `gemini-2.5-flash`, never defaults confidence to `HIGH`, restricts confidence to `MEDIUM`/`LOW`, and attaches prominent judge disclosures)
- [x] Authenticated browser evaluation worker (`evaluationWorkerService.ts`): atomic job claiming from Firestore queue, heartbeat maintenance during browser inference, staged transitions (`EXTRACTING` $\to$ `EVALUATING` $\to$ `VALIDATING`), and stale job lease recovery
- [x] Concurrency protection and duplicate result submission prevention: verified that expired leases, stolen leases, or cancelled jobs cannot overwrite existing completed evaluations
- [x] Evaluation integrity enforcement (`assertEvaluationIntegrity`): AI evaluation scores remain non-binding suggestions (`suggestedScore`); AI is strictly prohibited from publishing winners, overriding human judge scores, or mutating locked evaluations
- [x] Author comprehensive test suite in `src/services/__tests__/phase7AiLogicEvaluation.test.ts` (15 tests covering all 12 core requirements + integrity constraints)
- [x] Verify complete test suite (343/343 unit/integration tests passing across 28 files, 32/32 emulator tests passing across 4 files, zero TypeScript errors in `tsc -b`, clean linter, and clean production build)

---

## Phase 08 Checklist (Competition Lifecycle & Submission Integrity)

- [x] Create new competitions as `DRAFT` by default in both UI (`CompetitionListPage.tsx`) and backend service (`competitionService.ts`); eliminate automatic `ACTIVE` defaults
- [x] Implement explicit 9-state lifecycle transition graph: `DRAFT` $\to$ `REGISTRATION_OPEN` $\to$ `REGISTRATION_CLOSED` $\to$ `ACTIVE` $\to$ `SUBMISSIONS_CLOSED` $\to$ `EVALUATION` $\to$ `RESULTS_REVIEW` $\to$ `PUBLISHED` $\to$ `ARCHIVED` in `competitionLifecycleService.ts`
- [x] Validate lifecycle transitions on backend, verifying prerequisite activation checks (`validateForActivation`) and restricting transitions to authorized roles (`COMPETITION_ADMIN`, `ORGANIZER`, `SUPER_ADMIN`)
- [x] Record comprehensive audit history (`lifecycleHistory`: `from`, `to`, `changedAt`, `changedBy`, `reason`) on every lifecycle transition
- [x] Eliminate all manufactured content in `submissionService.ts`: zero synthetic string padding, zero fake URLs (`github.com/proofly-demo/sample-project`), zero filler emails (`solo@example.com`); return clear backend validation errors when required fields are missing
- [x] Support individual and team submissions with server-side validation of participation policies, team names, and team size boundaries (`minTeamMembers` .. `maxTeamMembers`)
- [x] Implement anonymous participant sessions: participants submit without mandatory accounts via cryptographically secure session tokens (`crypto.getRandomValues`)
- [x] Secure access keys and individual submission links: store only SHA-256 hashes in Firestore, return raw tokens once to creators, sanitize client responses (`tokenHash: undefined`), and enforce expiration and revocation
- [x] Server-side enforcement of competition deadlines (`submissionDeadline`), late submission grace periods (`lateSubmissionDeadline`, `allowLateSubmissions`), and flagging `isLate: true`
- [x] Enforce `maxSubmissions` competition limit atomically using Firestore transactions and reservation counters, strictly rejecting concurrent burst requests above the cap
- [x] Maintain immutable submission ownership, reference IDs, incremental versions (`currentVersion`, `versions[]`), status history, and prevent cross-participant submission tampering
- [x] Prevent mutations on locked submissions (`isLocked: true`) without authorized override
- [x] Enforce status privilege separation: participants are restricted to `Draft` and `Submitted`, strictly preventing client escalation to backend statuses (`AI Evaluation Complete`, `Ready for Judge Review`, `Under Human Review`, `Evaluated`, `Finalized`)
- [x] Update Firestore security rules (`firestore.rules`) to permit `REGISTRATION_OPEN` and `REGISTRATION_CLOSED` statuses
- [x] Author comprehensive test suite in `src/services/__tests__/phase8CompetitionLifecycleAndSubmission.test.ts` (20 tests covering all lifecycle transitions, public/token access, rate limiting, expiry, revocation, individual/team limits, late policies, concurrent bursts, tampering, locking, and status privilege separation)
- [x] Verify complete test suite (363/363 unit/integration tests passing across 29 files, 32/32 emulator tests passing across 4 files, zero TypeScript errors in `tsc -b`, clean linter, and clean production build)

---

## Phase 09 Checklist (Judge Evaluation, Scoring & Official Results)

- [x] Implement secure, persistent judge assignments with multiple judges per submission (`judgeAssignmentService.ts`)
- [x] Implement assignment lifecycle states: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `CONFLICT`, `REVOKED`
- [x] Implement assignment revocation (`revokeAssignment`) with transactional status update to `REVOKED` and mandatory governance audit logging (`governanceAuditLogs`)
- [x] Enforce strict judge scoping: judges can only read assigned submissions and their associated AI reports; unassigned and conflict judges are blocked
- [x] Enforce conflict-of-interest declarations (`declareConflict`) and prevent reassignment to conflicted judges
- [x] Implement organizer reassignment (`reassignJudge`) with full audit trail (`reassignmentHistory`)
- [x] Implement independent judge evaluations stored per judge (`heval_{submissionId}_{judgeId}`), preventing cross-judge overwrites
- [x] Isolate draft evaluations: drafts (`status: 'DRAFT'`) are strictly invisible to other judges and excluded from official ranking calculations
- [x] Support criterion-wise scores, criterion comments, and overall feedback with save & resume
- [x] Prevent duplicate evaluation submissions and lock submitted evaluations as immutable by default
- [x] Support authorized evaluation reopening (`reopenEvaluation`) requiring organizer privileges, recording audit justification (`reopenHistory`)
- [x] Keep AI evaluations and human evaluations strictly separated: AI evaluations remain suggestions; human actions (`AGREE`, `MODIFY`, `REJECT`) record explicit human rationale without mutating AI records
- [x] Enforce mandatory justification note when rejecting or modifying AI recommendations
- [x] Implement configurable scoring aggregation policies: `AVERAGE_JUDGE`, `WEIGHTED_JUDGE`, `MEDIAN` (odd & even judge handling), `TRIMMED_MEAN` (Olympic scoring: dropping lowest and highest for 3+ judges), `CRITERION_WEIGHTED`, `ROUND_WISE`, and `AI_ASSISTED`
- [x] Add user-facing support for `MEDIAN` and `TRIMMED_MEAN` in organizer results UI (`OrganizerResultsPage.tsx`)
- [x] Implement immutable append-only score ledger in `scoringLedgerService.ts`: corrections create new adjustment records referencing `previousEntryId` and capturing `previousScore`
- [x] Enforce backend-only authority on official score ledger writes (`firestore.rules` Section 14); deny direct client writes
- [x] Implement deterministic tie-breaker resolution based on highest weighted criterion or fallback timestamp
- [x] Support identical ranking and tie flags (`isTied: true`) when true ties cannot be resolved
- [x] Enforce organizer approval for official publication; prevent automatic publication upon judge completion
- [x] Implement hidden and delayed leaderboards (`isLeaderboardHidden`, `leaderboardPublishDate`) in `resultsAndAnalyticsService.ts`
- [x] Author comprehensive test suite in `src/services/__tests__/phase9JudgeEvaluationScoringAndResults.test.ts` (19 tests covering all 12 core requirements, edge cases, and policy variations)
- [x] Verify complete test suite (382/382 unit/integration tests passing across 30 files, 32/32 emulator tests passing across 4 files, zero TypeScript errors in `tsc -b`, clean linter, and clean production build)

---

## Phase 10 Checklist (Legacy Cleanup, Simulation Governance & E2E Verification)

- [x] Inspect legacy files: `sandboxRunner.ts`, `api/evaluate-repo.ts`, `api/github/webhook.ts`, `api/webhook.ts`, `vite.config.ts`, `vercel.json`, `.vercelignore`, and PRison-Break Java grading / admin modules
- [x] Harden `src/services/sandboxRunner.ts`: declare untrusted code execution strictly `UNSUPPORTED` in production; default `sandboxEnvironmentConfigured = false`; remove fake `Compilation: OK` and passing test synthesizers; label test fixtures explicitly as `executionMode: 'SIMULATED'`; preserve test tampering detection and environment sanitization algorithms
- [x] Permanently remove deprecated Vercel API functions (`api/evaluate-repo.ts`, `api/github/webhook.ts`, `api/webhook.ts`) after verifying zero active dependencies
- [x] Strip legacy `githubWebhookDevPlugin` dev middleware from `vite.config.ts`
- [x] Permanently remove Vercel configuration files (`vercel.json`, `.vercelignore`) and local `.vercel/` cache folder (eliminating stale `VERCEL_OIDC_TOKEN`)
- [x] Update `package.json`: rename package from `"leaderboard"` to `"proofly"` and uninstall `@vercel/node` devDependency
- [x] Quarantine legacy PRison-Break admin pages (`src/pages/admin/*`) and components (`src/components/admin/*`), ensuring `src/App.tsx` strictly routes Proofly SaaS workspaces and redirects `/admin/*` to `/organizer`
- [x] Audit and classify all occurrences of Mock, Fake, Demo, Simulated, Placeholder, TODO, and FIXME across the repository in `docs/LEGACY_AUDIT_AND_SIMULATION_REGISTER.md`
- [x] Verify production integrity invariants: zero hardcoded scores, zero fake successful responses, zero silent fallbacks on writes, and zero plaintext token persistence
- [x] Author comprehensive Phase 10 test suite in `src/services/__tests__/phase10LegacyCleanupAndE2E.test.ts` (9 tests covering the complete 11-step end-to-end workflow, legacy sandbox safeguards, tampering detection, environment sanitization, and demo/mock governance)
- [x] Verify complete quality checks: `npx tsc -b --noEmit` (0 errors), `npm run lint` (0 errors), `npm test -- --run` (31 files / 391 tests passing 100%), `npm run test:rules` (4 files / 32 emulator tests passing 100%), and `npm run build` (clean Vite bundle)



