// ─────────────────────────────────────────────
// organizationService.ts — Organization Management & Multi-Tenancy
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import type {
  Organization,
  OrganizationMember,
  OrgRole,
} from '../types/authAndCompetition';

import { purgeLegacySampleStorageOnce } from '../utils/cleanSampleStorage';

const ACTIVE_ORG_STORAGE_KEY = 'proofly_active_org_id';
const ORGS_STORAGE_KEY = 'proofly_organizations_v1';
const MEMBERS_STORAGE_KEY = 'proofly_org_members_v1';
let memoryActiveOrgId: string | null = null;

// Local in-memory store for fallback/tests/offline dev
let localOrganizations: Organization[] = [];
let localMembers: OrganizationMember[] = [];

function loadOrgsFromStorage(): void {
  purgeLegacySampleStorageOnce();
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const rawOrgs = window.localStorage.getItem(ORGS_STORAGE_KEY);
    if (rawOrgs) {
      const parsed = JSON.parse(rawOrgs);
      if (Array.isArray(parsed)) {
        localOrganizations = parsed;
      }
    }
    const rawMembers = window.localStorage.getItem(MEMBERS_STORAGE_KEY);
    if (rawMembers) {
      const parsed = JSON.parse(rawMembers);
      if (Array.isArray(parsed)) {
        localMembers = parsed;
      }
    }
  } catch {
    // Ignore storage errors
  }
}

function saveOrgsToStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(ORGS_STORAGE_KEY, JSON.stringify(localOrganizations));
    window.localStorage.setItem(MEMBERS_STORAGE_KEY, JSON.stringify(localMembers));
  } catch {
    // Ignore storage errors
  }
}

loadOrgsFromStorage();

