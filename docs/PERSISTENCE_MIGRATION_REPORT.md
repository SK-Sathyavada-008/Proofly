# Proofly — Phase 04 Durable Firestore Persistence & Migration Report

**Date:** 2026-11-18  
**Migration Policy:** Non-destructive. **Existing browser `localStorage` data is NEVER deleted or overwritten automatically.**

---

## 1. Repository-Wide `localStorage`, `sessionStorage` & Silent-Fallback Audit

Every service in `src/` was inspected for browser storage persistence, in-memory database fallbacks, and silent `try/catch` blocks that masked Firestore write failures.

### Authoritative Business Services Repaired (Removed `localStorage` Primary Store & Silent Write Fallbacks)

| Service File | Previous Defect | Phase 04 Durable Firestore Implementation |
|---|---|---|
| `src/services/organizationService.ts` | Dual-wrote to `proofly_organizations_v1` & `proofly_org_members_v1` in `localStorage`; swallowed Firestore write errors; created colliding `'org-workspace'` IDs; had no settings persistence | Atomic `writeBatch` creation of `organizations/{orgId}` + `organizations/{orgId}/members/{ownerId}` (verified via `existsAfter`/`getAfter` in `firestore.rules`); `updateOrganizationSettings()`, atomic `transferOwnership()` transaction, paginated `listMembersPaginated()` & `listAssociatedCompetitions()`, `serverTimestamp()`, explicit `PersistenceError` on failure. Only harmless UI preference `proofly_active_org_id` remains in `localStorage`. |
| `src/pages/organizer/OrganizerSettingsPage.tsx` | Fake `handleSave` toast with zero persistence | Wired directly to `organizationService.updateOrganizationSettings()` with loading indicator, explicit Firestore error banner, and input preservation on failure. |
| `src/services/judgeAssignmentService.ts` | 100% `localStorage`-backed (`proofly_judges`, `proofly_judge_assignments`, `proofly_human_evaluations`) with zero Firestore calls; non-canonical IDs (`asgn-...`, `heval_...`); auto-purged `localStorage` on import | Full Firestore persistence across `judgeProfiles/{judgeId}`, canonical `judgeAssignments/{submissionId}_{judgeId}` (matching `firestore.rules` & `storage.rules`), and `humanEvaluations/{submissionId}_{judgeId}` (preventing cross-judge draft overwrites). Uses Firestore `runTransaction` for assignment, conflict declaration, draft save, atomic final submission+lock+assignment completion, and organizer reopen with mandatory reason & `reopenHistory`. Bounded pagination via `limit()` / `startAfter()`. |
| `src/services/scoringLedgerService.ts` | 100% `localStorage`-backed (`proofly_scoring_ledger_v1`) | Routed through `trustedBackendPersistence.ts` transactional writer (`scoreContributions` + `scoringLedger`) with deterministic idempotency keys (`sc_{evalId}_{critId}_{source}`) preventing duplicate contributions, mandatory `previousEntryId` linkage for auditable adjustments, `serverTimestamp()`, and paginated Firestore queries. Historical contributions are NEVER overwritten. Direct untrusted client writes are rejected by `firestore.rules` with `PersistenceError(PERMISSION_DENIED)`. |
| `src/services/resultsAndAnalyticsService.ts` | 100% `localStorage`-backed (`proofly_scoring_policies_v1`, `proofly_results_publications_v1`); demo seeder ran automatically in UI | Scoring policies persisted durably to `scoringPolicies/{competitionId}`; official publications & immutable versioned snapshots persisted via `trustedBackendPersistence.ts` to `leaderboardSnapshots/{compId}_v{n}` + `resultPublications/{compId}`; `getPublicLeaderboardFromFirestore()` & `listLeaderboardSnapshotsPaginated()` read directly from Firestore; `computeCompetitionAnalytics()` derives all metrics from live stored Firestore collections; demo seeder gated strictly behind non-prod `isDemoModeEnabled()`. |
| `src/services/governanceAuditService.ts` & `src/services/auditLogService.ts` | `governanceAuditService` was 100% `localStorage`-backed (`proofly_governance_audit_v1`); `auditLogService` silently returned in-memory arrays on Firestore error | Append-only Firestore persistence via `trustedBackendPersistence.ts` (`governanceAuditLogs` + `auditLogs`) with `serverTimestamp()`, transaction duplicate checks, bounded pagination, and zero client edit/delete (`firestore.rules` strictly enforces `allow create, update, delete: if false` for untrusted clients). |
| `src/services/competitionService.ts` | Swallowed Firestore write failures into `proofly_competitions_v1` & `proofly_competition_roles_v1`; unbounded `getDocs()` | Durable Firestore reads/writes with `serverTimestamp()`, bounded `limit()` / `startAfter()` pagination, explicit `PersistenceError` on failure, zero `localStorage` fallback. |
| `src/services/submissionService.ts` | Swallowed Firestore write failures into `proofly_submissions_v1`; unbounded `getDocs()` | Durable Firestore reads/writes with `serverTimestamp()`, bounded cursor pagination (`listAllSubmissionsPaginated`, `listCompetitionSubmissionsPaginated`), explicit `PersistenceError` on failure. |
| `src/services/formBuilderService.ts` | Swallowed Firestore errors into `proofly_form_schemas_v1` | Durable Firestore reads/writes with `serverTimestamp()`, bounded `limit()`, explicit `PersistenceError` on failure. |
| `src/services/accessManagementService.ts` | Swallowed Firestore errors into `proofly_access_keys_v1` | Durable Firestore reads/writes to `accessKeys` with `organizationId`, `serverTimestamp()`, bounded `limit()`, explicit `PersistenceError` on failure. |
| `src/services/participantTeamService.ts` | Swallowed Firestore errors into `memTeams` / `memParticipants` | Durable Firestore reads/writes to `teams` & `participants` with `serverTimestamp()`, bounded `limit()`, explicit `PersistenceError` on failure. |
| `src/services/evaluationPipelineService.ts` & `src/services/evaluationQueueService.ts` | Swallowed Firestore errors into `memReports` / `memJobs` | Durable Firestore reads/writes to `aiEvaluationReports` & `evaluationJobs` with `serverTimestamp()`, bounded `limit()`, explicit `PersistenceError` on failure. |

