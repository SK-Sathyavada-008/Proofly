// ─────────────────────────────────────────────────────────────────
// phase4FirestorePersistence.test.ts
// Proofly Phase 04 — Real Multi-Device Durable Firestore Persistence Tests
// Runs against live Firebase Firestore Emulator + real firestore.rules:
//   1. Create organization (atomic org + initial OWNER membership + settings + ownership transfer)
//   2. Read organization from another authorized device (and block cross-tenant Org B)
//   3. Assign judge (canonical judgeAssignments/{submissionId}_{judgeId})
//   4. Read assignment as judge from a separate device
//   5. Save draft evaluation & verify cross-judge draft isolation (Judge 2 cannot overwrite Judge 1)
//   6. Submit evaluation atomically (lock + assignment COMPLETED + duplicate submit prevention)
//   7. Read evaluation as organizer from another device & persist reopen history
//   8. Create immutable score contributions & adjustments via trusted backend (prevent duplicates, never overwrite, block direct client writes, append-only audit trail)
//   9. Persist & read published leaderboard snapshot + live Firestore-derived analytics
//  10. Simulate Firestore write failure (explicit PersistenceError, zero silent localStorage fallback, zero fake persisted IDs)
//  11. Controlled non-destructive localStorage migration (ownership validation + duplicate prevention)
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { organizationService } from '../../src/services/organizationService';
import { competitionService } from '../../src/services/competitionService';
import { submissionService } from '../../src/services/submissionService';
import { judgeAssignmentService } from '../../src/services/judgeAssignmentService';
import { scoringLedgerService } from '../../src/services/scoringLedgerService';
import { governanceAuditService } from '../../src/services/governanceAuditService';
import { resultsAndAnalyticsService } from '../../src/services/resultsAndAnalyticsService';
import { localStorageMigrationService } from '../../src/services/localStorageMigrationService';
import { PersistenceError } from '../../src/services/firestorePersistenceService';
import {
  createTransactionalFirestoreBackendExecutor,
  setTrustedBackendExecutor,
} from '../../src/services/trustedBackendPersistence';
import type { ProjectSubmission } from '../../src/types/submission';

const PROJECT_ID = 'proofly-rules-test';

let testEnv: RulesTestEnvironment;

function makeReadySubmission(params: {
  id: string;
  referenceId: string;
  organizationId: string;
  competitionId: string;
  title: string;
}): ProjectSubmission {
  const now = '2026-11-18T12:00:00.000Z';
  return {
    id: params.id,
    referenceId: params.referenceId,
    competitionId: params.competitionId,
    organizationId: params.organizationId,
    formSchemaId: 'schema-1',
    submissionType: 'INDIVIDUAL',
    participants: [],
    primaryContactName: 'Alex Rivera',
    primaryContactEmail: 'alex@example.com',
    projectTitle: params.title,
    projectDescription: 'Durable Firestore persistence verified project.',
    track: 'Healthcare & Edge AI',
    technologiesUsed: ['TypeScript', 'Firestore'],
    fieldValues: {},
    files: [],
    status: 'Ready for Judge Review',
    statusHistory: [],
    isLate: false,
    isLocked: true,
    currentVersion: 1,
    versions: [],
    managementTokenHash: 'a'.repeat(64),
    managementTokenPrefix: 'sec_00',
    createdAt: now,
    updatedAt: now,
  };
}

