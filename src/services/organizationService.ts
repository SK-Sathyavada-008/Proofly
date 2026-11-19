// ─────────────────────────────────────────────
// organizationService.ts — Durable Multi-Tenant Organization Persistence
// Proofly Phase 04 — Atomic Firestore Batches/Transactions, Zero Silent Fallbacks
// ─────────────────────────────────────────────

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  setDoc,
  startAfter,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  PersistenceError,
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginatedResult,
  type PaginationOptions,
} from './firestorePersistenceService';
import type {
  Competition,
  Organization,
  OrganizationMember,
  OrganizationSettings,
  OrgRole,
} from '../types/authAndCompetition';

// Harmless UI-only preference: remembers last selected workspace tab in the browser.
// Authoritative organizations & memberships are NEVER persisted in localStorage.
const ACTIVE_ORG_STORAGE_KEY = 'proofly_active_org_id';
let memoryActiveOrgId: string | null = null;

// Unit-test-only in-memory store (used strictly when resolveFirestore() returns null in isolated unit tests)
let unitTestOrganizations: Organization[] = [];
let unitTestMembers: OrganizationMember[] = [];

export const organizationService = {
  /**
   * Ensures a default workspace organization exists for the given user if they have none.
   * Uses Firestore exclusively when configured; creates a unique tenant per user atomically.
   */
  async ensureDefaultOrganizationForUser(
    userId: string,
    email: string,
    displayName: string,
    options?: FirestoreExecutionOptions
  ): Promise<Organization> {
    const existing = await this.getUserOrganizations(userId, options);
    if (existing.length > 0) {
      this.setActiveOrganizationId(existing[0].id);
      return existing[0];
    }

    return this.createOrganization(
      `${displayName || 'Organizer'}'s Workspace`,
      userId,
      email,
      displayName || email.split('@')[0] || 'Owner',
      '',
      '',
      options
    );
  },

  /**
   * Atomically creates a new organization AND its initial OWNER membership document
   * in a single Firestore writeBatch (verified by existsAfter/getAfter in firestore.rules).
   *
   * Failure guarantee: if the Firestore batch fails, throws PersistenceError —
   * NEVER returns a fake organization ID or falls back to localStorage.
   */
  async createOrganization(
    name: string,
    ownerId: string,
    ownerEmail: string,
    ownerName: string,
    tagline?: string,
    website?: string,
    options?: FirestoreExecutionOptions
  ): Promise<Organization> {
    const trimmedName = (name || '').trim();
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      throw new PersistenceError({
        code: 'INVALID_ARGUMENT',
        message: 'Organization name must be between 2 and 120 characters.',
        operation: 'createOrganization',
        collection: 'organizations',
      });
    }
    if (!ownerId) {
      throw new PersistenceError({
        code: 'UNAUTHENTICATED',
        message: 'Authenticated owner UID is required to create an organization.',
        operation: 'createOrganization',
        collection: 'organizations',
      });
    }

    const orgId = `org-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const now = new Date().toISOString();
    const newOrg: Organization = {
      id: orgId,
      name: trimmedName,
      slug: slug || orgId,
      tagline: tagline || '',
      website: website || '',
      ownerId,
      settings: {
        contactEmail: ownerEmail,
        defaultAiMode: 'PREFER_ON_DEVICE',
        appCheckEnforced: true,
        updatedBy: ownerId,
        updatedAt: now,
      },
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

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const batch = writeBatch(fs);
        const orgRef = doc(fs, 'organizations', orgId);
        const memberRef = doc(fs, 'organizations', orgId, 'members', ownerId);

        batch.set(orgRef, withServerTimestamps(sanitizeFirestoreData(newOrg), true));
        batch.set(
          memberRef,
          withServerTimestamps(sanitizeFirestoreData(ownerMember), true)
        );
        await batch.commit();
      } catch (err) {
        throw mapFirestoreError(err, 'createOrganization', 'organizations');
      }
    } else {
      unitTestOrganizations.push(newOrg);
      unitTestMembers.push(ownerMember);
    }

    this.setActiveOrganizationId(orgId);
    return newOrg;
  },

  /**
   * Retrieves an organization by ID from Firestore.
   * Throws PersistenceError on permission denial or backend failure (never falls back silently).
   */
  async getOrganization(
    orgId: string,
    options?: FirestoreExecutionOptions
  ): Promise<Organization | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'organizations', orgId));
        return snap.exists() ? (snap.data() as Organization) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getOrganization', 'organizations');
      }
    }
    return unitTestOrganizations.find((o) => o.id === orgId) || null;
  },

  /**
   * Updates organization metadata (name, tagline, website, logoUrl) in Firestore.
   */
  async updateOrganization(
    orgId: string,
    updates: Partial<Pick<Organization, 'name' | 'slug' | 'tagline' | 'logoUrl' | 'website'>>,
    options?: FirestoreExecutionOptions
  ): Promise<Organization> {
    const now = new Date().toISOString();
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      try {
        const orgRef = doc(fs, 'organizations', orgId);
        const existingSnap = await getDoc(orgRef);
        if (!existingSnap.exists()) {
          throw new PersistenceError({
            code: 'NOT_FOUND',
            message: `Organization "${orgId}" not found.`,
            operation: 'updateOrganization',
            collection: 'organizations',
          });
        }

        const sanitized = sanitizeFirestoreData({
          ...updates,
          updatedAt: now,
        });
        await updateDoc(orgRef, withServerTimestamps(sanitized as Record<string, unknown>, false));
        const updatedSnap = await getDoc(orgRef);
        return updatedSnap.data() as Organization;
      } catch (err) {
        throw mapFirestoreError(err, 'updateOrganization', 'organizations');
      }
    }

    const idx = unitTestOrganizations.findIndex((o) => o.id === orgId);
    if (idx === -1) {
      throw new PersistenceError({
        code: 'NOT_FOUND',
        message: `Organization "${orgId}" not found.`,
        operation: 'updateOrganization',
        collection: 'organizations',
      });
    }
    const updated: Organization = { ...unitTestOrganizations[idx], ...updates, updatedAt: now };
    unitTestOrganizations[idx] = updated;
    return updated;
  },

  /**
   * Persists organization settings (name + settings map) durably to Firestore.
   */
  async updateOrganizationSettings(
    orgId: string,
    params: {
      name?: string;
      settings: OrganizationSettings;
      updatedBy: string;
    },
    options?: FirestoreExecutionOptions
  ): Promise<Organization> {
    const now = new Date().toISOString();
    const nextSettings: OrganizationSettings = {
      ...params.settings,
      updatedBy: params.updatedBy,
      updatedAt: now,
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const orgRef = doc(fs, 'organizations', orgId);
        const existingSnap = await getDoc(orgRef);
        if (!existingSnap.exists()) {
          throw new PersistenceError({
            code: 'NOT_FOUND',
            message: `Organization "${orgId}" not found.`,
            operation: 'updateOrganizationSettings',
            collection: 'organizations',
          });
        }

        const patch: Record<string, unknown> = {
          settings: sanitizeFirestoreData(nextSettings),
          updatedAt: now,
        };
        if (params.name && params.name.trim().length >= 2) {
          patch.name = params.name.trim();
        }

        await updateDoc(orgRef, withServerTimestamps(patch, false));
        const refreshed = await getDoc(orgRef);
        return refreshed.data() as Organization;
      } catch (err) {
        throw mapFirestoreError(err, 'updateOrganizationSettings', 'organizations');
      }
    }

    const idx = unitTestOrganizations.findIndex((o) => o.id === orgId);
    if (idx === -1) {
      throw new PersistenceError({
        code: 'NOT_FOUND',
        message: `Organization "${orgId}" not found.`,
        operation: 'updateOrganizationSettings',
        collection: 'organizations',
      });
    }
    const updated: Organization = {
      ...unitTestOrganizations[idx],
      ...(params.name ? { name: params.name.trim() } : {}),
      settings: nextSettings,
      updatedAt: now,
    };
    unitTestOrganizations[idx] = updated;
    return updated;
  },

  /**
   * Atomically transfers organization ownership to an existing member inside a Firestore transaction.
   */
  async transferOwnership(
    orgId: string,
    currentOwnerId: string,
    newOwnerId: string,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    if (currentOwnerId === newOwnerId) return;
    const now = new Date().toISOString();
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      try {
        await runTransaction(fs, async (tx) => {
          const orgRef = doc(fs, 'organizations', orgId);
          const currentOwnerMemberRef = doc(fs, 'organizations', orgId, 'members', currentOwnerId);
          const newOwnerMemberRef = doc(fs, 'organizations', orgId, 'members', newOwnerId);

          const [orgSnap, currentSnap, targetSnap] = await Promise.all([
            tx.get(orgRef),
            tx.get(currentOwnerMemberRef),
            tx.get(newOwnerMemberRef),
          ]);

          if (!orgSnap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Organization "${orgId}" not found.`,
              operation: 'transferOwnership',
              collection: 'organizations',
            });
          }
          if (!targetSnap.exists()) {
            throw new PersistenceError({
              code: 'NOT_FOUND',
              message: `Target member "${newOwnerId}" must be a member of organization "${orgId}" before ownership transfer.`,
              operation: 'transferOwnership',
              collection: 'organizations/members',
            });
          }
          if (!currentSnap.exists() || orgSnap.data().ownerId !== currentOwnerId) {
            throw new PersistenceError({
              code: 'PERMISSION_DENIED',
              message: 'Only the current organization owner can transfer ownership.',
              operation: 'transferOwnership',
              collection: 'organizations',
            });
          }

          tx.update(orgRef, withServerTimestamps({ ownerId: newOwnerId, updatedAt: now }, false));
          tx.update(newOwnerMemberRef, withServerTimestamps({ role: 'OWNER' }, false));
          tx.update(currentOwnerMemberRef, withServerTimestamps({ role: 'ADMIN' }, false));
        });
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'transferOwnership', 'organizations');
      }
    }

    const org = unitTestOrganizations.find((o) => o.id === orgId);
    if (!org || org.ownerId !== currentOwnerId) {
      throw new PersistenceError({
        code: 'PERMISSION_DENIED',
        message: 'Only the current organization owner can transfer ownership.',
        operation: 'transferOwnership',
        collection: 'organizations',
      });
    }
    const targetMember = unitTestMembers.find((m) => m.orgId === orgId && m.userId === newOwnerId);
    if (!targetMember) {
      throw new PersistenceError({
        code: 'NOT_FOUND',
        message: `Target member "${newOwnerId}" not found.`,
        operation: 'transferOwnership',
        collection: 'organizations/members',
      });
    }
    const prevMember = unitTestMembers.find((m) => m.orgId === orgId && m.userId === currentOwnerId);
    org.ownerId = newOwnerId;
    org.updatedAt = now;
    targetMember.role = 'OWNER';
    if (prevMember) prevMember.role = 'ADMIN';
  },

  /**
   * Lists competitions associated with an organization using bounded cursor pagination.
   */
  async listAssociatedCompetitions(
    orgId: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Competition>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);

    if (fs) {
      try {
        const constraints: QueryConstraint[] = [
          where('organizationId', '==', orgId),
          limit(pageSize + 1),
        ];
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }
        const snap = await getDocs(query(collection(fs, 'competitions'), ...constraints));
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        return {
          items: pageDocs.map((d) => d.data() as Competition),
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listAssociatedCompetitions', 'competitions');
      }
    }

    return { items: [], hasMore: false, nextCursor: null, pageSize };
  },

  /**
   * Lists all authoritative organization memberships for a user across all tenants.
   */
  async getUserOrgMemberships(
    userId: string,
    options?: FirestoreExecutionOptions
  ): Promise<Record<string, OrgRole>> {
    const memberships: Record<string, OrgRole> = {};
    const fs = resolveFirestore(options?.firestore);

    if (fs) {
      try {
        const q = query(
          collectionGroup(fs, 'members'),
          where('userId', '==', userId),
          limit(100)
        );
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          const data = docSnap.data() as OrganizationMember;
          const orgId = data.orgId || docSnap.ref.parent.parent?.id;
          if (orgId && data.role) {
            memberships[orgId] = data.role;
          }
        });
        return memberships;
      } catch (err) {
        throw mapFirestoreError(err, 'getUserOrgMemberships', 'organizations/members');
      }
    }

    for (const m of unitTestMembers) {
      if (m.userId === userId) {
        memberships[m.orgId] = m.role;
      }
    }
    return memberships;
  },

  /**
   * Lists all organizations where a user is a registered member.
   */
  async getUserOrganizations(
    userId: string,
    options?: FirestoreExecutionOptions
  ): Promise<Organization[]> {
    const memberships = await this.getUserOrgMemberships(userId, options);
    const orgIds = Object.keys(memberships);
    if (orgIds.length === 0) return [];

    const results = await Promise.all(orgIds.map((orgId) => this.getOrganization(orgId, options)));
    const orgs: Organization[] = [];
    for (const org of results) {
      if (org && !orgs.some((o) => o.id === org.id)) {
        orgs.push(org);
      }
    }
    return orgs;
  },

  /**
   * Adds a member to an organization in Firestore. Throws PersistenceError on failure.
   */
  async addMember(
    orgId: string,
    userId: string,
    email: string,
    displayName: string,
    role: OrgRole = 'MEMBER',
    options?: FirestoreExecutionOptions
  ): Promise<OrganizationMember> {
    const member: OrganizationMember = {
      userId,
      orgId,
      role,
      email,
      displayName,
      joinedAt: new Date().toISOString(),
    };

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(
          doc(fs, 'organizations', orgId, 'members', userId),
          withServerTimestamps(sanitizeFirestoreData(member), true)
        );
        return member;
      } catch (err) {
        throw mapFirestoreError(err, 'addMember', 'organizations/members');
      }
    }

    unitTestMembers = unitTestMembers.filter((m) => !(m.orgId === orgId && m.userId === userId));
    unitTestMembers.push(member);
    return member;
  },

  /**
   * Updates an existing member's role within an organization in Firestore.
   */
  async updateMemberRole(
    orgId: string,
    userId: string,
    newRole: OrgRole,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await updateDoc(
          doc(fs, 'organizations', orgId, 'members', userId),
          withServerTimestamps({ role: newRole }, false)
        );
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'updateMemberRole', 'organizations/members');
      }
    }

    const found = unitTestMembers.find((m) => m.orgId === orgId && m.userId === userId);
    if (found) {
      found.role = newRole;
    }
  },

  /**
   * Removes a member from an organization in Firestore.
   */
  async removeMember(
    orgId: string,
    userId: string,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await deleteDoc(doc(fs, 'organizations', orgId, 'members', userId));
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'removeMember', 'organizations/members');
      }
    }

    unitTestMembers = unitTestMembers.filter((m) => !(m.orgId === orgId && m.userId === userId));
  },

  /**
   * Lists organization members with bounded pagination.
   */
  async listMembersPaginated(
    orgId: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<OrganizationMember>> {
    const pageSize = clampPageSize(pagination?.pageSize);
    const fs = resolveFirestore(pagination?.firestore);

    if (fs) {
      try {
        const constraints: QueryConstraint[] = [limit(pageSize + 1)];
        if (pagination?.cursor) {
          constraints.push(startAfter(pagination.cursor));
        }
        const snap = await getDocs(
          query(collection(fs, 'organizations', orgId, 'members'), ...constraints)
        );
        const hasMore = snap.docs.length > pageSize;
        const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
        return {
          items: pageDocs.map((d) => d.data() as OrganizationMember),
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listMembersPaginated', 'organizations/members');
      }
    }

    const filtered = unitTestMembers.filter((m) => m.orgId === orgId);
    return {
      items: filtered.slice(0, pageSize),
      hasMore: filtered.length > pageSize,
      nextCursor: null,
      pageSize,
    };
  },

  /**
   * Lists members of an organization (bounded page).
   */
  async listMembers(
    orgId: string,
    options?: PaginationOptions
  ): Promise<OrganizationMember[]> {
    const page = await this.listMembersPaginated(orgId, options);
    return page.items;
  },

  /**
   * Harmless UI preference: remembers last selected workspace ID in browser storage.
   */
  getActiveOrganizationId(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || (unitTestOrganizations[0]?.id ?? null);
    }
    return memoryActiveOrgId || (unitTestOrganizations[0]?.id ?? null);
  },

  setActiveOrganizationId(orgId: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
    }
    memoryActiveOrgId = orgId;
  },

  clearActiveOrganizationId(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    }
    memoryActiveOrgId = null;
  },

  /**
   * Reset unit-test-only in-memory store.
   */
  resetInMemoryStore(orgs: Organization[] = [], members: OrganizationMember[] = []): void {
    unitTestOrganizations = [...orgs];
    unitTestMembers = [...members];
  },
};