### Remaining Allowed Browser Storage Keys (UI Preferences & Legacy Non-Proofly)

| File | Key | Category | Status |
|---|---|---|---|
| `src/context/ThemeContext.tsx` | `proofly_theme` | Harmless UI preference (Light/Dark theme) | Allowed |
| `src/services/organizationService.ts` | `proofly_active_org_id` | Harmless UI preference (active workspace selector) | Allowed |
| `src/services/autoSyncService.ts` | `PRISON_AUTOSYNC_INTERVAL` | Legacy PRison-Break UI polling interval preference | Allowed (legacy) |
| `src/services/authService.ts` | `sessionStorage` (`prison_break_session`) | Legacy PRison-Break admin session (deprecated; Proofly uses Firebase Auth via `ProoflyAuthContext.tsx`) | Scheduled for removal in legacy cleanup phase |

---

## 2. Controlled Non-Destructive Migration Process

Use `localStorageMigrationService` (`src/services/localStorageMigrationService.ts`):

1. **Inspect (Read-Only):**
   ```ts
   const audit = localStorageMigrationService.inspectLegacyLocalStorage();
   ```
   Reports every legacy `proofly_*` key present in the browser and its record count without modifying or deleting anything.
2. **Dry-Run Controlled Migration:**
   ```ts
   const preview = await localStorageMigrationService.migrateOwnedRecordsToFirestore({
     actorUid: currentUser.uid,
     actorEmail: currentUser.email,
     actorDisplayName: currentUser.displayName,
     dryRun: true,
   });
   ```
3. **Execute Controlled Migration:**
   - Validates ownership (`org.ownerId === actorUid`) before migrating organizations, competitions, and scoring policies.
   - Checks Firestore (`getDoc`) before writing so existing documents are skipped as `SKIPPED_DUPLICATE` (idempotent).
   - Preserves original `localStorage` keys intact so no historical browser state is lost.
   - Backend-only collections (`submissions`, `scoreContributions`, `governanceAuditLogs`, `resultPublications`) are classified as `ADMIN_BACKEND_IMPORT_ONLY` and cannot be forged from the browser client.
