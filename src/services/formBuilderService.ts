// ─────────────────────────────────────────────
// formBuilderService.ts — Form Schema Builder & Configuration Service
// Proofly — Phase 4
// ─────────────────────────────────────────────

import {
  collection,
  doc,
  getDocs,
  limit,
  setDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import {
  clampPageSize,
  mapFirestoreError,
  resolveFirestore,
  withServerTimestamps,
  type FirestoreExecutionOptions,
  type PaginationOptions,
} from './firestorePersistenceService';
import type {
  SubmissionFormSchema,
  SubmissionFormField,
} from '../types/formAndAccess';
import { competitionService } from './competitionService';

/**
 * Standard Default Hackathon Form Fields.
 */
export const DEFAULT_HACKATHON_FIELDS: SubmissionFormField[] = [
  {
    id: 'field-title',
    type: 'SHORT_TEXT',
    label: 'Project Title',
    placeholder: 'e.g. Proofly Hybrid Verifier',
    description: 'The official name of your project or hackathon submission.',
    required: true,
    order: 1,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      minLength: 3,
      maxLength: 100,
    },
  },
  {
    id: 'field-tagline',
    type: 'SHORT_TEXT',
    label: 'Elevator Pitch / Tagline',
    placeholder: 'One clear sentence summarizing what you built',
    description: 'Keep it punchy and memorable (max 140 chars).',
    required: true,
    order: 2,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      minLength: 10,
      maxLength: 140,
    },
  },
  {
    id: 'field-track',
    type: 'DROPDOWN',
    label: 'Competition Track / Category',
    description: 'Select the primary track your solution addresses.',
    required: true,
    order: 3,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      options: [
        'Healthcare & Edge AI',
        'Event Tech & Community Discovery',
        'Climate & Infrastructure',
        'Generative Media & Spatial Computing',
        'FinTech & Web3',
        'Decentralized Governance & Finance',
        'AI Agents & Automation',
        'Open Track',
      ],
    },
  },
  {
    id: 'field-description',
    type: 'LONG_TEXT',
    label: 'Detailed Solution Overview',
    placeholder: 'Describe the problem, your architecture, technical implementation, and real-world impact...',
    description: 'Provide a thorough explanation for AI pre-evaluation and human judges.',
    required: true,
    order: 4,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      minLength: 50,
      maxLength: 5000,
    },
  },
  {
    id: 'field-github',
    type: 'GITHUB_URL',
    label: 'GitHub Repository URL',
    placeholder: 'https://github.com/organization/project',
    description: 'Public codebase link. The AI logic engine inspects commit history and file structures.',
    required: true,
    order: 5,
    visibility: 'PUBLIC',
    validation: {
      required: true,
    },
  },
  {
    id: 'field-demo-url',
    type: 'URL',
    label: 'Live Deployed Demo URL',
    placeholder: 'https://my-project.vercel.app',
    description: 'Optional live URL where judges can test the deployed application.',
    required: false,
    order: 6,
    visibility: 'PUBLIC',
    validation: {
      required: false,
    },
  },
  {
    id: 'field-video-url',
    type: 'VIDEO_URL',
    label: 'Demo Video Link',
    placeholder: 'https://youtu.be/... or Loom link',
    description: '2 to 3 minute walkthrough demonstrating functionality.',
    required: false,
    order: 7,
    visibility: 'PUBLIC',
    validation: {
      required: false,
    },
  },
  {
    id: 'field-pitch-deck',
    type: 'FILE_UPLOAD',
    label: 'Pitch Deck / Project Files (PDF, PPT, ZIP)',
    description: 'Attach presentation, project blueprint, or source archive (PDF, PPT, PPTX, ZIP - max 25 MB).',
    required: false,
    order: 8,
    visibility: 'PUBLIC',
    validation: {
      required: false,
      fileTypeRestrictions: ['.pdf', '.ppt', '.pptx', '.zip', '.png', '.jpg'],
      maxFileSizeMb: 25,
    },
  },
  {
    id: 'field-team',
    type: 'TEAM_MEMBER_REPEATER',
    label: 'Team Members',
    description: 'Self-declare all contributing team members.',
    required: true,
    order: 9,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      minMembers: 1,
      maxMembers: 5,
    },
  },
  {
    id: 'field-honesty-pledge',
    type: 'CHECKBOX',
    label: 'Originality & Academic Integrity Pledge',
    description: 'We certify that all code was produced during the competition window without plagiarism.',
    required: true,
    order: 10,
    visibility: 'PUBLIC',
    validation: {
      required: true,
    },
  },
];

/**
 * Standard Default Individual Research Form Fields (No teams, scientific abstract, manuscript).
 */
