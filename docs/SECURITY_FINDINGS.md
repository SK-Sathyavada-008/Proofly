# Proofly — Security Findings & Secret Audit (Phase 00)

**Date:** 2026-11-18  
**Classification:** Internal Engineering Security Review  
**Secret Hygiene Guarantee:** Zero live secret values are recorded in this document or in execution logs.

---

## 1. Executive Summary

The Phase 00 audit identified **3 Critical (P0)**, **6 High (P1)**, **5 Medium (P2)**, and **2 Low (P3)** security findings.

**Most urgent finding (`SEC-001`):** A live GitHub Personal Access Token stored in `.env` under `VITE_GITHUB_TOKEN` was **statically inlined into the production frontend JavaScript bundle (`dist/assets/index-CoUB1ie7.js`)** because Vite serializes all `VITE_*` variables when `import.meta.env` is accessed dynamically (`src/config/firebase.ts:22`). That bundle was deployed publicly to Firebase Hosting (`https://prison-control.web.app`). **Immediate token revocation is required.**

---

## 2. Secret-Bearing Files & Frontend Credential Exposure Inventory

### 2.1 Files on Disk Containing Sensitive Material

| File Path | Git Status | Gitignored? | Contents Summary (Values Redacted) | Risk & Action |
|---|---|---|---|---|
| `.env` | Untracked | Yes (`.env` in `.gitignore`) | Contains 9 populated variables: 6 Firebase Web SDK config keys (`VITE_FIREBASE_*`), `VITE_FIREBASE_RECAPTCHA_SITE_KEY`, `GITHUB_TOKEN` (len 40), and **`VITE_GITHUB_TOKEN` (len 40)**. | **CRITICAL (`SEC-001`):** Remove `VITE_GITHUB_TOKEN` immediately; revoke the exposed GitHub PAT; remove `GITHUB_TOKEN` if unused by Firebase. |
| `.vercel/.env.production.local` | Untracked | Yes (`.vercel` and `*.local` in `.gitignore`) | Legacy Vercel pull artifact containing empty/2-char quoted placeholders plus **`VERCEL_OIDC_TOKEN` (len 1244)**. | **HIGH:** Legacy artifact from Vercel (unused in Proofly). Delete `.vercel/` locally after confirming no other project depends on it. |
| `dist/assets/index-CoUB1ie7.js` | Untracked | Yes (`dist` in `.gitignore`) | **Contains inlined live 40-char GitHub PAT (`ghp_...`)** alongside expected public Firebase Web API key (`AIzaSy...`). Currently deployed to `https://prison-control.web.app`! | **CRITICAL (`SEC-001`):** Revoke GitHub PAT immediately, remove `VITE_GITHUB_TOKEN` from `.env`, rebuild `dist/`, and redeploy Firebase Hosting. |
| `.env.example` | Tracked | No (intended template) | Cleaned in Phase 00 to contain ONLY safe Firebase placeholder strings. Zero live secrets. | Safe. |

### 2.2 Frontend Source Code References to Privileged `VITE_*` Variables

| File & Line | Variable Referenced | Exposure Mechanism |
|---|---|---|
| `src/config/firebase.ts:21–23` | `(import.meta as any).env` (whole object!) | **Root cause of bundle leak:** Accessing `import.meta.env` as a whole object causes Vite to serialize ALL `VITE_*` variables from `.env` into client JS even if the consuming service is dead/tree-shaken! |
| `src/services/aiValidationService.ts:46,101` | `import.meta.env.VITE_GITHUB_TOKEN` | Legacy frontend service reading privileged GitHub PAT in browser. |
| `src/services/aiValidationService.ts:106` | `import.meta.env.VITE_GEMINI_API_KEY` | Legacy frontend service reading server-only Gemini API key in browser. |
| `src/services/buildFromScratchService.ts:119` | `import.meta.env.VITE_GITHUB_TOKEN` | Legacy frontend service reading privileged GitHub PAT in browser. |
| `src/services/githubMergeService.ts:36` | `import.meta.env.VITE_GITHUB_TOKEN` | Legacy frontend service reading privileged GitHub PAT in browser. |
| `src/services/githubSyncService.ts:91` | `import.meta.env.VITE_GITHUB_TOKEN` | Legacy frontend service reading privileged GitHub PAT in browser. |
| `src/context/ProoflyAuthContext.tsx:119` | `import.meta.env.VITE_PLATFORM_ADMIN_EMAIL` | Exposes admin email in client bundle & grants client-side `SUPER_ADMIN` flag without verifying Firebase Auth custom claims. |

### 2.3 Git History Secret Audit (Read-Only Check)

