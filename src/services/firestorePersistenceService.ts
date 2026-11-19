// ─────────────────────────────────────────────
// firestorePersistenceService.ts — Core Durable Firestore Persistence Primitives
// Proofly Phase 04 — Zero Silent Fallbacks, Server Timestamps & Bounded Pagination
// ─────────────────────────────────────────────

import {
  serverTimestamp,
  type Firestore,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db as defaultDb, isFirebaseConfigured } from '../config/firebase';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type PersistenceErrorCode =
  | 'PERMISSION_DENIED'
  | 'UNAUTHENTICATED'
  | 'UNAVAILABLE'
  | 'CONFLICT'
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'QUOTA_EXCEEDED'
  | 'BACKEND_REQUIRED'
  | 'UNKNOWN';

export class PersistenceError extends Error {
  public readonly code: PersistenceErrorCode;
  public readonly operation: string;
  public readonly collection: string;
  public readonly retryable: boolean;
  public readonly cause?: unknown;

  constructor(params: {
    code: PersistenceErrorCode;
    message: string;
    operation: string;
    collection: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = 'PersistenceError';
    this.code = params.code;
    this.operation = params.operation;
    this.collection = params.collection;
    this.retryable = params.retryable ?? false;
    this.cause = params.cause;
  }
}

export interface FirestoreExecutionOptions {
  /** Explicit Firestore instance override (used by multi-device Emulator tests & trusted workers). */
  firestore?: Firestore;
}

export interface PaginationOptions extends FirestoreExecutionOptions {
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
}

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
  pageSize: number;
}

/**
 * Clamps requested page size to safe bounded limits so no collection read is unbounded.
 */
export function clampPageSize(requested?: number): number {
  if (!requested || Number.isNaN(requested) || requested <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}

/**
 * Resolves the active Firestore instance.
 * - Returns `override` when supplied (e.g., Emulator test client or backend context).
 * - Returns default `db` whenever Firebase is configured in production/dev.
 * - Returns `null` ONLY in isolated unit-test environments without Firebase configured.
 */
export function resolveFirestore(override?: Firestore): Firestore | null {
  if (override) return override;
  if (isFirebaseConfigured() && defaultDb) return defaultDb;
  return null;
}

/**
 * Maps any Firestore SDK error into an explicit PersistenceError.
 * NEVER suppresses failures or converts them into silent local fallbacks.
 */
export function mapFirestoreError(
  err: unknown,
  operation: string,
  collection: string
): PersistenceError {
  if (err instanceof PersistenceError) return err;

  const rawCode = String((err as { code?: string })?.code || '').toLowerCase();
  const rawMessage = (err as { message?: string })?.message || String(err);

  if (rawCode.includes('permission-denied') || /permission[_ -]?denied|missing or insufficient permissions/i.test(rawMessage)) {
    return new PersistenceError({
      code: 'PERMISSION_DENIED',
      message: `Permission denied during ${operation} on "${collection}". Verify authentication, tenant membership, and role authorization.`,
      operation,
      collection,
      retryable: false,
      cause: err,
    });
  }

  if (rawCode.includes('unauthenticated')) {
    return new PersistenceError({
      code: 'UNAUTHENTICATED',
      message: `Authentication required for ${operation} on "${collection}".`,
      operation,
      collection,
      retryable: false,
      cause: err,
    });
  }

  if (rawCode.includes('already-exists')) {
    return new PersistenceError({
      code: 'ALREADY_EXISTS',
      message: `Duplicate record conflict during ${operation} on "${collection}".`,
      operation,
      collection,
      retryable: false,
      cause: err,
    });
  }

  if (rawCode.includes('not-found')) {
    return new PersistenceError({
      code: 'NOT_FOUND',
      message: `Record not found during ${operation} on "${collection}".`,
      operation,
      collection,
      retryable: false,
      cause: err,
    });
  }

  if (rawCode.includes('resource-exhausted')) {
    return new PersistenceError({
      code: 'QUOTA_EXCEEDED',
      message: `Firestore quota exceeded during ${operation} on "${collection}".`,
      operation,
      collection,
      retryable: true,
      cause: err,
    });
  }

  if (
    rawCode.includes('aborted') ||
    rawCode.includes('failed-precondition') ||
    rawCode.includes('conflict')
  ) {
    return new PersistenceError({
      code: 'CONFLICT',
      message: `Transaction conflict during ${operation} on "${collection}": ${rawMessage}`,
      operation,
      collection,
      retryable: true,
      cause: err,
    });
  }

  if (
    rawCode.includes('unavailable') ||
    rawCode.includes('deadline-exceeded') ||
    /network|offline|timeout|unavailable/i.test(rawMessage)
  ) {
    return new PersistenceError({
      code: 'UNAVAILABLE',
      message: `Firestore temporarily unavailable during ${operation} on "${collection}". Your changes were NOT saved; please retry.`,
      operation,
      collection,
      retryable: true,
      cause: err,
    });
  }

  if (rawCode.includes('invalid-argument')) {
    return new PersistenceError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid data rejected by Firestore during ${operation} on "${collection}": ${rawMessage}`,
      operation,
      collection,
      retryable: false,
      cause: err,
    });
  }

  return new PersistenceError({
    code: 'UNKNOWN',
    message: `Firestore ${operation} failed on "${collection}": ${rawMessage}`,
    operation,
    collection,
    retryable: false,
    cause: err,
  });
}

/**
 * Attaches authoritative Firestore serverTimestamp() fields to a write payload
 * while preserving ISO timestamp fields used across UI components.
 */
export function withServerTimestamps(
  data: object,
  isCreate: boolean
): Record<string, any> {
  const stamped: Record<string, any> = {
    ...(data as Record<string, any>),
    serverUpdatedAt: serverTimestamp(),
  };
  if (isCreate) {
    stamped.serverCreatedAt = serverTimestamp();
  }
  return stamped;
}
