// ─────────────────────────────────────────────
// CreateCalibrationModal.tsx — Phase 12 Calibration Exercise Authoring
// Proofly — Create Sample Submissions & Hidden Benchmark Rubrics
// ─────────────────────────────────────────────

import React, { useState } from 'react';
import { Target, Plus, Trash2, HelpCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { calibrationAndDisagreementService } from '../../services/calibrationAndDisagreementService';
import type { RubricCriterion, Competition } from '../../types/authAndCompetition';
import type { CalibrationExercise, SampleProjectArtifact } from '../../types/calibrationAndDisagreement';

interface CreateCalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  competitions: Competition[];
  selectedCompId?: string;
  creatorId: string;
  creatorName: string;
  onExerciseCreated?: (exercise: CalibrationExercise) => void;
}

export const CreateCalibrationModal: React.FC<CreateCalibrationModalProps> = ({
  isOpen,
  onClose,
  competitions,
  selectedCompId,
  creatorId,
  creatorName,
  onExerciseCreated,
}) => {
  const { success, warning, error: toastError } = useToast();

  const [competitionId, setCompetitionId] = useState(
    selectedCompId && selectedCompId !== 'ALL' ? selectedCompId : competitions[0]?.id || ''
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Sample Project
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectTrack, setProjectTrack] = useState('Event Tech');

  // Artifacts
  const [artifacts, setArtifacts] = useState<SampleProjectArtifact[]>([
    { name: 'README.md', type: 'TEXT_MARKDOWN', contentSnippet: '# Sample Project Architecture' },
    { name: 'pitch_deck.pdf', type: 'PDF' },
  ]);

  // Rubric & Reference Scores
  const activeComp = competitions.find((c) => c.id === competitionId) || competitions[0];
  const rubricCriteria: RubricCriterion[] = activeComp?.rubric || [
    { id: 'crit-tech', name: 'Technological Implementation', description: 'Code quality & stack.', maxScore: 25, weight: 25 },
    { id: 'crit-design', name: 'Design & UX', description: 'Ergonomics & aesthetics.', maxScore: 25, weight: 25 },
    { id: 'crit-impact', name: 'Potential Impact', description: 'Value & scalability.', maxScore: 25, weight: 25 },
    { id: 'crit-idea', name: 'Quality of Idea', description: 'Novelty & ambition.', maxScore: 25, weight: 25 },
  ];

  const [referenceScores, setReferenceScores] = useState<Record<string, number>>({
    'crit-tech': 20,
    'crit-design': 18,
    'crit-impact': 22,
    'crit-idea': 19,
  });

  const [referenceReasoning, setReferenceReasoning] = useState<Record<string, string>>({
    'crit-tech': 'Comprehensive architecture with clean module boundaries; slight deduction for missing test coverage.',
    'crit-design': 'Thoughtful typography and responsive navigation; minor contrast issue in table headers.',
    'crit-impact': 'Strong friction-reduction in organizer workflows; highly scalable SaaS model.',
    'crit-idea': 'Novel hybrid AI orchestration pattern.',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleScoreChange = (critId: string, val: number, maxScore: number) => {
    setReferenceScores((prev) => ({
      ...prev,
      [critId]: Math.max(0, Math.min(val, maxScore)),
    }));
  };

  const handleReasoningChange = (critId: string, text: string) => {
    setReferenceReasoning((prev) => ({
      ...prev,
      [critId]: text,
    }));
  };

  const handleAddArtifact = () => {
    setArtifacts((prev) => [...prev, { name: 'artifact.pdf', type: 'PDF' }]);
  };

  const handleRemoveArtifact = (index: number) => {
    setArtifacts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleArtifactChange = (index: number, field: keyof SampleProjectArtifact, val: string) => {
    setArtifacts((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !projectTitle.trim() || !competitionId) {
      warning('Required Fields Missing', 'Please fill in the exercise title, sample project title, and competition.');
      return;
    }

    setIsSubmitting(true);
    try {
      const ex = await calibrationAndDisagreementService.createCalibrationExercise({
        organizationId: activeComp?.organizationId || '',
        competitionId,
        title,
        description,
        sampleProject: {
          title: projectTitle,
          description: projectDescription,
          track: projectTrack,
          artifacts,
        },
        rubric: rubricCriteria,
        referenceScores,
        referenceReasoning,
        status: 'ACTIVE',
        createdBy: creatorId,
        createdByName: creatorName,
      });

      success('Calibration Exercise Created', `Created "${ex.title}". Reference benchmark scores will remain hidden from judges until they submit.`);
      onExerciseCreated?.(ex);
      onClose();
    } catch (err: any) {
      toastError('Creation Failed', err?.message || 'Could not create calibration exercise.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Judge Calibration Exercise"
    >
      <form onSubmit={handleSubmit} className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
        {/* Info Box */}
        <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-xl text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
          <HelpCircle size={15} className="text-blue-600 shrink-0 mt-0.5" />
          <p>
            Calibration exercises allow judges to practice scoring on sample submissions before evaluating live projects.
            <strong> Reference scores and justifications are strictly hidden</strong> from the judge until they submit their calibration.
          </p>
        </div>

        {/* Basic Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Competition *
            </label>
            <select
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-slate-100"
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Exercise Title *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Baseline Calibration: EventScout Sample"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Exercise Guidance & Description
          </label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Provide instructions for judges taking this calibration exercise..."
          />
        </div>

        {/* Sample Project Details */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/50">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Target size={13} className="text-blue-600" />
            Sample Project Definition
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Sample Project Title *
              </label>
              <Input
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="e.g. Cardiopulse AI"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Project Track
              </label>
              <Input
                value={projectTrack}
                onChange={(e) => setProjectTrack(e.target.value)}
                placeholder="e.g. Healthcare & Edge AI"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Sample Project Description
            </label>
            <Textarea
              rows={2}
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="Describe the sample submission's problem statement and solution..."
            />
          </div>

          {/* Sample Artifacts */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Sample Artifacts Available to Judges
              </span>
              <Button type="button" variant="ghost" size="xs" leftIcon={<Plus size={12} />} onClick={handleAddArtifact}>
                Add Artifact
              </Button>
            </div>
            {artifacts.map((art, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={art.name}
                  onChange={(e) => handleArtifactChange(idx, 'name', e.target.value)}
                  placeholder="Artifact Name (e.g. pitch.pdf)"
                  className="text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 flex-1"
                />
                <select
                  value={art.type}
                  onChange={(e) => handleArtifactChange(idx, 'type', e.target.value)}
                  className="text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 w-36"
                >
                  <option value="PDF">PDF</option>
                  <option value="PPTX">PPTX Slide</option>
                  <option value="GITHUB_REPO">GitHub Repo</option>
                  <option value="DEPLOYMENT_URL">Live URL</option>
                  <option value="TEXT_MARKDOWN">Markdown / Text</option>
                  <option value="ZIP_ARCHIVE">ZIP Archive</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleRemoveArtifact(idx)}
                  className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Benchmark Rubric Scores & Justifications */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 bg-white dark:bg-slate-900">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Benchmark Reference Scores & Justifications (Hidden from Judges)
          </h4>

          <div className="space-y-3">
            {rubricCriteria.map((crit) => (
              <div
                key={crit.id}
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">{crit.name}</span>
                    <span className="text-[11px] text-slate-400 ml-2">Max: {crit.maxScore} pts</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reference:</span>
                    <input
                      type="number"
                      min={0}
                      max={crit.maxScore}
                      step={1}
                      value={referenceScores[crit.id] ?? ''}
                      onChange={(e) => handleScoreChange(crit.id, parseFloat(e.target.value) || 0, crit.maxScore)}
                      className="w-16 px-2 py-1 text-xs font-bold text-center font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <span className="text-xs text-slate-400">/ {crit.maxScore}</span>
                  </div>
                </div>

                <div>
                  <textarea
                    rows={2}
                    value={referenceReasoning[crit.id] ?? ''}
                    onChange={(e) => handleReasoningChange(crit.id, e.target.value)}
                    placeholder="Enter official benchmark justification explaining why this sample earns this score..."
                    className="w-full text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
            Create Calibration Exercise
          </Button>
        </div>
      </form>
    </Modal>
  );
};
