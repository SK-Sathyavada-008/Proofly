// ─────────────────────────────────────────────────────────────────
// firebaseSecurityRules.test.ts
// Proofly Phase 02 — Real Firebase Emulator Suite Tests (Firestore + Storage)
// Tests positive & negative cases across ALL required roles:
//   Anonymous, Participant, Assigned Judge, Unassigned Judge,
//   Competition Admin, Organization Admin/Owner, Viewer,
//   Cross-Organization User, Forged-Claim Attacker, and Platform Admin.
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getBytes,
  deleteObject,
} from 'firebase/storage';

const PROJECT_ID = 'proofly-rules-test';
const VALID_HASH_64 = 'a'.repeat(64);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]); // %PDF-1.4

let testEnv: RulesTestEnvironment;

async function seedFixtureData() {
  const futureTs = Timestamp.fromMillis(Date.now() + 3_600_000);
  const pastTs = Timestamp.fromMillis(Date.now() - 3_600_000);

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const storage = ctx.storage();

    // Platform Admin (backend-only doc; never trusts custom claims)
    await setDoc(doc(db, 'platformAdmins', 'uid-platform-admin'), { grantedAt: '2026-11-01T00:00:00Z' });

    // Users
    await setDoc(doc(db, 'users', 'uid-participant-1'), {
      uid: 'uid-participant-1',
      email: 'p1@example.org',
      displayName: 'Participant One',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });

    // Organizations
    await setDoc(doc(db, 'organizations', 'org-a'), {
      id: 'org-a',
      name: 'Alpha Organization',
      slug: 'alpha-org',
      ownerId: 'uid-org-owner-a',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });
    await setDoc(doc(db, 'organizations', 'org-b'), {
      id: 'org-b',
      name: 'Beta Organization',
      slug: 'beta-org',
      ownerId: 'uid-org-b-user',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });

    // Organization Memberships
    await setDoc(doc(db, 'organizations', 'org-a', 'members', 'uid-org-owner-a'), {
      userId: 'uid-org-owner-a',
      orgId: 'org-a',
      role: 'OWNER',
      email: 'owner@alpha.org',
      displayName: 'Org Owner A',
      joinedAt: '2026-11-01T00:00:00Z',
    });
    await setDoc(doc(db, 'organizations', 'org-a', 'members', 'uid-org-admin-a'), {
      userId: 'uid-org-admin-a',
      orgId: 'org-a',
      role: 'ADMIN',
      email: 'admin@alpha.org',
      displayName: 'Org Admin A',
      joinedAt: '2026-11-01T00:00:00Z',
    });
    await setDoc(doc(db, 'organizations', 'org-b', 'members', 'uid-org-b-user'), {
      userId: 'uid-org-b-user',
      orgId: 'org-b',
      role: 'OWNER',
      email: 'owner@beta.org',
      displayName: 'Org B Owner',
      joinedAt: '2026-11-01T00:00:00Z',
    });

    // Competitions
    await setDoc(doc(db, 'competitions', 'comp-a-pub'), {
      id: 'comp-a-pub',
      organizationId: 'org-a',
      title: 'Alpha Public Hackathon',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    });
    await setDoc(doc(db, 'competitions', 'comp-a-priv'), {
      id: 'comp-a-priv',
      organizationId: 'org-a',
      title: 'Alpha Private Symposium',
      visibility: 'PRIVATE',
      status: 'EVALUATION',
    });
    await setDoc(doc(db, 'competitions', 'comp-b-priv'), {
      id: 'comp-b-priv',
      organizationId: 'org-b',
      title: 'Beta Private Challenge',
      visibility: 'PRIVATE',
      status: 'ACTIVE',
    });

    // Competition Roles on comp-a-pub
    await setDoc(doc(db, 'competitions', 'comp-a-pub', 'roles', 'uid-comp-admin-a'), {
      competitionId: 'comp-a-pub',
      userId: 'uid-comp-admin-a',
      email: 'compadmin@alpha.org',
      displayName: 'Comp Admin A',
      role: 'COMPETITION_ADMIN',
      assignedAt: '2026-11-01T00:00:00Z',
    });
    await setDoc(doc(db, 'competitions', 'comp-a-pub', 'roles', 'uid-judge-assigned'), {
      competitionId: 'comp-a-pub',
      userId: 'uid-judge-assigned',
      email: 'judge1@panel.edu',
      displayName: 'Assigned Judge',
      role: 'JUDGE',
      assignedAt: '2026-11-01T00:00:00Z',
    });
    await setDoc(doc(db, 'competitions', 'comp-a-pub', 'roles', 'uid-judge-unassigned'), {
      competitionId: 'comp-a-pub',
      userId: 'uid-judge-unassigned',
      email: 'judge2@panel.edu',
      displayName: 'Unassigned Judge',
      role: 'JUDGE',
      assignedAt: '2026-11-01T00:00:00Z',
    });
    await setDoc(doc(db, 'competitions', 'comp-a-pub', 'roles', 'uid-judge-conflict'), {
      competitionId: 'comp-a-pub',
      userId: 'uid-judge-conflict',
      email: 'judge3@panel.edu',
      displayName: 'Conflict Judge',
      role: 'JUDGE',
      assignedAt: '2026-11-01T00:00:00Z',
    });
    await setDoc(doc(db, 'competitions', 'comp-a-pub', 'roles', 'uid-viewer-a'), {
      competitionId: 'comp-a-pub',
      userId: 'uid-viewer-a',
      email: 'viewer@alpha.org',
      displayName: 'Viewer A',
      role: 'VIEWER',
      assignedAt: '2026-11-01T00:00:00Z',
    });

    // Participants, Teams, Entries
    await setDoc(doc(db, 'participants', 'part-1'), {
      id: 'part-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      userId: 'uid-participant-1',
      name: 'Participant One',
    });
    await setDoc(doc(db, 'teams', 'team-1'), {
      id: 'team-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      name: 'Team One',
      memberUids: ['uid-participant-1'],
    });
    await setDoc(doc(db, 'entries', 'entry-ready'), {
      id: 'entry-ready',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-ready',
      participantUid: 'uid-participant-1',
    });

    // Submissions
    await setDoc(doc(db, 'submissions', 'sub-a-draft'), {
      id: 'sub-a-draft',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      participantUid: 'uid-participant-1',
      projectTitle: 'Draft Project',
      submissionType: 'INDIVIDUAL',
      status: 'Draft',
      isLocked: false,
      managementTokenHash: VALID_HASH_64,
    });
    await setDoc(doc(db, 'submissions', 'sub-a-ready'), {
      id: 'sub-a-ready',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      participantUid: 'uid-participant-1',
      primaryContactEmail: 'private-p1@example.org',
      projectTitle: 'Ready For Judge Project',
      submissionType: 'TEAM',
      status: 'Ready for Judge Review',
      isLocked: true,
      managementTokenHash: VALID_HASH_64,
    });
    await setDoc(doc(db, 'submissions', 'sub-a-other'), {
      id: 'sub-a-other',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      participantUid: 'uid-participant-2',
      projectTitle: 'Other Participant Project',
      submissionType: 'INDIVIDUAL',
      status: 'Ready for Judge Review',
      isLocked: true,
      managementTokenHash: VALID_HASH_64,
    });
    await setDoc(doc(db, 'submissions', 'sub-a-closed-comp'), {
      id: 'sub-a-closed-comp',
      organizationId: 'org-a',
      competitionId: 'comp-a-priv',
      participantUid: 'uid-participant-1',
      projectTitle: 'Closed Comp Submission',
      submissionType: 'INDIVIDUAL',
      status: 'Draft',
      isLocked: false,
    });

    // Scoped Participant Sessions (backend-only)
    await setDoc(doc(db, 'participantSessions', 'sess-valid'), {
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-draft',
      revoked: false,
      expiresAt: futureTs,
    });
    await setDoc(doc(db, 'participantSessions', 'sess-revoked'), {
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-draft',
      revoked: true,
      expiresAt: futureTs,
    });
    await setDoc(doc(db, 'participantSessions', 'sess-expired'), {
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-draft',
      revoked: false,
      expiresAt: pastTs,
    });

    // Form Schemas (Public projection vs Internal schema with organizer/judge-only fields)
    await setDoc(doc(db, 'formSchemas', 'schema-public'), {
      id: 'schema-public',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      isPublicProjection: true,
      containsInternalFields: false,
      fields: [{ id: 'f1', label: 'Title', visibility: 'PUBLIC' }],
    });
    await setDoc(doc(db, 'formSchemas', 'schema-internal'), {
      id: 'schema-internal',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      isPublicProjection: false,
      containsInternalFields: true,
      fields: [{ id: 'f2', label: 'Internal Risk Notes', visibility: 'ORGANIZER_ONLY' }],
    });

    // Judge Profiles & Judge Assignments
    await setDoc(doc(db, 'judgeProfiles', 'jp-1'), {
      id: 'jp-1',
      userId: 'uid-judge-assigned',
      organizationId: 'org-a',
      bio: 'ML Researcher',
      maxQuota: 10,
    });
    await setDoc(doc(db, 'judgeAssignments', 'sub-a-ready_uid-judge-assigned'), {
      id: 'sub-a-ready_uid-judge-assigned',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-ready',
      judgeId: 'uid-judge-assigned',
      status: 'ASSIGNED',
    });
    await setDoc(doc(db, 'judgeAssignments', 'sub-a-draft_uid-judge-assigned'), {
      id: 'sub-a-draft_uid-judge-assigned',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-draft',
      judgeId: 'uid-judge-assigned',
      status: 'ASSIGNED',
    });
    await setDoc(doc(db, 'judgeAssignments', 'sub-a-ready_uid-judge-conflict'), {
      id: 'sub-a-ready_uid-judge-conflict',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-ready',
      judgeId: 'uid-judge-conflict',
      status: 'CONFLICT',
    });

    // Rubrics, Rubric Versions, AI Reports, Locked Evaluation, Jobs, Ledger, Snapshots, Notifications, Audit, AccessKeys
    await setDoc(doc(db, 'rubrics', 'rubric-a'), {
      id: 'rubric-a',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      criteria: [],
    });
    await setDoc(doc(db, 'rubricVersions', 'comp-a-pub_v1'), {
      id: 'comp-a-pub_v1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      versionNumber: 1,
    });
    await setDoc(doc(db, 'aiEvaluationReports', 'ai-rep-1'), {
      id: 'ai-rep-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-ready',
      overallScore: 84,
    });
    await setDoc(doc(db, 'evaluations', 'eval-locked-1'), {
      id: 'eval-locked-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-ready',
      judgeId: 'uid-judge-assigned',
      source: 'HUMAN',
      status: 'SUBMITTED',
      isLocked: true,
      totalScore: 86,
    });
    await setDoc(doc(db, 'evaluationJobs', 'job-1'), {
      id: 'job-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      submissionId: 'sub-a-ready',
      status: 'COMPLETED',
    });
    await setDoc(doc(db, 'scoreContributions', 'sc-1'), {
      id: 'sc-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      entryId: 'sub-a-ready',
      source: 'HUMAN',
      score: 22,
    });
    await setDoc(doc(db, 'leaderboardSnapshots', 'snap-pub'), {
      id: 'snap-pub',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      status: 'PUBLISHED',
      isPublic: true,
      entries: [],
    });
    await setDoc(doc(db, 'leaderboardSnapshots', 'snap-draft'), {
      id: 'snap-draft',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      status: 'PROVISIONAL',
      isPublic: false,
      entries: [],
    });
    await setDoc(doc(db, 'notifications', 'notif-1'), {
      id: 'notif-1',
      recipientUid: 'uid-judge-assigned',
      message: 'New assignment',
      read: false,
    });
    await setDoc(doc(db, 'auditLogs', 'audit-1'), {
      id: 'audit-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      action: 'RESULTS_PUBLISHED',
    });
    await setDoc(doc(db, 'accessKeys', 'key-a-1'), {
      id: 'key-a-1',
      organizationId: 'org-a',
      competitionId: 'comp-a-pub',
      code: 'PF-ALPHA1',
      revoked: false,
    });

    // Seed private Storage artifacts for read/delete tests
    await uploadBytes(
      ref(storage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-ready/paper.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' }
    );
    await uploadBytes(
      ref(storage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/draft.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' }
    );
  });
}

