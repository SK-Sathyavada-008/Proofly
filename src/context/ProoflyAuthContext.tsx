// ─────────────────────────────────────────────
// ProoflyAuthContext.tsx — Unified Scoped Auth & Multi-Tenancy Context
// ─────────────────────────────────────────────

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  type UserProfile,
  type Organization,
  type OrgRole,
  type CompetitionRole,
} from '../types/authAndCompetition';
import { organizationService } from '../services/organizationService';
import { competitionService } from '../services/competitionService';
import { scopedAuthService, type UserAuthContext } from '../services/scopedAuthService';
import { auth, isFirebaseConfigured } from '../config/firebase';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';

export interface ProoflyAuthContextValue {
  currentUser: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
  activeOrganization: Organization | null;
  userOrganizations: Organization[];
  activeOrgRole: OrgRole | null;
  switchOrganization: (orgId: string) => Promise<void>;
  getCompetitionRole: (competitionId: string) => Promise<CompetitionRole | null>;
  canManageCurrentOrg: boolean;
  loginDemoUser: (userType: 'organizer' | 'judge') => void;
  logout: () => Promise<void>;
}

const ProoflyAuthCtx = createContext<ProoflyAuthContextValue | undefined>(undefined);

// Default workspace organizer profile
const DEMO_ORGANIZER_USER: UserProfile = {
  uid: 'user-organizer-01',
  email: 'organizer@proofly.app',
  displayName: 'Organizer',
  platformRole: 'USER',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const DEMO_JUDGE_USER: UserProfile = {
  uid: 'user-judge-demo',
  email: 'judge@proofly.app',
  displayName: 'Judge',
  platformRole: 'USER',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
};

export const ProoflyAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(DEMO_ORGANIZER_USER);
  const [loading, setLoading] = useState<boolean>(true);
  const [userOrganizations, setUserOrganizations] = useState<Organization[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null);
  const [activeOrgRole, setActiveOrgRole] = useState<OrgRole | null>('OWNER');

  // Load user organizations and active tenant
  const loadUserOrgs = useCallback(async (profile: UserProfile) => {
    try {
      let orgs = await organizationService.getUserOrganizations(profile.uid);
      if (orgs.length === 0) {
        const defaultOrg = await organizationService.ensureDefaultOrganizationForUser(
          profile.uid,
          profile.email,
          profile.displayName
        );
        orgs = [defaultOrg];
      }
      setUserOrganizations(orgs);

      const storedActiveId = organizationService.getActiveOrganizationId();
      const activeId =
        storedActiveId && orgs.some((o) => o.id === storedActiveId)
          ? storedActiveId
          : orgs[0]?.id;

      if (activeId) {
        organizationService.setActiveOrganizationId(activeId);
        const active = (await organizationService.getOrganization(activeId)) || orgs[0] || null;
        setActiveOrganization(active);

        if (profile.uid === DEMO_JUDGE_USER.uid) {
          setActiveOrgRole('MEMBER');
        } else if (active) {
          const members = await organizationService.listMembers(active.id);
          const mem = members.find((m) => m.userId === profile.uid);
          setActiveOrgRole(mem?.role || (active.ownerId === profile.uid ? 'OWNER' : 'MEMBER'));
        }
      }
    } catch (err) {
      console.warn('Could not load user organizations, falling back to default workspace:', err);
      const fallbackOrg = await organizationService.ensureDefaultOrganizationForUser(
        profile.uid,
        profile.email,
        profile.displayName
      );
      setUserOrganizations([fallbackOrg]);
      setActiveOrganization(fallbackOrg);
      setActiveOrgRole(profile.uid === DEMO_JUDGE_USER.uid ? 'MEMBER' : 'OWNER');
    }
  }, []);

  useEffect(() => {
    // Initial load
    if (currentUser) {
      loadUserOrgs(currentUser).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    // Firebase Auth listener (if real user logs in)
    if (isFirebaseConfigured() && auth) {
      const unsub = onAuthStateChanged(auth, (fbUser: User | null) => {
        if (fbUser) {
          const configuredAdminEmail =
            typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_PLATFORM_ADMIN_EMAIL : undefined;
          const isSuperAdmin =
            (Boolean(configuredAdminEmail) && fbUser.email === configuredAdminEmail) ||
            fbUser.email === 'root@proofly.internal';

          const profile: UserProfile = {
            uid: fbUser.uid,
            email: fbUser.email || '',
            displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            photoURL: fbUser.photoURL || undefined,
            platformRole: isSuperAdmin ? 'SUPER_ADMIN' : 'USER',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setCurrentUser(profile);
          loadUserOrgs(profile);
        }
      });
      return () => unsub();
    }
  }, [currentUser?.uid, loadUserOrgs]);

  const switchOrganization = async (orgId: string) => {
    organizationService.setActiveOrganizationId(orgId);
    const org = await organizationService.getOrganization(orgId);
    if (org && currentUser) {
      setActiveOrganization(org);
      const members = await organizationService.listMembers(orgId);
      const myMem = members.find((m) => m.userId === currentUser.uid);
      setActiveOrgRole(myMem?.role || (org.ownerId === currentUser.uid ? 'OWNER' : 'MEMBER'));
    }
  };

  const getCompetitionRole = async (competitionId: string): Promise<CompetitionRole | null> => {
    if (!currentUser) return null;
    const comp = await competitionService.getCompetition(competitionId);
    if (!comp) return null;

    const roles = await competitionService.listCompetitionRoles(competitionId);
    const myAssignment = roles.find((r) => r.userId === currentUser.uid);

    const authContext: UserAuthContext = {
      uid: currentUser.uid,
      email: currentUser.email,
      platformRole: currentUser.platformRole,
      orgMemberships: activeOrganization && activeOrgRole ? { [activeOrganization.id]: activeOrgRole } : {},
      competitionRoles: myAssignment ? { [competitionId]: myAssignment.role } : {},
    };

    return scopedAuthService.resolveCompetitionRole(authContext, competitionId, comp.organizationId);
  };

  const loginDemoUser = (userType: 'organizer' | 'judge') => {
    const target = userType === 'organizer' ? DEMO_ORGANIZER_USER : DEMO_JUDGE_USER;
    setCurrentUser(target);
    loadUserOrgs(target);
  };

  const logout = async () => {
    if (isFirebaseConfigured() && auth) {
      await firebaseSignOut(auth).catch(() => {});
    }
    setCurrentUser(null);
    setActiveOrganization(null);
    setActiveOrgRole(null);
  };

  const canManageCurrentOrg = activeOrgRole === 'OWNER' || activeOrgRole === 'ADMIN';

  return (
    <ProoflyAuthCtx.Provider
      value={{
        currentUser,
        loading,
        isAuthenticated: !!currentUser,
        activeOrganization,
        userOrganizations,
        activeOrgRole,
        switchOrganization,
        getCompetitionRole,
        canManageCurrentOrg,
        loginDemoUser,
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
