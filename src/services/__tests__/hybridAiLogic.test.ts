// ─────────────────────────────────────────────
// Proofly — Firebase AI Logic & Hybrid Inference Unit Tests
// Target: #BuildHybridAI 2026
// Verifies schema conformation, Prompt API bridge, telemetry, and fallback behavior
// ─────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  aiLogicService,
  STANDARD_EVALUATION_PROMPT,
  projectEvaluationSchema,
} from '../aiLogicService';
import { InferenceMode, InferenceSource } from 'firebase/ai';

describe('Firebase AI Logic Service & Hybrid Inference Pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Standard Prompt and Schema Verification', () => {
    it('uses the exact mandated evaluation prompt string', () => {
      expect(STANDARD_EVALUATION_PROMPT).toBe(
        'Evaluate this project summary for clarity, originality and technical feasibility. Return structured observations.'
      );
    });

    it('defines a structured output Schema covering clarity, originality, and feasibility', () => {
      expect(projectEvaluationSchema).toBeDefined();
      expect((projectEvaluationSchema as any).type).toBe('object');
      const properties = (projectEvaluationSchema as any).properties;
      expect(properties).toBeDefined();
      expect(properties.clarityScore).toBeDefined();
      expect(properties.originalityScore).toBeDefined();
      expect(properties.technicalFeasibilityScore).toBeDefined();
      expect(properties.summary).toBeDefined();
      expect(properties.clarityObservations).toBeDefined();
      expect(properties.originalityObservations).toBeDefined();
      expect(properties.feasibilityObservations).toBeDefined();
      expect(properties.keyRecommendations).toBeDefined();
    });
  });

  describe('Structured JSON Output Parser', () => {
    it('successfully parses clean JSON adhering to the evaluation schema', () => {
      const mockRawJson = JSON.stringify({
        clarityScore: 9,
        originalityScore: 8,
        technicalFeasibilityScore: 9,
        summary: 'Excellent project proposal with strong architectural foundation.',
        clarityObservations: ['Problem statement is articulately framed.', 'Objectives are quantified.'],
        originalityObservations: ['Novel hybrid inference pipeline on Chrome Gemini Nano.'],
        feasibilityObservations: ['Uses official Firebase AI Logic SDK.', 'Clean separation of concerns.'],
        keyRecommendations: ['Add live benchmarking script.', 'Conduct user study.'],
      });

      const parsed = aiLogicService.parseStructuredOutput(mockRawJson);
      expect(parsed.clarityScore).toBe(9);
      expect(parsed.originalityScore).toBe(8);
      expect(parsed.technicalFeasibilityScore).toBe(9);
      expect(parsed.summary).toBe('Excellent project proposal with strong architectural foundation.');
      expect(parsed.clarityObservations).toHaveLength(2);
      expect(parsed.originalityObservations).toHaveLength(1);
      expect(parsed.feasibilityObservations).toHaveLength(2);
      expect(parsed.keyRecommendations).toHaveLength(2);
    });

    it('correctly strips markdown code fences (```json ... ```)', () => {
      const fencedJson = `\`\`\`json
{
  "clarityScore": 8,
  "originalityScore": 7,
  "technicalFeasibilityScore": 8,
  "summary": "Fenced output test.",
  "clarityObservations": ["Clear."],
  "originalityObservations": ["Good."],
  "feasibilityObservations": ["Feasible."],
  "keyRecommendations": ["Deploy."]
}
\`\`\``;

      const parsed = aiLogicService.parseStructuredOutput(fencedJson);
      expect(parsed.clarityScore).toBe(8);
      expect(parsed.summary).toBe('Fenced output test.');
    });

    it('clamps scores within the strictly valid 1-10 boundary', () => {
      const outOfBoundsJson = JSON.stringify({
        clarityScore: 15, // Out of bounds high
        originalityScore: -3, // Out of bounds low
        technicalFeasibilityScore: 10,
        summary: 'Boundary test.',
        clarityObservations: [],
        originalityObservations: [],
        feasibilityObservations: [],
        keyRecommendations: [],
      });

      const parsed = aiLogicService.parseStructuredOutput(outOfBoundsJson);
      expect(parsed.clarityScore).toBe(10);
      expect(parsed.originalityScore).toBe(1);
      expect(parsed.technicalFeasibilityScore).toBe(10);
    });

    it('recovers JSON embedded within surrounding natural language text', () => {
      const noisyOutput = `Here are the evaluation results:
{
  "clarityScore": 7,
  "originalityScore": 8,
  "technicalFeasibilityScore": 9,
  "summary": "Embedded JSON test.",
  "clarityObservations": ["Well written."],
  "originalityObservations": ["Original idea."],
  "feasibilityObservations": ["Solid engineering."],
  "keyRecommendations": ["Add testing."]
}
Hope this helps!`;

      const parsed = aiLogicService.parseStructuredOutput(noisyOutput);
      expect(parsed.clarityScore).toBe(7);
      expect(parsed.summary).toBe('Embedded JSON test.');
    });

    it('throws a descriptive error when output is completely unparseable', () => {
      const garbage = 'Not a JSON object at all. Just random prose.';
      expect(() => aiLogicService.parseStructuredOutput(garbage)).toThrowError(
        /Failed to parse model response/
      );
    });
  });

  describe('Device Capabilities & Prompt API Bridge', () => {
    it('provides capability detection without throwing', async () => {
      const caps = await aiLogicService.checkDeviceCapabilities();
      expect(caps).toBeDefined();
      expect(typeof caps.isChrome).toBe('boolean');
      expect(typeof caps.promptApiExposed).toBe('boolean');
      expect(['available', 'downloadable', 'downloading', 'unavailable', 'unknown']).toContain(
        caps.availabilityStatus
      );
    });

    it('bridges window.ai.languageModel to window.LanguageModel if window.LanguageModel is absent', () => {
      const fakeWindow = {
        ai: {
          languageModel: {
            availability: vi.fn().mockResolvedValue('available'),
          },
        },
      };

      // Temporarily mock global window
      const originalWindow = globalThis.window;
      (globalThis as any).window = fakeWindow;

      aiLogicService.ensureChromePromptApiBridge();
      expect((globalThis as any).window.LanguageModel).toBe(fakeWindow.ai.languageModel);

      // Restore
      (globalThis as any).window = originalWindow;
    });
  });

  describe('Model Factory & Hybrid Configuration', () => {
    it('creates GenerativeModel configured with requested InferenceMode', () => {
      const model = aiLogicService.createModel(InferenceMode.PREFER_ON_DEVICE);
      expect(model).toBeDefined();
      expect(typeof model.generateContent).toBe('function');
      expect((model as any)._apiSettings?.inferenceMode).toBe(InferenceMode.PREFER_ON_DEVICE);
    });

    it('configures cloud fallback parameters with gemini-2.5-flash and responseSchema', () => {
      const model = aiLogicService.createModel(InferenceMode.PREFER_ON_DEVICE);
      expect((model as any).model).toContain('gemini-2.5-flash');
      expect((model as any).generationConfig?.responseMimeType).toBe('application/json');
      expect((model as any).generationConfig?.responseSchema).toBeDefined();
    });
  });

  describe('Evaluation Invocation & Validation Rules', () => {
    it('rejects empty or whitespace-only project summaries gracefully', async () => {
      const res = await aiLogicService.evaluateProjectSummary('   ');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/cannot be empty/i);
      expect(res.telemetry.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('attaches accurate telemetry and App Check status', async () => {
      // Mock generateContent on the model to test the full pipeline flow
      const mockResult = {
        response: {
          text: () =>
            JSON.stringify({
              clarityScore: 9,
              originalityScore: 9,
              technicalFeasibilityScore: 8,
              summary: 'Proofly Hybrid evaluation test.',
              clarityObservations: ['Observation 1'],
              originalityObservations: ['Observation 2'],
              feasibilityObservations: ['Observation 3'],
              keyRecommendations: ['Rec 1'],
            }),
          inferenceSource: InferenceSource.IN_CLOUD,
        },
      };

      vi.spyOn(aiLogicService, 'createModel').mockReturnValue({
        generateContent: vi.fn().mockResolvedValue(mockResult),
        initializeDeviceModel: vi.fn().mockResolvedValue(undefined),
      } as any);

      const res = await aiLogicService.evaluateProjectSummary(
        'Proofly Project Summary Test',
        InferenceMode.PREFER_ON_DEVICE
      );

      expect(res.success).toBe(true);
      expect(res.data?.clarityScore).toBe(9);
      expect(res.telemetry.requestedMode).toBe(InferenceMode.PREFER_ON_DEVICE);
      expect(res.telemetry.actualInferenceSource).toBe('IN_CLOUD');
      expect(res.telemetry.fallbackOccurred).toBe(true);
      expect(res.telemetry.modelUsed).toContain('gemini-2.5-flash');
      expect(res.telemetry.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('correctly tags ON_DEVICE when inferenceSource is on_device', async () => {
      const mockResult = {
        response: {
          text: () =>
            JSON.stringify({
              clarityScore: 10,
              originalityScore: 10,
              technicalFeasibilityScore: 10,
              summary: 'On-device Nano execution.',
              clarityObservations: ['Flawless.'],
              originalityObservations: ['Breakthrough.'],
              feasibilityObservations: ['Zero-latency local.'],
              keyRecommendations: [],
            }),
          inferenceSource: InferenceSource.ON_DEVICE,
        },
      };

      vi.spyOn(aiLogicService, 'createModel').mockReturnValue({
        generateContent: vi.fn().mockResolvedValue(mockResult),
        initializeDeviceModel: vi.fn().mockResolvedValue(undefined),
      } as any);

      const res = await aiLogicService.evaluateProjectSummary(
        'On device test',
        InferenceMode.PREFER_ON_DEVICE
      );

      expect(res.success).toBe(true);
      expect(res.telemetry.actualInferenceSource).toBe('ON_DEVICE');
      expect(res.telemetry.fallbackOccurred).toBe(false);
      expect(res.telemetry.modelUsed).toContain('Gemini Nano 4');
    });
  });
});