export const DEFAULT_RESEARCH_FIELDS: SubmissionFormField[] = [
  {
    id: 'field-research-title',
    type: 'SHORT_TEXT',
    label: 'Research Project Title',
    placeholder: 'e.g. Quantized Transformer Attention on Ambient Edge Hardware',
    description: 'The formal title of the individual research study or symposium submission.',
    required: true,
    order: 1,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      minLength: 5,
      maxLength: 120,
    },
  },
  {
    id: 'field-research-abstract',
    type: 'LONG_TEXT',
    label: 'Abstract & Scientific Problem Statement',
    placeholder: 'State the scientific motivation, experimental design, methodology, and primary findings...',
    description: 'Comprehensive research abstract for AI logic pre-evaluation and reviewer assessment.',
    required: true,
    order: 2,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      minLength: 50,
      maxLength: 5000,
    },
  },
  {
    id: 'field-research-domain',
    type: 'DROPDOWN',
    label: 'Primary Research Domain',
    description: 'Select the primary field of scientific inquiry.',
    required: true,
    order: 3,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      options: [
        'Edge AI & Quantized Models',
        'Bioinformatics & Genomic LLMs',
        'Autonomous Systems & Robotics',
        'Formal Verification & Security',
        'Climate Informatics & Earth Observation',
      ],
    },
  },
  {
    id: 'field-manuscript-file',
    type: 'FILE_UPLOAD',
    label: 'Research Manuscript & Paper (PDF, PPT, ZIP)',
    description: 'Upload preprint manuscript, presentation slides, or complete replication bundle (PDF, PPT, PPTX, ZIP - max 25 MB).',
    required: true,
    order: 4,
    visibility: 'PUBLIC',
    validation: {
      required: true,
      fileTypeRestrictions: ['.pdf', '.ppt', '.pptx', '.zip'],
      maxFileSizeMb: 25,
    },
  },
  {
    id: 'field-replication-repo',
    type: 'GITHUB_URL',
    label: 'Replication Code Package (GitHub)',
    placeholder: 'https://github.com/researcher/experiment-replication',
    description: 'Public repository containing experimental source code, dependencies, and reproduction instructions.',
    required: false,
    order: 5,
    visibility: 'PUBLIC',
    validation: {
      required: false,
    },
  },
  {
    id: 'field-author-orcid',
    type: 'SHORT_TEXT',
    label: 'Author Affiliation & ORCID iD',
    placeholder: 'e.g. Stanford AI Lab · 0000-0002-1825-0097',
    description: 'Academic institution affiliation and persistent author identifier.',
    required: false,
    order: 6,
    visibility: 'PUBLIC',
    validation: {
      required: false,
    },
  },
  {
    id: 'field-ethics-pledge',
    type: 'CHECKBOX',
    label: 'Single-Author Originality & Academic Ethics Disclosure',
    description: 'I certify that this submission represents my original individual research without unauthorized co-authorship or data fabrication.',
    required: true,
    order: 7,
    visibility: 'PUBLIC',
    validation: {
      required: true,
    },
  },
];

// Unit-test-only in-memory store (unused whenever Firestore is active)
let localFormSchemas: SubmissionFormSchema[] = [];

