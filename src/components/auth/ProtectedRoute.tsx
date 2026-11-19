// ─────────────────────────────────────────────
// ProtectedRoute.tsx — Scoped Route Guard & Authenticated Onboarding Gate
// Proofly Phase 01 — Never renders protected content prior to auth resolution
// ─────────────────────────────────────────────

import React, { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert, Building2, KeyRound, LogOut } from 'lucide-react';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { ProoflyGlobalHeader } from '../layout/ProoflyGlobalHeader';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredWorkspace: 'organizer' | 'judge';
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredWorkspace,
}) => {
  const location = useLocation();
  const {
    loading,
    isAuthenticated,
    sessionExpired,
    currentUser,
    activeOrganization,
    userOrganizations,
    pendingInvitations,
    canAccessOrganizerWorkspace,
    canAccessJudgeWorkspace,
    createOrganization,
    acceptInvitation,
    logout,
  } = useProoflyAuth();

  const [orgName, setOrgName] = useState('');
  const [orgTagline, setOrgTagline] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 1. NEVER render protected content before Firebase Auth initialization completes
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 flex flex-col">
        <ProoflyGlobalHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-6 h-6 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Verifying authentication...</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Redirect unauthenticated or expired sessions to /auth with return path
  if (!isAuthenticated || !currentUser) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?redirect=${encodeURIComponent(returnTo)}`}
        replace
        state={{ sessionExpired }}
      />
    );
  }

  const handleAcceptInvite = async (inviteId: string) => {
    setActionError(null);
    setAcceptingId(inviteId);
    try {
      await acceptInvitation(inviteId);
    } catch (err: any) {
      setActionError(err?.message || 'Could not accept invitation.');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    setActionError(null);
    setCreatingOrg(true);
    try {
      await createOrganization(orgName, orgTagline);
      setOrgName('');
      setOrgTagline('');
    } catch (err: any) {
      setActionError(err?.message || 'Could not create organization.');
    } finally {
      setCreatingOrg(false);
    }
  };

  // 3. Enforce Organizer Workspace Scope (blocks Judge-only accounts)
  if (requiredWorkspace === 'organizer' && !canAccessOrganizerWorkspace) {
    return (
      <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 flex flex-col">
        <ProoflyGlobalHeader />
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-6 text-center space-y-4">
            <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
              <ShieldAlert size={20} />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Organizer access required
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Your account (<span className="font-mono">{currentUser.email}</span>) is scoped as a Judge and does not have permission to access organizer management routes.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              {canAccessJudgeWorkspace && (
                <Link to="/judge/assignments">
                  <Button variant="primary" size="sm">
                    Open Judge workspace
                  </Button>
                </Link>
              )}
              <Button variant="outline" size="sm" leftIcon={<LogOut size={13} />} onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // 4. Enforce Judge Workspace Scope (blocks Viewers and unaffiliated accounts)
  if (requiredWorkspace === 'judge' && !canAccessJudgeWorkspace) {
    return (
      <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 flex flex-col">
        <ProoflyGlobalHeader />
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                <ShieldAlert size={20} />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Judge assignment required
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Your account (<span className="font-mono">{currentUser.email}</span>) is not currently assigned as a Judge or Organizer for any competition.
              </p>
            </div>

            {actionError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                {actionError}
              </div>
            )}

            {pendingInvitations.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <KeyRound size={13} className="text-blue-600 dark:text-blue-400" />
                  Pending invitations for your email
                </p>
                {pendingInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {inv.competitionTitle || inv.organizationName || inv.organizationId}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Role: {inv.role}</p>
                    </div>
                    <Button
                      variant="primary"
                      size="xs"
                      isLoading={acceptingId === inv.id}
                      onClick={() => void handleAcceptInvite(inv.id)}
                    >
                      Accept
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-center gap-2 pt-2">
              <Link to="/">
                <Button variant="outline" size="sm">
                  Back to home
                </Button>
              </Link>
              <Button variant="outline" size="sm" leftIcon={<LogOut size={13} />} onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // 5. Authenticated brand-new organizer with 0 organizations: clean onboarding step
  if (
    requiredWorkspace === 'organizer' &&
    userOrganizations.length === 0 &&
    !activeOrganization &&
    currentUser.platformRole !== 'SUPER_ADMIN'
  ) {
    return (
      <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 flex flex-col">
        <ProoflyGlobalHeader />
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-6 space-y-5">
            <div className="space-y-1">
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2">
                <Building2 size={18} />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Set up your organization
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create an organization to host competitions, or accept a pending invitation below.
              </p>
            </div>

            {actionError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                {actionError}
              </div>
            )}

            {pendingInvitations.length > 0 && (
              <div className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Pending invitations
                </p>
                {pendingInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {inv.competitionTitle || inv.organizationName || inv.organizationId}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Role: {inv.role}</p>
                    </div>
                    <Button
                      variant="primary"
                      size="xs"
                      isLoading={acceptingId === inv.id}
                      onClick={() => void handleAcceptInvite(inv.id)}
                    >
                      Accept
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleCreateOrg} className="space-y-3.5">
              <Input
                label="Organization name"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. University Engineering Guild"
              />
              <Input
                label="Tagline (optional)"
                value={orgTagline}
                onChange={(e) => setOrgTagline(e.target.value)}
                placeholder="Annual hackathons and research competitions"
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="w-full"
                isLoading={creatingOrg}
              >
                Create organization
              </Button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return <>{children}</>;
};
