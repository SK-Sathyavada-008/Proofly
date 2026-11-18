# Proofly (Evalora) — Hybrid AI Competition Evaluation & Judging OS

**Better reviews. Clearer decisions.**

Proofly (working name **Evalora**) is a multi-tenant competition management, zero-account submission intake, hybrid AI pre-evaluation, human judging, and official results publishing platform built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, and **Firebase AI Logic** (Gemini Nano on-device + Gemini 2.5 Flash cloud fallback).

---

## Core Capabilities

| Capability | Description |
| :--- | :--- |
| **Multi-Tenant Organizer Console** | Scoped organization & competition permissions, lifecycle state machine (`DRAFT` → `ACTIVE` → `EVALUATION` → `PUBLISHED`), custom tracks + Open Track toggle, configurable 100%-weighted rubrics. |
| **Zero-Account Participant Submissions** | Participants submit via public access codes or single-use cryptographic links without creating accounts. Supports 13 dynamic form field types, batch multi-file upload with magic-byte validation, and SHA-256 hashed management tokens. |
| **Firebase AI Logic Hybrid Inference** | Real runtime calls via `firebase/ai` (`getAI`, `getGenerativeModel`, `InferenceMode.PREFER_ON_DEVICE`, `GoogleAIBackend`) attempting on-device Gemini Nano before seamless cloud fallback to `gemini-2.5-flash` with honest execution telemetry and App Check attestation. |
| **Evidence-Grounded AI Critique Engine** | 9-step evaluation pipeline with PDF/PPTX/Markdown/GitHub extraction, immutable rubric versions, strict anti-hallucination evidence classification, track relevance penalties, calibrated non-inflated scoring, and multi-select batch evaluation. |
| **Human Judging Workspace** | Distraction-free split-screen studio displaying all 10 evaluation dossier dimensions, Blind Review mode, Agree/Modify/Reject actions, draft saving, immutable locked scorecards, conflict-of-interest recusal, and organizer-authorized reopening with audit logs. |
| **Scoring Ledger, Rankings & Official Publication** | 5 configurable aggregation policies (human-only `AVERAGE_JUDGE` default; AI never auto-counted), append-only immutable scoring ledger, deterministic tie-breaking, provisional vs. official results, Public Leaderboard (`/leaderboard`), CSV export, AI vs. Human comparison report, and full governance audit trail. |

---

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173` (or the port printed by Vite). For full Firebase setup, Chrome on-device AI flags, and production deployment instructions, see [`SETUP.md`](./SETUP.md).

---

## Verification & Quality Status

```bash
npm run lint   # oxlint across 181+ source files (0 errors)
npm test       # Vitest: 25 test suites, 291 tests passing
npm run build  # TypeScript strict check (tsc -b) + Vite production bundle
```

---

## Documentation Index

* [`SETUP.md`](./SETUP.md) — Local environment setup, Firebase configuration, Chrome Nano setup, and deployment commands
* [`ARCHITECTURE.md`](./ARCHITECTURE.md) — System architecture, data flows, state machines, and service boundaries
* [`FIREBASE_AI_LOGIC.md`](./FIREBASE_AI_LOGIC.md) — Exact `firebase/ai` imports, runtime hybrid inference flow, telemetry, and App Check setup
* [`SECURITY.md`](./SECURITY.md) — Firestore/Storage security rules, multi-tenant isolation, token hashing, abuse controls, and secret hygiene
* [`DEMO_GUIDE.md`](./DEMO_GUIDE.md) — Step-by-step public reproducible demo script across Organizer, Participant, Judge, and Public Leaderboard views
* [`HACKATHON_SUBMISSION.md`](./HACKATHON_SUBMISSION.md) — Hackathon evidence report, reused vs. newly built code, and honest scope disclosures
* [`LICENSE`](./LICENSE) — MIT License
