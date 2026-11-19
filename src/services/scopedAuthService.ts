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

  /**
   * Checks whether the user can view a competition's non-public workspace resources.
   * Allows Platform Admin, any Organization member (OWNER/ADMIN/MEMBER), or any
   * Competition role (COMPETITION_ADMIN, ORGANIZER, JUDGE, VIEWER).
   */
  canViewCompetition(
    context: UserAuthContext,
    competitionId: string,
    orgId: string
  ): PermissionCheckResult {
    const compRole = this.resolveCompetitionRole(context, competitionId, orgId);
    if (compRole) {
      return { allowed: true, resolvedRole: compRole };
    }
    const orgRole = this.resolveOrgRole(context, orgId);
    if (orgRole) {
      return { allowed: true, resolvedRole: orgRole };
    }
    return {
      allowed: false,
      reason: `Access denied: User "${context.email}" has no authorized role for competition "${competitionId}".`,
    };
  },

  /**
   * Checks whether the user can mutate forms, access keys, or judge assignments.
   * Strictly denies VIEWER, JUDGE, and basic org MEMBER roles.
   */
  canManageCompetitionResources(
    context: UserAuthContext,
    competitionId: string,
    orgId: string
  ): PermissionCheckResult {
    const role = this.resolveCompetitionRole(context, competitionId, orgId);
    if (role === 'COMPETITION_ADMIN' || role === 'ORGANIZER') {
      return { allowed: true, resolvedRole: role };
    }
    if (role === 'VIEWER') {
      return {
        allowed: false,
        reason: 'Viewer role is strictly read-only and cannot modify competition resources.',
        resolvedRole: role,
      };
    }
    if (role === 'JUDGE') {
      return {
        allowed: false,
        reason: 'Judge role cannot perform organizer-only mutations.',
        resolvedRole: role,
      };
    }
    return {
      allowed: false,
      reason: 'Managing competition resources requires COMPETITION_ADMIN, ORGANIZER, or Org OWNER/ADMIN privileges.',
      resolvedRole: role || undefined,
    };
  },

  /**
   * Checks whether the user is allowed to enter the Organizer Console workspace.
   * Pure JUDGE-only users are explicitly excluded from organizer console routes.
   */
  canAccessOrganizerWorkspace(context: UserAuthContext): boolean {
    if (context.platformRole === 'SUPER_ADMIN') {
      return true;
    }
    const hasOrgManagementOrMembership = Object.values(context.orgMemberships).some(
      (role) => role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER'
    );
    if (hasOrgManagementOrMembership) {
      return true;
    }
    const hasOrganizerOrViewerCompRole = Object.values(context.competitionRoles).some(
      (role) => role === 'COMPETITION_ADMIN' || role === 'ORGANIZER' || role === 'VIEWER'
    );
    return hasOrganizerOrViewerCompRole;
  },

  /**
   * Checks whether the user is allowed to enter the Judge Workspace.
   * VIEWER-only and unaffiliated users are excluded.
   */
  canAccessJudgeWorkspace(context: UserAuthContext): boolean {
    if (context.platformRole === 'SUPER_ADMIN') {
      return true;
    }
    const hasJudgingCompRole = Object.values(context.competitionRoles).some(
      (role) => role === 'JUDGE' || role === 'ORGANIZER' || role === 'COMPETITION_ADMIN'
    );
    if (hasJudgingCompRole) {
      return true;
    }
    return Object.values(context.orgMemberships).some(
      (role) => role === 'OWNER' || role === 'ADMIN'
    );
  },

  /**
   * Checks whether the user holds strictly read-only (VIEWER / MEMBER) access
   * within the given org + optional competition scope.
   */
  isReadOnlyViewer(
    context: UserAuthContext,
    orgId?: string,
    competitionId?: string
  ): boolean {
    if (context.platformRole === 'SUPER_ADMIN') return false;
    if (orgId) {
      const orgRole = this.resolveOrgRole(context, orgId);
      if (orgRole === 'OWNER' || orgRole === 'ADMIN') return false;
    }
    if (competitionId && orgId) {
      const compRole = this.resolveCompetitionRole(context, competitionId, orgId);
      if (compRole === 'COMPETITION_ADMIN' || compRole === 'ORGANIZER' || compRole === 'JUDGE') {
        return false;
      }
      return compRole === 'VIEWER' || this.resolveOrgRole(context, orgId) === 'MEMBER';
    }
    if (orgId) {
      return this.resolveOrgRole(context, orgId) === 'MEMBER';
    }
    const compRoles = Object.values(context.competitionRoles);
    return compRoles.length > 0 && compRoles.every((r) => r === 'VIEWER');
  },
};
