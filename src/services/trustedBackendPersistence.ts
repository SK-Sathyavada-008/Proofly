// ─────────────────────────────────────────────
// trustedBackendPersistence.ts — Trusted Backend Operations for Immutable Collections
// Proofly Phase 04 — Append-Only Score Ledger, Leaderboard Snapshots & Audit Trail
//
// Security invariant:
// Client security rules (`firestore.rules`) strictly deny direct client writes to:
//   - /scoreContributions & /scoringLedger
//   - /leaderboardSnapshots & /resultPublications
//   - /governanceAuditLogs & /auditLogs
//
// All authoritative writes to those collections MUST flow through a trusted backend
// executor (e.g., Firebase Cloud Function / Admin SDK worker / verified test runner).
// If no trusted backend executor is configured and a client attempts a direct write,
// Firestore rules reject it and an explicit PersistenceError is thrown — NEVER faking success.
// ─────────────────────────────────────────────

import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  PersistenceError,
  mapFirestoreError,
  resolveFirestore,
} from './firestorePersistenceService';
import type {
  GovernanceAuditEvent,
  ResultPublicationRecord,
  ScoreLedgerEntry,
} from '../types/scoringAndResults';

export interface TrustedBackendExecutor {
  /**
   * Atomically appends an immutable score contribution into Firestore (`scoreContributions` + `scoringLedger`).
   * Rejects duplicate non-adjustment contributions for the same deterministic key.
   * NEVER overwrites historical records.
   */
  appendScoreContribution(
    entry: ScoreLedgerEntry & { organizationId: string; rubricVersion?: number; runId?: string }
  ): Promise<ScoreLedgerEntry>;

  /**
   * Atomically writes an immutable versioned leaderboard snapshot (`leaderboardSnapshots/{id}`)
   * and updates the official publication pointer (`resultPublications/{competitionId}`).
   */
  persistResultPublication(
    record: ResultPublicationRecord & { organizationId: string; isPublic: boolean }
  ): Promise<ResultPublicationRecord>;

  /**
   * Appends an immutable governance audit event (`governanceAuditLogs/{eventId}`).
   * Rejects overwrites via transaction existence check.
   */
  appendGovernanceAuditEvent(
    event: GovernanceAuditEvent & { organizationId: string }
  ): Promise<GovernanceAuditEvent>;
}

let activeTrustedExecutor: TrustedBackendExecutor | null = null;

/**
 * Registers a trusted backend executor (e.g., server worker, Cloud Function proxy,
 * or Emulator Admin runner). Pass `null` to clear.
 */
export function setTrustedBackendExecutor(executor: TrustedBackendExecutor | null): void {
  activeTrustedExecutor = executor;
}

export function getTrustedBackendExecutor(): TrustedBackendExecutor | null {
  return activeTrustedExecutor;
}

/**
 * Creates a real transactional Firestore TrustedBackendExecutor bound to a trusted Firestore
 * instance (e.g. Admin SDK / rules-disabled Emulator runner / backend service account).
 *
 * Guarantees:
 * - Deterministic duplicate prevention via Firestore transactions (`if (snap.exists()) throw ALREADY_EXISTS`).
 * - Append-only immutability (never overwrites prior contributions or audit events).
 * - Authoritative `serverTimestamp()` stamped on every written document.
 */
