# Evalora Product & Technical Architecture (Phase 0)

**Project Name**: Evalora  
**Tagline**: Better reviews. Clearer decisions.  
**Target Competition**: #BuildHybridAI 2026  
**Stack**: React 19, TypeScript, Vite, Tailwind CSS, Firebase Auth, Cloud Firestore, Firebase Storage, Firebase AI Logic, Firebase App Check  

---

## 1. Product Vision & Core Decisions

Evalora is an AI-assisted evaluation and decision platform designed for project-based competitions: hackathons, innovation challenges, research showcases, academic competitions, and startup incubators.

### Core Product Decisions:
1. **Zero Participant Accounts**: Participants never register or log in. Friction is eliminated.
2. **Access Control via Distribution**: Organizers distribute public links, competition access codes, or unique invitation tokens.
3. **Flexible Team Ingestion**: Teams and participants can be created manually, imported via CSV, or self-declared directly upon submission.
4. **Dynamic Submission Forms**: Organizers configure required fields, project artifacts (GitHub URL, live demo, video, PDF decks, PPTs, ZIP archives, architecture diagrams), and deadlines.
5. **Enforced AI Pre-Evaluation**: Every valid submission must receive an AI evaluation before it becomes accessible to human judges.
6. **Transparent AI Reasoning**: Judges immediately inspect AI scores, criteria breakdowns, strengths, and deduction rationales.
7. **Human Judge Authority**: Judges can agree, modify, or reject AI recommendations with mandatory justifications for score changes.
8. **Strict Score Segregation**: AI scores and human judge scores remain completely separate in data storage and presentation.
9. **Authorized Organizer Publishing**: Final leaderboard standings and official awards require authorized organizer approval.
10. **Target Scope**: Focused on project-based competitions. Coding bug-hunts and syntax grading are excluded from Release 1.

---

## 2. Hybrid AI Architecture (#BuildHybridAI 2026)

Evalora fulfills all requirements of the #BuildHybridAI hackathon by implementing a genuine Chrome web application utilizing **Firebase AI Logic** with **Gemini Nano 4** and cloud fallback.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EVALORA HYBRID AI ENGINE                        │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                     Firebase App Check Verification
                     (Protects API & Validates Origin)
                                    │
                                    ▼
                           Firebase AI Logic
                  getAI(app, { backend: GoogleAIBackend })
                                    │
                                    ▼
       getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
        [ On-Device Path ]                   [ Cloud Fallback Path ]
        Chrome Prompt API                     Gemini 2.5 Flash
        Gemini Nano 4                         (High throughput, full
        (Zero network latency,                multimodal reasoning)
         privacy-first local)                         │
                  │                                   │
                  └─────────────────┬─────────────────┘
                                    │
                                    ▼
                        Execution Telemetry Report
                  - inferenceSource ("on_device" | "in_cloud")
                  - latencyMs
                  - rubricCriteriaScores
                  - deductions & reasoning breakdown
                  - App Check status
