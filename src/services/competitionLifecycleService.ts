// ─────────────────────────────────────────────
// competitionLifecycleService.ts — Competition Lifecycle State Machine
// ─────────────────────────────────────────────

import type {
  Competition,
  CompetitionStatus,
} from '../types/authAndCompetition';

export interface TransitionValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ActivationValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Explicit map of permitted lifecycle transitions.
 * Prevents illegal state jumps (e.g. DRAFT straight to PUBLISHED).
 */
const VALID_TRANSITIONS: Record<CompetitionStatus, CompetitionStatus[]> = {
  DRAFT: ['REGISTRATION_OPEN', 'ACTIVE', 'ARCHIVED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'ACTIVE', 'ARCHIVED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'ACTIVE', 'ARCHIVED'],
  ACTIVE: ['SUBMISSIONS_CLOSED', 'EVALUATION', 'ARCHIVED'],
  SUBMISSIONS_CLOSED: ['ACTIVE', 'EVALUATION', 'ARCHIVED'],
  EVALUATION: ['SUBMISSIONS_CLOSED', 'RESULTS_REVIEW', 'ARCHIVED'],
  RESULTS_REVIEW: ['EVALUATION', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['RESULTS_REVIEW', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export const competitionLifecycleService = {
  /**
   * Validates whether a state transition from `current` to `target` is mathematically allowed.
   */
  isValidTransition(current: CompetitionStatus, target: CompetitionStatus): TransitionValidationResult {
    if (current === target) {
      return { valid: true };
    }

    const allowed = VALID_TRANSITIONS[current] || [];
    if (!allowed.includes(target)) {
      return {
        valid: false,
        reason: `Illegal lifecycle transition: Cannot move competition from status "${current}" directly to "${target}". Permitted next states: [${allowed.join(', ')}].`,
      };
    }

    return { valid: true };
  },

  /**
   * Returns list of valid next statuses for a given status.
   */
  getAllowedTransitions(current: CompetitionStatus): CompetitionStatus[] {
    return VALID_TRANSITIONS[current] || [];
  },

  /**
   * Comprehensive validation before a competition can be transitioned from DRAFT to ACTIVE.
   * Ensures essential parameters, deadlines, and rubrics are verified.
   */
  validateForActivation(competition: Competition): ActivationValidationResult {
    const errors: string[] = [];

    if (!competition.title || !competition.title.trim()) {
      errors.push('Competition must have a valid title.');
    }

    if (!competition.organizationId) {
      errors.push('Competition must belong to a valid organization.');
    }

    if (!competition.startDate) {
      errors.push('Competition must have a specified start date.');
    }

    if (!competition.endDate) {
      errors.push('Competition must have a specified end date.');
    }

    if (competition.startDate && competition.endDate) {
      const start = new Date(competition.startDate).getTime();
      const end = new Date(competition.endDate).getTime();
      if (start > end) {
        errors.push('Competition start date cannot be after end date.');
      }
    }

    if (!competition.policies.submissionDeadline) {
      errors.push('Competition must have a specified submission deadline.');
    }

    // Rubric validation
    if (!competition.rubric || competition.rubric.length === 0) {
      errors.push('Competition must have at least one evaluation rubric criterion.');
    } else {
      let totalWeight = 0;
      for (const criterion of competition.rubric) {
        if (!criterion.name || !criterion.name.trim()) {
          errors.push('All rubric criteria must have a name.');
        }
        if (criterion.maxScore <= 0) {
          errors.push(`Rubric criterion "${criterion.name}" max score must be greater than 0.`);
        }
        totalWeight += criterion.weight;
      }

      if (Math.abs(totalWeight - 100) > 0.01) {
        errors.push(`Sum of rubric criteria weights must equal 100%. Current sum: ${totalWeight}%.`);
      }
    }

    // Team submission policy validation
    if (competition.policies.teamSubmissionsEnabled) {
      if (competition.policies.minTeamMembers < 1) {
        errors.push('Minimum team members must be at least 1.');
      }
      if (competition.policies.maxTeamMembers < competition.policies.minTeamMembers) {
        errors.push('Maximum team members cannot be less than minimum team members.');
      }
    } else if (!competition.policies.individualSubmissionsAllowed) {
      errors.push('Competition must allow either team submissions, individual submissions, or both.');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Checks whether participant registration is permitted for this competition.
   */
  canRegister(competition: Competition, now: Date = new Date()): { allowed: boolean; reason?: string } {
    if (competition.status !== 'REGISTRATION_OPEN' && competition.status !== 'ACTIVE') {
      return {
        allowed: false,
        reason: `Registration is not open. Competition status is "${competition.status}".`,
      };
    }

    if (competition.policies.registrationDeadline) {
      const regDeadline = new Date(competition.policies.registrationDeadline).getTime();
      if (now.getTime() > regDeadline) {
        return {
          allowed: false,
          reason: `Registration deadline passed on ${new Date(regDeadline).toISOString()}.`,
        };
      }
    }

    return { allowed: true };
  },

  /**
   * Checks whether submissions are currently accepted based on competition status and deadline.
   */
  canAcceptSubmissions(competition: Competition, now: Date = new Date()): { accepted: boolean; reason?: string } {
    if (competition.status !== 'ACTIVE') {
      return {
        accepted: false,
        reason: `Submissions are closed. Competition status is "${competition.status}".`,
      };
    }

    const deadline = new Date(competition.policies.submissionDeadline).getTime();
    const currentTime = now.getTime();

    if (currentTime > deadline) {
      if (!competition.policies.allowLateSubmissions) {
        return {
          accepted: false,
          reason: `Submissions are closed for this competition. Submission deadline passed on ${new Date(deadline).toISOString()}. Late submissions are not accepted.`,
        };
      }

      if (competition.policies.lateSubmissionDeadline) {
        const lateDeadline = new Date(competition.policies.lateSubmissionDeadline).getTime();
        if (currentTime > lateDeadline) {
          return {
            accepted: false,
            reason: `Late submission grace period expired on ${new Date(lateDeadline).toISOString()}. Late submissions are no longer accepted.`,
          };
        }
      }
    }

    return { accepted: true };
  },

  /**
   * Checks whether a participant can edit their existing submission.
   */
  canEditSubmission(competition: Competition, now: Date = new Date()): { allowed: boolean; reason?: string } {
    if (!competition.policies.allowSubmissionEdits) {
      return {
        allowed: false,
        reason: 'The organizer has locked submission editing for this competition.',
      };
    }

    if (competition.status === 'EVALUATION' || competition.status === 'RESULTS_REVIEW' || competition.status === 'PUBLISHED') {
      return {
        allowed: false,
        reason: `Submissions cannot be modified during "${competition.status}" phase.`,
      };
    }

    const acceptance = this.canAcceptSubmissions(competition, now);
    return {
      allowed: acceptance.accepted,
      reason: acceptance.reason,
    };
  },
};
