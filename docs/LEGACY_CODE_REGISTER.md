# Proofly — Legacy Code & Unused Integrations Register (Phase 00)

**Date:** 2026-11-18  
**Policy:** Per Phase 00 restrictions, **none of the files below have been deleted yet**. This register inventories legacy artifacts inherited from the older **PRison-Break** (GitHub PR / Java CTF leaderboard) project and **Vercel** deployment setup, explaining why each is safe to remove in a dedicated cleanup phase (Phase 01 / Phase 07) and noting any test dependencies that must be retired or migrated alongside them.

---

## 1. Legacy Vercel Deployment Artifacts (Strictly Unused Under Firebase Architecture)

| Path | Description | Reachable from `src/App.tsx`? | Safe to Remove? | Cleanup Notes |
|---|---|---|---|---|
| `vercel.json` | Vercel build & `/api/*` rewrite config | No | **Yes** | Replaced by `firebase.json` Hosting rewrites. |
| `.vercelignore` | Vercel upload ignore file | No | **Yes** | Unused on Firebase Hosting. |
| `.vercel/` (incl. `.vercel/.env.production.local`) | Local Vercel CLI link & pulled OIDC token (untracked) | No | **Yes (Immediate)** | Delete locally to remove stale `VERCEL_OIDC_TOKEN` from disk. |
| `api/evaluate-repo.ts` | Unauthenticated Vercel serverless endpoint for PRison-Break GitHub repo evaluation (reads `VITE_GITHUB_TOKEN` / `VITE_GEMINI_API_KEY`) | No | **Yes** | Legacy PRison-Break feature; Proofly uses Firebase AI Logic + Firebase Cloud Functions. |
| `api/github/webhook.ts` | Vercel serverless GitHub App webhook handler for PRison-Break PR scoring | No | **Yes** | Legacy PRison-Break workflow; not part of Proofly. |
| `api/webhook.ts` | Alias forwarding `/api/webhook` → `./github/webhook.js` | No | **Yes** | Remove with `api/github/webhook.ts`. |
| `vite.config.ts` (`githubWebhookDevPlugin`, L5–60) | Dev middleware mounting `/api/github/webhook` & `/api/webhook` | Dev server only | **Yes** | Strip plugin from `vite.config.ts` when removing `api/`. |
| `package.json` (`@vercel/node` devDependency) | Type definitions for legacy `api/*.ts` | No | **Yes** | Uninstall after removing `api/`. Also rename `"name": "leaderboard"` → `"proofly"`. |

---

## 2. Legacy PRison-Break Pages, Layouts & Components (Unreachable from `src/App.tsx`)

`src/App.tsx` redirects `/admin/*` directly to `/organizer` and never imports any file below.

| Directory / File | Description | Safe to Remove? | Cleanup Notes |
|---|---|---|---|
| `src/pages/admin/*` (12 files: `AdminLayout.tsx`, `AdminLeaderboardPage.tsx`, `DashboardPage.tsx`, `EvaluationCenterPage.tsx`, `FacultyScoresPage.tsx`, `ParticipantsPage.tsx`, `PullRequestsPage.tsx`, `RepositoriesPage.tsx`, `ScoreEventsPage.tsx`, `SettingsPage.tsx`, `TeamsPage.tsx`, `WebhookEventsPage.tsx`) | Complete legacy PRison-Break admin dashboard for GitHub PRs, Java challenges, and warden controls | **Yes** | Zero imports from active Proofly routes. |
| `src/pages/LeaderboardPage.tsx` | Legacy PRison-Break public leaderboard | **Yes** | Replaced by `src/pages/PublicLeaderboardPage.tsx`. |
| `src/components/admin/*` (`AdminLogin.tsx`, `BonusXPModal.tsx`, `TeamSizeModal.tsx`) | Legacy Warden login screen & XP/team-size modals | **Yes** | Replaced by Proofly Auth & Organizer console. |
| `src/components/auth/AdminRoute.tsx` | Legacy route guard tied to `src/context/AuthContext.tsx` | **Yes** | Replaced by Proofly scoped auth route guards. |
| `src/components/dashboard/StatCard.tsx` | Legacy dashboard stat card | **Yes** | Unused in Proofly pages. |
| `src/components/layout/OrganizerSidebar.tsx`, `OrganizerTopNav.tsx`, `Sidebar.tsx`, `TopBar.tsx` | Legacy layout chrome (verify none imported by `OrganizerLayout.tsx` before removal) | **Verify before delete** | `ProoflyGlobalHeader.tsx` + `OrganizerLayout.tsx` handle current nav. |
| `src/components/leaderboard/*` (5 files: `AwardsShowcase.tsx`, `EventMilestoneStatusBar.tsx`, `LeaderboardTable.tsx`, `Podium.tsx`, `TeamDetailModal.tsx`) | Legacy PRison-Break podium & awards UI | **Yes** | Replaced by `PublicLeaderboardPage.tsx` + `OrganizerResultsPage.tsx`. |
| `src/components/participants/*` (`ParticipantProfileModal.tsx`, `ParticipantTable.tsx`) | Legacy GitHub participant views | **Yes** | Replaced by `SubmissionListPage.tsx` teams/participants tab. |
| `src/components/pull-requests/*` (3 files) | Legacy GitHub PR review & sync modals | **Yes** | Not part of Proofly. |
| `src/components/repositories/*` (3 files) | Legacy GitHub repo management cards/tables | **Yes** | Not part of Proofly. |
| `src/components/score-events/ScoreEventTable.tsx` & `src/components/scoring/ScoreTransparencyCard.tsx` | Legacy XP score event & transparency cards | **Yes** | Replaced by Phase 8 Scoring Ledger & Results console. |

