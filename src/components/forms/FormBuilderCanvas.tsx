// ─────────────────────────────────────────────
// FormBuilderCanvas.tsx — Visual Submission Form Builder
// Proofly — Phase 4
// ─────────────────────────────────────────────

import React, { useState } from 'react';
import {
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  Save,
  FileText,
  Type,
  AlignLeft,
  Mail,
  Link as LinkIcon,
  Hash,
  List,
  CheckSquare,
  Upload,
  Video,
  Users,
  Settings2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Badge } from '../ui/Badge';
import { GithubIcon } from '../ui/GithubIcon';
import { DEFAULT_HACKATHON_FIELDS, DEFAULT_RESEARCH_FIELDS } from '../../services/formBuilderService';
import type {
  SubmissionFormSchema,
  SubmissionFormField,
  FormFieldType,
  FieldVisibility,
} from '../../types/formAndAccess';

interface FormBuilderCanvasProps {
  initialSchema: SubmissionFormSchema;
  onSave: (schema: SubmissionFormSchema) => Promise<void>;
  isLoading?: boolean;
}

const FIELD_TYPE_OPTIONS: { type: FormFieldType; label: string; icon: any }[] = [
  { type: 'SHORT_TEXT', label: 'Short Text', icon: Type },
  { type: 'LONG_TEXT', label: 'Long Text / Overview', icon: AlignLeft },
  { type: 'EMAIL', label: 'Email Address', icon: Mail },
  { type: 'URL', label: 'Website / Demo URL', icon: LinkIcon },
  { type: 'NUMBER', label: 'Numeric Value', icon: Hash },
  { type: 'DROPDOWN', label: 'Dropdown Selection', icon: List },
  { type: 'MULTI_SELECT', label: 'Multi-Select', icon: List },
  { type: 'CHECKBOX', label: 'Checkbox / Consent', icon: CheckSquare },
  { type: 'FILE_UPLOAD', label: 'File Upload (Single)', icon: Upload },
  { type: 'MULTIPLE_FILE_UPLOAD', label: 'File Upload (Multiple)', icon: Upload },
  { type: 'GITHUB_URL', label: 'GitHub Repository URL', icon: GithubIcon },
  { type: 'VIDEO_URL', label: 'Demo Video Link', icon: Video },
  { type: 'TEAM_MEMBER_REPEATER', label: 'Team Member Repeater', icon: Users },
];

