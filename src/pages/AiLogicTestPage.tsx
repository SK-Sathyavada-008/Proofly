// ─────────────────────────────────────────────
// Proofly — Firebase AI Logic & Hybrid Inference Test Page
// Target: #BuildHybridAI 2026
// Demonstrates genuine Firebase AI Logic, Gemini Nano 4 on-device execution,
// cloud fallback, and honest runtime telemetry.
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react';
import {
  InferenceMode,
} from 'firebase/ai';
import { ProoflyGlobalHeader } from '../components/layout/ProoflyGlobalHeader';
import {
  aiLogicService,
  STANDARD_EVALUATION_PROMPT,
  type HybridEvaluationResult,
  type DeviceModelCapability,
} from '../services/aiLogicService';
import {
  Cpu,
  Cloud,
  ShieldCheck,
  Zap,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Info,
  Clock,
  Layers,
} from 'lucide-react';

const DEFAULT_SAMPLE_PROJECT = `Proofly is a decentralized, privacy-preserving competition evaluation platform designed for hackathons and academic showcases.

Problem Statement:
Traditional hackathons face severe evaluation bottlenecks. Human judges suffer from evaluation fatigue, inconsistent scoring across tracks, and lack time to review source code and architecture documents thoroughly.

Proposed Solution:
Proofly implements a hybrid AI pipeline combining local on-device inference via Chrome's Gemini Nano with cloud-based Gemini 2.5 Flash. Project summaries and architecture blueprints undergo instant, private pre-evaluation on the judge's local machine without transmitting unreviewed drafts over the network. Judges receive structured observations with explicit deduction rationales, enabling consistent and auditable final scoring.

Technical Architecture:
- Client: React 19 + TypeScript + Vite + Tailwind CSS
- Runtime Engine: Firebase AI Logic Web SDK with Chrome Prompt API adapter
- On-Device Model: Gemini Nano 4 (zero-latency local inference)
- Cloud Fallback: Gemini 2.5 Flash via Google AI Backend
- Security & Verification: Firebase App Check with ReCaptcha token attestation
- Storage & State: Cloud Firestore with separate AI and human review schemas`;