---

## 3. Legacy PRison-Break Context, Config, Data & Services

| Path | Description | Security / Risk | Safe to Remove? | Coupled Legacy Tests to Retire/Update |
|---|---|---|---|---|
| `src/config/adminConfig.ts` | Hardcoded legacy password (`12345678`) & `prisonbreak.dev` allowlist | **CRITICAL (`SEC-002`)** | **Yes** | None in Proofly core. |
| `src/context/AuthContext.tsx` & `src/services/authService.ts` | Legacy Warden login (`sessionStorage` + plaintext Firestore `admin/credentials`) | **CRITICAL (`SEC-002`)** | **Yes** | None in Proofly core. |
| `src/services/aiValidationService.ts` | Legacy PRison-Break PR AI judge (reads `VITE_GITHUB_TOKEN` & `VITE_GEMINI_API_KEY`) | **CRITICAL (`SEC-001`)** | **Yes** | `offlinePRValidation.test.ts`, `regression.test.ts` |
| `src/services/buildFromScratchService.ts` | Legacy PRison-Break hackathon repo evaluator (reads `VITE_GITHUB_TOKEN`) | **CRITICAL (`SEC-001`)** | **Yes** | `buildFromScratchHackathon.test.ts`, `studentHostelAllocationEvaluation.test.ts` |
| `src/services/githubMergeService.ts` & `src/services/githubSyncService.ts` | Legacy GitHub PR sync/merge services (read `VITE_GITHUB_TOKEN`) | **CRITICAL (`SEC-001`)** | **Yes** | `regression.test.ts`, `userTestingRepoScoring.test.ts` |
| `src/services/javaGradingEngine.ts`, `javaSolutionEvaluator.ts`, `sandboxRunner.ts`, `challengeImportService.ts`, `offlinePRValidationService.ts`, `prValidationPipeline.ts` | Legacy Java challenge AST/regex grading & PR validation pipeline | Low (bloat/warnings) | **Yes** | `javaGradingEngine.test.ts`, `referenceAwareGradingAndBonus.test.ts`, `offlinePRValidation.test.ts` |
| `src/services/scoringEngine.ts`, `scoreEventService.ts`, `scoreReconciliationService.ts`, `bonusService.ts`, `facultyEvaluationService.ts`, `eventConfigService.ts` | Legacy PRison-Break XP & faculty scoring services | Low (duplicate services) | **Yes** | `eventConfigurationAndAudit.test.ts`, `teamLeaderboardAndAwards.test.ts`, `multiAccountTeamScoring.test.ts`, `phase7SystemValidation.test.ts` |
| `src/services/issueService.ts`, `participantService.ts`, `pullRequestService.ts`, `repositoryService.ts`, `teamService.ts`, `webhookEventService.ts`, `autoSyncService.ts`, `seedService.ts` | Legacy PRison-Break Firestore CRUD & auto-sync services | Low (duplicate services) | **Yes** | Legacy PRison-Break test suites above |
| `src/services/auditLogService.ts` | Legacy `auditLogs` service still imported by `governanceAuditService.ts` | Medium (writes to unruled `auditLogs` collection) | **After decoupling** | Decouple `governanceAuditService.ts` to write directly to `governanceAuditLogs` (via Cloud Functions) before deleting. |
| `src/data/challengeCatalog.ts`, `src/data/mockData.ts`, `src/data/testSquads.ts` | Legacy PRison-Break Java problem catalog & mock teams | None | **Yes** | Legacy PRison-Break tests |
| `src/design-system/mockDesignData.ts` | Early Phase 2 UI mockup fixtures | None | **Yes (verify zero imports)** | Currently 0 active UI imports (cleaned prior to Phase 00). |
| `src/types/index.ts` | Legacy PRison-Break domain types (`Team`, `PullRequest`, `Repository`, `ScoreEvent`, `AdminAuditLog`) | None | **After decoupling** | Still referenced by `auditLogService.ts` and legacy services/tests. |

