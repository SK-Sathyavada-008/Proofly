# Proofly / Evalora — System Architecture

## 1. Architectural Overview

Proofly is structured as a modular, strictly typed React + TypeScript application backed by Firebase Authentication, Cloud Firestore, Firebase Storage, Firebase App Check, and Firebase AI Logic.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND WORKSPACES                             │
│  /organizer/*           /judge/*            /submit          /leaderboard│
│  Organizer Console      Judge Studio        Zero-Account     Official    │
│  (Auth + Org Scoped)    (Assigned Scoped)   Intake Portal    Public View │
└──────────┬────────────────────┬──────────────────┬────────────────┬─────┘
           │                    │                  │                │
┌──────────▼────────────────────▼──────────────────▼────────────────▼─────┐
│                        DOMAIN SERVICES LAYER                            │
│  • competitionService & competitionLifecycleService                     │
│  • scopedAuthService & organizationService                              │
│  • formBuilderService, formValidationService & accessManagementService  │
│  • submissionService, submissionLifecycleService & fileStorageService   │
│  • contentExtractionService, rubricEngineService & evaluationQueue      │
│  • aiLogicService (Firebase AI Logic Hybrid Inference)                  │
│  • evaluationPipelineService (9-Step Automated Pre-Evaluation)          │
│  • judgeAssignmentService (Multi-Judge, Conflicts, Locked Scorecards)   │
│  • scoringLedgerService (Append-Only Immutable Contributions)           │
│  • resultsAndAnalyticsService (5 Policies, Deterministic Ranking, CSV)  │
│  • governanceAuditService (Immutable Multi-Category Audit Trail)        │
└──────────┬────────────────────┬──────────────────┬────────────────┬─────┘
           │                    │                  │                │
┌──────────▼────────┐  ┌────────▼────────┐  ┌──────▼──────┐  ┌──────▼─────┐
│ Firebase Auth &   │  │ Cloud Firestore │  │ Firebase    │  │ Firebase   │
│ App Check         │  │ + Strict Rules  │  │ Storage     │  │ AI Logic   │
│ (reCAPTCHA v3)    │  │ + Indexes       │  │ + Rules     │  │ Nano+Cloud │
└───────────────────┘  └─────────────────┘  └─────────────┘  └────────────┘
```

---

## 2. Role & Workspace Separation

1. **Organizer Workspace (`/organizer/*`)**:
   * Authenticated users scoped by Organization membership (`OWNER`, `ADMIN`, `MEMBER`) and Competition role (`COMPETITION_ADMIN`, `ORGANIZER`).
   * Manages competitions, rubrics, custom tracks, dynamic forms, access codes/links, batch AI evaluations, judge panel workload, scoring policies, official result publication, analytics, and audit logs.
2. **Judge Workspace (`/judge/*`)**:
   * Authenticated users scoped strictly to assigned submissions (`JUDGE` role).
   * Enforces the **AI Pre-Evaluation Gate**: judges cannot open normal review until AI pre-evaluation completes (unless an organizer applies a documented AI-failure override).
   * Displays all 10 evaluation dossier dimensions, Blind Review mode, draft isolation (judges never see other judges' drafts), conflict-of-interest recusal, and locked final scorecards.
3. **Participant Submission Portal (`/submit`)**:
   * **Zero-account design**: participants enter via a public access code or single-use SHA-256 hashed link, receive an ephemeral scoped session token, upload multi-file artifacts, and receive a reference ID + cryptographic management token (only the SHA-256 hash is stored).
4. **Public Official Leaderboard (`/leaderboard/:competitionId`)**:
   * Displays **only** frozen snapshots explicitly approved and published by an organizer. Unpublished provisional rankings are never leaked.

---

## 3. Core Lifecycle State Machines

### Competition Lifecycle (`competitionLifecycleService.ts`)
```
DRAFT ──► ACTIVE ──► SUBMISSIONS_CLOSED ──► EVALUATION ──► RESULTS_REVIEW ──► PUBLISHED ──► ARCHIVED
```
Activation validates that rubric weights sum to 100%, chronological dates are valid, and team size limits are consistent.

### Submission Lifecycle (`submissionLifecycleService.ts`)
```
Draft ──► Submitted ──► Validating ──► Queued for AI Evaluation
  ──► AI Evaluation In Progress ──► AI Evaluation Complete ──► Ready for Judge Review
                                │                                    │
                                └─► AI Evaluation Failed             ▼
                                      (Organizer Override) ──► Under Human Review ──► Evaluated ──► Finalized
```

---

## 4. 9-Step AI Evaluation Pipeline (`evaluationPipelineService.ts`)

1. Receive submission & verify status
2. Validate files & metadata (`fileStorageService`)
3. Extract supported document content: Plain text, Markdown, PDF, PPT/PPTX, GitHub metadata/README, accessible URLs (`contentExtractionService`)
4. Assemble `StructuredEvidencePacket` with mandatory disclaimers (videos not visually analyzed; code not executed)
5. Load or capture immutable `RubricVersion` (`rubricEngineService`)
6. Execute hybrid AI inference via Firebase AI Logic (`aiLogicService`)
7. Validate returned JSON structure & numeric score bounds
8. Save immutable `AiEvaluationReport` and append `'AI'` criterion contributions to `scoringLedgerService`
9. Transition submission to `Ready for Judge Review`

---

## 5. Segregated AI vs. Human Scoring & Append-Only Ledger

* **Strict Data Isolation**: `AiEvaluationReport` and `HumanJudgeEvaluation` are stored separately. Human evaluations never overwrite AI reports, and once submitted, human evaluations are locked (`isLocked: true`). Reopening requires organizer authorization and a logged audit reason.
* **Append-Only Scoring Ledger (`scoringLedgerService.ts`)**: Every criterion score contribution (`AI` or `HUMAN`) is appended as a frozen record with sequence number, actor, timestamp, and adjustment reason. Adjustments append new records linking `previousEntryId`.
* **Deterministic Aggregation (`resultsAndAnalyticsService.ts`)**:
  * Default policy (`AVERAGE_JUDGE`) uses **human judge scores only**.
  * Supports `AVERAGE_JUDGE`, `WEIGHTED_JUDGE`, `CRITERION_WEIGHTED`, `ROUND_WISE`, and explicitly opted-in `AI_ASSISTED`.
  * Standard competition ranking preserves true ties (`1, 2, 2, 4`) unless broken by organizer-ordered deterministic tie-breakers.
