import { useState } from 'react';
import { Building, UserPlus, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/auth';

export default function Onboarding() {
  const { refreshProfile, signOut } = useAuthStore();
  const [step, setStep] = useState<'choice' | 'create' | 'join'>('choice');
  const [companyName, setCompanyName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function createCompany() {
    if (!companyName.trim() || !fullName.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Generate company ID client-side to avoid needing .select() on insert
      // (SELECT RLS on companies references profiles, causing recursion for new users)
      const newCompanyId = crypto.randomUUID();

      // Create the company (no .select() to avoid SELECT RLS check)
      const { error: companyError } = await supabase
        .from('companies')
        .insert({ id: newCompanyId, name: companyName.trim() });

      if (companyError) throw companyError;

      // Create the admin profile (no .select() to avoid SELECT RLS check)
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          company_id: newCompanyId,
          full_name: fullName.trim(),
          email: user.email!,
          role: 'admin',
        });

      if (profileError) throw profileError;

      await refreshProfile();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function joinCompany() {
    if (!companyId.trim() || !fullName.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create the SDR profile for this company
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          company_id: companyId.trim(),
          full_name: fullName.trim(),
          email: user.email!,
          role: 'sdr',
        });

      if (profileError) {
        if (profileError.code === '23503') {
          throw new Error('Company not found. Check the ID and try again.');
        }
        throw profileError;
      }

      await refreshProfile();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Welcome to CallPulse</h1>
          <p className="text-gray-500 mt-2">Let's get you set up</p>
        </div>

        {step === 'choice' && (
          <div className="space-y-4">
            <button
              onClick={() => setStep('create')}
              className="w-full bg-white border border-gray-200 rounded-xl p-5 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-200">
                  <Building className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Create a new company</p>
                  <p className="text-sm text-gray-500">I'm setting up CallPulse for my team</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setStep('join')}
              className="w-full bg-white border border-gray-200 rounded-xl p-5 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200">
                  <UserPlus className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Join an existing company</p>
                  <p className="text-sm text-gray-500">I have a Company ID from my admin</p>
                </div>
              </div>
            </button>

            <button
              onClick={signOut}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-4"
            >
              Sign out
            </button>
          </div>
        )}

        {step === 'create' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Create your company</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="Acme Corp"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={createCompany}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? 'Creating...' : 'Create Company'}
              </button>
              <button
                onClick={() => { setStep('choice'); setError(''); }}
                className="px-4 py-2 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-100"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === 'join' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Join a company</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company ID</label>
              <input
                type="text"
                value={companyId}
                onChange={e => setCompanyId(e.target.value)}
                placeholder="Paste the Company ID from your admin"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400 mt-1">Ask your admin for this from the Settings page</p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={joinCompany}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? 'Joining...' : 'Join Company'}
              </button>
              <button
                onClick={() => { setStep('choice'); setError(''); }}
                className="px-4 py-2 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-100"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