```

### Key Technical Specifications:
* **SDK Module**: Official `firebase/ai` (`getAI`, `getGenerativeModel`, `InferenceMode`, `InferenceSource`, `GoogleAIBackend`).
* **Inference Mode**: `InferenceMode.PREFER_ON_DEVICE`.
* **On-Device Target**: Gemini Nano 4 via Chrome's native Prompt API (`LanguageModel` / `window.ai.languageModel`).
* **In-Cloud Fallback**: `gemini-2.5-flash` configured through `inCloudParams`.
* **Runtime Verification**: The UI inspects `result.response.inferenceSource` to display an honest status badge indicating whether evaluation ran on-device or fell back to cloud.
* **Firebase App Check**: Initialized via `initializeAppCheck` using `ReCaptchaV3Provider` in production and `CustomProvider` in development/testing.

---

## 3. Role-Specific User Interfaces

Evalora provides three purpose-built interfaces tailored to each stakeholder:

### A. Organizer Command Center (`/organizer`)
* **Competition Management**: Create, edit, and monitor competition lifecycles (Draft, Accepting Submissions, Evaluation Phase, Finalized).
* **Submission Form Builder**: Dynamically configure submission fields (text inputs, dropdowns, GitHub URLs, deployment links, file attachments with allowed MIME types).
* **Rubric & Weight Editor**: Define custom evaluation rubrics (e.g. Technological Implementation, Design, Potential Impact, Idea Quality) with weights and max scores.
* **Access Key & Roster Portal**: Generate shareable public links, access codes (e.g., `HACK-2026`), and import team rosters via CSV.
* **Official Results & Publishing**: Review judge coverage, inspect score variances, and finalize official standings with an auditable sign-off.

### B. Participant Submission Portal (`/submit`)
* **No Account Required**: Immediate access via competition link or access code validation.
* **Self-Declared Team Information**: Enter project title, team name, and member names/emails without friction.
* **Multi-Part Artifact Submissions**: Upload project PDFs, slide decks, ZIP archives, architecture diagrams, GitHub repository links, and live deployed demo URLs.
* **Submission Receipt & Policies**: Generates a verifiable submission token and enforces organizer-configured edit/replacement locks.

### C. Judge Workspace (`/judge`)
* **Assigned Submissions Queue**: Access assigned projects that have completed automated AI pre-evaluation.
* **Artifact Viewer**: Inspect project descriptions, GitHub repositories, demo links, and uploaded files in a clean split-screen view.
* **Side-by-Side AI Transparency**: Review AI rubric scores, detected strengths, and explicit score deduction explanations.
* **Decision Review Action**: Select **Agree**, **Modify**, or **Reject** on AI recommendations, entering final human rubric scores and qualitative feedback.
* **Score Isolation**: Human scores are stored in separate `judgeReviews` documents, never overwriting the underlying AI evaluation.

---

## 4. Firestore Data Models & Schema

```
firestore/
├── competitions/{competitionId}
│   ├── title: string
│   ├── tagline: string
│   ├── status: "DRAFT" | "OPEN" | "EVALUATION" | "FINALIZED"
│   ├── accessCodes: string[]
│   ├── publicSubmissionAllowed: boolean
│   ├── submissionDeadline: timestamp
│   ├── allowEditUntilDeadline: boolean
│   ├── rubrics: RubricCriterion[]
│   └── formConfig: FormFieldConfig[]
│
├── submissions/{submissionId}
│   ├── competitionId: string
│   ├── accessCodeUsed?: string
│   ├── teamName: string
│   ├── memberNames: string[]
│   ├── contactEmail: string
│   ├── title: string
│   ├── description: string
│   ├── githubUrl?: string
│   ├── liveUrl?: string
│   ├── artifacts: SubmissionArtifact[]
│   ├── aiEvaluationStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
│   ├── submittedAt: timestamp
│   └── isLocked: boolean
│
├── evaluations/{submissionId}  [AI Evaluation Record]
│   ├── competitionId: string
│   ├── submissionId: string
│   ├── inferenceSource: "on_device" | "in_cloud"
│   ├── model: string
│   ├── latencyMs: number
│   ├── criteriaScores: Record<string, number>
│   ├── totalScore: number
│   ├── strengths: string[]
│   ├── deductions: Array<{ criterionId: string; deduction: number; reason: string }>
│   ├── reasoningSummary: string
│   └── evaluatedAt: timestamp
│
├── judgeReviews/{reviewId}     [Human Review Record]
│   ├── competitionId: string
│   ├── submissionId: string
│   ├── judgeId: string
│   ├── judgeName: string
│   ├── aiRecommendationAction: "AGREED" | "MODIFIED" | "REJECTED"
│   ├── criteriaScores: Record<string, number>
│   ├── totalScore: number
│   ├── overrideReason?: string
│   ├── feedbackComments: string
│   └── reviewedAt: timestamp
│
├── officialResults/{competitionId}
│   ├── competitionId: string
│   ├── finalizedRankings: RankedSubmission[]
│   ├── approvedBy: string
│   ├── publishedAt: timestamp
│   └── notes: string
│
└── auditLogs/{logId}
    ├── action: string
    ├── performedBy: string
    ├── targetId: string
    ├── details: object
    └── timestamp: timestamp
```

---

## 5. Security & Authorization Matrix

1. **Firestore Security Rules**:
   - `competitions`: Publicly readable; writable only by authenticated Organizers.
   - `submissions`: Create allowed if competition is open; update allowed only if `isLocked == false` and token matches; read restricted to Organizers and Judges.
   - `evaluations` (AI): Writable only by the verified backend/evaluator; readable by Organizers and Judges. Never writable by participants.
   - `judgeReviews`: Writable and readable only by authenticated Judges and Organizers.
   - `officialResults`: Readable by public once published; writable only by authorized Organizers.
2. **Zero Client Secrets**:
   - Remove `VITE_GITHUB_TOKEN` and `VITE_GEMINI_API_KEY`.
   - Protect all AI Logic requests via Firebase App Check tokens.
   - Real Firebase Auth for Organizers and Judges; zero password comparison in client code.

---

## 6. Visual Design System

* **Philosophy**: Modern, restrained, professional B2B SaaS.
* **Palette**:
  - Background: White (`#FFFFFF`) and very light slate (`#F8FAFC`).
  - Card Surfaces: Light grey (`#F1F5F9`) with thin slate borders (`#E2E8F0`).
  - Typography: Dark slate (`#0F172A`), secondary slate (`#475569`).
  - Accent: Restrained classic royal blue (`#2563EB`).
  - Success / Warning / Danger: Muted emerald (`#059669`), amber (`#D97706`), red (`#DC2626`).
* **Elimination of Visual Noise**:
  - No fantasy / story themes.
  - No excessive neon glow, scanlines, or cyberpunk grids.
  - No decorative animations or gamified level-up bars.
  - Clear tables, structured forms, and readable badges.
