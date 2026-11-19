# Proofly — File Storage Migration & Legacy Artifact Report (Phase 03)

**Date:** 2026-11-18  
**Migration Policy:** Non-destructive inspection only. **Old records are NOT deleted automatically**, and Proofly **never pretends ephemeral browser `blob:` URLs can be recovered**.

---

## 1. Root Cause of Legacy Unrecoverable Artifacts

Prior to Phase 03, `src/services/fileStorageService.ts` did **not** invoke Firebase Storage (`firebase/storage`). Instead, `uploadFile()`:
1. Constructed a non-tenant path `submissions/{competitionId}/{submissionId}/{fieldId}/{fileId}_{fileName}` (which did not match `storage.rules`).
2. Computed a partial checksum over only the first 1,024 bytes.
3. Returned an ephemeral `blob:` URL (`URL.createObjectURL(blob)`) or synthetic placeholder `https://storage.proofly.internal/...` and marked `isVerified: true`.

Because browser `blob:` URLs exist strictly inside the originating tab's volatile RAM, **those file bytes are permanently unrecoverable once the tab closes or on any other device**.

---

## 2. Repository & Seed Data Metadata Audit

Inspection of all file metadata records across the repository and storage schema:

| Source | Artifact / Pattern | Classification | Recoverable? | Required Action |
|---|---|---|---|---|
| Legacy browser submissions (`proofly_submissions_v1` in `localStorage` or Firestore docs created before Phase 03) | `downloadUrl` starting with `blob:` | `UNRECOVERABLE_BLOB_URL` | **No** | Participant must re-upload via Phase 03 Firebase Storage uploader. UI now displays `"Re-upload required"` badge instead of a broken link. |
| Legacy offline/SSR fallback submissions | `downloadUrl` containing `storage.proofly.internal` | `UNRECOVERABLE_INTERNAL_PLACEHOLDER` | **No** | Participant must re-upload. |
| Test/seed fixture records in `src/services/seedDataService.ts` (L465, L746, L930, L999) | `https://storage.googleapis.com/proofly/...` & path `competitions/comp-global-ai/...` | `UNRECOVERABLE_INTERNAL_PLACEHOLDER` / `LEGACY_PATH_REQUIRES_MIGRATION` | **No** (synthetic test fixtures, disabled at runtime) | Leave untouched for unit tests; never used in live production workspaces. |
| Legacy path format (`submissions/...` or `competitions/...`) without `organizations/{orgId}/...` | Missing canonical tenant prefix | `LEGACY_PATH_REQUIRES_MIGRATION` | Only if bytes exist in GCS bucket (none exist on `prison-control` because Firebase Storage has not yet been initialized) | Re-upload under canonical path `organizations/{organizationId}/competitions/{competitionId}/submissions/{submissionId}/{fileId}_{sanitizedName}`. |
| New Phase 03 uploads | `organizations/{orgId}/competitions/{compId}/submissions/{subId}/{fileId}_{name}`, `uploadStatus: 'UPLOADED'`, `isVerified: true`, 64-char full-file SHA-256, `downloadUrl: ''` | `VALID_FIREBASE_STORAGE` | **Yes** (persistent in Firebase Storage across reloads & devices) | None — ready for production. |

---

## 3. Running the Migration Audit Programmatically

Use `fileStorageMigrationService.generateMigrationReport(submissions)` (`src/services/fileStorageMigrationService.ts`) against exported Firestore `/submissions` documents to generate an exact JSON/CSV report of any submission IDs and file IDs requiring participant re-upload without deleting or modifying any historical records.

---

## 4. Production Deployment on Firebase Spark Free Tier (Default — No Blaze Bucket Needed)

Proofly defaults to `VITE_STORAGE_BACKEND=firestore-chunks`, which stores validated submission files directly in **Cloud Firestore** as immutable 700 KB native `Bytes` chunks under `/submissionArtifacts/{fileId}/chunks/{chunkIndex}` with an 8 MB per-file cap and full SHA-256 verification.

- **Cost / Plan:** 100% **Firebase Spark Free Tier** (no Blaze plan, no credit card, no Cloud Storage bucket required).
- **Security:** Enforces identical strict multi-tenant, owner, assigned-judge-only, and write-only scoped anonymous session rules in `firestore.rules` (Section 19), with zero public reads and zero client updates/deletes.
- **Deploy Manually on Spark:**
  ```bash
  npx firebase-tools deploy --only firestore:rules,firestore:indexes
  npm run build
  npx firebase-tools deploy --only hosting
  ```
- **Spark Capacity Guidance:** Firestore Spark includes 1 GiB total storage, 20,000 writes/day, and 50,000 reads/day. Recommend direct uploads up to 8 MB (PDF decks, slides, screenshots, docs) and external links (GitHub/Drive) for very large archives or videos.

---

## 5. Optional Upgrade Path: Firebase Blaze Cloud Storage Bucket (`<= 25 MB/file`)

If you ever choose to upgrade `prison-control` to the Blaze plan for larger files (up to 25 MB) and dedicated GCS object storage:

1. Set `VITE_STORAGE_BACKEND=firebase-storage` in `.env`.
2. Configure a billing budget alert and initialize **Build → Storage** in the Firebase Console (`prison-control.firebasestorage.app`).
3. Configure bucket CORS for `https://prison-control.web.app`, `https://prison-control.firebaseapp.com`, and `http://localhost:5173` (`GET`, `POST`, `PUT`, `HEAD`, `OPTIONS`).
4. Deploy `storage.rules`:
   ```bash
   npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage
   ```
