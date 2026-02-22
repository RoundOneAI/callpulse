import { useState } from 'react';
import { Settings as SettingsIcon, Building, Save } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { supabase } from '../services/supabase';

export default function Settings() {
  const { user, company } = useAuthStore();
  const [companyName, setCompanyName] = useState(company?.name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function saveCompanyName() {
    if (!company) return;
    setSaving(true);
    await supabase.from('companies').update({ name: companyName }).eq('id', company.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Company settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building className="h-5 w-5 text-gray-400" />
          Company
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={saveCompanyName}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company ID</label>
            <p className="text-sm text-gray-500 font-mono bg-gray-50 rounded px-3 py-2">{company?.id}</p>
            <p className="text-xs text-gray-400 mt-1">Share this with new team members when they sign up</p>
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-gray-400" />
          Your Account
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Name</span>
            <span className="text-sm font-medium text-gray-900">{user?.full_name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Email</span>
            <span className="text-sm font-medium text-gray-900">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Role</span>
            <span className="text-sm font-medium text-gray-900 capitalize">{user?.role}</span>
          </div>
        </div>
      </div>

      {/* Setup guide */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-indigo-900 mb-3">Setup Guide</h2>
        <div className="space-y-3 text-sm text-indigo-800">
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-xs font-bold">1</span>
            <p>Set up your Supabase project and run the migration SQL in the SQL Editor</p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-xs font-bold">2</span>
            <p>Add your Supabase URL and Anon Key to the .env file</p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-xs font-bold">3</span>
            <p>Deploy Edge Functions and set secrets: <code className="bg-indigo-100 px-1 rounded">ANTHROPIC_API_KEY</code>, <code className="bg-indigo-100 px-1 rounded">DEEPGRAM_API_KEY</code></p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-xs font-bold">4</span>
            <p>Invite your first admin user, then invite SDRs and managers from the Team page</p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-xs font-bold">5</span>
            <p>Upload call transcripts or audio recordings on the Upload page</p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-xs font-bold">6</span>
            <p>Generate weekly reports from the Reports page to see trends and comparisons</p>
          </div>
        </div>
      </div>
    </div>
  );
}
