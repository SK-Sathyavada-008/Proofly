// ─────────────────────────────────────────────
// firebaseAuthService.ts — Real Firebase Authentication & Token Lifecycle
// Proofly Phase 01 — Security-Critical Auth Foundation
// ─────────────────────────────────────────────

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onIdTokenChanged,
  updateProfile,
  type User,
  type Unsubscribe,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../config/firebase';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import type { PlatformRole, UserProfile } from '../types/authAndCompetition';

export interface VerifiedAuthSession {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  emailVerified: boolean;
  /** Derived strictly from verified Firebase Auth custom claims (`platformRole: 'SUPER_ADMIN'`). */
  platformRole: PlatformRole;
  tokenIssuedAtMs: number;
  tokenExpiresAtMs: number;
  revoked?: boolean;
}

/**
 * Maps raw Firebase Authentication error codes into safe, clear messages
 * without leaking internal account existence or implementation details.
 */
export function mapFirebaseAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a few minutes before trying again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your organization administrator.';
    case 'auth/user-token-expired':
    case 'auth/id-token-expired':
    case 'auth/id-token-revoked':
      return 'Your session has expired. Please sign in again.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing authentication.';
    case 'auth/popup-blocked':
      return 'Browser blocked the sign-in popup. Please allow popups for this site or use email sign-in.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase Authentication. Enable it in Firebase Console.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Firebase Authentication. Add it in Firebase Console -> Authentication -> Settings.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Firebase Authentication. Check your connection and try again.';
    default: {
      const msg = (error as { message?: string })?.message;
      return msg || 'Authentication failed. Please try again.';
    }
  }
}

function assertFirebaseAuthReady(): void {
  if (!isFirebaseConfigured() || !auth) {
    throw new Error(
      'Firebase Authentication is not configured. Provide valid VITE_FIREBASE_* credentials in .env.'
    );
  }
}

async function persistUserProfile(user: User, displayNameOverride?: string): Promise<void> {
  if (!isFirebaseConfigured() || !db) return;
  const now = new Date().toISOString();
  const profileDoc = sanitizeFirestoreData({
    uid: user.uid,
    email: (user.email || '').toLowerCase(),
    displayName: displayNameOverride || user.displayName || user.email?.split('@')[0] || 'User',
    photoURL: user.photoURL || undefined,
    updatedAt: now,
    createdAt: user.metadata?.creationTime || now,
  });

  try {
    await setDoc(doc(db, 'users', user.uid), profileDoc, { merge: true });
  } catch (err) {
    console.warn('[FirebaseAuthService] Could not sync user profile document:', err);
  }
}

export const firebaseAuthService = {
  /**
   * Signs in an existing organizer or judge using Firebase Email/Password Auth.
   */
  async signInWithEmail(email: string, password: string): Promise<VerifiedAuthSession> {
    assertFirebaseAuthReady();
    const cleanedEmail = email.trim().toLowerCase();
    if (!cleanedEmail || !password) {
      throw new Error('Email and password are required.');
    }

    const credential = await signInWithEmailAndPassword(auth, cleanedEmail, password);
    await persistUserProfile(credential.user);
    return this.extractVerifiedSession(credential.user, true);
  },

  /**
   * Registers a new organizer or invited judge account via Firebase Email/Password Auth.
   */
  async signUpWithEmail(
    email: string,
    password: string,
    displayName: string
  ): Promise<VerifiedAuthSession> {
    assertFirebaseAuthReady();
    const cleanedEmail = email.trim().toLowerCase();
    const cleanedName = displayName.trim();
    if (!cleanedEmail || !password || !cleanedName) {
      throw new Error('Full name, email, and password are required.');
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    const credential = await createUserWithEmailAndPassword(auth, cleanedEmail, password);
    await updateProfile(credential.user, { displayName: cleanedName });
    await persistUserProfile(credential.user, cleanedName);
    return this.extractVerifiedSession(credential.user, true, cleanedName);
  },

  /**
   * Signs in using Firebase Google OAuth popup.
   */
  async signInWithGoogle(): Promise<VerifiedAuthSession> {
    assertFirebaseAuthReady();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(auth, provider);
    await persistUserProfile(credential.user);
    return this.extractVerifiedSession(credential.user, true);
  },

  /**
   * Sends a Firebase password reset email.
   */
  async sendPasswordReset(email: string): Promise<void> {
    assertFirebaseAuthReady();
    const cleanedEmail = email.trim().toLowerCase();
    if (!cleanedEmail) {
      throw new Error('Please enter your email address.');
    }
    await sendPasswordResetEmail(auth, cleanedEmail);
  },

  /**
   * Signs out the active Firebase Auth user cleanly.
   */
  async signOutUser(): Promise<void> {
    if (!isFirebaseConfigured() || !auth) return;
    await firebaseSignOut(auth);
  },

  /**
   * Extracts a verified session object from a live Firebase User & ID Token Result.
   * Role claims (`platformRole`) come strictly from Firebase Auth Custom Claims.
   */
  async extractVerifiedSession(
    fbUser: User,
    forceRefresh: boolean = false,
    displayNameOverride?: string
  ): Promise<VerifiedAuthSession> {
    const tokenResult = await fbUser.getIdTokenResult(forceRefresh);
    const issuedAtMs = Date.parse(tokenResult.issuedAtTime) || Date.now();
    const expiresAtMs = Date.parse(tokenResult.expirationTime) || Date.now() + 3600 * 1000;

    // Platform Admin strictly requires a verified Firebase Custom Claim (`platformRole: 'SUPER_ADMIN'`)
    const claimedPlatformRole = tokenResult.claims?.platformRole;
    const platformRole: PlatformRole =
      claimedPlatformRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER';

    return {
      uid: fbUser.uid,
      email: (fbUser.email || '').toLowerCase(),
      displayName:
        displayNameOverride ||
        fbUser.displayName ||
        fbUser.email?.split('@')[0] ||
        'User',
      photoURL: fbUser.photoURL || undefined,
      emailVerified: Boolean(fbUser.emailVerified),
      platformRole,
      tokenIssuedAtMs: issuedAtMs,
      tokenExpiresAtMs: expiresAtMs,
      revoked: false,
    };
  },

  /**
   * Forces an ID token refresh for the current Firebase user.
   * Throws if session has expired or been revoked.
   */
  async refreshCurrentSession(): Promise<VerifiedAuthSession | null> {
    if (!isFirebaseConfigured() || !auth || !auth.currentUser) {
      return null;
    }
    return this.extractVerifiedSession(auth.currentUser, true);
  },

  /**
   * Subscribes to Firebase ID token & auth state transitions (sign-in, sign-out, token refresh).
   */
  subscribeToAuthState(
    onState: (fbUser: User | null) => void
  ): Unsubscribe {
    if (!isFirebaseConfigured() || !auth) {
      onState(null);
      return () => {};
    }
    return onIdTokenChanged(auth, onState);
  },

  /**
   * Converts a VerifiedAuthSession to the public UserProfile view model.
   */
  toUserProfile(session: VerifiedAuthSession): UserProfile {
    const now = new Date().toISOString();
    return {
      uid: session.uid,
      email: session.email,
      displayName: session.displayName,
      photoURL: session.photoURL,
      platformRole: session.platformRole,
      createdAt: now,
      updatedAt: now,
    };
  },
};
