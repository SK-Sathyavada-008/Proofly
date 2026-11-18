// ─────────────────────────────────────────────
// ParticipantSubmissionPage.tsx — Complete Dynamic Anonymous Submission Portal
// Proofly — Phase 5
// ─────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Send,
  Save,
  Users,
  User,
  UploadCloud,
  FileText,
  Plus,
  Trash2,
  AlertCircle,
  Layers,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { GithubIcon } from '../../components/ui/GithubIcon';
import { useToast } from '../../components/ui/Toast';
import { SubmissionConfirmationView } from '../../components/submission/SubmissionConfirmationView';
import { formBuilderService } from '../../services/formBuilderService';
import { accessManagementService } from '../../services/accessManagementService';
import { submissionService } from '../../services/submissionService';
import { fileStorageService } from '../../services/fileStorageService';
import type { Competition } from '../../types/authAndCompetition';
import type { SubmissionFormField, SubmissionSessionToken } from '../../types/formAndAccess';
import type { SubmissionCreationResult, StoredFileMetadata } from '../../types/submission';

export const ParticipantSubmissionPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const codeParam = searchParams.get('code') || '';
  const tokenParam = searchParams.get('token') || '';

  // Access & Session State
  const [accessInput, setAccessInput] = useState(codeParam || tokenParam);
  const [isValidatingAccess, setIsValidatingAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [session, setSession] = useState<SubmissionSessionToken | null>(null);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [_schema, setSchema] = useState<any>(null);

  // Form Fields State
  const [submissionType, setSubmissionType] = useState<'INDIVIDUAL' | 'TEAM'>('TEAM');
  const [teamName, setTeamName] = useState('');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [teamMembers, setTeamMembers] = useState<
    { name: string; email?: string; role?: string; githubUsername?: string; isLead?: boolean }[]
  >([{ name: '', email: '', role: 'Team Lead', isLead: true }]);

  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [solution, setSolution] = useState('');
  const [technologiesUsed, setTechnologiesUsed] = useState<string[]>([]);
  const [techInput, setTechInput] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [deploymentUrl, setDeploymentUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [dynamicValues] = useState<Record<string, any>>({});

  // Files
  const [uploadedFiles, setUploadedFiles] = useState<StoredFileMetadata[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  // Submission Flow
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<SubmissionCreationResult | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<string>('Open Track');

  // 1. Initial Access Verification
  const verifyAndInitializeAccess = useCallback(
    async (codeOrToken: string) => {
      if (!codeOrToken.trim()) return;
      setIsValidatingAccess(true);
      setAccessError(null);

      try {
        const result = await accessManagementService.validateAccessAndCreateSession(codeOrToken.trim());
        if (!result.valid || !result.session || !result.competition) {
          const reason = result.error || result.reason || 'Invalid or expired access credentials.';
          toastError('Access Denied', reason);
          setAccessError(reason);
          setIsValidatingAccess(false);
          return;
        }

        setSession(result.session);
        setCompetition(result.competition);
        setAccessError(null);

        const initialTrack =
          result.competition.tracks?.[0] ||
          (result.competition.isOpenTrackEnabled !== false ? 'Open Track' : 'Healthcare & Edge AI');
        setSelectedTrack(initialTrack);

        // Load active form schema
        const activeSchema =
          (await formBuilderService.getFormSchema(result.competition.id)) ||
          formBuilderService.generateDefaultHackathonSchema(result.competition.id, result.competition.organizationId);
        setSchema(activeSchema);

        // Respect competition participation policy
        if (result.competition.participationType === 'INDIVIDUAL') {
          setSubmissionType('INDIVIDUAL');
        } else if (result.competition.participationType === 'TEAM') {
          setSubmissionType('TEAM');
        }

        success('Access Granted', `Submission session active for ${result.competition.title}.`);
      } catch (err: any) {
        toastError('Verification Error', err.message);
      } finally {
        setIsValidatingAccess(false);
      }
    },
    [toastError, success]
  );

  useEffect(() => {
    const candidate = codeParam || tokenParam;
    if (candidate) {
      verifyAndInitializeAccess(candidate);
    }
  }, [codeParam, tokenParam, verifyAndInitializeAccess]);

  // Team Member Management
  const addTeamMember = () => {
    setTeamMembers([...teamMembers, { name: '', email: '', role: 'Collaborator', isLead: false }]);
  };

  const removeTeamMember = (index: number) => {
    if (teamMembers.length <= 1) return;
    setTeamMembers(teamMembers.filter((_, i) => i !== index));
  };

  const updateTeamMember = (index: number, field: string, val: any) => {
    const updated = [...teamMembers];
    updated[index] = { ...updated[index], [field]: val };
    setTeamMembers(updated);
  };

  // Technologies Tag Input
  const handleAddTech = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ',') && techInput.trim()) {
      e.preventDefault();
      const val = techInput.trim().replace(/^,|,$/g, '');
      if (val && !technologiesUsed.includes(val)) {
        setTechnologiesUsed([...technologiesUsed, val]);
      }
      setTechInput('');
    }
  };

  const handleRemoveTech = (tag: string) => {
    setTechnologiesUsed(technologiesUsed.filter((t) => t !== tag));
  };

  // File Upload with Magic Byte Inspection & Batch Multi-File Support
  const handleFileUpload = async (field: SubmissionFormField, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !competition) return;
    setIsUploadingFile(true);

    const allowed = field.validation.fileTypeRestrictions ||
      field.validation.fileExtensions || [
        '.pdf', '.ppt', '.pptx', '.doc', '.docx', '.zip', '.tar', '.gz',
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json',
      ];
    const maxSize = field.validation.maxFileSizeMb || 50;

    const newFiles: StoredFileMetadata[] = [];
    const errors: string[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const metadata = await fileStorageService.uploadFile(file, {
          fieldId: field.id,
          competitionId: competition.id,
          submissionId: `temp_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
          allowedExtensions: allowed,
          maxSizeMb: maxSize,
        });
        newFiles.push(metadata);
      } catch (err: any) {
        errors.push(`${file.name}: ${err?.message || 'Upload failed'}`);
      }
    }

    if (newFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...newFiles]);
      if (newFiles.length === 1) {
        success('File Uploaded & Verified', `${newFiles[0].fileName} uploaded and verified.`);
      } else {
        success('Files Uploaded & Verified', `Successfully uploaded and verified ${newFiles.length} files.`);
      }
    }

    if (errors.length > 0) {
      toastError(
        errors.length === 1 ? 'File Upload Issue' : `${errors.length} Files Rejected`,
        errors.slice(0, 3).join('; ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : '')
      );
    }

    setIsUploadingFile(false);
  };

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // Submit Handler
  const handleSaveOrSubmit = async (isDraft: boolean) => {
    if (!competition || !session) {
      toastError('Session Required', 'Please enter a valid competition access code.');
      return;
    }

    if (!isDraft) {
      if (!projectTitle.trim() || !projectDescription.trim()) {
        toastError('Missing Required Fields', 'Project title and description are required.');
        return;
      }

      if (submissionType === 'TEAM' && !teamName.trim()) {
        toastError('Team Name Required', 'Please enter your team name.');
        return;
      }

      if (!primaryContactName.trim()) {
        toastError('Contact Name Required', 'Please enter the primary submitter/contact name.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const payload = {
        competitionId: competition.id,
        sessionToken: session.sessionToken,
        submissionType,
        teamName: submissionType === 'TEAM' ? teamName : undefined,
        primaryContactName,
        primaryContactEmail,
        participants: submissionType === 'TEAM' ? teamMembers : [{ name: primaryContactName, email: primaryContactEmail, isLead: true }],
        projectTitle: projectTitle || 'Untitled Draft',
        projectDescription: projectDescription || 'No description provided.',
        track: selectedTrack,
        problemStatement,
        solution,
        technologiesUsed,
        githubUrl,
        deploymentUrl,
        videoUrl,
        fieldValues: {
          ...dynamicValues,
          track: selectedTrack,
          'field-track': selectedTrack,
          project_title: projectTitle,
          project_description: projectDescription,
          github_url: githubUrl,
        },
        files: uploadedFiles,
        isDraft,
      };

      const result = await submissionService.createSubmission(payload, competition);
      setSubmissionResult(result);
      success(
        isDraft ? 'Draft Stored Successfully' : 'Submission Completed!',
        `Reference ID: ${result.referenceId}`
      );
    } catch (err: any) {
      toastError('Submission Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render Confirmation Screen when complete
  if (submissionResult && competition) {
    return (
      <SubmissionConfirmationView
        submission={submissionResult.submission}
        rawManagementToken={submissionResult.rawManagementToken}
        referenceId={submissionResult.referenceId}
        managementUrl={submissionResult.managementUrl}
        competition={competition}
        onNavigateToManage={() => navigate(`/submit/manage?ref=${submissionResult.referenceId}&token=${submissionResult.rawManagementToken}`)}
      />
    );
  }

  if (!competition || !session) {
    return (
      <div className="max-w-md mx-auto py-8 space-y-6">
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 space-y-5">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Submit a project</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enter the competition access code or link token. No account required.
            </p>
          </div>

          {accessError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-md text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle size={14} className="text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{accessError}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyAndInitializeAccess(accessInput);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Access code
              </label>
              <Input
                type="text"
                placeholder="e.g. PF-HYBRID26"
                value={accessInput}
                onChange={(e) => setAccessInput(e.target.value)}
                required
                className="font-mono uppercase tracking-wider"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="w-full"
              isLoading={isValidatingAccess}
              rightIcon={<Send size={13} />}
            >
              Continue
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const deadline = new Date(competition.policies.submissionDeadline);
  const isPastDeadline = Date.now() > deadline.getTime();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            {competition.title}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Deadline: {deadline.toLocaleDateString()} ·{' '}
            {isPastDeadline
              ? competition.policies.allowLateSubmissions
                ? 'Late submissions accepted'
                : 'Closed'
              : 'Open'}
          </p>
        </div>
        <Badge variant="neutral" size="sm">
          {competition.publicAccessCode}
        </Badge>
      </div>

      {/* Main Form Body */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveOrSubmit(false);
        }}
        className="space-y-6"
      >
        {/* Section 1: Participation Mode & Submitter Contact */}
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <Users size={16} className="text-blue-600 dark:text-blue-400" />
              <span>1. Participation & Submitter Details</span>
            </h2>
          </div>

          {/* Submission Mode Selector (if competition allows BOTH) */}
          {competition.participationType === 'BOTH' && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSubmissionType('TEAM')}
                className={`flex-1 py-2.5 px-4 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  submissionType === 'TEAM'
                    ? 'border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 shadow-2xs'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Users size={14} />
                <span>Team Submission</span>
              </button>
              <button
                type="button"
                onClick={() => setSubmissionType('INDIVIDUAL')}
                className={`flex-1 py-2.5 px-4 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  submissionType === 'INDIVIDUAL'
                    ? 'border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 shadow-2xs'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <User size={14} />
                <span>Solo / Individual Submission</span>
              </button>
            </div>
          )}

          {/* Team Fields */}
          {submissionType === 'TEAM' && (
            <div className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Team Name <span className="text-rose-500 dark:text-rose-400">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Neural Pioneers"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  required={submissionType === 'TEAM'}
                />
              </div>

              {/* Team Members Repeater */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Team Members</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={addTeamMember}
                    leftIcon={<Plus size={12} />}
                  >
                    Add Member
                  </Button>
                </div>

                <div className="space-y-2">
                  {teamMembers.map((member, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/80 dark:border-slate-700/80 items-center text-xs"
                    >
                      <div className="sm:col-span-4">
                        <Input
                          type="text"
                          placeholder="Full Name"
                          value={member.name}
                          onChange={(e) => updateTeamMember(idx, 'name', e.target.value)}
                          required
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <Input
                          type="email"
                          placeholder="Email (Optional)"
                          value={member.email || ''}
                          onChange={(e) => updateTeamMember(idx, 'email', e.target.value)}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <Input
                          type="text"
                          placeholder="Role (e.g. Lead)"
                          value={member.role || ''}
                          onChange={(e) => updateTeamMember(idx, 'role', e.target.value)}
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        {teamMembers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeTeamMember(idx)}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Primary Contact Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Primary Submitter Name <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. Saikeerthana Sathyavada"
                value={primaryContactName}
                onChange={(e) => setPrimaryContactName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Primary Contact Email <span className="text-slate-400 dark:text-slate-500 font-normal">(Optional for notifications)</span>
              </label>
              <Input
                type="email"
                placeholder="e.g. submitter@example.com"
                value={primaryContactEmail}
                onChange={(e) => setPrimaryContactEmail(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Section 2: Core Project Submission Details */}
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <FileText size={16} className="text-blue-600 dark:text-blue-400" />
              <span>2. Project Information</span>
            </h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-7">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Project Title <span className="text-rose-500 dark:text-rose-400">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Proofly Hybrid AI Verification Engine"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  required
                />
              </div>

              <div className="sm:col-span-5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Layers size={13} className="text-blue-600 dark:text-blue-400" />
                    <span>Competition Track / Theme</span> <span className="text-rose-500 dark:text-rose-400">*</span>
                  </span>
                </label>
                <Select
                  value={selectedTrack}
                  onChange={(e) => setSelectedTrack(e.target.value)}
                  options={[
                    ...(competition?.tracks && competition.tracks.length > 0
                      ? competition.tracks
                      : ['Healthcare & Edge AI', 'Event Tech & Community Discovery', 'Climate & Infrastructure']
                    ).map((t) => ({
                      value: t,
                      label: t,
                    })),
                    ...(competition?.isOpenTrackEnabled !== false
                      ? [{ value: 'Open Track', label: '🌟 Open Track (General Innovation / Open Theme)' }]
                      : []),
                  ]}
                />
              </div>
            </div>

            <div className="p-2.5 bg-blue-50/70 dark:bg-blue-500/10 border border-blue-200/80 dark:border-blue-500/25 rounded-lg text-[11px] text-blue-900 dark:text-blue-200 flex items-center justify-between">
              <span>
                Selected Track: <strong>{selectedTrack}</strong>
                {selectedTrack === 'Open Track'
                  ? ' — Evaluated on open innovation without domain constraint penalties.'
                  : ' — The AI will verify that your submission is relevant to this specific domain track.'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Project Description & Overview <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <Textarea
                rows={3}
                placeholder="Explain the project core concept, architecture, and value..."
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Problem Statement
                </label>
                <Textarea
                  rows={2}
                  placeholder="What specific issue does this project address?"
                  value={problemStatement}
                  onChange={(e) => setProblemStatement(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Solution & Innovation
                </label>
                <Textarea
                  rows={2}
                  placeholder="How does your technical implementation resolve this problem?"
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                />
              </div>
            </div>

            {/* Technologies Used Tags */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Technologies Used <span className="text-slate-400 dark:text-slate-500 font-normal">(Press Enter or comma to add)</span>
              </label>
              <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-50 dark:bg-[#0F1624] border border-slate-200 dark:border-slate-700 rounded-xl min-h-[42px]">
                {technologiesUsed.map((tech) => (
                  <span
                    key={tech}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-200 text-xs font-semibold"
                  >
                    <span>{tech}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTech(tech)}
                      className="hover:text-blue-950 dark:hover:text-white cursor-pointer"
                    >
                      &times;
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder={technologiesUsed.length === 0 ? 'e.g. Gemini Nano, React, Firebase...' : ''}
                  value={techInput}
                  onChange={(e) => setTechInput(e.target.value)}
                  onKeyDown={handleAddTech}
                  className="flex-1 bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none px-1 min-w-[120px]"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Section 3: Artifact Links & Repositories */}
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <GithubIcon className="w-4 h-4 text-slate-700 dark:text-slate-300" />
              <span>3. Codebase & Deliverable Links</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                GitHub Repository URL <span className="text-slate-400 dark:text-slate-500 font-normal">(Public repository)</span>
              </label>
              <Input
                type="url"
                placeholder="https://github.com/owner/repository"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Live Deployment URL
              </label>
              <Input
                type="url"
                placeholder="https://my-project.web.app"
                value={deploymentUrl}
                onChange={(e) => setDeploymentUrl(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Demo Video Link (YouTube / Loom / Vimeo)
              </label>
              <Input
                type="url"
                placeholder="https://youtu.be/..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Section 4: File Uploads & Documents */}
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <UploadCloud size={16} className="text-blue-600 dark:text-blue-400" />
              <span>4. File Uploads (PDF, ZIP, Presentation, Screenshots)</span>
            </h2>
          </div>

          <div className="space-y-4">
            {/* Upload Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  const dummyField: SubmissionFormField = {
                    id: 'artifact_files',
                    label: 'Artifacts',
                    type: 'FILE_UPLOAD',
                    required: false,
                    order: 99,
                    visibility: 'PUBLIC',
                    validation: {
                      fileTypeRestrictions: [
                        '.pdf', '.ppt', '.pptx', '.doc', '.docx', '.zip', '.tar', '.gz',
                        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json',
                      ],
                      fileExtensions: [
                        '.pdf', '.ppt', '.pptx', '.doc', '.docx', '.zip', '.tar', '.gz',
                        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json',
                      ],
                      maxFileSizeMb: 50,
                      required: false,
                    },
                  };
                  handleFileUpload(dummyField, e.dataTransfer.files);
                }
              }}
              onClick={() => document.getElementById('file-upload-input')?.click()}
              className="p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 rounded-2xl text-center space-y-3 transition-colors bg-slate-50/50 dark:bg-slate-800/30 cursor-pointer"
            >
              <UploadCloud size={32} className="text-slate-400 dark:text-slate-500 mx-auto" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Drag and drop multiple files (Presentations, PDFs, Code ZIPs, Screenshots)
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Supported formats: PDF, PPT/PPTX, DOC/DOCX, ZIP, PNG, JPG, MD, TXT (Max 50MB per file)
                </p>
              </div>

              <input
                type="file"
                multiple
                id="file-upload-input"
                className="hidden"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.zip,.tar,.gz,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip,application/x-zip-compressed,image/*,text/*"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const dummyField: SubmissionFormField = {
                    id: 'artifact_files',
                    label: 'Artifacts',
                    type: 'FILE_UPLOAD',
                    required: false,
                    order: 99,
                    visibility: 'PUBLIC',
                    validation: {
                      fileTypeRestrictions: [
                        '.pdf', '.ppt', '.pptx', '.doc', '.docx', '.zip', '.tar', '.gz',
                        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json',
                      ],
                      fileExtensions: [
                        '.pdf', '.ppt', '.pptx', '.doc', '.docx', '.zip', '.tar', '.gz',
                        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json',
                      ],
                      maxFileSizeMb: 50,
                      required: false,
                    },
                  };
                  handleFileUpload(dummyField, e.target.files);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  document.getElementById('file-upload-input')?.click();
                }}
                isLoading={isUploadingFile}
              >
                Browse & Select Multiple Files
              </Button>
            </div>

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Uploaded Artifacts ({uploadedFiles.length}):
                  </span>
                  <button
                    type="button"
                    onClick={() => document.getElementById('file-upload-input')?.click()}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium cursor-pointer"
                  >
                    + Add more files
                  </button>
                </div>
                <div className="space-y-2">
                  {uploadedFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/90 dark:border-slate-700/80 text-xs"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <FileText size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                        <div className="truncate">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">{file.fileName}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            {(file.fileSize / (1024 * 1024)).toFixed(2)} MB · {file.detectedMimeType}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveFile(file.id)}
                        className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Action Buttons Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-400 dark:text-slate-500 text-center sm:text-left">
            <span>By submitting, you consent to automated on-device & cloud AI pre-evaluation.</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Save Draft Button */}
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => handleSaveOrSubmit(true)}
              isLoading={isSubmitting}
              leftIcon={<Save size={14} />}
              className="flex-1 sm:flex-initial"
            >
              Save Draft
            </Button>

            {/* Final Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              rightIcon={<Send size={14} />}
              className="flex-1 sm:flex-initial"
            >
              Final Submit Project
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};