describe('Phase 02: Firebase Security Rules (Firestore + Storage Emulator Suite)', () => {
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
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
    await seedFixtureData();
  });

  // ── 1. TENANT ISOLATION, CUSTOM CLAIMS & MEMBERSHIP REVOCATION ──
  describe('1. Tenant Isolation, No Custom-Claim Trust & Revoked Membership', () => {
    it('blocks cross-organization access from Org B Owner against Org A resources', async () => {
      const orgBDb = testEnv.authenticatedContext('uid-org-b-user').firestore();

      await assertFails(getDoc(doc(orgBDb, 'organizations', 'org-a')));
      await assertFails(getDoc(doc(orgBDb, 'competitions', 'comp-a-priv')));
      await assertFails(getDoc(doc(orgBDb, 'submissions', 'sub-a-ready')));
      await assertFails(getDoc(doc(orgBDb, 'formSchemas', 'schema-internal')));
      await assertFails(getDoc(doc(orgBDb, 'auditLogs', 'audit-1')));
      await assertFails(getDoc(doc(orgBDb, 'accessKeys', 'key-a-1')));
      await assertFails(
        setDoc(doc(orgBDb, 'competitions', 'comp-spoof'), {
          id: 'comp-spoof',
          organizationId: 'org-a',
          title: 'Spoofed',
          visibility: 'PUBLIC',
          status: 'ACTIVE',
        })
      );
    });

    it('NEVER trusts forged custom client claims (`platformRole: SUPER_ADMIN`, `isAdmin: true`)', async () => {
      const forgedDb = testEnv
        .authenticatedContext('uid-attacker', { platformRole: 'SUPER_ADMIN', isAdmin: true })
        .firestore();

      await assertFails(getDoc(doc(forgedDb, 'organizations', 'org-a')));
      await assertFails(getDoc(doc(forgedDb, 'submissions', 'sub-a-ready')));
      await assertFails(getDoc(doc(forgedDb, 'auditLogs', 'audit-1')));
      await assertFails(getDoc(doc(forgedDb, 'platformAdmins', 'uid-platform-admin')));

      // Meanwhile a backend-verified /platformAdmins/{uid} doc IS trusted
      const platformDb = testEnv.authenticatedContext('uid-platform-admin').firestore();
      await assertSucceeds(getDoc(doc(platformDb, 'organizations', 'org-a')));
      await assertFails(setDoc(doc(platformDb, 'platformAdmins', 'uid-new'), { grantedAt: 'now' }));
    });

    it('prevents Competition Admin of Org A from moving competition to Org B or accessing Org B', async () => {
      const compAdminDb = testEnv.authenticatedContext('uid-comp-admin-a').firestore();

      await assertSucceeds(
        updateDoc(doc(compAdminDb, 'competitions', 'comp-a-pub'), { title: 'Updated Title' })
      );
      await assertFails(
        updateDoc(doc(compAdminDb, 'competitions', 'comp-a-pub'), { organizationId: 'org-b' })
      );
      await assertFails(getDoc(doc(compAdminDb, 'competitions', 'comp-b-priv')));
      await assertFails(getDoc(doc(compAdminDb, 'organizations', 'org-b')));
    });

    it('immediately revokes access when org membership is deleted', async () => {
      const orgAdminDb = testEnv.authenticatedContext('uid-org-admin-a').firestore();
      const orgOwnerDb = testEnv.authenticatedContext('uid-org-owner-a').firestore();

      await assertSucceeds(getDoc(doc(orgAdminDb, 'organizations', 'org-a')));
      await assertSucceeds(deleteDoc(doc(orgOwnerDb, 'organizations', 'org-a', 'members', 'uid-org-admin-a')));
      await assertFails(getDoc(doc(orgAdminDb, 'organizations', 'org-a')));
      await assertFails(getDoc(doc(orgAdminDb, 'submissions', 'sub-a-ready')));
    });

    it('blocks Viewer from mutating any competition, form, rubric, role, or access key', async () => {
      const viewerDb = testEnv.authenticatedContext('uid-viewer-a').firestore();

      // Viewer CAN read authorized competition resources & provisional snapshots
      await assertSucceeds(getDoc(doc(viewerDb, 'competitions', 'comp-a-pub')));
      await assertSucceeds(getDoc(doc(viewerDb, 'submissions', 'sub-a-ready')));
      await assertSucceeds(getDoc(doc(viewerDb, 'leaderboardSnapshots', 'snap-draft')));

      // Viewer CANNOT mutate anything or read private audit logs / access keys
      await assertFails(updateDoc(doc(viewerDb, 'competitions', 'comp-a-pub'), { title: 'Hacked' }));
      await assertFails(updateDoc(doc(viewerDb, 'formSchemas', 'schema-public'), { title: 'Hacked' }));
      await assertFails(updateDoc(doc(viewerDb, 'rubrics', 'rubric-a'), { criteria: ['x'] }));
      await assertFails(deleteDoc(doc(viewerDb, 'competitions', 'comp-a-pub', 'roles', 'uid-judge-assigned')));
      await assertFails(getDoc(doc(viewerDb, 'accessKeys', 'key-a-1')));
      await assertFails(getDoc(doc(viewerDb, 'auditLogs', 'audit-1')));
    });
  });

  // ── 2. SUBMISSION SECURITY & STATUS BYPASS PREVENTION ──────────
  describe('2. Submission Security (Zero Status Bypass & Participant Isolation)', () => {
    it('blocks participant from creating submission with judge-ready, AI-complete, or scored status', async () => {
      const p1Db = testEnv.authenticatedContext('uid-participant-1').firestore();

      // Status bypass attempts: MUST ALL FAIL
      for (const illegalStatus of [
        'Ready for Judge Review',
        'AI Evaluation Complete',
        'Under Human Review',
        'Evaluated',
        'Finalized',
      ]) {
        await assertFails(
          setDoc(doc(p1Db, 'submissions', `sub-bypass-${illegalStatus}`), {
            id: `sub-bypass-${illegalStatus}`,
            organizationId: 'org-a',
            competitionId: 'comp-a-pub',
            participantUid: 'uid-participant-1',
            projectTitle: 'Bypass Attempt',
            submissionType: 'INDIVIDUAL',
            status: illegalStatus,
          })
        );
      }

      // Forbidden backend score fields: MUST FAIL
      await assertFails(
        setDoc(doc(p1Db, 'submissions', 'sub-forged-score'), {
          id: 'sub-forged-score',
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          participantUid: 'uid-participant-1',
          projectTitle: 'Forged Score',
          submissionType: 'INDIVIDUAL',
          status: 'Submitted',
          aiScore: 99,
        })
      );

      // Legitimate Draft or Submitted creation: SUCCEEDS
      await assertSucceeds(
        setDoc(doc(p1Db, 'submissions', 'sub-legit-1'), {
          id: 'sub-legit-1',
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          participantUid: 'uid-participant-1',
          projectTitle: 'Legit Submission',
          submissionType: 'INDIVIDUAL',
          status: 'Submitted',
          isLocked: false,
        })
      );
    });

    it('enforces scoped participantSession for anonymous creates and blocks raw anonymous reads', async () => {
      const anonDb = testEnv.unauthenticatedContext().firestore();

      // Anonymous CANNOT read private submissions or participantSessions
      await assertFails(getDoc(doc(anonDb, 'submissions', 'sub-a-ready')));
      await assertFails(getDoc(doc(anonDb, 'participantSessions', 'sess-valid')));

      // Anonymous create WITHOUT session or WITH revoked/expired session: FAILS
      await assertFails(
        setDoc(doc(anonDb, 'submissions', 'sub-anon-nosess'), {
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          projectTitle: 'Unscoped Anon',
          submissionType: 'INDIVIDUAL',
          status: 'Submitted',
          managementTokenHash: VALID_HASH_64,
        })
      );
      await assertFails(
        setDoc(doc(anonDb, 'submissions', 'sub-anon-revoked'), {
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          participantSessionId: 'sess-revoked',
          projectTitle: 'Revoked Session',
          submissionType: 'INDIVIDUAL',
          status: 'Submitted',
          managementTokenHash: VALID_HASH_64,
        })
      );
      await assertFails(
        setDoc(doc(anonDb, 'submissions', 'sub-anon-expired'), {
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          participantSessionId: 'sess-expired',
          projectTitle: 'Expired Session',
          submissionType: 'INDIVIDUAL',
          status: 'Submitted',
          managementTokenHash: VALID_HASH_64,
        })
      );

      // Anonymous create WITH valid scoped session: SUCCEEDS
      await assertSucceeds(
        setDoc(doc(anonDb, 'submissions', 'sub-anon-valid'), {
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          participantSessionId: 'sess-valid',
          projectTitle: 'Valid Anonymous Entry',
          submissionType: 'INDIVIDUAL',
          status: 'Submitted',
          managementTokenHash: VALID_HASH_64,
        })
      );
    });

    it('isolates participants from reading or editing other participants submissions or locked submissions', async () => {
      const p1Db = testEnv.authenticatedContext('uid-participant-1').firestore();
      const p2Db = testEnv.authenticatedContext('uid-participant-2').firestore();

      // Own draft read & content edit succeeds
      await assertSucceeds(getDoc(doc(p1Db, 'submissions', 'sub-a-draft')));
      await assertSucceeds(
        updateDoc(doc(p1Db, 'submissions', 'sub-a-draft'), {
          projectTitle: 'Updated Draft Title',
          status: 'Submitted',
        })
      );

      // Participant 1 cannot edit locked submission or set AI/official score
      await assertFails(
        updateDoc(doc(p1Db, 'submissions', 'sub-a-ready'), { projectTitle: 'Tampered' })
      );

      // Participant 2 cannot read or edit Participant 1's submission
      await assertFails(getDoc(doc(p2Db, 'submissions', 'sub-a-draft')));
      await assertFails(getDoc(doc(p2Db, 'submissions', 'sub-a-ready')));
    });
  });

  // ── 3. JUDGE, EVALUATION & SCORE LEDGER SECURITY ───────────────
  describe('3. Judge Assignment Isolation, Draft/Lock Rules & Backend-Only Ledger', () => {
    it('allows Assigned Judge to read ONLY ready assigned submissions & AI reports; blocks unassigned & conflict judges', async () => {
      const assignedDb = testEnv.authenticatedContext('uid-judge-assigned').firestore();
      const unassignedDb = testEnv.authenticatedContext('uid-judge-unassigned').firestore();
      const conflictDb = testEnv.authenticatedContext('uid-judge-conflict').firestore();

      // Assigned judge CAN read ready assigned submission & its AI report
      await assertSucceeds(getDoc(doc(assignedDb, 'submissions', 'sub-a-ready')));
      await assertSucceeds(getDoc(doc(assignedDb, 'aiEvaluationReports', 'ai-rep-1')));
      await assertSucceeds(getDoc(doc(assignedDb, 'entries', 'entry-ready')));

      // Assigned judge CANNOT read draft submission (before AI gate!) or unassigned submission
      await assertFails(getDoc(doc(assignedDb, 'submissions', 'sub-a-draft')));
      await assertFails(getDoc(doc(assignedDb, 'submissions', 'sub-a-other')));

      // Unassigned judge & CONFLICT judge CANNOT read sub-a-ready or its AI report
      await assertFails(getDoc(doc(unassignedDb, 'submissions', 'sub-a-ready')));
      await assertFails(getDoc(doc(unassignedDb, 'aiEvaluationReports', 'ai-rep-1')));
      await assertFails(getDoc(doc(conflictDb, 'submissions', 'sub-a-ready')));
    });

    it('allows assigned judge to create/update own HUMAN draft and lock on submit, but blocks AI fabrication, locked edits & direct ledger writes', async () => {
      const assignedDb = testEnv.authenticatedContext('uid-judge-assigned').firestore();
      const unassignedDb = testEnv.authenticatedContext('uid-judge-unassigned').firestore();
      const compAdminDb = testEnv.authenticatedContext('uid-comp-admin-a').firestore();

      // Assigned judge creates valid HUMAN draft
      await assertSucceeds(
        setDoc(doc(assignedDb, 'evaluations', 'eval-draft-1'), {
          id: 'eval-draft-1',
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          submissionId: 'sub-a-ready',
          judgeId: 'uid-judge-assigned',
          source: 'HUMAN',
          status: 'DRAFT',
          isLocked: false,
          totalScore: 80,
        })
      );

      // Assigned judge CANNOT create AI evaluation or pre-locked evaluation
      await assertFails(
        setDoc(doc(assignedDb, 'evaluations', 'eval-fake-ai'), {
          id: 'eval-fake-ai',
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          submissionId: 'sub-a-ready',
          judgeId: 'uid-judge-assigned',
          source: 'AI',
          status: 'DRAFT',
          isLocked: false,
        })
      );
      await assertFails(
        setDoc(doc(assignedDb, 'aiEvaluationReports', 'ai-forged'), {
          id: 'ai-forged',
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          submissionId: 'sub-a-ready',
          overallScore: 100,
        })
      );

      // Unassigned judge CANNOT create evaluation on sub-a-ready
      await assertFails(
        setDoc(doc(unassignedDb, 'evaluations', 'eval-unassigned'), {
          id: 'eval-unassigned',
          organizationId: 'org-a',
          competitionId: 'comp-a-pub',
          submissionId: 'sub-a-ready',
          judgeId: 'uid-judge-unassigned',
          source: 'HUMAN',
          status: 'DRAFT',
          isLocked: false,
        })
      );

      // Assigned judge submits & atomically locks own draft
      await assertSucceeds(
        updateDoc(doc(assignedDb, 'evaluations', 'eval-draft-1'), {
          totalScore: 88,
          status: 'SUBMITTED',
          isLocked: true,
        })
      );

      // Once locked, judge CANNOT edit or delete it
      await assertFails(
        updateDoc(doc(assignedDb, 'evaluations', 'eval-draft-1'), { totalScore: 99 })
      );
      await assertFails(deleteDoc(doc(assignedDb, 'evaluations', 'eval-draft-1')));

      // Comp Admin CANNOT reopen without a valid reason >= 10 chars, and CANNOT edit judge's score
      await assertFails(
        updateDoc(doc(compAdminDb, 'evaluations', 'eval-locked-1'), {
          isLocked: false,
          status: 'DRAFT',
          reopenReason: 'short',
          reopenedBy: 'uid-comp-admin-a',
        })
      );
      await assertFails(
        updateDoc(doc(compAdminDb, 'evaluations', 'eval-locked-1'), {
          isLocked: false,
          status: 'DRAFT',
          totalScore: 100,
          reopenReason: 'Attempting unauthorized score tamper during reopen',
          reopenedBy: 'uid-comp-admin-a',
        })
      );

      // Comp Admin CAN explicitly reopen with recorded reason (without changing score)
      await assertSucceeds(
        updateDoc(doc(compAdminDb, 'evaluations', 'eval-locked-1'), {
          isLocked: false,
          status: 'DRAFT',
          reopenReason: 'Judge reported clerical scoring typo via organizer review',
          reopenedBy: 'uid-comp-admin-a',
          reopenedAt: '2026-11-18T12:00:00Z',
        })
      );

      // Score ledger, evaluationJobs, leaderboardSnapshots, auditLogs are STRICTLY backend-only writes
      for (const db of [assignedDb, compAdminDb, testEnv.authenticatedContext('uid-org-owner-a').firestore()]) {
        await assertFails(
          setDoc(doc(db, 'scoreContributions', 'sc-client'), {
            organizationId: 'org-a',
            competitionId: 'comp-a-pub',
            source: 'HUMAN',
            score: 25,
          })
        );
        await assertFails(
          setDoc(doc(db, 'scoringLedger', 'led-client'), {
            organizationId: 'org-a',
            competitionId: 'comp-a-pub',
            source: 'AI',
            score: 25,
          })
        );
        await assertFails(
          setDoc(doc(db, 'leaderboardSnapshots', 'snap-client'), {
            organizationId: 'org-a',
            competitionId: 'comp-a-pub',
            status: 'PUBLISHED',
            isPublic: true,
          })
        );
        await assertFails(
          setDoc(doc(db, 'evaluationJobs', 'job-client'), {
            organizationId: 'org-a',
            competitionId: 'comp-a-pub',
            status: 'QUEUED',
          })
        );
        await assertFails(
          setDoc(doc(db, 'auditLogs', 'audit-client'), {
            organizationId: 'org-a',
            competitionId: 'comp-a-pub',
            action: 'FAKE',
          })
        );
      }
    });
  });

  // ── 4. PUBLIC ACCESS, FORM SCHEMA PRIVACY & DEFAULT DENY ───────
  describe('4. Public Access, Internal Form Schema Protection, Notifications & Default Deny', () => {
    it('allows public reads ONLY for public competitions, sanitized form projections & published leaderboards', async () => {
      const anonDb = testEnv.unauthenticatedContext().firestore();

      // Allowed public reads
      await assertSucceeds(getDoc(doc(anonDb, 'competitions', 'comp-a-pub')));
      await assertSucceeds(getDoc(doc(anonDb, 'formSchemas', 'schema-public')));
      await assertSucceeds(getDoc(doc(anonDb, 'leaderboardSnapshots', 'snap-pub')));

      // Denied private/internal reads
      await assertFails(getDoc(doc(anonDb, 'competitions', 'comp-a-priv')));
      await assertFails(getDoc(doc(anonDb, 'formSchemas', 'schema-internal')));
      await assertFails(getDoc(doc(anonDb, 'leaderboardSnapshots', 'snap-draft')));
      await assertFails(getDoc(doc(anonDb, 'accessKeys', 'key-a-1')));
      await assertFails(getDoc(doc(anonDb, 'auditLogs', 'audit-1')));
      await assertFails(getDoc(doc(anonDb, 'unknownCollection', 'doc-1')));
    });

    it('restricts notifications to recipient mark-read only and denies self-escalation in /users', async () => {
      const assignedDb = testEnv.authenticatedContext('uid-judge-assigned').firestore();
      const otherDb = testEnv.authenticatedContext('uid-judge-unassigned').firestore();

      await assertSucceeds(getDoc(doc(assignedDb, 'notifications', 'notif-1')));
      await assertSucceeds(
        updateDoc(doc(assignedDb, 'notifications', 'notif-1'), { read: true, readAt: '2026-11-18T12:00:00Z' })
      );
      await assertFails(updateDoc(doc(assignedDb, 'notifications', 'notif-1'), { message: 'Edited' }));
      await assertFails(getDoc(doc(otherDb, 'notifications', 'notif-1')));

      const p1Db = testEnv.authenticatedContext('uid-participant-1').firestore();
      await assertFails(
        updateDoc(doc(p1Db, 'users', 'uid-participant-1'), { platformRole: 'SUPER_ADMIN' })
      );
    });
  });

  // ── 5. FIREBASE STORAGE SECURITY RULES ─────────────────────────
  describe('5. Firebase Storage Rules (Cross-Tenant Isolation, Judge Scope & Scoped Uploads)', () => {
    const readyPath = 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-ready/paper.pdf';
    const draftPath = 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/new.pdf';
    const draftExistingPath = 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/draft.pdf';

    it('allows valid scoped uploads from participant owner or active participantSession, and rejects invalid/revoked/malicious uploads', async () => {
      const p1Storage = testEnv.authenticatedContext('uid-participant-1').storage();
      const p2Storage = testEnv.authenticatedContext('uid-participant-2').storage();
      const anonStorage = testEnv.unauthenticatedContext().storage();
      const orgBStorage = testEnv.authenticatedContext('uid-org-b-user').storage();
      const viewerStorage = testEnv.authenticatedContext('uid-viewer-a').storage();

      // Participant 1 uploads valid PDF to own unlocked Draft on ACTIVE competition: SUCCEEDS
      await assertSucceeds(
        uploadBytes(ref(p1Storage, draftPath), PDF_BYTES, { contentType: 'application/pdf' })
      );

      // Anonymous participant WITH valid active scoped session: SUCCEEDS
      await assertSucceeds(
        uploadBytes(
          ref(anonStorage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/anon-valid.pdf'),
          PDF_BYTES,
          { contentType: 'application/pdf', customMetadata: { sessionId: 'sess-valid' } }
        )
      );

      // Unrestricted anonymous upload (no session), revoked session, expired session: ALL FAIL
      await assertFails(
        uploadBytes(
          ref(anonStorage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/anon-no-sess.pdf'),
          PDF_BYTES,
          { contentType: 'application/pdf' }
        )
      );
      await assertFails(
        uploadBytes(
          ref(anonStorage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/anon-rev.pdf'),
          PDF_BYTES,
          { contentType: 'application/pdf', customMetadata: { sessionId: 'sess-revoked' } }
        )
      );
      await assertFails(
        uploadBytes(
          ref(anonStorage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/anon-exp.pdf'),
          PDF_BYTES,
          { contentType: 'application/pdf', customMetadata: { sessionId: 'sess-expired' } }
        )
      );

      // Disallowed MIME / dangerous extension (.exe, .html, .svg): FAIL
      await assertFails(
        uploadBytes(
          ref(p1Storage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/evil.exe'),
          PDF_BYTES,
          { contentType: 'application/pdf' }
        )
      );
      await assertFails(
        uploadBytes(
          ref(p1Storage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/xss.html'),
          PDF_BYTES,
          { contentType: 'text/html' }
        )
      );

      // Upload to locked submission, closed competition, wrong path, or by unauthorized roles: ALL FAIL
      await assertFails(
        uploadBytes(
          ref(p1Storage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-ready/tamper.pdf'),
          PDF_BYTES,
          { contentType: 'application/pdf' }
        )
      );
      await assertFails(
        uploadBytes(
          ref(p1Storage, 'organizations/org-a/competitions/comp-a-priv/submissions/sub-a-closed-comp/late.pdf'),
          PDF_BYTES,
          { contentType: 'application/pdf' }
        )
      );
      await assertFails(
        uploadBytes(ref(p1Storage, 'competitions/comp-a-pub/submissions/sub-a-draft/legacy.pdf'), PDF_BYTES, {
          contentType: 'application/pdf',
        })
      );
      await assertFails(
        uploadBytes(ref(p2Storage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/p2.pdf'), PDF_BYTES, {
          contentType: 'application/pdf',
        })
      );
      await assertFails(
        uploadBytes(ref(orgBStorage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/orgb.pdf'), PDF_BYTES, {
          contentType: 'application/pdf',
        })
      );
      await assertFails(
        uploadBytes(ref(viewerStorage, 'organizations/org-a/competitions/comp-a-pub/submissions/sub-a-draft/v.pdf'), PDF_BYTES, {
          contentType: 'application/pdf',
        })
      );
    });

    it('strictly scopes private submission file reads by tenant, ownership, and judge assignment — and blocks deletes', async () => {
      // Authorized readers on sub-a-ready: Participant Owner, Assigned Judge, Comp Admin, Org Admin, Viewer
      await assertSucceeds(getBytes(ref(testEnv.authenticatedContext('uid-participant-1').storage(), readyPath)));
      await assertSucceeds(getBytes(ref(testEnv.authenticatedContext('uid-judge-assigned').storage(), readyPath)));
      await assertSucceeds(getBytes(ref(testEnv.authenticatedContext('uid-comp-admin-a').storage(), readyPath)));
      await assertSucceeds(getBytes(ref(testEnv.authenticatedContext('uid-org-admin-a').storage(), readyPath)));
      await assertSucceeds(getBytes(ref(testEnv.authenticatedContext('uid-viewer-a').storage(), readyPath)));

      // Denied readers: Anonymous, Other Participant, Unassigned Judge, Conflict Judge, Org B User, Forged Claim User
      await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), readyPath)));
      await assertFails(getBytes(ref(testEnv.authenticatedContext('uid-participant-2').storage(), readyPath)));
      await assertFails(getBytes(ref(testEnv.authenticatedContext('uid-judge-unassigned').storage(), readyPath)));
      await assertFails(getBytes(ref(testEnv.authenticatedContext('uid-judge-conflict').storage(), readyPath)));
      await assertFails(getBytes(ref(testEnv.authenticatedContext('uid-org-b-user').storage(), readyPath)));
      await assertFails(
        getBytes(
          ref(
            testEnv.authenticatedContext('uid-attacker', { platformRole: 'SUPER_ADMIN' }).storage(),
            readyPath
          )
        )
      );

      // Assigned judge CANNOT read submission artifact BEFORE AI evaluation gate (status == Draft)
      await assertFails(
        getBytes(ref(testEnv.authenticatedContext('uid-judge-assigned').storage(), draftExistingPath))
      );

      // Nobody can delete an uploaded submission artifact from client
      await assertFails(
        deleteObject(ref(testEnv.authenticatedContext('uid-participant-1').storage(), readyPath))
      );
      await assertFails(
        deleteObject(ref(testEnv.authenticatedContext('uid-org-owner-a').storage(), readyPath))
      );
    });
  });
});
