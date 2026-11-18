// ─────────────────────────────────────────────
// SubmissionConfirmationView.tsx — Submission Confirmation & Receipt
// Proofly — Phase 5
// ─────────────────────────────────────────────

import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import type { ProjectSubmission } from '../../types/submission';
import type { Competition } from '../../types/authAndCompetition';

interface Props {
  submission: ProjectSubmission;
  rawManagementToken: string;
  referenceId: string;
  managementUrl: string;
  competition: Competition;
  onNavigateToManage?: () => void;
}

export const SubmissionConfirmationView: React.FC<Props> = ({
  submission,
  rawManagementToken: _rawManagementToken,
  referenceId,
  managementUrl,
  competition,
  onNavigateToManage,
}) => {
  const { success } = useToast();
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyRef = () => {
    navigator.clipboard.writeText(referenceId);
    setCopiedRef(true);
    success('Copied Reference ID', referenceId);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(managementUrl);
    setCopiedLink(true);
    success('Copied Secret Management Link', 'Bookmark this link to edit your submission.');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const isDraft = submission.status === 'Draft';

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      {/* Top Hero Confirmation Card */}
      <Card className="border-emerald-200/90 dark:border-emerald-500/30 bg-white dark:bg-slate-900 p-8 text-center space-y-6 shadow-sm">
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-2xs">
          <CheckCircle2 size={36} />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{isDraft ? 'Draft Saved Successfully' : 'Submission Successfully Received'}</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
            {isDraft ? 'Your Draft Is Stored' : 'Project Submitted to Proofly'}
          </h1>

          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
            Project <strong className="text-slate-800 dark:text-slate-200">"{submission.projectTitle}"</strong> has been logged for{' '}
            <strong className="text-slate-800 dark:text-slate-200">{competition.title}</strong>.
          </p>
        </div>

        {/* Reference ID Banner */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/90 dark:border-slate-700/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-left">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
              Submission Reference ID
            </span>
            <span className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">{referenceId}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyRef}
            leftIcon={copiedRef ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={14} />}
          >
            {copiedRef ? 'Copied' : 'Copy Reference ID'}
          </Button>
        </div>

        {/* Secret Management Link Warning Box */}
        <div className="p-5 rounded-xl bg-blue-50/70 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/25 text-left space-y-3">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-blue-950 dark:text-blue-200 uppercase tracking-wide">
                Secret Management Link (Zero-Account Ownership)
              </h4>
              <p className="text-xs text-blue-800 dark:text-blue-300/90 leading-relaxed">
                Because Proofly requires <strong>no participant accounts or passwords</strong>, your submission is
                secured with a 256-bit cryptographic token embedded in the link below.
                <strong className="block mt-1 font-semibold text-blue-900 dark:text-blue-200">
                  Bookmark or save this link! The plaintext secret is never stored on our servers.
                </strong>
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <input
              type="text"
              readOnly
              value={managementUrl}
              className="flex-1 text-xs font-mono bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-500/30 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-200 select-all"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleCopyLink}
              leftIcon={copiedLink ? <Check size={14} /> : <Copy size={14} />}
            >
              {copiedLink ? 'Link Copied!' : 'Copy Secret Link'}
            </Button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <a
            href={managementUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center"
          >
            <Button variant="outline" size="md" rightIcon={<ExternalLink size={14} />}>
              Open Management Portal
            </Button>
          </a>
          {onNavigateToManage && (
            <Button variant="secondary" size="md" onClick={onNavigateToManage} rightIcon={<ArrowRight size={14} />}>
              View Live Status
            </Button>
          )}
        </div>
      </Card>

      {/* Submission Overview Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Card: Submission Metadata */}
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Submission Metadata</h3>
            <Badge variant={isDraft ? 'warning' : 'primary'} size="sm">
              {submission.status}
            </Badge>
          </div>

          <dl className="text-xs space-y-2.5">
            <div className="flex justify-between">
              <dt className="text-slate-400 dark:text-slate-500">Submission Type</dt>
              <dd className="font-semibold text-slate-800 dark:text-slate-200">
                {submission.submissionType === 'TEAM' ? `Team (${submission.teamName})` : 'Individual Solo'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400 dark:text-slate-500">Primary Contact</dt>
              <dd className="font-semibold text-slate-800 dark:text-slate-200">
                {submission.primaryContactName}{' '}
                {submission.primaryContactEmail && `(${submission.primaryContactEmail})`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400 dark:text-slate-500">Active Version</dt>
              <dd className="font-mono text-slate-800 dark:text-slate-200">Version {submission.currentVersion}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400 dark:text-slate-500">Late Status</dt>
              <dd className="font-semibold text-slate-800 dark:text-slate-200">
                {submission.isLate ? (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">Late Submission Accepted</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">On-Time</span>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        {/* Right Card: Automated Pipeline Status */}
        <Card className="p-6 bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Automated AI Pipeline</h3>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <Sparkles size={13} />
              <span>Hybrid Engine</span>
            </span>
          </div>

          <div className="space-y-3 text-xs text-slate-600 dark:text-slate-400">
            <p className="leading-relaxed">
              Your submission has been queued for automated pre-evaluation with{' '}
              <strong className="text-slate-800 dark:text-slate-200">Firebase AI Logic (Gemini Nano 4 on-device / 2.5 Flash cloud fallback)</strong>.
            </p>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200/80 dark:border-slate-700/80 space-y-1">
              <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-medium">
                <span>AI Evaluation Gate</span>
                <span className="text-blue-600 dark:text-blue-400 font-semibold">{submission.status}</span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Judges will review this project once automated AI scoring and rubric evaluation finish.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
