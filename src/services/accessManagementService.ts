// ─────────────────────────────────────────────
// accessManagementService.ts — Secure Scoped Submission Access Management
// Proofly — Phase 4
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import type {
  CompetitionAccessKey,
  AccessValidationResult,
  SubmissionSessionToken,
} from '../types/formAndAccess';
import { competitionService } from './competitionService';
import { formBuilderService } from './formBuilderService';
import { generateSecureToken, sha256Hash, timingSafeEqualStrings } from '../utils/cryptoUtils';

const ACCESS_KEYS_STORAGE_KEY = 'proofly_access_keys_v1';

// Local in-memory store for fallback/tests
let localAccessKeys: CompetitionAccessKey[] = [];
let localActiveSessions: Record<string, SubmissionSessionToken> = {};

function loadAccessKeysFromStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const raw = window.localStorage.getItem(ACCESS_KEYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        localAccessKeys = parsed;
      }
    }
  } catch {
    // Ignore storage errors
  }
}

function saveAccessKeysToStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(ACCESS_KEYS_STORAGE_KEY, JSON.stringify(localAccessKeys));
  } catch {
    // Ignore storage errors
  }
}

loadAccessKeysFromStorage();

// Sliding-window rate limiter against anonymous access-code brute forcing
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_FAILED_ATTEMPTS = 10;
let failedAttemptTimestamps: Record<string, number[]> = {};

function recordFailedAttempt(bucketKey: string, nowMs: number): void {
  const existing = (failedAttemptTimestamps[bucketKey] || []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS
  );
  existing.push(nowMs);
  failedAttemptTimestamps[bucketKey] = existing;
}

function isRateLimited(bucketKey: string, nowMs: number): boolean {
  const recent = (failedAttemptTimestamps[bucketKey] || []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS
  );
  failedAttemptTimestamps[bucketKey] = recent;
  return recent.length >= RATE_LIMIT_MAX_FAILED_ATTEMPTS;
}

export interface GenerateIndividualLinkResult {
  accessKey: CompetitionAccessKey;
  rawToken: string; // ONLY returned once to organizer upon creation!
  directSubmissionUrl: string;
}

