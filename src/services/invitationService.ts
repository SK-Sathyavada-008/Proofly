// ─────────────────────────────────────────────
// invitationService.ts — Scoped Account Onboarding & Role Invitations
// Proofly Phase 01 — Organization & Competition Invitations
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import { generateSecureToken } from '../utils/cryptoUtils';
import type { CompetitionRole, OrgRole } from '../types/authAndCompetition';
import type { VerifiedAuthSession } from './firebaseAuthService';
import { authorizationService } from './authorizationService';
import { organizationService } from './organizationService';
import { competitionService } from './competitionService';

export type InvitationTargetType = 'ORGANIZATION' | 'COMPETITION';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED';

export interface ScopedInvitation {
  id: string;
  targetType: InvitationTargetType;
  organizationId: string;
  organizationName?: string;
  competitionId?: string;
  competitionTitle?: string;
  email: string;
  role: OrgRole | CompetitionRole;
  invitedByUid: string;
  invitedByEmail: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedByUid?: string;
  revokedAt?: string;
}

let localInvitations: ScopedInvitation[] = [];

export const invitationService = {
  /**
   * Creates a scoped invitation for an organization member or competition judge/viewer/organizer.
   * Requires verified admin authorization for the target organization or competition.
   */
  async createInvitation(
    session: VerifiedAuthSession | null | undefined,
    params: {
      targetType: InvitationTargetType;
      organizationId: string;
      competitionId?: string;
      email: string;
      role: OrgRole | CompetitionRole;
      expiresInHours?: number;
    }
  ): Promise<ScopedInvitation> {
    if (params.targetType === 'ORGANIZATION') {
      await authorizationService.assertAuthorized(session, {
        operation: 'ORG_MEMBER_MANAGE',
        organizationId: params.organizationId,
      });
    } else {
      if (!params.competitionId) {
        throw new Error('competitionId is required for competition invitations.');
      }
      await authorizationService.assertAuthorized(session, {
        operation: 'JUDGE_INVITE_OR_ASSIGN',
        organizationId: params.organizationId,
        competitionId: params.competitionId,
      });
    }

    const cleanedEmail = params.email.trim().toLowerCase();
    if (!cleanedEmail || !cleanedEmail.includes('@')) {
      throw new Error('A valid recipient email address is required.');
    }

    const org = await organizationService.getOrganization(params.organizationId);
    const comp = params.competitionId
      ? await competitionService.getCompetition(params.competitionId)
      : null;

    const now = Date.now();
    const expiresInMs = (params.expiresInHours ?? 72) * 60 * 60 * 1000;
    const id = `inv_${generateSecureToken(12)}`;

    const invite: ScopedInvitation = {
      id,
      targetType: params.targetType,
      organizationId: params.organizationId,
      organizationName: org?.name,
      competitionId: params.competitionId,
      competitionTitle: comp?.title,
      email: cleanedEmail,
      role: params.role,
      invitedByUid: session!.uid,
      invitedByEmail: session!.email,
      status: 'PENDING',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + expiresInMs).toISOString(),
    };

    if (isFirebaseConfigured() && db) {
      await setDoc(doc(db, 'invitations', id), sanitizeFirestoreData(invite));
    }

    localInvitations.push(invite);
    return invite;
  },

  async getInvitation(inviteId: string): Promise<ScopedInvitation | null> {
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDoc(doc(db, 'invitations', inviteId));
        if (snap.exists()) {
          return snap.data() as ScopedInvitation;
        }
      } catch {
        // Fallback to local store in test/offline mode
      }
    }
    return localInvitations.find((i) => i.id === inviteId) || null;
  },

  async listPendingInvitationsForEmail(email: string): Promise<ScopedInvitation[]> {
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) return [];

    const now = Date.now();
    const results: ScopedInvitation[] = [];

    if (isFirebaseConfigured() && db) {
      try {
        const q = query(
          collection(db, 'invitations'),
          where('email', '==', cleaned),
          where('status', '==', 'PENDING')
        );
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const inv = d.data() as ScopedInvitation;
          if (new Date(inv.expiresAt).getTime() > now) {
            results.push(inv);
          }
        });
      } catch {
        // Fallback to local store
      }
    }

    for (const inv of localInvitations) {
      if (
        inv.email === cleaned &&
        inv.status === 'PENDING' &&
        new Date(inv.expiresAt).getTime() > now &&
        !results.some((r) => r.id === inv.id)
      ) {
        results.push(inv);
      }
    }

    return results;
  },

  /**
   * Accepts a pending invitation for the currently authenticated user.
   * Strictly enforces email match, non-expiration, and non-revocation.
   */
  async acceptInvitation(
    session: VerifiedAuthSession | null | undefined,
    inviteId: string,
    nowMs: number = Date.now()
  ): Promise<ScopedInvitation> {
    if (!session || !session.uid) {
      throw new Error('You must sign in to accept an invitation.');
    }
    if (session.revoked || session.tokenExpiresAtMs <= nowMs) {
      throw new Error('Your session has expired. Please sign in again.');
    }

    const invite = await this.getInvitation(inviteId);
    if (!invite) {
      throw new Error('Invitation not found.');
    }
    if (invite.status === 'REVOKED') {
      throw new Error('This invitation has been revoked by an administrator.');
    }
    if (invite.status === 'ACCEPTED') {
      throw new Error('This invitation has already been accepted.');
    }
    if (new Date(invite.expiresAt).getTime() <= nowMs) {
      throw new Error('This invitation has expired.');
    }
    if (invite.email.toLowerCase() !== session.email.toLowerCase()) {
      throw new Error(
        `This invitation was issued to ${invite.email}. Sign in with that account to accept it.`
      );
    }

    const acceptedAt = new Date(nowMs).toISOString();
    const updated: ScopedInvitation = {
      ...invite,
      status: 'ACCEPTED',
      acceptedAt,
      acceptedByUid: session.uid,
    };

    if (isFirebaseConfigured() && db) {
      await updateDoc(doc(db, 'invitations', inviteId), {
        status: 'ACCEPTED',
        acceptedAt,
        acceptedByUid: session.uid,
      });
    }

    const idx = localInvitations.findIndex((i) => i.id === inviteId);
    if (idx !== -1) {
      localInvitations[idx] = updated;
    }

    // Grant ONLY the exact scoped role specified by the invitation
    if (invite.targetType === 'ORGANIZATION') {
      await organizationService.addMember(
        invite.organizationId,
        session.uid,
        session.email,
        session.displayName,
        invite.role as OrgRole
      );
    } else if (invite.competitionId) {
      await competitionService.assignCompetitionRole(
        invite.competitionId,
        session.uid,
        session.email,
        session.displayName,
        invite.role as CompetitionRole
      );
    }

    return updated;
  },

  async revokeInvitation(
    session: VerifiedAuthSession | null | undefined,
    inviteId: string
  ): Promise<ScopedInvitation> {
    const invite = await this.getInvitation(inviteId);
    if (!invite) {
      throw new Error('Invitation not found.');
    }

    if (invite.targetType === 'ORGANIZATION') {
      await authorizationService.assertAuthorized(session, {
        operation: 'ORG_MEMBER_MANAGE',
        organizationId: invite.organizationId,
      });
    } else {
      await authorizationService.assertAuthorized(session, {
        operation: 'JUDGE_INVITE_OR_ASSIGN',
        organizationId: invite.organizationId,
        competitionId: invite.competitionId,
      });
    }

    const revokedAt = new Date().toISOString();
    const updated: ScopedInvitation = {
      ...invite,
      status: 'REVOKED',
      revokedAt,
    };

    if (isFirebaseConfigured() && db) {
      await updateDoc(doc(db, 'invitations', inviteId), {
        status: 'REVOKED',
        revokedAt,
      });
    }

    const idx = localInvitations.findIndex((i) => i.id === inviteId);
    if (idx !== -1) {
      localInvitations[idx] = updated;
    }

    return updated;
  },

  resetInMemoryStore(): void {
    localInvitations = [];
  },
};
