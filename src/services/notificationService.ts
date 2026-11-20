// ─────────────────────────────────────────────
// notificationService.ts — Phase 14 In-App Notification & Trusted Email System
// Proofly — Real-time in-app alerts, duplicate prevention, read states & email extension
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
} from './firestorePersistenceService';
import type {
  AppNotification,
  CreateNotificationInput,
  EmailDeliveryReceipt,
  EmailDispatchPayload,
  EmailTransportProvider,
  NotificationQueryOptions,
  PaginatedNotifications,
  UserNotificationPreferences,
} from '../types/appealsAndNotifications';

/**
 * In-memory mock email provider for unit testing & local sandbox.
 * Strictly guarantees ZERO real emails are dispatched during tests or client execution.
 */
export class MockBackendEmailProvider implements EmailTransportProvider {
  public dispatchedEmails: EmailDispatchPayload[] = [];
  public receipts: EmailDeliveryReceipt[] = [];

  public async sendEmail(payload: EmailDispatchPayload): Promise<EmailDeliveryReceipt> {
    this.dispatchedEmails.push(payload);
    const receipt: EmailDeliveryReceipt = {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      provider: 'MOCK_TRUSTED_BACKEND',
      deliveredAt: new Date().toISOString(),
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public clear(): void {
    this.dispatchedEmails = [];
    this.receipts = [];
  }
}

export class NotificationService {
  // In-memory notifications cache for test/offline environments
  private inMemoryNotifications = new Map<string, AppNotification>();
  private inMemoryPreferences = new Map<string, UserNotificationPreferences>();
  private deduplicationIndex = new Map<string, string>(); // deduplicationKey -> notificationId

  private emailProvider: EmailTransportProvider;

  constructor(emailProvider?: EmailTransportProvider) {
    this.emailProvider = emailProvider || new MockBackendEmailProvider();
  }

  public setEmailProvider(provider: EmailTransportProvider): void {
    this.emailProvider = provider;
  }

  public getEmailProvider(): EmailTransportProvider {
    return this.emailProvider;
  }

  public resetInMemoryState(): void {
    this.inMemoryNotifications.clear();
    this.inMemoryPreferences.clear();
    this.deduplicationIndex.clear();
    if (this.emailProvider instanceof MockBackendEmailProvider) {
      this.emailProvider.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 1. PREFERENCES
  // ─────────────────────────────────────────────────────────────────

  public getUserPreferences(userId: string): UserNotificationPreferences {
    return (
      this.inMemoryPreferences.get(userId) || {
        userId,
        emailNotificationsEnabled: true,
        subscribedCategories: {
          submissions: true,
          evaluations: true,
          appeals: true,
          announcements: true,
          reminders: true,
        },
      }
    );
  }

  public setUserPreferences(preferences: UserNotificationPreferences): void {
    this.inMemoryPreferences.set(preferences.userId, preferences);
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. CREATION & DUPLICATE PREVENTION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Builds an automatic deduplication key if none is explicitly provided.
   */
  private generateDeduplicationKey(input: CreateNotificationInput): string {
    if (input.deduplicationKey) return input.deduplicationKey;
    const recipient = input.recipientId.trim().toLowerCase();
    const event = input.eventType;
    const resId = input.resourceId || 'global';
    // For reminders and status changes, bucket by current date (YYYY-MM-DD) to prevent multiple alerts on the same day
    const dateBucket = new Date().toISOString().split('T')[0];
    return `dedup_${recipient}_${event}_${resId}_${dateBucket}`;
  }

  /**
   * Creates an in-app notification with strict duplicate prevention and optional email dispatch.
   */
  public async createNotification(
    input: CreateNotificationInput,
    options?: FirestoreExecutionOptions
  ): Promise<AppNotification> {
    if (!input.recipientId || !input.recipientId.trim()) {
      throw new Error('Notification recipient ID is required.');
    }
    if (!input.title || !input.title.trim()) {
      throw new Error('Notification title is required.');
    }
    if (!input.message || !input.message.trim()) {
      throw new Error('Notification message content is required.');
    }

    const deduplicationKey = this.generateDeduplicationKey(input);

    // 1. Duplicate Prevention Check
    const existingId = this.deduplicationIndex.get(deduplicationKey);
    if (existingId) {
      const existing = this.inMemoryNotifications.get(existingId);
      if (existing) {
        return existing;
      }
    }

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const dupQuery = query(
          collection(fs, 'notifications'),
          where('deduplicationKey', '==', deduplicationKey),
          limit(1)
        );
        const dupSnap = await getDocs(dupQuery);
        if (!dupSnap.empty) {
          const docData = dupSnap.docs[0].data() as AppNotification;
          this.deduplicationIndex.set(deduplicationKey, docData.id);
          this.inMemoryNotifications.set(docData.id, docData);
          return docData;
        }
      } catch (err) {
        // Fall back gracefully to in-memory check
      }
    }

    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const notification: AppNotification = {
      id,
      recipientId: input.recipientId.trim(),
      recipientEmail: input.recipientEmail,
      recipientRole: input.recipientRole || 'PARTICIPANT',
      eventType: input.eventType,
      title: input.title.trim(),
      message: input.message.trim(),
      competitionId: input.competitionId,
      competitionTitle: input.competitionTitle,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      actionUrl: input.actionUrl,
      isRead: false,
      createdAt: now,
      deduplicationKey,
      metadata: input.metadata || {},
    };

    // 2. Email Extension Dispatch (if configured & allowed by user preferences)
    if (input.sendEmail && input.recipientEmail) {
      const prefs = this.getUserPreferences(input.recipientId);
      if (prefs.emailNotificationsEnabled) {
        try {
          const receipt = await this.emailProvider.sendEmail({
            to: input.recipientEmail,
            subject: `[Proofly] ${notification.title}`,
            text: notification.message,
            html: `<div style="font-family:sans-serif;padding:16px;"><h2>${notification.title}</h2><p>${notification.message}</p></div>`,
            eventType: notification.eventType,
            metadata: {
              notificationId: id,
              competitionId: input.competitionId,
              resourceId: input.resourceId,
            },
          });

          notification.emailDelivery = {
            attempted: true,
            delivered: receipt.success,
            provider: receipt.provider,
            timestamp: receipt.deliveredAt,
          };
        } catch (emailErr: any) {
          notification.emailDelivery = {
            attempted: true,
            delivered: false,
            provider: 'TRUSTED_BACKEND',
            error: emailErr?.message || 'Email delivery failure',
            timestamp: now,
          };
        }
      }
    }

    // 3. Persist notification
    this.inMemoryNotifications.set(id, notification);
    this.deduplicationIndex.set(deduplicationKey, id);

    if (fs) {
      try {
        const ref = doc(fs, 'notifications', id);
        await setDoc(ref, withServerTimestamps(sanitizeFirestoreData(notification), true));
      } catch (err) {
        throw mapFirestoreError(err, 'createNotification', 'notifications');
      }
    }

    return notification;
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. QUERYING & PAGINATION
  // ─────────────────────────────────────────────────────────────────

  public async listNotifications(
    queryOptions: NotificationQueryOptions,
    options?: FirestoreExecutionOptions
  ): Promise<PaginatedNotifications> {
    const fs = resolveFirestore(options?.firestore);
    const limitCount = Math.max(1, Math.min(queryOptions.limit || 20, 100));
    const offset = Math.max(0, queryOptions.offset || 0);

    let list: AppNotification[] = [];

    if (fs) {
      try {
        const constraints = [
          where('recipientId', '==', queryOptions.recipientId.trim()),
        ];
        if (queryOptions.competitionId) {
          constraints.push(where('competitionId', '==', queryOptions.competitionId));
        }
        if (queryOptions.unreadOnly) {
          constraints.push(where('isRead', '==', false));
        }

        const q = query(collection(fs, 'notifications'), ...constraints);
        const snap = await getDocs(q);
        list = snap.docs.map((d) => d.data() as AppNotification);
      } catch (err) {
        list = Array.from(this.inMemoryNotifications.values());
      }
    } else {
      list = Array.from(this.inMemoryNotifications.values());
    }

    // Filter in-memory
    list = list.filter((n) => {
      if (n.recipientId.toLowerCase() !== queryOptions.recipientId.trim().toLowerCase()) return false;
      if (queryOptions.competitionId && n.competitionId !== queryOptions.competitionId) return false;
      if (queryOptions.unreadOnly && n.isRead) return false;
      return true;
    });

    // Sort descending by createdAt
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = list.length;
    const unreadCount = list.filter((n) => !n.isRead).length;
    const paginated = list.slice(offset, offset + limitCount);

    return {
      notifications: paginated,
      total,
      unreadCount,
      hasMore: offset + limitCount < total,
    };
  }

  public async getUnreadCount(
    recipientId: string,
    options?: FirestoreExecutionOptions
  ): Promise<number> {
    const res = await this.listNotifications({ recipientId, unreadOnly: true }, options);
    return res.total;
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. READ STATE MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  public async markAsRead(
    notificationId: string,
    recipientId: string,
    options?: FirestoreExecutionOptions
  ): Promise<AppNotification> {
    const notif = this.inMemoryNotifications.get(notificationId);
    const now = new Date().toISOString();

    // Security check: recipient must own the notification
    if (notif && notif.recipientId.toLowerCase() !== recipientId.trim().toLowerCase()) {
      throw new Error('Access denied: Cannot modify notification of another recipient.');
    }

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const ref = doc(fs, 'notifications', notificationId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as AppNotification;
          if (data.recipientId.toLowerCase() !== recipientId.trim().toLowerCase()) {
            throw new Error('Access denied: Cannot modify notification of another recipient.');
          }
          await updateDoc(ref, {
            isRead: true,
            readAt: now,
          });
          const updated = { ...data, isRead: true, readAt: now };
          this.inMemoryNotifications.set(notificationId, updated);
          return updated;
        }
      } catch (err: any) {
        if (err.message?.includes('Access denied')) throw err;
        throw mapFirestoreError(err, 'markAsRead', 'notifications');
      }
    }

    if (!notif) {
      throw new Error(`Notification "${notificationId}" was not found.`);
    }

    const updated = { ...notif, isRead: true, readAt: now };
    this.inMemoryNotifications.set(notificationId, updated);
    return updated;
  }

  public async markAllAsRead(
    recipientId: string,
    options?: FirestoreExecutionOptions
  ): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;

    for (const [id, notif] of this.inMemoryNotifications.entries()) {
      if (notif.recipientId.toLowerCase() === recipientId.trim().toLowerCase() && !notif.isRead) {
        this.inMemoryNotifications.set(id, { ...notif, isRead: true, readAt: now });
        count++;
      }
    }

    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = query(
          collection(fs, 'notifications'),
          where('recipientId', '==', recipientId.trim()),
          where('isRead', '==', false)
        );
        const snap = await getDocs(q);
        for (const docSnap of snap.docs) {
          await updateDoc(docSnap.ref, { isRead: true, readAt: now });
          count++;
        }
      } catch (err) {
        // In-memory already marked
      }
    }

    return count;
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. EVENT HELPER TRIGGERS
  // ─────────────────────────────────────────────────────────────────

  public async notifyCompetitionInvitation(params: {
    recipientId: string;
    recipientEmail?: string;
    competitionId: string;
    competitionTitle: string;
    inviterName: string;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      eventType: 'COMPETITION_INVITATION',
      title: `Invited to ${params.competitionTitle}`,
      message: `${params.inviterName} has invited you to join "${params.competitionTitle}".`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'COMPETITION',
      resourceId: params.competitionId,
      actionUrl: `/submit?competitionId=${params.competitionId}`,
      sendEmail: true,
    });
  }