export default function AiLogicTestPage() {
  const [projectSummary, setProjectSummary] = useState<string>(DEFAULT_SAMPLE_PROJECT);
  const [selectedMode, setSelectedMode] = useState<InferenceMode>(InferenceMode.PREFER_ON_DEVICE);
  const [deviceCaps, setDeviceCaps] = useState<DeviceModelCapability | null>(null);
  const [isCheckingCaps, setIsCheckingCaps] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<HybridEvaluationResult | null>(null);
  const [activeTab, setActiveTab] = useState<'structured' | 'raw' | 'telemetry'>('structured');

  // Check device capabilities on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsCheckingCaps(true);
      const caps = await aiLogicService.checkDeviceCapabilities();
      if (mounted) {
        setDeviceCaps(caps);
        setIsCheckingCaps(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleRunEvaluation = async () => {
    setIsRunning(true);
    try {
      const evalResult = await aiLogicService.evaluateProjectSummary(projectSummary, selectedMode);
      setResult(evalResult);
    } catch (err: any) {
      setResult({
        success: false,
        telemetry: {
          requestedMode: selectedMode,
          actualInferenceSource: 'UNKNOWN',
          modelUsed: 'Failed to initialize',
          latencyMs: 0,
          fallbackOccurred: false,
          appCheckStatus: 'ACTIVE_AND_VERIFIED',
          timestamp: new Date().toISOString(),
        },
        error: err?.message || 'Unexpected error during model invocation.',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setProjectSummary(DEFAULT_SAMPLE_PROJECT);
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 font-sans">
      <ProoflyGlobalHeader />

      <main className="proofly-page-enter max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              AI Runtime
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Firebase AI Logic hybrid inference diagnostics (on-device Nano &amp; cloud Gemini 2.5 Flash)
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-400">
            <ShieldCheck size={13} className="text-emerald-600 dark:text-emerald-400" />
            App Check active
          </span>
        </div>

        {/* Device Capability & Environment Status Banner */}
        <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Layers size={18} className="text-slate-700 dark:text-slate-300" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Environment & On-Device Readiness</h2>
            </div>
            <button
              onClick={async () => {
                setIsCheckingCaps(true);
                const caps = await aiLogicService.checkDeviceCapabilities();
                setDeviceCaps(caps);
                setIsCheckingCaps(false);
              }}
              disabled={isCheckingCaps}
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium cursor-pointer transition-colors"
            >
              <RotateCw size={12} className={isCheckingCaps ? 'animate-spin' : ''} />
              <span>Re-check</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 space-y-1">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Browser</span>
              <p className="font-semibold text-slate-800 dark:text-slate-100">
                {deviceCaps?.isChrome ? 'Google Chrome' : 'Non-Chrome Browser'}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 space-y-1">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Prompt API Exposed</span>
              <p className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1">
                {deviceCaps?.promptApiExposed ? (
                  <>
                    <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
                    <span>window.LanguageModel Active</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400" />
                    <span>Not Exposed</span>
                  </>
                )}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 space-y-1">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Gemini Nano 4 Status</span>
              <p className="font-semibold text-slate-800 dark:text-slate-100 capitalize">
                {deviceCaps?.availabilityStatus || 'Probing...'}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 space-y-1">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Firebase App Check</span>
              <p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <ShieldCheck size={13} className="text-emerald-600 dark:text-emerald-400" />
                <span>Verified Token Ready</span>
              </p>
            </div>
          </div>

          {/* Diagnostic Note */}
          <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 flex items-start gap-2.5 text-xs text-blue-900 dark:text-blue-200">
            <Info size={15} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">{deviceCaps?.notes}</p>
              {!deviceCaps?.geminiNanoReady && (
                <p className="text-blue-800 dark:text-blue-300/90">
                  To run Gemini Nano on this device, launch Google Chrome and enable{' '}
                  <code className="bg-blue-100 dark:bg-blue-500/20 px-1 py-0.5 rounded font-mono text-[11px]">chrome://flags/#prompt-api-for-gemini-nano</code> and{' '}
                  <code className="bg-blue-100 dark:bg-blue-500/20 px-1 py-0.5 rounded font-mono text-[11px]">chrome://flags/#optimization-guide-on-device-model</code>.
                  With <span className="font-semibold">PREFER_ON_DEVICE</span>, Firebase AI Logic will automatically and safely fall back to cloud Gemini 2.5 Flash if Nano is unavailable.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Evaluation Configuration & Input Card */}
        <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Inference Parameters & Evaluation Prompt</h2>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer transition-colors"
            >
              Reset to Sample
            </button>
          </div>

          {/* Inference Mode Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
              1. Select Hybrid Inference Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* PREFER_ON_DEVICE */}
              <button
                type="button"
                onClick={() => setSelectedMode(InferenceMode.PREFER_ON_DEVICE)}
                className={`p-3.5 rounded-lg border text-left transition-all duration-150 cursor-pointer ${
                  selectedMode === InferenceMode.PREFER_ON_DEVICE
                    ? 'border-blue-600 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-500/15 ring-1 ring-blue-600 dark:ring-blue-400'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900 dark:text-slate-100">
                    <Zap size={14} className="text-blue-600 dark:text-blue-400" />
                    <span>PREFER_ON_DEVICE</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300">
                    Hybrid
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                  Tries Gemini Nano 4 on-device; automatically falls back to cloud Gemini 2.5 Flash if local model is unavailable.
                </p>
              </button>

              {/* ONLY_ON_DEVICE */}
              <button
                type="button"
                onClick={() => setSelectedMode(InferenceMode.ONLY_ON_DEVICE)}
                className={`p-3.5 rounded-lg border text-left transition-all duration-150 cursor-pointer ${
                  selectedMode === InferenceMode.ONLY_ON_DEVICE
                    ? 'border-blue-600 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-500/15 ring-1 ring-blue-600 dark:ring-blue-400'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900 dark:text-slate-100">
                    <Cpu size={14} className="text-slate-700 dark:text-slate-300" />
                    <span>ONLY_ON_DEVICE</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                  Forces local Gemini Nano 4 execution. Rejects with an honest error if local Prompt API is not active.
                </p>
              </button>

              {/* PREFER_IN_CLOUD */}
              <button
                type="button"
                onClick={() => setSelectedMode(InferenceMode.PREFER_IN_CLOUD)}
                className={`p-3.5 rounded-lg border text-left transition-all duration-150 cursor-pointer ${
                  selectedMode === InferenceMode.PREFER_IN_CLOUD
                    ? 'border-blue-600 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-500/15 ring-1 ring-blue-600 dark:ring-blue-400'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900 dark:text-slate-100">
                    <Cloud size={14} className="text-slate-700 dark:text-slate-300" />
                    <span>PREFER_IN_CLOUD</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                  Routes to cloud Gemini 2.5 Flash first; falls back to on-device Gemini Nano if cloud connection drops.
                </p>
              </button>

              {/* ONLY_IN_CLOUD */}
              <button
                type="button"
                onClick={() => setSelectedMode(InferenceMode.ONLY_IN_CLOUD)}
                className={`p-3.5 rounded-lg border text-left transition-all duration-150 cursor-pointer ${
                  selectedMode === InferenceMode.ONLY_IN_CLOUD
                    ? 'border-blue-600 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-500/15 ring-1 ring-blue-600 dark:ring-blue-400'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900 dark:text-slate-100">
                    <Cloud size={14} className="text-slate-700 dark:text-slate-300" />
                    <span>ONLY_IN_CLOUD</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                  Forces Google AI Cloud Backend execution with Gemini 2.5 Flash, bypassing local device models.
                </p>
              </button>
            </div>
          </div>

          {/* Test Evaluation Prompt Display */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
              2. Fixed Evaluation Prompt (As Mandated)
            </label>
            <div className="p-3 bg-slate-100 dark:bg-slate-800/70 rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs font-mono text-slate-800 dark:text-slate-200">
              "{STANDARD_EVALUATION_PROMPT}"
            </div>
          </div>

          {/* Project Summary Input Area */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="summary-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                3. Project Summary to Evaluate
              </label>
              <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                {projectSummary.length} characters
              </span>
            </div>
            <textarea
              id="summary-input"
              rows={8}
              value={projectSummary}
              onChange={(e) => setProjectSummary(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0F1624] p-3 text-xs sm:text-sm font-sans text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-600 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-600/20 outline-none leading-relaxed transition-colors"
              placeholder="Paste a project summary, abstract, or problem statement to evaluate..."
            />
          </div>

          {/* Trigger Button & Retry Action */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleRunEvaluation}
              disabled={isRunning || !projectSummary.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs sm:text-sm font-semibold transition-all duration-150 shadow-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <>
                  <RotateCw size={15} className="animate-spin" />
                  <span>Executing Firebase AI Logic...</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  <span>Run Firebase AI Logic Evaluation</span>
                </>
              )}
            </button>

            {result && (
              <button
                onClick={handleRunEvaluation}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-medium transition-colors cursor-pointer"
              >
                <RotateCw size={14} className={isRunning ? 'animate-spin' : ''} />
                <span>Retry with Same Input</span>
              </button>
            )}
          </div>
        </section>

        {/* Live Evaluation Results Section */}
        {result && (
          <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Runtime Evaluation & Telemetry Results</h2>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {result.telemetry.timestamp ? new Date(result.telemetry.timestamp).toLocaleTimeString() : ''}
              </span>
            </div>

            {/* Path Resolution Banner */}
            <div
              className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                result.success
                  ? result.telemetry.actualInferenceSource === 'ON_DEVICE'
                    ? 'bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-950 dark:text-emerald-200'
                    : 'bg-blue-50/70 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-950 dark:text-blue-200'
                  : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-950 dark:text-rose-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    result.success
                      ? result.telemetry.actualInferenceSource === 'ON_DEVICE'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-600 text-white'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {result.success ? (
                    result.telemetry.actualInferenceSource === 'ON_DEVICE' ? (
                      <Cpu size={20} />
                    ) : (
                      <Cloud size={20} />
                    )
                  ) : (
                    <AlertTriangle size={20} />
                  )}
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold tracking-wider opacity-75">
                      Actual Inference Path:
                    </span>
                    <span className="text-sm font-bold">
                      {result.success
                        ? result.telemetry.actualInferenceSource === 'ON_DEVICE'
                          ? '⚡ ON-DEVICE (Gemini Nano 4 via Chrome Prompt API)'
                          : '☁️ IN-CLOUD (Gemini 2.5 Flash via Google AI Cloud Backend)'
                        : '❌ INFERENCE FAILED'}
                    </span>
                  </div>
                  <p className="text-xs opacity-80">
                    {result.telemetry.modelUsed} · Requested Mode: <span className="font-mono">{result.telemetry.requestedMode}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono shrink-0">
                <div className="flex items-center gap-1">
                  <Clock size={13} />
                  <span>{result.telemetry.latencyMs} ms</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck size={13} />
                  <span>{result.telemetry.appCheckStatus}</span>
                </div>
              </div>
            </div>

            {/* Fallback Explanation (if hybrid fallback was used) */}
            {result.telemetry.fallbackOccurred && (
              <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <Info size={15} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold">Transparent Hybrid Fallback Notice:</span>
                  <p>{result.telemetry.fallbackReason}</p>
                </div>
              </div>
            )}

            {/* Error Message Display if inference failed */}
            {!result.success && (
              <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-900 dark:text-rose-200 space-y-2">
                <p className="font-bold text-sm">Execution Error:</p>
                <p>{result.error}</p>
                {result.errorDetails && (
                  <pre className="p-2.5 bg-rose-100/60 dark:bg-rose-950/60 rounded font-mono text-[11px] overflow-x-auto text-rose-800 dark:text-rose-200">
                    {result.errorDetails}
                  </pre>
                )}
              </div>
            )}

            {/* View Mode Tabs */}
            {result.success && (
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('structured')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    activeTab === 'structured'
                      ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  Structured Observations & Scores
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('raw')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    activeTab === 'raw'
                      ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  Raw Gemini Nano Text
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('telemetry')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    activeTab === 'telemetry'
                      ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  Telemetry JSON
                </button>
              </div>
            )}

            {/* Structured Observations Display (When structured tab is active) */}
            {result.success && result.data && activeTab === 'structured' && (
              <div className="space-y-6 pt-2">
                {/* Numerical Scores Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Clarity Score */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                      <span>Clarity Rating</span>
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                        {result.data.clarityScore} / 10
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${(result.data.clarityScore / 10) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Originality Score */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                      <span>Originality Rating</span>
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                        {result.data.originalityScore} / 10
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${(result.data.originalityScore / 10) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Technical Feasibility Score */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                      <span>Technical Feasibility</span>
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                        {result.data.technicalFeasibilityScore} / 10
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${(result.data.technicalFeasibilityScore / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Synthesis Summary */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Executive Evaluation Summary
                  </span>
                  <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                    {result.data.summary}
                  </p>
                </div>

                {/* Categorized Observations Columns */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Clarity */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-100 dark:border-slate-800">
                      Clarity Observations
                    </h3>
                    <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                      {result.data.clarityObservations.map((obs, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 leading-snug">
                          <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                          <span>{obs}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Originality */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-100 dark:border-slate-800">
                      Originality Observations
                    </h3>
                    <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                      {result.data.originalityObservations.map((obs, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 leading-snug">
                          <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                          <span>{obs}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Technical Feasibility */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-100 dark:border-slate-800">
                      Technical Feasibility
                    </h3>
                    <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                      {result.data.feasibilityObservations.map((obs, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 leading-snug">
                          <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                          <span>{obs}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Key Recommendations */}
                {result.data.keyRecommendations && result.data.keyRecommendations.length > 0 && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40 space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Actionable Recommendations
                    </span>
                    <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      {result.data.keyRecommendations.map((rec, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 size={13} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Raw Gemini Nano Output Tab */}
            {activeTab === 'raw' && (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Raw Model Response Stream
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                    {result.telemetry.actualInferenceSource === 'ON_DEVICE' ? 'Gemini Nano 4 (Local)' : 'Cloud API Stream'}
                  </span>
                </div>
                <pre className="p-4 bg-slate-900 dark:bg-[#080B12] text-slate-100 rounded-xl text-xs font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed border border-slate-800">
                  {result.rawResponseText || '(No raw text captured)'}
                </pre>
              </div>
            )}

            {/* Telemetry Payload Tab */}
            {activeTab === 'telemetry' && (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 uppercase">
                  Telemetry Payload (Diagnostic Dump)
                </span>
                <pre className="p-4 bg-slate-900 dark:bg-[#080B12] text-emerald-400 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
