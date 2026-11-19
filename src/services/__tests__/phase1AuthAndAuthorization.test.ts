// ─────────────────────────────────────────────
// phase1AuthAndAuthorization.test.ts
// Proofly Phase 01 — Security Tests for Authentication & Scoped Authorization
// Covers: Signed-out, Organizer, Judge, Viewer, Cross-Org, Multi-Role,
//         Revoked Membership, Expired Sessions, Unauthorized Mutations,
//         Invitation Onboarding, and Accountless Participant Preservation.
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  authorizationService,
  AuthorizationError,
  type AuthorizedOperation,
} from '../authorizationService';
import { scopedAuthService, type UserAuthContext } from '../scopedAuthService';
import { organizationService } from '../organizationService';
import { competitionService } from '../competitionService';
import { invitationService } from '../invitationService';
import { accessManagementService } from '../accessManagementService';
import { mapFirebaseAuthError, type VerifiedAuthSession } from '../firebaseAuthService';
import type { Organization, OrganizationMember, Competition } from '../../types/authAndCompetition';

function makeSession(overrides: Partial<VerifiedAuthSession> = {}): VerifiedAuthSession {
  const now = Date.now();
  return {
    uid: 'uid-default',
    email: 'user@example.org',
    displayName: 'Test User',
    emailVerified: true,
    platformRole: 'USER',
    tokenIssuedAtMs: now - 60_000,
    tokenExpiresAtMs: now + 3_600_000,
    revoked: false,
    ...overrides,
  };
}

