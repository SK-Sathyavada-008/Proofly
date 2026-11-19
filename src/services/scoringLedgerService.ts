// ─────────────────────────────────────────────
// scoringLedgerService.ts — Durable Append-Only Scoring Contribution Ledger
// Proofly Phase 04 — Trusted Backend Transactional Writes, Zero localStorage Primary Store
// STRICT RULE: Append-only immutable records. Historical score contributions are NEVER overwritten.
// Corrections MUST create explicit auditable adjustment records linking previousEntryId.
// ─────────────────────────────────────────────

import {
  collection,
  getDocs,
  limit,
  query,
  startAfter,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import type { ScoreContributionSource, ScoreLedgerEntry } from '../types/scoringAndResults';
import { governanceAuditService } from './governanceAuditService';
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

export interface AppendScoreContributionInput {
  organizationId?: string;
  competitionId: string;
  entryId: string;
  referenceId?: string;
  evaluationId: string;
  runId?: string;
  rubricVersion?: number;
  criterionId: string;
  criterionName?: string;
  score: number;
  maxScore: number;
  previousScore?: number;
  source: ScoreContributionSource;
  actorId: string;
  actorName: string;
  reasonForAdjustment: string;
  roundId?: string;
  isAdjustment?: boolean;
  previousEntryId?: string;
  /** Internal trusted workflow token to guard against raw client official score tampering. */
  authorizedSource?: 'EVALUATION_PIPELINE' | 'JUDGE_SUBMISSION' | 'ORGANIZER_AUTHORIZED_WORKFLOW';
}

export interface DurableLedgerOptions {
  trustedExecutor?: TrustedBackendExecutor;
  firestore?: import('firebase/firestore').Firestore;
}

class ScoringLedgerService {
  // Unit-test-only in-memory array (strictly unused for authoritative persistence when Firestore is active)
  private entries: ScoreLedgerEntry[] = [];
  private sequence = 0;

  /**
   * Deterministic base ID preventing duplicate contributions for the same
   * (evaluationId, criterionId, source) tuple.
   */
  public makeDeterministicBaseId(
    evaluationId: string,
    criterionId: string,
    source: ScoreContributionSource
  ): string {
    const safeEval = evaluationId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeCrit = criterionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `sc_${safeEval}_${safeCrit}_${source.toLowerCase()}`;
  }

  private validateInput(input: AppendScoreContributionInput): void {
    if (!input.authorizedSource) {
      throw new Error(
        'Direct client modification of official score ledger is prohibited. Contributions must flow through an authorized evaluation or organizer workflow.'
      );
    }
    if (!input.competitionId || !input.entryId || !input.evaluationId || !input.criterionId) {
      throw new Error('Ledger contribution requires competitionId, entryId, evaluationId, and criterionId.');
    }
    if (typeof input.score !== 'number' || Number.isNaN(input.score) || input.score < 0) {
      throw new Error(`Invalid score value (${input.score}): score must be a non-negative number.`);
    }
    if (typeof input.maxScore !== 'number' || Number.isNaN(input.maxScore) || input.maxScore <= 0) {
      throw new Error(`Invalid maxScore value (${input.maxScore}): maxScore must be > 0.`);
    }
    if (input.score > input.maxScore) {
      throw new Error(`Score (${input.score}) cannot exceed maximum score (${input.maxScore}).`);
    }
    if (input.source !== 'AI' && input.source !== 'HUMAN') {
      throw new Error(`Invalid ledger source "${input.source}". Must be "AI" or "HUMAN".`);
    }
    if (!input.actorId || !input.actorName) {
      throw new Error('Ledger contribution requires actorId and actorName.');
    }
    if (!input.reasonForAdjustment || input.reasonForAdjustment.trim().length === 0) {
      throw new Error('Ledger contribution requires a non-empty reasonForAdjustment.');
    }
  }

  /**
   * Durably appends an immutable score contribution via the trusted backend Firestore executor.
   * - Prevents duplicate base contributions (same evaluationId + criterionId + source).
   * - Requires previousEntryId when `isAdjustment === true` and never overwrites prior entries.
   * - Appends an immutable governance audit record for adjustments and organizer overrides.
   * - Throws explicit PersistenceError on failure (zero silent fallback).
   */
  public async appendContributionDurable(
    input: AppendScoreContributionInput,
    options?: DurableLedgerOptions
  ): Promise<ScoreLedgerEntry> {
    this.validateInput(input);

    const executor = resolveTrustedExecutor(options);
    if (!executor) {
      // Isolated unit test harness (no Firestore configured or injected)
      return this.appendContribution(input);
    }

    if (!input.organizationId) {
      throw new PersistenceError({
        code: 'INVALID_ARGUMENT',
        message: 'Durable ledger contribution requires organizationId for strict tenant isolation.',
        operation: 'appendContributionDurable',
        collection: 'scoreContributions',
      });
    }

    if (input.isAdjustment && !input.previousEntryId) {
      throw new PersistenceError({
        code: 'INVALID_ARGUMENT',
        message: 'Auditable score adjustments must link the previousEntryId being corrected.',
        operation: 'appendContributionDurable',
        collection: 'scoreContributions',
      });
    }

    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const id = input.isAdjustment
      ? `sc_adj_${input.evaluationId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${input.criterionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      : this.makeDeterministicBaseId(input.evaluationId, input.criterionId, input.source);

    const entry: ScoreLedgerEntry & {
      organizationId: string;
      rubricVersion?: number;
      runId?: string;
    } = Object.freeze({
      id,
      sequenceNumber: this.sequence,
      organizationId: input.organizationId,
      competitionId: input.competitionId,
      entryId: input.entryId,
      referenceId: input.referenceId,
      evaluationId: input.evaluationId,
      runId: input.runId,
      rubricVersion: input.rubricVersion ?? 1,
      criterionId: input.criterionId,
      criterionName: input.criterionName,
      score: Math.round(input.score * 100) / 100,
      maxScore: input.maxScore,
      previousScore: input.previousScore,
      source: input.source,
      actorId: input.actorId,
      actorName: input.actorName,
      timestamp,
      reasonForAdjustment: input.reasonForAdjustment.trim(),
      roundId: input.roundId,
      isAdjustment: Boolean(input.isAdjustment),
      previousEntryId: input.previousEntryId,
    });

    const persisted = await executor.appendScoreContribution(entry);

    if (entry.isAdjustment || input.authorizedSource === 'ORGANIZER_AUTHORIZED_WORKFLOW') {
      await governanceAuditService.recordEventDurable(
        {
          organizationId: input.organizationId,
          competitionId: entry.competitionId,
          category: 'SCORE_CHANGE',
          action: entry.isAdjustment
            ? 'LEDGER_SCORE_ADJUSTMENT_APPENDED'
            : 'LEDGER_SCORE_CONTRIBUTION_RECORDED',
          actorId: entry.actorId,
          actorName: entry.actorName,
          actorRole:
            input.authorizedSource === 'ORGANIZER_AUTHORIZED_WORKFLOW'
              ? 'ORGANIZER'
              : entry.source === 'HUMAN'
              ? 'JUDGE'
              : 'SYSTEM',
          targetId: entry.entryId,
          targetLabel: entry.referenceId || entry.entryId,
          reason: entry.reasonForAdjustment,
          metadata: {
            ledgerEntryId: entry.id,
            evaluationId: entry.evaluationId,
            criterionId: entry.criterionId,
            previousEntryId: entry.previousEntryId,
            newScore: entry.score,
            maxScore: entry.maxScore,
            source: entry.source,
            rubricVersion: entry.rubricVersion,
          },
        },
        { trustedExecutor: executor }
      );
    }

    return persisted;
  }

  public async appendBatchContributionsDurable(
    inputs: AppendScoreContributionInput[],
    options?: DurableLedgerOptions
  ): Promise<ScoreLedgerEntry[]> {
    const results: ScoreLedgerEntry[] = [];
    for (const item of inputs) {
      results.push(await this.appendContributionDurable(item, options));
    }
    return results;
  }

  /**
   * Paginated Firestore query for authoritative score contributions.
   */
  public async listEntriesPaginated(
    filter?: {
      competitionId?: string;
      entryId?: string;
      evaluationId?: string;
      source?: ScoreContributionSource;
      order?: 'ASC' | 'DESC';
    },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<ScoreLedgerEntry>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);

    if (fs) {
      try {
        const constraints: QueryConstraint[] = [];
        if (filter?.competitionId) {
          constraints.push(where('competitionId', '==', filter.competitionId));
        }
        if (filter?.entryId) {
          constraints.push(where('entryId', '==', filter.entryId));
        }
        if (filter?.evaluationId) {
          constraints.push(where('evaluationId', '==', filter.evaluationId));
        }
        if (filter?.source) {
          constraints.push(where('source', '==', filter.source));
        }
        constraints.push(limit(pageSize + 1));
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }

        const snap = await getDocs(query(collection(fs, 'scoreContributions'), ...constraints));
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        const items = pageDocs.map((d) => Object.freeze({ ...(d.data() as ScoreLedgerEntry) }));
        const order = filter?.order || 'DESC';
        items.sort((a, b) =>
          order === 'ASC'
            ? (a.sequenceNumber || 0) - (b.sequenceNumber || 0)
            : (b.sequenceNumber || 0) - (a.sequenceNumber || 0)
        );

        return {
          items,
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listEntriesPaginated', 'scoreContributions');
      }
    }

    const list = [...this.listEntries(filter)];
    return {
      items: list.slice(0, pageSize),
      hasMore: list.length > pageSize,
      nextCursor: null,
      pageSize,
    };
  }

  public async listEntriesFromFirestore(
    filter?: {
      competitionId?: string;
      entryId?: string;
      evaluationId?: string;
      source?: ScoreContributionSource;
      order?: 'ASC' | 'DESC';
    },
    pagination?: PaginationOptions
  ): Promise<readonly ScoreLedgerEntry[]> {
    const page = await this.listEntriesPaginated(filter, pagination);
    return Object.freeze(page.items);
  }

  /**
   * Synchronous in-memory append used exclusively by unit tests when Firestore is not configured.
   */
  public appendContribution(input: AppendScoreContributionInput): ScoreLedgerEntry {
    this.validateInput(input);

    const prior = [...this.entries]
      .reverse()
      .find(
        (e) =>
          e.competitionId === input.competitionId &&
          e.entryId === input.entryId &&
          e.evaluationId === input.evaluationId &&
          e.criterionId === input.criterionId &&
          e.source === input.source
      );

    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const id = `ledger-${this.sequence}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const entry: ScoreLedgerEntry = Object.freeze({
      id,
      sequenceNumber: this.sequence,
      organizationId: input.organizationId,
      competitionId: input.competitionId,
      entryId: input.entryId,
      referenceId: input.referenceId,
      evaluationId: input.evaluationId,
      runId: input.runId,
      rubricVersion: input.rubricVersion ?? 1,
      criterionId: input.criterionId,
      criterionName: input.criterionName,
      score: Math.round(input.score * 100) / 100,
      maxScore: input.maxScore,
      previousScore: input.previousScore ?? prior?.score,
      source: input.source,
      actorId: input.actorId,
      actorName: input.actorName,
      timestamp,
      reasonForAdjustment: input.reasonForAdjustment.trim(),
      roundId: input.roundId,
      isAdjustment: input.isAdjustment ?? Boolean(prior),
      previousEntryId: input.previousEntryId ?? prior?.id,
    });

    this.entries.push(entry);

    if (entry.isAdjustment || input.authorizedSource === 'ORGANIZER_AUTHORIZED_WORKFLOW') {
      governanceAuditService.recordEvent({
        organizationId: entry.organizationId,
        competitionId: entry.competitionId,
        category: 'SCORE_CHANGE',
        action: entry.isAdjustment ? 'LEDGER_SCORE_ADJUSTMENT_APPENDED' : 'LEDGER_SCORE_CONTRIBUTION_RECORDED',
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorRole:
          input.authorizedSource === 'ORGANIZER_AUTHORIZED_WORKFLOW'
            ? 'ORGANIZER'
            : entry.source === 'HUMAN'
            ? 'JUDGE'
            : 'SYSTEM',
        targetId: entry.entryId,
        targetLabel: entry.referenceId || entry.entryId,
        reason: entry.reasonForAdjustment,
        metadata: {
          ledgerEntryId: entry.id,
          evaluationId: entry.evaluationId,
          criterionId: entry.criterionId,
          previousScore: prior?.score,
          newScore: entry.score,
          maxScore: entry.maxScore,
          source: entry.source,
        },
      });
    }

    return entry;
  }

  public appendBatchContributions(inputs: AppendScoreContributionInput[]): ScoreLedgerEntry[] {
    return inputs.map((item) => this.appendContribution(item));
  }

  public listEntries(filter?: {
    competitionId?: string;
    entryId?: string;
    evaluationId?: string;
    source?: ScoreContributionSource;
    order?: 'ASC' | 'DESC';
  }): readonly ScoreLedgerEntry[] {
    let list = [...this.entries];

    if (filter?.competitionId) {
      list = list.filter((e) => e.competitionId === filter.competitionId);
    }
    if (filter?.entryId) {
      list = list.filter((e) => e.entryId === filter.entryId);
    }
    if (filter?.evaluationId) {
      list = list.filter((e) => e.evaluationId === filter.evaluationId);
    }
    if (filter?.source) {
      list = list.filter((e) => e.source === filter.source);
    }

    const order = filter?.order || 'DESC';
    list.sort((a, b) => (order === 'ASC' ? a.sequenceNumber - b.sequenceNumber : b.sequenceNumber - a.sequenceNumber));

    return Object.freeze(list);
  }

  public getCount(competitionId?: string): number {
    if (!competitionId) return this.entries.length;
    return this.entries.filter((e) => e.competitionId === competitionId).length;
  }

  public resetForTesting(): void {
    this.entries = [];
    this.sequence = 0;
  }
}

export const scoringLedgerService = new ScoringLedgerService();
