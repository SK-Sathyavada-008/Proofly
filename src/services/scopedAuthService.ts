// ─────────────────────────────────────────────
// scopedAuthService.ts — Competition-Scoped Authorization & Tenant Isolation
// ─────────────────────────────────────────────

import type {
  OrgRole,
  CompetitionRole,
  PlatformRole,
  PermissionCheckResult,
} from '../types/authAndCompetition';

export interface UserAuthContext {
  uid: string;
  email: string;
  platformRole?: PlatformRole;
  orgMemberships: Record<string, OrgRole>; // orgId -> OrgRole
  competitionRoles: Record<string, CompetitionRole>; // competitionId -> CompetitionRole
}

export const scopedAuthService = {
  /**
   * Resolves the effective role of a user for a specific organization.
   */
  resolveOrgRole(context: UserAuthContext, orgId: string): OrgRole | null {
    if (context.platformRole === 'SUPER_ADMIN') {
      return 'OWNER';
    }
    return context.orgMemberships[orgId] || null;
  },

  /**
   * Resolves the effective role of a user for a specific competition.
   * Note: An organization OWNER or ADMIN automatically inherits COMPETITION_ADMIN
   * for competitions within their organization.
   */
  resolveCompetitionRole(
    context: UserAuthContext,
    competitionId: string,
    orgId: string
  ): CompetitionRole | null {
    if (context.platformRole === 'SUPER_ADMIN') {
      return 'COMPETITION_ADMIN';
    }

    // Direct competition assignment
    const directRole = context.competitionRoles[competitionId];
    if (directRole) {
      return directRole;
    }

    // Inherited from organization hierarchy
    const orgRole = context.orgMemberships[orgId];
    if (orgRole === 'OWNER' || orgRole === 'ADMIN') {
      return 'COMPETITION_ADMIN';
    }

    return null;
  },

  /**
   * Checks whether the user can manage an organization (update settings, invite members).
   */
  canManageOrganization(context: UserAuthContext, orgId: string): PermissionCheckResult {
    const role = this.resolveOrgRole(context, orgId);
    if (role === 'OWNER' || role === 'ADMIN') {
      return { allowed: true, resolvedRole: role };
    }
    return {
      allowed: false,
      reason: 'Organization management requires OWNER or ADMIN permissions.',
      resolvedRole: role || undefined,
    };
  },

  /**
   * Checks whether the user can create a competition within an organization.
   */
  canCreateCompetition(context: UserAuthContext, orgId: string): PermissionCheckResult {
    const role = this.resolveOrgRole(context, orgId);
    if (role === 'OWNER' || role === 'ADMIN') {
      return { allowed: true, resolvedRole: role };
    }
    return {
      allowed: false,
      reason: 'Creating competitions requires Organization OWNER or ADMIN status.',
      resolvedRole: role || undefined,
    };
  },

  /**
   * Checks whether the user can modify a competition's configuration, rubrics, or deadlines.
   */
  canEditCompetition(
    context: UserAuthContext,
    competitionId: string,
    orgId: string
  ): PermissionCheckResult {
    const role = this.resolveCompetitionRole(context, competitionId, orgId);
    if (role === 'COMPETITION_ADMIN' || role === 'ORGANIZER') {
      return { allowed: true, resolvedRole: role };
    }
    return {
      allowed: false,
      reason: 'Modifying competition configurations requires COMPETITION_ADMIN or ORGANIZER privileges.',
      resolvedRole: role || undefined,
    };
  },

  /**
   * Checks whether the user can perform human evaluations on submissions.
   * Judges can evaluate, as well as Organizers and Admins.
   */
  canEvaluateSubmission(
    context: UserAuthContext,
    competitionId: string,
    orgId: string
  ): PermissionCheckResult {
    const role = this.resolveCompetitionRole(context, competitionId, orgId);
    if (role === 'JUDGE' || role === 'ORGANIZER' || role === 'COMPETITION_ADMIN') {
      return { allowed: true, resolvedRole: role };
    }
    return {
      allowed: false,
      reason: 'Submitting evaluations requires an authorized JUDGE, ORGANIZER, or COMPETITION_ADMIN assignment.',
      resolvedRole: role || undefined,
    };
  },

  /**
   * Checks whether the user can publish official finalized results.
   * Product Decision #13: Official results require authorized organizer approval.
   */
  canPublishResults(
    context: UserAuthContext,
    competitionId: string,
    orgId: string
  ): PermissionCheckResult {
    const role = this.resolveCompetitionRole(context, competitionId, orgId);
    if (role === 'COMPETITION_ADMIN' || role === 'ORGANIZER') {
      return { allowed: true, resolvedRole: role };
    }
    return {
      allowed: false,
      reason: 'Publishing official competition results requires explicit ORGANIZER or COMPETITION_ADMIN authorization.',
      resolvedRole: role || undefined,
    };
  },

  /**
   * Prevents cross-organization data access (multi-tenant isolation check).
   */
  assertTenantIsolation(
    context: UserAuthContext,
    targetOrgId: string
  ): PermissionCheckResult {
    if (context.platformRole === 'SUPER_ADMIN') {
      return { allowed: true, resolvedRole: 'SUPER_ADMIN' };
    }

    const orgRole = context.orgMemberships[targetOrgId];
    if (!orgRole) {
      return {
        allowed: false,
        reason: `Cross-tenant access violation: User "${context.email}" has no membership in organization "${targetOrgId}".`,
      };
    }

    return { allowed: true, resolvedRole: orgRole };
  },
};
