// ─────────────────────────────────────────────
// roleAndTenantIsolation.test.ts
// Unit & Integration Tests: Scoped Roles, Multi-Tenancy & Lifecycle State Machine
// ─────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { scopedAuthService, type UserAuthContext } from '../scopedAuthService';
import { competitionLifecycleService } from '../competitionLifecycleService';
import { organizationService } from '../organizationService';
import { competitionService } from '../competitionService';
import {
  SEED_COMPETITIONS,
  seedDataService,
} from '../seedDataService';
import type { Competition } from '../../types/authAndCompetition';

describe('Proofly Multi-Tenant Scoped Authorization & Isolation', () => {
  beforeEach(() => {
    seedDataService.seedLocalEnvironment();
  });

  describe('1. Competition-Scoped Authorization (No Global isAdmin reliance)', () => {
    it('allows a user to be an ORGANIZER in one competition and a JUDGE in another', () => {
      const userContext: UserAuthContext = {
        uid: 'user-organizer-01',
        email: 'lead.organizer@deepmind.academic',
        platformRole: 'USER',
        orgMemberships: {
          'org-deepmind': 'OWNER',
        },
        competitionRoles: {
          'comp-global-ai': 'COMPETITION_ADMIN',
          'comp-robotics-edge': 'JUDGE',
        },
      };

      // In comp-global-ai, user is COMPETITION_ADMIN
      const roleInAi = scopedAuthService.resolveCompetitionRole(
        userContext,
        'comp-global-ai',
        'org-deepmind'
      );
      expect(roleInAi).toBe('COMPETITION_ADMIN');

      // In comp-robotics-edge, user is strictly a JUDGE
      const roleInRobo = scopedAuthService.resolveCompetitionRole(
        userContext,
        'comp-robotics-edge',
        'org-robotics'
      );
      expect(roleInRobo).toBe('JUDGE');

      // Check actions in comp-global-ai
      const canEditAi = scopedAuthService.canEditCompetition(
        userContext,
        'comp-global-ai',
        'org-deepmind'
      );
      const canPublishAi = scopedAuthService.canPublishResults(
        userContext,
        'comp-global-ai',
        'org-deepmind'
      );
      expect(canEditAi.allowed).toBe(true);
      expect(canPublishAi.allowed).toBe(true);

      // Check actions in comp-robotics-edge
      const canEditRobo = scopedAuthService.canEditCompetition(
        userContext,
        'comp-robotics-edge',
        'org-robotics'
      );
      const canPublishRobo = scopedAuthService.canPublishResults(
        userContext,
        'comp-robotics-edge',
        'org-robotics'
      );
      const canJudgeRobo = scopedAuthService.canEvaluateSubmission(
        userContext,
        'comp-robotics-edge',
        'org-robotics'
      );

      // In comp-robotics-edge, user CAN evaluate, but CANNOT edit competition or publish results!
      expect(canJudgeRobo.allowed).toBe(true);
      expect(canEditRobo.allowed).toBe(false);
      expect(canEditRobo.reason).toContain('requires COMPETITION_ADMIN or ORGANIZER privileges');
      expect(canPublishRobo.allowed).toBe(false);
      expect(canPublishRobo.reason).toContain('requires explicit ORGANIZER or COMPETITION_ADMIN authorization');
    });

    it('denies human evaluation permissions to users without a judge/organizer assignment', () => {
      const viewerContext: UserAuthContext = {
        uid: 'user-viewer-01',
        email: 'viewer@external.org',
        platformRole: 'USER',
        orgMemberships: {},
        competitionRoles: {
          'comp-global-ai': 'VIEWER',
        },
      };

      const evalCheck = scopedAuthService.canEvaluateSubmission(
        viewerContext,
        'comp-global-ai',
        'org-deepmind'
      );
      expect(evalCheck.allowed).toBe(false);
      expect(evalCheck.reason).toContain('requires an authorized JUDGE, ORGANIZER, or COMPETITION_ADMIN');
    });
  });

  describe('2. Multi-Tenant Cross-Organization Isolation', () => {
    it('strictly prevents a user of Org A from accessing or managing Org B', () => {
      const deepmindUser: UserAuthContext = {
        uid: 'user-organizer-01',
        email: 'lead.organizer@deepmind.academic',
        platformRole: 'USER',
        orgMemberships: {
          'org-deepmind': 'OWNER',
        },
        competitionRoles: {},
      };

      // Allowed in Org 1
      const checkOrgA = scopedAuthService.assertTenantIsolation(deepmindUser, 'org-deepmind');
      expect(checkOrgA.allowed).toBe(true);
      expect(checkOrgA.resolvedRole).toBe('OWNER');

      // Rejected in Org 2
      const checkOrgB = scopedAuthService.assertTenantIsolation(deepmindUser, 'org-robotics');
      expect(checkOrgB.allowed).toBe(false);
      expect(checkOrgB.reason).toContain('Cross-tenant access violation');
    });

    it('allows a Platform SUPER_ADMIN to traverse tenant boundaries', () => {
      const superAdmin: UserAuthContext = {
        uid: 'super-admin-01',
        email: 'root@proofly.internal',
        platformRole: 'SUPER_ADMIN',
        orgMemberships: {},
        competitionRoles: {},
      };

      const checkOrgB = scopedAuthService.assertTenantIsolation(superAdmin, 'org-robotics');
      expect(checkOrgB.allowed).toBe(true);
      expect(checkOrgB.resolvedRole).toBe('SUPER_ADMIN');

      const canManage = scopedAuthService.canManageOrganization(superAdmin, 'org-robotics');
      expect(canManage.allowed).toBe(true);
    });
  });

  describe('3. Competition Lifecycle State Machine & Transition Validation', () => {
    it('allows legitimate lifecycle transitions', () => {
      expect(competitionLifecycleService.isValidTransition('DRAFT', 'ACTIVE').valid).toBe(true);
      expect(competitionLifecycleService.isValidTransition('ACTIVE', 'SUBMISSIONS_CLOSED').valid).toBe(true);
      expect(competitionLifecycleService.isValidTransition('SUBMISSIONS_CLOSED', 'EVALUATION').valid).toBe(true);
      expect(competitionLifecycleService.isValidTransition('EVALUATION', 'RESULTS_REVIEW').valid).toBe(true);
      expect(competitionLifecycleService.isValidTransition('RESULTS_REVIEW', 'PUBLISHED').valid).toBe(true);
      expect(competitionLifecycleService.isValidTransition('PUBLISHED', 'ARCHIVED').valid).toBe(true);
    });

    it('strictly blocks illegal lifecycle transitions', () => {
      // Cannot jump from DRAFT to PUBLISHED
      const jumpToPublished = competitionLifecycleService.isValidTransition('DRAFT', 'PUBLISHED');
      expect(jumpToPublished.valid).toBe(false);
      expect(jumpToPublished.reason).toContain('Illegal lifecycle transition');

      // Cannot jump from DRAFT directly to EVALUATION
      const jumpToEval = competitionLifecycleService.isValidTransition('DRAFT', 'EVALUATION');
      expect(jumpToEval.valid).toBe(false);

      // Cannot jump from ACTIVE directly to RESULTS_REVIEW
      const jumpToResults = competitionLifecycleService.isValidTransition('ACTIVE', 'RESULTS_REVIEW');
      expect(jumpToResults.valid).toBe(false);

      // Cannot reactivate ARCHIVED without cloning or explicit process
      const unarchive = competitionLifecycleService.isValidTransition('ARCHIVED', 'ACTIVE');
      expect(unarchive.valid).toBe(false);
    });

    it('rejects competition activation if rubric weights do not equal 100%', () => {
      const badRubricComp: Competition = {
        ...SEED_COMPETITIONS[0],
        status: 'DRAFT',
        rubric: [
          { id: 'c1', name: 'Tech', description: 'Tech', maxScore: 25, weight: 30 },
          { id: 'c2', name: 'Design', description: 'Design', maxScore: 25, weight: 30 },
          // Total weight is only 60%!
        ],
      };

      const validation = competitionLifecycleService.validateForActivation(badRubricComp);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Sum of rubric criteria weights must equal 100%'))).toBe(true);
    });

    it('rejects competition activation if start date is after end date', () => {
      const invertedDateComp: Competition = {
        ...SEED_COMPETITIONS[0],
        status: 'DRAFT',
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2026-11-01T00:00:00.000Z', // Before start!
      };

      const validation = competitionLifecycleService.validateForActivation(invertedDateComp);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('start date cannot be after end date'))).toBe(true);
    });
  });

  describe('4. Submission Acceptance Policies & Constraints', () => {
    it('accepts submissions only when competition is ACTIVE and deadline is not exceeded', () => {
      const activeComp = SEED_COMPETITIONS.find((c) => c.id === 'comp-robotics-edge')!;
      expect(activeComp.status).toBe('ACTIVE');

      // Before deadline
      const beforeDeadline = new Date('2026-11-15T00:00:00.000Z');
      const checkBefore = competitionLifecycleService.canAcceptSubmissions(activeComp, beforeDeadline);
      expect(checkBefore.accepted).toBe(true);

      // After deadline with allowLateSubmissions: false
      const afterDeadline = new Date('2026-12-10T00:00:00.000Z');
      const checkAfter = competitionLifecycleService.canAcceptSubmissions(activeComp, afterDeadline);
      expect(checkAfter.accepted).toBe(false);
      expect(checkAfter.reason).toContain('Submission deadline passed');
    });

    it('locks submission editing when in EVALUATION status or allowSubmissionEdits is false', () => {
      const evalComp = SEED_COMPETITIONS.find((c) => c.id === 'comp-global-ai')!;
      expect(evalComp.status).toBe('EVALUATION');

      const editCheck = competitionLifecycleService.canEditSubmission(evalComp);
      expect(editCheck.allowed).toBe(false);
      expect(editCheck.reason).toContain('locked submission editing');
    });
  });

  describe('5. Organization Switching & State Persistence', async () => {
    it('switches organizations and reflects active tenant membership', async () => {
      organizationService.setActiveOrganizationId('org-deepmind');
      expect(organizationService.getActiveOrganizationId()).toBe('org-deepmind');

      // Switch to org-robotics
      organizationService.setActiveOrganizationId('org-robotics');
      expect(organizationService.getActiveOrganizationId()).toBe('org-robotics');

      const competitionsInRobotics = await competitionService.listOrganizationCompetitions('org-robotics');
      expect(competitionsInRobotics.length).toBe(1);
      expect(competitionsInRobotics[0].id).toBe('comp-robotics-edge');
    });
  });
});
