// ─────────────────────────────────────────────
// AiEvaluationReportView.tsx — Detailed AI Evaluation Report Component
// Proofly / Evalora — Phase 6
// ─────────────────────────────────────────────

import React from 'react';
import {
  Sparkles,
  Zap,
  Cloud,
  Clock,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  FileText,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { EvidenceReferenceBadge } from '../evidence/EvidenceReferenceBadge';
import type { AiEvaluationReport, EvidenceClassification } from '../../types/aiEvaluation';

interface AiEvaluationReportViewProps {
  report: AiEvaluationReport;
  onClose?: () => void;
}

export const AiEvaluationReportView: React.FC<AiEvaluationReportViewProps> = ({ report }) => {
  const [expandedCriteria, setExpandedCriteria] = React.useState<Record<string, boolean>>({});

  const toggleCriterion = (id: string) => {
    setExpandedCriteria((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const getClassificationBadge = (classification: EvidenceClassification) => {
    switch (classification) {
      case 'EVIDENCE_VERIFIED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
            <CheckCircle2 size={11} />
            Evidence Verified
          </span>
        );
      case 'FEATURE_CLAIMED_BUT_NOT_DEMONSTRATED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
            <AlertTriangle size={11} />
            Claimed / Not Demonstrated
          </span>
        );
      case 'FEATURE_DEMONSTRABLY_ABSENT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30">
            <AlertCircle size={11} />
            Demonstrably Absent
          </span>
        );
      case 'EVIDENCE_UNAVAILABLE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            <HelpCircle size={11} />
            Evidence Unavailable
          </span>
        );
      case 'CONTENT_UNCLEAR':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30">
            <HelpCircle size={11} />
            Content Unclear
          </span>
        );
      case 'TECHNICAL_BEHAVIOR_NOT_TESTED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
            <HelpCircle size={11} />
            Behavior Not Tested
          </span>
        );
      default:
        return null;
    }
  };

  const isNano = report.telemetry.actualInferenceSource === 'ON_DEVICE';

  return (
    <div className="space-y-6">
      {/* ── HEADER & TELEMETRY BANNER ── */}
      <Card className="border-blue-200 dark:border-blue-500/30 bg-slate-50/50 dark:bg-slate-900 shadow-xs">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shadow-xs">
                <Sparkles size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Firebase AI Logic Evaluation Dossier</h3>
                  <Badge variant="purple" size="sm" className="font-mono text-[10px]">
                    v{report.rubricVersion.versionNumber} Immutable
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Target: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{report.referenceId}</span> • Evaluated {new Date(report.evaluatedAt).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Score Pill */}
            <div className="flex items-center gap-3 bg-white dark:bg-[#161F30] p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-2xs self-start sm:self-auto">
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Total Score</span>
                <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
                  {report.overallScore} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">/ {report.totalMaxScore}</span>
                </div>
              </div>
              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
              <div className="text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Rating</span>
                <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400">
                  {report.percentageScore}%
                </div>
              </div>
            </div>
          </div>

          {/* Telemetry Strip */}
          <div className="p-3 bg-slate-900 dark:bg-[#080B12] border border-slate-800 text-slate-200 rounded-lg text-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5 font-medium">
                {isNano ? (
                  <>
                    <Zap size={14} className="text-emerald-400" />
                    <span className="text-emerald-300 font-semibold">Gemini Nano 4 (On-Device Edge)</span>
                  </>
                ) : (
                  <>
                    <Cloud size={14} className="text-blue-400" />
                    <span className="text-blue-300 font-semibold">gemini-2.5-flash (Cloud Engine)</span>
                  </>
                )}
              </div>
              <span className="text-slate-600">•</span>
              <div className="flex items-center gap-1 text-slate-300">
                <Clock size={13} className="text-slate-400" />
                <span className="font-mono font-semibold">{report.telemetry.latencyMs}ms</span>
              </div>
              <span className="text-slate-600">•</span>
              <div className="flex items-center gap-1 text-slate-300">
                <ShieldCheck size={13} className="text-emerald-400" />
                <span>App Check: {report.telemetry.appCheckStatus}</span>
              </div>
            </div>

            {report.telemetry.fallbackOccurred && (
              <div className="text-[11px] text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                Automated Fallback Engaged
              </div>
            )}
          </div>

          {report.telemetry.fallbackReason && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
              Note: {report.telemetry.fallbackReason}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── EXECUTIVE SUMMARY & HIGHLIGHTS ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Executive Synthesis
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {report.executiveSummary}
              </p>
            </CardContent>
          </Card>

          {/* Strongest Aspects & Areas To Improve */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/20 dark:bg-emerald-500/5">
              <CardHeader className="py-2.5 px-4 border-b border-emerald-100/60 dark:border-emerald-500/20">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  Strongest Aspects
                </span>
              </CardHeader>
              <CardContent className="p-4 space-y-1.5">
                {report.strongestAspects.map((aspect, idx) => (
                  <div key={idx} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">•</span>
                    <span>{aspect}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-amber-100 dark:border-amber-500/20 bg-amber-50/20 dark:bg-amber-500/5">
              <CardHeader className="py-2.5 px-4 border-b border-amber-100/60 dark:border-amber-500/20">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle size={13} />
                  Areas to Improve
                </span>
              </CardHeader>
              <CardContent className="p-4 space-y-1.5">
                {report.areasToImprove.map((area, idx) => (
                  <div key={idx} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                    <span className="text-amber-600 dark:text-amber-400 font-bold">•</span>
                    <span>{area}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Evidence Disclaimers & Warnings */}
        <div className="space-y-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-blue-600 dark:text-blue-400" />
                Audit & Evidence Rules
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              {report.evaluationWarnings.map((warning, idx) => (
                <div key={idx} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                  {warning}
                </div>
              ))}
              {report.evidenceGaps.length > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1">
                  <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">Identified Evidence Gaps:</span>
                  {report.evidenceGaps.map((gap, idx) => (
                    <div key={idx} className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1">
                      <span>⚠️</span>
                      <span>{gap}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── RUBRIC CRITERIA BREAKDOWN ── */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileText size={16} className="text-blue-600 dark:text-blue-400" />
          <span>Rubric Criteria Breakdown ({report.criteriaEvaluations.length} Dimensions)</span>
        </h4>

        <div className="space-y-3">
          {report.criteriaEvaluations.map((crit) => {
            const isExpanded = expandedCriteria[crit.criterionId] ?? true;
            const pct = Math.round((crit.suggestedScore / crit.maxScore) * 100);

            return (
              <Card key={crit.criterionId} className="border-slate-200 dark:border-slate-800 overflow-hidden">
                <div
                  onClick={() => toggleCriterion(crit.criterionId)}
                  className="p-4 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer flex items-center justify-between gap-4 transition-colors"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">{crit.criterionName}</span>
                      <Badge variant="neutral" size="sm">Weight: {crit.weight}%</Badge>
                      <Badge
                        variant={crit.confidence === 'HIGH' ? 'success' : crit.confidence === 'MEDIUM' ? 'warning' : 'neutral'}
                        size="sm"
                      >
                        Confidence: {crit.confidence}
                      </Badge>
                    </div>
                    {/* Score Bar */}
                    <div className="flex items-center gap-3 pt-1">
                      <div className="w-36 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 85 ? 'bg-emerald-500' : pct >= 70 ? 'bg-blue-500' : 'bg-amber-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                        {crit.suggestedScore} / {crit.maxScore} pts ({pct}%)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="p-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-4">
                    {/* Positive Observations */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        Positive Observations:
                      </span>
                      <ul className="space-y-1">
                        {crit.positiveObservations.map((obs, idx) => (
                          <li key={idx} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                            <span className="text-emerald-500 font-bold">•</span>
                            <span>{obs}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Exact Deduction Explanations */}
                    {crit.exactDeductionExplanations.length > 0 && (
                      <div className="p-3 bg-amber-50/70 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-lg space-y-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                          <AlertTriangle size={12} className="text-amber-600 dark:text-amber-400" />
                          Exact Deduction Rationale:
                        </span>
                        <ul className="space-y-1 pt-1">
                          {crit.exactDeductionExplanations.map((ded, idx) => (
                            <li key={idx} className="text-xs text-amber-900 dark:text-amber-200/90 flex items-start gap-1.5">
                              <span className="font-bold text-amber-700 dark:text-amber-400">-</span>
                              <span>{ded}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Supporting Evidence References */}
                    {crit.evidenceReferences && crit.evidenceReferences.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Supporting Evidence Citations:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {crit.evidenceReferences.map((refStr, idx) => (
                            <EvidenceReferenceBadge key={idx} evidence={refStr} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Evidence Classifications */}
                    {crit.evidenceClassifications && crit.evidenceClassifications.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Evidence Classifications (Audit Ledger):
                        </span>
                        <div className="space-y-1.5">
                          {crit.evidenceClassifications.map((item, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                            >
                              <div className="space-y-0.5">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{item.claim}</span>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.rationale}</p>
                              </div>
                              <div className="self-start sm:self-center shrink-0">
                                {getClassificationBadge(item.classification)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Limitations and Disclaimers */}
                    {crit.limitations.length > 0 && (
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 italic pt-1">
                        Evaluation Limitations: {crit.limitations.join(' • ')}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};
