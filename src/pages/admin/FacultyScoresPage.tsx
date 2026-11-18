// ─────────────────────────────────────────────
// Faculty Scores Console — Academic Assessment Entry & Rubric Management
// Separate authoritative academic scores from automated evaluation
// Preserves reviewer details and audited history of revisions
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react';
import {
  GraduationCap,
  CheckCircle2,
  AlertTriangle,
  Save,
  History,
  X,
  Search,
  Info,
} from 'lucide-react';
import type { Team, FacultyEvaluationCriterion } from '../../types';
import { teamService } from '../../services/teamService';
import { facultyEvaluationService } from '../../services/facultyEvaluationService';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';

export default function FacultyScoresPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  // Form State
  const [reviewerName, setReviewerName] = useState('');
  const [criteria, setCriteria] = useState<FacultyEvaluationCriterion[]>([]);
  const [notes, setNotes] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [problemTitle, setProblemTitle] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    const unsub = teamService.subscribeToTeamsLeaderboard(
      (data) => {
        setTeams(data);
        setLoading(false);
        if (selectedTeam) {
          const fresh = data.find((t) => t.id === selectedTeam.id);
          if (fresh) setSelectedTeam(fresh);
        }
      },
      (err) => {
        console.error('[FacultyScoresPage] Error fetching teams:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [selectedTeam?.id]);

  const handleSelectTeam = async (team: Team) => {
    setSelectedTeam(team);
    setSaveSuccess(null);
    setSaveError(null);
    setProblemTitle(team.problemTitle || 'Assigned Faculty Project');

    const evalData = await facultyEvaluationService.getFacultyEvaluation(team.id);

    if (evalData) {
      setReviewerName(evalData.reviewerName || '');
      setCriteria(evalData.criteria || []);
      setNotes(evalData.notes || '');
      setRevisionReason('');
    } else {
      const blank = facultyEvaluationService.createBlankEvaluation(team.id, team.problemTitle);
      setReviewerName('');
      setCriteria(blank.criteria);
      setNotes('');
      setRevisionReason('');
    }
  };

  const handleScoreChange = (criterionId: string, newScore: number) => {
    setCriteria((prev) =>
      prev.map((c) => (c.id === criterionId ? { ...c, awardedScore: Number(newScore) } : c))
    );
  };

  const handleCriterionCommentChange = (criterionId: string, comments: string) => {
    setCriteria((prev) =>
      prev.map((c) => (c.id === criterionId ? { ...c, comments } : c))
    );
  };

  const totalCalculated = criteria.reduce((sum, c) => sum + (c.awardedScore || 0), 0);
  const maxCalculated = criteria.reduce((sum, c) => sum + (c.maxScore || 25), 0);

  const handleSaveScores = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam) return;

    if (!reviewerName.trim()) {
      setSaveError('Reviewer name or Faculty Identifier is required.');
      return;
    }

    try {
      setSaving(true);
      setSaveError(null);

      const saved = await facultyEvaluationService.submitFacultyEvaluation(
        selectedTeam.id,
        {
          facultyProblemTitle: problemTitle,
          reviewerName: reviewerName.trim(),
          criteria,
          notes,
          status: 'SUBMITTED',
          reason: revisionReason.trim() || undefined,
        },
        reviewerName.trim()
      );

      setSaveSuccess(`Faculty academic score for ${selectedTeam.name} successfully recorded: ${saved.normalizedScore}/100.`);
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (err: any) {
      setSaveError(err?.message || 'Error recording faculty academic score.');
    } finally {
      setSaving(false);
    }
  };

  const filteredTeams = teams.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.repositoryName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.problemTitle && t.problemTitle.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="w-full space-y-6 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <GraduationCap className="text-[#FF1E46]" size={26} />
            <span>Faculty Academic Evaluation Portal</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Authoritative faculty grading &mdash; Academic problem statement fulfillment, rubrics, and reviewed defense scores
          </p>
        </div>
      </div>

      {/* Info Callout */}
      <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/30 text-xs text-blue-300 flex items-start gap-3">
        <Info size={18} className="shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Faculty Academic Scoring Authority:</span> Faculty evaluation represents the primary measure of academic project quality. Scores entered here remain independent of automated AI/Git evaluation and are never silently altered by automated tools.
        </div>
      </div>

      {/* Success / Error Banners */}
      {saveSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>{saveSuccess}</span>
          </div>
          <button onClick={() => setSaveSuccess(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {saveError && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{saveError}</span>
          </div>
          <button onClick={() => setSaveError(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Two Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Squad Selector (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 rounded-2xl bg-[#090C19] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Select Squad ({filteredTeams.length})
              </span>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search squad or problem title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500"
              />
            </div>

            {/* List */}
            {loading ? (
              <LoadingState message="Loading squad list..." />
            ) : filteredTeams.length === 0 ? (
              <EmptyState title="No Squads Found" description="Try clearing your search term." />
            ) : (
              <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
                {filteredTeams.map((team) => {
                  const isSelected = selectedTeam?.id === team.id;
                  const hasScore = team.facultyScore !== undefined && team.facultyScore !== null;

                  return (
                    <div
                      key={team.id}
                      onClick={() => handleSelectTeam(team)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 border-rose-500/80 shadow-[0_0_15px_rgba(255,10,59,0.15)]'
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            <span>{team.name}</span>
                            <span className="text-[10px] text-slate-500 font-normal">
                              ({team.repositoryName})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                            {team.problemTitle || 'Assigned Faculty Project'}
                          </div>
                        </div>

                        {/* Faculty Score Badge */}
                        <div className="shrink-0 text-right">
                          {hasScore ? (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-950/50 text-emerald-300 border border-emerald-500/30">
                              <CheckCircle2 size={11} />
                              <span>{team.facultyScore}%</span>
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/30 text-amber-300 border border-amber-500/30">
                              Pending Review
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
                        <span>Reviewer: {team.facultyEvaluation?.reviewerName || 'Unassigned'}</span>
                        <span>Git/Process: {team.gitProcessScore !== undefined ? `${team.gitProcessScore}%` : 'Pending'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Scoring Form (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {!selectedTeam ? (
            <div className="p-12 rounded-2xl bg-[#090C19] border border-slate-800 text-center space-y-3">
              <GraduationCap className="mx-auto text-slate-600" size={40} />
              <div className="text-sm font-bold text-slate-300">Select a Squad to Grade</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Choose any team from the squad roster to enter faculty rubric scores, problem statements, and evaluation notes.
              </p>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-[#090C19] border border-slate-800 space-y-6">
              {/* Squad Header */}
              <div className="flex items-start justify-between flex-wrap gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Faculty Evaluation &mdash; {selectedTeam.name}</span>
                  </h2>
                  <div className="text-xs text-slate-400 mt-1">
                    Repository: <span className="text-slate-200 font-semibold">{selectedTeam.repositoryName}</span>
                  </div>
                </div>

                {/* Score Summary Box */}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-700/80 text-right">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">Faculty Score</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    {totalCalculated} <span className="text-xs text-slate-500">/ {maxCalculated}</span>
                  </div>
                </div>
              </div>

              {/* Grading Form */}
              <form onSubmit={handleSaveScores} className="space-y-5">
                {/* Problem Statement Title */}
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">
                    Problem Statement / Project Title:
                  </label>
                  <input
                    type="text"
                    value={problemTitle}
                    onChange={(e) => setProblemTitle(e.target.value)}
                    placeholder="e.g. Distributed Ledger Engine"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Reviewer Identifier */}
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">
                    Reviewer Name or Faculty Identifier:
                  </label>
                  <input
                    type="text"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    placeholder="e.g. Prof. R. Ramanathan (Panel A)"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Rubric Criteria Items */}
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Academic Rubric Criteria (Max 100 Points)
                  </div>

                  {criteria.map((c) => (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-bold text-slate-200">{c.name}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{c.description}</div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min="0"
                            max={c.maxScore}
                            value={c.awardedScore}
                            onChange={(e) => handleScoreChange(c.id, Number(e.target.value))}
                            className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-center font-bold text-white focus:outline-none focus:border-rose-500"
                          />
                          <span className="text-xs text-slate-500">/ {c.maxScore}</span>
                        </div>
                      </div>

                      <input
                        type="text"
                        placeholder="Optional feedback / observation for this criterion..."
                        value={c.comments || ''}
                        onChange={(e) => handleCriterionCommentChange(c.id, e.target.value)}
                        className="w-full bg-slate-900/60 border border-slate-800/80 rounded-lg px-2.5 py-1 text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>

                {/* General Evaluation Notes */}
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">
                    Overall Faculty Notes & Defense Feedback:
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes from presentation, defense, and verification..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Revision Reason (if modifying existing score) */}
                {selectedTeam.facultyScore !== undefined && (
                  <div>
                    <label className="text-xs text-slate-300 font-semibold block mb-1">
                      Reason for Revision (Audit Log):
                    </label>
                    <input
                      type="text"
                      value={revisionReason}
                      onChange={(e) => setRevisionReason(e.target.value)}
                      placeholder="e.g. Recalculated after final defense demo..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>
                )}

                {/* Submit button */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-950/40 disabled:opacity-50"
                  >
                    <Save size={14} />
                    <span>{saving ? 'Recording Score...' : 'Submit Faculty Academic Score'}</span>
                  </button>
                </div>
              </form>

              {/* Audit Trail of Past Revisions */}
              {selectedTeam.facultyEvaluation?.auditHistory &&
                selectedTeam.facultyEvaluation.auditHistory.length > 0 && (
                  <div className="space-y-2 pt-4 border-t border-slate-800">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <History size={13} className="text-slate-400" />
                      <span>Audit History of Revisions</span>
                    </h3>
                    <div className="space-y-1.5 text-xs">
                      {selectedTeam.facultyEvaluation.auditHistory.map((item, index) => (
                        <div
                          key={index}
                          className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-[11px]"
                        >
                          <div>
                            <span className="font-semibold text-slate-300">@{item.editedBy}</span>:{' '}
                            <span className="text-slate-400">{item.reason}</span>
                          </div>
                          <div className="text-slate-500 flex items-center gap-2">
                            <span>
                              {item.previousScore}% &rarr; {item.newScore}%
                            </span>
                            <span>&bull;</span>
                            <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