export const accessManagementService = {
  async generatePublicAccessKey(
    competitionId: string,
    existingCode?: string
  ): Promise<CompetitionAccessKey> {
    return this.getOrCreatePublicAccessKey(competitionId, existingCode);
  },

  /**
   * Initializes or returns the primary public access key for a competition.
   */
  async getOrCreatePublicAccessKey(
    competitionId: string,
    existingCode?: string
  ): Promise<CompetitionAccessKey> {
    const comp = await competitionService.getCompetition(competitionId);
    if (!comp) {
      throw new Error(`Competition "${competitionId}" not found.`);
    }

    const code = existingCode || comp.publicAccessCode || `PF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Look for existing public key
    const existing = await this.listAccessKeys(competitionId);
    const existingPublic = existing.find((k) => k.scopeType === 'PUBLIC_LINK' || k.scopeType === 'ACCESS_CODE');
    if (existingPublic) {
      return existingPublic;
    }

    const keyId = `key-pub-${competitionId}`;
    const now = new Date().toISOString();
    const newKey: CompetitionAccessKey = {
      id: keyId,
      competitionId,
      scopeType: 'PUBLIC_LINK',
      code,
      label: 'Standard Public Link & Access Code',
      submissionsCount: 0,
      revoked: false,
      requireAuth: false,
      createdAt: now,
      updatedAt: now,
    };

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'accessKeys', keyId), sanitizeFirestoreData(newKey));
      } catch {
        // Fallback to local store
      }
    }

    localAccessKeys.push(newKey);
    saveAccessKeysToStorage();
    return newKey;
  },

  /**
   * Generates a cryptographically secure, unique individual submission link.
   * Scoped to a specific participant or team with optional submission cap and expiry.
   *
   * SECURITY RULE: Raw token is returned ONCE to caller and NEVER saved in Firestore.
   * Only the SHA-256 hash is stored.
   */
  async generateIndividualLink(
    competitionId: string,
    options: {
      email?: string;
      teamName?: string;
      maxSubmissions?: number;
      expiresAt?: string;
      label?: string;
      requireAuth?: boolean;
    }
  ): Promise<GenerateIndividualLinkResult> {
    const comp = await competitionService.getCompetition(competitionId);
    if (!comp) {
      throw new Error(`Competition "${competitionId}" not found.`);
    }

    // 1. Generate 256-bit cryptographically random token
    const rawToken = generateSecureToken(32);

    // 2. Compute SHA-256 hash
    const tokenHash = await sha256Hash(rawToken);
    const tokenPrefix = rawToken.substring(0, 6);

    const keyId = `key-ind-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    const accessKey: CompetitionAccessKey = {
      id: keyId,
      competitionId,
      scopeType: 'INDIVIDUAL_LINK',
      code: `PF-IND-${tokenPrefix}...`,
      tokenHash,
      tokenPrefix,
      label: options.label || (options.teamName ? `Invite: ${options.teamName}` : options.email ? `Invite: ${options.email}` : 'Unique Participant Link'),
      targetParticipantEmail: options.email,
      targetTeamName: options.teamName,
      submissionsCount: 0,
      maxSubmissions: options.maxSubmissions ?? 1, // Default single-use
      expiresAt: options.expiresAt,
      revoked: false,
      requireAuth: options.requireAuth ?? false,
      createdAt: now,
      updatedAt: now,
    };

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'accessKeys', keyId), sanitizeFirestoreData(accessKey));
      } catch {
        // Fallback to local store
      }
    }
    localAccessKeys.push(accessKey);
    saveAccessKeysToStorage();

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
    const directSubmissionUrl = `${origin}/submit?token=${rawToken}&comp=${competitionId}`;

    return {
      accessKey,
      rawToken,
      directSubmissionUrl,
    };
  },

  /**
   * Regenerates a competition's public access code.
   * Old access codes will no longer be accepted.
   */
  async regenerateAccessCode(competitionId: string): Promise<CompetitionAccessKey> {
    const comp = await competitionService.getCompetition(competitionId);
    if (!comp) {
      throw new Error(`Competition "${competitionId}" not found.`);
    }

    const newCode = `PF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    // Update competition record
    await competitionService.updateCompetition(competitionId, {
      publicAccessCode: newCode,
    });

    // Update public access key record
    const keys = await this.listAccessKeys(competitionId);
    const publicKey = keys.find((k) => k.scopeType === 'PUBLIC_LINK' || k.scopeType === 'ACCESS_CODE');

    if (publicKey) {
      const updated: CompetitionAccessKey = {
        ...publicKey,
        code: newCode,
        updatedAt: now,
      };
      if (isFirebaseConfigured() && db) {
        try {
          await updateDoc(doc(db, 'accessKeys', publicKey.id), updated as any);
        } catch {
          // Fallback to local store
        }
      }
      const idx = localAccessKeys.findIndex((k) => k.id === publicKey.id);
      if (idx !== -1) localAccessKeys[idx] = updated;
      saveAccessKeysToStorage();
      return updated;
    }

    return this.getOrCreatePublicAccessKey(competitionId, newCode);
  },

  /**
   * Revokes an access key permanently.
   */
  async revokeAccessKey(keyId: string): Promise<CompetitionAccessKey> {
    const key = await this.getAccessKey(keyId);
    if (!key) {
      throw new Error(`Access key "${keyId}" not found.`);
    }

    const updated: CompetitionAccessKey = {
      ...key,
      revoked: true,
      revokedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      try {
        await updateDoc(doc(db, 'accessKeys', keyId), updated as any);
      } catch {
        // Fallback to local store
      }
    }

    const idx = localAccessKeys.findIndex((k) => k.id === keyId);
    if (idx !== -1) localAccessKeys[idx] = updated;
    saveAccessKeysToStorage();

    return updated;
  },

  /**
   * Updates submission limits on an access key.
   */
  async setSubmissionLimit(keyId: string, limit: number): Promise<CompetitionAccessKey> {
    const key = await this.getAccessKey(keyId);
    if (!key) throw new Error(`Access key "${keyId}" not found.`);

    const updated: CompetitionAccessKey = {
      ...key,
      maxSubmissions: limit,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      try {
        await updateDoc(doc(db, 'accessKeys', keyId), updated as any);
      } catch {
        // Fallback to local store
      }
    }
    const idx = localAccessKeys.findIndex((k) => k.id === keyId);
    if (idx !== -1) localAccessKeys[idx] = updated;
    saveAccessKeysToStorage();

    return updated;
  },

  /**
   * Updates expiration timestamp on an access key.
   */
  async setExpiration(keyId: string, expiresAt: string | null): Promise<CompetitionAccessKey> {
    const key = await this.getAccessKey(keyId);
    if (!key) throw new Error(`Access key "${keyId}" not found.`);

    const updated: CompetitionAccessKey = {
      ...key,
      expiresAt: expiresAt || undefined,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      try {
        await updateDoc(doc(db, 'accessKeys', keyId), updated as any);
      } catch {
        // Fallback to local store
      }
    }
    const idx = localAccessKeys.findIndex((k) => k.id === keyId);
    if (idx !== -1) localAccessKeys[idx] = updated;
    saveAccessKeysToStorage();

    return updated;
  },

  /**
   * Retrieves an access key by ID.
   */
  async getAccessKey(keyId: string): Promise<CompetitionAccessKey | null> {
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDoc(doc(db, 'accessKeys', keyId));
        if (snap.exists()) {
          return snap.data() as CompetitionAccessKey;
        }
      } catch {
        // Fallback to local store
      }
    }
    return localAccessKeys.find((k) => k.id === keyId) || null;
  },

  /**
   * Lists all access keys for a given competition.
   */
  async listAccessKeys(competitionId: string): Promise<CompetitionAccessKey[]> {
    const list: CompetitionAccessKey[] = localAccessKeys.filter((k) => k.competitionId === competitionId);
    if (isFirebaseConfigured() && db) {
      try {
        const q = query(collection(db, 'accessKeys'), where('competitionId', '==', competitionId));
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          const item = docSnap.data() as CompetitionAccessKey;
          const idx = list.findIndex((k) => k.id === item.id);
          if (idx >= 0) {
            list[idx] = item;
          } else {
            list.push(item);
          }
        });
      } catch {
        // Fallback to local store
      }
    }
    return list;
  },

  /**
   * Increments the submission count on an access key.
   */
  async recordSubmissionUsage(keyId: string): Promise<void> {
    const key = await this.getAccessKey(keyId);
    if (!key) return;

    const updated: CompetitionAccessKey = {
      ...key,
      submissionsCount: (key.submissionsCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      try {
        await updateDoc(doc(db, 'accessKeys', keyId), {
          submissionsCount: updated.submissionsCount,
          updatedAt: updated.updatedAt,
        });
      } catch {
        // Fallback to local store
      }
    }
    const idx = localAccessKeys.findIndex((k) => k.id === keyId);
    if (idx !== -1) localAccessKeys[idx] = updated;
    saveAccessKeysToStorage();
  },

  /**
   * Trusted validation endpoint / service function.
   * Validates access code or token, verifies non-revocation, non-expiration, submission limits,
   * and issues a short-lived scoped session token without exposing raw database records.
   * Supports either (competitionId, codeOrToken) or just (codeOrToken).
   */
  async validateAccessAndCreateSession(
    competitionIdOrCode: string,
    optionalCodeOrToken?: string,
    now: Date = new Date()
  ): Promise<AccessValidationResult> {
    let competitionId: string;
    let codeOrToken: string;

    if (optionalCodeOrToken !== undefined) {
      competitionId = competitionIdOrCode;
      codeOrToken = optionalCodeOrToken;
    } else {
      codeOrToken = competitionIdOrCode;
      // Resolve competition from code/token across access keys
      const trimmed = (codeOrToken || '').trim().toUpperCase();
      const matchedLocal = localAccessKeys.find(
        (k) => k.code.toUpperCase() === trimmed || (k.tokenPrefix && trimmed.startsWith(k.tokenPrefix))
      );
      if (matchedLocal) {
        competitionId = matchedLocal.competitionId;
      } else {
        // Try looking up competition by publicAccessCode
        const compByCode = await competitionService.getCompetitionByAccessCode(trimmed);
        if (compByCode) {
          competitionId = compByCode.id;
        } else {
          competitionId = competitionIdOrCode;
        }
      }
    }

    const trimmedInput = (codeOrToken || '').trim();
    if (!trimmedInput) {
      return {
        valid: false,
        reason: 'Please provide a valid access code or direct submission link.',
        error: 'Please provide a valid access code or direct submission link.',
      };
    }

    const rateBucket = `access:${competitionId}`;
    if (isRateLimited(rateBucket, now.getTime())) {
      const msg = 'Too many failed access attempts. Please wait 60 seconds before trying again.';
      return {
        valid: false,
        reason: msg,
        error: msg,
      };
    }

    // 1. Verify Competition Exists and is accepting submissions
    const comp = await competitionService.getCompetition(competitionId);
    if (!comp) {
      recordFailedAttempt(rateBucket, now.getTime());
      return {
        valid: false,
        reason: `Competition "${competitionId}" does not exist.`,
        error: `Competition "${competitionId}" does not exist.`,
      };
    }

    if (comp.status === 'ARCHIVED') {
      const msg = 'This competition has been archived. Submissions are permanently closed.';
      return {
        valid: false,
        reason: msg,
        error: msg,
      };
    }

    if (comp.status === 'DRAFT') {
      // Auto-activate valid draft competition when accessed with the direct access code
      try {
        await competitionService.transitionStatus(comp.id, 'ACTIVE');
        comp.status = 'ACTIVE';
      } catch {
        const msg = `Competition "${comp.title}" is currently in DRAFT mode and has not been launched yet. In the Organizer portal, please click "Launch (Activate)" on the Competitions page to open submissions.`;
        return {
          valid: false,
          reason: msg,
          error: msg,
        };
      }
    }

    // 2. Locate Access Key
    const allKeys = await this.listAccessKeys(competitionId);
    let matchedKey: CompetitionAccessKey | null = null;

    // Check if input matches public code (e.g. PF-HYBRID26 or comp.publicAccessCode)
    const upperInput = trimmedInput.toUpperCase();
    const publicMatch = allKeys.find(
      (k) =>
        (k.scopeType === 'PUBLIC_LINK' || k.scopeType === 'ACCESS_CODE') &&
        (k.code.toUpperCase() === upperInput || (comp.publicAccessCode && comp.publicAccessCode.toUpperCase() === upperInput))
    );

    if (publicMatch) {
      matchedKey = publicMatch;
    } else if (comp.publicAccessCode && comp.publicAccessCode.toUpperCase() === upperInput) {
      // Direct match against competition's public access code!
      // Synthesize/provision key so that any valid competition access code works instantly
      matchedKey = {
        id: `key-pub-${comp.id}`,
        competitionId: comp.id,
        scopeType: 'ACCESS_CODE',
        code: comp.publicAccessCode,
        label: 'Public Competition Access Code',
        submissionsCount: 0,
        revoked: false,
        requireAuth: false,
        createdAt: comp.createdAt,
        updatedAt: comp.updatedAt,
      };
      if (!localAccessKeys.some((k) => k.id === matchedKey!.id)) {
        localAccessKeys.push(matchedKey);
      }
    } else {
      // Check if input is a raw secret token (hash lookup)
      const inputHash = await sha256Hash(trimmedInput);
      const tokenMatch = allKeys.find((k) => k.tokenHash && timingSafeEqualStrings(k.tokenHash, inputHash));
      if (tokenMatch) {
        matchedKey = tokenMatch;
      }
    }

    if (!matchedKey) {
      recordFailedAttempt(rateBucket, now.getTime());
      const msg = 'Invalid access code or submission token. Please verify your code and try again.';
      return {
        valid: false,
        reason: msg,
        error: msg,
      };
    }

    // 3. Check Revocation
    if (matchedKey.revoked) {
      const msg = 'This submission access link has been revoked by the organizer.';
      return {
        valid: false,
        reason: msg,
        error: msg,
      };
    }

    // 4. Check Expiration
    if (matchedKey.expiresAt) {
      const expiry = new Date(matchedKey.expiresAt).getTime();
      if (now.getTime() > expiry) {
        const msg = `This submission link expired on ${new Date(expiry).toLocaleString()}.`;
        return {
          valid: false,
          reason: msg,
          error: msg,
        };
      }
    }

    // 5. Check Submission Limits
    if (
      matchedKey.maxSubmissions !== undefined &&
      matchedKey.submissionsCount >= matchedKey.maxSubmissions
    ) {
      const msg = `Submission limit reached for this link (maximum ${matchedKey.maxSubmissions} allowed).`;
      return {
        valid: false,
        reason: msg,
        error: msg,
      };
    }

    // 6. Issue Short-Lived Scoped Session Token (valid for 30 minutes)
    const sessionToken = generateSecureToken(32);
    const issuedAt = now.toISOString();
    const sessionExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    const session: SubmissionSessionToken = {
      sessionToken,
      competitionId,
      keyId: matchedKey.id,
      scopeType: matchedKey.scopeType,
      participantEmail: matchedKey.targetParticipantEmail,
      teamName: matchedKey.targetTeamName,
      issuedAt,
      expiresAt: sessionExpiresAt,
    };

    localActiveSessions[sessionToken] = session;

    // Load active form schema
    const formSchema = await formBuilderService.getFormSchema(competitionId);

    // Sanitize access key before returning (never expose tokenHash to client)
    const sanitizedKey: CompetitionAccessKey = {
      ...matchedKey,
      tokenHash: undefined,
    };

    return {
      valid: true,
      accessKey: sanitizedKey,
      session,
      formSchema,
      competition: comp,
    };
  },

  /**
   * Verifies an ephemeral session token presented during submission.
   */
  verifySession(sessionToken: string, now: Date = new Date()): SubmissionSessionToken | null {
    const session = localActiveSessions[sessionToken];
    if (!session) return null;

    if (now.getTime() > new Date(session.expiresAt).getTime()) {
      delete localActiveSessions[sessionToken];
      return null;
    }

    return session;
  },

  /**
   * Validates an ephemeral session token.
   */
  async validateSessionToken(
    sessionToken: string
  ): Promise<{ valid: boolean; session?: SubmissionSessionToken; error?: string }> {
    const session = this.verifySession(sessionToken);
    if (!session) {
      return { valid: false, error: 'Invalid or expired submission session.' };
    }
    return { valid: true, session };
  },

  /**
   * Increments the submissionsCount for the access key.
   */
  async recordSubmissionUse(keyId: string): Promise<void> {
    const key = await this.getAccessKey(keyId);
    if (!key) return;
    const updated = {
      ...key,
      submissionsCount: (key.submissionsCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    if (isFirebaseConfigured() && db) {
      try {
        await updateDoc(doc(db, 'accessKeys', keyId), {
          submissionsCount: updated.submissionsCount,
          updatedAt: updated.updatedAt,
        });
      } catch {
        // fallback
      }
    }
    const idx = localAccessKeys.findIndex((k) => k.id === keyId);
    if (idx !== -1) localAccessKeys[idx] = updated;
    saveAccessKeysToStorage();
  },

  /**
   * Resets local in-memory store (for testing).
   */
  resetInMemoryStore(keys: CompetitionAccessKey[] = []): void {
    localAccessKeys = [...keys];
    localActiveSessions = {};
    failedAttemptTimestamps = {};
  },

  clearMemoryStore(): void {
    localAccessKeys = [];
    localActiveSessions = {};
    failedAttemptTimestamps = {};
  },
};
