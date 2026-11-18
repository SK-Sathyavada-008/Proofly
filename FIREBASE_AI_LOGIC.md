# Firebase AI Logic — Hybrid Inference Implementation

## 1. SDK & Exact Imports

Proofly uses the official Firebase Web SDK v12 (`firebase@^12.19.0`) and its Firebase AI Logic module (`firebase/ai`) — **not** direct Gemini REST calls or client-embedded Gemini API keys.

### Initialization (`src/config/firebase.ts`)
```ts
import { initializeAppCheck, ReCaptchaV3Provider, CustomProvider, type AppCheck } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

// Singleton Firebase AI Logic instance backed by GoogleAIBackend
ai = getAI(app, { backend: new GoogleAIBackend() });
```

### Runtime Evaluation Engine (`src/services/aiLogicService.ts`)
```ts
import {
  getAI,
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  GoogleAIBackend,
  Schema,
  type AI,
  type GenerativeModel,
} from 'firebase/ai';
```

---

## 2. Runtime Hybrid Inference Execution

Both the standalone hybrid verification harness (`evaluateProjectSummary` at `/ai-test`) and the production 9-step competition evaluation pipeline (`evaluateSubmissionEvidence` invoked by `evaluationPipelineService.ts`) execute real Firebase AI Logic calls via `getGenerativeModel(...)` and `model.generateContent(prompt)`:

```ts
const model = getGenerativeModel(aiInstance, {
  mode, // Default: InferenceMode.PREFER_ON_DEVICE
  inCloudParams: {
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    },
    systemInstruction: '...',
  },
  onDeviceParams: {
    createOptions: {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    },
  },
});

const generateResult = await model.generateContent(prompt);
const response = generateResult.response;
const source = response.inferenceSource; // InferenceSource.ON_DEVICE | InferenceSource.IN_CLOUD
```

---

## 3. Hybrid Inference Behavior & Honest Telemetry

Proofly supports all four official `InferenceMode` options:

| Mode | Behavior |
| :--- | :--- |
| `PREFER_ON_DEVICE` *(Default)* | Attempts local Gemini Nano execution via Chrome's Prompt API bridge first; automatically falls back to cloud `gemini-2.5-flash` when on-device inference is unavailable, unsupported, or errors. |
| `ONLY_ON_DEVICE` | Restricts execution strictly to on-device Gemini Nano; returns an explicit error and telemetry if unavailable. |
| `PREFER_IN_CLOUD` | Prioritizes cloud `gemini-2.5-flash`, falling back to on-device if offline. |
| `ONLY_IN_CLOUD` | Forces cloud `gemini-2.5-flash` execution. |

Every evaluation records an immutable `InferenceTelemetry` payload:
* `requestedMode`: requested `InferenceMode`
* `actualInferenceSource`: `'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN'` (read directly from `response.inferenceSource`)
* `modelUsed`: exact model identifier reported by the runtime path
* `fallbackOccurred` & `fallbackReason`: explicit disclosure whenever cloud fallback occurred
* `latencyMs`: measured round-trip duration in milliseconds
* `appCheckStatus`: `'ACTIVE_AND_VERIFIED' | 'BYPASSED_DEV_MODE'`
* `timestamp`: ISO-8601 execution timestamp

### Offline / Unconfigured Sandbox Fallback
When running in automated Vitest suites or local development environments without live Firebase project credentials (or if a cloud call exceeds the 3500ms interactive budget), `evaluateSubmissionEvidence` gracefully invokes its deterministic evidence-calibrated baseline engine so workflows never crash — while accurately marking telemetry fallback metadata. In `/ai-test` (`evaluateProjectSummary`), errors are surfaced directly to the user without faking a model response.

---

## 4. Firebase App Check Setup

Firebase App Check protects Firebase AI Logic endpoints against unauthorized abuse:
* **Production (`src/config/firebase.ts`)**: When `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_RECAPTCHA_SITE_KEY` are configured, `initializeAppCheck` uses `ReCaptchaV3Provider(recaptchaSiteKey)` with `isTokenAutoRefreshEnabled: true`.
* **Local Dev / Test Sandbox**: When live credentials are absent, a local `CustomProvider` fallback initializes cleanly so local demos and tests run without crashing.
* **Console Enforcement**: In Firebase Console → **Build → App Check**, register the web app with reCAPTCHA v3 and toggle enforcement ON for **Firebase AI Logic**, **Cloud Firestore**, and **Cloud Storage**.

---

## 5. Evidence Grounding & Anti-Inflation Guardrails

* **Evidence Rules**: The prompt and post-validator enforce that every claim maps to one of six classifications (`EVIDENCE_VERIFIED`, `FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED`, `FEATURE_DEMONSTRABLY_ABSENT`, `EVIDENCE_UNAVAILABLE`, `CONTENT_UNCLEAR`, `TECHNICAL_BEHAVIOR_NOT_TESTED`). Uninspected videos and unexecuted code are always disclaimed.
* **Anti-Inflation Calibration**: Deductions require explicit point values (`Deduction (-X pts): ...`) and criterion scores are mathematically bound to `maxScore - sum(deductions)` so generic 96/100 score inflation cannot occur.
* **Segregation from Official Results**: AI evaluations are saved immutably in `aiEvaluationReports` and appended to `scoringLedger` with `source: 'AI'`. Official competition results default strictly to human judge scores.
