// ─────────────────────────────────────────────
// submissionService.ts — Anonymous Participant Submission Engine
// Proofly — Phase 5
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  startAfter,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { generateSecureToken, sha256Hash, timingSafeEqualStrings } from '../utils/cryptoUtils';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginatedResult,
  type PaginationOptions,
} from './firestorePersistenceService';
import { formValidationService } from './formValidationService';
import { formBuilderService } from './formBuilderService';
import { accessManagementService } from './accessManagementService';
import { participantTeamService } from './participantTeamService';
import { submissionLifecycleService } from './submissionLifecycleService';
import { competitionLifecycleService } from './competitionLifecycleService';
import { competitionService } from './competitionService';
import { evaluationQueueService } from './evaluationQueueService';
import type { SubmissionFormSchema } from '../types/formAndAccess';
import type {
  ProjectSubmission,
  SubmissionCreationPayload,
  SubmissionCreationResult,
  SubmissionVersion,
  SubmissionStatus,
  StoredFileMetadata,
} from '../types/submission';
import type { Competition } from '../types/authAndCompetition';

export class SubmissionService {
  // Unit-test-only in-memory store (unused whenever Firestore is active)
  private memSubmissions: Map<string, ProjectSubmission> = new Map();
  private submissionReservationCounts: Map<string, number> = new Map();

