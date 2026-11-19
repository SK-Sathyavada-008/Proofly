// ─────────────────────────────────────────────
// ParticipantSubmissionManagePage.tsx — Secure Anonymous Submission Management
// Proofly — Phase 5
// ─────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  KeyRound,
  Lock,
  History,
  FileText,
  Save,
  Send,
  ExternalLink,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../components/ui/Toast';
import { submissionService } from '../../services/submissionService';
import { competitionService } from '../../services/competitionService';
import { fileStorageService } from '../../services/fileStorageService';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { ALL_SUBMISSION_STATUSES, type ProjectSubmission } from '../../types/submission';
import type { Competition } from '../../types/authAndCompetition';

export const ParticipantSubmissionManagePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { currentUser, verifiedSession } = useProoflyAuth();
  const { success, error: toastError } = useToast();

  const refParam = searchParams.get('ref') || '';
  const tokenParam = searchParams.get('token') || '';

  // Auth & Lookup State
  const [refInput, setRefInput] = useState(refParam);
  const [tokenInput, setTokenInput] = useState(tokenParam);
  const [isVerifying, setIsVerifying] = useState(false);
  const [submission, setSubmission] = useState<ProjectSubmission | null>(null);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Editable fields state
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [solution, setSolution] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [deploymentUrl, setDeploymentUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const verifyAndLoadSubmission = useCallback(
    async (ref: string, token: string) => {
      if (!ref.trim() || !token.trim()) return;
      setIsVerifying(true);

      try {
        const sub = await submissionService.getSubmissionByReference(ref.trim());
        if (!sub) {
          toastError('Not Found', `No submission found for reference ID "${ref.trim()}".`);
          setIsVerifying(false);
          return;
        }

        const valid = await submissionService.verifyManagementToken(ref.trim(), token.trim());
        if (!valid) {
          toastError('Access Denied', 'Invalid cryptographic management token.');
          setIsVerifying(false);
          return;
        }

        const comp = await competitionService.getCompetition(sub.competitionId);

        setSubmission(sub);
        setCompetition(comp);
        setIsAuthorized(true);

        // Populate form
        setProjectTitle(sub.projectTitle);
        setProjectDescription(sub.projectDescription);
        setProblemStatement(sub.problemStatement || '');
        setSolution(sub.solution || '');
        setGithubUrl(sub.githubUrl || '');
        setDeploymentUrl(sub.deploymentUrl || '');
        setVideoUrl(sub.videoUrl || '');

        success('Authenticated', `Management access verified for ${sub.referenceId}.`);
      } catch (err: any) {
        toastError('Verification Error', err.message);
      } finally {
        setIsVerifying(false);
      }
    },
    [toastError, success]
  );

  useEffect(() => {
    if (refParam && tokenParam) {
      verifyAndLoadSubmission(refParam, tokenParam);
    }
  }, [refParam, tokenParam, verifyAndLoadSubmission]);

  const handleUpdate = async (isFinalSubmit: boolean) => {
    if (!submission) return;
    setIsUpdating(true);

    try {
      const updated = await submissionService.updateSubmission({
        referenceId: submission.referenceId,
        rawToken: tokenInput || tokenParam,
        updatedPayload: {
          projectTitle,
          projectDescription,
          problemStatement,
          solution,
          githubUrl,
          deploymentUrl,
          videoUrl,
        },
        isFinalSubmit,
        changeSummary: changeSummary || (isFinalSubmit ? 'Promoted draft to final submission' : 'Updated project details'),
        mockCompetition: competition || undefined,
      });

      setSubmission(updated);
      setChangeSummary('');
      success('Submission Updated', `Version ${updated.currentVersion} saved successfully.`);
    } catch (err: any) {
      toastError('Update Failed', err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  if (!isAuthorized || !submission) {
    return (
      <div className="max-w-md mx-auto py-8 space-y-5">
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-5">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Manage submission</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enter your reference ID and management token to view status or update details.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyAndLoadSubmission(refInput, tokenInput);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Submission Reference ID
              </label>
              <Input
                type="text"
                placeholder="e.g. PF-SUB-2026-X9K2L"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
                required
                className="font-mono text-center uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Secret Management Token
              </label>
              <Input
                type="password"
                placeholder="sec_..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                required
                className="font-mono text-center"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              isLoading={isVerifying}
              rightIcon={<KeyRound size={14} />}
            >
              Verify Cryptographic Ownership
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const isLocked =
    submission.isLocked ||
    (competition &&
      Date.now() > new Date(competition.policies.submissionDeadline).getTime() &&
      !competition.policies.allowLateSubmissions);

  const canEdit =
    !isLocked &&
    (submission.status === 'Draft' || competition?.policies.allowSubmissionEdits);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      {/* Top Banner: Status & Overview */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-500/30">
                {submission.referenceId}
              </span>
              <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
                {submission.projectTitle}
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Submitted to <strong className="text-slate-700 dark:text-slate-200">{competition?.title || 'Active Competition'}</strong> · Active Version:{' '}
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">v{submission.currentVersion}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Badge
              variant={
                submission.status === 'Finalized' || submission.status === 'Evaluated'
                  ? 'success'
                  : submission.status === 'AI Evaluation Failed'
                  ? 'danger'
                  : submission.status === 'Draft'
                  ? 'warning'
                  : 'primary'
              }
              size="md"
            >
              {submission.status}
            </Badge>
          </div>
        </div>

        {/* 11-Status Pipeline Progress Bar */}
        <div className="space-y-2 pt-2">
          <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
            Submission Lifecycle Track (11 States)
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-center">
            {ALL_SUBMISSION_STATUSES.map((st) => {
              const isCurrent = submission.status === st;
              const hasPassed = submission.statusHistory.some((h) => h.status === st);

              return (
                <div
                  key={st}
                  className={`p-2 rounded-lg border text-[11px] font-medium transition-all ${
                    isCurrent
                      ? 'border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 shadow-2xs font-bold'
                      : hasPassed
                      ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                      : 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 opacity-60'
                  }`}
                >
                  <span className="block truncate">{st}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lock Banner if edits disabled */}
        {isLocked && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs">
            <Lock size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>Submissions Locked:</strong> This submission is locked from further edits due to competition
              deadline or organizer settings.
            </span>
          </div>
        )}
      </div>

      {/* Main Workspace Grid: Edit Form on Left, Version History & Artifacts on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3): Edit Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                {canEdit ? 'Edit Submission Artifacts' : 'Submission Details (Read-Only)'}
              </h2>
              {canEdit && (
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">Edits Permitted</span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Project Title</label>
                <Input
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  disabled={!canEdit}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Project Description</label>
                <Textarea
                  rows={3}
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  disabled={!canEdit}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Problem Statement</label>
                  <Textarea
                    rows={2}
                    value={problemStatement}
                    onChange={(e) => setProblemStatement(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Solution</label>
                  <Textarea
                    rows={2}
                    value={solution}
                    onChange={(e) => setSolution(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">GitHub Repository</label>
                <Input
                  type="url"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  disabled={!canEdit}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Live Deployment</label>
                  <Input
                    type="url"
                    value={deploymentUrl}
                    onChange={(e) => setDeploymentUrl(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Demo Video Link</label>
                  <Input
                    type="url"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
              </div>

              {canEdit && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Change Summary <span className="text-slate-400 dark:text-slate-500 font-normal">(Recorded in version history)</span>
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. Updated GitHub repository URL and demo link"
                      value={changeSummary}
                      onChange={(e) => setChangeSummary(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => handleUpdate(false)}
                      isLoading={isUpdating}
                      leftIcon={<Save size={14} />}
                    >
                      Save Version {submission.currentVersion + 1}
                    </Button>

                    {submission.status === 'Draft' && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleUpdate(true)}
                        isLoading={isUpdating}
                        rightIcon={<Send size={14} />}
                      >
                        Promote Draft to Final Submit
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column (1/3): Version History & Files */}
        <div className="space-y-6">
          {/* Version History Card */}
          <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <History size={14} className="text-blue-600 dark:text-blue-400" />
                <span>Version History</span>
              </h3>
              <Badge variant="neutral" size="sm">
                {submission.versions.length} {submission.versions.length === 1 ? 'entry' : 'entries'}
              </Badge>
            </div>

            <div className="space-y-3">
              {submission.versions.map((ver) => (
                <div
                  key={ver.versionNumber}
                  className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                    <span>Version {ver.versionNumber}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {new Date(ver.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                    {ver.changeSummary || 'Version update'}
                  </p>
                  <div className="flex items-center gap-2 pt-1 text-[10px] text-slate-400 dark:text-slate-500">
                    <span>Status: {ver.statusAtVersion}</span>
                    <span>·</span>
                    <span>Files: {ver.files.length}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Files Card */}
          <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <FileText size={14} className="text-blue-600 dark:text-blue-400" />
                <span>Uploaded Artifacts</span>
              </h3>
              <Badge variant="primary" size="sm">
                {submission.files.length}
              </Badge>
            </div>

            {submission.files.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">No binary files uploaded.</p>
            ) : (
              <div className="space-y-2">
                {submission.files.map((f) => {
                  const isLegacyBlob =
                    Boolean(f.downloadUrl?.startsWith('blob:')) ||
                    Boolean(f.downloadUrl?.includes('storage.proofly.internal')) ||
                    !fileStorageService.parseCanonicalStoragePath(f.storagePath);

                  return (
                    <div
                      key={f.id}
                      className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs flex items-center justify-between gap-2"
                    >
                      <div className="truncate">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">{f.fileName}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {(f.fileSize / (1024 * 1024)).toFixed(2)} MB · {f.detectedMimeType || f.mimeType}
                        </span>
                      </div>
                      {isLegacyBlob ? (
                        <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-500/30 shrink-0">
                          Re-upload required
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await fileStorageService.triggerBrowserDownload(f, {
                                verifiedSession,
                                participantUid: currentUser?.uid,
                              });
                            } catch (err: any) {
                              toastError('Download Denied', err?.message || 'Unable to download artifact.');
                            }
                          }}
                          title="Download verified artifact"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 p-1 cursor-pointer"
                        >
                          <ExternalLink size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
