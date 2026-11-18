# Proofly / Evalora — Public Reproducible Demo Guide

This guide walks judges and reviewers through the complete end-to-end competition workflow using the built-in public demo environment (no private credentials or participant registration required).

---

## Starting the Demo Locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (e.g., `http://localhost:5173`).

---

## 5-Minute End-to-End Walkthrough

### Step 1: Verify Firebase AI Logic Hybrid Inference (`/ai-test`)
1. Open **`/ai-test`** from the landing hub.
2. Select **`PREFER_ON_DEVICE`** (default) and click **Run Evaluation** on the sample project summary.
3. Inspect the live telemetry panel showing:
   * Requested `InferenceMode`
   * Actual `InferenceSource` (`ON_DEVICE` on Gemini Nano-enabled Chrome, or automatic `IN_CLOUD` fallback to `gemini-2.5-flash`)
   * Fallback disclosure, App Check status, and measured latency (ms).

### Step 2: Organizer Setup — Competition, Tracks & Forms (`/organizer`)
1. Navigate to **`/organizer`** to see live competition analytics, submission volume, AI/human delta telemetry, and judge workload.
2. Open **`/organizer/competitions`** and create a new competition (or inspect the active default competition):
   * Configure custom **Tracks** + enable **Open Track**.
   * Verify **Rubric** weights sum to `100%`.
   * Copy the competition's **Public Access Code** (e.g., `PF-HYBRID26`).
3. Visit **`/organizer/forms`** to customize submission form fields or generate an expiring single-use individual submission link.

### Step 3: Zero-Account Participant Submission (`/submit`)
1. Open **`/submit`** (no sign-in required).
2. Enter the competition's public access code.
3. Fill out a project submission (e.g., **EventScout**), select a track (try either a matching track or a mismatched track like *Healthcare & Edge AI* to see thematic track penalty detection), and attach **multiple files at once** (e.g., PDF + Markdown/TXT).
4. Submit and copy the generated **Reference ID** (`PF-SUB-2026-...`) and one-time **Management Token** (`sec_...`).

### Step 4: Batch AI Pre-Evaluation (`/organizer/submissions`)
1. Go to **`/organizer/submissions`**.
2. Use the checkboxes (or **Select All**) to select one or more submissions and click **Run AI Evaluation on Selected**.
3. Open the generated AI Evaluation Dossier to verify:
   * Calibrated, non-inflated scores (e.g., ~79/100 for a solid hackathon MVP; 69/100 if track-misaligned).
   * Differentiated, domain-specific architectural deductions where `Suggested Score = Max Score - Sum(Deductions)`.
   * Mandatory evidence disclaimers (videos not visually watched; code not executed).

### Step 5: Human Judge Review Workspace (`/judge`)
1. Navigate to **`/judge/assignments`**.
2. Switch between competitions and reviewer personas (e.g., **Dr. Elena Vance** vs **Dr. Maya Patel**) to verify scoped assignment isolation.
3. Click **Review Dossier** on an assigned submission:
   * Toggle **Blind Review Mode** to mask submitter/team identity.
   * Review all 10 dossier dimensions (project info, files/links, AI overall & criterion scores, reasoning, deductions, missing evidence, limitations).
   * Choose **Agree**, **Modify**, or **Reject**, enter justification notes, click **Save Draft**, and then **Submit Official Evaluation** (locks scorecard).
   * Optionally test **Declare Conflict** (blocks access and alerts organizers in `/organizer/judges` for audited reassignment).

### Step 6: Scoring Policy, Analytics, Append-Only Ledger & Official Publication (`/organizer/results` → `/leaderboard`)
1. Open **`/organizer/results`**.
2. Explore the 5 tabs:
   * **Rankings & Publication**: Filter by Overall, Teams, Individuals, Category/Track, or Round. Observe deterministic tie handling and click **Inspect Breakdown** to view judge contributions or append an authorized ledger adjustment.
   * **Scoring Policy & Tie-Breakers**: Switch between `AVERAGE_JUDGE` (human-only default), `WEIGHTED_JUDGE`, `CRITERION_WEIGHTED`, `ROUND_WISE`, or explicitly opt into `AI_ASSISTED`; toggle/reorder tie-breakers and recompute live.
   * **Analytics & AI vs. Human Report**: Review score distribution charts, judge workload bars, and the AI vs. Human delta table with its mandatory non-correctness governance disclaimer.
   * **Append-Only Ledger** & **Governance Audit**: Inspect immutable sequence-numbered score contributions and full audit history.
3. Click **Preview**, then **Approve & Publish Official Results** (check the explicit organizer confirmation box and provide an approval note).
4. Click **Public Leaderboard** (`/leaderboard/<competitionId>`) to view the official published standings, podium, category filters, and **Export Official CSV**.
5. Optionally click **Unpublish / Correct** in `/organizer/results` to verify the public leaderboard immediately locks back to unpublished status with an audit record.
