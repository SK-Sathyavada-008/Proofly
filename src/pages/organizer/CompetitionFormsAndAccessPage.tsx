// ─────────────────────────────────────────────
// CompetitionFormsAndAccessPage.tsx — Form Builder & Access Keys Management
// Proofly — Phase 4
// ─────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FileText,
  KeyRound,
  Trophy,
  Layers,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tabs } from '../../components/ui/Tabs';
import { Select } from '../../components/ui/Select';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FormBuilderCanvas } from '../../components/forms/FormBuilderCanvas';
import { AccessManagementPanel } from '../../components/forms/AccessManagementPanel';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { competitionService } from '../../services/competitionService';
import { formBuilderService } from '../../services/formBuilderService';
import { useToast } from '../../components/ui/Toast';
import type { Competition } from '../../types/authAndCompetition';
import type { SubmissionFormSchema } from '../../types/formAndAccess';

export const CompetitionFormsAndAccessPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeOrganization, canManageCurrentOrg, loading: authLoading } = useProoflyAuth();
  const { success, error: toastError } = useToast();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loadingComps, setLoadingComps] = useState(true);
  const [selectedCompId, setSelectedCompId] = useState<string>(searchParams.get('comp') || '');
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('form-builder');

  const [currentSchema, setCurrentSchema] = useState<SubmissionFormSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingSchema, setSavingSchema] = useState(false);

  // Load competitions for active organization
  useEffect(() => {
    let mounted = true;
    if (!activeOrganization) {
      if (!authLoading) {
        setCompetitions([]);
        setSelectedCompId('');
        setLoadingComps(false);
      }
      return;
    }

    setLoadingComps(true);
    competitionService
      .listOrganizationCompetitions(activeOrganization.id)
      .then((comps) => {
        if (!mounted) return;
        setCompetitions(comps);
        if (comps.length === 0) {
          setSelectedCompId('');
          setCurrentSchema(null);
        } else if (!selectedCompId || !comps.some((c) => c.id === selectedCompId)) {
          setSelectedCompId(comps[0].id);
        }
      })
      .catch((err: any) => {
        if (!mounted) return;
        toastError('Failed to load competitions', err?.message || 'Unable to fetch competitions.');
      })
      .finally(() => {
        if (mounted) setLoadingComps(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeOrganization, authLoading, selectedCompId, toastError]);

  const activeCompetition = competitions.find((c) => c.id === selectedCompId);

  // Load schema when competition or round changes
  const loadSchema = useCallback(async () => {
    if (!selectedCompId) {
      setCurrentSchema(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const schema = await formBuilderService.getFormSchema(
        selectedCompId,
        selectedRoundId || undefined
      );
      setCurrentSchema(schema);
    } catch (err: any) {
      toastError('Failed to load form schema', err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedCompId, selectedRoundId, toastError]);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  const handleSaveSchema = async (updatedSchema: SubmissionFormSchema) => {
    if (!selectedCompId) return;
    try {
      setSavingSchema(true);
      await formBuilderService.saveFormSchema(
        selectedCompId,
        updatedSchema.title,
        updatedSchema.fields,
        selectedRoundId || undefined,
        updatedSchema.description,
        updatedSchema.id
      );
      success('Form Schema Saved', `"${updatedSchema.title}" successfully updated with ${updatedSchema.fields.length} fields.`);
      await loadSchema();
    } catch (err: any) {
      toastError('Failed to save schema', err.message);
    } finally {
      setSavingSchema(false);
    }
  };

  const tabs = [
    { id: 'form-builder', label: 'Form fields', icon: <FileText size={13} /> },
    { id: 'access-keys', label: 'Access links', icon: <KeyRound size={13} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Forms & access"
        actions={
          competitions.length > 0 ? (
            <div className="w-60">
              <Select
                value={selectedCompId}
                onChange={(e) => {
                  setSelectedCompId(e.target.value);
                  setSearchParams({ comp: e.target.value });
                }}
                options={competitions.map((c) => ({
                  value: c.id,
                  label: c.title,
                }))}
              />
            </div>
          ) : (
            <Link to="/organizer/competitions?action=create">
              <Button variant="primary" size="xs" leftIcon={<Plus size={13} />} disabled={!canManageCurrentOrg}>
                Create competition
              </Button>
            </Link>
          )
        }
      />

      {!canManageCurrentOrg && (
        <div className="px-3.5 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Read-only access as Judge. Switch to Organizer to edit forms or revoke links.</span>
        </div>
      )}

      {loadingComps ? (
        <div className="p-12 text-center text-xs text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          Loading competitions...
        </div>
      ) : competitions.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No competitions yet</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            Create a competition first to configure its submission form fields and participant access links.
          </p>
          <div className="pt-1">
            <Link to="/organizer/competitions?action=create">
              <Button variant="primary" size="xs" leftIcon={<Plus size={13} />} disabled={!canManageCurrentOrg}>
                Create competition
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {activeCompetition && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <Trophy size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                <span className="font-medium text-slate-900 dark:text-slate-100">{activeCompetition.title}</span>
                <Badge variant="neutral" size="sm">
                  {activeCompetition.status}
                </Badge>
                <span className="text-slate-400 dark:text-slate-600">·</span>
                <span className="font-mono text-slate-600 dark:text-slate-300">{activeCompetition.publicAccessCode}</span>
              </div>

              <div className="flex items-center gap-2">
                <Layers size={13} className="text-slate-400 dark:text-slate-500" />
                <select
                  value={selectedRoundId}
                  onChange={(e) => setSelectedRoundId(e.target.value)}
                  className="text-xs py-1 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 dark:focus:border-blue-400"
                >
                  <option value="">Default form</option>
                  {(activeCompetition.rounds || []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Main Tabs */}
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

          {/* Tab 1: Form Builder Canvas */}
          {activeTab === 'form-builder' && (
            <div>
              {loading ? (
                <div className="p-12 text-center text-xs text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  Loading form schema...
                </div>
              ) : currentSchema ? (
                <FormBuilderCanvas
                  initialSchema={currentSchema}
                  onSave={handleSaveSchema}
                  isLoading={savingSchema}
                />
              ) : null}
            </div>
          )}

          {/* Tab 2: Access Management Panel */}
          {activeTab === 'access-keys' && activeCompetition && (
            <AccessManagementPanel
              competition={activeCompetition}
              canManage={canManageCurrentOrg}
            />
          )}
        </>
      )}
    </div>
  );
};
