// ─────────────────────────────────────────────
// scoringLedgerService.ts — Append-Only Scoring Contribution Ledger
// Proofly / Evalora — Phase 8: Scoring, Results & Analytics
// STRICT RULE: Append-only immutable records. Frontend clients cannot directly
// edit or overwrite official scores.
// ─────────────────────────────────────────────

import type { ScoreContributionSource, ScoreLedgerEntry } from '../types/scoringAndResults';
import { governanceAuditService } from './governanceAuditService';
import { purgeLegacySampleStorageOnce } from '../utils/cleanSampleStorage';

const STORAGE_KEY = 'proofly_scoring_ledger_v1';

export interface AppendScoreContributionInput {
  competitionId: string;
  entryId: string;
  referenceId?: string;
  evaluationId: string;
  criterionId: string;
  criterionName?: string;
  score: number;
  maxScore: number;
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

class ScoringLedgerService {
  private entries: ScoreLedgerEntry[] = [];
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
        const parsed = JSON.parse(raw) as ScoreLedgerEntry[];
        if (Array.isArray(parsed)) {
          this.entries = parsed.map((e) => Object.freeze({ ...e }));
          this.sequence = this.entries.reduce((max, e) => Math.max(max, e.sequenceNumber || 0), 0);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Appends a single immutable score contribution record to the ledger.
   * Never modifies or deletes existing ledger records.
   */
  public appendContribution(input: AppendScoreContributionInput): ScoreLedgerEntry {
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

    // Check if there was a prior contribution for the same (competitionId, entryId, evaluationId, criterionId)
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
      competitionId: input.competitionId,
      entryId: input.entryId,
      referenceId: input.referenceId,
      evaluationId: input.evaluationId,
      criterionId: input.criterionId,
      criterionName: input.criterionName,
      score: Math.round(input.score * 100) / 100,
      maxScore: input.maxScore,
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
    this.saveToStorage();

    // Record governance audit event on adjustments or human score changes
    if (entry.isAdjustment || input.authorizedSource === 'ORGANIZER_AUTHORIZED_WORKFLOW') {
      governanceAuditService.recordEvent({
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

  /**
   * Batch appends criterion-level contributions from a completed AI or Human evaluation.
   */
  public appendBatchContributions(inputs: AppendScoreContributionInput[]): ScoreLedgerEntry[] {
    return inputs.map((item) => this.appendContribution(item));
  }

  /**
   * Lists immutable ledger entries in chronological or reverse-chronological order.
   */
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

  /**
   * Returns total append-only ledger entry count.
   */
  public getCount(competitionId?: string): number {
    if (!competitionId) return this.entries.length;
    return this.entries.filter((e) => e.competitionId === competitionId).length;
  }

  /**
   * Resets ledger strictly for unit tests.
   */
  public resetForTesting(): void {
    this.entries = [];
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

export const scoringLedgerService = new ScoringLedgerService();
