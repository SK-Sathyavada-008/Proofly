// ─────────────────────────────────────────────
// EvidenceReferenceBadge.tsx — Clickable Evidence Citation Badge
// Proofly Phase 11 — Traceable Evidence Indicators for Judge Workspace
// ─────────────────────────────────────────────

import React from 'react';
import {
  FileText,
  FileCode,
  Globe,
  Video,
  Archive,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { GithubIcon } from '../ui/GithubIcon';
import type { EvidenceReference, EvidenceClassification, ArtifactType } from '../../types/aiEvaluation';
import { evidenceExplorerService } from '../../services/evidenceExplorerService';

interface EvidenceReferenceBadgeProps {
  evidence: EvidenceReference | string;
  allReferences?: EvidenceReference[];
  onClick?: (evidence: EvidenceReference) => void;
  size?: 'xs' | 'sm' | 'md';
  showClassification?: boolean;
  className?: string;
}

export const EvidenceReferenceBadge: React.FC<EvidenceReferenceBadgeProps> = ({
  evidence,
  allReferences = [],
  onClick,
  size = 'xs',
  showClassification = true,
  className = '',
}) => {
  // Resolve string reference if needed
  let resolvedEvidence: EvidenceReference;
  if (typeof evidence === 'string') {
    const trimmed = evidence.trim();
    const matched = allReferences.find(
      (r) =>
        r.id === trimmed ||
        r.sourceLocation === trimmed ||
        r.location?.filePath === trimmed ||
        (r.description && r.description.includes(trimmed))
    );

    if (matched) {
      resolvedEvidence = matched;
    } else {
      // Create synthetic fallback reference
      const isGithub = trimmed.includes('github') || trimmed.endsWith('.ts') || trimmed.endsWith('.js') || trimmed.endsWith('.rs') || trimmed.endsWith('.py');
      const isPdf = trimmed.toLowerCase().endsWith('.pdf');
      const isPptx = trimmed.toLowerCase().endsWith('.pptx') || trimmed.toLowerCase().endsWith('.ppt');
      const isReadme = trimmed.toLowerCase().includes('readme');

      const artifactType: ArtifactType = isPdf
        ? 'PDF'
        : isPptx
        ? 'PPTX'
        : isGithub
        ? 'GITHUB_REPO'
        : 'TEXT_MARKDOWN';

      resolvedEvidence = evidenceExplorerService.normalizeEvidenceReference({
        id: `ref-str-${trimmed.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        artifactId: 'art-inline',
        artifactType,
        sourceLocation: trimmed,
        locationReference: trimmed.split('/').pop() || trimmed,
        snippet: `Citation: ${trimmed}`,
        location: {
          filePath: isGithub || isReadme ? trimmed : undefined,
        },
        classification: isReadme ? 'CLAIM_ONLY' : 'VERIFIED_EVIDENCE',
      });
    }
  } else {
    resolvedEvidence = evidence;
  }

  const classDetails = evidenceExplorerService.getClassificationDetails(
    resolvedEvidence.classification
  );

  const renderTypeIcon = (type: ArtifactType) => {
    switch (type) {
      case 'PDF':
        return <FileText size={12} className="text-rose-500 shrink-0" />;
      case 'PPTX':
        return <FileText size={12} className="text-amber-500 shrink-0" />;
      case 'GITHUB_REPO':
        return <GithubIcon size={12} className="text-slate-700 dark:text-slate-300 shrink-0" />;
      case 'DEPLOYMENT_URL':
        return <Globe size={12} className="text-blue-500 shrink-0" />;
      case 'VIDEO_URL':
        return <Video size={12} className="text-purple-500 shrink-0" />;
      case 'ZIP_ARCHIVE':
        return <Archive size={12} className="text-amber-600 shrink-0" />;
      case 'TEXT_MARKDOWN':
      default:
        return <FileCode size={12} className="text-emerald-500 shrink-0" />;
    }
  };

  const renderClassificationIcon = (classification?: EvidenceClassification) => {
    switch (classification) {
      case 'VERIFIED_EVIDENCE':
      case 'EVIDENCE_VERIFIED':
        return <CheckCircle2 size={11} className="text-emerald-600 dark:text-emerald-400" />;
      case 'CLAIM_ONLY':
      case 'FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED':
        return <AlertTriangle size={11} className="text-amber-600 dark:text-amber-400" />;
      case 'MISSING_EVIDENCE':
      case 'FEATURE_DEMONSTRABLY_ABSENT':
        return <AlertCircle size={11} className="text-rose-600 dark:text-rose-400" />;
      case 'INACCESSIBLE_EVIDENCE':
      case 'EVIDENCE_UNAVAILABLE':
        return <HelpCircle size={11} className="text-slate-500" />;
      default:
        return null;
    }
  };

  const displayText =
    resolvedEvidence.locationReference ||
    resolvedEvidence.sourceLocation ||
    resolvedEvidence.description ||
    resolvedEvidence.artifactId;

  const sizeClasses = {
    xs: 'px-2 py-0.5 text-[10px]',
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3 py-1.5 text-xs font-medium',
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.stopPropagation();
      onClick(resolvedEvidence);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Inspect Evidence: ${resolvedEvidence.sourceLocation || displayText} (${classDetails.label})`}
      className={`inline-flex items-center gap-1.5 rounded-md font-mono font-medium transition-all cursor-pointer border ${
        onClick
          ? 'bg-slate-100 dark:bg-slate-800/80 hover:bg-blue-50 dark:hover:bg-blue-900/30 border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500/50 text-slate-800 dark:text-slate-200'
          : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
      } ${sizeClasses[size]} ${className}`}
    >
      {renderTypeIcon(resolvedEvidence.artifactType)}
      <span className="truncate max-w-[180px]">{displayText}</span>

      {showClassification && (
        <span
          className="inline-flex items-center ml-0.5"
          title={classDetails.explanation}
        >
          {renderClassificationIcon(resolvedEvidence.classification)}
        </span>
      )}

      {onClick && <ExternalLink size={9} className="opacity-40 group-hover:opacity-100 shrink-0" />}
    </button>
  );
};