export const organizationService = {
  /**
   * Ensures a default workspace organization exists for the given user if they have none.
   */
  async ensureDefaultOrganizationForUser(
    userId: string,
    email: string,
    displayName: string
  ): Promise<Organization> {
    const existing = await this.getUserOrganizations(userId);
    if (existing.length > 0) {
      return existing[0];
    }

    const defaultOrgId = 'org-workspace';
    const existingDefault = localOrganizations.find((o) => o.id === defaultOrgId);
    const now = new Date().toISOString();

    if (existingDefault) {
      if (!localMembers.some((m) => m.orgId === defaultOrgId && m.userId === userId)) {
        localMembers.push({
          userId,
          orgId: defaultOrgId,
          role: existingDefault.ownerId === userId ? 'OWNER' : 'ADMIN',
          email,
          displayName,
          joinedAt: now,
        });
        saveOrgsToStorage();
      }
      this.setActiveOrganizationId(defaultOrgId);
      return existingDefault;
    }

    const defaultOrg: Organization = {
      id: defaultOrgId,
      name: 'Proofly Workspace',
      slug: 'proofly-workspace',
      tagline: '',
      website: '',
      ownerId: userId,
      createdAt: now,
      updatedAt: now,
    };
    const ownerMember: OrganizationMember = {
      userId,
      orgId: defaultOrgId,
      role: 'OWNER',
      email,
      displayName,
      joinedAt: now,
    };

    localOrganizations.push(defaultOrg);
    localMembers.push(ownerMember);
    saveOrgsToStorage();
    this.setActiveOrganizationId(defaultOrgId);

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'organizations', defaultOrgId), sanitizeFirestoreData(defaultOrg));
        await setDoc(
          doc(db, 'organizations', defaultOrgId, 'members', userId),
          sanitizeFirestoreData(ownerMember)
        );
      } catch {
        // Firestore unavailable or unauthenticated — local workspace fallback active
      }
    }

    return defaultOrg;
  },

  /**
   * Creates a new organization and assigns the creator as the OWNER.
   */
  async createOrganization(
    name: string,
    ownerId: string,
    ownerEmail: string,
    ownerName: string,
    tagline?: string,
    website?: string
  ): Promise<Organization> {
    const orgId = `org-${Math.random().toString(36).substring(2, 9)}`;
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const now = new Date().toISOString();
    const newOrg: Organization = {
      id: orgId,
      name,
      slug: slug || orgId,
      tagline: tagline || '',
      website: website || '',
      ownerId,
      createdAt: now,
      updatedAt: now,
    };

    const ownerMember: OrganizationMember = {
      userId: ownerId,
      orgId,
      role: 'OWNER',
      email: ownerEmail,
      displayName: ownerName,
      joinedAt: now,
    };

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'organizations', orgId), sanitizeFirestoreData(newOrg));
        await setDoc(doc(db, 'organizations', orgId, 'members', ownerId), sanitizeFirestoreData(ownerMember));
      } catch {
        // Fallback to local store when Firestore rules reject unauthenticated writes
      }
    }

    localOrganizations.push(newOrg);
    localMembers.push(ownerMember);
    saveOrgsToStorage();

    this.setActiveOrganizationId(orgId);
    return newOrg;
  },

  /**
   * Retrieves an organization by ID.
   */
  async getOrganization(orgId: string): Promise<Organization | null> {
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDoc(doc(db, 'organizations', orgId));
        if (snap.exists()) {
          return snap.data() as Organization;
        }
      } catch {
        // Fallback to local store
      }
    }
    return localOrganizations.find((o) => o.id === orgId) || null;
  },

  /**
   * Lists all organizations where a user is a registered member.
   */
  async getUserOrganizations(userId: string): Promise<Organization[]> {
    const matchingOrgIds = localMembers
      .filter((m) => m.userId === userId)
      .map((m) => m.orgId);
    return localOrganizations.filter((o) => matchingOrgIds.includes(o.id) || o.ownerId === userId);
  },

  /**
   * Adds or invites a member to an organization.
   */
  async addMember(
    orgId: string,
    userId: string,
    email: string,
    displayName: string,
    role: OrgRole = 'MEMBER'
  ): Promise<OrganizationMember> {
    const member: OrganizationMember = {
      userId,
      orgId,
      role,
      email,
      displayName,
      joinedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'organizations', orgId, 'members', userId), member);
      } catch {
        // Fallback to local store
      }
    }

    localMembers = localMembers.filter((m) => !(m.orgId === orgId && m.userId === userId));
    localMembers.push(member);
    saveOrgsToStorage();
    return member;
  },

  /**
   * Updates an existing member's role within an organization.
   */
  async updateMemberRole(orgId: string, userId: string, newRole: OrgRole): Promise<void> {
    if (isFirebaseConfigured() && db) {
      try {
        await updateDoc(doc(db, 'organizations', orgId, 'members', userId), {
          role: newRole,
        });
      } catch {
        // Fallback to local store
      }
    }

    const found = localMembers.find((m) => m.orgId === orgId && m.userId === userId);
    if (found) {
      found.role = newRole;
      saveOrgsToStorage();
    }
  },

  /**
   * Removes a member from an organization.
   */
  async removeMember(orgId: string, userId: string): Promise<void> {
    if (isFirebaseConfigured() && db) {
      try {
        await deleteDoc(doc(db, 'organizations', orgId, 'members', userId));
      } catch {
        // Fallback to local store
      }
    }

    localMembers = localMembers.filter((m) => !(m.orgId === orgId && m.userId === userId));
    saveOrgsToStorage();
  },

  /**
   * Lists all members of an organization.
   */
  async listMembers(orgId: string): Promise<OrganizationMember[]> {
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDocs(collection(db, 'organizations', orgId, 'members'));
        if (!snap.empty) {
          return snap.docs.map((d) => d.data() as OrganizationMember);
        }
      } catch {
        // Fallback to local store
      }
    }
    return localMembers.filter((m) => m.orgId === orgId);
  },

  /**
   * Gets the active organization ID from persistent local storage or in-memory fallback.
   */
  getActiveOrganizationId(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || (localOrganizations[0]?.id ?? null);
    }
    return memoryActiveOrgId || (localOrganizations[0]?.id ?? null);
  },

  /**
   * Sets and persists the active organization ID.
   */
  setActiveOrganizationId(orgId: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
    }
    memoryActiveOrgId = orgId;
  },

  /**
   * Reset in-memory state (useful for test isolation).
   */
  resetInMemoryStore(orgs: Organization[] = [], members: OrganizationMember[] = []): void {
    localOrganizations = [...orgs];
    localMembers = [...members];
  },
};
