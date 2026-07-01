import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Building, Save, Link2, KeyRound } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { supabase } from '../services/supabase';
import { getHubSpotIntegration, saveHubSpotIntegration } from '../services/hubspot';

export default function Settings() {
  const { user, company } = useAuthStore();
  const [companyName, setCompanyName] = useState(company?.name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [hubspotToken, setHubspotToken] = useState('');
  const [hubspotActive, setHubspotActive] = useState(false);
  const [loadingIntegration, setLoadingIntegration] = useState(false);
  const [savingHubspot, setSavingHubspot] = useState(false);
  const [savedHubspot, setSavedHubspot] = useState(false);

  useEffect(() => {
    async function loadIntegration() {
      if (!company) return;
      setLoadingIntegration(true);
      try {
        const int = await getHubSpotIntegration();
        if (int) {
          setHubspotToken(int.credentials?.private_token ? '••••••••••••••••••••••••••••••••' : '');
          setHubspotActive(int.is_active);
        }
      } catch (err) {
        console.error('Failed to load integration:', err);
      } finally {
        setLoadingIntegration(false);
      }
    }
    loadIntegration();
  }, [company]);

  async function saveHubspot() {
    if (!company) return;
    setSavingHubspot(true);
    try {
      const isMasked = hubspotToken.includes('••');
      let tokenToSend = hubspotToken;
      if (isMasked) {
        const existing = await getHubSpotIntegration();
        tokenToSend = existing?.credentials?.private_token || '';
      }
      await saveHubSpotIntegration({
        companyId: company.id,
        privateToken: tokenToSend,
        isActive: hubspotActive,
      });
      setSavedHubspot(true);
      setTimeout(() => setSavedHubspot(false), 2000);
    } catch (err) {
      console.error('Error saving HubSpot integration:', err);
    } finally {
      setSavingHubspot(false);
    }
  }

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

      {/* Integrations (Managers & Admins only) */}
      {(user?.role === 'admin' || user?.role === 'manager') && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 relative overflow-hidden">
          {/* Subtle brand styling for HubSpot */}
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-full blur-xl pointer-events-none" />
          
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Link2 className="h-5 w-5 text-indigo-600" />
            Integrations
          </h2>
          
          <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {/* HubSpot-inspired logo container */}
                <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-sm">
                  <KeyRound className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">HubSpot Integration</h3>
                  <p className="text-xs text-gray-500">Sync and import call recordings directly</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={hubspotActive}
                  onChange={(e) => setHubspotActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
                <span className="ms-2 text-xs font-medium text-gray-600">
                  {hubspotActive ? 'Active' : 'Inactive'}
                </span>
              </label>
            </div>

            {loadingIntegration ? (
              <div className="py-2 text-center text-xs text-gray-400">Loading settings...</div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    HubSpot Private App Token
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={hubspotToken}
                      onChange={(e) => setHubspotToken(e.target.value)}
                      placeholder="pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    <button
                      onClick={saveHubspot}
                      disabled={savingHubspot}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {savingHubspot ? 'Saving...' : savedHubspot ? 'Saved!' : 'Save Connection'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Create a Private App in HubSpot with scopes: <code className="bg-gray-100 px-1 rounded">crm.objects.contacts.read</code>, <code className="bg-gray-100 px-1 rounded">crm.objects.owners.read</code>, and recording access.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
