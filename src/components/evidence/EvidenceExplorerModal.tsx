// ─────────────────────────────────────────────
// EvidenceExplorerModal.tsx — Evidence Explorer Studio
// Proofly Phase 11 — Multimodal Artifact Inspection & Judge Annotations
// ─────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
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
  Search,
  Download,
  ThumbsUp,
  ThumbsDown,
  Flag,
  MessageSquare,
  Hash,
  Clock,
  Sliders,
  Save,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { GithubIcon } from '../ui/GithubIcon';
import { useToast } from '../ui/Toast';
import type {
  EvidenceReference,
  EvidenceClassification,
  ArtifactType,
  AiEvaluationReport,
} from '../../types/aiEvaluation';
import type { JudgeEvidenceAnnotation } from '../../types/judgeAndEvaluation';
import type { StoredFileMetadata } from '../../types/submission';
import { evidenceExplorerService } from '../../services/evidenceExplorerService';
import { fileStorageService } from '../../services/fileStorageService';

interface EvidenceExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  submissionId: string;
  projectTitle?: string;
  initialEvidenceId?: string;
  allReferences: EvidenceReference[];
  submissionFiles?: StoredFileMetadata[];
  aiReport?: AiEvaluationReport | null;
  judgeId: string;
  isJudgeLocked?: boolean;
  annotations?: Record<string, JudgeEvidenceAnnotation>;
  onSaveAnnotation?: (annotation: JudgeEvidenceAnnotation) => void;
}

