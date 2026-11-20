// ─────────────────────────────────────────────
// ParticipantAppealModal.tsx — Phase 14 Evaluation Appeal Dialog
// Proofly — Structured criterion appeal form with evidence citations
// ─────────────────────────────────────────────

import React, { useState } from 'react';
import {
  Send,
  ShieldAlert,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { appealService } from '../../services/appealService';
import type { ProjectSubmission } from '../../types/submission';
import type { Competition } from '../../types/authAndCompetition';
import type {
  AppealReason,
  EvaluationAppeal,
  ReleasedCriterionFeedback,
} from '../../types/appealsAndNotifications';

interface ParticipantAppealModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: ProjectSubmission;
  competition: Competition | null;
  managementToken?: string;
  releasedCriteria: ReleasedCriterionFeedback[];
  onAppealSubmitted: (appeal: EvaluationAppeal) => void;
}

export const ParticipantAppealModal: React.FC<ParticipantAppealModalProps> = ({
  isOpen,
  onClose,
  submission,
  competition,
  managementToken,
  releasedCriteria,
  onAppealSubmitted,
}) => {
  const { success, error: toastError } = useToast();

  const rubricList = (competition as any)?.rubricCriteria || competition?.rubric || [];
  const [selectedCriterionId, setSelectedCriterionId] = useState<string>(
    releasedCriteria[0]?.criterionId || rubricList[0]?.id || ''
  );
  const [reason, setReason] = useState<AppealReason>('EVIDENCE_OVERLOOKED');
  const [explanation, setExplanation] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableCriteria =
    releasedCriteria.length > 0
      ? releasedCriteria.map((c) => ({
          value: c.criterionId,
          label: `${c.criterionName} (Awarded: ${c.awardedScore}/${c.maxScore} pts)`,
        }))
      : rubricList.map((c: any) => ({
          value: c.id,
          label: `${c.name || c.title} (Max: ${c.maxScore} pts)`,
        }));

  const reasonOptions = [
    { value: 'EVIDENCE_OVERLOOKED', label: 'Evidence Overlooked (Specific code, file, or slide was missed)' },
    { value: 'SCORING_DISCREPANCY', label: 'Scoring Discrepancy (Awarded score does not match rubric level)' },
    { value: 'RUBRIC_MISINTERPRETATION', label: 'Rubric Misinterpretation (Requirement was misapplied)' },
    { value: 'TECHNICAL_MALFUNCTION', label: 'Technical Issue (Execution/rendering failure during review)' },
    { value: 'OTHER', label: 'Other Evaluation Discrepancy' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCriterionId) {
      toastError('Criterion Required', 'Please select a specific criterion to appeal.');
      return;
    }

    if (!explanation.trim() || explanation.trim().length < 10) {
      toastError('Explanation Required', 'Please provide a detailed factual explanation (minimum 10 characters).');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedCritObj =
        releasedCriteria.find((c) => c.criterionId === selectedCriterionId) ||
        rubricList.find((c: any) => c.id === selectedCriterionId);

      const criterionName =
        (selectedCritObj as any)?.criterionName ||
        (selectedCritObj as any)?.name ||
        (selectedCritObj as any)?.title ||
        selectedCriterionId;

      const appeal = await appealService.submitAppeal({
        submissionId: submission.id,
        referenceId: submission.referenceId,
        competitionId: submission.competitionId,
        participant: {
          participantName: submission.primaryContactName || (submission as any).submitterName || 'Anonymous Submitter',
          participantEmail: submission.primaryContactEmail || (submission as any).submitterEmail,
          teamId: submission.teamId,
          teamName: submission.teamName,
        },
        criterionId: selectedCriterionId,
        criterionName,
        reason,
        supportingExplanation: explanation.trim(),
        evidenceReferences: evidenceRef.trim() ? [evidenceRef.trim()] : [],
        managementToken,
      });

      success('Appeal Submitted', `Appeal ${appeal.id} registered for "${criterionName}".`);
      onAppealSubmitted(appeal);
      onClose();
      // Reset form
      setExplanation('');
      setEvidenceRef('');
    } catch (err: any) {
      toastError('Appeal Submission Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Raise Evaluation Appeal"
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Official appeal for <strong className="text-slate-700 dark:text-slate-200">{submission.referenceId}</strong>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              leftIcon={<Send size={13} />}
            >
              Submit Appeal
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {/* Advisory Banner */}
        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-xl flex items-start gap-2.5 text-blue-900 dark:text-blue-200">
          <ShieldAlert size={16} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-xs">Structured Appeal Process</span>
            <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
              Appeals are independently reviewed by authorized competition organizers. Please cite specific file paths,
              line numbers, or artifact pages. Appeals cannot directly overwrite official scores without auditable review.
            </p>
          </div>
        </div>

        {/* 1. Criterion Selection */}
        <div className="space-y-1">
          <label className="font-semibold text-slate-800 dark:text-slate-200 block">
            Select Rubric Criterion to Appeal *
          </label>
          <Select
            options={availableCriteria}
            value={selectedCriterionId}
            onChange={(e) => setSelectedCriterionId(e.target.value)}
            className="w-full"
          />
        </div>

        {/* 2. Reason Category */}
        <div className="space-y-1">
          <label className="font-semibold text-slate-800 dark:text-slate-200 block">
            Reason Category *
          </label>
          <Select
            options={reasonOptions}
            value={reason}
            onChange={(e) => setReason(e.target.value as AppealReason)}
            className="w-full"
          />
        </div>

        {/* 3. Supporting Explanation */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="font-semibold text-slate-800 dark:text-slate-200">
              Factual Explanation & Justification *
            </label>
            <span
              className={`text-[10px] ${
                explanation.length < 10 ? 'text-rose-500 font-semibold' : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {explanation.length} / 10 min chars
            </span>
          </div>
          <Textarea
            rows={4}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Explain why the awarded criterion score does not reflect the submitted deliverable. Be factual, concise, and refer to existing code or documentation..."
            className="text-xs"
          />
        </div>

        {/* 4. Evidence Pointer */}
        <div className="space-y-1">
          <label className="font-semibold text-slate-800 dark:text-slate-200 block">
            Specific Evidence Pointer (Optional)
          </label>
          <Input
            value={evidenceRef}
            onChange={(e) => setEvidenceRef(e.target.value)}
            placeholder="e.g. src/auth/jwt.ts#L45-L80, or presentation.pptx slide 7, or README.md section 3"
            className="text-xs"
          />
          <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
            Point the reviewers directly to the existing deliverable passage that supports your appeal.
          </span>
        </div>
      </form>
    </Modal>
  );
};
