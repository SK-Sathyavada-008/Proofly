# Proofly / Evalora — Setup & Deployment Guide

## 1. Prerequisites

* **Node.js** 20+ and **npm** 10+
* **Google Chrome** 138+ (optional for on-device Gemini Nano hybrid inference; standard Chrome/Edge/Firefox automatically fall back to cloud Gemini 2.5 Flash)
* **Firebase CLI** (`npm install -g firebase-tools`) for production deployment

---

## 2. Local Development Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create your local environment file**:
   ```bash
   cp .env.example .env
   ```
   Fill in your Firebase Web SDK credentials (`VITE_FIREBASE_*`) and reCAPTCHA v3 site key (`VITE_FIREBASE_RECAPTCHA_SITE_KEY`) from Firebase Console.
   > **Local Demo Mode**: If `.env` is left unconfigured or uses placeholder values, the app runs safely in an offline/in-memory demo sandbox with `localStorage` persistence so reviewers can explore every screen without live cloud credentials.

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open the local URL printed by Vite (typically `http://localhost:5173` or `http://localhost:5174`).

4. **Run automated quality checks**:
   ```bash
   npm run lint   # Static lint checks (oxlint)
   npm test       # Unit, integration & E2E suites (Vitest)
   npm run build  # TypeScript strict check + production Vite bundle
   ```

---

## 3. Enabling On-Device Gemini Nano in Chrome (Hybrid Inference)

To observe the `ON_DEVICE` inference path locally before cloud fallback:

1. Open Google Chrome (Dev/Canary or stable 138+ on supported hardware with >= 22 GB free disk space and >= 4 GB VRAM or 16 GB RAM).
2. Enable Chrome Built-in AI flags at `chrome://flags`:
   * `#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
   * `#prompt-api-for-gemini-nano` → **Enabled**
3. Restart Chrome and verify `chrome://components` shows **Optimization Guide On Device Model** downloaded.
4. Visit `/ai-test` in the running Proofly app to test all 4 Firebase AI Logic modes (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`) and inspect real-time telemetry.

---

## 4. Production Firebase Deployment

### A. Enable Required Firebase Services
In the [Firebase Console](https://console.firebase.google.com/):
1. **Authentication**: Enable Email/Password and Google sign-in for Organizers and Judges. (Participants never require accounts.)
2. **Firestore Database**: Create a production Firestore database.
3. **Firebase Storage**: Enable Cloud Storage for competition submission artifacts.
4. **Firebase AI Logic**: Enable the Gemini Developer API (`GoogleAIBackend`) in Firebase Console → **Build → AI Logic**.
5. **Firebase App Check**: Register your web app with **reCAPTCHA v3** and enforce App Check on **Firebase AI Logic**, **Firestore**, and **Storage**. Set `VITE_FIREBASE_RECAPTCHA_SITE_KEY` in your production build environment.

### B. Deploy Security Rules, Indexes & Hosting
```bash
# Authenticate and select your target Firebase project
firebase login
firebase use <YOUR_FIREBASE_PROJECT_ID>

# Build production bundle
npm run build

# Deploy Firestore rules, composite indexes, Storage rules, and Hosting
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

### C. Serverless Backend Functions (Optional GitHub / Webhook Endpoints)
If deploying the optional serverless repository/webhook endpoints in [`api/`](./api/):
* Configure server-only secrets (`GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `GEMINI_API_KEY`) strictly in your hosting provider's secret manager (Vercel Environment Variables or Firebase Functions Secret Manager).
* **Never** prefix server secrets with `VITE_`.

### D. Production Monitoring & Logs
* **Firebase Console → AI Logic**: Monitor token usage, cloud fallback volume, and App Check rejection metrics.
* **Firebase Console → App Check**: Verify attested request ratio and block unverified clients.
* **Firestore & Hosting Logs**: Inspect audit events in `governanceAuditLogs` and `scoringLedger` collections alongside Cloud Logging for rule denials.
