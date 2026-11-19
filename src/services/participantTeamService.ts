// ─────────────────────────────────────────────
// participantTeamService.ts — Team & Participant Handling
// Proofly — Phase 5
// ─────────────────────────────────────────────

import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import {
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginationOptions,
} from './firestorePersistenceService';
import type { TeamRecord, ParticipantRecord } from '../types/submission';

export interface CsvImportRow {
  teamName?: string;
  participantName: string;
  email?: string;
  role?: string;
  githubUsername?: string;
  isLead?: boolean;
}

export interface CsvImportResult {
  totalRows: number;
  teamsCreated: number;
  participantsCreated: number;
  errors: string[];
}

export class ParticipantTeamService {
  private memTeams: Map<string, TeamRecord> = new Map();
  private memParticipants: Map<string, ParticipantRecord> = new Map();

  /**
   * Creates or updates team and participant records from a submitted project form.
   */
  public async handleSubmissionTeamAndMembers(params: {
    competitionId: string;
    organizationId: string;
    submissionId: string;
    submissionType: 'INDIVIDUAL' | 'TEAM';
    teamName?: string;
    primaryContactName: string;
    primaryContactEmail?: string;
    participants: {
      name: string;
      email?: string;
      role?: string;
      githubUsername?: string;
      isLead?: boolean;
    }[];
  }): Promise<{ team?: TeamRecord; participants: ParticipantRecord[] }> {
    const {
      competitionId,
      organizationId,
      submissionId,
      submissionType,
      teamName,
      primaryContactName,
      primaryContactEmail,
      participants,
    } = params;

    const createdParticipants: ParticipantRecord[] = [];
    const now = new Date().toISOString();
    const safeParticipants = participants || [];

    if (submissionType === 'INDIVIDUAL') {
      // Solo participant — do not force a fake team
      const participantId = `part_${Math.random().toString(36).substring(2, 10)}`;
      const soloParticipant: ParticipantRecord = {
        id: participantId,
        competitionId,
        organizationId,
        submissionId,
        name: primaryContactName || (safeParticipants[0]?.name ?? 'Solo Participant'),
        email: primaryContactEmail || safeParticipants[0]?.email,
        role: safeParticipants[0]?.role || 'Solo Creator',
        githubUsername: safeParticipants[0]?.githubUsername,
        isLead: true,
        source: 'FORM_SUBMISSION',
        createdAt: now,
      };

      await this.saveParticipant(soloParticipant);
      return { participants: [soloParticipant] };
    }

    // Team submission
    const teamId = `team_${Math.random().toString(36).substring(2, 10)}`;
    const effectiveTeamName = teamName?.trim() || `${primaryContactName}'s Team`;

    // Ensure at least one valid member exists
    const validParticipants = safeParticipants.filter((p) => p && p.name && p.name.trim().length > 0);
    const rawList =
      validParticipants.length > 0
        ? validParticipants
        : [{ name: primaryContactName?.trim() || 'Team Lead', email: primaryContactEmail?.trim(), isLead: true }];

    for (let i = 0; i < rawList.length; i++) {
      const p = rawList[i];
      const partId = `part_${Math.random().toString(36).substring(2, 10)}`;
      const isLead = p.isLead !== undefined ? p.isLead : i === 0;

      const participant: ParticipantRecord = {
        id: partId,
        competitionId,
        organizationId,
        submissionId,
        teamId,
        name: p.name.trim(),
        email: p.email?.trim() || (isLead ? primaryContactEmail : undefined),
        role: p.role?.trim() || (isLead ? 'Team Lead' : 'Collaborator'),
        githubUsername: p.githubUsername?.trim(),
        isLead,
        source: 'FORM_SUBMISSION',
        createdAt: now,
      };

      await this.saveParticipant(participant);
      createdParticipants.push(participant);
    }

    const lead = createdParticipants.find((p) => p.isLead) || createdParticipants[0];

    const teamRecord: TeamRecord = {
      id: teamId,
      competitionId,
      organizationId,
      submissionId,
      name: effectiveTeamName,
      memberCount: createdParticipants.length,
      leadParticipantId: lead?.id,
      leadEmail: lead?.email,
      memberIds: createdParticipants.map((p) => p.id),
      members: createdParticipants,
      source: 'FORM_SUBMISSION',
      createdAt: now,
      updatedAt: now,
    };

    await this.saveTeam(teamRecord);

    return { team: teamRecord, participants: createdParticipants };
  }

  /**
   * Parses CSV content and creates pre-registered teams & participants.
   * CSV format supported:
   * team_name,participant_name,email,role,github_username,is_lead
   */
  public async importParticipantsFromCsv(
    competitionId: string,
    organizationId: string,
    csvContent: string
  ): Promise<CsvImportResult> {
    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length <= 1) {
      return { totalRows: 0, teamsCreated: 0, participantsCreated: 0, errors: ['CSV is empty or header-only.'] };
    }

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const teamNameIdx = header.findIndex((h) => h.includes('team'));
    const nameIdx = header.findIndex((h) => h.includes('name') && !h.includes('team'));
    const emailIdx = header.findIndex((h) => h.includes('email'));
    const roleIdx = header.findIndex((h) => h.includes('role'));
    const githubIdx = header.findIndex((h) => h.includes('git'));
    const leadIdx = header.findIndex((h) => h.includes('lead'));

