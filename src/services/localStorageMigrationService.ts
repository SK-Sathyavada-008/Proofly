// ─────────────────────────────────────────────
// localStorageMigrationService.ts — Non-Destructive Legacy localStorage Inspection & Controlled Migration
// Proofly Phase 04 — NEVER Deletes or Overwrites Existing localStorage Automatically
// Validates Ownership & Prevents Duplicate Firestore Records
// ─────────────────────────────────────────────

import { doc, getDoc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
} from './firestorePersistenceService';
import type { Competition, Organization, OrganizationMember } from '../types/authAndCompetition';
import type { CompetitionScoringPolicy } from '../types/scoringAndResults';

export const LEGACY_AUTHORITATIVE_STORAGE_KEYS = Object.freeze([
  'proofly_organizations_v1',
  'proofly_org_members_v1',
  'proofly_competitions_v1',
  'proofly_competition_roles_v1',
  'proofly_form_schemas_v1',
  'proofly_access_keys_v1',
  'proofly_submissions_v1',
  'proofly_judges',
  'proofly_judge_assignments',
  'proofly_human_evaluations',
  'proofly_scoring_ledger_v1',
  'proofly_governance_audit_v1',
  'proofly_scoring_policies_v1',
  'proofly_results_publications_v1',
] as const);

export const ALLOWED_UI_PREFERENCE_STORAGE_KEYS = Object.freeze([
  'proofly_theme',
  'proofly_active_org_id',
  'PRISON_AUTOSYNC_INTERVAL',
] as const);

export interface StorageKeyInspection {
  key: string;
  present: boolean;
  recordCount: number;
  migratesToFirestoreCollection: string;
  migrationMode: 'CONTROLLED_CLIENT_MIGRATION' | 'ADMIN_BACKEND_IMPORT_ONLY';
}

export interface LocalStorageAuditReport {
  scannedAt: string;
  nonDestructive: true;
  totalLegacyRecordsFound: number;
  keys: StorageKeyInspection[];
}

export interface ControlledMigrationResult {
  dryRun: boolean;
  migratedCount: number;
  skippedDuplicateCount: number;
  skippedOwnershipMismatchCount: number;
  failedCount: number;
  details: Array<{
    collection: string;
    recordId: string;
    outcome: 'MIGRATED' | 'DRY_RUN_ELIGIBLE' | 'SKIPPED_DUPLICATE' | 'SKIPPED_OWNERSHIP' | 'FAILED';
    reason?: string;
  }>;
}

const KEY_COLLECTION_MAP: Record<
  string,
  { collection: string; mode: 'CONTROLLED_CLIENT_MIGRATION' | 'ADMIN_BACKEND_IMPORT_ONLY' }
