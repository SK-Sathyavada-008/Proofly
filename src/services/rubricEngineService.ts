// ─────────────────────────────────────────────
// rubricEngineService.ts — Versioned Rubric Engine
// Proofly / Evalora — Phase 6
// ─────────────────────────────────────────────

import { db, isFirebaseConfigured } from '../config/firebase';
import { collection, doc, setDoc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import type { Competition, RubricCriterion } from '../types/authAndCompetition';
import type { RubricVersion, RubricCriterionConfig } from '../types/aiEvaluation';

export class RubricEngineService {
  private memRubricVersions: Map<string, RubricVersion> = new Map();

  /**
   * Generates or retrieves the immutable RubricVersion for a competition.
   * Preserves version history so that once an evaluation is performed, its rubric is frozen.
   */
  public async getOrCreateRubricVersion(
    competition: Competition,
    targetVersionNumber?: number
  ): Promise<RubricVersion> {
    const versionNum = targetVersionNumber || 1;
    const versionKey = `${competition.id}_v${versionNum}`;

    if (this.memRubricVersions.has(versionKey)) {
      return this.memRubricVersions.get(versionKey)!;
    }

    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDoc(doc(db, 'rubricVersions', versionKey));
        if (snap.exists()) {
          const loaded = snap.data() as RubricVersion;
          this.memRubricVersions.set(versionKey, loaded);
          return loaded;
        }
      } catch {
        // memory fallback
      }
    }

    // Convert competition rubric to RubricVersion
    const criteriaConfig: RubricCriterionConfig[] = (competition.rubric || []).map((c: RubricCriterion) => ({
      id: c.id,
      name: c.name,
      description: c.description || '',
      weight: c.weight || 25,
      maxScore: c.maxScore || 25,
      scoringGuidance: `Score this criterion from 0 to ${c.maxScore || 25} based on demonstrable evidence. Explain any deduction explicitly.`,
      requiredEvidence: ['Project Description', 'Submitted Code / Artifacts', 'Implementation Details'],
    }));

    const totalMaxScore = criteriaConfig.reduce((acc, c) => acc + c.maxScore, 0);

    const rubricVersion: RubricVersion = {
      versionNumber: versionNum,
      competitionId: competition.id,
      criteria: criteriaConfig,
      totalMaxScore,
      capturedAt: new Date().toISOString(),
    };

    await this.saveRubricVersion(rubricVersion);
    return rubricVersion;
  }

  public async saveRubricVersion(rubricVersion: RubricVersion): Promise<void> {
    const versionKey = `${rubricVersion.competitionId}_v${rubricVersion.versionNumber}`;
    this.memRubricVersions.set(versionKey, rubricVersion);

    if (isFirebaseConfigured() && db) {
      try {
        await setDoc(doc(db, 'rubricVersions', versionKey), sanitizeFirestoreData(rubricVersion));
      } catch {
        // memory fallback
      }
    }
  }

  public async listCompetitionRubricVersions(competitionId: string): Promise<RubricVersion[]> {
    const list: RubricVersion[] = [];
    for (const rv of this.memRubricVersions.values()) {
      if (rv.competitionId === competitionId) list.push(rv);
    }

    if (isFirebaseConfigured() && db) {
      try {
        const q = query(collection(db, 'rubricVersions'), where('competitionId', '==', competitionId));
        const snaps = await getDocs(q);
        snaps.forEach((docSnap) => {
          const item = docSnap.data() as RubricVersion;
          if (!list.some((existing) => existing.versionNumber === item.versionNumber)) {
            list.push(item);
          }
        });
      } catch {
        // fallback
      }
    }

    return list.sort((a, b) => b.versionNumber - a.versionNumber);
  }

  public clearMemoryStore(): void {
    this.memRubricVersions.clear();
  }
}

export const rubricEngineService = new RubricEngineService();
