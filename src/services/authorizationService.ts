// ─────────────────────────────────────────────
// authorizationService.ts — Authoritative Scoped Operation Authorization
// Proofly Phase 01 — Never trusts browser-supplied role values
// ─────────────────────────────────────────────

import type {
  CompetitionRole,
  OrgRole,
} from '../types/authAndCompetition';
import type { VerifiedAuthSession } from './firebaseAuthService';
import { organizationService } from './organizationService';
import { competitionService } from './competitionService';
import { scopedAuthService, type UserAuthContext } from './scopedAuthService';

export type AuthorizedOperation =
  | 'ORG_READ'
  | 'ORG_MANAGE'
  | 'ORG_MEMBER_MANAGE'
  | 'COMPETITION_CREATE'
  | 'COMPETITION_READ'
  | 'COMPETITION_MANAGE'
  | 'FORM_MANAGE'
  | 'ACCESS_KEY_MANAGE'
  | 'JUDGE_INVITE_OR_ASSIGN'
  | 'SUBMISSION_READ'
  | 'SUBMISSION_EVALUATE'
  | 'EVALUATION_REOPEN'
  | 'RESULTS_PUBLISH';

export type AuthorizationFailureCode =
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'MEMBERSHIP_REVOKED'
  | 'CROSS_TENANT_DENIED'
  | 'VIEWER_READ_ONLY'
  | 'UNASSIGNED_RESOURCE'
  | 'RESOURCE_NOT_FOUND'
  | 'FORBIDDEN';

export interface AuthorizationRequest {
  operation: AuthorizedOperation;
  organizationId?: string;
  competitionId?: string;
  /** Optional list of judge UIDs assigned to a specific submission (enforces judge assignment isolation). */
  assignedJudgeIds?: string[];
  /** Optional clock override for deterministic expiration tests. */
  nowMs?: number;
}

export interface AuthorizationDecision {
  allowed: boolean;
  code?: AuthorizationFailureCode;
  reason?: string;
  resolvedOrgRole?: OrgRole | 'SUPER_ADMIN' | null;
  resolvedCompetitionRole?: CompetitionRole | null;
}

export class AuthorizationError extends Error {
  public readonly code: AuthorizationFailureCode;
  public readonly operation: AuthorizedOperation;

  constructor(code: AuthorizationFailureCode, operation: AuthorizedOperation, message: string) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
    this.operation = operation;
  }
}

const MUTATION_OPERATIONS = new Set<AuthorizedOperation>([
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
]);

/**
 * Independently verifies identity, session validity, authoritative organization/competition
 * memberships, resource ownership/assignment, and scoped operation permissions.
 *
 * SECURITY RULE: Never trusts role values or `isAdmin` flags passed from the browser.
 */
