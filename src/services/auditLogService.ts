// ─────────────────────────────────────────────
// Audit Log Service — Immutable Admin & Grading Audit Trail
// Proofly Phase 04 — Bounded Firestore Reads, Zero Silent Write Fallbacks
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDocs,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  type Unsubscribe,
  type QueryConstraint,
} from 'firebase/firestore';
import {
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  type FirestoreExecutionOptions,
  type PaginatedResult,
  type PaginationOptions,
} from './firestorePersistenceService';
import type { AdminAuditLog } from '../types';

const COLLECTION_NAME = 'auditLogs';

export const initialMockAuditLogs: AdminAuditLog[] = [];

// Unit-test-only in-memory store (unused when Firestore is active)
let inMemoryAuditLogs: AdminAuditLog[] = [...initialMockAuditLogs];
const listeners = new Set<(logs: AdminAuditLog[]) => void>();

export const auditLogService = {
  /**
   * Fetches a bounded, paginated slice of immutable audit logs from Firestore.
   * Throws PersistenceError on Firestore read failure (never returns stale fake records).
   */
  async getAuditLogsPaginated(
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<AdminAuditLog>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);

    if (!fs) {
      const sorted = [...inMemoryAuditLogs].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      return {
        items: sorted.slice(0, pageSize),
        hasMore: sorted.length > pageSize,
        nextCursor: null,
        pageSize,
      };
    }

    try {
      const constraints: QueryConstraint[] = [orderBy('timestamp', 'desc'), limit(pageSize + 1)];
      if (pagination?.cursor) {
        constraints.push(startAfter(pagination.cursor));
      }
      const snapshot = await getDocs(query(collection(fs, COLLECTION_NAME), ...constraints));
      const hasMore = snapshot.docs.length > pageSize;
      const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
      return {
        items: pageDocs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminAuditLog, 'id'>) })),
        hasMore,
        nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
        pageSize,
      };
    } catch (err) {
      throw mapFirestoreError(err, 'getAuditLogsPaginated', COLLECTION_NAME);
    }
  },

  async getAuditLogs(
    maxCount: number = 50,
    options?: FirestoreExecutionOptions
  ): Promise<AdminAuditLog[]> {
    const page = await this.getAuditLogsPaginated({
      pageSize: maxCount,
      firestore: options?.firestore,
    });
    return page.items;
  },

  /**
   * Subscribes to bounded live audit logs in real time (clamped via clampPageSize).
   */
  subscribeToAuditLogs(
    onUpdate: (logs: AdminAuditLog[]) => void,
    maxCount: number = 50,
    onError?: (err: Error) => void,
    options?: FirestoreExecutionOptions
  ): Unsubscribe {
    const bounded = clampPageSize(maxCount);
    const fs = resolveFirestore(options?.firestore);

    if (!fs) {
      listeners.add(onUpdate);
      const sorted = [...inMemoryAuditLogs]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, bounded);
      onUpdate(sorted);
      return () => {
        listeners.delete(onUpdate);
      };
    }

    const q = query(collection(fs, COLLECTION_NAME), orderBy('timestamp', 'desc'), limit(bounded));
    return onSnapshot(
      q,
      (snapshot) => {
        const logs = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AdminAuditLog, 'id'>),
        })) as AdminAuditLog[];
        onUpdate(logs);
      },
      (error) => {
        const mapped = mapFirestoreError(error, 'subscribeToAuditLogs', COLLECTION_NAME);
        onError?.(mapped);
      }
    );
  },

  /**
   * Persists an audit log entry durably to Firestore (throws PersistenceError on failure;
   * ordinary clients are rejected by firestore.rules and never get fake success).
   */
  async recordAuditLog(
    log: AdminAuditLog,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (!fs) {
      inMemoryAuditLogs.unshift(log);
      listeners.forEach((fn) => fn([...inMemoryAuditLogs]));
      return;
    }

    try {
      await setDoc(doc(fs, COLLECTION_NAME, log.id), {
        ...log,
        serverTimestamp: serverTimestamp(),
      });
    } catch (err) {
      throw mapFirestoreError(err, 'recordAuditLog', COLLECTION_NAME);
    }
  },
};