- **Current repository (`SK-Sathyavada-008/Proofly`, `main` at `7d600c8`):**
  - `git log --all --oneline` contains **1 commit** (`7d600c8`).
  - `git ls-files` confirms `.env`, `.vercel/`, `*.pem`, `*.key`, and `*serviceAccount*` are **NOT tracked**.
  - Full-repo regex scan across `7d600c8` for `AIza[0-9A-Za-z_-]{35}`, `ghp_`, `gho_`, `github_pat_`, `sk-`, and `BEGIN .*PRIVATE KEY` returned **0 live secrets** (only synthetic test/doc placeholders `AIzaSyPlaceholderForPRisonBreakDevMode` in `docs/PROJECT_AUDIT.md:85` and `AIzaSyPrivateSecretKey123` in `src/services/__tests__/phase7SystemValidation.test.ts:839`).
  - **Hardcoded legacy password IS present in `7d600c8`:** `src/config/adminConfig.ts:11` (`password: '12345678'`) — see `SEC-002`.
- **Previously exposed legacy history (note on upstream/old repo):**
  - Prior to commit `7d600c8`, a legacy commit (`1aaeec92` from `SK-Sathyavada-008/PRison-Break`) contained the Firebase Web API key in `scripts/purgeFirestore.mjs#L5`, triggering GitHub Secret Scanning Alert #1 on `SK-Sathyavada-008/Proofly`.
  - Commit `1aaeec92` is no longer reachable from `SK-Sathyavada-008/Proofly` `main`, **however** GitHub retains previously pushed commit objects in cache until garbage collected, AND the legacy repository `SK-Sathyavada-008/PRison-Break` still contains that commit.
- **Exact Remediation Steps (Do NOT rewrite Git history automatically):**
  1. **Immediately revoke** the GitHub PAT currently in `.env` (`VITE_GITHUB_TOKEN` / `GITHUB_TOKEN`) at GitHub → Settings → Developer settings → Personal access tokens.
  2. **Restrict or rotate** the Firebase Web API key in Google Cloud Console → APIs & Services → Credentials (`prison-control`) with Website HTTP referrer restrictions (`https://prison-control.web.app/*`, `https://prison-control.firebaseapp.com/*`, `http://localhost:*/*`).
  3. Close GitHub Secret Scanning Alert #1 (`https://github.com/SK-Sathyavada-008/Proofly/security/secret-scanning/1`) after restricting/rotating the key.
  4. If `SK-Sathyavada-008/PRison-Break` is still public, either make it private or scrub its history separately with `git filter-repo` (never run history rewrites without explicit team coordination) and rotate any tokens ever pushed there.
  5. Delete `.vercel/.env.production.local` (or the entire `.vercel/` directory) locally so stale OIDC tokens are removed from disk.

---

## 3. Detailed Security Findings Register

### Critical (P0)

#### `SEC-001` — Live GitHub Personal Access Token Inlined in Public Production JS Bundle
- **Location:** `.env` (`VITE_GITHUB_TOKEN`), `src/config/firebase.ts:21–23`, deployed `dist/assets/index-CoUB1ie7.js` on `https://prison-control.web.app`.
- **Impact:** Anyone downloading the public JavaScript bundle from `https://prison-control.web.app` can extract the GitHub Personal Access Token and act with all scopes granted to that token (repo read/write, private repo access, etc.).
- **Remediation:**
  1. Immediately revoke the GitHub PAT in GitHub settings.
  2. Delete `VITE_GITHUB_TOKEN` from `.env`.
  3. Refactor `src/config/firebase.ts` to read ONLY explicit static properties (`import.meta.env.VITE_FIREBASE_API_KEY`, etc.) instead of copying the entire `import.meta.env` object.
  4. Remove all `VITE_GITHUB_TOKEN` and `VITE_GEMINI_API_KEY` references from frontend services.
  5. Rebuild (`npm run build`), verify `dist/assets/*.js` contains zero `ghp_`/`github_pat_` strings, and redeploy Firebase Hosting immediately.

#### `SEC-002` — Hardcoded Admin Password & Insecure Plaintext Credential Auth in Legacy Auth Module
- **Location:** `src/config/adminConfig.ts:8–12`, `src/services/authService.ts:104–160`.
- **Impact:** Hardcoded default password (`12345678`) for `unknown@prisonbreak.dev`, plaintext password check against Firestore `admin/credentials`, and client-side `sessionStorage` bypass (`prison_admin_session`). While currently unrouted in `App.tsx`, these files remain in the repository and risk re-introduction.
- **Remediation:** Quarantine and remove in the legacy cleanup phase; never store passwords or plaintext credentials in source code or Firestore.

