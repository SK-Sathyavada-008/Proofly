// ─────────────────────────────────────────────
// OrganizerAppealsModal.tsx — Phase 14 Organizer Appeals Management Console
// Proofly — Review appeals, assign reviewers, request information & adjudicate score adjustments
// ─────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  HelpCircle,
  UserCheck,
  Scale,
  RotateCw,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { appealService } from '../../services/appealService';
import type {
  AppealStatus,
  EvaluationAppeal,
} from '../../types/appealsAndNotifications';

interface OrganizerAppealsModalProps {
  isOpen: boolean;
  onClose: () => void;
  competitionId: string;
  competitionTitle?: string;
  organizerUser: { id: string; name: string; role: string };
  onAppealResolved?: () => void;
}

export const OrganizerAppealsModal: React.FC<OrganizerAppealsModalProps> = ({
  isOpen,
  onClose,
  competitionId,
  competitionTitle,
  organizerUser,
  onAppealResolved,
}) => {
  const { success, error: toastError } = useToast();

  const [appeals, setAppeals] = useState<EvaluationAppeal[]>([]);
  const [selectedAppeal, setSelectedAppeal] = useState<EvaluationAppeal | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | AppealStatus>('ALL');

  // Action states
  const [actionTab, setActionTab] = useState<'view' | 'assign' | 'request_info' | 'resolve'>('view');
  const [reviewerName, setReviewerName] = useState('');
  const [clarificationQuestion, setClarificationQuestion] = useState('');
  const [resolutionText, setResolutionText] = useState('');
  const [acceptAppeal, setAcceptAppeal] = useState(true);
  const [adjustedScore, setAdjustedScore] = useState<number | ''>('');
  const [isProcessing, setIsProcessing] = useState(false);

  const loadAppeals = useCallback(async () => {
    if (!competitionId) return;
    try {
      const list = await appealService.listAppealsForCompetition(competitionId);
      setAppeals(list);
      if (list.length > 0 && !selectedAppeal) {
        setSelectedAppeal(list[0]);
      } else if (selectedAppeal) {
        const refreshed = list.find((a) => a.id === selectedAppeal.id);
        if (refreshed) setSelectedAppeal(refreshed);
      }
    } catch (err: any) {
      toastError('Error', err.message || 'Could not load appeals.');
    }
  }, [competitionId, selectedAppeal, toastError]);

  useEffect(() => {
    if (isOpen) {
      loadAppeals();
    }
  }, [isOpen, competitionId]);

  const getStatusBadge = (status: AppealStatus) => {
    switch (status) {
      case 'SUBMITTED':
        return <Badge variant="warning" size="sm">Submitted</Badge>;
      case 'UNDER_REVIEW':
        return <Badge variant="primary" size="sm">Under Review</Badge>;
      case 'NEEDS_INFORMATION':
        return <Badge variant="warning" size="sm">Needs Info</Badge>;
      case 'RESOLVED':
        return <Badge variant="success" size="sm">Resolved (Accepted)</Badge>;
      case 'REJECTED':
        return <Badge variant="danger" size="sm">Rejected</Badge>;
      case 'WITHDRAWN':
        return <Badge variant="neutral" size="sm">Withdrawn</Badge>;
    }
  };

  const handleAssignReviewer = async () => {
    if (!selectedAppeal || !reviewerName.trim()) {
      toastError('Reviewer Required', 'Please enter a reviewer name.');
      return;
    }
    setIsProcessing(true);
    try {
      const updated = await appealService.assignAppealReviewer(
        selectedAppeal.id,
        { id: `rev_${Date.now()}`, name: reviewerName.trim(), role: 'APPEAL_REVIEWER' },
        organizerUser
      );
      setSelectedAppeal(updated);
      await loadAppeals();
      setActionTab('view');
      setReviewerName('');
      success('Reviewer Assigned', `${reviewerName} assigned to appeal.`);
    } catch (err: any) {
      toastError('Assignment Failed', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRequestInfo = async () => {
    if (!selectedAppeal || !clarificationQuestion.trim()) {
      toastError('Question Required', 'Please provide a clarification question.');
      return;
    }
    setIsProcessing(true);
    try {
      const updated = await appealService.requestAppealInformation(
        selectedAppeal.id,
        clarificationQuestion.trim(),
        organizerUser
      );
      setSelectedAppeal(updated);
      await loadAppeals();
      setActionTab('view');
      setClarificationQuestion('');
      success('Clarification Requested', 'Participant notified with information request.');
    } catch (err: any) {
      toastError('Request Failed', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResolveAppeal = async () => {
    if (!selectedAppeal) return;
    if (!resolutionText.trim() || resolutionText.trim().length < 5) {
      toastError('Resolution Required', 'Please provide a detailed final explanation (min 5 chars).');
      return;
    }

    setIsProcessing(true);
    try {
      const scoreAdj =
        acceptAppeal && adjustedScore !== '' && typeof adjustedScore === 'number'
          ? {
              criterionId: selectedAppeal.criterionId,
              newScore: adjustedScore,
              reason: resolutionText.trim(),
            }
          : undefined;

      const updated = await appealService.resolveAppeal({
        appealId: selectedAppeal.id,
        resolution: resolutionText.trim(),
        acceptAppeal,
        resolver: organizerUser,
        scoreAdjustment: scoreAdj,
      });

      setSelectedAppeal(updated);
      await loadAppeals();
      setActionTab('view');
      setResolutionText('');
      setAdjustedScore('');
      success('Appeal Decided', `Appeal marked as ${updated.status}.`);
      if (onAppealResolved) onAppealResolved();
    } catch (err: any) {
      toastError('Resolution Failed', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredAppeals = appeals.filter((a) => {
    if (statusFilter === 'ALL') return true;
    return a.status === statusFilter;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Participant Appeals Console ${competitionTitle ? `— ${competitionTitle}` : ''}`}
      maxWidth="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Total Appeals: <strong>{appeals.length}</strong> (Pending: {appeals.filter((a) => a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW' || a.status === 'NEEDS_INFORMATION').length})
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 text-xs">
        {/* Left List (4 cols) */}
        <div className="md:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col bg-slate-50/50 dark:bg-slate-900/50 max-h-[540px]">
          {/* Filter Bar */}
          <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between">
            <span className="font-semibold text-slate-800 dark:text-slate-200">Appeals List</span>
            <Button variant="outline" size="xs" onClick={loadAppeals} leftIcon={<RotateCw size={11} />}>
              Refresh
            </Button>
          </div>

          <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full text-[11px] py-1 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Statuses ({appeals.length})</option>
              <option value="SUBMITTED">Submitted ({appeals.filter((a) => a.status === 'SUBMITTED').length})</option>
              <option value="UNDER_REVIEW">Under Review ({appeals.filter((a) => a.status === 'UNDER_REVIEW').length})</option>
              <option value="NEEDS_INFORMATION">Needs Information ({appeals.filter((a) => a.status === 'NEEDS_INFORMATION').length})</option>
              <option value="RESOLVED">Resolved ({appeals.filter((a) => a.status === 'RESOLVED').length})</option>
              <option value="REJECTED">Rejected ({appeals.filter((a) => a.status === 'REJECTED').length})</option>
            </select>
          </div>

          <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {filteredAppeals.length === 0 ? (
              <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-[11px]">
                No appeals matching criteria.
              </div>
            ) : (
              filteredAppeals.map((appeal) => (
                <div
                  key={appeal.id}
                  onClick={() => {
                    setSelectedAppeal(appeal);
                    setActionTab('view');
                  }}
                  className={`p-3 cursor-pointer transition-colors ${
                    selectedAppeal?.id === appeal.id
                      ? 'bg-blue-50 dark:bg-blue-950/40 border-l-2 border-blue-600'
                      : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-bold text-slate-900 dark:text-slate-100 font-mono text-[11px]">
                      {appeal.referenceId}
                    </span>
                    {getStatusBadge(appeal.status)}
                  </div>
                  <p className="font-semibold text-slate-700 dark:text-slate-300 truncate text-[11px]">
                    {appeal.criterionName}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                    {appeal.participant.participantName} · {new Date(appeal.submittedAt).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Detail Pane (8 cols) */}
        <div className="md:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-white dark:bg-slate-900 overflow-y-auto max-h-[540px] space-y-4">
          {selectedAppeal ? (
            <div className="space-y-4">
              {/* Header Card */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                        {selectedAppeal.referenceId}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAppeal.criterionName}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      Submitted by <strong>{selectedAppeal.participant.participantName}</strong> ({selectedAppeal.participant.participantEmail || 'No email'})
                    </span>
                  </div>
                  <div>{getStatusBadge(selectedAppeal.status)}</div>
                </div>

                <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Reason: <strong className="text-slate-700 dark:text-slate-300">{selectedAppeal.reason}</strong></span>
                  <span>·</span>
                  <span>Submitted: {new Date(selectedAppeal.submittedAt).toLocaleString()}</span>
                  {selectedAppeal.assignedReviewer && (
                    <>
                      <span>·</span>
                      <span>Reviewer: <strong className="text-blue-600 dark:text-blue-400">{selectedAppeal.assignedReviewer.name}</strong></span>
                    </>
                  )}
                </div>
              </div>

              {/* Supporting Explanation */}
              <div className="space-y-1">
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs uppercase tracking-wider">
                  Participant's Appeal Explanation
                </span>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {selectedAppeal.supportingExplanation}
                </div>
              </div>

              {/* Evidence References */}
              {selectedAppeal.evidenceReferences && selectedAppeal.evidenceReferences.length > 0 && (
                <div className="space-y-1">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs uppercase tracking-wider">
                    Cited Evidence References
                  </span>
                  <div className="space-y-1">
                    {selectedAppeal.evidenceReferences.map((ref, idx) => (
                      <div
                        key={idx}
                        className="p-2 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[11px] text-blue-700 dark:text-blue-400 flex items-center justify-between"
                      >
                        <span>{ref}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Information Requests Thread */}
              {selectedAppeal.informationRequests && selectedAppeal.informationRequests.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs uppercase tracking-wider">
                    Information Requests & Clarifications
                  </span>
                  <div className="space-y-2">
                    {selectedAppeal.informationRequests.map((req) => (
                      <div
                        key={req.id}
                        className="p-3 bg-amber-50/60 dark:bg-amber-950/20 rounded-lg border border-amber-200/80 dark:border-amber-900/50 space-y-1 text-[11px]"
                      >
                        <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                          <span>Q: {req.question}</span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(req.requestedAt).toLocaleDateString()}
                          </span>
                        </div>
                        {req.response ? (
                          <p className="text-emerald-800 dark:text-emerald-300 font-medium pl-2 border-l-2 border-emerald-500">
                            <strong>Participant Response:</strong> {req.response}
                          </p>
                        ) : (
                          <p className="text-amber-700 dark:text-amber-400 italic">Awaiting response from participant...</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resolution Banner if resolved */}
              {selectedAppeal.resolution && (
                <div
                  className={`p-3.5 rounded-xl border ${
                    selectedAppeal.status === 'RESOLVED'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-200'
                  } space-y-1`}
                >
                  <div className="flex items-center justify-between font-bold text-xs">
                    <span>Final Organizer Decision: {selectedAppeal.status}</span>
                    <span className="text-[10px]">
                      {selectedAppeal.resolvedAt ? new Date(selectedAppeal.resolvedAt).toLocaleString() : ''}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{selectedAppeal.resolution}</p>
                  {selectedAppeal.scoreAdjustment && (
                    <div className="mt-2 p-2 bg-white/70 dark:bg-slate-900/60 rounded border border-emerald-300 dark:border-emerald-700 font-mono text-[10px]">
                      Official Score Adjusted: <strong>+{selectedAppeal.scoreAdjustment.newScore} pts</strong> (Ledger Entry: {selectedAppeal.scoreAdjustment.scoreLedgerEntryId})
                    </div>
                  )}
                </div>
              )}

              {/* Action Tabs for pending appeals */}
              {selectedAppeal.status !== 'RESOLVED' && selectedAppeal.status !== 'REJECTED' && selectedAppeal.status !== 'WITHDRAWN' && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button
                      variant={actionTab === 'view' ? 'primary' : 'outline'}
                      size="xs"
                      onClick={() => setActionTab('view')}
                    >
                      Overview
                    </Button>
                    <Button
                      variant={actionTab === 'assign' ? 'primary' : 'outline'}
                      size="xs"
                      onClick={() => setActionTab('assign')}
                      leftIcon={<UserCheck size={11} />}
                    >
                      Assign Reviewer
                    </Button>
                    <Button
                      variant={actionTab === 'request_info' ? 'primary' : 'outline'}
                      size="xs"
                      onClick={() => setActionTab('request_info')}
                      leftIcon={<HelpCircle size={11} />}
                    >
                      Request Info
                    </Button>
                    <Button
                      variant={actionTab === 'resolve' ? 'primary' : 'outline'}
                      size="xs"
                      onClick={() => setActionTab('resolve')}
                      leftIcon={<Scale size={11} />}
                    >
                      Resolve Appeal
                    </Button>
                  </div>

                  {/* Tab: Assign Reviewer */}
                  {actionTab === 'assign' && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                      <span className="font-semibold block text-slate-800 dark:text-slate-200">
                        Assign Internal Reviewer
                      </span>
                      <Input
                        value={reviewerName}
                        onChange={(e) => setReviewerName(e.target.value)}
                        placeholder="e.g. Dr. Marcus Chen, Lead Judge"
                        className="text-xs"
                      />
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={handleAssignReviewer}
                        isLoading={isProcessing}
                      >
                        Confirm Assignment
                      </Button>
                    </div>
                  )}

                  {/* Tab: Request Info */}
                  {actionTab === 'request_info' && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                      <span className="font-semibold block text-slate-800 dark:text-slate-200">
                        Request Clarification from Participant
                      </span>
                      <Textarea
                        rows={3}
                        value={clarificationQuestion}
                        onChange={(e) => setClarificationQuestion(e.target.value)}
                        placeholder="Specify what additional documentation, code pointers, or explanation is needed..."
                        className="text-xs"
                      />
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={handleRequestInfo}
                        isLoading={isProcessing}
                      >
                        Send Request & Notify Participant
                      </Button>
                    </div>
                  )}

                  {/* Tab: Resolve Appeal */}
                  {actionTab === 'resolve' && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                      <span className="font-semibold block text-slate-800 dark:text-slate-200">
                        Official Appeal Determination
                      </span>

                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                          <input
                            type="radio"
                            name="appealDecision"
                            checked={acceptAppeal}
                            onChange={() => setAcceptAppeal(true)}
                          />
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            Accept Appeal (Upheld)
                          </span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                          <input
                            type="radio"
                            name="appealDecision"
                            checked={!acceptAppeal}
                            onChange={() => setAcceptAppeal(false)}
                          />
                          <span className="text-rose-700 dark:text-rose-400 font-semibold">
                            Reject Appeal (Maintained)
                          </span>
                        </label>
                      </div>

                      {acceptAppeal && (
                        <div className="space-y-1">
                          <label className="font-medium text-slate-700 dark:text-slate-300 block">
                            Adjusted Criterion Score (Optional Score Correction)
                          </label>
                          <Input
                            type="number"
                            value={adjustedScore}
                            onChange={(e) => setAdjustedScore(e.target.value === '' ? '' : Number(e.target.value))}
                            placeholder="e.g. 24"
                            className="text-xs w-48"
                          />
                          <span className="text-[10px] text-slate-400 block">
                            Recorded directly to the append-only official scoring ledger.
                          </span>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="font-medium text-slate-700 dark:text-slate-300 block">
                          Final Resolution Explanation *
                        </label>
                        <Textarea
                          rows={3}
                          value={resolutionText}
                          onChange={(e) => setResolutionText(e.target.value)}
                          placeholder="Provide the formal explanation and findings for this determination..."
                          className="text-xs"
                        />
                      </div>

                      <Button
                        variant={acceptAppeal ? 'primary' : 'danger'}
                        size="xs"
                        onClick={handleResolveAppeal}
                        isLoading={isProcessing}
                      >
                        Finalize Decision & Audit Log
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-20 text-center text-slate-400 dark:text-slate-500 text-xs">
              Select an appeal from the left to inspect details.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
