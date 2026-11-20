// ─────────────────────────────────────────────
// SubmissionIntegrityModal.tsx — Phase 13 Submission Integrity & Provenance Modal
// Proofly — Repository Snapshots, Post-Deadline Tracking, Artifact Hashing & Duplicate Review
// ─────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  GitCommit,
  GitBranch,
  FileCheck2,
  Copy,
  Check,
  RefreshCw,
  Users,
  FileText,
  Clock,
  Sliders,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { submissionIntegrityService } from '../../services/submissionIntegrityService';
import type { ProjectSubmission } from '../../types/submission';
import type {
  SubmissionIntegrityReport,
  IntegrityVerificationStatus,
} from '../../types/submissionIntegrity';

interface SubmissionIntegrityModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: ProjectSubmission | null;
  organizerUser: { id: string; name: string; role?: string };
  onReportUpdated?: (report: SubmissionIntegrityReport) => void;
}

export const SubmissionIntegrityModal: React.FC<SubmissionIntegrityModalProps> = ({
  isOpen,
  onClose,
  submission,
  organizerUser,
  onReportUpdated,
}) => {
  const { success, warning, error: toastError } = useToast();

  const [activeTab, setActiveTab] = useState<'overview' | 'repo' | 'artifacts' | 'duplicates' | 'admin'>('overview');
  const [report, setReport] = useState<SubmissionIntegrityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  // Administrative action forms
  const [dismissReason, setDismissReason] = useState('');
  const [acceptLateReason, setAcceptLateReason] = useState('');
  const [newPinnedSha, setNewPinnedSha] = useState('');
  const [pinShaReason, setPinShaReason] = useState('');

  const loadReport = async () => {
    if (!submission) return;
    setLoading(true);
    try {
      // Fetch or generate integrity report
      let rep = await submissionIntegrityService.getIntegrityReport(submission.id);
      if (!rep) {
        rep = await submissionIntegrityService.generateIntegrityReport(submission);
      }
      setReport(rep);
      onReportUpdated?.(rep);
    } catch (err: any) {
      console.warn('Could not load integrity report:', err);
      toastError('Integrity Error', err?.message || 'Could not load submission integrity report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && submission) {
      loadReport();
    }
  }, [isOpen, submission?.id]);

  const handleReVerify = async () => {
    if (!submission) return;
    setLoading(true);
    try {
      const freshReport = await submissionIntegrityService.generateIntegrityReport(submission);
      setReport(freshReport);
      onReportUpdated?.(freshReport);
      success('Integrity Verified', 'Re-evaluated repository snapshot, artifact hashes, and duplicate indicators.');
    } catch (err: any) {
      toastError('Verification Failed', err?.message || 'Could not verify integrity.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSha(text);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  const handleDismissDuplicate = async () => {
    if (!submission || !report) return;
    if (!dismissReason.trim() || dismissReason.trim().length < 5) {
      warning('Missing Justification', 'Please enter a documented reason for dismissing the duplicate flag.');
      return;
    }

    setActionLoading(true);
    try {
      const updated = await submissionIntegrityService.dismissDuplicateFlag(
        submission.id,
        organizerUser,
        dismissReason
      );
      setReport(updated);
      setDismissReason('');
      onReportUpdated?.(updated);
      success('Flag Dismissed', 'Duplicate flag dismissed and audit trail recorded.');
    } catch (err: any) {
      toastError('Action Failed', err?.message || 'Could not dismiss duplicate flag.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptLateChanges = async () => {
    if (!submission || !report) return;
    if (!acceptLateReason.trim() || acceptLateReason.trim().length < 5) {
      warning('Missing Justification', 'Please enter a documented reason for accepting post-deadline commits.');
      return;
    }

    setActionLoading(true);
    try {
      const updated = await submissionIntegrityService.acceptPostDeadlineChanges(
        submission.id,
        organizerUser,
        acceptLateReason
      );
      setReport(updated);
      setAcceptLateReason('');
      onReportUpdated?.(updated);
      success('Post-Deadline Accepted', 'Post-deadline changes accepted with documented authorization.');
    } catch (err: any) {
      toastError('Action Failed', err?.message || 'Could not accept post-deadline changes.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePinCommitSha = async () => {
    if (!submission || !report) return;
    if (!newPinnedSha.trim() || newPinnedSha.trim().length < 7) {
      warning('Invalid SHA', 'Please enter a valid git commit SHA.');
      return;
    }
    if (!pinShaReason.trim() || pinShaReason.trim().length < 5) {
      warning('Missing Justification', 'Please document why this commit SHA is being pinned.');
      return;
    }

    setActionLoading(true);
    try {
      const updated = await submissionIntegrityService.pinCommitSha(
        submission.id,
        newPinnedSha,
        organizerUser,
        pinShaReason
      );
      setReport(updated);
      setNewPinnedSha('');
      setPinShaReason('');
      onReportUpdated?.(updated);
      success('Commit Pinned', `Evaluation locked to commit SHA ${newPinnedSha.slice(0, 7)}.`);
    } catch (err: any) {
      toastError('Action Failed', err?.message || 'Could not pin commit SHA.');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: IntegrityVerificationStatus) => {
    switch (status) {
      case 'VERIFIED_INTACT':
        return <Badge variant="success" size="sm">Verified Intact</Badge>;
      case 'POST_DEADLINE_CHANGES':
        return <Badge variant="warning" size="sm">Post-Deadline Changes</Badge>;
      case 'DUPLICATE_SUSPECTED':
        return <Badge variant="danger" size="sm">Duplicate / Similarity Flagged</Badge>;
      case 'ARTIFACT_TAMPERED_OR_MODIFIED':
        return <Badge variant="danger" size="sm">Artifact Replaced / Modified</Badge>;
      case 'ACCESS_LIMITED':
        return <Badge variant="neutral" size="sm">Access Limited / Private</Badge>;
      default:
        return <Badge variant="neutral" size="sm">Pending Verification</Badge>;
    }
  };

  if (!submission) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Submission Integrity & Provenance — ${submission.referenceId}`}
      description="Cryptographic artifact verification, pinned evaluation commit provenance, post-deadline tracking, and duplicate review."
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReVerify}
            isLoading={loading}
            leftIcon={<RefreshCw size={13} />}
          >
            Re-Verify All Hashes
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Status Header Banner */}
        <div className="p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                {submission.projectTitle}
              </span>
              {report && getStatusBadge(report.status)}
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-[11px]">
              Submitter: {submission.teamName || submission.primaryContactName} · Submitted at {new Date(submission.submittedAt || submission.createdAt).toLocaleString()}
            </p>
          </div>

          <div className="text-right font-mono text-[11px] text-slate-400">
            <span>Last Verified:</span>
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              {report ? new Date(report.lastVerifiedAt).toLocaleTimeString() : '—'}
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`pb-2 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'overview'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <ShieldCheck size={14} />
            Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('repo')}
            className={`pb-2 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'repo'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <GitCommit size={14} />
            Repository & Commits
            {report?.postDeadlineComparison?.hasPostDeadlineCommits && (
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('artifacts')}
            className={`pb-2 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'artifacts'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <FileCheck2 size={14} />
            Artifact Hashes ({report?.artifactIntegrityRecords.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('duplicates')}
            className={`pb-2 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'duplicates'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Users size={14} />
            Duplicates & Similarity
            {report && report.duplicateMatches.length > 0 && (
              <Badge variant="danger" size="sm">
                {report.duplicateMatches.length}
              </Badge>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            className={`pb-2 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'admin'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Sliders size={14} />
            Administrative Audit
          </button>
        </div>

        {/* ── TAB 1: OVERVIEW SUMMARY ── */}
        {activeTab === 'overview' && report && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 font-mono block">EVALUATED COMMIT</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {report.repositorySnapshot?.commitSha.slice(0, 10) || 'No GitHub Repo'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-mono block">ARTIFACTS VERIFIED</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {report.artifactIntegrityRecords.filter((a) => a.isVerified).length} / {report.artifactIntegrityRecords.length} files
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-mono block">POST-DEADLINE COMMITS</span>
                <span className={`font-mono font-bold ${report.postDeadlineComparison?.hasPostDeadlineCommits ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  {report.postDeadlineComparison?.postDeadlineCommitCount || 0}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-mono block">DUPLICATE FLAGS</span>
                <span className={`font-mono font-bold ${report.duplicateMatches.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  {report.duplicateMatches.length} flagged
                </span>
              </div>
            </div>

            {/* Warnings list */}
            {report.warnings.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                  Integrity & Provenance Observations:
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                  {report.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Access limitations */}
            {report.accessLimitations.length > 0 && (
              <div className="p-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Lock size={13} className="text-slate-500 shrink-0" />
                  Access Limitations:
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {report.accessLimitations.map((lim, i) => (
                    <li key={i}>{lim}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: REPOSITORY & POST-DEADLINE COMPARISON ── */}
        {activeTab === 'repo' && report && (
          <div className="space-y-4">
            {report.repositorySnapshot ? (
              <div className="space-y-4">
                {/* Repository Snapshot Details */}
                <div className="p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <GitBranch size={14} className="text-blue-600" />
                      {report.repositorySnapshot.repositoryIdentity}
                    </span>
                    <Badge variant={report.repositorySnapshot.visibility === 'PUBLIC' ? 'success' : 'neutral'} size="sm">
                      {report.repositorySnapshot.visibility}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                    <div>
                      <span className="text-slate-400 block">Default Branch:</span>
                      {report.repositorySnapshot.defaultBranch}
                    </div>
                    <div>
                      <span className="text-slate-400 block">Access Method:</span>
                      {report.repositorySnapshot.accessMethod}
                    </div>
                  </div>

                  {/* Commit Provenance Pinned */}
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Exact Evaluated Commit SHA:
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(report.repositorySnapshot!.commitSha)}
                        className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {copiedSha === report.repositorySnapshot!.commitSha ? <Check size={12} /> : <Copy size={12} />}
                        {copiedSha === report.repositorySnapshot!.commitSha ? 'Copied' : 'Copy SHA'}
                      </button>
                    </div>
                    <span className="font-mono font-bold text-xs text-blue-700 dark:text-blue-300 block break-all mt-1">
                      {report.repositorySnapshot.commitSha}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Committed: {new Date(report.repositorySnapshot.commitTimestamp).toLocaleString()}
                      {report.repositorySnapshot.commitAuthor && ` by ${report.repositorySnapshot.commitAuthor}`}
                    </span>
                  </div>

                  {/* Candidate files inspected */}
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      Candidate Source Files Inspected ({report.repositorySnapshot.inspectedFileCount}):
                    </span>
                    <div className="max-h-28 overflow-y-auto space-y-1 bg-slate-50 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                      {report.repositorySnapshot.filesInspected.map((file, i) => (
                        <div key={i} className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                          <span>{file.path}</span>
                          <span className="text-slate-400 text-[10px]">{file.lineCount ? `${file.lineCount} lines` : ''}</span>
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] text-slate-400 italic block mt-1">
                      * Bounded static inspection only. No submitted repository code was executed at runtime.
                    </span>
                  </div>
                </div>

                {/* Post-Deadline Change Comparison */}
                {report.postDeadlineComparison && (
                  <div className="p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Clock size={14} className="text-amber-500" />
                        Post-Deadline Activity Comparison
                      </span>
                      <Badge
                        variant={report.postDeadlineComparison.hasPostDeadlineCommits ? 'warning' : 'success'}
                        size="sm"
                      >
                        {report.postDeadlineComparison.hasPostDeadlineCommits
                          ? `${report.postDeadlineComparison.postDeadlineCommitCount} Commits After Deadline`
                          : 'No Post-Deadline Commits'}
                      </Badge>
                    </div>

                    <div className="p-2.5 rounded bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 text-[11px] text-blue-800 dark:text-blue-300">
                      {report.postDeadlineComparison.organizerAdvisoryNote}
                    </div>

                    {report.postDeadlineComparison.hasPostDeadlineCommits && (
                      <div className="space-y-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                          Commits Made After Deadline ({new Date(report.postDeadlineComparison.deadline).toLocaleString()}):
                        </span>
                        <div className="space-y-1.5 max-h-36 overflow-y-auto">
                          {report.postDeadlineComparison.postDeadlineCommits.map((c, i) => (
                            <div
                              key={i}
                              className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded font-mono text-[11px]"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-800 dark:text-slate-200">{c.sha.slice(0, 10)}</span>
                                <span className="text-amber-600 dark:text-amber-400">{new Date(c.timestamp).toLocaleString()}</span>
                              </div>
                              <p className="text-slate-600 dark:text-slate-400 font-sans text-xs mt-0.5">
                                "{c.message}" — <span className="italic">{c.author}</span>
                              </p>
                            </div>
                          ))}
                        </div>

                        {report.postDeadlineComparison.changedFiles.length > 0 && (
                          <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                            <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                              Files Modified Across Commits ({report.postDeadlineComparison.changedFilesCount}):
                            </span>
                            <div className="space-y-1 font-mono text-[11px]">
                              {report.postDeadlineComparison.changedFiles.map((f, i) => (
                                <div key={i} className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                  <span>{f.filename} ({f.status})</span>
                                  <span className="text-[10px] text-slate-400">
                                    {f.additions ? `+${f.additions}` : ''} {f.deletions ? `-${f.deletions}` : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">
                No GitHub repository link was provided for this submission.
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: ARTIFACT HASHES & VERIFICATION ── */}
        {activeTab === 'artifacts' && report && (
          <div className="space-y-3">
            <span className="text-xs text-slate-500 dark:text-slate-400 block">
              Cryptographic SHA-256 digests computed over file bytes. Verified against stored provenance records.
            </span>

            {report.artifactIntegrityRecords.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No uploaded file artifacts are attached to this submission.
              </div>
            ) : (
              <div className="space-y-2.5">
                {report.artifactIntegrityRecords.map((artifact) => (
                  <div
                    key={artifact.fileId}
                    className="p-3 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText size={15} className="text-blue-500" />
                        <div>
                          <span className="font-bold text-slate-900 dark:text-slate-100 block">
                            {artifact.sanitizedFileName}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {(artifact.fileSize / 1024).toFixed(1)} KB · {artifact.mimeType}
                          </span>
                        </div>
                      </div>

                      <Badge
                        variant={artifact.isTamperedOrModified ? 'danger' : 'success'}
                        size="sm"
                      >
                        {artifact.isTamperedOrModified ? 'Replaced / Hash Changed' : 'Verified SHA-256'}
                      </Badge>
                    </div>

                    {/* SHA-256 Digest box */}
                    <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">ORIGINAL SHA-256 DIGEST:</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(artifact.originalSha256)}
                          className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {copiedSha === artifact.originalSha256 ? <Check size={11} /> : <Copy size={11} />}
                          {copiedSha === artifact.originalSha256 ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <span className="break-all font-semibold text-slate-800 dark:text-slate-200 block mt-0.5">
                        {artifact.originalSha256}
                      </span>
                    </div>

                    {/* Version & Replacement History */}
                    {artifact.replacementHistory.length > 0 && (
                      <div className="p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 rounded text-[11px] space-y-1">
                        <span className="font-semibold text-amber-900 dark:text-amber-200 block">
                          Replacement Audit History ({artifact.replacementHistory.length}):
                        </span>
                        {artifact.replacementHistory.map((rep, idx) => (
                          <div key={idx} className="text-amber-800 dark:text-amber-300">
                            • Replaced at {new Date(rep.replacementTimestamp).toLocaleString()} by {rep.replacedBy}
                            <span className="italic block ml-2">"{rep.reason}"</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: DUPLICATE & SIMILARITY DETECTION ── */}
        {activeTab === 'duplicates' && report && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 text-xs text-blue-800 dark:text-blue-200">
              <strong>Human Review Policy:</strong> Similarity and duplicate detection flags are provided strictly for human organizer review. Do not interpret similarity as an automated plagiarism verdict.
            </div>

            {report.duplicateMatches.length === 0 ? (
              <div className="p-8 text-center space-y-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800">
                <CheckCircle2 size={32} className="text-emerald-500 mx-auto opacity-80" />
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  No Duplicates or Collisions Detected
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Artifact hashes, repository identity, and text similarity are unique across all competition submissions.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {report.duplicateMatches.map((match, i) => (
                  <div
                    key={i}
                    className="p-3.5 bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs space-y-2 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-slate-100 text-sm block">
                          {match.matchedProjectTitle}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          Ref: {match.matchedReferenceId} · Team: {match.matchedTeamOrAuthor}
                        </span>
                      </div>
                      <Badge variant="danger" size="sm">
                        {match.matchType} ({match.confidenceScore}%)
                      </Badge>
                    </div>

                    {match.matchedArtifacts && (
                      <div className="text-[11px] text-rose-700 dark:text-rose-300">
                        <strong>Identical Artifact Hashes:</strong> {match.matchedArtifacts.join(', ')}
                      </div>
                    )}

                    {match.matchedRepoUrl && (
                      <div className="text-[11px] text-rose-700 dark:text-rose-300">
                        <strong>Shared Repository:</strong> {match.matchedRepoUrl}
                      </div>
                    )}

                    {match.similarityDetails && (
                      <div className="grid grid-cols-3 gap-2 font-mono text-[11px] bg-rose-50 dark:bg-rose-950/20 p-2 rounded">
                        <div>Title: {match.similarityDetails.titleSimilarity}%</div>
                        <div>Description: {match.similarityDetails.descriptionSimilarity}%</div>
                        <div>Tech Stack: {match.similarityDetails.technologiesOverlap}%</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 5: ADMINISTRATIVE AUDIT & OVERRIDES ── */}
        {activeTab === 'admin' && report && (
          <div className="space-y-4 text-xs">
            {/* Action 1: Dismiss Duplicate Flag */}
            {report.duplicateMatches.length > 0 && (
              <div className="p-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                  Dismiss Duplicate Flag (Organizer Authorization)
                </span>
                <p className="text-[11px] text-slate-500">
                  Document the verification reason why this submission is authorized and legitimate despite similarity flags.
                </p>
                <textarea
                  rows={2}
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="Mandatory justification (e.g. independently authored with different architecture)..."
                  className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 text-slate-900 dark:text-slate-100"
                />
                <Button
                  variant="primary"
                  size="xs"
                  isLoading={actionLoading}
                  onClick={handleDismissDuplicate}
                >
                  Confirm & Dismiss Flag
                </Button>
              </div>
            )}

            {/* Action 2: Accept Post-Deadline Changes */}
            {report.postDeadlineComparison?.hasPostDeadlineCommits && (
              <div className="p-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                  Authorize & Accept Post-Deadline Commits
                </span>
                <p className="text-[11px] text-slate-500">
                  Authorize commits pushed after the deadline (e.g. non-substantive documentation fixes or pre-approved extensions).
                </p>
                <textarea
                  rows={2}
                  value={acceptLateReason}
                  onChange={(e) => setAcceptLateReason(e.target.value)}
                  placeholder="Mandatory justification (e.g. verified README fix approved by committee)..."
                  className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 text-slate-900 dark:text-slate-100"
                />
                <Button
                  variant="primary"
                  size="xs"
                  isLoading={actionLoading}
                  onClick={handleAcceptLateChanges}
                >
                  Accept Post-Deadline Changes
                </Button>
              </div>
            )}

            {/* Action 3: Lock/Pin Evaluation Commit SHA */}
            <div className="p-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
              <span className="font-bold text-slate-900 dark:text-slate-100 block">
                Lock Specific Commit SHA Reference
              </span>
              <p className="text-[11px] text-slate-500">
                Override the evaluated commit reference to lock judge evaluation to a specific immutable git commit SHA.
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={newPinnedSha}
                  onChange={(e) => setNewPinnedSha(e.target.value)}
                  placeholder="Full 40-character Git Commit SHA..."
                  className="w-full text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 text-slate-900 dark:text-slate-100"
                />
                <input
                  type="text"
                  value={pinShaReason}
                  onChange={(e) => setPinShaReason(e.target.value)}
                  placeholder="Mandatory reason for locking commit reference..."
                  className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 text-slate-900 dark:text-slate-100"
                />
              </div>
              <Button
                variant="outline"
                size="xs"
                isLoading={actionLoading}
                onClick={handlePinCommitSha}
              >
                Pin Commit SHA Reference
              </Button>
            </div>

            {/* Recorded Administrative Audit History */}
            {report.administrativeActions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                  Integrity Audit Trail ({report.administrativeActions.length}):
                </span>
                <div className="space-y-1.5">
                  {report.administrativeActions.map((act) => (
                    <div
                      key={act.id}
                      className="p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded font-mono text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-blue-600 dark:text-blue-400">{act.action}</span>
                        <span className="text-slate-400">{new Date(act.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="font-sans text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                        By {act.actorName} ({act.actorRole}): <span className="italic">"{act.rationale}"</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
