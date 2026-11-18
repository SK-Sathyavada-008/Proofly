import React, { useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';

export const OrganizerSettingsPage: React.FC = () => {
  const { activeOrganization } = useProoflyAuth();
  const { success } = useToast();
  const [orgName, setOrgName] = useState(activeOrganization?.name || 'Academic Guild');
  const [contactEmail, setContactEmail] = useState('organizer@proofly.app');
  const [aiMode, setAiMode] = useState('PREFER_ON_DEVICE');
  const [appCheckEnforced, setAppCheckEnforced] = useState(true);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    success('Settings saved', 'Preferences updated.');
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Settings" />

      <form onSubmit={handleSave} className="space-y-6">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Organization
          </h2>
          <Input
            label="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
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
            onChange={(e) => setAiMode(e.target.value)}
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
          <Button type="submit" variant="primary" size="sm">
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
};
