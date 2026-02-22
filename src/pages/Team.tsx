import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserPlus, Mail, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { supabase } from '../services/supabase';
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
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', fullName: '', role: 'sdr' });

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

  async function inviteUser() {
    if (!company) return;
    try {
      // In production, you'd send an invite email via Supabase
      // For now, we create the user directly
      const { error } = await supabase.auth.admin.createUser({
        email: inviteForm.email,
        user_metadata: {
          full_name: inviteForm.fullName,
          company_id: company.id,
          role: inviteForm.role,
        },
      });
      if (error) throw error;
      setShowInvite(false);
      setInviteForm({ email: '', fullName: '', role: 'sdr' });
      // Refresh
      const { data } = await supabase.from('profiles').select('*').eq('company_id', company.id);
      setSdrs(data || []);
    } catch (err: any) {
      alert(err.message || 'Failed to invite user');
    }
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
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
          >
            <UserPlus className="h-4 w-4" /> Add Member
          </button>
        )}
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Invite Team Member</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <input
              type="text"
              value={inviteForm.fullName}
              onChange={e => setInviteForm(f => ({ ...f, fullName: e.target.value }))}
              placeholder="Full Name"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="email"
              value={inviteForm.email}
              onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
              placeholder="Email"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={inviteForm.role}
              onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="sdr">SDR</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={inviteUser} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              Send Invite
            </button>
            <button onClick={() => setShowInvite(false)} className="px-4 py-2 text-gray-600 text-sm rounded-lg hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Team grid */}
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