  /**
   * Generates a readable reference ID, e.g. "PF-SUB-2026-K9X2"
   */
  public generateReferenceId(): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `PF-SUB-2026-${code}`;
  }

  /**
   * Intelligently maps standard submission payload attributes to schema fields without fabricating dummy content.
   */
  private mapPayloadToSchemaFields(
    schema: SubmissionFormSchema,
    payload: Partial<SubmissionCreationPayload>,
    competition: Competition
  ): Record<string, any> {
    const values: Record<string, any> = { ...(payload.fieldValues || {}) };

    for (const field of schema.fields) {
      const idLower = field.id.toLowerCase();
      const labelLower = field.label.toLowerCase();

      // Check if this field corresponds to explicitly updated core properties
      const isTitleField = idLower.includes('title') || labelLower.includes('title');
      const isDescField =
        idLower.includes('desc') ||
        labelLower.includes('description') ||
        labelLower.includes('overview');
      const isGithubField =
        idLower.includes('git') ||
        labelLower.includes('github') ||
        field.type === 'GITHUB_URL';

      if (isTitleField && payload.projectTitle !== undefined) {
        values[field.id] = payload.projectTitle;
        continue;
      }
      if (isDescField) {
        const descParts = [
          payload.projectDescription,
          payload.problemStatement ? `Problem: ${payload.problemStatement}` : '',
          payload.solution ? `Solution: ${payload.solution}` : '',
        ].filter(Boolean);
        if (descParts.length > 0) {
          values[field.id] = descParts.join('\n\n');
          continue;
        }
      }
      if (isGithubField && payload.githubUrl !== undefined) {
        values[field.id] = payload.githubUrl;
        continue;
      }

      if (values[field.id] !== undefined && values[field.id] !== null && values[field.id] !== '') {
        continue;
      }

      // Title
      if (idLower.includes('title') || labelLower.includes('title')) {
        if (payload.projectTitle !== undefined) {
          values[field.id] = payload.projectTitle;
        }
      }
      // Tagline / Elevator Pitch
      else if (idLower.includes('tagline') || labelLower.includes('tagline') || labelLower.includes('elevator')) {
        const candidate = payload.fieldValues?.[field.id] || payload.problemStatement || payload.projectDescription;
        if (candidate) {
          values[field.id] = candidate.length > 140 ? candidate.substring(0, 137) + '...' : candidate;
        }
      }
      // Track
      else if (idLower.includes('track') || labelLower.includes('track') || labelLower.includes('category')) {
        const options = field.validation?.options || [];
        const matchingTrack = payload.track || competition?.tracks?.find((t) => options.includes(t));
        values[field.id] = payload.track || matchingTrack || (competition?.tracks?.[0] || (competition?.isOpenTrackEnabled !== false ? 'Open Track' : undefined));
      }
      // Description / Solution overview / Problem Statement
      else if (
        idLower.includes('desc') ||
        labelLower.includes('description') ||
        labelLower.includes('overview') ||
        idLower.includes('solution') ||
        labelLower.includes('solution')
      ) {
        const descParts = [
          payload.projectDescription,
          payload.problemStatement ? `Problem: ${payload.problemStatement}` : '',
          payload.solution ? `Solution: ${payload.solution}` : '',
        ].filter(Boolean);
        if (descParts.length > 0) {
          values[field.id] = descParts.join('\n\n');
        }
      }
      // Pitch Deck / File Upload
      else if (field.type === 'FILE_UPLOAD' || field.type === 'MULTIPLE_FILE_UPLOAD') {
        const matchingFiles = (payload.files || []).filter((f) => f.fieldId === field.id || !f.fieldId);
        if (matchingFiles.length > 0) {
          values[field.id] = field.type === 'FILE_UPLOAD' ? matchingFiles[0] : matchingFiles;
        }
      }
      // GitHub URL
      else if (
        idLower.includes('git') ||
        labelLower.includes('github') ||
        field.type === 'GITHUB_URL'
      ) {
        if (payload.githubUrl !== undefined) {
          values[field.id] = payload.githubUrl;
        }
      }
      // Demo URL
      else if (
        idLower.includes('demo') &&
        (field.type === 'URL' || labelLower.includes('deployed') || labelLower.includes('live'))
      ) {
        if (payload.deploymentUrl !== undefined) {
          values[field.id] = payload.deploymentUrl;
        }
      }
      // Video
      else if (idLower.includes('video') || labelLower.includes('video') || field.type === 'VIDEO_URL') {
        if (payload.videoUrl !== undefined) {
          values[field.id] = payload.videoUrl;
        }
      }
      // Team Members Repeater
      else if (idLower.includes('team') || labelLower.includes('team') || field.type === 'TEAM_MEMBER_REPEATER') {
        const validParticipants = (payload.participants || []).filter(
          (p) => p && p.name && p.name.trim().length > 0
        );
        if (validParticipants.length > 0) {
          values[field.id] = validParticipants.map((p) => ({
            fullName: p.name.trim(),
            email: p.email?.trim() || payload.primaryContactEmail?.trim() || '',
            role: p.role?.trim() || (p.isLead ? 'Team Lead' : 'Member'),
            githubUsername: p.githubUsername?.trim(),
          }));
        } else if (payload.primaryContactName) {
          values[field.id] = [
            {
              fullName: payload.primaryContactName.trim(),
              email: payload.primaryContactEmail?.trim() || '',
              role: 'Solo Creator',
              githubUsername: undefined,
            },
          ];
        }
      }
      // Checkbox (Pledge/Terms)
      else if (field.type === 'CHECKBOX') {
        values[field.id] = payload.fieldValues?.[field.id] ?? true;
      }
    }

    return values;
  }

  /**
   * Creates a new participant submission.
   * Participants do NOT need an account.
   * Cryptographic management token is generated and returned ONCE.
   * ONLY the SHA-256 hash of the token is saved in the database.
   */
  public async createSubmission(
    payload: SubmissionCreationPayload,
    mockCompetition?: Competition
  ): Promise<SubmissionCreationResult> {
    const {
      competitionId,
      sessionToken,
      submissionType,
      teamName,
      primaryContactName,
      primaryContactEmail,
      participants,
      projectTitle,
      projectDescription,
      track,
      problemStatement,
      solution,
      technologiesUsed = [],
      githubUrl,
      deploymentUrl,
      videoUrl,
      files = [],
      isDraft = false,
    } = payload;

    // 1. Fetch competition
    let competition = mockCompetition;
    if (!competition) {
      competition = (await competitionService.getCompetition(competitionId)) || undefined;
    }
    if (!competition) {
      throw new Error(`Competition "${competitionId}" not found.`);
    }

    // 2. Validate session token
    const sessionValidation = await accessManagementService.validateSessionToken(sessionToken);
    if (!sessionValidation.valid || !sessionValidation.session) {
      throw new Error(sessionValidation.error || 'Invalid or expired submission session.');
    }

    if (sessionValidation.session.competitionId !== competitionId) {
      throw new Error('Session token does not match target competition.');
    }

    // 3. Check competition status & deadline via state machine
    const now = new Date();
    const acceptance = competitionLifecycleService.canAcceptSubmissions(competition, now);
    if (!acceptance.accepted) {
      throw new Error(acceptance.reason);
    }

    const deadline = new Date(competition.policies.submissionDeadline);
    const isLate = now.getTime() > deadline.getTime();

    // 4. Validate team vs individual policies & team size caps
    if (submissionType === 'INDIVIDUAL') {
      if (!competition.policies.individualSubmissionsAllowed && competition.participationType === 'TEAM') {
        throw new Error('Individual submissions are not allowed for this competition. Team submission required.');
      }
      const memberCount = (participants && participants.length > 0) ? participants.length : 1;
      if (memberCount > 1) {
        throw new Error('Individual submissions cannot have multiple team members.');
      }
    } else if (submissionType === 'TEAM') {
      if (!competition.policies.teamSubmissionsEnabled && competition.participationType === 'INDIVIDUAL') {
        throw new Error('Team submissions are not allowed for this competition. Individual submission required.');
      }
      if (!teamName || !teamName.trim()) {
        throw new Error('Team name is required for team submissions.');
      }
      const memberCount = (participants && participants.length > 0) ? participants.length : (primaryContactName ? 1 : 0);
      if (competition.policies.minTeamMembers && memberCount < competition.policies.minTeamMembers) {
        throw new Error(`Team must have at least ${competition.policies.minTeamMembers} member(s). Current count: ${memberCount}.`);
      }
      if (competition.policies.maxTeamMembers && memberCount > competition.policies.maxTeamMembers) {
        throw new Error(`Team cannot exceed ${competition.policies.maxTeamMembers} member(s). Current count: ${memberCount}.`);
      }
    }

    // 5. Atomic submission limit check (burst-safe)
    const maxSubs = competition.policies?.maxSubmissions;
    let reservedCompId: string | null = null;
    if (maxSubs !== undefined) {
      const existingInMem = Array.from(this.memSubmissions.values()).filter(
        (s) => s.competitionId === competitionId
      ).length;
      const currentReserved = this.submissionReservationCounts.get(competitionId) ?? existingInMem;
      if (currentReserved >= maxSubs) {
        throw new Error(`Maximum submission limit of ${maxSubs} reached for this competition.`);
      }
      this.submissionReservationCounts.set(competitionId, currentReserved + 1);
      reservedCompId = competitionId;
    }

    try {
      // 6. Validate form values against active schema (NO FABRICATION)
      const schema =
        (await formBuilderService.getFormSchema(competitionId)) ||
        formBuilderService.generateDefaultHackathonSchema(competitionId, competition.organizationId);

      // Merge standard fields into fieldValues for complete schema validation
      const mergedValues = this.mapPayloadToSchemaFields(schema, payload, competition);

      if (!isDraft) {
        const formValidation = formValidationService.validateFormValues(schema, mergedValues);
        if (!formValidation.valid) {
          const errorMsg = formValidation.errors.map((e) => `${e.fieldLabel}: ${e.message}`).join('; ');
          throw new Error(`Validation failed: ${errorMsg}`);
        }
      }

      // 7. Generate IDs & Cryptographic Tokens
      const submissionId = `sub_${Math.random().toString(36).substring(2, 10)}`;
      const referenceId = this.generateReferenceId();
      const rawManagementToken = `sec_${generateSecureToken(32)}`;
      const managementTokenHash = await sha256Hash(rawManagementToken);
      const managementTokenPrefix = rawManagementToken.substring(0, 6);

      // 8. Handle Team and Participant Records
      const teamResult = await participantTeamService.handleSubmissionTeamAndMembers({
        competitionId,
        organizationId: competition.organizationId,
        submissionId,
        submissionType,
        teamName,
        primaryContactName,
        primaryContactEmail,
        participants: participants || [],
      });

      // 9. Initial Status
      const initialStatus: SubmissionStatus = isDraft ? 'Draft' : 'Submitted';
      const nowIso = now.toISOString();

      const initialVersion: SubmissionVersion = {
        versionNumber: 1,
        submittedAt: nowIso,
        statusAtVersion: initialStatus,
        fieldValues: mergedValues,
        files,
        changeSummary: isDraft ? 'Initial draft saved' : 'Initial final submission',
      };

      // 10. Construct ProjectSubmission document
      let submission: ProjectSubmission = {
        id: submissionId,
        referenceId,
        competitionId,
        organizationId: competition.organizationId,
        formSchemaId: schema.id,
        accessKeyId: sessionValidation.session.keyId,
        sessionTokenId: sessionValidation.session.sessionToken,
        participantSessionId: sessionValidation.session.sessionToken,

        submissionType,
        teamId: teamResult.team?.id,
        teamName: teamResult.team?.name,
        participants: teamResult.participants,
        primaryContactName,
        primaryContactEmail,

        projectTitle,
        projectDescription,
        track: track || mergedValues.track || (competition.isOpenTrackEnabled ? 'Open Track' : competition.tracks?.[0] || 'Open Track'),
        problemStatement,
        solution,
        technologiesUsed,
        githubUrl,
        deploymentUrl,
        videoUrl,

        fieldValues: mergedValues,
        files,

        status: initialStatus,
        statusHistory: [
          {
            status: initialStatus,
            changedAt: nowIso,
            changedBy: 'participant',
            note: isDraft ? 'Draft created' : 'Project submitted by participant',
          },
        ],

        submittedAt: isDraft ? undefined : nowIso,
        isLate,
        isLocked: false,

        currentVersion: 1,
        versions: [initialVersion],

        managementTokenHash,
        managementTokenPrefix,

        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // 11. If final submit, trigger automatic transition to Validating -> Queued for AI Evaluation
      if (!isDraft) {
        const validatingStep = submissionLifecycleService.transitionStatus(
          submission,
          'Validating',
          { id: 'system' },
          'Automated file & schema integrity checks'
        );
        if (validatingStep.valid && validatingStep.updatedSubmission) {
          submission = validatingStep.updatedSubmission;
        }

        const queueStep = submissionLifecycleService.transitionStatus(
          submission,
          'Queued for AI Evaluation',
          { id: 'system' },
          'Transferred to Firebase AI Logic evaluation queue'
        );
        if (queueStep.valid && queueStep.updatedSubmission) {
          submission = queueStep.updatedSubmission;
        }

        // Enqueue job in reliable evaluation queue
        try {
          await evaluationQueueService.enqueueSubmission(
            submission.id,
            submission.competitionId,
            submission.referenceId,
            submission.organizationId
          );
        } catch {
          // preserve flow
        }
      }

      // 12. Persist submission
      await this.saveSubmission(submission, { competition });

      // Record submission count on access key
      await accessManagementService.recordSubmissionUse(sessionValidation.session.keyId);

      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
      const managementUrl = `${origin}/submit/manage?ref=${referenceId}&token=${rawManagementToken}`;

      return {
        submission,
        rawManagementToken,
        referenceId,
        managementUrl,
      };
    } catch (err) {
      if (reservedCompId) {
        const cur = this.submissionReservationCounts.get(reservedCompId);
        if (cur !== undefined && cur > 0) {
          this.submissionReservationCounts.set(reservedCompId, cur - 1);
        }
      }
      throw err;
    }
  }

  /**
   * Verifies whether a provided raw token matches the submission's stored SHA-256 hash.
   */
  public async verifyManagementToken(referenceId: string, rawToken: string): Promise<boolean> {
    const submission = await this.getSubmissionByReference(referenceId);
    if (!submission) return false;

    const providedHash = await sha256Hash(rawToken);
    return timingSafeEqualStrings(providedHash, submission.managementTokenHash);
  }

  /**
   * Updates an existing submission (editing or promoting draft to final submit).
   * Validates cryptographic management token, deadline, and edit policies.
   */
  public async updateSubmission(params: {
    referenceId: string;
    rawToken: string;
    updatedPayload: Partial<SubmissionCreationPayload>;
    newFiles?: StoredFileMetadata[];
    isFinalSubmit?: boolean;
    changeSummary?: string;
    mockCompetition?: Competition;
  }): Promise<ProjectSubmission> {
    const { referenceId, rawToken, updatedPayload, newFiles, isFinalSubmit, changeSummary, mockCompetition } = params;

    const submission = await this.getSubmissionByReference(referenceId);
    if (!submission) {
      throw new Error(`Submission "${referenceId}" not found.`);
    }

    // Verify token
    const isAuthed = await this.verifyManagementToken(referenceId, rawToken);
    if (!isAuthed) {
      throw new Error('Invalid secret management token. Access denied.');
    }

    // Fetch competition
    let competition = mockCompetition;
    if (!competition) {
      competition = (await competitionService.getCompetition(submission.competitionId)) || undefined;
    }
    if (!competition) {
      throw new Error(`Competition "${submission.competitionId}" not found.`);
    }

    // Check lock
    if (submission.isLocked) {
      throw new Error('This submission has been locked and can no longer be edited.');
    }

    // Participants cannot set backend statuses
    const requestedStatus = (updatedPayload as any).status;
    if (requestedStatus && !['Draft', 'Submitted'].includes(requestedStatus)) {
      throw new Error(
        `Unauthorized status modification: Participants cannot transition submissions to backend status "${requestedStatus}".`
      );
    }

    // Check edit policy
    if (!competition.policies.allowSubmissionEdits && submission.status !== 'Draft') {
      throw new Error('Organizers have disabled submission edits for this competition.');
    }

    // Check deadline
    const now = new Date();
    const deadline = new Date(competition.policies.submissionDeadline);
    const isPastDeadline = now.getTime() > deadline.getTime();
    let isLate = submission.isLate;

    if (isPastDeadline) {
      if (!competition.policies.allowLateSubmissions) {
        throw new Error('Deadline has passed. Edits or late submissions are not allowed.');
      }
      if (competition.policies.lateSubmissionDeadline) {
        const lateDeadline = new Date(competition.policies.lateSubmissionDeadline).getTime();
        if (now.getTime() > lateDeadline) {
          throw new Error('Late submission grace period expired. Edits or submissions are no longer allowed.');
        }
      }
      isLate = true;
    }

    // Merge updated fields
    const schema =
      (await formBuilderService.getFormSchema(submission.competitionId)) ||
      formBuilderService.generateDefaultHackathonSchema(submission.competitionId, submission.organizationId);

    const mergedPayload: Partial<SubmissionCreationPayload> = {
      submissionType: submission.submissionType,
      teamName: submission.teamName,
      primaryContactName: submission.primaryContactName,
      primaryContactEmail: submission.primaryContactEmail,
      participants: submission.participants,
      projectTitle: updatedPayload.projectTitle ?? submission.projectTitle,
      projectDescription: updatedPayload.projectDescription ?? submission.projectDescription,
      problemStatement: updatedPayload.problemStatement ?? submission.problemStatement,
      solution: updatedPayload.solution ?? submission.solution,
      technologiesUsed: updatedPayload.technologiesUsed ?? submission.technologiesUsed,
      githubUrl: updatedPayload.githubUrl ?? submission.githubUrl,
      deploymentUrl: updatedPayload.deploymentUrl ?? submission.deploymentUrl,
      videoUrl: updatedPayload.videoUrl ?? submission.videoUrl,
      fieldValues: {
        ...submission.fieldValues,
        ...(updatedPayload.fieldValues || {}),
      },
    };

    const updatedFieldValues = this.mapPayloadToSchemaFields(schema, mergedPayload, competition);

    const mergedFiles = newFiles ? [...newFiles] : [...submission.files];

    // If final submit, validate schema
    if (isFinalSubmit || (submission.status !== 'Draft' && !updatedPayload.isDraft)) {
      const validation = formValidationService.validateFormValues(schema, updatedFieldValues);
      if (!validation.valid) {
        const errorMsg = validation.errors.map((e) => `${e.fieldLabel}: ${e.message}`).join('; ');
        throw new Error(`Validation failed: ${errorMsg}`);
      }
    }

    // Versioning
    const newVersionNumber = submission.currentVersion + 1;
    const nowIso = now.toISOString();

    const targetStatus: SubmissionStatus =
      isFinalSubmit && submission.status === 'Draft'
        ? 'Submitted'
        : submission.status;

    const newVersion: SubmissionVersion = {
      versionNumber: newVersionNumber,
      submittedAt: nowIso,
      statusAtVersion: targetStatus,
      fieldValues: updatedFieldValues,
      files: mergedFiles,
      changeSummary: changeSummary || `Updated to version ${newVersionNumber}`,
    };

    let updated: ProjectSubmission = {
      ...submission,
      projectTitle: updatedPayload.projectTitle ?? submission.projectTitle,
      projectDescription: updatedPayload.projectDescription ?? submission.projectDescription,
      problemStatement: updatedPayload.problemStatement ?? submission.problemStatement,
      solution: updatedPayload.solution ?? submission.solution,
      technologiesUsed: updatedPayload.technologiesUsed ?? submission.technologiesUsed,
      githubUrl: updatedPayload.githubUrl ?? submission.githubUrl,
      deploymentUrl: updatedPayload.deploymentUrl ?? submission.deploymentUrl,
      videoUrl: updatedPayload.videoUrl ?? submission.videoUrl,
      fieldValues: updatedFieldValues,
      files: mergedFiles,
      isLate,
      currentVersion: newVersionNumber,
      versions: [...submission.versions, newVersion],
      updatedAt: nowIso,
    };

    if (isFinalSubmit && submission.status === 'Draft') {
      updated.status = 'Submitted';
      updated.submittedAt = nowIso;
      updated.statusHistory.push({
        status: 'Submitted',
        changedAt: nowIso,
        changedBy: 'participant',
        note: 'Draft promoted to final submission',
      });

      // Pipeline transition: Validating -> Queued for AI Evaluation
      const validatingStep = submissionLifecycleService.transitionStatus(
        updated,
        'Validating',
        { id: 'system' },
        'Automated file & schema integrity checks'
      );
      if (validatingStep.valid && validatingStep.updatedSubmission) {
        updated = validatingStep.updatedSubmission;
      }

      const queueStep = submissionLifecycleService.transitionStatus(
        updated,
        'Queued for AI Evaluation',
        { id: 'system' },
        'Transferred to Firebase AI Logic evaluation queue'
      );
      if (queueStep.valid && queueStep.updatedSubmission) {
        updated = queueStep.updatedSubmission;
      }

      // Enqueue job in reliable evaluation queue
      try {
        await evaluationQueueService.enqueueSubmission(
          updated.id,
          updated.competitionId,
          updated.referenceId,
          updated.organizationId
        );
      } catch {
        // preserve flow
      }
    }

    await this.saveSubmission(updated);
    return updated;
  }

  /**
   * Fetches a submission by reference ID (e.g. "PF-SUB-2026-X9K2L").
   */
  public async getSubmissionByReference(
    referenceId: string,
    options?: FirestoreExecutionOptions
  ): Promise<ProjectSubmission | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(
          collection(fs, 'submissions'),
          where('referenceId', '==', referenceId),
          limit(1)
        );
        const snaps = await getDocs(q);
        return snaps.empty ? null : (snaps.docs[0].data() as ProjectSubmission);
      } catch (err) {
        throw mapFirestoreError(err, 'getSubmissionByReference', 'submissions');
      }
    }

    for (const sub of this.memSubmissions.values()) {
      if (sub.referenceId === referenceId) return sub;
    }
    return null;
  }

  /**
   * Fetches a submission by its internal database ID.
   */
  public async getSubmission(
    submissionId: string,
    options?: FirestoreExecutionOptions
  ): Promise<ProjectSubmission | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'submissions', submissionId));
        return snap.exists() ? (snap.data() as ProjectSubmission) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getSubmission', 'submissions');
      }
    }

    return this.memSubmissions.get(submissionId) || null;
  }

  /**
   * Paginated listing of submissions across competitions (bounded via limit()).
   */
  public async listAllSubmissionsPaginated(
    options?: { status?: SubmissionStatus } & PaginationOptions
  ): Promise<PaginatedResult<ProjectSubmission>> {
    const pageSize = clampPageSize(options?.pageSize);
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const constraints: QueryConstraint[] = [];
        if (options?.status) {
          constraints.push(where('status', '==', options.status));
        }
        constraints.push(limit(pageSize + 1));
        if (options?.cursor) {
          constraints.push(startAfter(options.cursor));
        }
        const snaps = await getDocs(query(collection(fs, 'submissions'), ...constraints));
        const hasMore = snaps.docs.length > pageSize;
        const pageDocs = hasMore ? snaps.docs.slice(0, pageSize) : snaps.docs;
        const items = pageDocs
          .map((d) => d.data() as ProjectSubmission)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return {
          items,
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listAllSubmissionsPaginated', 'submissions');
      }
    }

    const list: ProjectSubmission[] = [];
    for (const sub of this.memSubmissions.values()) {
      if (!options?.status || sub.status === options.status) {
        list.push(sub);
      }
    }
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      items: list.slice(0, pageSize),
      hasMore: list.length > pageSize,
      nextCursor: null,
      pageSize,
    };
  }

  public async listAllSubmissions(
    options?: { status?: SubmissionStatus } & PaginationOptions
  ): Promise<ProjectSubmission[]> {
    const page = await this.listAllSubmissionsPaginated(options);
    return page.items;
  }

  public async listSubmissions(
    competitionId: string,
    options?: { status?: SubmissionStatus } & PaginationOptions
  ): Promise<ProjectSubmission[]> {
    return this.listCompetitionSubmissions(competitionId, options);
  }

  public async listCompetitionSubmissionsPaginated(
    competitionId: string,
    options?: { status?: SubmissionStatus } & PaginationOptions
  ): Promise<PaginatedResult<ProjectSubmission>> {
    const pageSize = clampPageSize(options?.pageSize);
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const constraints: QueryConstraint[] = [where('competitionId', '==', competitionId)];
        if (options?.status) {
          constraints.push(where('status', '==', options.status));
        }
        constraints.push(limit(pageSize + 1));
        if (options?.cursor) {
          constraints.push(startAfter(options.cursor));
        }
        const snaps = await getDocs(query(collection(fs, 'submissions'), ...constraints));
        const hasMore = snaps.docs.length > pageSize;
        const pageDocs = hasMore ? snaps.docs.slice(0, pageSize) : snaps.docs;
        return {
          items: pageDocs.map((d) => d.data() as ProjectSubmission),
          hasMore,
          nextCursor: hasMore ? pageDocs[pageDocs.length - 1] : null,
          pageSize,
        };
      } catch (err) {
        throw mapFirestoreError(err, 'listCompetitionSubmissionsPaginated', 'submissions');
      }
    }

    const list: ProjectSubmission[] = [];
    for (const sub of this.memSubmissions.values()) {
      if (sub.competitionId === competitionId) {
        if (!options?.status || sub.status === options.status) {
          list.push(sub);
        }
      }
    }
    return {
      items: list.slice(0, pageSize),
      hasMore: list.length > pageSize,
      nextCursor: null,
      pageSize,
    };
  }

  public async listCompetitionSubmissions(
    competitionId: string,
    options?: { status?: SubmissionStatus } & PaginationOptions
  ): Promise<ProjectSubmission[]> {
    const page = await this.listCompetitionSubmissionsPaginated(competitionId, options);
    return page.items;
  }

  /**
   * Locks a submission from any further participant edits.
   */
  public async lockSubmission(
    submissionId: string,
    organizerUserId: string,
    options?: FirestoreExecutionOptions
  ): Promise<ProjectSubmission> {
    const sub = await this.getSubmission(submissionId, options);
    if (!sub) throw new Error(`Submission "${submissionId}" not found.`);

    const updated: ProjectSubmission = {
      ...sub,
      isLocked: true,
      updatedAt: new Date().toISOString(),
      statusHistory: [
        ...sub.statusHistory,
        {
          status: sub.status,
          changedAt: new Date().toISOString(),
          changedBy: organizerUserId,
          note: 'Submission locked by organizer.',
        },
      ],
    };

    await this.saveSubmission(updated, options);
    return updated;
  }

  /**
   * Persists a submission durably to Firestore (throws PersistenceError on failure; zero silent fallback).
   */
  public async saveSubmission(
    submission: ProjectSubmission,
    options?: FirestoreExecutionOptions & { competition?: Competition }
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const compId = submission.competitionId;
        const comp = options?.competition;
        if (comp?.policies?.maxSubmissions !== undefined) {
          await runTransaction(fs, async (transaction) => {
            const compRef = doc(fs, 'competitions', compId);
            const compSnap = await transaction.get(compRef);
            if (!compSnap.exists()) {
              throw new Error(`Competition "${compId}" not found.`);
            }
            const compData = compSnap.data() as Competition;
            const currentCount = compData.submissionCount || 0;
            const maxSubs = compData.policies?.maxSubmissions;
            if (maxSubs !== undefined && currentCount >= maxSubs) {
              throw new Error(`Maximum submission limit of ${maxSubs} reached for this competition.`);
            }

            const subRef = doc(fs, 'submissions', submission.id);
            transaction.set(subRef, withServerTimestamps(sanitizeFirestoreData(submission), true));
            transaction.update(compRef, {
              submissionCount: currentCount + 1,
              updatedAt: new Date().toISOString(),
            });
          });
          return;
        }

        await setDoc(
          doc(fs, 'submissions', submission.id),
          withServerTimestamps(sanitizeFirestoreData(submission), true)
        );
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'saveSubmission', 'submissions');
      }
    }

    this.memSubmissions.set(submission.id, submission);
    if (options?.competition) {
      options.competition.submissionCount = (options.competition.submissionCount || 0) + 1;
    }
  }

  public clearMemoryStore(): void {
    this.memSubmissions.clear();
    this.submissionReservationCounts.clear();
  }

  public resetInMemoryStore(seedList: ProjectSubmission[] = []): void {
    this.memSubmissions.clear();
    this.submissionReservationCounts.clear();
    for (const sub of seedList) {
      this.memSubmissions.set(sub.id, sub);
    }
  }
}

export const submissionService = new SubmissionService();
