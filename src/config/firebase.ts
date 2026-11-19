// ─────────────────────────────────────────────
// Firebase Configuration Module — Proofly / Evalora
// Production-hardened Firebase Auth, Firestore, App Check & AI Logic singleton
// ─────────────────────────────────────────────

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  CustomProvider,
  type AppCheck,
} from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

/**
 * Firebase configuration object read strictly via STATIC Vite env property access.
 * IMPORTANT: Never reference `import.meta.env` as a dynamic whole object — doing so
 * causes Vite to inline every `VITE_*` variable from `.env` into the public bundle.
 */
const procEnv: Record<string, string | undefined> =
  typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.env
    ? (globalThis as any).process.env
    : {};

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? procEnv.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? procEnv.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? procEnv.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? procEnv.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ??
    procEnv.VITE_FIREBASE_MESSAGING_SENDER_ID ??
    '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? procEnv.VITE_FIREBASE_APP_ID ?? '',
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? procEnv.VITE_FIREBASE_MEASUREMENT_ID ?? '',
};

export const recaptchaSiteKey: string =
  import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY ??
  procEnv.VITE_FIREBASE_RECAPTCHA_SITE_KEY ??
  '';

/**
 * Demo mode can ONLY be enabled explicitly in non-production development environments.
 * Production builds (`import.meta.env.PROD === true`) always disable demo mode.
 */
export function isDemoModeEnabled(): boolean {
  if (import.meta.env.PROD) {
    return false;
  }
  return import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';
}

/**
 * Checks whether Firebase has been configured with real project credentials.
 */
export function isFirebaseConfigured(): boolean {
  if (procEnv.VITEST || procEnv.NODE_ENV === 'test') {
    return false;
  }
  const { apiKey, projectId } = firebaseConfig;
  return Boolean(
    apiKey &&
    projectId &&
    apiKey !== 'YOUR_API_KEY' &&
    apiKey !== 'YOUR_FIREBASE_WEB_API_KEY' &&
    projectId !== 'YOUR_PROJECT_ID' &&
    !apiKey.startsWith('demo-')
  );
}

// Initialize Firebase App singleton safely
let app: FirebaseApp;
let db: Firestore;
let auth: Auth;
let storage: FirebaseStorage | null = null;
let appCheck: AppCheck | null = null;
let ai: AI | null = null;
let appCheckMode: 'RECAPTCHA_V3' | 'DEV_DEBUG_FALLBACK' | 'UNINITIALIZED' = 'UNINITIALIZED';
let emulatorsConnected = false;

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
  storage = getStorage(app);

  // Connect to local Firebase Emulators ONLY when explicitly enabled in non-production
  const useEmulators =
    !import.meta.env.PROD &&
    (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ||
      procEnv.VITE_USE_FIREBASE_EMULATORS === 'true');
  if (useEmulators && !emulatorsConnected) {
    try {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      connectStorageEmulator(storage, '127.0.0.1', 9199);
      emulatorsConnected = true;
    } catch (emuErr) {
      console.warn('[Firebase] Emulator connection note:', emuErr);
    }
  }

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
  storage = null;
  appCheck = null;
  ai = null;
}

export { app, db, auth, storage, appCheck, ai, appCheckMode };
