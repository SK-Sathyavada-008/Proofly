// ─────────────────────────────────────────────
// Firebase Configuration Module — Proofly / Evalora
// Production-hardened Firebase Auth, Firestore, App Check & AI Logic singleton
// ─────────────────────────────────────────────

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  CustomProvider,
  type AppCheck,
} from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

/**
 * Firebase configuration object read strictly from environment variables.
 * Values are populated from .env file (VITE_FIREBASE_*).
 */
const env = (typeof import.meta !== 'undefined' && (import.meta as any).env)
  ? (import.meta as any).env
  : ((globalThis as any).process?.env || {});

export const firebaseConfig = {
  apiKey: env?.VITE_FIREBASE_API_KEY ?? '',
  authDomain: env?.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: env?.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: env?.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: env?.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: env?.VITE_FIREBASE_APP_ID ?? '',
  measurementId: env?.VITE_FIREBASE_MEASUREMENT_ID ?? '',
};

export const recaptchaSiteKey: string = env?.VITE_FIREBASE_RECAPTCHA_SITE_KEY ?? '';

/**
 * Checks whether Firebase has been configured with real project credentials.
 */
export function isFirebaseConfigured(): boolean {
  const procEnv = (globalThis as any).process?.env;
  if (procEnv?.VITEST || procEnv?.NODE_ENV === 'test') {
    return false;
  }
  const { apiKey, projectId } = firebaseConfig;
  return Boolean(
    apiKey &&
    projectId &&
    apiKey !== 'YOUR_API_KEY' &&
    projectId !== 'YOUR_PROJECT_ID' &&
    !apiKey.startsWith('demo-')
  );
}

// Initialize Firebase App singleton safely
let app: FirebaseApp;
let db: Firestore;
let auth: Auth;
let appCheck: AppCheck | null = null;
let ai: AI | null = null;
let appCheckMode: 'RECAPTCHA_V3' | 'DEV_DEBUG_FALLBACK' | 'UNINITIALIZED' = 'UNINITIALIZED';

try {
  if (!getApps().length) {
    app = initializeApp(
      isFirebaseConfigured()
        ? firebaseConfig
        : {
            // Non-live local development fallback (never triggers secret scanners)
            apiKey: 'demo-placeholder-api-key-not-live',
            authDomain: 'proofly-demo-local.firebaseapp.com',
            projectId: 'proofly-demo-local',
            storageBucket: 'proofly-demo-local.appspot.com',
            messagingSenderId: '000000000000',
            appId: '1:000000000000:web:0000000000000000',
          }
    );
  } else {
    app = getApp();
  }

  db = getFirestore(app);
  auth = getAuth(app);

  // Initialize Firebase App Check (Required for Firebase AI Logic attestation)
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (isBrowser && app?.options?.apiKey) {
    try {
      const hasValidRecaptcha =
        Boolean(recaptchaSiteKey) &&
        recaptchaSiteKey !== 'YOUR_RECAPTCHA_V3_SITE_KEY' &&
        !recaptchaSiteKey.startsWith('demo-');

      if (isFirebaseConfigured() && hasValidRecaptcha) {
        // Production attestation via reCAPTCHA v3
        appCheck = initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
        appCheckMode = 'RECAPTCHA_V3';
      } else {
        // Local development / demo sandbox attestation fallback
        appCheck = initializeAppCheck(app, {
          provider: new CustomProvider({
            getToken: async () => ({
              token: 'proofly-dev-app-check-debug-token',
              expireTimeMillis: Date.now() + 60 * 60 * 1000,
            }),
          }),
          isTokenAutoRefreshEnabled: true,
        });
        appCheckMode = 'DEV_DEBUG_FALLBACK';
      }
    } catch (acError) {
      console.warn('[Firebase] App Check initialization note:', acError);
    }
  }

  // Initialize Firebase AI Logic service singleton (Google AI / Gemini Developer API backend)
  if (app?.options?.apiKey) {
    try {
      ai = getAI(app, { backend: new GoogleAIBackend() });
    } catch (aiError) {
      console.warn('[Firebase] AI Logic initialization note:', aiError);
    }
  }
} catch (error) {
  console.warn('[Firebase] Initialization warning:', error);
  app = (getApps()[0] as FirebaseApp) ?? ({} as FirebaseApp);
  db = {} as Firestore;
  auth = {} as Auth;
  appCheck = null;
  ai = null;
}

export { app, db, auth, appCheck, ai, appCheckMode };