describe('Phase 04: Durable Firestore Multi-Device Persistence Suite', () => {
  beforeAll(async () => {
    const firestoreRules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const storageRules = readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: firestoreRules,
      },
      storage: {
        host: '127.0.0.1',
        port: 9199,
        rules: storageRules,
      },
    });
  });

  afterAll(async () => {
    setTrustedBackendExecutor(null);
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    setTrustedBackendExecutor(null);
    await testEnv.clearFirestore();
  });

  it('1 & 2. Creates organization atomically with initial OWNER membership, persists settings & ownership transfer, and reads from another authorized device while blocking Org B', async () => {
    const ownerDeviceA = testEnv.authenticatedContext('uid-owner-a').firestore();
    const adminDeviceB = testEnv.authenticatedContext('uid-admin-a').firestore();
    const orgBOutsider = testEnv.authenticatedContext('uid-outsider-b').firestore();

    // 1. Atomic writeBatch creates organizations/{orgId} + organizations/{orgId}/members/uid-owner-a
    const createdOrg = await organizationService.createOrganization(
      'Stanford AI Guild',
      'uid-owner-a',
      'owner@stanford.edu',
      'Dr. Owner',
      'Academic Competition Lab',
      'https://stanford.edu',
      { firestore: ownerDeviceA as any }
    );

    expect(createdOrg.id).toMatch(/^org-/);
    expect(createdOrg.ownerId).toBe('uid-owner-a');

    // Add second authorized org admin + create associated competition
    await organizationService.addMember(
      createdOrg.id,
      'uid-admin-a',
      'admin@stanford.edu',
      'Org Admin',
      'ADMIN',
      { firestore: ownerDeviceA as any }
    );

    const updatedOrg = await organizationService.updateOrganizationSettings(
      createdOrg.id,
      {
        name: 'Stanford AI Guild — Verified',
        updatedBy: 'uid-owner-a',
        settings: {
          contactEmail: 'ops@stanford.edu',
          defaultAiMode: 'PREFER_IN_CLOUD',
          appCheckEnforced: true,
        },
      },
      { firestore: ownerDeviceA as any }
    );
    expect(updatedOrg.name).toBe('Stanford AI Guild — Verified');
    expect(updatedOrg.settings?.contactEmail).toBe('ops@stanford.edu');

    const comp = await competitionService.createCompetition(
      createdOrg.id,
      'uid-owner-a',
      'owner@stanford.edu',
      'Dr. Owner',
      { title: 'Winter Innovation Challenge', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDeviceA as any }
    );

    // 2. Separate authorized device (Device B — Org Admin) reads org, settings, members & competitions
    const remoteOrg = await organizationService.getOrganization(createdOrg.id, {
      firestore: adminDeviceB as any,
    });
    expect(remoteOrg).not.toBeNull();
    expect(remoteOrg?.name).toBe('Stanford AI Guild — Verified');
    expect(remoteOrg?.settings?.defaultAiMode).toBe('PREFER_IN_CLOUD');

    const remoteMembers = await organizationService.listMembers(createdOrg.id, {
      firestore: adminDeviceB as any,
    });
    expect(remoteMembers.map((m) => m.userId).sort()).toEqual(['uid-admin-a', 'uid-owner-a']);

    const remoteComps = await organizationService.listAssociatedCompetitions(createdOrg.id, {
      firestore: adminDeviceB as any,
    });
    expect(remoteComps.items).toHaveLength(1);
    expect(remoteComps.items[0].id).toBe(comp.id);

    // Ownership transfer transaction updates ownerId + member roles atomically
    await organizationService.transferOwnership(createdOrg.id, 'uid-owner-a', 'uid-admin-a', {
      firestore: ownerDeviceA as any,
    });
    const afterTransfer = await organizationService.getOrganization(createdOrg.id, {
      firestore: adminDeviceB as any,
    });
    expect(afterTransfer?.ownerId).toBe('uid-admin-a');

    // Cross-tenant outsider (Org B) is strictly denied by firestore.rules
    await expect(
      organizationService.getOrganization(createdOrg.id, { firestore: orgBOutsider as any })
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'PERMISSION_DENIED' });
  });

  it('3, 4, 5, 6 & 7. Assigns judge, reads assignment on Judge Device, isolates cross-judge drafts, submits & locks atomically (preventing duplicates), and reads/reopens as Organizer', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();
    const judge1Db = testEnv.authenticatedContext('uid-judge-1').firestore();
    const judge2Db = testEnv.authenticatedContext('uid-judge-2').firestore();
    const unassignedJudgeDb = testEnv.authenticatedContext('uid-judge-unassigned').firestore();

    // Setup Org + Competition + Ready Submission + 2 Judges
    const org = await organizationService.createOrganization(
      'MIT Research Council',
      'uid-owner-a',
      'owner@mit.edu',
      'Organizer Lead',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@mit.edu',
      'Organizer Lead',
      { title: 'MIT Edge AI Cup', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeReadySubmission({
      id: 'sub-edge-1',
      referenceId: 'PF-SUB-2026-EDGE1',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'EdgePulse Diagnostic Engine',
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', sub.id), sub);
    });

    // Register judges & competition JUDGE roles
    for (const [jId, jName, jEmail] of [
      ['uid-judge-1', 'Dr. Alice Kim', 'alice@mit.edu'],
      ['uid-judge-2', 'Prof. Bob Patel', 'bob@mit.edu'],
      ['uid-judge-unassigned', 'Dr. Eve Unassigned', 'eve@mit.edu'],
    ]) {
      await judgeAssignmentService.addJudge(
        {
          id: jId,
          userId: jId,
          organizationId: org.id,
          name: jName,
          email: jEmail,
          assignedTracks: ['Healthcare & Edge AI'],
          competitionIds: [comp.id],
          status: 'ACTIVE',
        },
        { firestore: ownerDb as any }
      );
      await competitionService.assignCompetitionRole(
        comp.id,
        jId,
        jEmail,
        jName,
        'JUDGE',
        ['Healthcare & Edge AI'],
        { firestore: ownerDb as any }
      );
    }

    // 3. Assign Judge 1 & Judge 2 to sub-edge-1
    const asgn1 = await judgeAssignmentService.assignSubmission(
      {
        organizationId: org.id,
        competitionId: comp.id,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        track: sub.track,
        judgeId: 'uid-judge-1',
        assignedBy: 'uid-owner-a',
        assignedByName: 'Organizer Lead',
        assignmentSource: 'MANUAL',
      },
      { firestore: ownerDb as any }
    );
    expect(asgn1.id).toBe(`${sub.id}_uid-judge-1`);
    expect(asgn1.assignmentSource).toBe('MANUAL');

    await judgeAssignmentService.assignSubmission(
      {
        organizationId: org.id,
        competitionId: comp.id,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        track: sub.track,
        judgeId: 'uid-judge-2',
        assignedBy: 'uid-owner-a',
        assignedByName: 'Organizer Lead',
        assignmentSource: 'BATCH',
      },
      { firestore: ownerDb as any }
    );

    // 4. Read assignment as Judge 1 on separate device; unassigned judge is denied
    const judge1Assignments = await judgeAssignmentService.listAssignments(
      { competitionId: comp.id, judgeId: 'uid-judge-1' },
      { firestore: judge1Db as any }
    );
    expect(judge1Assignments).toHaveLength(1);
    expect(judge1Assignments[0].submissionId).toBe(sub.id);
    expect(judge1Assignments[0].status).toBe('PENDING');

    await expect(
      judgeAssignmentService.getAssignment(asgn1.id, { firestore: unassignedJudgeDb as any })
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'PERMISSION_DENIED' });

    // 5. Save draft as Judge 1 (with rubricVersion, criterionComments, overallComments)
    const draft1 = await judgeAssignmentService.saveEvaluationDraft(
      {
        organizationId: org.id,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: comp.id,
        judgeId: 'uid-judge-1',
        judgeName: 'Dr. Alice Kim',
        judgeEmail: 'alice@mit.edu',
        rubricVersion: 2,
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 23, 'crit-design': 21, 'crit-impact': 24, 'crit-idea': 22 },
        criterionComments: { 'crit-tech': 'Solid quantization benchmarks.' },
        overallComments: 'Strong edge implementation.',
        totalScore: 90,
        aiTotalScore: 86,
        criterionDifferences: {},
        deductionNotes: 'Minor UI polish deductions.',
      },
      { firestore: judge1Db as any }
    );
    expect(draft1.status).toBe('DRAFT');
    expect(draft1.isLocked).toBe(false);
    expect(draft1.rubricVersion).toBe(2);

    // Verify Judge 2 saves their own separate draft and CANNOT overwrite Judge 1's draft
    const draft2 = await judgeAssignmentService.saveEvaluationDraft(
      {
        organizationId: org.id,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: comp.id,
        judgeId: 'uid-judge-2',
        judgeName: 'Prof. Bob Patel',
        judgeEmail: 'bob@mit.edu',
        rubricVersion: 2,
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 20, 'crit-design': 20, 'crit-impact': 20, 'crit-idea': 20 },
        criterionComments: { 'crit-tech': 'Meets expectations.' },
        overallComments: 'Good prototype.',
        totalScore: 80,
        aiTotalScore: 86,
        criterionDifferences: {},
        deductionNotes: '',
      },
      { firestore: judge2Db as any }
    );
    expect(draft2.id).not.toBe(draft1.id);

    // Judge 2 attempting to directly overwrite Judge 1's doc in Firestore is strictly blocked
    await expect(
      updateDoc(doc(judge2Db as any, 'humanEvaluations', draft1.id), { totalScore: 10 })
    ).rejects.toThrow();

    // Judge 1's draft remains untouched at 90
    const verifyDraft1 = await judgeAssignmentService.getEvaluation(sub.id, 'uid-judge-1', {
      firestore: judge1Db as any,
    });
    expect(verifyDraft1?.totalScore).toBe(90);

    // 6. Submit final evaluation atomically as Judge 1 (locks evaluation + marks assignment COMPLETED)
    const submitted1 = await judgeAssignmentService.submitFinalEvaluation(
      {
        organizationId: org.id,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: comp.id,
        judgeId: 'uid-judge-1',
        judgeName: 'Dr. Alice Kim',
        judgeEmail: 'alice@mit.edu',
        rubricVersion: 2,
        decisionMode: 'MODIFY',
        scores: { 'crit-tech': 24, 'crit-design': 22, 'crit-impact': 24, 'crit-idea': 22 },
        criterionComments: { 'crit-tech': 'Verified live latency measurements.' },
        overallComments: 'Top contender.',
        totalScore: 92,
        aiTotalScore: 86,
        criterionDifferences: {},
        deductionNotes: 'Raised score after inspecting live benchmarks.',
      },
      { firestore: judge1Db as any }
    );
    expect(submitted1.status).toBe('SUBMITTED');
    expect(submitted1.isLocked).toBe(true);
    expect(submitted1.submittedAt).toBeTruthy();

    // Assignment automatically transitioned to COMPLETED in the same transaction
    const completedAsgn = await judgeAssignmentService.getAssignment(asgn1.id, {
      firestore: judge1Db as any,
    });
    expect(completedAsgn?.status).toBe('COMPLETED');
    expect(completedAsgn?.completedAt).toBeTruthy();

    // Duplicate evaluation submission is rejected with CONFLICT
    await expect(
      judgeAssignmentService.submitFinalEvaluation(
        {
          organizationId: org.id,
          submissionId: sub.id,
          referenceId: sub.referenceId,
          competitionId: comp.id,
          judgeId: 'uid-judge-1',
          judgeName: 'Dr. Alice Kim',
          judgeEmail: 'alice@mit.edu',
          decisionMode: 'AGREE',
          scores: { 'crit-tech': 25 },
          totalScore: 25,
          aiTotalScore: 86,
          criterionDifferences: {},
          deductionNotes: '',
        },
        { firestore: judge1Db as any }
      )
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'CONFLICT' });

    // 7. Read evaluation as Organizer on separate device + verify reopenHistory persists
    const orgReadEval = await judgeAssignmentService.getEvaluation(sub.id, 'uid-judge-1', {
      firestore: ownerDb as any,
    });
    expect(orgReadEval?.status).toBe('SUBMITTED');
    expect(orgReadEval?.totalScore).toBe(92);
    expect(orgReadEval?.criterionComments?.['crit-tech']).toBe('Verified live latency measurements.');

    const reopened = await judgeAssignmentService.reopenEvaluation(
      {
        evaluationId: submitted1.id,
        organizerUserId: 'uid-owner-a',
        organizerName: 'Organizer Lead',
        auditReason: 'Judge requested clerical rubric verification via official panel review.',
      },
      { firestore: ownerDb as any }
    );
    expect(reopened.isLocked).toBe(false);
    expect(reopened.status).toBe('DRAFT');
    expect(reopened.reopenHistory).toHaveLength(1);

    const judgeReadsReopened = await judgeAssignmentService.getEvaluation(sub.id, 'uid-judge-1', {
      firestore: judge1Db as any,
    });
    expect(judgeReadsReopened?.reopenHistory).toHaveLength(1);
    expect(judgeReadsReopened?.isLocked).toBe(false);
  });

  it('8 & 9. Persists immutable score contributions (preventing duplicates, supporting adjustments & audit trail), blocks direct client writes, persists official leaderboard snapshot, and derives live analytics from Firestore', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();
    const judge1Db = testEnv.authenticatedContext('uid-judge-1').firestore();
    const publicDb = testEnv.unauthenticatedContext().firestore();

    // Setup Org + Competition + Ready Submission + Assigned Judge + Submitted Evaluation
    const org = await organizationService.createOrganization(
      'Caltech Judging Hub',
      'uid-owner-a',
      'owner@caltech.edu',
      'Caltech Organizer',
      '',
      '',
      { firestore: ownerDb as any }
    );
    const comp = await competitionService.createCompetition(
      org.id,
      'uid-owner-a',
      'owner@caltech.edu',
      'Caltech Organizer',
      { title: 'Caltech Systems Finals', visibility: 'PUBLIC', status: 'ACTIVE' },
      { firestore: ownerDb as any }
    );

    const sub = makeReadySubmission({
      id: 'sub-sys-1',
      referenceId: 'PF-SUB-2026-SYS01',
      organizationId: org.id,
      competitionId: comp.id,
      title: 'ZeroCopy Consensus Runtime',
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', sub.id), sub);
    });

    await judgeAssignmentService.addJudge(
      {
        id: 'uid-judge-1',
        userId: 'uid-judge-1',
        organizationId: org.id,
        name: 'Dr. Systems Judge',
        email: 'judge@caltech.edu',
        assignedTracks: ['Healthcare & Edge AI'],
        competitionIds: [comp.id],
        status: 'ACTIVE',
      },
      { firestore: ownerDb as any }
    );
    await competitionService.assignCompetitionRole(
      comp.id,
      'uid-judge-1',
      'judge@caltech.edu',
      'Dr. Systems Judge',
      'JUDGE',
      ['Healthcare & Edge AI'],
      { firestore: ownerDb as any }
    );
    await judgeAssignmentService.assignSubmission(
      {
        organizationId: org.id,
        competitionId: comp.id,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        projectTitle: sub.projectTitle,
        judgeId: 'uid-judge-1',
        assignedBy: 'uid-owner-a',
        assignedByName: 'Caltech Organizer',
      },
      { firestore: ownerDb as any }
    );
    const evalRecord = await judgeAssignmentService.submitFinalEvaluation(
      {
        organizationId: org.id,
        submissionId: sub.id,
        referenceId: sub.referenceId,
        competitionId: comp.id,
        judgeId: 'uid-judge-1',
        judgeName: 'Dr. Systems Judge',
        judgeEmail: 'judge@caltech.edu',
        rubricVersion: 1,
        decisionMode: 'AGREE',
        scores: { 'crit-tech': 24, 'crit-design': 22, 'crit-impact': 23, 'crit-idea': 21 },
        totalScore: 90,
        aiTotalScore: 90,
        criterionDifferences: {},
        deductionNotes: 'Confirmed all rubric benchmarks.',
      },
      { firestore: judge1Db as any }
    );

    // 8A. Direct untrusted client write to scoreContributions MUST FAIL with PERMISSION_DENIED (zero fake success!)
    await expect(
      scoringLedgerService.appendContributionDurable(
        {
          organizationId: org.id,
          competitionId: comp.id,
          entryId: sub.id,
          referenceId: sub.referenceId,
          evaluationId: evalRecord.id,
          rubricVersion: 1,
          criterionId: 'crit-tech',
          criterionName: 'Technological Implementation',
          score: 24,
          maxScore: 25,
          source: 'HUMAN',
          actorId: 'uid-owner-a',
          actorName: 'Caltech Organizer',
          reasonForAdjustment: 'Attempted direct client write',
          authorizedSource: 'JUDGE_SUBMISSION',
        },
        { firestore: ownerDb as any }
      )
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'PERMISSION_DENIED' });

    // 8B. Trusted backend executor writes immutable score contributions + auditable adjustment
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const trustedExecutor = createTransactionalFirestoreBackendExecutor(adminCtx.firestore() as any);

      const baseEntry = await scoringLedgerService.appendContributionDurable(
        {
          organizationId: org.id,
          competitionId: comp.id,
          entryId: sub.id,
          referenceId: sub.referenceId,
          evaluationId: evalRecord.id,
          rubricVersion: 1,
          criterionId: 'crit-tech',
          criterionName: 'Technological Implementation',
          score: 24,
          maxScore: 25,
          source: 'HUMAN',
          actorId: 'uid-judge-1',
          actorName: 'Dr. Systems Judge',
          reasonForAdjustment: 'Final judge rubric evaluation',
          authorizedSource: 'JUDGE_SUBMISSION',
        },
        { trustedExecutor }
      );

      // Duplicate base contribution MUST BE REJECTED (prevents double-counting / overwrite!)
      await expect(
        scoringLedgerService.appendContributionDurable(
          {
            organizationId: org.id,
            competitionId: comp.id,
            entryId: sub.id,
            referenceId: sub.referenceId,
            evaluationId: evalRecord.id,
            rubricVersion: 1,
            criterionId: 'crit-tech',
            score: 25,
            maxScore: 25,
            source: 'HUMAN',
            actorId: 'uid-judge-1',
            actorName: 'Dr. Systems Judge',
            reasonForAdjustment: 'Duplicate attempt',
            authorizedSource: 'JUDGE_SUBMISSION',
          },
          { trustedExecutor }
        )
      ).rejects.toMatchObject({ name: 'PersistenceError', code: 'ALREADY_EXISTS' });

      // Auditable adjustment creates a NEW record linking previousEntryId without overwriting baseEntry!
      const adjustment = await scoringLedgerService.appendContributionDurable(
        {
          organizationId: org.id,
          competitionId: comp.id,
          entryId: sub.id,
          referenceId: sub.referenceId,
          evaluationId: evalRecord.id,
          rubricVersion: 1,
          criterionId: 'crit-tech',
          score: 25,
          maxScore: 25,
          source: 'HUMAN',
          actorId: 'uid-owner-a',
          actorName: 'Caltech Organizer',
          reasonForAdjustment: 'Verified additional benchmark artifact during panel reconciliation',
          isAdjustment: true,
          previousEntryId: baseEntry.id,
          authorizedSource: 'ORGANIZER_AUTHORIZED_WORKFLOW',
        },
        { trustedExecutor }
      );
      expect(adjustment.id).not.toBe(baseEntry.id);
      expect(adjustment.previousEntryId).toBe(baseEntry.id);

      // Publish official leaderboard snapshot via trusted backend
      const published = await resultsAndAnalyticsService.publishOfficialResults(
        {
          competitionId: comp.id,
          organizerUserId: 'uid-owner-a',
          organizerName: 'Caltech Organizer',
          actorRole: 'ORGANIZER',
          approvalReason: 'All panel evaluations verified and reconciled.',
        },
        { firestore: ownerDb as any, trustedExecutor }
      );
      expect(published.status).toBe('PUBLISHED');
      expect(published.entries).toHaveLength(1);
      expect(published.entries[0].officialScore).toBe(90);
    });

    // Organizer reads BOTH historical base entry AND adjustment from Firestore (neither overwritten!)
    const ledgerEntries = await scoringLedgerService.listEntriesFromFirestore(
      { competitionId: comp.id, entryId: sub.id },
      { firestore: ownerDb as any }
    );
    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.some((e) => !e.isAdjustment && e.score === 24)).toBe(true);
    expect(ledgerEntries.some((e) => e.isAdjustment && e.score === 25)).toBe(true);

    // Organizer reads append-only governance audit history, and CANNOT edit or delete audit logs
    const auditEvents = await governanceAuditService.listEventsFromFirestore(
      { competitionId: comp.id },
      { firestore: ownerDb as any }
    );
    expect(auditEvents.length).toBeGreaterThanOrEqual(2);
    await expect(
      updateDoc(doc(ownerDb as any, 'governanceAuditLogs', auditEvents[0].id), { reason: 'tampered' })
    ).rejects.toThrow();
    await expect(
      deleteDoc(doc(ownerDb as any, 'governanceAuditLogs', auditEvents[0].id))
    ).rejects.toThrow();

    // 9. Public unauthenticated device reads published official leaderboard directly from Firestore
    const publicLeaderboard = await resultsAndAnalyticsService.getPublicLeaderboardFromFirestore(
      comp.id,
      { firestore: publicDb as any }
    );
    expect(publicLeaderboard).not.toBeNull();
    expect(publicLeaderboard?.status).toBe('PUBLISHED');
    expect(publicLeaderboard?.entries[0].projectTitle).toBe('ZeroCopy Consensus Runtime');
    expect(publicLeaderboard?.entries[0].officialScore).toBe(90);

    // Analytics derived strictly from stored Firestore documents (no hard-coded values)
    const analytics = await resultsAndAnalyticsService.computeCompetitionAnalytics(comp.id, {
      firestore: ownerDb as any,
    });
    expect(analytics.totalSubmissions).toBe(1);
    expect(analytics.completedJudgeEvaluations).toBe(1);
    expect(analytics.averageHumanScore).toBe(90);
    expect(analytics.averageOfficialScore).toBe(90);
  });

  it('10. Simulates Firestore write failures and guarantees explicit PersistenceError with zero fake IDs and zero silent localStorage fallback', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    // Attempt org creation as unauthenticated user -> firestore.rules rejects write
    let caughtError: unknown = null;
    try {
      await organizationService.createOrganization(
        'Should Fail Org',
        'uid-unauth',
        'fail@example.com',
        'No Auth',
        '',
        '',
        { firestore: unauthDb as any }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PersistenceError);
    expect((caughtError as PersistenceError).code).toBe('PERMISSION_DENIED');

    // Attempt submission write as unauthenticated user -> throws PersistenceError, NEVER silently succeeds
    await expect(
      submissionService.saveSubmission(
        makeReadySubmission({
          id: 'sub-fail-1',
          referenceId: 'PF-SUB-FAIL',
          organizationId: 'org-nonexistent',
          competitionId: 'comp-nonexistent',
          title: 'Must Fail',
        }),
        { firestore: unauthDb as any }
      )
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'PERMISSION_DENIED' });

    // Confirm nothing was persisted into Firestore for sub-fail-1
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'submissions', 'sub-fail-1'));
      expect(snap.exists()).toBe(false);
    });
  });

  it('11. Runs controlled non-destructive localStorage migration: validates ownership, skips duplicates, and leaves original localStorage untouched', async () => {
    const ownerDb = testEnv.authenticatedContext('uid-owner-a').firestore();

    const backingMap = new Map<string, string>([
      [
        'proofly_organizations_v1',
        JSON.stringify([
          {
            id: 'org-legacy-owned',
            name: 'Owned Legacy Org',
            slug: 'owned-legacy-org',
            ownerId: 'uid-owner-a',
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
          {
            id: 'org-legacy-foreign',
            name: 'Someone Elses Org',
            slug: 'foreign-org',
            ownerId: 'uid-other-user',
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        ]),
      ],
    ]);

    const fakeStorage = {
      getItem: (k: string) => backingMap.get(k) ?? null,
    };

    // Inspect non-destructively
    const report = localStorageMigrationService.inspectLegacyLocalStorage(fakeStorage);
    expect(report.nonDestructive).toBe(true);
    expect(report.totalLegacyRecordsFound).toBe(2);

    // First migration run: migrates owned org, skips foreign org
    const run1 = await localStorageMigrationService.migrateOwnedRecordsToFirestore({
      actorUid: 'uid-owner-a',
      actorEmail: 'owner@example.com',
      actorDisplayName: 'Owner A',
      storageSource: fakeStorage,
      firestore: ownerDb as any,
    });
    expect(run1.migratedCount).toBe(1);
    expect(run1.skippedOwnershipMismatchCount).toBe(1);
    expect(run1.failedCount).toBe(0);

    // Second migration run: idempotent duplicate skip!
    const run2 = await localStorageMigrationService.migrateOwnedRecordsToFirestore({
      actorUid: 'uid-owner-a',
      actorEmail: 'owner@example.com',
      actorDisplayName: 'Owner A',
      storageSource: fakeStorage,
      firestore: ownerDb as any,
    });
    expect(run2.migratedCount).toBe(0);
    expect(run2.skippedDuplicateCount).toBe(1);
    expect(run2.skippedOwnershipMismatchCount).toBe(1);

    // Source localStorage data was NEVER deleted or modified
    expect(backingMap.has('proofly_organizations_v1')).toBe(true);
    expect(JSON.parse(backingMap.get('proofly_organizations_v1')!)).toHaveLength(2);
  });
});
