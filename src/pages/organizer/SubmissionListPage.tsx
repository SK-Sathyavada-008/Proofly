// ─────────────────────────────────────────────
// SubmissionListPage.tsx — Organizer Submissions & Team Management
// Proofly — Phase 5
// ─────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Globe,
  FileText,
  Zap,
  Users,
  User,
  ShieldCheck,
  AlertTriangle,
  Upload,
  FileCheck2,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Tabs } from '../../components/ui/Tabs';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { GithubIcon } from '../../components/ui/GithubIcon';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { competitionService } from '../../services/competitionService';
import { submissionService } from '../../services/submissionService';
import { submissionLifecycleService } from '../../services/submissionLifecycleService';
import { participantTeamService } from '../../services/participantTeamService';
import type { Competition } from '../../types/authAndCompetition';
import type { ProjectSubmission, SubmissionStatus, TeamRecord, ParticipantRecord } from '../../types/submission';

export const SubmissionListPage: React.FC = () => {
  const { activeOrganization, currentUser } = useProoflyAuth();
  const { success, error: toastError, warning } = useToast();

  const [mainView, setMainView] = useState<'submissions' | 'teams'>('submissions');
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string>('');
  const [submissions, setSubmissions] = useState<ProjectSubmission[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [selectedSubmission, setSelectedSubmission] = useState<ProjectSubmission | null>(null);
  const [dossierModalOpen, setDossierModalOpen] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');
  const [isApplyingOverride, setIsApplyingOverride] = useState(false);

  // CSV Import Modal
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvInput, setCsvInput] = useState('');
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  // 1. Load Competitions for Organization
  useEffect(() => {
    if (activeOrganization) {
      competitionService.listOrganizationCompetitions(activeOrganization.id).then((comps) => {
        setCompetitions(comps);
        if (comps.length > 0 && !comps.some((c) => c.id === selectedCompId)) {
          setSelectedCompId(comps[0].id);
        }
      });
    }
  }, [activeOrganization]);

  // 2. Load Submissions & Teams for Selected Competition
  const refreshData = useCallback(async () => {
    if (!selectedCompId) {
      setSubmissions([]);
      setTeams([]);
      setParticipants([]);
      return;
    }
    try {
      const subs = await submissionService.listCompetitionSubmissions(selectedCompId);
      setSubmissions(subs);

      const teamList = await participantTeamService.listCompetitionTeams(selectedCompId);
      setTeams(teamList);

      const partList = await participantTeamService.listCompetitionParticipants(selectedCompId);
      setParticipants(partList);
    } catch (err: any) {
      console.error('Failed to load submissions:', err);
    }
  }, [selectedCompId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Status Filter Tabs
  const statusTabs = [
    { id: 'all', label: 'All Submissions', count: submissions.length },
    {
      id: 'ready_judge',
      label: 'Ready for Judges',
      count: submissions.filter((s) => s.status === 'Ready for Judge Review' || s.status === 'Under Human Review').length,
    },
    {
      id: 'ai_queue',
      label: 'AI Evaluating',
      count: submissions.filter((s) => s.status === 'Queued for AI Evaluation' || s.status === 'AI Evaluation In Progress').length,
    },
    {
      id: 'ai_failed',
      label: 'AI Failed / Needs Override',
      count: submissions.filter((s) => s.status === 'AI Evaluation Failed').length,
    },
    {
      id: 'evaluated',
      label: 'Evaluated / Final',
      count: submissions.filter((s) => s.status === 'Evaluated' || s.status === 'Finalized').length,
    },
    {
      id: 'draft',
      label: 'Drafts',
      count: submissions.filter((s) => s.status === 'Draft').length,
    },
  ];

  const filteredSubmissions = submissions.filter((sub) => {
    if (activeTab === 'ready_judge' && sub.status !== 'Ready for Judge Review' && sub.status !== 'Under Human Review') {
      return false;
    }
    if (activeTab === 'ai_queue' && sub.status !== 'Queued for AI Evaluation' && sub.status !== 'AI Evaluation In Progress') {
      return false;
    }
    if (activeTab === 'ai_failed' && sub.status !== 'AI Evaluation Failed') {
      return false;
    }
    if (activeTab === 'evaluated' && sub.status !== 'Evaluated' && sub.status !== 'Finalized') {
      return false;
    }
    if (activeTab === 'draft' && sub.status !== 'Draft') {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        sub.projectTitle.toLowerCase().includes(q) ||
        (sub.teamName && sub.teamName.toLowerCase().includes(q)) ||
        sub.primaryContactName.toLowerCase().includes(q) ||
        sub.referenceId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Handle Apply AI-Failure Override
  const handleApplyOverride = async () => {
    if (!selectedSubmission || !currentUser) return;
    if (!overrideReason.trim()) {
      warning('Reason Required', 'Please provide an official justification for bypassing AI evaluation.');
      return;
    }

    setIsApplyingOverride(true);
    try {
      const updated = submissionLifecycleService.applyAiFailureOverride(selectedSubmission, {
        organizerUserId: currentUser.uid,
        organizerName: currentUser.displayName,
        reason: overrideReason.trim(),
        justificationNotes: overrideNotes.trim() || undefined,
      });

      await submissionService.saveSubmission(updated);
      await refreshData();
      setSelectedSubmission(updated);
      setOverrideModalOpen(false);
      setOverrideReason('');
      setOverrideNotes('');

      success(
        'AI-Failure Override Applied',
        `Submission ${updated.referenceId} is now unlocked and in "Ready for Judge Review".`
      );
    } catch (err: any) {
      toastError('Override Failed', err.message);
    } finally {
      setIsApplyingOverride(false);
    }
  };

  // Handle CSV Import
  const handleImportCsv = async () => {
    if (!csvInput.trim()) {
      warning('CSV Empty', 'Please paste CSV data with columns: Team Name, Participant Name, Email, Role.');
      return;
    }

    setIsImportingCsv(true);
    try {
      const result = await participantTeamService.importParticipantsFromCsv(
        csvInput,
        selectedCompId,
        activeOrganization?.id || 'org-deepmind'
      );

      if (result.errors.length > 0) {
        warning(
          'Import Completed with Warnings',
          `Created ${result.teamsCreated} teams, ${result.participantsCreated} participants. ${result.errors.length} rows had errors.`
        );
      } else {
        success(
          'CSV Imported Successfully',
          `Created ${result.teamsCreated} teams and ${result.participantsCreated} participants.`
        );
      }

      await refreshData();
      setCsvModalOpen(false);
      setCsvInput('');
    } catch (err: any) {
      toastError('Import Failed', err.message);
    } finally {
      setIsImportingCsv(false);
    }
  };

  const getStatusBadge = (status: SubmissionStatus) => {
    switch (status) {
      case 'Draft':
        return <Badge variant="neutral" size="sm">Draft</Badge>;
      case 'Submitted':
      case 'Validating':
        return <Badge variant="primary" size="sm">Submitted</Badge>;
      case 'Queued for AI Evaluation':
      case 'AI Evaluation In Progress':
        return (
          <Badge variant="purple" size="sm">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse mr-1" />
            AI Processing
          </Badge>
        );
      case 'AI Evaluation Failed':
        return <Badge variant="danger" size="sm">AI Failed</Badge>;
      case 'AI Evaluation Complete':
      case 'Ready for Judge Review':
        return <Badge variant="success" size="sm">Ready for Judges</Badge>;
      case 'Under Human Review':
        return <Badge variant="warning" size="sm">Under Review</Badge>;
      case 'Evaluated':
      case 'Finalized':
        return <Badge variant="success" size="sm">Evaluated</Badge>;
      default:
        return <Badge variant="neutral" size="sm">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Submissions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {competitions.length > 0 && (
              <select
                value={selectedCompId}
                onChange={(e) => setSelectedCompId(e.target.value)}
                className="text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600 dark:focus:border-blue-400"
              >
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center bg-slate-100 dark:bg-slate-900 p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMainView('submissions')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                  mainView === 'submissions'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Submissions ({submissions.length})
              </button>
              <button
                type="button"
                onClick={() => setMainView('teams')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                  mainView === 'teams'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Teams ({teams.length + participants.filter((p) => !p.teamId).length})
              </button>
            </div>

            <Button
              variant="outline"
              size="xs"
              onClick={refreshData}
              title="Refresh submissions"
              leftIcon={<RefreshCw size={12} />}
            >
              Refresh
            </Button>

            {mainView === 'teams' && (
              <Button
                variant="primary"
                size="xs"
                onClick={() => setCsvModalOpen(true)}
                leftIcon={<Upload size={13} />}
              >
                Import CSV
              </Button>
            )}
          </div>
        }
      />

      {/* ── VIEW 1: SUBMISSIONS & AI EVALUATION PIPELINE ── */}
      {mainView === 'submissions' && (
        <div className="space-y-4">
          <Tabs tabs={statusTabs} activeTab={activeTab} onChange={setActiveTab} />

          {/* Search bar & telemetry */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-96">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, team, contact, or PF-SUB-..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-600 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-600/15 transition-colors"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Mandatory AI Gate: <span className="text-emerald-600 dark:text-emerald-400 font-bold">Enforced</span>
              </span>
            </div>
          </div>

          {/* Submissions Table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference & Title</TableHead>
                <TableHead>Submitter / Team</TableHead>
                <TableHead>Artifacts</TableHead>
                <TableHead>AI Status / Score</TableHead>
                <TableHead>Lifecycle State</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSubmissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-slate-500 dark:text-slate-400 text-xs">
                    No submissions found in this status category.
                  </TableCell>
                </TableRow>
              ) : (
                filteredSubmissions.map((sub) => (
                  <TableRow key={sub.id}>
                    {/* Reference & Title */}
                    <TableCell>
                      <div className="space-y-0.5 max-w-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-500/30">
                            {sub.referenceId}
                          </span>
                          {sub.isLate && (
                            <Badge variant="danger" size="sm">
                              LATE
                            </Badge>
                          )}
                        </div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs line-clamp-1">
                          {sub.projectTitle}
                        </span>
                      </div>
                    </TableCell>

                    {/* Submitter / Team */}
                    <TableCell>
                      <div className="space-y-0.5 text-xs">
                        <div className="flex items-center gap-1 font-medium text-slate-800 dark:text-slate-200">
                          {sub.submissionType === 'TEAM' ? (
                            <Users size={12} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          ) : (
                            <User size={12} className="text-slate-500 dark:text-slate-400 shrink-0" />
                          )}
                          <span>{sub.submissionType === 'TEAM' ? sub.teamName : sub.primaryContactName}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 block">
                          {sub.primaryContactEmail || 'No contact email'}
                        </span>
                      </div>
                    </TableCell>

                    {/* Artifacts */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {sub.githubUrl && (
                          <a
                            href={sub.githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                            title="GitHub Repo"
                          >
                            <GithubIcon size={14} />
                          </a>
                        )}
                        {sub.deploymentUrl && (
                          <a
                            href={sub.deploymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                            title="Live Demo"
                          >
                            <Globe size={14} />
                          </a>
                        )}
                        {sub.files && sub.files.length > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-300"
                            title={`${sub.files.length} verified file(s) attached`}
                          >
                            <FileCheck2 size={11} className="text-emerald-600 dark:text-emerald-400" />
                            {sub.files.length}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* AI Status / Score */}
                    <TableCell>
                      {sub.status === 'AI Evaluation Failed' ? (
                        <div className="space-y-1">
                          <span className="flex items-center gap-1 text-[11px] font-bold text-red-600 dark:text-rose-400">
                            <AlertTriangle size={12} />
                            AI Failed
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSubmission(sub);
                              setOverrideModalOpen(true);
                            }}
                            className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 underline hover:text-amber-900 dark:hover:text-amber-300 block cursor-pointer"
                          >
                            Apply Override →
                          </button>
                        </div>
                      ) : sub.aiScore !== undefined ? (
                        <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-blue-700 dark:text-blue-400">
                          <Zap size={12} className="text-amber-500 dark:text-amber-400" />
                          <span>{sub.aiScore} / 100</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </TableCell>

                    {/* Lifecycle State */}
                    <TableCell>{getStatusBadge(sub.status)}</TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            setSelectedSubmission(sub);
                            setDossierModalOpen(true);
                          }}
                        >
                          Dossier
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── VIEW 2: TEAMS & PARTICIPANTS REGISTRY ── */}
      {mainView === 'teams' && (
        <div className="space-y-6">
          {/* Teams Table */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Users size={16} className="text-blue-600 dark:text-blue-400" />
              <span>Registered Teams ({teams.length})</span>
            </h3>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team Name</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Lead Submitter</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-slate-400 dark:text-slate-500 text-xs">
                      No teams registered yet. Use "Import CSV" above to bulk-register teams.
                    </TableCell>
                  </TableRow>
                ) : (
                  teams.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs">{t.name}</span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                          {t.members.map((m) => (
                            <div key={m.id} className="flex items-center gap-1.5">
                              <span className="font-medium">{m.name}</span>
                              {m.role && <span className="text-slate-400 dark:text-slate-500 text-[10px]">({m.role})</span>}
                              {m.isLead && (
                                <Badge variant="primary" size="sm">
                                  Lead
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{t.leadEmail || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral" size="sm">
                          {t.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Solo Participants Table */}
          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <User size={16} className="text-slate-600 dark:text-slate-400" />
              <span>Solo Participants ({participants.filter((p) => !p.teamId).length})</span>
            </h3>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>GitHub</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {participants.filter((p) => !p.teamId).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-slate-400 dark:text-slate-500 text-xs">
                      No solo participants registered yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  participants
                    .filter((p) => !p.teamId)
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs">{p.name}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-600 dark:text-slate-300">{p.email || '—'}</span>
                        </TableCell>
                        <TableCell>
                          {p.githubUsername ? (
                            <span className="font-mono text-xs text-blue-600 dark:text-blue-400">@{p.githubUsername}</span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral" size="sm">
                            {p.source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            {new Date(p.createdAt).toLocaleDateString()}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ── MODAL: INSPECT SUBMISSION DOSSIER ── */}
      {selectedSubmission && (
        <Modal
          isOpen={dossierModalOpen}
          onClose={() => setDossierModalOpen(false)}
          title={`Submission Dossier: ${selectedSubmission.referenceId}`}
          maxWidth="lg"
        >
          <div className="space-y-5 text-xs text-slate-700 dark:text-slate-300">
            {/* Top Meta */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{selectedSubmission.projectTitle}</span>
                {getStatusBadge(selectedSubmission.status)}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-slate-500 dark:text-slate-400 text-[11px]">
                <span>Type: <strong className="text-slate-800 dark:text-slate-200">{selectedSubmission.submissionType}</strong></span>
                <span>•</span>
                <span>Contact: <strong className="text-slate-800 dark:text-slate-200">{selectedSubmission.primaryContactName}</strong></span>
                {selectedSubmission.primaryContactEmail && (
                  <>
                    <span>•</span>
                    <span>{selectedSubmission.primaryContactEmail}</span>
                  </>
                )}
                <span>•</span>
                <span>Version: <strong className="text-slate-800 dark:text-slate-200">v{selectedSubmission.currentVersion}</strong></span>
              </div>
            </div>

            {/* Problem Statement & Solution */}
            {selectedSubmission.problemStatement && (
              <div className="space-y-1">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">Problem Statement</span>
                <p className="p-3 bg-white dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 leading-relaxed">
                  {selectedSubmission.problemStatement}
                </p>
              </div>
            )}

            {selectedSubmission.solution && (
              <div className="space-y-1">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">Proposed Solution</span>
                <p className="p-3 bg-white dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 leading-relaxed">
                  {selectedSubmission.solution}
                </p>
              </div>
            )}

            {/* Project Description */}
            <div className="space-y-1">
              <span className="font-semibold text-slate-900 dark:text-slate-100 block">Comprehensive Description</span>
              <p className="p-3 bg-white dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                {selectedSubmission.projectDescription}
              </p>
            </div>

            {/* Tech Stack */}
            {selectedSubmission.technologiesUsed && selectedSubmission.technologiesUsed.length > 0 && (
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">Technologies & Tools</span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSubmission.technologiesUsed.map((tech) => (
                    <span
                      key={tech}
                      className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[11px]"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Verified File Attachments */}
            {selectedSubmission.files && selectedSubmission.files.length > 0 && (
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                  Verified Attachments ({selectedSubmission.files.length})
                </span>
                <div className="space-y-1.5">
                  {selectedSubmission.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/80"
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200 block text-xs">
                            {file.fileName}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            {(file.fileSize / 1024).toFixed(1)} KB · Magic Bytes Verified
                          </span>
                        </div>
                      </div>
                      <Badge variant="success" size="sm">
                        Verified Binary
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Failure Override Details if exists */}
            {selectedSubmission.aiFailureOverride && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <ShieldCheck size={14} className="text-amber-700 dark:text-amber-400" />
                  <span>AI-Failure Override Applied</span>
                </div>
                <p className="text-[11px]">
                  Reason: {selectedSubmission.aiFailureOverride.reason}
                </p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  By {selectedSubmission.aiFailureOverride.overriddenByName} on{' '}
                  {new Date(selectedSubmission.aiFailureOverride.overriddenAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── MODAL: APPLY AI-FAILURE OVERRIDE ── */}
      {selectedSubmission && (
        <Modal
          isOpen={overrideModalOpen}
          onClose={() => setOverrideModalOpen(false)}
          title="Apply Organizer AI-Failure Override"
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-red-50 dark:bg-rose-500/10 border border-red-200 dark:border-rose-500/30 text-red-800 dark:text-rose-200 flex items-start gap-2.5">
              <AlertTriangle size={18} className="text-red-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-xs">Mandatory AI Gate Override</p>
                <p className="text-[11px] text-red-700 dark:text-rose-300/90 mt-0.5 leading-relaxed">
                  Judges cannot normally review submissions that fail automated AI evaluation. Applying an
                  override transitions this submission to <strong>Ready for Judge Review</strong> and documents
                  your authorized justification in the immutable audit ledger.
                </p>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Override Reason <span className="text-red-500 dark:text-rose-400">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Rate limit timeout during AST parser; code verified manually by organizer."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-600 dark:focus:border-blue-400"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Optional Justification Notes
              </label>
              <Textarea
                rows={3}
                placeholder="Provide additional details regarding manual inspection or fallback instructions for human judges..."
                value={overrideNotes}
                onChange={(e) => setOverrideNotes(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="secondary" size="sm" onClick={() => setOverrideModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={isApplyingOverride}
                onClick={handleApplyOverride}
                leftIcon={<ShieldCheck size={14} />}
              >
                Confirm & Unlock Submission
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: IMPORT CSV ── */}
      <Modal
        isOpen={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        title="Import Participants and Teams via CSV"
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-[11px]">
            Batch import pre-registered participants and teams. Format columns as:
            <code className="block mt-1 p-2 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300 font-mono text-[10px]">
              Team Name, Participant Name, Email, Role, GitHub Username, Is Lead
            </code>
          </p>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Paste CSV Data</label>
            <Textarea
              rows={6}
              placeholder={`Team Alpha, Alice Smith, alice@example.com, Team Lead, alicesmith, true\nTeam Alpha, Bob Jones, bob@example.com, Frontend Dev, bobjones, false\n, Carol Solo, carol@solo.dev, Solo Creator, carolsolo, true`}
              value={csvInput}
              onChange={(e) => setCsvInput(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" size="sm" onClick={() => setCsvModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={isImportingCsv}
              onClick={handleImportCsv}
              leftIcon={<Upload size={14} />}
            >
              Parse & Import
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};