export const authorizationService = {
  /**
   * Builds an authoritative UserAuthContext for a verified session by loading
   * current memberships directly from the organization & competition stores.
   */
  async buildAuthoritativeContext(
    session: VerifiedAuthSession,
    scope: { organizationId?: string; competitionId?: string }
  ): Promise<{
    context: UserAuthContext;
    effectiveOrgId?: string;
    orgExists: boolean;
    competitionExists: boolean;
  }> {
    let effectiveOrgId = scope.organizationId;
    let competitionExists = false;
    let orgExists = false;
    const orgMemberships: Record<string, OrgRole> = {};
    const competitionRoles: Record<string, CompetitionRole> = {};

    // 1. If a competitionId is targeted, resolve its authoritative organizationId
    if (scope.competitionId) {
      const comp = await competitionService.getCompetition(scope.competitionId);
      if (comp) {
        competitionExists = true;
        // Cross-tenant spoofing guard: if caller supplied a mismatched organizationId, reject later
        if (!effectiveOrgId) {
          effectiveOrgId = comp.organizationId;
        }
        const compRoles = await competitionService.listCompetitionRoles(comp.id);
        const myCompRole = compRoles.find((r) => r.userId === session.uid);
        if (myCompRole) {
          competitionRoles[comp.id] = myCompRole.role;
        }
      }
    }

    // 2. Load authoritative organization membership (never cached client role)
    if (effectiveOrgId) {
      const org = await organizationService.getOrganization(effectiveOrgId);
      if (org) {
        orgExists = true;
        const members = await organizationService.listMembers(effectiveOrgId);
        const myMember = members.find((m) => m.userId === session.uid);
        if (myMember) {
          orgMemberships[effectiveOrgId] = myMember.role;
        }
      }
    }

    return {
      context: {
        uid: session.uid,
        email: session.email,
        platformRole: session.platformRole,
        orgMemberships,
        competitionRoles,
      },
      effectiveOrgId,
      orgExists,
      competitionExists,
    };
  },

  /**
   * Evaluates whether `session` is authorized to execute `request`.
   */
  async authorizeOperation(
    session: VerifiedAuthSession | null | undefined,
    request: AuthorizationRequest
  ): Promise<AuthorizationDecision> {
    const nowMs = request.nowMs ?? Date.now();

    // 1. Verify Firebase identity exists
    if (!session || !session.uid) {
      return {
        allowed: false,
        code: 'UNAUTHENTICATED',
        reason: 'Authentication required. Please sign in with a verified account.',
      };
    }

    // 2. Verify session has not been revoked or expired
    if (session.revoked || session.tokenExpiresAtMs <= nowMs) {
      return {
        allowed: false,
        code: 'SESSION_EXPIRED',
        reason: 'Your authentication session has expired or been revoked. Please sign in again.',
      };
    }

    // 3. Cross-tenant competition <-> organization consistency check
    let targetOrgId = request.organizationId;
    if (request.competitionId) {
      const comp = await competitionService.getCompetition(request.competitionId);
      if (!comp) {
        return {
          allowed: false,
          code: 'RESOURCE_NOT_FOUND',
          reason: `Competition "${request.competitionId}" does not exist.`,
        };
      }
      if (targetOrgId && comp.organizationId !== targetOrgId) {
        return {
          allowed: false,
          code: 'CROSS_TENANT_DENIED',
          reason: `Cross-tenant violation: Competition "${request.competitionId}" does not belong to organization "${targetOrgId}".`,
        };
      }
      targetOrgId = comp.organizationId;
    }

    // 4. Load fresh authoritative memberships
    const { context, effectiveOrgId, orgExists } = await this.buildAuthoritativeContext(session, {
      organizationId: targetOrgId,
      competitionId: request.competitionId,
    });

    const isSuperAdmin = session.platformRole === 'SUPER_ADMIN';

    if (effectiveOrgId && !orgExists && !isSuperAdmin) {
      return {
        allowed: false,
        code: 'RESOURCE_NOT_FOUND',
        reason: `Organization "${effectiveOrgId}" does not exist.`,
      };
    }

    const resolvedOrgRole = effectiveOrgId
      ? scopedAuthService.resolveOrgRole(context, effectiveOrgId)
      : null;
    const resolvedCompetitionRole =
      request.competitionId && effectiveOrgId
        ? scopedAuthService.resolveCompetitionRole(context, request.competitionId, effectiveOrgId)
        : null;

    // 5. Explicit Viewer read-only enforcement for all mutations
    if (
      MUTATION_OPERATIONS.has(request.operation) &&
      !isSuperAdmin &&
      resolvedCompetitionRole === 'VIEWER' &&
      resolvedOrgRole !== 'OWNER' &&
      resolvedOrgRole !== 'ADMIN'
    ) {
      return {
        allowed: false,
        code: 'VIEWER_READ_ONLY',
        reason: `Viewer role is strictly read-only and cannot perform "${request.operation}".`,
        resolvedOrgRole,
        resolvedCompetitionRole,
      };
    }

    // 6. Operation-specific scoped policy evaluation
    switch (request.operation) {
      case 'ORG_READ': {
        if (!effectiveOrgId) {
          return { allowed: false, code: 'FORBIDDEN', reason: 'Organization ID is required.' };
        }
        const isolation = scopedAuthService.assertTenantIsolation(context, effectiveOrgId);
        if (!isolation.allowed) {
          return {
            allowed: false,
            code: 'CROSS_TENANT_DENIED',
            reason: isolation.reason,
            resolvedOrgRole: null,
          };
        }
        return {
          allowed: true,
          resolvedOrgRole: isSuperAdmin ? 'SUPER_ADMIN' : resolvedOrgRole,
        };
      }

      case 'ORG_MANAGE':
      case 'ORG_MEMBER_MANAGE':
      case 'COMPETITION_CREATE': {
        if (!effectiveOrgId) {
          return { allowed: false, code: 'FORBIDDEN', reason: 'Organization ID is required.' };
        }
        const check =
          request.operation === 'COMPETITION_CREATE'
            ? scopedAuthService.canCreateCompetition(context, effectiveOrgId)
            : scopedAuthService.canManageOrganization(context, effectiveOrgId);
        if (!check.allowed) {
          const isNoMember = !resolvedOrgRole && !isSuperAdmin;
          return {
            allowed: false,
            code: isNoMember ? 'CROSS_TENANT_DENIED' : 'FORBIDDEN',
            reason: check.reason,
            resolvedOrgRole,
          };
        }
        return {
          allowed: true,
          resolvedOrgRole: isSuperAdmin ? 'SUPER_ADMIN' : resolvedOrgRole,
        };
      }

      case 'COMPETITION_READ':
      case 'SUBMISSION_READ': {
        if (!request.competitionId || !effectiveOrgId) {
          return { allowed: false, code: 'FORBIDDEN', reason: 'Competition ID is required.' };
        }
        const check = scopedAuthService.canViewCompetition(
          context,
          request.competitionId,
          effectiveOrgId
        );
        if (!check.allowed) {
          return {
            allowed: false,
            code: 'CROSS_TENANT_DENIED',
            reason: check.reason,
            resolvedOrgRole,
            resolvedCompetitionRole,
          };
        }
        return {
          allowed: true,
          resolvedOrgRole: isSuperAdmin ? 'SUPER_ADMIN' : resolvedOrgRole,
          resolvedCompetitionRole,
        };
      }

      case 'COMPETITION_MANAGE':
      case 'FORM_MANAGE':
      case 'ACCESS_KEY_MANAGE':
      case 'JUDGE_INVITE_OR_ASSIGN':
      case 'EVALUATION_REOPEN': {
        if (!request.competitionId || !effectiveOrgId) {
          return { allowed: false, code: 'FORBIDDEN', reason: 'Competition ID is required.' };
        }
        const check = scopedAuthService.canManageCompetitionResources(
          context,
          request.competitionId,
          effectiveOrgId
        );
        if (!check.allowed) {
          const hasAnyScope = Boolean(resolvedOrgRole || resolvedCompetitionRole);
          return {
            allowed: false,
            code: hasAnyScope ? 'FORBIDDEN' : 'CROSS_TENANT_DENIED',
            reason: check.reason,
            resolvedOrgRole,
            resolvedCompetitionRole,
          };
        }
        return {
          allowed: true,
          resolvedOrgRole: isSuperAdmin ? 'SUPER_ADMIN' : resolvedOrgRole,
          resolvedCompetitionRole,
        };
      }

      case 'RESULTS_PUBLISH': {
        if (!request.competitionId || !effectiveOrgId) {
          return { allowed: false, code: 'FORBIDDEN', reason: 'Competition ID is required.' };
        }
        const check = scopedAuthService.canPublishResults(
          context,
          request.competitionId,
          effectiveOrgId
        );
        if (!check.allowed) {
          const hasAnyScope = Boolean(resolvedOrgRole || resolvedCompetitionRole);
          return {
            allowed: false,
            code: hasAnyScope ? 'FORBIDDEN' : 'CROSS_TENANT_DENIED',
            reason: check.reason,
            resolvedOrgRole,
            resolvedCompetitionRole,
          };
        }
        return {
          allowed: true,
          resolvedOrgRole: isSuperAdmin ? 'SUPER_ADMIN' : resolvedOrgRole,
          resolvedCompetitionRole,
        };
      }

      case 'SUBMISSION_EVALUATE': {
        if (!request.competitionId || !effectiveOrgId) {
          return { allowed: false, code: 'FORBIDDEN', reason: 'Competition ID is required.' };
        }
        const check = scopedAuthService.canEvaluateSubmission(
          context,
          request.competitionId,
          effectiveOrgId
        );
        if (!check.allowed) {
          const hasAnyScope = Boolean(resolvedOrgRole || resolvedCompetitionRole);
          return {
            allowed: false,
            code: hasAnyScope ? 'FORBIDDEN' : 'CROSS_TENANT_DENIED',
            reason: check.reason,
            resolvedOrgRole,
            resolvedCompetitionRole,
          };
        }

        // Enforce judge assignment scoping when submission assignments are specified
        if (
          !isSuperAdmin &&
          resolvedCompetitionRole === 'JUDGE' &&
          Array.isArray(request.assignedJudgeIds) &&
          !request.assignedJudgeIds.includes(session.uid)
        ) {
          return {
            allowed: false,
            code: 'UNASSIGNED_RESOURCE',
            reason: 'You are not assigned to evaluate this submission.',
            resolvedOrgRole,
            resolvedCompetitionRole,
          };
        }

        return {
          allowed: true,
          resolvedOrgRole: isSuperAdmin ? 'SUPER_ADMIN' : resolvedOrgRole,
          resolvedCompetitionRole,
        };
      }

      default:
        return {
          allowed: false,
          code: 'FORBIDDEN',
          reason: `Unsupported operation "${request.operation}".`,
        };
    }
  },

  /**
   * Asserts authorization and throws an AuthorizationError if denied.
   */
  async assertAuthorized(
    session: VerifiedAuthSession | null | undefined,
    request: AuthorizationRequest
  ): Promise<AuthorizationDecision> {
    const decision = await this.authorizeOperation(session, request);
    if (!decision.allowed) {
      throw new AuthorizationError(
        decision.code || 'FORBIDDEN',
        request.operation,
        decision.reason || 'Access denied.'
      );
    }
    return decision;
  },
};