    const rows: CsvImportRow[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
      const participantName = nameIdx >= 0 ? cols[nameIdx] : cols[0];

      if (!participantName) {
        errors.push(`Row ${i + 1}: Missing participant name.`);
        continue;
      }

      rows.push({
        teamName: teamNameIdx >= 0 ? cols[teamNameIdx] : undefined,
        participantName,
        email: emailIdx >= 0 ? cols[emailIdx] : undefined,
        role: roleIdx >= 0 ? cols[roleIdx] : undefined,
        githubUsername: githubIdx >= 0 ? cols[githubIdx] : undefined,
        isLead: leadIdx >= 0 ? cols[leadIdx].toLowerCase() === 'true' || cols[leadIdx] === '1' : undefined,
      });
    }

    // Group by team
    const teamGroups = new Map<string, CsvImportRow[]>();
    const soloRows: CsvImportRow[] = [];

    for (const row of rows) {
      if (row.teamName) {
        const list = teamGroups.get(row.teamName) || [];
        list.push(row);
        teamGroups.set(row.teamName, list);
      } else {
        soloRows.push(row);
      }
    }

    let teamsCreated = 0;
    let participantsCreated = 0;
    const now = new Date().toISOString();

    // Create teams
    for (const [tName, members] of teamGroups.entries()) {
      const teamId = `team_csv_${Math.random().toString(36).substring(2, 10)}`;
      const memberRecords: ParticipantRecord[] = [];

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const isLead = m.isLead !== undefined ? m.isLead : i === 0;
        const partId = `part_csv_${Math.random().toString(36).substring(2, 10)}`;

        const part: ParticipantRecord = {
          id: partId,
          competitionId,
          organizationId,
          teamId,
          name: m.participantName,
          email: m.email,
          role: m.role || (isLead ? 'Team Lead' : 'Member'),
          githubUsername: m.githubUsername,
          isLead,
          source: 'CSV_IMPORT',
          createdAt: now,
        };

        await this.saveParticipant(part);
        memberRecords.push(part);
        participantsCreated++;
      }

      const lead = memberRecords.find((p) => p.isLead) || memberRecords[0];

      const teamRecord: TeamRecord = {
        id: teamId,
        competitionId,
        organizationId,
        name: tName,
        memberCount: memberRecords.length,
        leadParticipantId: lead?.id,
        leadEmail: lead?.email,
        memberIds: memberRecords.map((m) => m.id),
        members: memberRecords,
        source: 'CSV_IMPORT',
        createdAt: now,
        updatedAt: now,
      };

      await this.saveTeam(teamRecord);
      teamsCreated++;
    }

    // Create solo participants
    for (const solo of soloRows) {
      const partId = `part_csv_${Math.random().toString(36).substring(2, 10)}`;
      const part: ParticipantRecord = {
        id: partId,
        competitionId,
        organizationId,
        name: solo.participantName,
        email: solo.email,
        role: solo.role || 'Solo Creator',
        githubUsername: solo.githubUsername,
        isLead: true,
        source: 'CSV_IMPORT',
        createdAt: now,
      };

      await this.saveParticipant(part);
      participantsCreated++;
    }

    return {
      totalRows: rows.length,
      teamsCreated,
      participantsCreated,
      errors,
    };
  }

  public async getTeam(
    teamId: string,
    options?: FirestoreExecutionOptions
  ): Promise<TeamRecord | null> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const snap = await getDoc(doc(fs, 'teams', teamId));
        return snap.exists() ? (snap.data() as TeamRecord) : null;
      } catch (err) {
        throw mapFirestoreError(err, 'getTeam', 'teams');
      }
    }
    return this.memTeams.get(teamId) || null;
  }

  public async listCompetitionTeams(
    competitionId: string,
    options?: PaginationOptions
  ): Promise<TeamRecord[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const q = query(
          collection(fs, 'teams'),
          where('competitionId', '==', competitionId),
          limit(pageSize)
        );
        const snaps = await getDocs(q);
        return snaps.docs.map((d) => d.data() as TeamRecord);
      } catch (err) {
        throw mapFirestoreError(err, 'listCompetitionTeams', 'teams');
      }
    }

    const list: TeamRecord[] = [];
    for (const t of this.memTeams.values()) {
      if (t.competitionId === competitionId) list.push(t);
    }
    return list;
  }

  public async listCompetitionParticipants(
    competitionId: string,
    options?: PaginationOptions
  ): Promise<ParticipantRecord[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const q = query(
          collection(fs, 'participants'),
          where('competitionId', '==', competitionId),
          limit(pageSize)
        );
        const snaps = await getDocs(q);
        return snaps.docs.map((d) => d.data() as ParticipantRecord);
      } catch (err) {
        throw mapFirestoreError(err, 'listCompetitionParticipants', 'participants');
      }
    }

    const list: ParticipantRecord[] = [];
    for (const p of this.memParticipants.values()) {
      if (p.competitionId === competitionId) list.push(p);
    }
    return list;
  }

  public async saveTeam(
    team: TeamRecord,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(
          doc(fs, 'teams', team.id),
          withServerTimestamps(sanitizeFirestoreData(team), true)
        );
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'saveTeam', 'teams');
      }
    }
    this.memTeams.set(team.id, team);
  }

  public async saveParticipant(
    participant: ParticipantRecord,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await setDoc(
          doc(fs, 'participants', participant.id),
          withServerTimestamps(sanitizeFirestoreData(participant), true)
        );
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'saveParticipant', 'participants');
      }
    }
    this.memParticipants.set(participant.id, participant);
  }

  public clearMemoryStore(): void {
    this.memTeams.clear();
    this.memParticipants.clear();
  }
}

export const participantTeamService = new ParticipantTeamService();
