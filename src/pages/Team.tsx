import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserPlus, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { supabase } from '../services/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getWeeklyReports } from '../services/reports';
import { getCurrentWeek } from '../utils/dates';
import { cn } from '../utils/cn';
import { getScoreColor } from '../utils/scores';
import type { Profile, WeeklyReport } from '../types';

export default function Team() {
  const { user, company } = useAuthStore();
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [sendInvite, setSendInvite] = useState(true);
  const [form, setForm] = useState({ email: '', fullName: '', role: 'sdr' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const { week, year } = getCurrentWeek();
  const canManage = user?.role === 'admin' || user?.role === 'manager';

  useEffect(() => {
    if (!company) return;
    Promise.all([
      supabase.from('profiles').select('*').eq('company_id', company.id).order('full_name'),
      getWeeklyReports({ companyId: company.id, weekNumber: week, year }),
    ]).then(([{ data: profilesData }, reportsData]) => {
      setSdrs(profilesData || []);
      setReports(reportsData);
      setLoading(false);
    });
  }, [company]);

  async function refreshTeam() {
    if (!company) return;
    const { data } = await supabase.from('profiles').select('*').eq('company_id', company.id).order('full_name');
    setSdrs(data || []);
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!company) return;

    const fullName = form.fullName.trim();
    const email = form.email.trim();

    if (!fullName) {
      setFormError('Name is required');
      return;
    }

    setSubmitting(true);
    setFormError('');

    try {
      if (email && sendInvite) {
        const { data, error } = await supabase.functions.invoke('invite-user', {
          body: {
            email: email,
            fullName: fullName,
            role: form.role,
            companyId: company.id,
          },
        });

        if (error) {
          let customMsg = error.message;
          if (error instanceof FunctionsHttpError) {
            try {
              const body = await error.context.json();
              if (body && body.error) {
                customMsg = body.error;
              }
            } catch (e) {
              // Ignore parsing error
            }
          }
          throw new Error(customMsg);
        }
        if (data?.error) throw new Error(data.error);
      } else {
        // Create a placeholder profile directly — no auth account needed.
        // This SDR will appear in dropdowns for call assignment.
        // They can be invited later to get their own login.
        const { error } = await supabase.from('profiles').insert({
          id: crypto.randomUUID(),
          company_id: company.id,
          full_name: fullName,
          email: email || `${fullName.toLowerCase().replace(/\s+/g, '.')}@placeholder.local`,
          role: form.role as any,
        });

        if (error) throw error;
      }

      setShowAdd(false);
      setForm({ email: '', fullName: '', role: 'sdr' });
      setSendInvite(true);
      await refreshTeam();
    } catch (err: any) {
      if (email && sendInvite) {
        setFormError(
          err.message?.includes('401') || err.message?.includes('404') || err.message?.includes('Failed to fetch')
            ? 'Edge Function not deployed yet. Uncheck "Invite via email" to add directly, or deploy the invite-user function first.'
            : err.message || 'Failed to invite user'
        );
      } else {
        setFormError(err.message || 'Failed to add member');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function closeForm() {
    setShowAdd(false);
    setFormError('');
    setForm({ email: '', fullName: '', role: 'sdr' });
    setSendInvite(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
          >
            <UserPlus className="h-4 w-4" /> Add Member
          </button>
        )}
      </div>

      {/* Add member form */}
      {showAdd && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Add Team Member</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Add a team member for call tracking. If email is provided, you can optionally invite them to log in.
            </p>
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="fullName" className="text-xs font-medium text-gray-500">Full Name</label>
              <input
                id="fullName"
                type="text"
                value={form.fullName}
                onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                placeholder="Name"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-xs font-medium text-gray-500">Email (optional)</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@example.com"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="role" className="text-xs font-medium text-gray-500">Role</label>
              <select
                id="role"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="sdr">SDR</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          {form.email.trim() !== '' && (
            <div className="flex items-center gap-2 pt-1">
              <input
                id="sendInvite"
                type="checkbox"
                checked={sendInvite}
                onChange={e => setSendInvite(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
              <label htmlFor="sendInvite" className="text-sm text-gray-600 cursor-pointer select-none">
                Invite via email (sends magic link)
              </label>
            </div>
          )}

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Adding...' : 'Add Member'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="px-4 py-2 text-gray-600 text-sm rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Team grid */}
      {sdrs.filter(s => s.role === 'sdr').length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sdrs.filter(s => s.role === 'sdr').map(sdr => {
            const report = reports.find(r => r.sdr_id === sdr.id);
            const avgScores = report?.avg_scores as Record<string, number> | undefined;
            const comparison = report?.comparison_with_previous as Record<string, number> | undefined;
            const overallScore = avgScores?.overall || 0;
            const delta = comparison?.overall || 0;

            return (
              <Link
                key={sdr.id}
                to={`/team/${sdr.id}`}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:border-indigo-200 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                      <span className="text-sm font-bold text-indigo-700">
                        {sdr.full_name.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{sdr.full_name}</p>
                      <p className="text-xs text-gray-500">{sdr.email}</p>
                    </div>
                  </div>
                  {!sdr.is_active && (
                    <span className="text-xs bg-gray-100 text-gray-500 rounded px-2 py-0.5">Inactive</span>
                  )}
                </div>

                {report ? (
                  <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className={cn('text-xl font-bold', getScoreColor(overallScore))}>
                        {overallScore.toFixed(1)}
                      </p>
                      <p className="text-xs text-gray-500">Avg Score</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-gray-900">{report.calls_analyzed}</p>
                      <p className="text-xs text-gray-500">Calls</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="flex items-center gap-1">
                        {delta > 0.3 ? (
                          <TrendingUp className="h-4 w-4 text-emerald-500" />
                        ) : delta < -0.3 ? (
                          <TrendingDown className="h-4 w-4 text-red-500" />
                        ) : (
                          <Minus className="h-4 w-4 text-gray-400" />
                        )}
                        <span className={cn(
                          'text-sm font-medium',
                          delta > 0.3 ? 'text-emerald-600' : delta < -0.3 ? 'text-red-600' : 'text-gray-500'
                        )}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">vs Last Wk</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-gray-400 text-center">No data this week</p>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No SDRs yet. Add team members to start tracking call performance.</p>
        </div>
      )}

      {/* Managers/Admins section */}
      {sdrs.filter(s => s.role !== 'sdr').length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Managers & Admins</h2>
          <div className="space-y-2">
            {sdrs.filter(s => s.role !== 'sdr').map(member => (
              <div key={member.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
                <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <span className="text-xs font-bold text-gray-600">
                    {member.full_name.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{member.full_name}</p>
                  <p className="text-xs text-gray-500 capitalize">{member.role}</p>
                </div>
                <span className="ml-auto text-xs text-gray-400">{member.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
