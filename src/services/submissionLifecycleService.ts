// ─────────────────────────────────────────────
// submissionLifecycleService.ts — Status Transitions & AI Evaluation Gate
// Proofly — Phase 5
// ─────────────────────────────────────────────

import type { ProjectSubmission, SubmissionStatus, AiFailureOverride } from '../types/submission';
import { governanceAuditService } from './governanceAuditService';

export interface TransitionResult {
  valid: boolean;
  error?: string;
  updatedSubmission?: ProjectSubmission;
}

export class SubmissionLifecycleService {
  /**
   * The legal transitions graph for submission status.
   */
  private readonly allowedTransitions: Record<SubmissionStatus, SubmissionStatus[]> = {
    Draft: ['Draft', 'Submitted'],
    Submitted: ['Validating', 'Draft'],
    Validating: ['Queued for AI Evaluation', 'Draft', 'Submitted'],
    'Queued for AI Evaluation': ['AI Evaluation In Progress', 'Validating'],
    'AI Evaluation In Progress': ['AI Evaluation Complete', 'AI Evaluation Failed'],
    'AI Evaluation Complete': ['Ready for Judge Review'],
    'AI Evaluation Failed': ['Ready for Judge Review', 'Queued for AI Evaluation'], // Only to Ready if override present!
    'Ready for Judge Review': ['Under Human Review', 'Evaluated'],
    'Under Human Review': ['Evaluated', 'Ready for Judge Review'],
    Evaluated: ['Finalized', 'Under Human Review', 'Evaluated'],
    Finalized: ['Evaluated'], // Organizer can reopen if dispute
  };

  /**
   * Checks whether a judge is permitted to access a submission's normal review workspace.
   *
   * MANDATE: The judge must NOT access a submission's normal review workspace
   * before its AI evaluation is complete, unless an authorized organizer uses
   * a documented AI-failure override.
   */
  public canJudgeReviewSubmission(submission: ProjectSubmission): { allowed: boolean; reason?: string } {
    // If an authorized organizer provided a documented AI-failure override, allow judge access
    if (submission.aiFailureOverride) {
      return { allowed: true };
    }

    // Normal review requires AI evaluation to have completed
    const allowedJudgeStatuses: SubmissionStatus[] = [
      'Ready for Judge Review',
      'Under Human Review',
      'Evaluated',
      'Finalized',
    ];

    if (allowedJudgeStatuses.includes(submission.status)) {
      return { allowed: true };
    }

    if (submission.status === 'AI Evaluation Failed') {
      return {
        allowed: false,
        reason:
          'Automated AI Evaluation failed. Normal judge review is blocked until an organizer reviews the failure or applies an authorized AI-failure override.',
      };
    }

    return {
      allowed: false,
      reason: `Submission is currently in "${submission.status}". Judge review requires automated AI pre-evaluation to complete first.`,
    };
  }

  /**
   * Applies an authorized organizer AI-failure override, unlocking the submission
   * for human judge review when the AI evaluation pipeline fails or is unavailable.
   */
  public applyAiFailureOverride(
    submission: ProjectSubmission,
    override: {
      organizerUserId: string;
      organizerName: string;
      reason: string;
      justificationNotes?: string;
    }
  ): ProjectSubmission {
    if (submission.status !== 'AI Evaluation Failed' && submission.status !== 'Queued for AI Evaluation') {
      throw new Error(
        `AI Failure Override can only be applied to failed or stalled evaluations (current status: "${submission.status}").`
      );
    }

    if (!override.reason || override.reason.trim().length < 5) {
      throw new Error('A documented justification reason (minimum 5 characters) is required for an AI-failure override.');
    }

    const aiFailureOverride: AiFailureOverride = {
      overriddenBy: override.organizerUserId,
      overriddenByName: override.organizerName,
      overriddenAt: new Date().toISOString(),
      reason: override.reason.trim(),
      justificationNotes: override.justificationNotes?.trim(),
    };

    const updated = {
      ...submission,
      aiFailureOverride,
      status: 'Ready for Judge Review' as SubmissionStatus,
      statusHistory: [
        ...submission.statusHistory,
        {
          status: 'Ready for Judge Review' as SubmissionStatus,
          changedAt: new Date().toISOString(),
          changedBy: override.organizerUserId,
          note: `Organizer AI-Failure Override applied: ${override.reason}`,
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    governanceAuditService.recordEvent({
      competitionId: submission.competitionId,
      category: 'ADMIN_OVERRIDE',
      action: 'AI_FAILURE_OVERRIDE_APPLIED',
      actorId: override.organizerUserId,
      actorName: override.organizerName,
      actorRole: 'ORGANIZER',
      targetId: submission.id,
      targetLabel: submission.referenceId || submission.projectTitle,
      reason: override.reason.trim(),
      metadata: {
        previousStatus: submission.status,
        newStatus: 'Ready for Judge Review',
        justificationNotes: override.justificationNotes?.trim(),
      },
    });

    return updated;
  }

  /**
   * Validates and executes a state transition.
   */
  public transitionStatus(
    submission: ProjectSubmission,
    targetStatus: SubmissionStatus,
    actor: { id: string; role?: string },
    note?: string
  ): TransitionResult {
    // Check if target is in allowed transitions
    const legalTargets = this.allowedTransitions[submission.status] || [];
    if (!legalTargets.includes(targetStatus)) {
      return {
        valid: false,
        error: `Illegal state transition from "${submission.status}" to "${targetStatus}". Legal targets: ${legalTargets.join(', ') || 'none'}.`,
      };
    }

    // Guard: Moving from AI Evaluation Failed to Ready for Judge Review requires override
    if (
      submission.status === 'AI Evaluation Failed' &&
      targetStatus === 'Ready for Judge Review' &&
      !submission.aiFailureOverride
    ) {
      return {
        valid: false,
        error: `Cannot transition failed AI evaluation to "Ready for Judge Review" without a documented organizer AI-failure override.`,
      };
    }

    const now = new Date().toISOString();
    const updated: ProjectSubmission = {
      ...submission,
      status: targetStatus,
      statusHistory: [
        ...submission.statusHistory,
        {
          status: targetStatus,
          changedAt: now,
          changedBy: actor.id,
          note,
        },
      ],
      updatedAt: now,
    };

    return {
      valid: true,
      updatedSubmission: updated,
    };
  }
}

export const submissionLifecycleService = new SubmissionLifecycleService();
