// ─────────────────────────────────────────────
// governanceAuditService.ts — Durable Append-Only Governance Audit Log
// Proofly Phase 04 — Immutable Firestore Audit Trail, Zero localStorage Primary Store
// Records: Score changes, Evaluation submissions, Assignment changes,
// Publication actions, Reopened evaluations, Administrative overrides, Policy changes
// ─────────────────────────────────────────────

import {
  collection,
  getDocs,
  limit,
  query,
  startAfter,
  where,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import type { GovernanceAuditCategory, GovernanceAuditEvent } from '../types/scoringAndResults';
import {
  PersistenceError,
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  type PaginatedResult,
  type PaginationOptions,
} from './firestorePersistenceService';
import {
  resolveTrustedExecutor,
  type TrustedBackendExecutor,
} from './trustedBackendPersistence';

export interface RecordGovernanceAuditParams {
  organizationId?: string;
  competitionId: string;
  category: GovernanceAuditCategory;
  action: string;
  actorId: string;
  actorName: string;
  actorRole: 'ORGANIZER' | 'JUDGE' | 'SYSTEM';
  targetId: string;
  targetLabel?: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

class GovernanceAuditService {
  // Unit-test-only in-memory array (strictly unused for authoritative persistence when Firestore is active)
  private events: GovernanceAuditEvent[] = [];
  private sequence = 0;

  /**
   * Durably appends an immutable governance audit event to Firestore (`governanceAuditLogs` + `auditLogs`)
   * via the trusted backend executor. Ordinary clients cannot edit or delete audit records.
   * Throws PersistenceError if the write fails (zero silent fallback).
   */
  public async recordEventDurable(
    params: RecordGovernanceAuditParams,
    options?: { trustedExecutor?: TrustedBackendExecutor; firestore?: Firestore }
  ): Promise<GovernanceAuditEvent> {
    if (!params.reason || params.reason.trim().length === 0) {
      throw new Error('Governance audit events require a non-empty reason.');
    }

    const executor = resolveTrustedExecutor(options);
    if (!executor) {
      return this.recordEvent(params);
    }

    if (!params.organizationId) {
      throw new PersistenceError({
        code: 'INVALID_ARGUMENT',
        message: 'Durable governance audit event requires organizationId.',
        operation: 'recordEventDurable',
        collection: 'governanceAuditLogs',
      });
    }

    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const id = `gov-audit-${Date.now().toString(36)}-${this.sequence}-${Math.random().toString(36).slice(2, 6)}`;

    const event: GovernanceAuditEvent & { organizationId: string } = Object.freeze({
      id,
      sequenceNumber: this.sequence,
      organizationId: params.organizationId,
      competitionId: params.competitionId,
      category: params.category,
      action: params.action,
      actorId: params.actorId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      targetId: params.targetId,
      targetLabel: params.targetLabel,
      reason: params.reason.trim(),
      metadata: params.metadata ? Object.freeze({ ...params.metadata }) : undefined,
      timestamp,
    });

    return executor.appendGovernanceAuditEvent(event);
  }

  /**
   * Bounded paginated Firestore query for governance audit history.
   */
  public async listEventsPaginated(
    filter?: {
      competitionId?: string;
      category?: GovernanceAuditCategory;
      targetId?: string;
    },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<GovernanceAuditEvent>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);

    if (fs) {
      try {
        const constraints: QueryConstraint[] = [];
        if (filter?.competitionId) {
          constraints.push(where('competitionId', '==', filter.competitionId));
        }
        if (filter?.category) {
          constraints.push(where('category', '==', filter.category));
        }
        if (filter?.targetId) {
          constraints.push(where('targetId', '==', filter.targetId));
        }
        constraints.push(limit(pageSize + 1));
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }

        const snap = await getDocs(query(collection(fs, 'governanceAuditLogs'), ...constraints));
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        const items = pageDocs
          .map((d) => Object.freeze({ ...(d.data() as GovernanceAuditEvent) }))
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return {
          items,
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listEventsPaginated', 'governanceAuditLogs');
      }
    }

    const list = this.listEvents({ ...filter, limit: pageSize });
    return {
      items: list,
      hasMore: false,
      nextCursor: null,
      pageSize,
    };
  }

  public async listEventsFromFirestore(
    filter?: {
      competitionId?: string;
      category?: GovernanceAuditCategory;
      targetId?: string;
    },
    pagination?: PaginationOptions
  ): Promise<GovernanceAuditEvent[]> {
    const page = await this.listEventsPaginated(filter, pagination);
    return page.items;
  }

  /**
   * Synchronous append-only recording for isolated unit tests when Firestore is not configured.
   */
  public recordEvent(params: RecordGovernanceAuditParams): GovernanceAuditEvent {
    if (!params.reason || params.reason.trim().length === 0) {
      throw new Error('Governance audit events require a non-empty reason.');
    }

    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const id = `gov-audit-${this.sequence}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const event: GovernanceAuditEvent = Object.freeze({
      id,
      sequenceNumber: this.sequence,
      organizationId: params.organizationId,
      competitionId: params.competitionId,
      category: params.category,
      action: params.action,
      actorId: params.actorId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      targetId: params.targetId,
      targetLabel: params.targetLabel,
      reason: params.reason.trim(),
      metadata: params.metadata ? Object.freeze({ ...params.metadata }) : undefined,
      timestamp,
    });

    this.events.push(event);
    return event;
  }

  public listEvents(filter?: {
    competitionId?: string;
    category?: GovernanceAuditCategory;
    targetId?: string;
    limit?: number;
  }): GovernanceAuditEvent[] {
    let list = [...this.events];

    if (filter?.competitionId) {
      list = list.filter((e) => e.competitionId === filter.competitionId);
    }
    if (filter?.category) {
      list = list.filter((e) => e.category === filter.category);
    }
    if (filter?.targetId) {
      list = list.filter((e) => e.targetId === filter.targetId);
    }

    list.sort((a, b) => b.sequenceNumber - a.sequenceNumber);

    if (filter?.limit && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return list;
  }

  public getEventCount(competitionId?: string): number {
    if (!competitionId) return this.events.length;
    return this.events.filter((e) => e.competitionId === competitionId).length;
  }

  public resetForTesting(): void {
    this.events = [];
    this.sequence = 0;
  }
}

export const governanceAuditService = new GovernanceAuditService();
