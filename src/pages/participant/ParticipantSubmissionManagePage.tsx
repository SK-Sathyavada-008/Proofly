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
  Trophy,
  MessageSquare,
  HelpCircle,
  Megaphone,
  Sparkles,
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
import { appealService } from '../../services/appealService';
import { ParticipantAppealModal } from '../../components/appeals/ParticipantAppealModal';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { ALL_SUBMISSION_STATUSES, type ProjectSubmission } from '../../types/submission';
import type { Competition } from '../../types/authAndCompetition';
import type {
  EvaluationAppeal,
  ParticipantReleasedFeedback,
} from '../../types/appealsAndNotifications';

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

  // Feedback & Appeals State (Phase 14)
  const [activeTab, setActiveTab] = useState<'submission' | 'feedback_appeals'>('submission');
  const [feedback, setFeedback] = useState<ParticipantReleasedFeedback | null>(null);
  const [appeals, setAppeals] = useState<EvaluationAppeal[]>([]);
  const [isAppealModalOpen, setIsAppealModalOpen] = useState(false);
  const [respondingToReqId, setRespondingToReqId] = useState<string | null>(null);
  const [responseContent, setResponseContent] = useState('');
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);

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

        // Phase 14: Load participant feedback & appeals
        try {
          const fb = await appealService.getParticipantFeedback(sub, { token: token.trim() });
          setFeedback(fb);
          const applList = await appealService.listAppealsForSubmission(sub.id);
          setAppeals(applList);
        } catch (fbErr) {
          console.warn('Could not load feedback or appeals:', fbErr);
        }

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

  const handleRespondToInformation = async (appealId: string, reqId: string) => {
    if (!responseContent.trim()) {
      toastError('Response Required', 'Please enter your clarification response.');
      return;
    }
    setIsSubmittingResponse(true);
    try {
      const updated = await appealService.respondToInformationRequest(
        appealId,
        reqId,
        responseContent.trim(),
        { id: currentUser?.uid, name: submission?.primaryContactName || (submission as any)?.submitterName || 'Participant' }
      );
      setAppeals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setRespondingToReqId(null);
      setResponseContent('');
      success('Response Submitted', 'Your clarification has been submitted to the organizers.');
    } catch (err: any) {
      toastError('Response Failed', err.message);
    } finally {
      setIsSubmittingResponse(false);
    }
  };

  const handleWithdrawAppeal = async (appealId: string) => {
    try {
      const updated = await appealService.withdrawAppeal(
        appealId,
        { id: currentUser?.uid || 'participant', name: submission?.primaryContactName || (submission as any)?.submitterName || 'Participant', role: 'PARTICIPANT' }
      );
      setAppeals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      success('Appeal Withdrawn', 'Your appeal has been withdrawn.');
    } catch (err: any) {
      toastError('Withdraw Failed', err.message);
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

      {/* ── WORKSPACE TABS ── */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('submission')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'submission'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileText size={14} />
          <span>Submission & Artifacts</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('feedback_appeals')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer relative ${
            activeTab === 'feedback_appeals'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Trophy size={14} />
          <span>Evaluation Feedback & Appeals</span>
          {feedback?.isResultsReleased && (
            <span className="w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white" />
          )}
          {appeals.length > 0 && (
            <Badge variant="neutral" size="sm" className="ml-1 text-[10px]">
              {appeals.length}
            </Badge>
          )}
        </button>
      </div>

      {/* ── TAB 1: SUBMISSION DETAILS & ARTIFACTS ── */}
      {activeTab === 'submission' && (
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
      )}

      {/* ── TAB 2: EVALUATION RESULTS & PARTICIPANT APPEALS ── */}
      {activeTab === 'feedback_appeals' && (
        <div className="space-y-6">
          {/* Section 1: Official Results & Feedback */}
          {feedback?.isResultsReleased ? (
            <div className="space-y-6">
              {/* Score Header Card */}
              <div className="p-6 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Trophy size={20} className="text-amber-300" />
                    <span className="font-bold text-sm tracking-wide uppercase opacity-90">
                      Official Released Evaluation
                    </span>
                  </div>
                  <h2 className="text-3xl font-extrabold tracking-tight">
                    {feedback.publishedScore} <span className="text-lg font-normal opacity-80">/ {feedback.maxPossibleScore} pts</span>
                  </h2>
                  <p className="text-xs opacity-90">
                    Percentage Score: <strong>{feedback.percentageScore}%</strong> · Released on {feedback.releasedAt ? new Date(feedback.releasedAt).toLocaleDateString() : 'Official Publication'}
                  </p>
                </div>

                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white/10 hover:bg-white/20 border-white/30 text-white"
                    onClick={() => setIsAppealModalOpen(true)}
                    leftIcon={<MessageSquare size={13} />}
                  >
                    Raise Criterion Appeal
                  </Button>
                </div>
              </div>

              {/* Criterion-wise Breakdown */}
              <div className="space-y-3">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider flex items-center gap-2">
                  <Sparkles size={14} className="text-blue-600 dark:text-blue-400" />
                  <span>Criterion-wise Released Feedback</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {feedback.criterionFeedback.map((crit) => (
                    <Card key={crit.criterionId} className="p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                          {crit.criterionName}
                        </span>
                        <span className="font-mono font-bold text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded">
                          {crit.awardedScore} / {crit.maxScore} pts
                        </span>
                      </div>

                      {crit.releasedComments && crit.releasedComments.length > 0 ? (
                        <div className="space-y-1 pt-1">
                          {crit.releasedComments.map((comment, i) => (
                            <p key={i} className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed italic bg-slate-50 dark:bg-slate-800/40 p-2 rounded">
                              "{comment}"
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic">No specific feedback comments released for this criterion.</p>
                      )}
                    </Card>
                  ))}
                </div>
              </div>

              {/* Published AI Assessment (if enabled) */}
              {feedback.publishedAiAssessment && (
                <div className="p-4 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/80 dark:border-purple-900/40 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-purple-900 dark:text-purple-200">
                    <Sparkles size={14} className="text-purple-600 dark:text-purple-400" />
                    <span>Automated AI Evaluation Guidance</span>
                  </div>
                  <p className="text-[11px] text-purple-950/80 dark:text-purple-300/80 leading-relaxed">
                    {feedback.publishedAiAssessment.summary}
                  </p>
                  <p className="text-[10px] text-purple-500 italic">
                    {feedback.publishedAiAssessment.disclaimer}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <Card className="p-8 text-center bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-3">
              <Trophy size={36} className="mx-auto text-slate-300 dark:text-slate-600 stroke-[1.5]" />
              <div className="space-y-1">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Official Results Pending</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Official evaluation scores, rubric breakdown, and judge feedback will be visible here as soon as competition organizers finalize and release results.
                </p>
              </div>
              <Badge variant="neutral" size="sm">
                Status: {submission.status}
              </Badge>
            </Card>
          )}

          {/* Announcements Banner */}
          {feedback?.announcements && feedback.announcements.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider flex items-center gap-2">
                <Megaphone size={14} className="text-amber-500" />
                <span>Competition Announcements ({feedback.announcements.length})</span>
              </h3>
              <div className="space-y-2">
                {feedback.announcements.map((ann) => (
                  <div
                    key={ann.id}
                    className="p-3 bg-amber-50/70 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/40 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-bold text-amber-900 dark:text-amber-200">
                      <span>{ann.title}</span>
                      <span className="text-[10px] text-slate-400">{new Date(ann.publishedAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[11px] text-amber-950/80 dark:text-amber-300/80 leading-relaxed">{ann.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 2: Raised Appeals & Status */}
          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider flex items-center gap-2">
                <MessageSquare size={14} className="text-blue-600 dark:text-blue-400" />
                <span>Your Evaluation Appeals ({appeals.length})</span>
              </h3>

              <Button
                variant="outline"
                size="xs"
                onClick={() => setIsAppealModalOpen(true)}
                leftIcon={<MessageSquare size={12} />}
              >
                Raise Appeal
              </Button>
            </div>

            {appeals.length === 0 ? (
              <div className="p-6 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 text-center text-slate-400 text-xs">
                No appeals submitted. If you believe a rubric criterion was scored incorrectly or critical evidence was missed, you may raise an appeal above.
              </div>
            ) : (
              <div className="space-y-3">
                {appeals.map((appeal) => (
                  <Card key={appeal.id} className="p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-slate-100">{appeal.criterionName}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400">{appeal.id}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          Reason: <strong>{appeal.reason}</strong> · Submitted {new Date(appeal.submittedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <Badge
                        variant={
                          appeal.status === 'RESOLVED'
                            ? 'success'
                            : appeal.status === 'REJECTED'
                            ? 'danger'
                            : appeal.status === 'NEEDS_INFORMATION'
                            ? 'warning'
                            : 'primary'
                        }
                        size="sm"
                      >
                        {appeal.status}
                      </Badge>
                    </div>

                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded border border-slate-200 dark:border-slate-800 text-[11px] leading-relaxed">
                      {appeal.supportingExplanation}
                    </div>

                    {appeal.evidenceReferences && appeal.evidenceReferences.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-500">
                        <span>Cited evidence:</span>
                        {appeal.evidenceReferences.map((ref, idx) => (
                          <span key={idx} className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-blue-600 dark:text-blue-400">
                            {ref}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Information Request from Organizer */}
                    {appeal.informationRequests && appeal.informationRequests.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        {appeal.informationRequests.map((req) => (
                          <div key={req.id} className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900/40 text-[11px] space-y-2">
                            <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center justify-between">
                              <span>Organizer Clarification Request:</span>
                              <span className="text-[10px] text-slate-400">{new Date(req.requestedAt).toLocaleDateString()}</span>
                            </div>
                            <p className="text-amber-950/80 dark:text-amber-300/80">{req.question}</p>

                            {req.response ? (
                              <p className="text-emerald-800 dark:text-emerald-300 pl-2 border-l-2 border-emerald-500 font-medium">
                                <strong>Your Response:</strong> {req.response}
                              </p>
                            ) : (
                              <div className="space-y-2 pt-1">
                                {respondingToReqId === req.id ? (
                                  <div className="space-y-2">
                                    <Textarea
                                      rows={2}
                                      value={responseContent}
                                      onChange={(e) => setResponseContent(e.target.value)}
                                      placeholder="Provide the requested details or code pointers..."
                                      className="text-xs"
                                    />
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="primary"
                                        size="xs"
                                        onClick={() => handleRespondToInformation(appeal.id, req.id)}
                                        isLoading={isSubmittingResponse}
                                      >
                                        Submit Clarification
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="xs"
                                        onClick={() => {
                                          setRespondingToReqId(null);
                                          setResponseContent('');
                                        }}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    onClick={() => setRespondingToReqId(req.id)}
                                    leftIcon={<HelpCircle size={11} />}
                                  >
                                    Respond to Request
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Resolution Banner */}
                    {appeal.resolution && (
                      <div
                        className={`p-3 rounded-lg border text-[11px] space-y-1 ${
                          appeal.status === 'RESOLVED'
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                            : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-200'
                        }`}
                      >
                        <span className="font-bold block">Resolution: {appeal.status}</span>
                        <p>{appeal.resolution}</p>
                        {appeal.scoreAdjustment && (
                          <span className="font-mono text-[10px] block mt-1">
                            Score Adjusted to: <strong>{appeal.scoreAdjustment.newScore} pts</strong>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Withdraw Button if still active */}
                    {appeal.status !== 'RESOLVED' && appeal.status !== 'REJECTED' && appeal.status !== 'WITHDRAWN' && (
                      <div className="flex justify-end pt-1">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => handleWithdrawAppeal(appeal.id)}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          Withdraw Appeal
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: RAISE APPEAL ── */}
      <ParticipantAppealModal
        isOpen={isAppealModalOpen}
        onClose={() => setIsAppealModalOpen(false)}
        submission={submission}
        competition={competition}
        managementToken={tokenInput}
        releasedCriteria={feedback?.criterionFeedback || []}
        onAppealSubmitted={(newAppeal) => {
          setAppeals((prev) => [newAppeal, ...prev]);
        }}
      />
    </div>
  );
};
