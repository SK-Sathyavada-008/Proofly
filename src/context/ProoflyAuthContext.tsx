// ─────────────────────────────────────────────
// ProoflyAuthContext.tsx — Real Firebase Auth & Scoped Multi-Tenant Context
// Proofly Phase 01 — Security-Critical Authentication & Authorization Foundation
// ─────────────────────────────────────────────

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  type UserProfile,
  type Organization,
  type OrgRole,
  type CompetitionRole,
} from '../types/authAndCompetition';
import { organizationService } from '../services/organizationService';
import { competitionService } from '../services/competitionService';
import { scopedAuthService, type UserAuthContext } from '../services/scopedAuthService';
import {
  firebaseAuthService,
  mapFirebaseAuthError,
  type VerifiedAuthSession,
} from '../services/firebaseAuthService';
import { invitationService, type ScopedInvitation } from '../services/invitationService';
import { isDemoModeEnabled } from '../config/firebase';
import type { User } from 'firebase/auth';

export interface ProoflyAuthContextValue {
  currentUser: UserProfile | null;
  verifiedSession: VerifiedAuthSession | null;
  loading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  sessionExpired: boolean;
  isDemoModeAvailable: boolean;
  activeOrganization: Organization | null;
  userOrganizations: Organization[];
  orgMemberships: Record<string, OrgRole>;
  competitionRoles: Record<string, CompetitionRole>;
  activeOrgRole: OrgRole | null;
  pendingInvitations: ScopedInvitation[];
  authContext: UserAuthContext | null;
  canManageCurrentOrg: boolean;
  canAccessOrganizerWorkspace: boolean;
  canAccessJudgeWorkspace: boolean;
  isReadOnlyViewer: boolean;
  signInWithEmail: (email: string, password: string) => Promise<VerifiedAuthSession>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<VerifiedAuthSession>;
  signInWithGoogle: () => Promise<VerifiedAuthSession>;
  sendPasswordReset: (email: string) => Promise<void>;
  refreshSession: () => Promise<VerifiedAuthSession | null>;
  refreshMemberships: () => Promise<void>;
  createOrganization: (name: string, tagline?: string) => Promise<Organization>;
  acceptInvitation: (inviteId: string) => Promise<ScopedInvitation>;
  switchOrganization: (orgId: string) => Promise<void>;
  getCompetitionRole: (competitionId: string) => Promise<CompetitionRole | null>;
  clearAuthError: () => void;
  logout: () => Promise<void>;
}

const ProoflyAuthCtx = createContext<ProoflyAuthContextValue | undefined>(undefined);

