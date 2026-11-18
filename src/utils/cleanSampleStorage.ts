// ─────────────────────────────────────────────
// cleanSampleStorage.ts — One-time purge of legacy pre-seeded demo/sample records
// from browser localStorage so the live workspace starts clean.
// ─────────────────────────────────────────────

const PURGE_FLAG_KEY = 'proofly_sample_purge_v1';

const SAMPLE_JUDGE_IDS = new Set([
  'user-judge-01',
  'judge-maya',
  'judge-marcus',
  'judge-chen',
]);

const SAMPLE_COMPETITION_IDS = new Set([
  'comp-global-ai',
  'comp-robotics-edge',
  'comp-biotech',
  'comp-default-ai',
]);

const SAMPLE_SUBMISSION_IDS = new Set([
  'sub-nano-cardiopulse',
  'sub-edge-vision',
  'sub-climate-ecosense',
  'sub-draft-attest',
  'sub-neuro-speech',
  'sub-quantum-pulse',
  'sub-bioscan-ai',
  'sub-omnitrack-demo',
  'sub-gridpulse-solo',
  'sub-devflow-team',
  'sub-sample-1-strong',
  'sub-sample-2-moderate',
  'sub-sample-3-weak',
  'sub-sample-4-incomplete',
  'sub-sample-5-video-solo',
]);

const SAMPLE_ORG_IDS = new Set([
  'org-deepmind',
  'org-stanford',
]);

function isSampleAssignmentId(id?: string): boolean {
  if (!id) return false;
  return (
    id === 'asgn-sub-cardiopulse-elena' ||
    id === 'asgn-sub-cardiopulse-maya' ||
    id === 'asgn-sub-quantumpulse-chen' ||
    id === 'asgn-sub-bioscan-marcus'
  );
}

/**
 * Runs once per browser profile to strip previously cached sample/demo entries
 * from localStorage while keeping any user-created records intact.
 */
export function purgeLegacySampleStorageOnce(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (window.localStorage.getItem(PURGE_FLAG_KEY) === '1') return;

    // 1. Clean active org if pointing to a legacy sample org
    const activeOrg = window.localStorage.getItem('proofly_active_org_id');
    if (activeOrg && SAMPLE_ORG_IDS.has(activeOrg)) {
      window.localStorage.removeItem('proofly_active_org_id');
    }

    // 2. Clean sample judges
    const rawJudges = window.localStorage.getItem('proofly_judges');
    if (rawJudges) {
      const parsed = JSON.parse(rawJudges);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((j: any) => !SAMPLE_JUDGE_IDS.has(j?.id));
        window.localStorage.setItem('proofly_judges', JSON.stringify(cleaned));
      }
    }

    // 3. Clean sample judge assignments
    const rawAssignments = window.localStorage.getItem('proofly_judge_assignments');
    if (rawAssignments) {
      const parsed = JSON.parse(rawAssignments);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (a: any) =>
            !isSampleAssignmentId(a?.id) &&
            !SAMPLE_SUBMISSION_IDS.has(a?.submissionId) &&
            !SAMPLE_JUDGE_IDS.has(a?.judgeId) &&
            !SAMPLE_COMPETITION_IDS.has(a?.competitionId)
        );
        window.localStorage.setItem('proofly_judge_assignments', JSON.stringify(cleaned));
      }
    }

    // 4. Clean sample human evaluations
    const rawEvals = window.localStorage.getItem('proofly_human_evaluations');
    if (rawEvals) {
      const parsed = JSON.parse(rawEvals);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (e: any) =>
            !SAMPLE_SUBMISSION_IDS.has(e?.submissionId) &&
            !SAMPLE_JUDGE_IDS.has(e?.judgeId) &&
            !SAMPLE_COMPETITION_IDS.has(e?.competitionId)
        );
        window.localStorage.setItem('proofly_human_evaluations', JSON.stringify(cleaned));
      }
    }

    // 5. Clean sample scoring ledger entries
    const rawLedger = window.localStorage.getItem('proofly_scoring_ledger_v1');
    if (rawLedger) {
      const parsed = JSON.parse(rawLedger);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (entry: any) =>
            !SAMPLE_SUBMISSION_IDS.has(entry?.entryId) &&
            !SAMPLE_COMPETITION_IDS.has(entry?.competitionId)
        );
        window.localStorage.setItem('proofly_scoring_ledger_v1', JSON.stringify(cleaned));
      }
    }

    // 6. Clean sample governance audit events
    const rawAudit = window.localStorage.getItem('proofly_governance_audit_v1');
    if (rawAudit) {
      const parsed = JSON.parse(rawAudit);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (ev: any) =>
            !SAMPLE_COMPETITION_IDS.has(ev?.competitionId) &&
            !SAMPLE_SUBMISSION_IDS.has(ev?.targetId)
        );
        window.localStorage.setItem('proofly_governance_audit_v1', JSON.stringify(cleaned));
      }
    }

    // 7. Clean sample result publications & policies
    const rawPubs = window.localStorage.getItem('proofly_results_publications_v1');
    if (rawPubs) {
      const parsed = JSON.parse(rawPubs);
      if (parsed && typeof parsed === 'object') {
        for (const compId of SAMPLE_COMPETITION_IDS) {
          delete parsed[compId];
        }
        window.localStorage.setItem('proofly_results_publications_v1', JSON.stringify(parsed));
      }
    }

    const rawPolicies = window.localStorage.getItem('proofly_scoring_policies_v1');
    if (rawPolicies) {
      const parsed = JSON.parse(rawPolicies);
      if (parsed && typeof parsed === 'object') {
        for (const compId of SAMPLE_COMPETITION_IDS) {
          delete parsed[compId];
        }
        window.localStorage.setItem('proofly_scoring_policies_v1', JSON.stringify(parsed));
      }
    }

    window.localStorage.setItem(PURGE_FLAG_KEY, '1');
  } catch {
    // Ignore storage errors in private/restricted browser modes
  }
}