#### `SEC-003` — Zero Real Authentication Enforcement in Proofly UI (Demo Organizer Auto-Login)
- **Location:** `src/context/ProoflyAuthContext.tsx:35–70, 170–175`.
- **Impact:** Every anonymous visitor automatically receives an active `Organizer` (`OWNER`) persona in React state and can toggle between Organizer and Judge via `loginDemoUser()` with no password or Firebase Auth token. Real Firestore security rules reject all writes (`request.auth == null`), silently pushing data into `localStorage` and masking the broken auth boundary.
- **Remediation:** Implement real Firebase Authentication (Email/Password + Google sign-in), require verified Firebase Auth sessions for `/organizer/*` and `/judge/*`, remove demo persona auto-login in production, and derive roles strictly from Firestore membership docs + Firebase Auth Custom Claims.

---

### High (P1)

#### `SEC-004` — Hardcoded Fake Firebase App Check Debug Provider in Client Code
- **Location:** `src/config/firebase.ts:101–113`.
- **Impact:** If `VITE_FIREBASE_RECAPTCHA_SITE_KEY` is missing or misconfigured, the client silently initializes a `CustomProvider` returning `'proofly-dev-app-check-debug-token'`. Production builds must fail closed or clearly warn rather than pretending App Check is active (`aiLogicService.ts:267` reports `ACTIVE_AND_VERIFIED` whenever `appCheck` is truthy, even in `DEV_DEBUG_FALLBACK`!).
- **Remediation:** Use official `self.FIREBASE_APPCHECK_DEBUG_TOKEN` strictly in local dev (`import.meta.env.DEV`), enforce `ReCaptchaV3Provider` in production, and reflect `appCheckMode` honestly in telemetry.

#### `SEC-005` — Cross-Tenant Storage Read Leak & Unbounded Anonymous Upload Abuse (`storage.rules`)
- **Location:** `storage.rules:30–41`.
- **Impact:**
  1. `allow read: if request.auth != null;` permits **any authenticated user from Organization A** to read **all uploaded submission files from Organization B** (cross-tenant data leak).
  2. `allow create: if isValidFileSize() && isValidSubmissionContentType() && hasSafeFileName(fileName);` allows **any unauthenticated internet user** to upload unlimited 25 MB files to arbitrary `competitionId`/`submissionId` paths without verifying an active competition, access session, or rate limit (storage exhaustion / billing abuse).
  3. Path mismatch: `storage.rules` matches `/competitions/{competitionId}/submissions/{submissionId}/{fileName}` while `fileStorageService.ts:288` builds `submissions/{competitionId}/{submissionId}/{fieldId}/{fileId}_{fileName}`.
- **Remediation:** Issue short-lived signed upload URLs (or enforce Firebase Auth custom claims / session tokens + Firestore existence checks via Cloud Functions) and enforce org/competition membership on Storage reads.

#### `SEC-006` — Anonymous Submission Creation Abuse & Public PII/Token Hash Exposure (`firestore.rules`)
- **Location:** `firestore.rules:117–145`.
- **Impact:**
  1. `allow create` on `/submissions/{submissionId}` does **not** verify that `competitionId` exists, is `ACTIVE`, matches a valid non-revoked access key, or respects submission deadlines/caps. Any bot can flood Firestore with arbitrary submissions.
  2. `allow read` on published submissions (`resource.data.officialResult == 'APPROVED' && getCompetitionDoc(...).status == 'PUBLISHED'`) exposes the **entire submission document** to the public, including `primaryContactEmail`, participant emails, and `managementTokenHash`!
- **Remediation:** Route anonymous submission creation and management-token updates through Firebase Cloud Functions (with App Check + server-side rate limiting + access-key validation), and publish a sanitized public leaderboard projection containing zero PII or token hashes.

#### `SEC-007` — Client-Writable Scoring Ledger & Governance Audit Logs (`firestore.rules` + Client Services)
- **Location:** `firestore.rules:241–260, 283–294`; `src/services/scoringLedgerService.ts:71–75`.
- **Impact:**
  1. `firestore.rules` permits any authenticated judge client to directly `create` documents in `/scoringLedger` with `source: 'AI'` or arbitrary `actorId`/`evaluationId`, bypassing server authority.
  2. In client code, `authorizedSource` is a TypeScript parameter checked only in browser JS — trivially spoofable from DevTools.
  3. Currently, `scoringLedgerService`, `judgeAssignmentService`, `governanceAuditService`, and `resultsAndAnalyticsService` do not write to Firestore at all (`localStorage`-only), meaning any user can edit official scores/audit logs directly in browser `localStorage`!
- **Remediation:** Deny direct client writes to `/scoringLedger`, `/resultPublications`, and `/governanceAuditLogs` (`allow write: if false;`), and perform all score ledger appends, result calculations, and audit writes exclusively inside Firebase Cloud Functions using Admin SDK.