export const ProoflyAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [verifiedSession, setVerifiedSession] = useState<VerifiedAuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);

  const [userOrganizations, setUserOrganizations] = useState<Organization[]>([]);
  const [orgMemberships, setOrgMemberships] = useState<Record<string, OrgRole>>({});
  const [competitionRoles, setCompetitionRoles] = useState<Record<string, CompetitionRole>>({});
  const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null);
  const [activeOrgRole, setActiveOrgRole] = useState<OrgRole | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<ScopedInvitation[]>([]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearAuthenticatedState = useCallback(() => {
    setCurrentUser(null);
    setVerifiedSession(null);
    setUserOrganizations([]);
    setOrgMemberships({});
    setCompetitionRoles({});
    setActiveOrganization(null);
    setActiveOrgRole(null);
    setPendingInvitations([]);
    organizationService.clearActiveOrganizationId();
  }, []);

  /**
   * Loads authoritative organization memberships, competition roles, and pending invitations
   * directly from Firestore / membership stores for the verified user.
   */
  const loadAuthoritativeMemberships = useCallback(async (session: VerifiedAuthSession) => {
    const [membershipsMap, orgs, compRoleAssignments, invites] = await Promise.all([
      organizationService.getUserOrgMemberships(session.uid),
      organizationService.getUserOrganizations(session.uid),
      competitionService.listUserCompetitionRoles(session.uid),
      invitationService.listPendingInvitationsForEmail(session.email),
    ]);

    if (!mountedRef.current) return;

    const compRolesMap: Record<string, CompetitionRole> = {};
    for (const assignment of compRoleAssignments) {
      compRolesMap[assignment.competitionId] = assignment.role;
    }

    setOrgMemberships(membershipsMap);
    setUserOrganizations(orgs);
    setCompetitionRoles(compRolesMap);
    setPendingInvitations(invites);

    // Only select an active organization that the user genuinely belongs to
    const storedActiveId = organizationService.getActiveOrganizationId();
    const matchedActive =
      (storedActiveId ? orgs.find((o) => o.id === storedActiveId) : undefined) || orgs[0] || null;

    if (matchedActive) {
      organizationService.setActiveOrganizationId(matchedActive.id);
      setActiveOrganization(matchedActive);
      setActiveOrgRole(membershipsMap[matchedActive.id] || null);
    } else {
      organizationService.clearActiveOrganizationId();
      setActiveOrganization(null);
      setActiveOrgRole(null);
    }
  }, []);

  /**
   * Hydrates auth context from a live Firebase User object and validates token freshness.
   */
  const hydrateFromFirebaseUser = useCallback(
    async (fbUser: User | null) => {
      if (!fbUser) {
        if (mountedRef.current) {
          clearAuthenticatedState();
          setLoading(false);
        }
        return;
      }

      try {
        let session = await firebaseAuthService.extractVerifiedSession(fbUser, false);
        if (session.tokenExpiresAtMs <= Date.now()) {
          // Force token refresh if near/past expiration
          session = await firebaseAuthService.extractVerifiedSession(fbUser, true);
        }

        if (!mountedRef.current) return;

        setVerifiedSession(session);
        setCurrentUser(firebaseAuthService.toUserProfile(session));
        setSessionExpired(false);
        setAuthError(null);

        await loadAuthoritativeMemberships(session);
      } catch (err: any) {
        if (!mountedRef.current) return;
        const code = err?.code || '';
        const isExpired =
          code === 'auth/user-token-expired' ||
          code === 'auth/id-token-expired' ||
          code === 'auth/id-token-revoked' ||
          code === 'auth/user-disabled';

        if (isExpired) {
          setSessionExpired(true);
          setAuthError(mapFirebaseAuthError(err));
          await firebaseAuthService.signOutUser().catch(() => {});
          clearAuthenticatedState();
        } else {
          setAuthError(mapFirebaseAuthError(err));
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [clearAuthenticatedState, loadAuthoritativeMemberships]
  );

  // Subscribe to Firebase ID token & auth state changes on mount
  useEffect(() => {
    setLoading(true);
    const unsub = firebaseAuthService.subscribeToAuthState((fbUser) => {
      void hydrateFromFirebaseUser(fbUser);
    });
    return () => unsub();
  }, [hydrateFromFirebaseUser]);

  // Proactive session freshness check (refreshes token before expiry & catches revoked sessions)
  useEffect(() => {
    if (!verifiedSession) return;
    const msUntilRefresh = Math.max(
      60 * 1000,
      verifiedSession.tokenExpiresAtMs - Date.now() - 5 * 60 * 1000
    );
    const timer = window.setTimeout(async () => {
      try {
        const refreshed = await firebaseAuthService.refreshCurrentSession();
        if (!mountedRef.current) return;
        if (!refreshed) {
          setSessionExpired(true);
          clearAuthenticatedState();
          return;
        }
        setVerifiedSession(refreshed);
        setCurrentUser(firebaseAuthService.toUserProfile(refreshed));
      } catch (err) {
        if (!mountedRef.current) return;
        setSessionExpired(true);
        setAuthError(mapFirebaseAuthError(err));
        await firebaseAuthService.signOutUser().catch(() => {});
        clearAuthenticatedState();
      }
    }, Math.min(msUntilRefresh, 30 * 60 * 1000));

    return () => window.clearTimeout(timer);
  }, [verifiedSession, clearAuthenticatedState]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<VerifiedAuthSession> => {
      setAuthError(null);
      setSessionExpired(false);
      try {
        const session = await firebaseAuthService.signInWithEmail(email, password);
        if (mountedRef.current) {
          setVerifiedSession(session);
          setCurrentUser(firebaseAuthService.toUserProfile(session));
          await loadAuthoritativeMemberships(session);
        }
        return session;
      } catch (err) {
        const message = mapFirebaseAuthError(err);
        if (mountedRef.current) setAuthError(message);
        throw new Error(message);
      }
    },
    [loadAuthoritativeMemberships]
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName: string): Promise<VerifiedAuthSession> => {
      setAuthError(null);
      setSessionExpired(false);
      try {
        const session = await firebaseAuthService.signUpWithEmail(email, password, displayName);
        if (mountedRef.current) {
          setVerifiedSession(session);
          setCurrentUser(firebaseAuthService.toUserProfile(session));
          await loadAuthoritativeMemberships(session);
        }
        return session;
      } catch (err) {
        const message = mapFirebaseAuthError(err);
        if (mountedRef.current) setAuthError(message);
        throw new Error(message);
      }
    },
    [loadAuthoritativeMemberships]
  );

  const signInWithGoogle = useCallback(async (): Promise<VerifiedAuthSession> => {
    setAuthError(null);
    setSessionExpired(false);
    try {
      const session = await firebaseAuthService.signInWithGoogle();
      if (mountedRef.current) {
        setVerifiedSession(session);
        setCurrentUser(firebaseAuthService.toUserProfile(session));
        await loadAuthoritativeMemberships(session);
      }
      return session;
    } catch (err) {
      const message = mapFirebaseAuthError(err);
      if (mountedRef.current) setAuthError(message);
      throw new Error(message);
    }
  }, [loadAuthoritativeMemberships]);

  const sendPasswordReset = useCallback(async (email: string): Promise<void> => {
    setAuthError(null);
    try {
      await firebaseAuthService.sendPasswordReset(email);
    } catch (err) {
      const message = mapFirebaseAuthError(err);
      if (mountedRef.current) setAuthError(message);
      throw new Error(message);
    }
  }, []);

  const refreshSession = useCallback(async (): Promise<VerifiedAuthSession | null> => {
    try {
      const refreshed = await firebaseAuthService.refreshCurrentSession();
      if (!mountedRef.current) return refreshed;
      if (!refreshed) {
        clearAuthenticatedState();
        return null;
      }
      setVerifiedSession(refreshed);
      setCurrentUser(firebaseAuthService.toUserProfile(refreshed));
      await loadAuthoritativeMemberships(refreshed);
      return refreshed;
    } catch (err) {
      if (mountedRef.current) {
        setSessionExpired(true);
        setAuthError(mapFirebaseAuthError(err));
        clearAuthenticatedState();
      }
      await firebaseAuthService.signOutUser().catch(() => {});
      return null;
    }
  }, [clearAuthenticatedState, loadAuthoritativeMemberships]);

  const refreshMemberships = useCallback(async (): Promise<void> => {
    if (!verifiedSession) return;
    await loadAuthoritativeMemberships(verifiedSession);
  }, [verifiedSession, loadAuthoritativeMemberships]);

  const createOrganization = useCallback(
    async (name: string, tagline?: string): Promise<Organization> => {
      if (!verifiedSession) {
        throw new Error('You must sign in before creating an organization.');
      }
      const created = await organizationService.createOrganization(
        name.trim(),
        verifiedSession.uid,
        verifiedSession.email,
        verifiedSession.displayName,
        tagline?.trim()
      );
      await loadAuthoritativeMemberships(verifiedSession);
      return created;
    },
    [verifiedSession, loadAuthoritativeMemberships]
  );

  const acceptInvitation = useCallback(
    async (inviteId: string): Promise<ScopedInvitation> => {
      if (!verifiedSession) {
        throw new Error('You must sign in before accepting an invitation.');
      }
      const accepted = await invitationService.acceptInvitation(verifiedSession, inviteId);
      await loadAuthoritativeMemberships(verifiedSession);
      return accepted;
    },
    [verifiedSession, loadAuthoritativeMemberships]
  );

  const switchOrganization = useCallback(
    async (orgId: string): Promise<void> => {
      if (!verifiedSession) return;
      // Enforce tenant isolation: only switch to organizations the user actually belongs to
      const isAuthorizedMember =
        verifiedSession.platformRole === 'SUPER_ADMIN' || Boolean(orgMemberships[orgId]);
      if (!isAuthorizedMember) {
        throw new Error('You do not have membership in the requested organization.');
      }

      organizationService.setActiveOrganizationId(orgId);
      const org = await organizationService.getOrganization(orgId);
      if (org && mountedRef.current) {
        setActiveOrganization(org);
        const members = await organizationService.listMembers(orgId);
        const myMem = members.find((m) => m.userId === verifiedSession.uid);
        setActiveOrgRole(
          myMem?.role || (verifiedSession.platformRole === 'SUPER_ADMIN' ? 'OWNER' : null)
        );
      }
    },
    [verifiedSession, orgMemberships]
  );

  const getCompetitionRole = useCallback(
    async (competitionId: string): Promise<CompetitionRole | null> => {
      if (!verifiedSession) return null;
      const comp = await competitionService.getCompetition(competitionId);
      if (!comp) return null;

      const roles = await competitionService.listCompetitionRoles(competitionId);
      const myAssignment = roles.find((r) => r.userId === verifiedSession.uid);

      const ctx: UserAuthContext = {
        uid: verifiedSession.uid,
        email: verifiedSession.email,
        platformRole: verifiedSession.platformRole,
        orgMemberships,
        competitionRoles: myAssignment
          ? { ...competitionRoles, [competitionId]: myAssignment.role }
          : competitionRoles,
      };

      return scopedAuthService.resolveCompetitionRole(ctx, competitionId, comp.organizationId);
    },
    [verifiedSession, orgMemberships, competitionRoles]
  );

  const logout = useCallback(async () => {
    setAuthError(null);
    setSessionExpired(false);
    await firebaseAuthService.signOutUser().catch(() => {});
    clearAuthenticatedState();
  }, [clearAuthenticatedState]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const authContext = useMemo<UserAuthContext | null>(() => {
    if (!verifiedSession) return null;
    return {
      uid: verifiedSession.uid,
      email: verifiedSession.email,
      platformRole: verifiedSession.platformRole,
      orgMemberships,
      competitionRoles,
    };
  }, [verifiedSession, orgMemberships, competitionRoles]);

  const canManageCurrentOrg = useMemo(() => {
    if (!authContext) return false;
    if (authContext.platformRole === 'SUPER_ADMIN') return true;
    if (!activeOrganization) return false;
    return scopedAuthService.canManageOrganization(authContext, activeOrganization.id).allowed;
  }, [authContext, activeOrganization]);

  const canAccessOrganizerWorkspace = useMemo(() => {
    if (!authContext) return false;
    // Allow Platform Admin, Org members/admins, Competition admins/organizers/viewers,
    // OR brand-new signed-in users with 0 memberships so they can create their first org or accept an invite
    const hasNoRolesYet =
      Object.keys(orgMemberships).length === 0 && Object.keys(competitionRoles).length === 0;
    if (hasNoRolesYet) return true;
    return scopedAuthService.canAccessOrganizerWorkspace(authContext);
  }, [authContext, orgMemberships, competitionRoles]);

  const canAccessJudgeWorkspace = useMemo(() => {
    if (!authContext) return false;
    return scopedAuthService.canAccessJudgeWorkspace(authContext);
  }, [authContext]);

  const isReadOnlyViewer = useMemo(() => {
    if (!authContext) return true;
    return scopedAuthService.isReadOnlyViewer(authContext, activeOrganization?.id);
  }, [authContext, activeOrganization]);

  const isAuthenticated = Boolean(
    currentUser &&
      verifiedSession &&
      !verifiedSession.revoked &&
      verifiedSession.tokenExpiresAtMs > Date.now()
  );

  return (
    <ProoflyAuthCtx.Provider
      value={{
        currentUser,
        verifiedSession,
        loading,
        isAuthenticated,
        authError,
        sessionExpired,
        isDemoModeAvailable: isDemoModeEnabled(),
        activeOrganization,
        userOrganizations,
        orgMemberships,
        competitionRoles,
        activeOrgRole,
        pendingInvitations,
        authContext,
        canManageCurrentOrg,
        canAccessOrganizerWorkspace,
        canAccessJudgeWorkspace,
        isReadOnlyViewer,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        sendPasswordReset,
        refreshSession,
        refreshMemberships,
        createOrganization,
        acceptInvitation,
        switchOrganization,
        getCompetitionRole,
        clearAuthError,
        logout,
      }}
    >
      {children}
    </ProoflyAuthCtx.Provider>
  );
};

export const useProoflyAuth = () => {
  const context = useContext(ProoflyAuthCtx);
  if (!context) {
    throw new Error('useProoflyAuth must be used within a ProoflyAuthProvider');
  }
  return context;
};