> = {
  proofly_organizations_v1: { collection: 'organizations', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_org_members_v1: { collection: 'organizations/{orgId}/members', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_competitions_v1: { collection: 'competitions', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_competition_roles_v1: { collection: 'competitions/{compId}/roles', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_form_schemas_v1: { collection: 'formSchemas', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_access_keys_v1: { collection: 'accessKeys', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_submissions_v1: { collection: 'submissions', mode: 'ADMIN_BACKEND_IMPORT_ONLY' },
  proofly_judges: { collection: 'judgeProfiles', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_judge_assignments: { collection: 'judgeAssignments', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_human_evaluations: { collection: 'humanEvaluations', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_scoring_ledger_v1: { collection: 'scoreContributions', mode: 'ADMIN_BACKEND_IMPORT_ONLY' },
  proofly_governance_audit_v1: { collection: 'governanceAuditLogs', mode: 'ADMIN_BACKEND_IMPORT_ONLY' },
  proofly_scoring_policies_v1: { collection: 'scoringPolicies', mode: 'CONTROLLED_CLIENT_MIGRATION' },
  proofly_results_publications_v1: { collection: 'resultPublications', mode: 'ADMIN_BACKEND_IMPORT_ONLY' },
};

function readRawKey(
  key: string,
  storageSource?: Pick<Storage, 'getItem'> | null
): unknown | null {
  try {
    const store =
      storageSource !== undefined
        ? storageSource
        : typeof window !== 'undefined' && window.localStorage
          ? window.localStorage
          : null;
    if (!store) return null;
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function countParsedRecords(parsed: unknown): number {
  if (!parsed) return 0;
  if (Array.isArray(parsed)) return parsed.length;
  if (typeof parsed === 'object') return Object.keys(parsed as Record<string, unknown>).length;
  return 0;
}

export const localStorageMigrationService = {
  /**
   * Read-only inspection of any legacy localStorage keys.
   * NEVER deletes, mutates, or overwrites existing localStorage keys.
   */
  inspectLegacyLocalStorage(
    storageSource?: Pick<Storage, 'getItem'> | null
  ): LocalStorageAuditReport {
    const keys: StorageKeyInspection[] = [];
    let totalLegacyRecordsFound = 0;

    for (const key of LEGACY_AUTHORITATIVE_STORAGE_KEYS) {
      const parsed = readRawKey(key, storageSource);
      const count = countParsedRecords(parsed);
      totalLegacyRecordsFound += count;
      const mapping = KEY_COLLECTION_MAP[key];
      keys.push({
        key,
        present: parsed !== null,
        recordCount: count,
        migratesToFirestoreCollection: mapping.collection,
        migrationMode: mapping.mode,
      });
    }

    return {
      scannedAt: new Date().toISOString(),
      nonDestructive: true,
      totalLegacyRecordsFound,
      keys,
    };
  },

  /**
   * Controlled, opt-in migration of user-owned legacy localStorage records into Firestore.
   * - Validates ownership (`ownerId === actorUid`) before migrating any organization.
   * - Checks Firestore first (`getDoc`) to skip existing records and prevent duplicates.
   * - NEVER deletes or modifies the source localStorage keys.
   * - Supports `dryRun: true` to preview changes safely before committing.
   */
  async migrateOwnedRecordsToFirestore(params: {
    actorUid: string;
    actorEmail: string;
    actorDisplayName: string;
    dryRun?: boolean;
    storageSource?: Pick<Storage, 'getItem'> | null;
    firestore?: Firestore;
  }): Promise<ControlledMigrationResult> {
    const fs = resolveFirestore(params.firestore);
    const dryRun = Boolean(params.dryRun);
    const result: ControlledMigrationResult = {
      dryRun,
      migratedCount: 0,
      skippedDuplicateCount: 0,
      skippedOwnershipMismatchCount: 0,
      failedCount: 0,
      details: [],
    };

    if (!fs) {
      throw new Error('Firestore must be configured or supplied to run controlled migration.');
    }

    const ownedOrgIds = new Set<string>();

    // 1. Migrate owned Organizations + initial OWNER membership atomically
    const rawOrgs = readRawKey('proofly_organizations_v1', params.storageSource);
    const legacyOrgs: Organization[] = Array.isArray(rawOrgs) ? rawOrgs : [];

    for (const org of legacyOrgs) {
      if (!org?.id || !org?.name) continue;
      if (org.ownerId !== params.actorUid) {
        result.skippedOwnershipMismatchCount++;
        result.details.push({
          collection: 'organizations',
          recordId: org.id,
          outcome: 'SKIPPED_OWNERSHIP',
          reason: `Organization ownerId (${org.ownerId}) does not match authenticated user (${params.actorUid}).`,
        });
        continue;
      }

      ownedOrgIds.add(org.id);
      const orgRef = doc(fs, 'organizations', org.id);
      try {
        const existingSnap = await getDoc(orgRef);
        if (existingSnap.exists()) {
          result.skippedDuplicateCount++;
          result.details.push({
            collection: 'organizations',
            recordId: org.id,
            outcome: 'SKIPPED_DUPLICATE',
            reason: 'Organization already exists in Firestore.',
          });
          continue;
        }
      } catch (err) {
        // Permission denied on reading non-existent org (because caller isn't member yet) means it does not exist for this user
        const mapped = mapFirestoreError(err, 'migrateCheckOrg', 'organizations');
        if (mapped.code !== 'PERMISSION_DENIED') {
          result.failedCount++;
          result.details.push({
            collection: 'organizations',
            recordId: org.id,
            outcome: 'FAILED',
            reason: mapped.message,
          });
          continue;
        }
      }

      if (dryRun) {
        result.migratedCount++;
        result.details.push({
          collection: 'organizations',
          recordId: org.id,
          outcome: 'DRY_RUN_ELIGIBLE',
        });
        continue;
      }

      try {
        const ownerMember: OrganizationMember = {
          userId: params.actorUid,
          orgId: org.id,
          role: 'OWNER',
          email: params.actorEmail,
          displayName: params.actorDisplayName,
          joinedAt: org.createdAt || new Date().toISOString(),
        };
        const batch = writeBatch(fs);
        batch.set(
          orgRef,
          withServerTimestamps(
            sanitizeFirestoreData({
              id: org.id,
              name: org.name,
              slug: org.slug || org.id,
              tagline: org.tagline || '',
              website: org.website || '',
              ownerId: params.actorUid,
              createdAt: org.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
            true
          )
        );
        batch.set(
          doc(fs, 'organizations', org.id, 'members', params.actorUid),
          withServerTimestamps(sanitizeFirestoreData(ownerMember), true)
        );
        await batch.commit();

        result.migratedCount++;
        result.details.push({
          collection: 'organizations',
          recordId: org.id,
          outcome: 'MIGRATED',
        });
      } catch (err) {
        result.failedCount++;
        result.details.push({
          collection: 'organizations',
          recordId: org.id,
          outcome: 'FAILED',
          reason: mapFirestoreError(err, 'migrateOrg', 'organizations').message,
        });
      }
    }

    // 2. Migrate Competitions belonging strictly to verified owned organizations
    const rawComps = readRawKey('proofly_competitions_v1', params.storageSource);
    const legacyComps: Competition[] = Array.isArray(rawComps) ? rawComps : [];
    const ownedCompIds = new Set<string>();

    for (const comp of legacyComps) {
      if (!comp?.id || !comp?.organizationId) continue;
      if (!ownedOrgIds.has(comp.organizationId)) {
        result.skippedOwnershipMismatchCount++;
        result.details.push({
          collection: 'competitions',
          recordId: comp.id,
          outcome: 'SKIPPED_OWNERSHIP',
          reason: `Competition organizationId (${comp.organizationId}) is not owned by authenticated user.`,
        });
        continue;
      }

      ownedCompIds.add(comp.id);
      const compRef = doc(fs, 'competitions', comp.id);
      try {
        const existingSnap = await getDoc(compRef);
        if (existingSnap.exists()) {
          result.skippedDuplicateCount++;
          result.details.push({
            collection: 'competitions',
            recordId: comp.id,
            outcome: 'SKIPPED_DUPLICATE',
            reason: 'Competition already exists in Firestore.',
          });
          continue;
        }
      } catch {
        // Proceed to create attempt; firestore.rules validates ownership
      }

      if (dryRun) {
        result.migratedCount++;
        result.details.push({
          collection: 'competitions',
          recordId: comp.id,
          outcome: 'DRY_RUN_ELIGIBLE',
        });
        continue;
      }

      try {
        await setDoc(
          compRef,
          withServerTimestamps(sanitizeFirestoreData(comp), true)
        );
        result.migratedCount++;
        result.details.push({
          collection: 'competitions',
          recordId: comp.id,
          outcome: 'MIGRATED',
        });
      } catch (err) {
        result.failedCount++;
        result.details.push({
          collection: 'competitions',
          recordId: comp.id,
          outcome: 'FAILED',
          reason: mapFirestoreError(err, 'migrateCompetition', 'competitions').message,
        });
      }
    }

    // 3. Migrate Scoring Policies for owned competitions
    const rawPolicies = readRawKey('proofly_scoring_policies_v1', params.storageSource);
    if (rawPolicies && typeof rawPolicies === 'object' && !Array.isArray(rawPolicies)) {
      for (const [compId, policy] of Object.entries(
        rawPolicies as Record<string, CompetitionScoringPolicy>
      )) {
        if (!ownedCompIds.has(compId)) {
          result.skippedOwnershipMismatchCount++;
          result.details.push({
            collection: 'scoringPolicies',
            recordId: compId,
            outcome: 'SKIPPED_OWNERSHIP',
            reason: `Scoring policy competitionId (${compId}) is not owned by authenticated user.`,
          });
          continue;
        }

        const policyRef = doc(fs, 'scoringPolicies', compId);
        const compSnap = await getDoc(doc(fs, 'competitions', compId)).catch(() => null);
        const orgId = compSnap?.exists() ? (compSnap.data().organizationId as string) : undefined;

        const existingPolicySnap = await getDoc(policyRef).catch(() => null);
        if (existingPolicySnap?.exists()) {
          result.skippedDuplicateCount++;
          result.details.push({
            collection: 'scoringPolicies',
            recordId: compId,
            outcome: 'SKIPPED_DUPLICATE',
            reason: 'Scoring policy already exists in Firestore.',
          });
          continue;
        }

        if (dryRun) {
          result.migratedCount++;
          result.details.push({
            collection: 'scoringPolicies',
            recordId: compId,
            outcome: 'DRY_RUN_ELIGIBLE',
          });
          continue;
        }

        try {
          await setDoc(
            policyRef,
            withServerTimestamps(
              sanitizeFirestoreData({
                ...policy,
                competitionId: compId,
                organizationId: orgId,
              }),
              true
            )
          );
          result.migratedCount++;
          result.details.push({
            collection: 'scoringPolicies',
            recordId: compId,
            outcome: 'MIGRATED',
          });
        } catch (err) {
          result.failedCount++;
          result.details.push({
            collection: 'scoringPolicies',
            recordId: compId,
            outcome: 'FAILED',
            reason: mapFirestoreError(err, 'migratePolicy', 'scoringPolicies').message,
          });
        }
      }
    }

    return result;
  },
};