  public async notifyRegistrationConfirmation(params: {
    recipientId: string;
    recipientEmail?: string;
    competitionId: string;
    competitionTitle: string;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      eventType: 'REGISTRATION_CONFIRMATION',
      title: 'Registration Confirmed',
      message: `You are officially registered for "${params.competitionTitle}". Check deadlines and guidelines!`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'COMPETITION',
      resourceId: params.competitionId,
      actionUrl: `/submit?competitionId=${params.competitionId}`,
      sendEmail: true,
    });
  }

  public async notifySubmissionConfirmation(params: {
    recipientId: string;
    recipientEmail?: string;
    submissionId: string;
    referenceId: string;
    projectTitle: string;
    competitionId: string;
    competitionTitle: string;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      eventType: 'SUBMISSION_CONFIRMATION',
      title: `Submission Received: ${params.referenceId}`,
      message: `Your project "${params.projectTitle}" has been received for "${params.competitionTitle}". Reference: ${params.referenceId}.`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'SUBMISSION',
      resourceId: params.submissionId,
      actionUrl: `/submit/manage?ref=${params.referenceId}`,
      sendEmail: true,
    });
  }

  public async notifySubmissionDeadlineReminder(params: {
    recipientId: string;
    recipientEmail?: string;
    competitionId: string;
    competitionTitle: string;
    deadlineHoursRemaining: number;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      eventType: 'SUBMISSION_DEADLINE_REMINDER',
      title: `Deadline Alert: ${params.deadlineHoursRemaining}h Remaining`,
      message: `The submission deadline for "${params.competitionTitle}" ends in ${params.deadlineHoursRemaining} hours. Submit or update your project!`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'COMPETITION',
      resourceId: params.competitionId,
      actionUrl: `/submit?competitionId=${params.competitionId}`,
      deduplicationKey: `dedup_deadline_${params.recipientId}_${params.competitionId}_${params.deadlineHoursRemaining}h`,
      sendEmail: true,
    });
  }

  public async notifySubmissionStatusChange(params: {
    recipientId: string;
    recipientEmail?: string;
    submissionId: string;
    referenceId: string;
    projectTitle: string;
    newStatus: string;
    competitionId: string;
    competitionTitle: string;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      eventType: 'SUBMISSION_STATUS_CHANGE',
      title: `Status Updated: ${params.newStatus}`,
      message: `Project "${params.projectTitle}" (${params.referenceId}) is now "${params.newStatus}".`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'SUBMISSION',
      resourceId: params.submissionId,
      actionUrl: `/submit/manage?ref=${params.referenceId}`,
    });
  }

  public async notifyJudgeAssignment(params: {
    judgeId: string;
    judgeEmail?: string;
    competitionId: string;
    competitionTitle: string;
    assignedSubmissionsCount: number;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.judgeId,
      recipientEmail: params.judgeEmail,
      recipientRole: 'JUDGE',
      eventType: 'JUDGE_ASSIGNMENT',
      title: 'New Evaluation Assignments',
      message: `You have been assigned ${params.assignedSubmissionsCount} submission(s) to evaluate in "${params.competitionTitle}".`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'EVALUATION',
      actionUrl: '/judge/assignments',
      sendEmail: true,
    });
  }

  public async notifyEvaluationDeadline(params: {
    judgeId: string;
    judgeEmail?: string;
    competitionId: string;
    competitionTitle: string;
    pendingCount: number;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.judgeId,
      recipientEmail: params.judgeEmail,
      recipientRole: 'JUDGE',
      eventType: 'EVALUATION_DEADLINE',
      title: 'Judging Window Closing Soon',
      message: `You have ${params.pendingCount} pending submission review(s) for "${params.competitionTitle}". Please finalize before the judging deadline.`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'EVALUATION',
      actionUrl: '/judge/assignments',
      sendEmail: true,
    });
  }

  public async notifyEvaluationCompletion(params: {
    organizerId: string;
    competitionId: string;
    competitionTitle: string;
    completedCount: number;
    totalCount: number;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.organizerId,
      recipientRole: 'ORGANIZER',
      eventType: 'EVALUATION_COMPLETION',
      title: 'Evaluations Completed',
      message: `All ${params.completedCount}/${params.totalCount} evaluations have been finalized for "${params.competitionTitle}". You may now review and publish official results.`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'EVALUATION',
      actionUrl: '/organizer/results',
    });
  }

  public async notifyAppealStatusChange(params: {
    recipientId: string;
    recipientEmail?: string;
    recipientRole?: 'PARTICIPANT' | 'ORGANIZER';
    appealId: string;
    referenceId: string;
    criterionName: string;
    newStatus: string;
    notes?: string;
    competitionId: string;
    competitionTitle: string;
  }): Promise<AppNotification> {
    const extra = params.notes ? ` Notes: ${params.notes}` : '';
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      recipientRole: params.recipientRole || 'PARTICIPANT',
      eventType: 'APPEAL_STATUS_CHANGE',
      title: `Appeal ${params.newStatus}: ${params.criterionName}`,
      message: `Evaluation appeal for "${params.criterionName}" on submission ${params.referenceId} is now ${params.newStatus}.${extra}`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'APPEAL',
      resourceId: params.appealId,
      actionUrl: `/submit/manage?ref=${params.referenceId}&tab=appeals`,
      sendEmail: true,
    });
  }

  public async notifyResultsPublication(params: {
    recipientId: string;
    recipientEmail?: string;
    competitionId: string;
    competitionTitle: string;
    publicSlug: string;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      eventType: 'RESULTS_PUBLICATION',
      title: `Official Results Published: ${params.competitionTitle}`,
      message: `Official rankings and evaluation feedback have been released for "${params.competitionTitle}". Check the public leaderboard!`,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'LEADERBOARD',
      actionUrl: `/leaderboard/${params.competitionId}`,
      sendEmail: true,
    });
  }

  public async notifyOrganizerAnnouncement(params: {
    recipientId: string;
    recipientEmail?: string;
    competitionId: string;
    competitionTitle: string;
    announcementTitle: string;
    announcementContent: string;
  }): Promise<AppNotification> {
    return this.createNotification({
      recipientId: params.recipientId,
      recipientEmail: params.recipientEmail,
      eventType: 'ORGANIZER_ANNOUNCEMENT',
      title: `Announcement: ${params.announcementTitle}`,
      message: params.announcementContent,
      competitionId: params.competitionId,
      competitionTitle: params.competitionTitle,
      resourceType: 'ANNOUNCEMENT',
      actionUrl: `/submit?competitionId=${params.competitionId}`,
      sendEmail: true,
    });
  }
}

export const notificationService = new NotificationService();