#### `SEC-008` — Missing Firestore Security Rules for Active Collections (`evaluationJobs`, `teams`, `participants`, `auditLogs`)
- **Location:** `firestore.rules` vs `evaluationQueueService.ts`, `participantTeamService.ts`, `auditLogService.ts`.
- **Impact:** Because these collections have no `match` block in `firestore.rules`, they hit the catch-all `allow read, write: if false`. Services silently swallow the `permission-denied` error and pretend writes succeeded in memory.
- **Remediation:** Define explicit tenant-scoped rules (or server-only Cloud Functions access) for every active collection and eliminate silent error swallowing.

#### `SEC-009` — Weak Authorization on `formSchemas` Writes & Broken Delete Rule (`firestore.rules`)
- **Location:** `firestore.rules:151–154`.
- **Impact:** `allow write: if isAuthenticated() && isOrgMember(getCompetitionOrgId(request.resource.data.competitionId));` allows a basic `MEMBER` (not just `OWNER`/`ADMIN`/`ORGANIZER`) to overwrite submission forms, and fails on `delete` where `request.resource` is null.
- **Remediation:** Split into `create`/`update` vs `delete` requiring `canManageCompetition(...)`.

---

### Medium (P2)

#### `SEC-010` — Client-Side-Only Rate Limiting & Ephemeral Access Sessions
- **Location:** `src/services/accessManagementService.ts:29–50`.
- **Impact:** `failedAttemptTimestamps` and `localActiveSessions` live in browser JS memory. Brute-forcing access codes is trivial by refreshing the tab or calling Firestore directly.
- **Remediation:** Enforce access-code/token validation and rate limiting in Firebase Cloud Functions backed by Firestore/App Check.

#### `SEC-011` — Management Tokens Passed in URL Query Strings
- **Location:** `src/pages/participant/ParticipantSubmissionManagePage.tsx:32–33`, `src/services/accessManagementService.ts:168`.
- **Impact:** Raw submission tokens and individual invite tokens appear in `?token=...` URL query parameters, which leak into browser history, proxy logs, and `Referer` headers (mitigated partially by `Referrer-Policy: strict-origin-when-cross-origin` in `firebase.json`, but still logged in browser history).
- **Remediation:** Prefer URL hash fragments (`#token=...`) or immediate `history.replaceState` stripping after exchanging the token for a short-lived server session.

#### `SEC-012` — `Math.random()` Fallback & Weak ID Generation
- **Location:** `src/utils/cryptoUtils.ts:15–17`, `src/services/submissionService.ts:46`, `src/services/fileStorageService.ts:287`, `src/services/competitionService.ts:96`.
- **Impact:** Public access codes (`PF-XXXXXX`) and reference IDs use `Math.random()` (non-CSPRNG, low entropy); `generateSecureToken` falls back silently to `Math.random()` if `crypto.getRandomValues` is missing instead of throwing.
- **Remediation:** Throw if CSPRNG is unavailable and use `crypto.getRandomValues` for access codes and reference IDs.

#### `SEC-013` — Client-Side `SUPER_ADMIN` Email Check (`VITE_PLATFORM_ADMIN_EMAIL`) & Hardcoded `root@proofly.internal`
- **Location:** `src/context/ProoflyAuthContext.tsx:118–122`, `firestore.rules:13–18`.
- **Impact:** Email-based super-admin detection on client is fragile and leaks operator email if set in `VITE_*`; `root@proofly.internal` in `firestore.rules` should be replaced strictly with verified Firebase Auth Custom Claims (`request.auth.token.platformRole == 'SUPER_ADMIN'`).

#### `SEC-014` — Missing Content-Security-Policy (CSP) Header in `firebase.json`
- **Location:** `firebase.json:9–18`.
- **Impact:** `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` are configured, but no `Content-Security-Policy` or `Strict-Transport-Security` header is present to defend against XSS / script injection.

---

### Low (P3)

#### `SEC-015` — Legacy Vercel Serverless Endpoints & Dev Middleware Still Present
- **Location:** `api/evaluate-repo.ts`, `api/github/webhook.ts`, `api/webhook.ts`, `vite.config.ts:5–60`, `vercel.json`.
- **Impact:** `api/evaluate-repo.ts` accepts unauthenticated `POST` requests with no auth/signature check; `vite.config.ts` mounts `/api/webhook` locally in dev server. Unused under Firebase architecture and increases attack/maintenance surface.

#### `SEC-016` — `fileStorageService.ts` Partial Checksum & Unsanitized SVG/HTML-in-Text Risks
- **Location:** `src/services/fileStorageService.ts:299–301`.
- **Impact:** Checksum hashes only the first 1,024 bytes (allowing post-header payload tampering without changing checksum). Ensure full-buffer SHA-256 and `Content-Disposition: attachment` when serving uploaded artifacts from Cloud Storage.