export const FormBuilderCanvas: React.FC<FormBuilderCanvasProps> = ({
  initialSchema,
  onSave,
  isLoading = false,
}) => {
  const [schema, setSchema] = useState<SubmissionFormSchema>(initialSchema);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    initialSchema.fields[0]?.id || null
  );

  const selectedField = schema.fields.find((f) => f.id === selectedFieldId);

  const handleAddField = (type: FormFieldType) => {
    const typeMeta = FIELD_TYPE_OPTIONS.find((o) => o.type === type);
    const newFieldId = `field-${Math.random().toString(36).substring(2, 8)}`;
    const newField: SubmissionFormField = {
      id: newFieldId,
      type,
      label: `New ${typeMeta?.label || 'Field'}`,
      description: '',
      placeholder: '',
      required: true,
      order: schema.fields.length + 1,
      visibility: 'PUBLIC',
      validation: {
        required: true,
        ...(type === 'SHORT_TEXT' ? { minLength: 2, maxLength: 100 } : {}),
        ...(type === 'LONG_TEXT' ? { minLength: 20, maxLength: 3000 } : {}),
        ...(type === 'DROPDOWN' || type === 'MULTI_SELECT'
          ? { options: ['Option A', 'Option B', 'Option C'] }
          : {}),
        ...(type === 'FILE_UPLOAD' || type === 'MULTIPLE_FILE_UPLOAD'
          ? { fileTypeRestrictions: ['.pdf', '.ppt', '.pptx', '.zip', '.png', '.jpg'], maxFileSizeMb: 25, maxFilesCount: 3 }
          : {}),
        ...(type === 'TEAM_MEMBER_REPEATER' ? { minMembers: 1, maxMembers: 4 } : {}),
      },
    };

    setSchema((prev) => ({
      ...prev,
      fields: [...prev.fields, newField],
    }));
    setSelectedFieldId(newFieldId);
  };

  const handleUpdateField = (fieldId: string, updates: Partial<SubmissionFormField>) => {
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => {
        if (f.id !== fieldId) return f;
        return {
          ...f,
          ...updates,
          validation: {
            ...f.validation,
            ...(updates.validation || {}),
            required: updates.required !== undefined ? updates.required : f.required,
          },
        };
      }),
    }));
  };

  const handleDeleteField = (fieldId: string) => {
    setSchema((prev) => {
      const remaining = prev.fields.filter((f) => f.id !== fieldId);
      return {
        ...prev,
        fields: remaining.map((f, i) => ({ ...f, order: i + 1 })),
      };
    });
    if (selectedFieldId === fieldId) {
      setSelectedFieldId(schema.fields[0]?.id || null);
    }
  };

  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= schema.fields.length) return;

    const copy = [...schema.fields];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;

    setSchema((prev) => ({
      ...prev,
      fields: copy.map((f, i) => ({ ...f, order: i + 1 })),
    }));
  };

  const handleLoadTemplate = (type: 'hackathon' | 'research') => {
    if (type === 'hackathon') {
      setSchema((prev) => ({
        ...prev,
        title: 'Team Hackathon Submission Form',
        description: 'Multi-artifact team project submission form with GitHub and demo links.',
        fields: [...DEFAULT_HACKATHON_FIELDS],
      }));
      setSelectedFieldId(DEFAULT_HACKATHON_FIELDS[0]?.id || null);
    } else {
      setSchema((prev) => ({
        ...prev,
        title: 'Individual Research Project Submission Form',
        description: 'Single-author scientific research study with preprint manuscript upload and replication archive.',
        fields: [...DEFAULT_RESEARCH_FIELDS],
      }));
      setSelectedFieldId(DEFAULT_RESEARCH_FIELDS[0]?.id || null);
    }
  };

  const handleSave = async () => {
    await onSave(schema);
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-blue-600 dark:text-blue-400" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{schema.title}</h3>
            <Badge variant="primary" size="sm">
              {schema.fields.length} Fields
            </Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
            {schema.description || 'Configurable submission schema for AI logic screening and human evaluation.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                activeTab === 'editor'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Schema Builder
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1 rounded-md font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'preview'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Eye size={12} />
              <span>Participant Preview</span>
            </button>
          </div>

          <Button
            variant="primary"
            size="sm"
            leftIcon={<Save size={14} />}
            onClick={handleSave}
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : 'Save Form Schema'}
          </Button>
        </div>
      </div>

      {/* Quick Template Preset Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-blue-50/70 dark:bg-blue-500/10 rounded-xl border border-blue-200/80 dark:border-blue-500/25 text-xs">
        <div className="space-y-0.5">
          <span className="font-bold text-blue-900 dark:text-blue-200 block">Preset Form Templates</span>
          <span className="text-slate-600 dark:text-slate-400 text-[11px]">
            Switch between Team Hackathon or Individual Research schemas in one click
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => handleLoadTemplate('hackathon')}
          >
            Load Team Hackathon Form
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => handleLoadTemplate('research')}
          >
            Load Individual Research Form
          </Button>
        </div>
      </div>

      {activeTab === 'editor' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Field Palette & Order List (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Field Palette Menu */}
            <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Add Form Field (13 Supported Types)
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">Click to append</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FIELD_TYPE_OPTIONS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => handleAddField(item.type)}
                      className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/50 hover:bg-blue-50/60 dark:hover:bg-blue-500/15 hover:border-blue-300 dark:hover:border-blue-500/40 text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 text-xs text-left transition-colors cursor-pointer group"
                    >
                      <Icon size={14} className="text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 shrink-0" />
                      <span className="truncate font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Configured Fields Sequence */}
            <div className="space-y-2">
              {schema.fields.map((field, idx) => {
                const isSelected = field.id === selectedFieldId;
                const typeMeta = FIELD_TYPE_OPTIONS.find((t) => t.type === field.type);
                const Icon = typeMeta?.icon || FileText;

                return (
                  <div
                    key={field.id}
                    onClick={() => setSelectedFieldId(field.id)}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/40 dark:bg-blue-500/10 border-blue-400 dark:border-blue-500/60 ring-2 ring-blue-500/10 shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveField(idx, 'up');
                          }}
                          disabled={idx === 0}
                          className="p-1 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 cursor-pointer"
                          title="Move Up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveField(idx, 'down');
                          }}
                          disabled={idx === schema.fields.length - 1}
                          className="p-1 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 cursor-pointer"
                          title="Move Down"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                        <Icon size={14} />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {field.label}
                          </span>
                          {field.required && (
                            <span className="text-[10px] font-bold text-red-600 dark:text-rose-400 bg-red-50 dark:bg-rose-500/15 px-1.5 py-0.2 rounded border border-red-200 dark:border-rose-500/30">
                              Required
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                          Type: {field.type} · Order: #{field.order}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteField(field.id);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-500/15 transition-colors cursor-pointer"
                        title="Delete Field"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Selected Field Inspector (5 cols) */}
          <div className="lg:col-span-5">
            {selectedField ? (
              <div className="sticky top-20 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Settings2 size={16} className="text-blue-600 dark:text-blue-400" />
                    <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                      Field Properties
                    </h4>
                  </div>
                  <Badge variant="neutral" size="sm">
                    {selectedField.type}
                  </Badge>
                </div>

                <div className="space-y-3">
                  <Input
                    label="Field Label"
                    value={selectedField.label}
                    onChange={(e) => handleUpdateField(selectedField.id, { label: e.target.value })}
                  />

                  <Input
                    label="Description / Helper Text"
                    value={selectedField.description || ''}
                    placeholder="Instructions shown to participant"
                    onChange={(e) =>
                      handleUpdateField(selectedField.id, { description: e.target.value })
                    }
                  />

                  <Input
                    label="Placeholder Text"
                    value={selectedField.placeholder || ''}
                    placeholder="e.g. Enter value..."
                    onChange={(e) =>
                      handleUpdateField(selectedField.id, { placeholder: e.target.value })
                    }
                  />

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <Select
                      label="Visibility"
                      value={selectedField.visibility}
                      onChange={(e) =>
                        handleUpdateField(selectedField.id, {
                          visibility: e.target.value as FieldVisibility,
                        })
                      }
                      options={[
                        { value: 'PUBLIC', label: 'Public Form' },
                        { value: 'ORGANIZER_ONLY', label: 'Organizer Only' },
                        { value: 'JUDGE_ONLY', label: 'Judges Only' },
                      ]}
                    />

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Requirement</label>
                      <label className="flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 cursor-pointer text-xs text-slate-800 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedField.required}
                          onChange={(e) =>
                            handleUpdateField(selectedField.id, { required: e.target.checked })
                          }
                          className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-medium">Mandatory</span>
                      </label>
                    </div>
                  </div>

                  {/* Dropdown Options Editor */}
                  {(selectedField.type === 'DROPDOWN' || selectedField.type === 'MULTI_SELECT') && (
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Options (Comma-separated)
                      </label>
                      <textarea
                        rows={3}
                        value={(selectedField.validation.options || []).join(', ')}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            validation: {
                              ...selectedField.validation,
                              options: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                        className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F1624] text-slate-900 dark:text-slate-100 font-mono"
                        placeholder="Option 1, Option 2, Option 3"
                      />
                    </div>
                  )}

                  {/* File Upload Restrictions */}
                  {(selectedField.type === 'FILE_UPLOAD' ||
                    selectedField.type === 'MULTIPLE_FILE_UPLOAD') && (
                    <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <Input
                        label="Allowed Extensions (Comma-separated)"
                        value={(selectedField.validation.fileTypeRestrictions || []).join(', ')}
                        placeholder=".pdf, .zip, .ppt"
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            validation: {
                              ...selectedField.validation,
                              fileTypeRestrictions: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                      />
                      <Input
                        label="Max File Size (MB)"
                        type="number"
                        min="1"
                        max="200"
                        value={selectedField.validation.maxFileSizeMb || 25}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            validation: {
                              ...selectedField.validation,
                              maxFileSizeMb: parseInt(e.target.value) || 25,
                            },
                          })
                        }
                      />
                    </div>
                  )}

                  {/* Team Member Repeater Restrictions */}
                  {selectedField.type === 'TEAM_MEMBER_REPEATER' && (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <Input
                        label="Min Members"
                        type="number"
                        min="1"
                        max="10"
                        value={selectedField.validation.minMembers || 1}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            validation: {
                              ...selectedField.validation,
                              minMembers: parseInt(e.target.value) || 1,
                            },
                          })
                        }
                      />
                      <Input
                        label="Max Members"
                        type="number"
                        min="1"
                        max="10"
                        value={selectedField.validation.maxMembers || 5}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            validation: {
                              ...selectedField.validation,
                              maxMembers: parseInt(e.target.value) || 5,
                            },
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 text-xs">
                Select a field to configure its validation rules and visibility.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Participant Preview Mode */
        <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4 space-y-1">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{schema.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{schema.description}</p>
          </div>

          <div className="space-y-4">
            {schema.fields.map((field) => (
              <div key={field.id} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {field.label}
                  </label>
                  {field.required && <span className="text-red-500 dark:text-rose-400 font-bold">*</span>}
                </div>

                {field.description && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{field.description}</p>
                )}

                {/* Render Mock Preview Inputs */}
                {field.type === 'SHORT_TEXT' && (
                  <input
                    type="text"
                    disabled
                    placeholder={field.placeholder || 'Text input...'}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
                  />
                )}

                {field.type === 'LONG_TEXT' && (
                  <textarea
                    rows={4}
                    disabled
                    placeholder={field.placeholder || 'Long text area...'}
                    className="w-full text-xs p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
                  />
                )}

                {field.type === 'EMAIL' && (
                  <input
                    type="email"
                    disabled
                    placeholder="alice@example.com"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
                  />
                )}

                {field.type === 'URL' && (
                  <input
                    type="url"
                    disabled
                    placeholder="https://..."
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
                  />
                )}

                {field.type === 'GITHUB_URL' && (
                  <input
                    type="url"
                    disabled
                    placeholder="https://github.com/..."
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
                  />
                )}

                {field.type === 'NUMBER' && (
                  <input
                    type="number"
                    disabled
                    placeholder="0"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
                  />
                )}

                {field.type === 'DROPDOWN' && (
                  <select
                    disabled
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
                  >
                    {(field.validation.options || ['Option 1', 'Option 2']).map((opt) => (
                      <option key={opt}>{opt}</option>
                    ))}
                  </select>
                )}

                {field.type === 'CHECKBOX' && (
                  <div className="flex items-center gap-2 pt-1">
                    <input type="checkbox" disabled className="rounded border-slate-300 dark:border-slate-600" />
                    <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">I agree</span>
                  </div>
                )}

                {(field.type === 'FILE_UPLOAD' || field.type === 'MULTIPLE_FILE_UPLOAD') && (
                  <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    <Upload size={18} className="mx-auto text-slate-400 dark:text-slate-500" />
                    <p className="font-medium">Drag & drop files or browse</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">
                      Allowed: {field.validation.fileTypeRestrictions?.join(', ') || 'Any'} (Max{' '}
                      {field.validation.maxFileSizeMb || 25} MB)
                    </p>
                  </div>
                )}

                {field.type === 'TEAM_MEMBER_REPEATER' && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        disabled
                        placeholder="Member #1 Full Name"
                        className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      <input
                        type="email"
                        disabled
                        placeholder="Member #1 Email"
                        className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                      Allows adding between {field.validation.minMembers || 1} and{' '}
                      {field.validation.maxMembers || 5} members.
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