export const formBuilderService = {
  /**
   * Creates or overwrites a form schema for a competition (and optional round) durably in Firestore.
   * Throws PersistenceError on Firestore failure (zero silent local fallback).
   */
  async saveFormSchema(
    competitionIdOrSchema: string | SubmissionFormSchema,
    title?: string,
    fields?: SubmissionFormField[],
    roundId?: string,
    description?: string,
    existingSchemaId?: string,
    options?: FirestoreExecutionOptions
  ): Promise<SubmissionFormSchema> {
    const fs = resolveFirestore(options?.firestore);

    if (typeof competitionIdOrSchema === 'object') {
      const s = competitionIdOrSchema;
      const schemaId = s.id || `schema-${Math.random().toString(36).substring(2, 9)}`;
      const now = new Date().toISOString();
      const orderedFields = (s.fields || []).map((f, idx) => ({
        ...f,
        order: f.order ?? idx + 1,
      }));
      const schema: SubmissionFormSchema = {
        ...s,
        id: schemaId,
        fields: orderedFields,
        updatedAt: now,
      };

      if (fs) {
        try {
          if (!schema.organizationId) {
            const comp = await competitionService.getCompetition(schema.competitionId);
            if (comp?.organizationId) {
              schema.organizationId = comp.organizationId;
            }
          }
          await setDoc(
            doc(fs, 'formSchemas', schemaId),
            withServerTimestamps(sanitizeFirestoreData(schema), true)
          );
          return schema;
        } catch (err) {
          throw mapFirestoreError(err, 'saveFormSchema', 'formSchemas');
        }
      }

      const existingIdx = localFormSchemas.findIndex((f) => f.id === schemaId);
      if (existingIdx !== -1) {
        localFormSchemas[existingIdx] = schema;
      } else {
        localFormSchemas.push(schema);
      }
      return schema;
    }

    const competitionId = competitionIdOrSchema;
    const schemaId = existingSchemaId || `schema-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    const orderedFields = (fields || []).map((f, idx) => ({
      ...f,
      order: f.order ?? idx + 1,
    }));

    const schema: SubmissionFormSchema = {
      id: schemaId,
      competitionId,
      roundId,
      title: (title || 'Custom Submission Form').trim(),
      description: description || '',
      fields: orderedFields,
      createdAt: now,
      updatedAt: now,
    };

    if (fs) {
      try {
        let orgId: string | undefined = undefined;
        try {
          const comp = await competitionService.getCompetition(competitionId);
          if (comp?.organizationId) {
            orgId = comp.organizationId;
          }
        } catch {
          // non-fatal if offline/unresolved
        }
        if (orgId) {
          schema.organizationId = orgId;
        }

        await setDoc(
          doc(fs, 'formSchemas', schemaId),
          withServerTimestamps(sanitizeFirestoreData(schema), true)
        );
        return schema;
      } catch (err) {
        throw mapFirestoreError(err, 'saveFormSchema', 'formSchemas');
      }
    }

    const idx = localFormSchemas.findIndex((s) => s.id === schemaId);
    if (idx !== -1) {
      localFormSchemas[idx] = schema;
    } else {
      localFormSchemas.push(schema);
    }

    return schema;
  },

  async getFormSchema(
    competitionId: string,
    roundId?: string,
    options?: FirestoreExecutionOptions
  ): Promise<SubmissionFormSchema> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        const q = roundId
          ? query(
              collection(fs, 'formSchemas'),
              where('competitionId', '==', competitionId),
              where('roundId', '==', roundId),
              limit(1)
            )
          : query(
              collection(fs, 'formSchemas'),
              where('competitionId', '==', competitionId),
              limit(1)
            );
        const snap = await getDocs(q);
        if (!snap.empty) {
          return snap.docs[0].data() as SubmissionFormSchema;
        }
        return this.generateDefaultHackathonSchema(competitionId);
      } catch (err) {
        throw mapFirestoreError(err, 'getFormSchema', 'formSchemas');
      }
    }

    const local = localFormSchemas.find(
      (s) => s.competitionId === competitionId && (!roundId || s.roundId === roundId)
    );
    if (local) {
      return local;
    }

    const fallback: SubmissionFormSchema = {
      id: `schema-default-${competitionId}`,
      competitionId,
      roundId,
      title: 'Standard Submission Form',
      description: 'Default submission template configured with core artifact fields.',
      fields: [...DEFAULT_HACKATHON_FIELDS],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localFormSchemas.push(fallback);
    return fallback;
  },

  async listFormSchemasForCompetition(
    competitionId: string,
    options?: PaginationOptions
  ): Promise<SubmissionFormSchema[]> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      const pageSize = clampPageSize(options?.pageSize);
      try {
        const q = query(
          collection(fs, 'formSchemas'),
          where('competitionId', '==', competitionId),
          limit(pageSize)
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => d.data() as SubmissionFormSchema);
      } catch (err) {
        throw mapFirestoreError(err, 'listFormSchemasForCompetition', 'formSchemas');
      }
    }
    const matching = localFormSchemas.filter((s) => s.competitionId === competitionId);
    if (matching.length === 0) {
      return [await this.getFormSchema(competitionId)];
    }
    return matching;
  },

  async deleteFormSchema(
    schemaId: string,
    options?: FirestoreExecutionOptions
  ): Promise<void> {
    const fs = resolveFirestore(options?.firestore);
    if (fs) {
      try {
        await deleteDoc(doc(fs, 'formSchemas', schemaId));
        return;
      } catch (err) {
        throw mapFirestoreError(err, 'deleteFormSchema', 'formSchemas');
      }
    }
    localFormSchemas = localFormSchemas.filter((s) => s.id !== schemaId);
  },

  generateDefaultHackathonSchema(competitionId: string, _organizationId?: string): SubmissionFormSchema {
    return {
      id: `schema-default-${competitionId}`,
      competitionId,
      title: 'Standard Submission Form',
      description: 'Default submission template configured with core artifact fields.',
      fields: [...DEFAULT_HACKATHON_FIELDS],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  generateDefaultResearchSchema(competitionId: string, _organizationId?: string): SubmissionFormSchema {
    return {
      id: `schema-research-${competitionId}`,
      competitionId,
      title: 'Individual Research Project Submission Form',
      description: 'Scientific manuscript and replication artifact submission form without team requirements.',
      fields: [...DEFAULT_RESEARCH_FIELDS],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  /**
   * Resets the in-memory store (for testing).
   */
  resetInMemoryStore(schemas: SubmissionFormSchema[] = []): void {
    localFormSchemas = [...schemas];
  },

  clearMemoryStore(): void {
    localFormSchemas = [];
  },
};