describe('Phase 01: Real Authentication & Scoped Role-Based Authorization', () => {
  let orgAlpha: Organization;
  let orgBeta: Organization;
  let compAlphaPrivate: Competition;
  let compBetaPrivate: Competition;

  let ownerAlphaSession: VerifiedAuthSession;
  let adminAlphaSession: VerifiedAuthSession;
  let compAdminAlphaSession: VerifiedAuthSession;
  let judgeAlphaSession: VerifiedAuthSession;
  let viewerAlphaSession: VerifiedAuthSession;
  let ownerBetaSession: VerifiedAuthSession;
  let platformAdminSession: VerifiedAuthSession;

  beforeEach(async () => {
    organizationService.resetInMemoryStore([], []);
    competitionService.resetInMemoryStore([], []);
    invitationService.resetInMemoryStore();
    accessManagementService.resetInMemoryStore([]);

    ownerAlphaSession = makeSession({
      uid: 'uid-owner-alpha',
      email: 'owner@alpha.org',
      displayName: 'Alpha Owner',
    });
    adminAlphaSession = makeSession({
      uid: 'uid-admin-alpha',
      email: 'admin@alpha.org',
      displayName: 'Alpha Admin',
    });
    compAdminAlphaSession = makeSession({
      uid: 'uid-comp-admin-alpha',
      email: 'compadmin@alpha.org',
      displayName: 'Alpha Comp Admin',
    });
    judgeAlphaSession = makeSession({
      uid: 'uid-judge-alpha',
      email: 'judge@external.edu',
      displayName: 'External Judge',
    });
    viewerAlphaSession = makeSession({
      uid: 'uid-viewer-alpha',
      email: 'viewer@observer.org',
      displayName: 'Read-Only Viewer',
    });
    ownerBetaSession = makeSession({
      uid: 'uid-owner-beta',
      email: 'owner@beta.org',
      displayName: 'Beta Owner',
    });
    platformAdminSession = makeSession({
      uid: 'uid-platform-admin',
      email: 'ops@proofly.app',
      displayName: 'Platform Admin',
      platformRole: 'SUPER_ADMIN',
    });

    orgAlpha = await organizationService.createOrganization(
      'Alpha Guild',
      ownerAlphaSession.uid,
      ownerAlphaSession.email,
      ownerAlphaSession.displayName
    );
    await organizationService.addMember(
      orgAlpha.id,
      adminAlphaSession.uid,
      adminAlphaSession.email,
      adminAlphaSession.displayName,
      'ADMIN'
    );

    orgBeta = await organizationService.createOrganization(
      'Beta Lab',
      ownerBetaSession.uid,
      ownerBetaSession.email,
      ownerBetaSession.displayName
    );

    compAlphaPrivate = await competitionService.createCompetition(
      orgAlpha.id,
      ownerAlphaSession.uid,
      ownerAlphaSession.email,
      ownerAlphaSession.displayName,
      {
        title: 'Alpha Private AI Challenge',
        visibility: 'PRIVATE',
        status: 'ACTIVE',
      }
    );

    await competitionService.assignCompetitionRole(
      compAlphaPrivate.id,
      compAdminAlphaSession.uid,
      compAdminAlphaSession.email,
      compAdminAlphaSession.displayName,
      'COMPETITION_ADMIN'
    );
    await competitionService.assignCompetitionRole(
      compAlphaPrivate.id,
      judgeAlphaSession.uid,
      judgeAlphaSession.email,
      judgeAlphaSession.displayName,
      'JUDGE'
    );
    await competitionService.assignCompetitionRole(
      compAlphaPrivate.id,
      viewerAlphaSession.uid,
      viewerAlphaSession.email,
      viewerAlphaSession.displayName,
      'VIEWER'
    );

    compBetaPrivate = await competitionService.createCompetition(
      orgBeta.id,
      ownerBetaSession.uid,
      ownerBetaSession.email,
      ownerBetaSession.displayName,
      {
        title: 'Beta Confidential Robotics Track',
        visibility: 'PRIVATE',
        status: 'ACTIVE',
      }
    );
  });

  // ── 1. SIGNED-OUT ACCESS ───────────────────────────────────
  describe('1. Signed-Out Access', () => {
    it('rejects all protected operations when session is null or undefined', async () => {
      const protectedOps: AuthorizedOperation[] = [
        'ORG_READ',
        'ORG_MANAGE',
        'ORG_MEMBER_MANAGE',
        'COMPETITION_CREATE',
        'COMPETITION_READ',
        'COMPETITION_MANAGE',
        'FORM_MANAGE',
        'ACCESS_KEY_MANAGE',
        'JUDGE_INVITE_OR_ASSIGN',
        'SUBMISSION_READ',
        'SUBMISSION_EVALUATE',
        'EVALUATION_REOPEN',
        'RESULTS_PUBLISH',
      ];

      for (const op of protectedOps) {
        const res = await authorizationService.authorizeOperation(null, {
          operation: op,
          organizationId: orgAlpha.id,
          competitionId: compAlphaPrivate.id,
        });
        expect(res.allowed).toBe(false);
        expect(res.code).toBe('UNAUTHENTICATED');
      }

      await expect(
        authorizationService.assertAuthorized(undefined, {
          operation: 'COMPETITION_CREATE',
          organizationId: orgAlpha.id,
        })
      ).rejects.toThrow(AuthorizationError);
    });

    it('preserves accountless participant submission access via public access code', async () => {
      const validation = await accessManagementService.validateAccessAndCreateSession(
        compAlphaPrivate.id,
        compAlphaPrivate.publicAccessCode
      );
      expect(validation.valid).toBe(true);
      expect(validation.session?.competitionId).toBe(compAlphaPrivate.id);
    });
  });

  // ── 2. ORGANIZER ACCESS ────────────────────────────────────
  describe('2. Organizer Access (Org Owner, Org Admin, Competition Admin)', () => {
    it('allows Org Owner and Org Admin to manage org and competitions in their own tenant', async () => {
      for (const session of [ownerAlphaSession, adminAlphaSession]) {
        const createRes = await authorizationService.authorizeOperation(session, {
          operation: 'COMPETITION_CREATE',
          organizationId: orgAlpha.id,
        });
        expect(createRes.allowed).toBe(true);

        const manageRes = await authorizationService.authorizeOperation(session, {
          operation: 'COMPETITION_MANAGE',
          organizationId: orgAlpha.id,
          competitionId: compAlphaPrivate.id,
        });
        expect(manageRes.allowed).toBe(true);

        const publishRes = await authorizationService.authorizeOperation(session, {
          operation: 'RESULTS_PUBLISH',
          organizationId: orgAlpha.id,
          competitionId: compAlphaPrivate.id,
        });
        expect(publishRes.allowed).toBe(true);
      }
    });

    it('allows Competition Admin to manage assigned competition but NOT organization settings', async () => {
      const manageComp = await authorizationService.authorizeOperation(compAdminAlphaSession, {
        operation: 'COMPETITION_MANAGE',
        competitionId: compAlphaPrivate.id,
      });
      expect(manageComp.allowed).toBe(true);
      expect(manageComp.resolvedCompetitionRole).toBe('COMPETITION_ADMIN');

      const manageForms = await authorizationService.authorizeOperation(compAdminAlphaSession, {
        operation: 'FORM_MANAGE',
        competitionId: compAlphaPrivate.id,
      });
      expect(manageForms.allowed).toBe(true);

      const manageOrg = await authorizationService.authorizeOperation(compAdminAlphaSession, {
        operation: 'ORG_MANAGE',
        organizationId: orgAlpha.id,
      });
      expect(manageOrg.allowed).toBe(false);
    });
  });

  // ── 3. JUDGE ACCESS ────────────────────────────────────────
  describe('3. Judge Access & Organizer-Operation Blocking', () => {
    it('allows a real Judge account to view & evaluate assigned submissions only', async () => {
      const canRead = await authorizationService.authorizeOperation(judgeAlphaSession, {
        operation: 'SUBMISSION_READ',
        competitionId: compAlphaPrivate.id,
      });
      expect(canRead.allowed).toBe(true);
      expect(canRead.resolvedCompetitionRole).toBe('JUDGE');

      const canEvalAssigned = await authorizationService.authorizeOperation(judgeAlphaSession, {
        operation: 'SUBMISSION_EVALUATE',
        competitionId: compAlphaPrivate.id,
        assignedJudgeIds: [judgeAlphaSession.uid],
      });
      expect(canEvalAssigned.allowed).toBe(true);

      // Judge CANNOT evaluate a submission assigned to someone else
      const cannotEvalUnassigned = await authorizationService.authorizeOperation(judgeAlphaSession, {
        operation: 'SUBMISSION_EVALUATE',
        competitionId: compAlphaPrivate.id,
        assignedJudgeIds: ['uid-other-judge'],
      });
      expect(cannotEvalUnassigned.allowed).toBe(false);
      expect(cannotEvalUnassigned.code).toBe('UNASSIGNED_RESOURCE');
    });

    it('strictly blocks Judge accounts from ALL organizer-only operations and organizer workspace', async () => {
      const organizerOnlyOps: AuthorizedOperation[] = [
        'ORG_MANAGE',
        'ORG_MEMBER_MANAGE',
        'COMPETITION_CREATE',
        'COMPETITION_MANAGE',
        'FORM_MANAGE',
        'ACCESS_KEY_MANAGE',
        'JUDGE_INVITE_OR_ASSIGN',
        'EVALUATION_REOPEN',
        'RESULTS_PUBLISH',
      ];

      for (const op of organizerOnlyOps) {
        const res = await authorizationService.authorizeOperation(judgeAlphaSession, {
          operation: op,
          organizationId: orgAlpha.id,
          competitionId: compAlphaPrivate.id,
        });
        expect(res.allowed).toBe(false);
      }

      const judgeCtx: UserAuthContext = {
        uid: judgeAlphaSession.uid,
        email: judgeAlphaSession.email,
        platformRole: 'USER',
        orgMemberships: {},
        competitionRoles: { [compAlphaPrivate.id]: 'JUDGE' },
      };
      expect(scopedAuthService.canAccessJudgeWorkspace(judgeCtx)).toBe(true);
      expect(scopedAuthService.canAccessOrganizerWorkspace(judgeCtx)).toBe(false);
    });
  });

  // ── 4. VIEWER ACCESS ───────────────────────────────────────
  describe('4. Viewer Access (Strictly Read-Only)', () => {
    it('allows Viewer to read authorized competition resources but denies EVERY mutation', async () => {
      const readComp = await authorizationService.authorizeOperation(viewerAlphaSession, {
        operation: 'COMPETITION_READ',
        competitionId: compAlphaPrivate.id,
      });
      expect(readComp.allowed).toBe(true);
      expect(readComp.resolvedCompetitionRole).toBe('VIEWER');

      const readSubs = await authorizationService.authorizeOperation(viewerAlphaSession, {
        operation: 'SUBMISSION_READ',
        competitionId: compAlphaPrivate.id,
      });
      expect(readSubs.allowed).toBe(true);

      const allMutations: AuthorizedOperation[] = [
        'ORG_MANAGE',
        'ORG_MEMBER_MANAGE',
        'COMPETITION_CREATE',
        'COMPETITION_MANAGE',
        'FORM_MANAGE',
        'ACCESS_KEY_MANAGE',
        'JUDGE_INVITE_OR_ASSIGN',
        'SUBMISSION_EVALUATE',
        'EVALUATION_REOPEN',
        'RESULTS_PUBLISH',
      ];

      for (const op of allMutations) {
        const res = await authorizationService.authorizeOperation(viewerAlphaSession, {
          operation: op,
          organizationId: orgAlpha.id,
          competitionId: compAlphaPrivate.id,
        });
        expect(res.allowed).toBe(false);
        expect(res.code).toBe('VIEWER_READ_ONLY');
      }

      const viewerCtx: UserAuthContext = {
        uid: viewerAlphaSession.uid,
        email: viewerAlphaSession.email,
        platformRole: 'USER',
        orgMemberships: {},
        competitionRoles: { [compAlphaPrivate.id]: 'VIEWER' },
      };
      expect(scopedAuthService.canAccessJudgeWorkspace(viewerCtx)).toBe(false);
      expect(scopedAuthService.isReadOnlyViewer(viewerCtx, orgAlpha.id, compAlphaPrivate.id)).toBe(true);
    });
  });

  // ── 5. CROSS-ORGANIZATION ISOLATION & MULTI-ORG SCOPING ───
  describe('5. Cross-Organization Access & Multi-Org / Multi-Role Scoping', () => {
    it('prevents an Owner of Org Alpha from reading or mutating Org Beta private resources', async () => {
      const readBetaOrg = await authorizationService.authorizeOperation(ownerAlphaSession, {
        operation: 'ORG_READ',
        organizationId: orgBeta.id,
      });
      expect(readBetaOrg.allowed).toBe(false);
      expect(readBetaOrg.code).toBe('CROSS_TENANT_DENIED');

      const readBetaComp = await authorizationService.authorizeOperation(ownerAlphaSession, {
        operation: 'COMPETITION_READ',
        competitionId: compBetaPrivate.id,
      });
      expect(readBetaComp.allowed).toBe(false);
      expect(readBetaComp.code).toBe('CROSS_TENANT_DENIED');

      const createInBeta = await authorizationService.authorizeOperation(ownerAlphaSession, {
        operation: 'COMPETITION_CREATE',
        organizationId: orgBeta.id,
      });
      expect(createInBeta.allowed).toBe(false);
      expect(createInBeta.code).toBe('CROSS_TENANT_DENIED');

      // Cross-tenant spoofing attempt: claiming Beta's competition belongs to Alpha's org
      const spoofedTenant = await authorizationService.authorizeOperation(ownerAlphaSession, {
        operation: 'COMPETITION_MANAGE',
        organizationId: orgAlpha.id,
        competitionId: compBetaPrivate.id,
      });
      expect(spoofedTenant.allowed).toBe(false);
      expect(spoofedTenant.code).toBe('CROSS_TENANT_DENIED');
    });

    it('supports a single user belonging to multiple orgs with different scoped roles (no global isAdmin)', async () => {
      // Owner of Alpha is also assigned strictly as JUDGE in Beta's competition
      await competitionService.assignCompetitionRole(
        compBetaPrivate.id,
        ownerAlphaSession.uid,
        ownerAlphaSession.email,
        ownerAlphaSession.displayName,
        'JUDGE'
      );

      // In Alpha: can publish results
      const publishAlpha = await authorizationService.authorizeOperation(ownerAlphaSession, {
        operation: 'RESULTS_PUBLISH',
        competitionId: compAlphaPrivate.id,
      });
      expect(publishAlpha.allowed).toBe(true);

      // In Beta: CAN evaluate as Judge, but CANNOT manage or publish results!
      const evalBeta = await authorizationService.authorizeOperation(ownerAlphaSession, {
        operation: 'SUBMISSION_EVALUATE',
        competitionId: compBetaPrivate.id,
      });
      expect(evalBeta.allowed).toBe(true);
      expect(evalBeta.resolvedCompetitionRole).toBe('JUDGE');

      const publishBeta = await authorizationService.authorizeOperation(ownerAlphaSession, {
        operation: 'RESULTS_PUBLISH',
        competitionId: compBetaPrivate.id,
      });
      expect(publishBeta.allowed).toBe(false);
      expect(publishBeta.code).toBe('FORBIDDEN');
    });

    it('allows verified Platform Admin (SUPER_ADMIN custom claim) across tenants', async () => {
      const manageBeta = await authorizationService.authorizeOperation(platformAdminSession, {
        operation: 'COMPETITION_MANAGE',
        competitionId: compBetaPrivate.id,
      });
      expect(manageBeta.allowed).toBe(true);
      expect(manageBeta.resolvedOrgRole).toBe('SUPER_ADMIN');
    });
  });

  // ── 6. REVOKED MEMBERSHIP ──────────────────────────────────
  describe('6. Revoked Membership Enforcement', () => {
    it('immediately revokes access when an org member or competition judge role is removed', async () => {
      // Confirm Admin currently has access
      const beforeOrgRevoke = await authorizationService.authorizeOperation(adminAlphaSession, {
        operation: 'COMPETITION_CREATE',
        organizationId: orgAlpha.id,
      });
      expect(beforeOrgRevoke.allowed).toBe(true);

      // Revoke org membership
      await organizationService.removeMember(orgAlpha.id, adminAlphaSession.uid);

      const afterOrgRevoke = await authorizationService.authorizeOperation(adminAlphaSession, {
        operation: 'COMPETITION_CREATE',
        organizationId: orgAlpha.id,
      });
      expect(afterOrgRevoke.allowed).toBe(false);
      expect(afterOrgRevoke.code).toBe('CROSS_TENANT_DENIED');

      // Confirm Judge currently can evaluate
      const beforeJudgeRevoke = await authorizationService.authorizeOperation(judgeAlphaSession, {
        operation: 'SUBMISSION_EVALUATE',
        competitionId: compAlphaPrivate.id,
      });
      expect(beforeJudgeRevoke.allowed).toBe(true);

      // Revoke judge role on competition
      await competitionService.removeCompetitionRole(compAlphaPrivate.id, judgeAlphaSession.uid);

      const afterJudgeRevoke = await authorizationService.authorizeOperation(judgeAlphaSession, {
        operation: 'SUBMISSION_EVALUATE',
        competitionId: compAlphaPrivate.id,
      });
      expect(afterJudgeRevoke.allowed).toBe(false);
    });
  });

  // ── 7. EXPIRED & REVOKED SESSIONS ──────────────────────────
  describe('7. Expired & Revoked Sessions', () => {
    it('rejects expired sessions even for Org Owners and Platform Admins', async () => {
      const now = Date.now();
      const expiredOwner = makeSession({
        ...ownerAlphaSession,
        tokenExpiresAtMs: now - 1000,
      });
      const expiredPlatformAdmin = makeSession({
        ...platformAdminSession,
        tokenExpiresAtMs: now - 5000,
      });
      const revokedOwner = makeSession({
        ...ownerAlphaSession,
        revoked: true,
      });

      const res1 = await authorizationService.authorizeOperation(expiredOwner, {
        operation: 'ORG_MANAGE',
        organizationId: orgAlpha.id,
        nowMs: now,
      });
      expect(res1.allowed).toBe(false);
      expect(res1.code).toBe('SESSION_EXPIRED');

      const res2 = await authorizationService.authorizeOperation(expiredPlatformAdmin, {
        operation: 'COMPETITION_MANAGE',
        competitionId: compAlphaPrivate.id,
        nowMs: now,
      });
      expect(res2.allowed).toBe(false);
      expect(res2.code).toBe('SESSION_EXPIRED');

      const res3 = await authorizationService.authorizeOperation(revokedOwner, {
        operation: 'ORG_READ',
        organizationId: orgAlpha.id,
        nowMs: now,
      });
      expect(res3.allowed).toBe(false);
      expect(res3.code).toBe('SESSION_EXPIRED');
    });

    it('maps Firebase token expiration errors cleanly for UI handling', () => {
      expect(mapFirebaseAuthError({ code: 'auth/user-token-expired' })).toContain('session has expired');
      expect(mapFirebaseAuthError({ code: 'auth/id-token-revoked' })).toContain('session has expired');
      expect(mapFirebaseAuthError({ code: 'auth/invalid-credential' })).toContain('Invalid email or password');
    });
  });

  // ── 8. UNAUTHORIZED MUTATIONS & INVITATION ONBOARDING ─────
  describe('8. Unauthorized Mutations & Invitation Onboarding Security', () => {
    it('blocks unauthorized users from issuing invitations and enforces strict invite acceptance rules', async () => {
      // Judge and Viewer CANNOT create invitations
      await expect(
        invitationService.createInvitation(judgeAlphaSession, {
          targetType: 'COMPETITION',
          organizationId: orgAlpha.id,
          competitionId: compAlphaPrivate.id,
          email: 'newjudge@university.edu',
          role: 'JUDGE',
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        invitationService.createInvitation(viewerAlphaSession, {
          targetType: 'ORGANIZATION',
          organizationId: orgAlpha.id,
          email: 'attacker@evil.org',
          role: 'OWNER',
        })
      ).rejects.toThrow(AuthorizationError);

      // Owner CAN issue a scoped JUDGE invitation
      const invite = await invitationService.createInvitation(ownerAlphaSession, {
        targetType: 'COMPETITION',
        organizationId: orgAlpha.id,
        competitionId: compAlphaPrivate.id,
        email: 'newjudge@university.edu',
        role: 'JUDGE',
        expiresInHours: 24,
      });
      expect(invite.status).toBe('PENDING');

      // Wrong email account CANNOT accept the invitation
      const wrongUser = makeSession({
        uid: 'uid-wrong',
        email: 'impostor@other.org',
        displayName: 'Wrong User',
      });
      await expect(invitationService.acceptInvitation(wrongUser, invite.id)).rejects.toThrow(
        /issued to newjudge@university\.edu/
      );

      // Matching verified email CAN accept and gains ONLY JUDGE role (not organizer!)
      const invitedJudge = makeSession({
        uid: 'uid-new-judge',
        email: 'newjudge@university.edu',
        displayName: 'New Judge',
      });
      const accepted = await invitationService.acceptInvitation(invitedJudge, invite.id);
      expect(accepted.status).toBe('ACCEPTED');

      const canEval = await authorizationService.authorizeOperation(invitedJudge, {
        operation: 'SUBMISSION_EVALUATE',
        competitionId: compAlphaPrivate.id,
      });
      expect(canEval.allowed).toBe(true);
      expect(canEval.resolvedCompetitionRole).toBe('JUDGE');

      const cannotManage = await authorizationService.authorizeOperation(invitedJudge, {
        operation: 'COMPETITION_MANAGE',
        competitionId: compAlphaPrivate.id,
      });
      expect(cannotManage.allowed).toBe(false);

      // Replaying an already-accepted invitation fails
      await expect(invitationService.acceptInvitation(invitedJudge, invite.id)).rejects.toThrow(
        /already been accepted/
      );
    });

    it('blocks acceptance of revoked or expired invitations', async () => {
      const invite = await invitationService.createInvitation(ownerAlphaSession, {
        targetType: 'COMPETITION',
        organizationId: orgAlpha.id,
        competitionId: compAlphaPrivate.id,
        email: 'revoked@university.edu',
        role: 'JUDGE',
        expiresInHours: 1,
      });

      const targetSession = makeSession({
        uid: 'uid-revoked-invitee',
        email: 'revoked@university.edu',
        displayName: 'Revoked Invitee',
      });

      // Expired check (2 hours in the future)
      await expect(
        invitationService.acceptInvitation(targetSession, invite.id, Date.now() + 2 * 3_600_000)
      ).rejects.toThrow(/expired/);

      // Revoke and verify acceptance is blocked
      await invitationService.revokeInvitation(ownerAlphaSession, invite.id);
      await expect(invitationService.acceptInvitation(targetSession, invite.id)).rejects.toThrow(
        /revoked/
      );
    });
  });

  // ── 9. ENSURE NO STALE OWNER FALLBACK AFTER MEMBERSHIP REMOVAL ─
  describe('9. Authoritative Membership Source of Truth', () => {
    it('does not treat removed org owners as members via org.ownerId fallback', async () => {
      const membersBefore: OrganizationMember[] = await organizationService.listMembers(orgAlpha.id);
      expect(membersBefore.some((m) => m.userId === ownerAlphaSession.uid)).toBe(true);

      await organizationService.removeMember(orgAlpha.id, ownerAlphaSession.uid);
      const userOrgs = await organizationService.getUserOrganizations(ownerAlphaSession.uid);
      expect(userOrgs.some((o) => o.id === orgAlpha.id)).toBe(false);
    });
  });
});
