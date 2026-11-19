// ─────────────────────────────────────────────
// AuthPage.tsx — Firebase Sign-In, Sign-Up, Password Reset & Invitation Onboarding
// Proofly Phase 01 — Real Authentication Foundation
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Mail, Lock, User, KeyRound, ArrowRight } from 'lucide-react';
import { ProoflyGlobalHeader } from '../components/layout/ProoflyGlobalHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useProoflyAuth } from '../context/ProoflyAuthContext';
import { invitationService, type ScopedInvitation } from '../services/invitationService';

type AuthMode = 'signin' | 'signup' | 'reset';

function getSafeRedirectPath(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Prevent open redirects: allow only relative internal paths
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/auth')) {
    return null;
  }
  return trimmed;
}

export const AuthPage: React.FC<{ initialMode?: AuthMode }> = ({ initialMode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    isAuthenticated,
    loading: authLoading,
    authError,
    sessionExpired,
    canAccessOrganizerWorkspace,
    canAccessJudgeWorkspace,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    sendPasswordReset,
    acceptInvitation,
    clearAuthError,
  } = useProoflyAuth();

  const inviteId = searchParams.get('invite') || '';
  const redirectParam = getSafeRedirectPath(searchParams.get('redirect'));
  const routeState = (location.state as { sessionExpired?: boolean } | null) || null;

  const derivedInitialMode: AuthMode =
    initialMode ||
    (searchParams.get('mode') === 'signup'
      ? 'signup'
      : searchParams.get('mode') === 'reset'
      ? 'reset'
      : location.pathname === '/signup'
      ? 'signup'
      : location.pathname === '/reset-password'
      ? 'reset'
      : 'signin');

  const [mode, setMode] = useState<AuthMode>(derivedInitialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [inviteDetails, setInviteDetails] = useState<ScopedInvitation | null>(null);

  useEffect(() => {
    if (!inviteId) return;
    invitationService
      .getInvitation(inviteId)
      .then((inv) => {
        if (inv && inv.status === 'PENDING') {
          setInviteDetails(inv);
          if (!email) setEmail(inv.email);
        }
      })
      .catch(() => {});
  }, [inviteId, email]);

  const navigatePostAuth = () => {
    if (redirectParam) {
      navigate(redirectParam, { replace: true });
      return;
    }
    if (canAccessOrganizerWorkspace) {
      navigate('/organizer', { replace: true });
    } else if (canAccessJudgeWorkspace) {
      navigate('/judge/assignments', { replace: true });
    } else {
      navigate('/organizer', { replace: true });
    }
  };

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    if (inviteId) {
      acceptInvitation(inviteId)
        .catch(() => {})
        .finally(() => navigatePostAuth());
    } else {
      navigatePostAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setLocalError(null);
    setResetSent(false);
    clearAuthError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setResetSent(false);
    setSubmitting(true);

    try {
      if (mode === 'reset') {
        await sendPasswordReset(email);
        setResetSent(true);
      } else if (mode === 'signup') {
        await signUpWithEmail(email, password, displayName);
        if (inviteId) {
          await acceptInvitation(inviteId).catch((invErr: any) => {
            setLocalError(invErr?.message || 'Account created, but invitation could not be accepted.');
          });
        }
      } else {
        await signInWithEmail(email, password);
        if (inviteId) {
          await acceptInvitation(inviteId).catch((invErr: any) => {
            setLocalError(invErr?.message || 'Signed in, but invitation could not be accepted.');
          });
        }
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      if (inviteId) {
        await acceptInvitation(inviteId).catch(() => {});
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const visibleError = localError || authError;
  const showExpiredNotice = sessionExpired || routeState?.sessionExpired;

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 font-sans flex flex-col">
      <ProoflyGlobalHeader />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-5">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {mode === 'signin'
                ? 'Sign in to Proofly'
                : mode === 'signup'
                ? 'Create your account'
                : 'Reset password'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mode === 'signin'
                ? 'Organizers and judges sign in with their Firebase account.'
                : mode === 'signup'
                ? 'Create an organizer account or accept a judge invitation.'
                : 'Enter your email address to receive a password reset link.'}
            </p>
          </div>

          {inviteDetails && (
            <div className="px-3.5 py-2.5 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-500/10 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
              <KeyRound size={14} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Invitation detected ({inviteDetails.role})</p>
                <p className="text-[11px] opacity-90 mt-0.5">
                  Sign in or create an account with <span className="font-mono">{inviteDetails.email}</span> to accept access
                  {inviteDetails.competitionTitle
                    ? ` for ${inviteDetails.competitionTitle}`
                    : inviteDetails.organizationName
                    ? ` for ${inviteDetails.organizationName}`
                    : ''}
                  .
                </p>
              </div>
            </div>
          )}

          {showExpiredNotice && (
            <div className="px-3.5 py-2.5 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>Your session expired. Please sign in again to continue.</span>
            </div>
          )}

          {visibleError && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2"
            >
              <AlertCircle size={14} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{visibleError}</span>
            </div>
          )}

          {resetSent && (
            <div className="px-3.5 py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
              <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>Password reset email sent. Check your inbox and spam folder.</span>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'signup' && (
                <Input
                  label="Full name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your full name"
                  leftIcon={<User size={14} />}
                  autoComplete="name"
                />
              )}

              <Input
                label="Email address"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.org"
                leftIcon={<Mail size={14} />}
                autoComplete="email"
              />

              {mode !== 'reset' && (
                <Input
                  label="Password"
                  type="password"
                  required
                  minLength={mode === 'signup' ? 8 : 6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                  leftIcon={<Lock size={14} />}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              )}

              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="w-full"
                isLoading={submitting}
              >
                {mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset link'}
              </Button>
            </form>

            {mode !== 'reset' && (
              <>
                <div className="relative flex items-center justify-center">
                  <div className="border-t border-slate-200 dark:border-slate-800 w-full" />
                  <span className="bg-white dark:bg-slate-900 px-2 text-[11px] text-slate-400 dark:text-slate-500">
                    or
                  </span>
                  <div className="border-t border-slate-200 dark:border-slate-800 w-full" />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={submitting}
                  onClick={handleGoogleSignIn}
                >
                  Continue with Google
                </Button>
              </>
            )}

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              {mode === 'signin' ? (
                <>
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Create account
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  ← Back to sign in
                </button>
              )}
            </div>
          </div>

          <div className="text-center text-xs text-slate-500 dark:text-slate-400">
            Submitting a competition entry?{' '}
            <Link
              to="/submit"
              className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <span>Submit without an account</span>
              <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};