---

## 4. Legacy Scripts & Local Directories

| Path | Description | Safe to Remove? | Notes |
|---|---|---|---|
| `scripts/generateCatalog.cjs` | Generates legacy PRison-Break Java challenge catalog | **Yes** | Legacy PRison-Break tool. |
| `scripts/simulateBurst150.cjs`, `scripts/simulatePRScale.cjs`, `scripts/testSimulation.cjs` | Legacy PRison-Break PR burst load simulators | **Yes** | Legacy PRison-Break tools. |
| `scripts/purgeFirestore.mjs` | Purges legacy PRison-Break Firestore collections (`teams`, `issues`, `pullRequests`, `webhookEvents`, etc.) | **Yes (or rewrite for Proofly)** | Hardcoded API key already removed before Phase 00; collections list is 100% legacy PRison-Break. |
| `repoissies/` (gitignored) | Local confidential challenge solutions folder from PRison-Break | **Yes (Owner verify)** | Untracked/gitignored; not used by Proofly. |
| `scratch/` (gitignored) | Temporary scratch directory | **Yes** | Untracked/gitignored. |

---

## 5. Summary of Active Proofly Core (Retain & Harden)

- **Active Config & Context:** `src/config/firebase.ts`, `src/context/ProoflyAuthContext.tsx`, `src/context/ThemeContext.tsx`
- **Active Layouts & Pages:** `src/App.tsx`, `src/main.tsx`, `src/layouts/*`, `src/pages/LandingHubPage.tsx`, `src/pages/AiLogicTestPage.tsx`, `src/pages/PublicLeaderboardPage.tsx`, `src/pages/organizer/*`, `src/pages/judge/*`, `src/pages/participant/*`
- **Active UI & Feature Components:** `src/components/ui/*`, `src/components/layout/ProoflyGlobalHeader.tsx`, `src/components/forms/*`, `src/components/evaluation/AiEvaluationReportView.tsx`, `src/components/submission/SubmissionConfirmationView.tsx`
- **Active Services:** `organizationService.ts`, `competitionService.ts`, `competitionLifecycleService.ts`, `scopedAuthService.ts`, `formBuilderService.ts`, `formValidationService.ts`, `accessManagementService.ts`, `submissionService.ts`, `submissionLifecycleService.ts`, `participantTeamService.ts`, `fileStorageService.ts`, `contentExtractionService.ts`, `rubricEngineService.ts`, `aiLogicService.ts`, `evaluationPipelineService.ts`, `evaluationQueueService.ts`, `judgeAssignmentService.ts`, `scoringLedgerService.ts`, `resultsAndAnalyticsService.ts`, `governanceAuditService.ts`
- **Active Types & Utils:** `src/types/{authAndCompetition,formAndAccess,submission,aiEvaluation,judgeAndEvaluation,scoringAndResults}.ts`, `src/utils/{cryptoUtils,firestoreUtils,cleanSampleStorage,githubUrl}.ts`
- **Active Proofly Test Suites (11 of 25):** `hybridAiLogic.test.ts`, `roleAndTenantIsolation.test.ts`, `submissionFormAndAccess.test.ts`, `anonymousParticipantSubmission.test.ts`, `multiFileUploadAndJudgeSelection.test.ts`, `aiEvaluationEngine.test.ts`, `domainAwareEvaluation.test.ts`, `trackRelevanceAndDifferentiatedEvaluation.test.ts`, `sampleProjectsEvaluationVerification.test.ts`, `judgeManagementAndEvaluationWorkspace.test.ts`, `phase8ScoringResultsAndAnalytics.test.ts`, `phase9ProductionReadinessAndReliability.test.ts`, `comprehensiveCornerCases.test.ts`, `exhaustiveSystemAuditAndCornerCases.test.ts` (14 Proofly suites; 11 legacy PRison-Break suites).
