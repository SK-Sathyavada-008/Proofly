# Proofly / Evalora — Security Architecture & Controls

## 1. Multi-Tenant & Competition-Scoped Authorization

Proofly enforces strict tenant isolation and competition-scoped RBAC (`src/services/scopedAuthService.ts` and `firestore.rules`):
* **No global `isAdmin` boolean**: Privileges are evaluated per organization (`OWNER`, `ADMIN`, `MEMBER`) and per competition (`COMPETITION_ADMIN`, `ORGANIZER`, `JUDGE`).
* A user can simultaneously be an **Organizer** in Competition A and a **Judge** in Competition B with zero cross-competition privilege escalation.
* Cross-tenant reads and writes are denied by both `scopedAuthService.assertTenantIsolation` and Firestore rules.

---

## 2. Firestore Security Rules (`firestore.rules`)

| Collection | Security Policy |
| :--- | :--- |
| `organizations/{orgId}` | Read by org members only; write by org `OWNER`/`ADMIN` only. |
| `competitions/{id}` | Public/unlisted read for intake; create/update/delete restricted to org admins or competition organizers. |
| `submissions/{id}` | Zero-account `create` allowed with strict schema validation (`competitionId`, `projectTitle`, 64-char SHA-256 `managementTokenHash`, valid `submissionType`, and **prohibits** client injection of `officialResult`, `aiFailureOverride`, or `Evaluated` status). Judges can read only after AI evaluation completes (or authorized organizer override). |
| `aiEvaluationReports/{id}` | Strictly immutable (`allow update, delete: if false`). |
| `rubricVersions/{id}` | Strictly immutable (`allow update, delete: if false`). |
| `judgeAssignments/{id}` | Scoped to assigned judge or competition organizer; judges cannot reassign or change `submissionId`. |
| `humanEvaluations/{id}` | Judges read/edit only their own unlocked drafts; once `isLocked == true`, judges cannot modify — only organizers may reopen with a logged audit reason. Delete is forbidden. |
| `scoringLedger/{id}` | Strictly append-only (`allow update, delete: if false`). Direct frontend client tampering is blocked in both service logic and rules. |
| `resultPublications/{id}` | Public read **only** when `status == 'PUBLISHED'`. Write restricted to competition organizers. |
| `governanceAuditLogs/{id}` | Strictly append-only (`allow update, delete: if false`). |
| `/{document=**}` | Default deny-all catch-all (`allow read, write: if false`). |

---

## 3. Firebase Storage Rules & File Upload Validation

* **Client + Service Validation (`fileStorageService.ts`)**: Inspects file magic bytes (blocking Windows PE `MZ`, ELF, Mach-O executables even if renamed to `.pdf` or `.ppt`), enforces allowed extensions, rejects 0-byte files, and caps file sizes (default 25 MB).
* **Storage Rules (`storage.rules`)**: Enforces scoped path `/competitions/{competitionId}/submissions/{submissionId}/{fileName}`, size `0 < size <= 25 MB`, safe MIME allowlist, executable filename regex denylist, authenticated reads only, and disables silent overwrite/delete.

---

## 4. Zero-Account Submission Abuse Controls & Cryptographic Tokens

* **Cryptographic Management Tokens (`cryptoUtils.ts`, `submissionService.ts`)**: Each submission generates a high-entropy random management token (`sec_<64 hex>`). The raw token is returned **once** to the submitter and **never** stored in Firestore or memory — only its SHA-256 hash (`managementTokenHash`) is saved, verified via constant-time comparison (`timingSafeEqualStrings`).
* **Single-Use & Expiring Access Links (`accessManagementService.ts`)**: Individual links store only SHA-256 token hashes, support expiration timestamps, revocation, and submission caps.
* **Brute-Force Rate Limiting (`accessManagementService.ts`)**: Enforces a sliding-window limit (10 failed access-code/token attempts per 60-second window per target competition) to throttle anonymous enumeration.

---

## 5. App Check, Secret Handling & Hosting Headers

* **Firebase App Check (`src/config/firebase.ts`)**: Uses `ReCaptchaV3Provider` when `VITE_FIREBASE_RECAPTCHA_SITE_KEY` is configured in production, protecting Firebase AI Logic, Firestore, and Storage.
* **Secret Hygiene**:
  * No live API keys, private service account JSONs, or personal admin emails are committed in source code.
  * Server-only credentials (`GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `GEMINI_API_KEY`) are never prefixed with `VITE_` and are isolated to server-side functions.
  * `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*firebase-adminsdk*.json`, `serviceAccountKey*.json`, `*.pem`, `*.key`, and `firebase-debug.log*`.
* **HTTP Security Headers (`firebase.json`)**: Configures `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and restrictive `Permissions-Policy`.

---

## 6. Immutable Governance Audit Logging

`governanceAuditService.ts` maintains an append-only, frozen audit log recording:
* `SCORE_CHANGE` (ledger adjustments & authorized overrides)
* `EVALUATION_SUBMISSION` (finalized human scorecards)
* `ASSIGNMENT_CHANGE` (judge allocations & reassignments with reason)
* `PUBLICATION_ACTION` (official publish & unpublish approvals)
* `REOPENED_EVALUATION` (organizer-authorized reopening of locked scorecards)
* `ADMIN_OVERRIDE` (AI-failure overrides & authorized score corrections)
* `POLICY_CHANGE` (scoring aggregation & tie-breaker updates)
