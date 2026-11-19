import React, { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { organizationService } from '../../services/organizationService';
import type { OrganizationSettings } from '../../types/authAndCompetition';

export const OrganizerSettingsPage: React.FC = () => {
  const { activeOrganization, currentUser } = useProoflyAuth();
  const { success, error: toastError } = useToast();

  const [orgName, setOrgName] = useState(activeOrganization?.name || '');
  const [contactEmail, setContactEmail] = useState(
    activeOrganization?.settings?.contactEmail || currentUser?.email || ''
  );
  const [aiMode, setAiMode] = useState<NonNullable<OrganizationSettings['defaultAiMode']>>(
    activeOrganization?.settings?.defaultAiMode || 'PREFER_ON_DEVICE'
  );
  const [appCheckEnforced, setAppCheckEnforced] = useState(
    activeOrganization?.settings?.appCheckEnforced ?? true
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrganization) return;
    setOrgName(activeOrganization.name || '');
    setContactEmail(activeOrganization.settings?.contactEmail || currentUser?.email || '');
    setAiMode(activeOrganization.settings?.defaultAiMode || 'PREFER_ON_DEVICE');
    setAppCheckEnforced(activeOrganization.settings?.appCheckEnforced ?? true);
  }, [activeOrganization, currentUser?.email]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganization || !currentUser) {
      const msg = 'No active organization selected. Sign in and select an organization first.';
      setSaveError(msg);
      toastError('Save failed', msg);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await organizationService.updateOrganizationSettings(activeOrganization.id, {
        name: orgName,
        updatedBy: currentUser.uid,
        settings: {
          contactEmail: contactEmail.trim(),
          defaultAiMode: aiMode,
          appCheckEnforced,
        },
      });
      success('Settings saved', 'Organization settings persisted to Firestore.');
    } catch (err: any) {
      // Preserve user form inputs intact and show explicit error
      const msg = err?.message || 'Failed to persist organization settings to Firestore.';
      setSaveError(msg);
      toastError('Failed to save settings', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Settings" />

      {saveError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {saveError}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Organization
          </h2>
          <Input
            label="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
          />
          <Input
            label="Contact email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            AI evaluation runtime
          </h2>
          <Select
            label="Inference mode"
            value={aiMode}
            onChange={(e) =>
              setAiMode(e.target.value as NonNullable<OrganizationSettings['defaultAiMode']>)
            }
            options={[
              { value: 'PREFER_ON_DEVICE', label: 'Prefer on-device (Nano with cloud fallback)' },
              { value: 'ONLY_ON_DEVICE', label: 'On-device only' },
              { value: 'PREFER_IN_CLOUD', label: 'Prefer cloud (Gemini 2.5 Flash)' },
              { value: 'ONLY_IN_CLOUD', label: 'Cloud only' },
            ]}
          />

          <label className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 cursor-pointer">
            <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
              Enforce Firebase App Check attestation
            </span>
            <input
              type="checkbox"
              checked={appCheckEnforced}
              onChange={(e) => setAppCheckEnforced(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
          </label>
        </section>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  );
};