export function createTransactionalFirestoreBackendExecutor(
  trustedDb: Firestore
): TrustedBackendExecutor {
  return {
    async appendScoreContribution(entry) {
      const targetDocId = entry.id;
      const contribRef = doc(trustedDb, 'scoreContributions', targetDocId);
      const ledgerRef = doc(trustedDb, 'scoringLedger', targetDocId);

      try {
        await runTransaction(trustedDb, async (tx) => {
          const existing = await tx.get(contribRef);
          if (existing.exists()) {
            throw new PersistenceError({
              code: 'ALREADY_EXISTS',
              message: `Duplicate score contribution "${targetDocId}" rejected. Historical score contributions cannot be overwritten; append an explicit adjustment record instead.`,
              operation: 'appendScoreContribution',
              collection: 'scoreContributions',
              retryable: false,
            });
          }

          // If this is an adjustment referencing a prior entry, verify the prior entry exists
          if (entry.isAdjustment && entry.previousEntryId) {
            const priorRef = doc(trustedDb, 'scoreContributions', entry.previousEntryId);
            const priorSnap = await tx.get(priorRef);
            if (!priorSnap.exists()) {
              throw new PersistenceError({
                code: 'NOT_FOUND',
                message: `Cannot append adjustment: previous score contribution "${entry.previousEntryId}" does not exist.`,
                operation: 'appendScoreContribution',
                collection: 'scoreContributions',
                retryable: false,
              });
            }
          }

          const payload = sanitizeFirestoreData({
            ...entry,
            serverTimestamp: serverTimestamp(),
          });

          tx.set(contribRef, payload);
          tx.set(ledgerRef, payload);
        });

        return Object.freeze({ ...entry });
      } catch (err) {
        throw mapFirestoreError(err, 'appendScoreContribution', 'scoreContributions');
      }
    },

    async persistResultPublication(record) {
      const snapshotId = `${record.competitionId}_v${record.version}`;
      const snapshotRef = doc(trustedDb, 'leaderboardSnapshots', snapshotId);
      const publicationRef = doc(trustedDb, 'resultPublications', record.competitionId);

      try {
        await runTransaction(trustedDb, async (tx) => {
          const existingSnap = await tx.get(snapshotRef);
          if (existingSnap.exists() && record.status === 'PUBLISHED') {
            throw new PersistenceError({
              code: 'ALREADY_EXISTS',
              message: `Leaderboard snapshot "${snapshotId}" already exists. Increment version for a new publication.`,
              operation: 'persistResultPublication',
              collection: 'leaderboardSnapshots',
              retryable: false,
            });
          }

          const stamped = sanitizeFirestoreData({
            ...record,
            snapshotId,
            serverUpdatedAt: serverTimestamp(),
            ...(record.status === 'PUBLISHED' ? { serverPublishedAt: serverTimestamp() } : {}),
          });

          if (!existingSnap.exists()) {
            tx.set(snapshotRef, stamped);
          }
          tx.set(publicationRef, stamped);
        });

        return record;
      } catch (err) {
        throw mapFirestoreError(err, 'persistResultPublication', 'leaderboardSnapshots');
      }
    },

    async appendGovernanceAuditEvent(event) {
      const eventRef = doc(trustedDb, 'governanceAuditLogs', event.id);
      const auditRef = doc(trustedDb, 'auditLogs', event.id);

      try {
        await runTransaction(trustedDb, async (tx) => {
          const existing = await tx.get(eventRef);
          if (existing.exists()) {
            throw new PersistenceError({
              code: 'ALREADY_EXISTS',
              message: `Audit log event "${event.id}" already exists and cannot be overwritten.`,
              operation: 'appendGovernanceAuditEvent',
              collection: 'governanceAuditLogs',
              retryable: false,
            });
          }

          const stampedGov = sanitizeFirestoreData({
            ...event,
            serverTimestamp: serverTimestamp(),
          });
          const stampedAudit = sanitizeFirestoreData({
            id: event.id,
            organizationId: event.organizationId,
            competitionId: event.competitionId,
            action: event.action,
            category: event.category,
            performedBy: event.actorId,
            adminUsername: event.actorName,
            actorRole: event.actorRole,
            targetId: event.targetId,
            targetName: event.targetLabel || event.targetId,
            reason: event.reason,
            timestamp: event.timestamp,
            serverTimestamp: serverTimestamp(),
            details: event.metadata || {},
          });

          tx.set(eventRef, stampedGov);
          tx.set(auditRef, stampedAudit);
        });

        return Object.freeze({ ...event });
      } catch (err) {
        throw mapFirestoreError(err, 'appendGovernanceAuditEvent', 'governanceAuditLogs');
      }
    },
  };
}

/**
 * Resolves the executor for trusted backend writes:
 * - Uses explicitly supplied `executor` or globally registered `activeTrustedExecutor`.
 * - If a client `firestore` instance is present without a trusted backend executor,
 *   creates a direct Firestore executor so `firestore.rules` enforces denial honestly
 *   (throwing `PersistenceError(PERMISSION_DENIED)` instead of silently faking success).
 */
export function resolveTrustedExecutor(options?: {
  trustedExecutor?: TrustedBackendExecutor;
  firestore?: Firestore;
}): TrustedBackendExecutor | null {
  if (options?.trustedExecutor) return options.trustedExecutor;
  if (activeTrustedExecutor) return activeTrustedExecutor;
  const fs = resolveFirestore(options?.firestore);
  if (fs) {
    return createTransactionalFirestoreBackendExecutor(fs);
  }
  return null;
}