export const EvidenceExplorerModal: React.FC<EvidenceExplorerModalProps> = ({
  isOpen,
  onClose,
  submissionId,
  projectTitle = 'Project Submission',
  initialEvidenceId,
  allReferences = [],
  submissionFiles = [],
  aiReport: _aiReport,
  judgeId,
  isJudgeLocked = false,
  annotations = {},
  onSaveAnnotation,
}) => {
  const { success, warning, error: toastError } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassification, setSelectedClassification] = useState<EvidenceClassification | 'ALL'>('ALL');
  const [selectedArtifactType, setSelectedArtifactType] = useState<ArtifactType | 'ALL'>('ALL');

  // Selected evidence item
  const [selectedId, setSelectedId] = useState<string>(
    initialEvidenceId || allReferences[0]?.id || ''
  );

  // Sync initial evidence ID when modal opens
  React.useEffect(() => {
    if (initialEvidenceId) {
      setSelectedId(initialEvidenceId);
    } else if (allReferences.length > 0 && !selectedId) {
      setSelectedId(allReferences[0].id);
    }
  }, [initialEvidenceId, allReferences]);

  // Local state for the active annotation on the selected evidence
  const activeAnnotation = useMemo(() => {
    return (
      annotations[selectedId] || {
        evidenceId: selectedId,
        judgeId,
        submissionId,
        isRelevant: undefined,
        flaggedIncorrect: false,
        disagreeWithAi: false,
        notes: '',
        nonSupportReason: '',
        updatedAt: new Date().toISOString(),
      }
    );
  }, [selectedId, annotations, judgeId, submissionId]);

  const [localAnnotation, setLocalAnnotation] = useState<JudgeEvidenceAnnotation>(activeAnnotation);

  React.useEffect(() => {
    setLocalAnnotation(activeAnnotation);
  }, [activeAnnotation]);

  // Filtered evidence list
  const filteredReferences = useMemo(() => {
    return allReferences.filter((ref) => {
      // Classification filter
      if (selectedClassification !== 'ALL' && ref.classification !== selectedClassification) {
        return false;
      }

      // Artifact type filter
      if (selectedArtifactType !== 'ALL' && ref.artifactType !== selectedArtifactType) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const textToSearch = [
          ref.id,
          ref.sourceLocation,
          ref.locationReference,
          ref.description,
          ref.snippet,
          ref.extractedPassage,
          ref.location?.filePath,
          ref.location?.sectionHeading,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!textToSearch.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [allReferences, selectedClassification, selectedArtifactType, searchQuery]);

  // Active selected evidence
  const selectedEvidence = useMemo(() => {
    return (
      allReferences.find((r) => r.id === selectedId) ||
      filteredReferences[0] ||
      allReferences[0] ||
      null
    );
  }, [allReferences, filteredReferences, selectedId]);

  // Save current judge annotation
  const handleSaveLocalAnnotation = () => {
    if (isJudgeLocked) {
      warning('Scorecard Finalized', 'Evaluations and annotations are locked and cannot be modified.');
      return;
    }
    const updated = {
      ...localAnnotation,
      evidenceId: selectedEvidence?.id || selectedId,
      judgeId,
      submissionId,
      updatedAt: new Date().toISOString(),
    };
    if (onSaveAnnotation) {
      onSaveAnnotation(updated);
    } else {
      evidenceExplorerService.saveJudgeAnnotation(updated);
    }
    success('Annotation Saved', 'Judge feedback for this evidence item recorded.');
  };

  const renderArtifactTypeIcon = (type: ArtifactType) => {
    switch (type) {
      case 'PDF':
        return <FileText size={15} className="text-rose-500" />;
      case 'PPTX':
        return <Sliders size={15} className="text-amber-500" />;
      case 'GITHUB_REPO':
        return <GithubIcon size={15} className="text-slate-700 dark:text-slate-300" />;
      case 'DEPLOYMENT_URL':
        return <Globe size={15} className="text-blue-500" />;
      case 'VIDEO_URL':
        return <Video size={15} className="text-purple-500" />;
      case 'ZIP_ARCHIVE':
        return <Archive size={15} className="text-amber-600" />;
      case 'TEXT_MARKDOWN':
      default:
        return <FileCode size={15} className="text-emerald-500" />;
    }
  };

  const classDetails = selectedEvidence
    ? evidenceExplorerService.getClassificationDetails(selectedEvidence.classification)
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Evidence Explorer & Traceability Studio"
      description={`Inspect verified evidence, source locations, and judge annotations for "${projectTitle}".`}
      maxWidth="3xl"
    >
      <div className="space-y-4 -mt-1">
        {/* ── TOP FILTER & SEARCH BAR ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by keyword, file, slide, line, heading..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#0E1524] border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Classification Filter */}
          <select
            value={selectedClassification}
            onChange={(e) => setSelectedClassification(e.target.value as any)}
            className="text-xs bg-white dark:bg-[#0E1524] border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-hidden"
          >
            <option value="ALL">All Classifications ({allReferences.length})</option>
            <option value="VERIFIED_EVIDENCE">Verified Evidence</option>
            <option value="CLAIM_ONLY">Claim Only (README / Notes)</option>
            <option value="MISSING_EVIDENCE">Missing Evidence</option>
            <option value="INACCESSIBLE_EVIDENCE">Inaccessible Evidence</option>
            <option value="UNCLEAR_EVIDENCE">Unclear Evidence</option>
            <option value="NOT_INSPECTED">Not Inspected</option>
          </select>

          {/* Artifact Type Filter */}
          <select
            value={selectedArtifactType}
            onChange={(e) => setSelectedArtifactType(e.target.value as any)}
            className="text-xs bg-white dark:bg-[#0E1524] border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-hidden"
          >
            <option value="ALL">All Artifacts</option>
            <option value="PDF">PDF Documents</option>
            <option value="PPTX">PPTX Slide Decks</option>
            <option value="GITHUB_REPO">GitHub / Source Code</option>
            <option value="TEXT_MARKDOWN">Text & Markdown</option>
            <option value="DEPLOYMENT_URL">Deployment URLs</option>
            <option value="ZIP_ARCHIVE">ZIP Archives</option>
            <option value="VIDEO_URL">Video URLs</option>
          </select>
        </div>

        {/* ── SPLIT VIEW: EVIDENCE LIST & DETAIL INSPECTOR ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 max-h-[65vh]">
          {/* LEFT COLUMN: EVIDENCE REFERENCES LIST (4 cols) */}
          <div className="md:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col bg-slate-50/50 dark:bg-slate-900/30">
            <div className="p-2.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span>Evidence Items</span>
              <span className="font-mono text-[10px] bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                {filteredReferences.length} of {allReferences.length}
              </span>
            </div>

            <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 flex-1 p-1 space-y-1">
              {filteredReferences.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 dark:text-slate-500">
                  No evidence references match the selected filters.
                </div>
              ) : (
                filteredReferences.map((ref) => {
                  const isSelected = selectedEvidence?.id === ref.id;
                  const itemClass = evidenceExplorerService.getClassificationDetails(ref.classification);
                  const hasAnnotation = Boolean(annotations[ref.id]);

                  return (
                    <button
                      key={ref.id}
                      type="button"
                      onClick={() => setSelectedId(ref.id)}
                      className={`w-full text-left p-2.5 rounded-lg transition-all cursor-pointer flex flex-col gap-1 border ${
                        isSelected
                          ? 'bg-blue-50/80 dark:bg-blue-900/25 border-blue-300 dark:border-blue-500/40 text-blue-950 dark:text-blue-100 shadow-2xs'
                          : 'bg-white dark:bg-[#121929] hover:bg-slate-50 dark:hover:bg-slate-800/50 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {renderArtifactTypeIcon(ref.artifactType)}
                          <span className="font-semibold text-xs truncate">
                            {ref.locationReference || ref.sourceLocation || ref.id}
                          </span>
                        </div>
                        {hasAnnotation && (
                          <span
                            title="Judge has annotated this evidence"
                            className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0"
                          />
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {ref.sourceLocation || ref.description}
                      </div>

                      <div className="flex items-center gap-1 mt-0.5">
                        <Badge variant={itemClass.badgeVariant} size="sm" className="text-[9px] py-0 px-1.5">
                          {itemClass.label}
                        </Badge>
                        {ref.extractionStatus === 'INACCESSIBLE' && (
                          <Badge variant="danger" size="sm" className="text-[9px] py-0 px-1.5">
                            Inaccessible
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: EVIDENCE INSPECTOR & ANNOTATION STUDIO (8 cols) */}
          <div className="md:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl overflow-y-auto p-4 space-y-4 bg-white dark:bg-[#0F1626]">
            {selectedEvidence ? (
              <>
                {/* 1. Header & Source Pointer */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="p-1 rounded bg-slate-100 dark:bg-slate-800">
                        {renderArtifactTypeIcon(selectedEvidence.artifactType)}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {selectedEvidence.sourceLocation || selectedEvidence.locationReference || 'Artifact Reference'}
                      </h4>
                      {classDetails && (
                        <Badge variant={classDetails.badgeVariant} size="sm">
                          {classDetails.label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Artifact ID: <span className="font-mono text-slate-700 dark:text-slate-300">{selectedEvidence.artifactId}</span> • Reference ID: <span className="font-mono text-slate-700 dark:text-slate-300">{selectedEvidence.id}</span>
                    </p>
                  </div>

                  {/* Secure Download / View Button */}
                  <div className="shrink-0">
                    {selectedEvidence.artifactType === 'GITHUB_REPO' && selectedEvidence.location?.filePath ? (
                      <a
                        href={`https://github.com/search?q=${encodeURIComponent(selectedEvidence.location.filePath)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition-colors"
                      >
                        <GithubIcon size={13} />
                        <span>Inspect in Repo ↗</span>
                      </a>
                    ) : (
                      submissionFiles.find((f) => f.id === selectedEvidence.artifactId) && (
                        <Button
                          variant="outline"
                          size="xs"
                          leftIcon={<Download size={13} />}
                          onClick={async () => {
                            const matchingFile = submissionFiles.find((f) => f.id === selectedEvidence.artifactId);
                            if (matchingFile) {
                              try {
                                await fileStorageService.triggerBrowserDownload(matchingFile, {
                                  assignedJudgeIds: [judgeId],
                                });
                              } catch (err: any) {
                                toastError('Download Failed', err?.message || 'Unable to access artifact.');
                              }
                            }
                          }}
                        >
                          Secure Download
                        </Button>
                      )
                    )}
                  </div>
                </div>

                {/* 2. Classification Explanation Card */}
                {classDetails && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                      classDetails.classification === 'VERIFIED_EVIDENCE'
                        ? 'bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                        : classDetails.classification === 'CLAIM_ONLY'
                        ? 'bg-amber-50/70 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200'
                        : classDetails.classification === 'MISSING_EVIDENCE'
                        ? 'bg-rose-50/70 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-900 dark:text-rose-200'
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {classDetails.classification === 'VERIFIED_EVIDENCE' ? (
                        <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                      ) : classDetails.classification === 'CLAIM_ONLY' ? (
                        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                      ) : (
                        <AlertCircle size={16} className="text-rose-600 dark:text-rose-400" />
                      )}
                    </div>
                    <div>
                      <span className="font-bold block">{classDetails.label}</span>
                      <p className="mt-0.5 leading-relaxed opacity-90">{classDetails.explanation}</p>
                    </div>
                  </div>
                )}

                {/* 3. Inaccessible / OCR Warning if applicable */}
                {selectedEvidence.extractionStatus === 'REQUIRES_OCR' && (
                  <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                    <HelpCircle size={16} className="text-amber-600 shrink-0" />
                    <span>Scanned PDF: Document contains rasterized images with no text layer. OCR required.</span>
                  </div>
                )}

                {selectedEvidence.extractionStatus === 'INACCESSIBLE' && (
                  <div className="p-3 rounded-lg border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/15 text-xs text-rose-900 dark:text-rose-200 flex items-center gap-2">
                    <AlertCircle size={16} className="text-rose-600 shrink-0" />
                    <span>Inaccessible Artifact: External endpoint was unreachable or returned access error.</span>
                  </div>
                )}

                {/* 4. Extracted Passage / Preview */}
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    Extracted Passage & Provenance Content
                  </span>
                  <div className="p-3 rounded-lg bg-slate-900 text-slate-200 font-mono text-xs leading-relaxed overflow-x-auto max-h-52 border border-slate-800">
                    {selectedEvidence.extractedPassage || selectedEvidence.snippet || (
                      <span className="text-slate-500 italic">No textual passage extracted for this item.</span>
                    )}
                  </div>
                </div>

                {/* 5. Provenance Metadata & Content Hash */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                  <div className="flex items-center gap-1.5 truncate">
                    <Hash size={13} className="text-slate-400 shrink-0" />
                    <span className="truncate">SHA-256: {selectedEvidence.contentHash || 'Verified'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 truncate">
                    <Clock size={13} className="text-slate-400 shrink-0" />
                    <span className="truncate">Extracted: {new Date(selectedEvidence.extractionTimestamp || Date.now()).toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* 6. JUDGE INTERACTION & ANNOTATION BAR */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={15} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                        Judge Evidence Feedback & Annotations
                      </span>
                    </div>
                    {localAnnotation.updatedAt && (
                      <span className="text-[10px] text-slate-400">
                        Last modified {new Date(localAnnotation.updatedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  {/* Toggle Controls */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={isJudgeLocked}
                      onClick={() =>
                        setLocalAnnotation((prev) => ({
                          ...prev,
                          isRelevant: prev.isRelevant === true ? undefined : true,
                        }))
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                        localAnnotation.isRelevant === true
                          ? 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200 font-bold'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <ThumbsUp size={13} />
                      <span>Relevant to Rubric</span>
                    </button>

                    <button
                      type="button"
                      disabled={isJudgeLocked}
                      onClick={() =>
                        setLocalAnnotation((prev) => ({
                          ...prev,
                          flaggedIncorrect: !prev.flaggedIncorrect,
                        }))
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                        localAnnotation.flaggedIncorrect
                          ? 'bg-rose-50 dark:bg-rose-500/20 border-rose-300 dark:border-rose-500/40 text-rose-800 dark:text-rose-200 font-bold'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Flag size={13} />
                      <span>Flag Incorrect Association</span>
                    </button>

                    <button
                      type="button"
                      disabled={isJudgeLocked}
                      onClick={() =>
                        setLocalAnnotation((prev) => ({
                          ...prev,
                          disagreeWithAi: !prev.disagreeWithAi,
                        }))
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                        localAnnotation.disagreeWithAi
                          ? 'bg-amber-50 dark:bg-amber-500/20 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-200 font-bold'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <ThumbsDown size={13} />
                      <span>Disagree with AI Interpretation</span>
                    </button>
                  </div>

                  {/* Disagreement rationale if marked */}
                  {localAnnotation.disagreeWithAi && (
                    <Textarea
                      label="Why evidence does not support claim"
                      rows={2}
                      disabled={isJudgeLocked}
                      placeholder="Explain why this passage fails to demonstrate the evaluated criterion..."
                      value={localAnnotation.nonSupportReason || ''}
                      onChange={(e) =>
                        setLocalAnnotation((prev) => ({ ...prev, nonSupportReason: e.target.value }))
                      }
                    />
                  )}

                  {/* General notes */}
                  <Textarea
                    label="Judge Evidence Notes"
                    rows={2}
                    disabled={isJudgeLocked}
                    placeholder="Private judge notes regarding this specific evidence snippet..."
                    value={localAnnotation.notes || ''}
                    onChange={(e) => setLocalAnnotation((prev) => ({ ...prev, notes: e.target.value }))}
                  />

                  {/* Save annotation */}
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Save size={13} />}
                      disabled={isJudgeLocked}
                      onClick={handleSaveLocalAnnotation}
                    >
                      Save Evidence Annotation
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-xs text-slate-400">
                Select an evidence item from the left pane to inspect.
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
