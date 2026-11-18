// ─────────────────────────────────────────────
// governanceAuditService.ts — Immutable Phase 8 Governance Audit Log
// Records: Score changes, Evaluation submissions, Assignment changes,
// Publication actions, Reopened evaluations, Administrative overrides, Policy changes
// ─────────────────────────────────────────────

import type { GovernanceAuditCategory, GovernanceAuditEvent } from '../types/scoringAndResults';
import { auditLogService } from './auditLogService';
import { purgeLegacySampleStorageOnce } from '../utils/cleanSampleStorage';

const STORAGE_KEY = 'proofly_governance_audit_v1';

class GovernanceAuditService {
  private events: GovernanceAuditEvent[] = [];
  private sequence = 0;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    purgeLegacySampleStorageOnce();
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as GovernanceAuditEvent[];
        if (Array.isArray(parsed)) {
          this.events = parsed.map((e) => Object.freeze({ ...e }));
          this.sequence = this.events.reduce((max, e) => Math.max(max, e.sequenceNumber || 0), 0);
        }
      }
    } catch {
      // Ignore storage errors in non-browser/private contexts
    }
  }

  private saveToStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Append-only audit event recording. Existing events can never be modified or deleted.
   */
  public recordEvent(params: {
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
  }): GovernanceAuditEvent {
    if (!params.reason || params.reason.trim().length === 0) {
      throw new Error('Governance audit events require a non-empty reason.');
    }

    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const id = `gov-audit-${this.sequence}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const event: GovernanceAuditEvent = Object.freeze({
      id,
      sequenceNumber: this.sequence,
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
    this.saveToStorage();

    // Mirror into legacy AdminAuditLog store asynchronously without blocking
    auditLogService
      .recordAuditLog({
        id: event.id,
        action: 'SCORE_OVERRIDE',
        performedBy: event.actorId,
        adminUsername: event.actorName,
        targetId: event.targetId,
        targetName: event.targetLabel || event.targetId,
        reason: `[${event.category}:${event.action}] ${event.reason}`,
        timestamp: event.timestamp,
        details: {
          competitionId: event.competitionId,
          governanceCategory: event.category,
          governanceAction: event.action,
          actorRole: event.actorRole,
          ...(params.metadata || {}),
        },
      })
      .catch(() => {
        // Ignore mirror failures
      });

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

    // Most recent first (descending sequenceNumber)
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
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
  }
}

export const governanceAuditService = new GovernanceAuditService();
