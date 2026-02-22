import { useState } from 'react';
import { Activity } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { cn } from '../utils/cn';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [joinExisting, setJoinExisting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuthStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp({
          email,
          password,
          fullName,
          companyName: joinExisting ? undefined : companyName,
          companyId: joinExisting ? companyId : undefined,
          role: joinExisting ? 'sdr' : 'admin',
        });
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Activity className="h-8 w-8 text-indigo-600" />
            <span className="text-2xl font-bold text-gray-900">CallPulse</span>
          </div>
          <p className="text-gray-500">Sales call intelligence for your team</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
            <button
              onClick={() => setMode('login')}
              className={cn(
                'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              )}
            >
              Sign In
            </button>
            <button
              onClick={() => setMode('signup')}
              className={cn(
                'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                mode === 'signup' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              )}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    required
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="joinExisting"
                    checked={joinExisting}
                    onChange={e => setJoinExisting(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="joinExisting" className="text-sm text-gray-600">
                    Join an existing company
                  </label>
                </div>

                {joinExisting ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company ID</label>
                    <input
                      type="text"
                      value={companyId}
                      onChange={e => setCompanyId(e.target.value)}
                      placeholder="Get this from your admin"
                      required
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      required
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
