// ─────────────────────────────────────────────
// AccessManagementPanel.tsx — Competition Access Keys & Security Scoping
// Proofly — Phase 4
// ─────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Ban,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/Table';
import { useToast } from '../ui/Toast';
import { accessManagementService, type GenerateIndividualLinkResult } from '../../services/accessManagementService';
import type { CompetitionAccessKey } from '../../types/formAndAccess';
import type { Competition } from '../../types/authAndCompetition';

interface AccessManagementPanelProps {
  competition: Competition;
  canManage: boolean;
}

export const AccessManagementPanel: React.FC<AccessManagementPanelProps> = ({
  competition,
  canManage,
}) => {
  const { success, error: toastError } = useToast();
  const [keys, setKeys] = useState<CompetitionAccessKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Modals
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isRegenerateConfirmOpen, setIsRegenerateConfirmOpen] = useState(false);
  const [newLinkResult, setNewLinkResult] = useState<GenerateIndividualLinkResult | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<CompetitionAccessKey | null>(null);

  // Form State for Individual Link
  const [targetEmail, setTargetEmail] = useState('');
  const [targetTeam, setTargetTeam] = useState('');
  const [submissionLimit, setSubmissionLimit] = useState(1);
  const [expiresAt, setExpiresAt] = useState('');
  const [requireAuth, setRequireAuth] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      // Ensure public key exists
      await accessManagementService.getOrCreatePublicAccessKey(
        competition.id,
        competition.publicAccessCode
      );
      const all = await accessManagementService.listAccessKeys(competition.id);
      setKeys(all);
    } catch (err: any) {
      toastError('Failed to load access keys', err.message);
    } finally {
      setLoading(false);
    }
  }, [competition.id, competition.publicAccessCode, toastError]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCopy = (text: string, id: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    success('Copied to Clipboard', label);
    setTimeout(() => setCopiedKeyId(null), 2500);
  };

  const handleRegeneratePublicCode = async () => {
    try {
      const updated = await accessManagementService.regenerateAccessCode(competition.id);
      success('Access Code Regenerated', `New code: ${updated.code}. Previous code has been revoked.`);
      setIsRegenerateConfirmOpen(false);
      await fetchKeys();
    } catch (err: any) {
      toastError('Regeneration Failed', err.message);
    }
  };

  const handleGenerateIndividual = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await accessManagementService.generateIndividualLink(competition.id, {
        email: targetEmail.trim() || undefined,
        teamName: targetTeam.trim() || undefined,
        maxSubmissions: submissionLimit || 1,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        requireAuth,
      });

      setNewLinkResult(res);
      setIsGenerateModalOpen(false);
      // Reset form
      setTargetEmail('');
      setTargetTeam('');
      setSubmissionLimit(1);
      setExpiresAt('');
      await fetchKeys();
    } catch (err: any) {
      toastError('Link Generation Failed', err.message);
    }
  };

  const handleRevokeKey = async () => {
    if (!keyToRevoke) return;
    try {
      await accessManagementService.revokeAccessKey(keyToRevoke.id);
      success('Access Revoked', `Key "${keyToRevoke.code}" has been permanently disabled.`);
      setKeyToRevoke(null);
      await fetchKeys();
    } catch (err: any) {
      toastError('Revocation Failed', err.message);
    }
  };

  const individualKeys = keys.filter((k) => k.scopeType === 'INDIVIDUAL_LINK');

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const publicUrl = `${origin}/submit?code=${competition.publicAccessCode}`;

  return (
    <div className="space-y-6">
      {/* Top Banner: Public Link & Access Code */}
      <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound size={20} className="text-blue-600 dark:text-blue-400" />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Public Submission Gate & Access Code
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Participants enter through this code or direct URL. No participant accounts or passwords required.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw size={13} />}
                onClick={() => setIsRegenerateConfirmOpen(true)}
              >
                Regenerate Code
              </Button>
            )}

            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setIsGenerateModalOpen(true)}
              disabled={!canManage}
            >
              Generate Unique Individual Link
            </Button>
          </div>
        </div>

        {/* Access Code & Public Link Callout Box */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Box 1: Public Access Code */}
          <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-500/25 bg-blue-50/50 dark:bg-blue-500/10 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider block">
                Competition Access Code
              </span>
              <span className="font-mono text-xl font-extrabold text-slate-900 dark:text-slate-100">
                {competition.publicAccessCode}
              </span>
            </div>
            <Button
              variant="outline"
              size="xs"
              leftIcon={
                copiedKeyId === 'code' ? (
                  <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Copy size={13} />
                )
              }
              onClick={() =>
                handleCopy(competition.publicAccessCode, 'code', 'Public Access Code Copied')
              }
            >
              {copiedKeyId === 'code' ? 'Copied' : 'Copy Code'}
            </Button>
          </div>

          {/* Box 2: Direct Submission Link */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 flex items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                Direct Submission URL
              </span>
              <span className="font-mono text-xs text-slate-700 dark:text-slate-300 truncate block">
                {publicUrl}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="xs"
                leftIcon={
                  copiedKeyId === 'url' ? (
                    <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy size={13} />
                  )
                }
                onClick={() => handleCopy(publicUrl, 'url', 'Direct Submission URL Copied')}
              >
                {copiedKeyId === 'url' ? 'Copied' : 'Copy'}
              </Button>
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <Button variant="ghost" size="xs">
                  <ExternalLink size={13} />
                </Button>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Security Token Result Banner (When Newly Generated) */}
      {newLinkResult && (
        <div className="p-5 rounded-2xl border border-emerald-300 dark:border-emerald-500/35 bg-emerald-50/80 dark:bg-emerald-500/10 shadow-xs space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
              <div>
                <h4 className="font-bold text-sm text-emerald-950 dark:text-emerald-200">
                  Unique Individual Submission Link Created
                </h4>
                <p className="text-xs text-emerald-800 dark:text-emerald-300/90">
                  This single-use cryptographic token has been generated. The raw token is hashed via
                  SHA-256 for secure storage and will <strong>never</strong> be displayed again.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNewLinkResult(null)}
              className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-emerald-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>

          <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-between gap-3">
            <div className="font-mono text-xs text-slate-800 dark:text-slate-200 truncate">
              {newLinkResult.directSubmissionUrl}
            </div>
            <Button
              variant="primary"
              size="xs"
              leftIcon={<Copy size={13} />}
              onClick={() =>
                handleCopy(
                  newLinkResult.directSubmissionUrl,
                  'new-token',
                  'Unique Participant Link Copied'
                )
              }
            >
              Copy One-Time Link
            </Button>
          </div>
        </div>
      )}

      {/* Access Keys Management Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Active Access Keys & Scoped Links ({keys.length})
          </h4>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {individualKeys.length} individual tokens issued
          </span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scope Type</TableHead>
              <TableHead>Identifier / Mask</TableHead>
              <TableHead>Target Recipient</TableHead>
              <TableHead>Submissions Used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-6 text-xs text-slate-400 dark:text-slate-500">
                  Loading access keys...
                </TableCell>
              </TableRow>
            ) : keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
                  No access keys found.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((k) => {
                const isExpired = k.expiresAt && new Date(k.expiresAt).getTime() < Date.now();

                return (
                  <TableRow key={k.id}>
                    {/* Scope Type */}
                    <TableCell>
                      <Badge
                        variant={k.scopeType === 'INDIVIDUAL_LINK' ? 'purple' : 'primary'}
                        size="sm"
                      >
                        {k.scopeType === 'INDIVIDUAL_LINK' ? 'Individual Token' : 'Public Access'}
                      </Badge>
                    </TableCell>

                    {/* Identifier */}
                    <TableCell>
                      <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {k.code}
                      </span>
                    </TableCell>

                    {/* Target Recipient */}
                    <TableCell>
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        {k.targetTeamName && <p className="font-semibold">{k.targetTeamName}</p>}
                        {k.targetParticipantEmail ? (
                          <p className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                            {k.targetParticipantEmail}
                          </p>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Open Public Access</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Submissions Limit */}
                    <TableCell>
                      <span className="font-mono text-xs text-slate-800 dark:text-slate-200">
                        {k.submissionsCount} / {k.maxSubmissions ?? '∞'}
                      </span>
                    </TableCell>

                    {/* Expiration */}
                    <TableCell>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}
                      </span>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      {k.revoked ? (
                        <Badge variant="danger" size="sm" dot>
                          Revoked
                        </Badge>
                      ) : isExpired ? (
                        <Badge variant="warning" size="sm" dot>
                          Expired
                        </Badge>
                      ) : (
                        <Badge variant="success" size="sm" dot>
                          Active
                        </Badge>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      {canManage && !k.revoked && k.scopeType === 'INDIVIDUAL_LINK' && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-red-600 dark:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-500/15 hover:text-red-700 dark:hover:text-rose-300"
                          leftIcon={<Ban size={12} />}
                          onClick={() => setKeyToRevoke(k)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modal: Generate Individual Link */}
      <Modal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        title="Generate Unique Individual Submission Link"
        description="Creates a cryptographically secure, scoped entry link for an invited team or individual."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsGenerateModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleGenerateIndividual}>
              Generate Secure Token Link
            </Button>
          </>
        }
      >
        <form onSubmit={handleGenerateIndividual} className="space-y-4">
          <Input
            label="Target Participant Email"
            type="email"
            placeholder="participant@domain.edu"
            value={targetEmail}
            onChange={(e) => setTargetEmail(e.target.value)}
          />

          <Input
            label="Target Team Name (Optional)"
            placeholder="e.g. Stanford BioEdge"
            value={targetTeam}
            onChange={(e) => setTargetTeam(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Submission Limit Cap"
              type="number"
              min="1"
              max="50"
              value={submissionLimit}
              onChange={(e) => setSubmissionLimit(parseInt(e.target.value) || 1)}
            />

            <Input
              label="Expiration Date (Optional)"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="requireAuthCheck"
              checked={requireAuth}
              onChange={(e) => setRequireAuth(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="requireAuthCheck" className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              Require Firebase login (default: unchecked, zero-account friction-free submission)
            </label>
          </div>

          <div className="p-3 bg-blue-50/60 dark:bg-blue-500/10 rounded-xl border border-blue-200 dark:border-blue-500/25 text-xs text-blue-800 dark:text-blue-200 space-y-1">
            <p className="font-semibold">Cryptographic Security Guarantee</p>
            <p className="text-[11px] text-blue-700 dark:text-blue-300/90 leading-relaxed">
              The generated token is 256 bits of entropy. The raw token is stored only as a SHA-256
              hash, preventing unauthorized access or leakage even in the event of database inspection.
            </p>
          </div>
        </form>
      </Modal>

      {/* Confirm Regenerate Modal */}
      <ConfirmDialog
        isOpen={isRegenerateConfirmOpen}
        title="Regenerate Public Access Code?"
        message="Regenerating the access code will immediately invalidate the current code. Existing submissions remain unaffected, but new participants must use the new code."
        confirmLabel="Regenerate Code"
        onConfirm={handleRegeneratePublicCode}
        onCancel={() => setIsRegenerateConfirmOpen(false)}
        variant="primary"
      />

      {/* Confirm Revoke Modal */}
      <ConfirmDialog
        isOpen={!!keyToRevoke}
        title="Revoke Individual Access Key?"
        message={`Are you sure you want to permanently revoke key "${keyToRevoke?.code}"? Any future submission attempts using this link will be rejected immediately.`}
        confirmLabel="Revoke Key"
        onConfirm={handleRevokeKey}
        onCancel={() => setKeyToRevoke(null)}
        variant="danger"
      />
    </div>
  );
};
