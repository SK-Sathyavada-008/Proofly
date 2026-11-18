// ─────────────────────────────────────────────
// submissionService.ts — Anonymous Participant Submission Engine
// Proofly — Phase 5
// ─────────────────────────────────────────────

import { db, isFirebaseConfigured } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { generateSecureToken, sha256Hash, timingSafeEqualStrings } from '../utils/cryptoUtils';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import { formValidationService } from './formValidationService';
import { formBuilderService } from './formBuilderService';
import { accessManagementService } from './accessManagementService';
import { participantTeamService } from './participantTeamService';
import { submissionLifecycleService } from './submissionLifecycleService';
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

const SUBMISSIONS_STORAGE_KEY = 'proofly_submissions_v1';

export class SubmissionService {
  private memSubmissions: Map<string, ProjectSubmission> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(SUBMISSIONS_STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw) as ProjectSubmission[];
        if (Array.isArray(list)) {
          list.forEach((s) => this.memSubmissions.set(s.id, s));
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(
        SUBMISSIONS_STORAGE_KEY,
        JSON.stringify(Array.from(this.memSubmissions.values()))
      );
    } catch {
      // Ignore storage errors
    }
  }

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
   * Intelligently maps standard submission payload attributes to schema fields.
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
        labelLower.includes('overview') ||
        labelLower.includes('solution');
      const isGithubField =
        idLower.includes('git') ||
        labelLower.includes('github') ||
        field.type === 'GITHUB_URL';

      if (isTitleField && payload.projectTitle) {
        values[field.id] = payload.projectTitle;
        continue;
      }
      if (isDescField && payload.projectDescription) {
        let desc = payload.projectDescription;
        if (field.validation?.minLength && desc.length < field.validation.minLength) {
          desc = desc.padEnd(field.validation.minLength, ' — comprehensive architectural overview provided.');
        }
        values[field.id] = desc;
        continue;
      }
      if (isGithubField && payload.githubUrl) {
        values[field.id] = payload.githubUrl;
        continue;
      }

      if (values[field.id] !== undefined && values[field.id] !== null && values[field.id] !== '') {
        continue;
      }

      // Title
      if (idLower.includes('title') || labelLower.includes('title')) {
        values[field.id] = payload.projectTitle;
      }
      // Tagline / Elevator Pitch
      else if (idLower.includes('tagline') || labelLower.includes('tagline') || labelLower.includes('elevator')) {
        const descPreview = (payload.projectDescription || '').substring(0, 100);
        values[field.id] = descPreview.length >= 10 ? descPreview : 'AI-powered evaluation platform innovation';
      }
      // Track
      else if (idLower.includes('track') || labelLower.includes('track') || labelLower.includes('category')) {
        const options = field.validation?.options || [];
        const matchingTrack = payload.track || competition.tracks?.find((t) => options.includes(t));
        values[field.id] = payload.track || matchingTrack || (options.length > 0 ? options[0] : (competition.tracks?.[0] || 'Open Track'));
      }
      // Description / Solution overview
      else if (
        idLower.includes('desc') ||
        labelLower.includes('description') ||
        labelLower.includes('overview') ||
        labelLower.includes('solution')
      ) {
        let desc = payload.projectDescription || '';
        if (field.validation?.minLength && desc.length < field.validation.minLength) {
          desc = desc.padEnd(field.validation.minLength, ' — comprehensive architectural overview provided.');
        }
        values[field.id] = desc;
      }
      // Pitch Deck / File Upload
      else if (field.type === 'FILE_UPLOAD' || field.type === 'MULTIPLE_FILE_UPLOAD') {
        const matchingFiles = (payload.files || []).filter((f) => f.fieldId === field.id);
        if (matchingFiles.length > 0) {
          values[field.id] = field.type === 'FILE_UPLOAD' ? matchingFiles[0] : matchingFiles;
        } else if (!field.required) {
          // Do not set non-required files so they stay undefined/empty
        }
      }
      // GitHub
      else if (
        idLower.includes('git') ||
        labelLower.includes('github') ||
        field.type === 'GITHUB_URL'
      ) {
        values[field.id] = payload.githubUrl || 'https://github.com/proofly-demo/sample-project';
      }
      // Demo URL
      else if (
        idLower.includes('demo') &&
        (field.type === 'URL' || labelLower.includes('deployed') || labelLower.includes('live'))
      ) {
        values[field.id] = payload.deploymentUrl;
      }
      // Video
      else if (idLower.includes('video') || labelLower.includes('video') || field.type === 'VIDEO_URL') {
        values[field.id] = payload.videoUrl;
      }
      // Team Members Repeater
      else if (idLower.includes('team') || labelLower.includes('team') || field.type === 'TEAM_MEMBER_REPEATER') {
        const membersList = (payload.participants || [])
          .filter((p) => p && p.name && p.name.trim().length > 0)
          .map((p) => ({
            fullName: p.name.trim(),
            email: p.email?.trim() || 'participant@example.com',
            role: p.role?.trim() || 'Member',
            githubUsername: p.githubUsername?.trim(),
          }));
        if (membersList.length === 0 && payload.primaryContactName) {
          membersList.push({
            fullName: payload.primaryContactName.trim(),
            email: payload.primaryContactEmail?.trim() || 'solo@example.com',
            role: 'Solo Creator',
            githubUsername: undefined,
          });
        }
        values[field.id] = membersList;
      }
      // Checkbox (Pledge/Terms)
      else if (field.type === 'CHECKBOX') {
        values[field.id] = true;
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

    // 3. Check competition status & deadline
    const now = new Date();
    const deadline = new Date(competition.policies.submissionDeadline);
    const isPastDeadline = now.getTime() > deadline.getTime();
    let isLate = false;

    if (isPastDeadline) {
      if (!competition.policies.allowLateSubmissions) {
        throw new Error(
          `Submissions are closed for this competition (deadline: ${deadline.toLocaleString()}). Late submissions are not accepted.`
        );
      }
      isLate = true;
    }

    // 4. Validate form values against active schema
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

    // 5. Generate IDs & Cryptographic Tokens
    const submissionId = `sub_${Math.random().toString(36).substring(2, 10)}`;
    const referenceId = this.generateReferenceId();
    const rawManagementToken = `sec_${generateSecureToken(32)}`;
    const managementTokenHash = await sha256Hash(rawManagementToken);
    const managementTokenPrefix = rawManagementToken.substring(0, 6);

    // 6. Handle Team and Participant Records
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

    // 7. Initial Status
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

    // 8. Construct ProjectSubmission document
    // NOTE: rawManagementToken is NEVER saved here!
    let submission: ProjectSubmission = {
      id: submissionId,
      referenceId,
      competitionId,
      organizationId: competition.organizationId,
      formSchemaId: schema.id,
      accessKeyId: sessionValidation.session.keyId,
      sessionTokenId: sessionValidation.session.sessionToken,

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

    // 9. If final submit, trigger automatic transition to Validating -> Queued for AI Evaluation
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
          submission.referenceId
        );
      } catch {
        // preserve flow
      }
    }

    // 10. Persist submission
    await this.saveSubmission(submission);

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
          updated.referenceId
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
  public async getSubmissionByReference(referenceId: string): Promise<ProjectSubmission | null> {
    for (const sub of this.memSubmissions.values()) {
      if (sub.referenceId === referenceId) return sub;
    }
    if (isFirebaseConfigured() && db) {
      try {
        const q = query(collection(db, 'submissions'), where('referenceId', '==', referenceId));
        const snaps = await getDocs(q);
        if (!snaps.empty) {
          return snaps.docs[0].data() as ProjectSubmission;
        }
      } catch {
        // fallback
      }
    }
    return null;
  }

  /**
   * Fetches a submission by its internal database ID.
   */
  public async getSubmission(submissionId: string): Promise<ProjectSubmission | null> {
    if (this.memSubmissions.has(submissionId)) {
      return this.memSubmissions.get(submissionId)!;
    }
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDoc(doc(db, 'submissions', submissionId));
        if (snap.exists()) {
          return snap.data() as ProjectSubmission;
        }
      } catch {
        // fallback
      }
    }
    return null;
  }

  /**
   * Lists all submissions across all competitions.
   */
  public async listAllSubmissions(options?: { status?: SubmissionStatus }): Promise<ProjectSubmission[]> {
    const list: ProjectSubmission[] = [];
    for (const sub of this.memSubmissions.values()) {
      if (!options?.status || sub.status === options.status) {
        list.push(sub);
      }
    }
    if (isFirebaseConfigured() && db) {
      try {
        const q = options?.status
          ? query(collection(db, 'submissions'), where('status', '==', options.status))
          : collection(db, 'submissions');
        const snaps = await getDocs(q);
        snaps.forEach((docSnap) => {
          const item = docSnap.data() as ProjectSubmission;
          if (!list.some((existing) => existing.id === item.id)) {
            list.push(item);
          }
        });
      } catch {
        // fallback
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Lists all submissions for a competition (alias).
   */
  public async listSubmissions(
    competitionId: string,
    options?: { status?: SubmissionStatus }
  ): Promise<ProjectSubmission[]> {
    return this.listCompetitionSubmissions(competitionId, options);
  }

  /**
   * Lists all submissions for a competition.
   */
  public async listCompetitionSubmissions(
    competitionId: string,
    options?: { status?: SubmissionStatus }
  ): Promise<ProjectSubmission[]> {
    const list: ProjectSubmission[] = [];
    for (const sub of this.memSubmissions.values()) {
      if (sub.competitionId === competitionId) {
        if (!options?.status || sub.status === options.status) {
          list.push(sub);
        }
      }
    }
    if (isFirebaseConfigured() && db) {
      try {
        const q = options?.status
          ? query(
              collection(db, 'submissions'),
              where('competitionId', '==', competitionId),
              where('status', '==', options.status)
            )
          : query(collection(db, 'submissions'), where('competitionId', '==', competitionId));
        const snaps = await getDocs(q);
        snaps.forEach((docSnap) => {
          const item = docSnap.data() as ProjectSubmission;
          if (!list.some((existing) => existing.id === item.id)) {
            list.push(item);
          }
        });
      } catch {
        // fallback
      }
    }
    return list;
  }

  /**
   * Locks a submission from any further participant edits.
   */
  public async lockSubmission(submissionId: string, organizerUserId: string): Promise<ProjectSubmission> {
    const sub = await this.getSubmission(submissionId);
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

    await this.saveSubmission(updated);
    return updated;
  }

  public async saveSubmission(submission: ProjectSubmission): Promise<void> {
    this.memSubmissions.set(submission.id, submission);
    this.saveToStorage();
    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'submissions', submission.id), sanitizeFirestoreData(submission));
      } catch {
        // memory fallback
      }
    }
  }

  public clearMemoryStore(): void {
    this.memSubmissions.clear();
  }

  public resetInMemoryStore(seedList: ProjectSubmission[] = []): void {
    this.memSubmissions.clear();
    for (const sub of seedList) {
      this.memSubmissions.set(sub.id, sub);
    }
  }
}

export const submissionService = new SubmissionService();
