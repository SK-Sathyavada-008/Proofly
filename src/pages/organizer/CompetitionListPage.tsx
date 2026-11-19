import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  ExternalLink,
  Copy,
  Check,
  Calendar,
  AlertTriangle,
  Play,
  Lock,
  Sparkles,
  Award,
  Archive,
  ShieldCheck,
  Layers,
  X,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { competitionService } from '../../services/competitionService';
import { competitionLifecycleService } from '../../services/competitionLifecycleService';
import { accessManagementService } from '../../services/accessManagementService';
import { authorizationService } from '../../services/authorizationService';
import type {
  Competition,
  CompetitionStatus,
  CompetitionType,
  ParticipationType,
  CompetitionVisibility,
} from '../../types/authAndCompetition';

export const CompetitionListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeOrganization, currentUser, verifiedSession, canManageCurrentOrg, loading: authLoading } = useProoflyAuth();
  const { success, error: toastError } = useToast();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(
    searchParams.get('action') === 'create'
  );
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Phase 3 Form State for New Competition
  const [newTitle, setNewTitle] = useState('');
  const [newTagline, setNewTagline] = useState('');
  const [newType, setNewType] = useState<CompetitionType>('HACKATHON');
  const [newParticipation, setNewParticipation] = useState<ParticipationType>('BOTH');
  const [newVisibility, setNewVisibility] = useState<CompetitionVisibility>('PUBLIC');
  const [newDeadline, setNewDeadline] = useState(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [minMembers, setMinMembers] = useState(1);
  const [maxMembers, setMaxMembers] = useState(4);
  const [allowLate, setAllowLate] = useState(false);
  const [allowEdits, setAllowEdits] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(true); // Mandatory for hackathon demo
  const [feedbackVisible, setFeedbackVisible] = useState(true);
  const [aiScoresVisible, setAiScoresVisible] = useState(true);
  const [tracks, setTracks] = useState<string[]>([
    'Healthcare & Edge AI',
    'Event Tech & Community Discovery',
    'Climate & CleanTech',
    'FinTech & Web3',
  ]);
  const [trackInput, setTrackInput] = useState('');
  const [isOpenTrackEnabled, setIsOpenTrackEnabled] = useState(true);

  // Load competitions for active organization
  const fetchCompetitions = useCallback(async () => {
    if (!activeOrganization) {
      if (!authLoading) {
        setCompetitions([]);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const data = await competitionService.listOrganizationCompetitions(activeOrganization.id);
      setCompetitions(data);
    } catch (err: any) {
      toastError('Failed to load competitions', err.message);
    } finally {
      setLoading(false);
    }
  }, [activeOrganization, authLoading, toastError]);

  useEffect(() => {
    fetchCompetitions();
  }, [fetchCompetitions]);

  const tabs = [
    { id: 'all', label: 'All Competitions', count: competitions.length },
    {
      id: 'active',
      label: 'Active & Open',
      count: competitions.filter((c) => c.status === 'ACTIVE' || c.status === 'REGISTRATION_OPEN' || c.status === 'REGISTRATION_CLOSED').length,
    },
    {
      id: 'evaluation',
      label: 'In Evaluation',
      count: competitions.filter((c) => c.status === 'EVALUATION' || c.status === 'RESULTS_REVIEW' || c.status === 'SUBMISSIONS_CLOSED').length,
    },
    {
      id: 'draft',
      label: 'Drafts',
      count: competitions.filter((c) => c.status === 'DRAFT').length,
    },
    {
      id: 'archived',
      label: 'Archived',
      count: competitions.filter((c) => c.status === 'ARCHIVED').length,
    },
  ];

  const filteredCompetitions = competitions.filter((comp) => {
    if (activeTab === 'active' && comp.status !== 'ACTIVE' && comp.status !== 'REGISTRATION_OPEN' && comp.status !== 'REGISTRATION_CLOSED') return false;
    if (activeTab === 'evaluation' && comp.status !== 'EVALUATION' && comp.status !== 'RESULTS_REVIEW' && comp.status !== 'SUBMISSIONS_CLOSED') return false;
    if (activeTab === 'draft' && comp.status !== 'DRAFT') return false;
    if (activeTab === 'archived' && comp.status !== 'ARCHIVED') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        comp.title.toLowerCase().includes(q) ||
        comp.tagline.toLowerCase().includes(q) ||
        comp.publicAccessCode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleCopyLink = (code: string) => {
    const url = `${window.location.origin}/submit?code=${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    success('Public Submission Link Copied', url);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  // Phase 3 Lifecycle Transition Handler
  const handleTransition = async (comp: Competition, nextStatus: CompetitionStatus) => {
    try {
      await authorizationService.assertAuthorized(verifiedSession, {
        operation: 'COMPETITION_MANAGE',
        organizationId: comp.organizationId,
        competitionId: comp.id,
      });
      await competitionService.transitionStatus(comp.id, nextStatus);
      success(
        `Lifecycle Updated: ${nextStatus}`,
        `Competition "${comp.title}" successfully moved from ${comp.status} to ${nextStatus}.`
      );
      await fetchCompetitions();
    } catch (err: any) {
      toastError('Lifecycle Transition Denied', err.message);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganization || !currentUser) return;

    try {
      await authorizationService.assertAuthorized(verifiedSession, {
        operation: 'COMPETITION_CREATE',
        organizationId: activeOrganization.id,
      });
      const created = await competitionService.createCompetition(
        activeOrganization.id,
        currentUser.uid,
        currentUser.email,
        currentUser.displayName,
        {
          title: newTitle,
          tagline: newTagline,
          type: newType,
          status: 'DRAFT',
          participationType: newParticipation,
          visibility: newVisibility,
          tracks: tracks.length > 0 ? tracks : ['Healthcare & Edge AI', 'Event Tech & Community Discovery'],
          isOpenTrackEnabled,
          openTrackDescription: 'Open Track: General innovation with zero domain-relevance penalties.',
          policies: {
            teamSubmissionsEnabled: newParticipation !== 'INDIVIDUAL',
            minTeamMembers: minMembers,
            maxTeamMembers: maxMembers,
            individualSubmissionsAllowed: newParticipation !== 'TEAM',
            submissionDeadline: new Date(newDeadline).toISOString(),
            allowLateSubmissions: allowLate,
            allowSubmissionEdits: allowEdits,
            aiEvaluationEnabled: aiEnabled,
            judgeFeedbackVisibleToParticipants: feedbackVisible,
            aiScoresVisibleToParticipants: aiScoresVisible,
          },
        }
      );

      // Auto-provision public access key immediately
      try {
        await accessManagementService.generatePublicAccessKey(created.id, created.publicAccessCode);
      } catch {
        // Fallback
      }

      success('Competition Created as Draft', `"${created.title}" is saved in Draft mode. Open registration or launch when ready.`);
      setIsCreateModalOpen(false);
      setSearchParams({});
      // Reset form
      setNewTitle('');
      setNewTagline('');
      await fetchCompetitions();
    } catch (err: any) {
      toastError('Creation Failed', err.message);
    }
  };

  const getStatusBadge = (status: CompetitionStatus) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="neutral" size="sm">Draft</Badge>;
      case 'REGISTRATION_OPEN':
        return <Badge variant="primary" size="sm" dot>Registration Open</Badge>;
      case 'REGISTRATION_CLOSED':
        return <Badge variant="warning" size="sm" dot>Registration Closed</Badge>;
      case 'ACTIVE':
        return <Badge variant="success" size="sm" dot>Active</Badge>;
      case 'EVALUATION':
        return <Badge variant="warning" size="sm" dot>Evaluation</Badge>;
      case 'RESULTS_REVIEW':
        return <Badge variant="purple" size="sm" dot>Results Review</Badge>;
      case 'PUBLISHED':
        return <Badge variant="primary" size="sm" dot>Published</Badge>;
      case 'SUBMISSIONS_CLOSED':
        return <Badge variant="neutral" size="sm" dot>Submissions Closed</Badge>;
      case 'ARCHIVED':
        return <Badge variant="neutral" size="sm">Archived</Badge>;
      default:
        return <Badge variant="neutral" size="sm">Draft</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Competitions"
        actions={
          <Button
            variant="primary"
            size="xs"
            leftIcon={<Plus size={13} />}
            onClick={() => setIsCreateModalOpen(true)}
            disabled={!canManageCurrentOrg}
            title={!canManageCurrentOrg ? 'Requires Organization Owner or Admin role' : ''}
          >
            Create competition
          </Button>
        }
      />

      {!canManageCurrentOrg && (
        <div className="px-3.5 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Read-only access as Judge. Switch to Organizer to manage competitions.</span>
        </div>
      )}

      {/* Tabs and Filter Bar */}
      <div className="space-y-4">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, tagline, or code..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-600 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-600/15 transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto text-xs text-slate-500 dark:text-slate-400">
            <span>Showing <strong className="text-slate-800 dark:text-slate-200">{filteredCompetitions.length}</strong> competitions</span>
          </div>
        </div>
      </div>

      {/* Competitions Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Competition Name</TableHead>
            <TableHead>Type & Scope</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Public Access Code</TableHead>
            <TableHead>Policies</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead className="text-right">Lifecycle Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-slate-400 dark:text-slate-500 text-xs">
                Loading organization competitions...
              </TableCell>
            </TableRow>
          ) : filteredCompetitions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-10 text-slate-500 dark:text-slate-400 text-xs">
                No competitions found in this filter.
              </TableCell>
            </TableRow>
          ) : (
            filteredCompetitions.map((comp) => {
              const allowedTransitions = competitionLifecycleService.getAllowedTransitions(comp.status);

              return (
                <TableRow key={comp.id}>
                  {/* Title & Tagline */}
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{comp.title}</span>
                        {comp.visibility === 'PRIVATE' && (
                          <Badge variant="neutral" size="sm">Private</Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{comp.tagline}</p>
                    </div>
                  </TableCell>

                  {/* Type & Participation */}
                  <TableCell>
                    <div className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-medium">{comp.type.replace('_', ' ')}</span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 capitalize">
                        {comp.participationType.toLowerCase()} (1-{comp.policies.maxTeamMembers} max)
                      </p>
                    </div>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    {getStatusBadge(comp.status)}
                  </TableCell>

                  {/* Public Code */}
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold">
                        {comp.publicAccessCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(comp.publicAccessCode)}
                        className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        title="Copy Public Submission URL"
                      >
                        {copiedCode === comp.publicAccessCode ? (
                          <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                  </TableCell>

                  {/* Policies */}
                  <TableCell>
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {comp.policies.aiEvaluationEnabled && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 font-medium border border-purple-200 dark:border-purple-500/30">
                          AI Gate
                        </span>
                      )}
                      {comp.policies.allowSubmissionEdits && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          Edits OK
                        </span>
                      )}
                      {comp.policies.allowLateSubmissions && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                          Late OK
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Deadlines */}
                  <TableCell>
                    <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
                      <Calendar size={12} className="text-slate-400 dark:text-slate-500 shrink-0" />
                      <span>{comp.policies.submissionDeadline.split('T')[0]}</span>
                    </div>
                  </TableCell>

                  {/* Lifecycle Actions */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Public form preview */}
                      <Link to={`/submit?code=${comp.publicAccessCode}`}>
                        <Button variant="ghost" size="xs" title="Open Public Submission Portal">
                          <ExternalLink size={13} />
                        </Button>
                      </Link>

                      {/* State Machine Transition Quick Actions */}
                      {canManageCurrentOrg && (
                        <>
                          {comp.status === 'DRAFT' && allowedTransitions.includes('REGISTRATION_OPEN') && (
                            <Button
                              variant="secondary"
                              size="xs"
                              leftIcon={<Play size={12} />}
                              onClick={() => handleTransition(comp, 'REGISTRATION_OPEN')}
                              title="Open Participant Registration"
                            >
                              Open Reg
                            </Button>
                          )}

                          {comp.status === 'REGISTRATION_OPEN' && allowedTransitions.includes('REGISTRATION_CLOSED') && (
                            <Button
                              variant="secondary"
                              size="xs"
                              leftIcon={<Lock size={12} />}
                              onClick={() => handleTransition(comp, 'REGISTRATION_CLOSED')}
                              title="Close Participant Registration"
                            >
                              Close Reg
                            </Button>
                          )}

                          {(comp.status === 'DRAFT' || comp.status === 'REGISTRATION_OPEN' || comp.status === 'REGISTRATION_CLOSED') && allowedTransitions.includes('ACTIVE') && (
                            <Button
                              variant="primary"
                              size="xs"
                              leftIcon={<Play size={12} />}
                              onClick={() => handleTransition(comp, 'ACTIVE')}
                              title="Open Submissions & Activate"
                            >
                              Activate
                            </Button>
                          )}

                          {comp.status === 'ACTIVE' && allowedTransitions.includes('SUBMISSIONS_CLOSED') && (
                            <Button
                              variant="secondary"
                              size="xs"
                              leftIcon={<Lock size={12} />}
                              onClick={() => handleTransition(comp, 'SUBMISSIONS_CLOSED')}
                            >
                              Close Submissions
                            </Button>
                          )}

                          {comp.status === 'SUBMISSIONS_CLOSED' && allowedTransitions.includes('EVALUATION') && (
                            <Button
                              variant="secondary"
                              size="xs"
                              leftIcon={<Sparkles size={12} />}
                              onClick={() => handleTransition(comp, 'EVALUATION')}
                            >
                              Start Evaluation
                            </Button>
                          )}

                          {comp.status === 'EVALUATION' && allowedTransitions.includes('RESULTS_REVIEW') && (
                            <Button
                              variant="secondary"
                              size="xs"
                              leftIcon={<ShieldCheck size={12} />}
                              onClick={() => handleTransition(comp, 'RESULTS_REVIEW')}
                            >
                              Review Results
                            </Button>
                          )}

                          {comp.status === 'RESULTS_REVIEW' && allowedTransitions.includes('PUBLISHED') && (
                            <Button
                              variant="primary"
                              size="xs"
                              leftIcon={<Award size={12} />}
                              onClick={() => handleTransition(comp, 'PUBLISHED')}
                            >
                              Publish Results
                            </Button>
                          )}

                          {comp.status !== 'ARCHIVED' && allowedTransitions.includes('ARCHIVED') && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => handleTransition(comp, 'ARCHIVED')}
                              title="Archive Competition"
                            >
                              <Archive size={12} />
                            </Button>
                          )}
                        </>
                      )}

                      <Link to={`/organizer/forms?comp=${comp.id}`}>
                        <Button variant="outline" size="xs" title="Form Builder & Access Keys">
                          Forms & Keys
                        </Button>
                      </Link>

                      <Link to={`/organizer/submissions?comp=${comp.id}`}>
                        <Button variant="outline" size="xs">
                          Submissions
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {/* Phase 3: Create Competition Comprehensive Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setSearchParams({});
        }}
        title="Configure & Launch New Competition"
        description="Define submission rules, participation parameters, AI gating, and evaluation rubrics."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsCreateModalOpen(false);
                setSearchParams({});
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreateSubmit}>
              Create & Launch Competition
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <Input
            label="Competition Title"
            required
            placeholder="e.g. Next-Gen Hybrid AI Innovation Challenge 2026"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />

          <Input
            label="Tagline / Short Summary"
            placeholder="Brief 1-line description of the competition"
            value={newTagline}
            onChange={(e) => setNewTagline(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Competition Type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as CompetitionType)}
              options={[
                { value: 'HACKATHON', label: 'Hackathon' },
                { value: 'INNOVATION_CHALLENGE', label: 'Innovation Challenge' },
                { value: 'RESEARCH_SYMPOSIUM', label: 'Research Symposium' },
                { value: 'PROJECT_EXHIBITION', label: 'Project Exhibition' },
                { value: 'ACADEMIC_COMPETITION', label: 'Academic Competition' },
              ]}
            />

            <Select
              label="Participation Mode"
              value={newParticipation}
              onChange={(e) => setNewParticipation(e.target.value as ParticipationType)}
              options={[
                { value: 'BOTH', label: 'Individual & Team Submissions' },
                { value: 'TEAM', label: 'Teams Only' },
                { value: 'INDIVIDUAL', label: 'Individual Only' },
              ]}
            />

            <Select
              label="Visibility Scope"
              value={newVisibility}
              onChange={(e) => setNewVisibility(e.target.value as CompetitionVisibility)}
              options={[
                { value: 'PUBLIC', label: 'Public (Direct link & Discoverable)' },
                { value: 'UNLISTED', label: 'Unlisted (Access Code Only)' },
                { value: 'PRIVATE', label: 'Private (Assigned Judges Only)' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Submission Deadline"
              type="date"
              required
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
            />

            <Input
              label="Min Team Size"
              type="number"
              min="1"
              max="10"
              value={minMembers}
              onChange={(e) => setMinMembers(parseInt(e.target.value) || 1)}
            />

            <Input
              label="Max Team Size"
              type="number"
              min="1"
              max="10"
              value={maxMembers}
              onChange={(e) => setMaxMembers(parseInt(e.target.value) || 4)}
            />
          </div>

          {/* Competition Themes & Tracks Configuration */}
          <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-500/10 rounded-xl border border-indigo-200/80 dark:border-indigo-500/25 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wider">
                <Layers size={14} className="text-indigo-600 dark:text-indigo-400" />
                <span>Competition Themes & Tracks</span>
              </div>
              <span className="text-[11px] text-indigo-700 dark:text-indigo-300">Used for AI Theme Relevance Verification</span>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Active Tracks (Submissions evaluated for relevance to their chosen track)
              </label>

              <div className="flex flex-wrap gap-1.5 min-h-[38px] p-2 bg-white dark:bg-slate-900 rounded-lg border border-indigo-200 dark:border-indigo-500/30">
                {tracks.map((t, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-500/30"
                  >
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => setTracks(tracks.filter((_, i) => i !== idx))}
                      className="text-indigo-500 dark:text-indigo-300 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer p-0.5 rounded transition-colors"
                      title="Remove track"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>

              {/* Add Custom Track Input */}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Add a track (e.g. Healthcare & Edge AI, FinTech, Event Tech)..."
                  value={trackInput}
                  onChange={(e) => setTrackInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (trackInput.trim() && !tracks.includes(trackInput.trim())) {
                        setTracks([...tracks, trackInput.trim()]);
                        setTrackInput('');
                      }
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (trackInput.trim() && !tracks.includes(trackInput.trim())) {
                      setTracks([...tracks, trackInput.trim()]);
                      setTrackInput('');
                    }
                  }}
                >
                  Add
                </Button>
              </div>

              {/* Quick Preset Track Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">Popular presets:</span>
                {[
                  'Healthcare & Edge AI',
                  'Event Tech & Social Discovery',
                  'AI Agents & Automation',
                  'Climate & CleanTech',
                  'FinTech & Web3',
                  'EdTech & Learning',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      if (!tracks.includes(preset)) {
                        setTracks([...tracks, preset]);
                      }
                    }}
                    className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      tracks.includes(preset)
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500'
                    }`}
                  >
                    + {preset}
                  </button>
                ))}
              </div>

              {/* Open Track Toggle */}
              <div className="pt-2 border-t border-indigo-100 dark:border-indigo-500/20">
                <label className="flex items-start gap-2.5 text-xs text-indigo-950 dark:text-indigo-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOpenTrackEnabled}
                    onChange={(e) => setIsOpenTrackEnabled(e.target.checked)}
                    className="mt-0.5 rounded border-indigo-300 dark:border-indigo-500/50 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <strong className="block text-indigo-900 dark:text-indigo-200">
                      Enable Open Track (General Innovation & Cross-Domain Ideas)
                    </strong>
                    <span className="text-[11px] text-indigo-700 dark:text-indigo-300/90">
                      Allows participants to submit projects outside specific themes without receiving an AI theme-misalignment deduction.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Phase 3 Configuration Policies */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2.5">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Competition Policies & Evaluation Settings
            </p>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <strong>AI Pre-Evaluation Gate</strong> (Mandatory for demo: runs Gemini Nano 4 / Cloud)
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowEdits}
                  onChange={(e) => setAllowEdits(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                <span>Allow participants to edit or replace submissions before deadline</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowLate}
                  onChange={(e) => setAllowLate(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                <span>Accept late submissions (flagged for judge review)</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={feedbackVisible}
                  onChange={(e) => setFeedbackVisible(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                <span>Share human judge feedback with participants upon publishing results</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiScoresVisible}
                  onChange={(e) => setAiScoresVisible(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                <span>Display AI pre-scores & reasoning to participants upon publish</span>
              </label>
            </div>
          </div>

          {/* Rubric Preview */}
          <div className="p-3 bg-blue-50/60 dark:bg-blue-500/10 rounded-xl border border-blue-200/80 dark:border-blue-500/25 text-xs space-y-1.5">
            <span className="font-semibold text-blue-900 dark:text-blue-200">Standard 4-Dimensional Rubric (100% Weight)</span>
            <ul className="text-blue-800 dark:text-blue-300/90 text-[11px] grid grid-cols-2 gap-1 pt-1">
              <li>• Technological Implementation (25%)</li>
              <li>• Design & User Experience (25%)</li>
              <li>• Potential Impact (25%)</li>
              <li>• Quality of the Idea (25%)</li>
            </ul>
          </div>
        </form>
      </Modal>
    </div>
  );
};
