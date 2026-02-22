import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Phone,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Star,
  ArrowRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { useAuthStore } from '../store/auth';
import { getCalls } from '../services/calls';
import { getWeeklyReports } from '../services/reports';
import { supabase } from '../services/supabase';
import { getCurrentWeek } from '../utils/dates';
import { cn } from '../utils/cn';
import { getScoreColor, getScoreBadge } from '../utils/scores';
import type { Call, Profile, WeeklyReport } from '../types';
import { DIMENSIONS } from '../types';

export default function Dashboard() {
  const { user, company } = useAuthStore();
  const [calls, setCalls] = useState<Call[]>([]);
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);

  const { week, year } = getCurrentWeek();

  useEffect(() => {
    if (!company) return;
    loadData();
  }, [company]);

  async function loadData() {
    if (!company) return;
    setLoading(true);
    try {
      const [callsData, sdrsData, reportsData] = await Promise.all([
        getCalls(company.id, { weekNumber: week, year }),
        supabase.from('profiles').select('*').eq('company_id', company.id).eq('is_active', true),
        getWeeklyReports({ companyId: company.id, weekNumber: week, year }),
      ]);

      setCalls(callsData);
      setSdrs(sdrsData.data || []);
      setReports(reportsData);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
    setLoading(false);
  }

  const completedCalls = calls.filter(c => c.status === 'completed');
  const analyzingCalls = calls.filter(c => c.status === 'analyzing' || c.status === 'transcribing');

  // Calculate team averages from reports
  const teamAvg = reports.length > 0
    ? reports.reduce((sum, r) => sum + ((r.avg_scores as Record<string, number>).overall || 0), 0) / reports.length
    : 0;

  // Build leaderboard from reports
  const leaderboard = reports
    .map(r => {
      const sdr = sdrs.find(s => s.id === r.sdr_id);
      return {
        name: sdr?.full_name || 'Unknown',
        score: (r.avg_scores as Record<string, number>).overall || 0,
        calls: r.calls_analyzed,
        delta: (r.comparison_with_previous as Record<string, number>)?.overall || 0,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Build chart data for team dimension averages
  const dimensionChartData = DIMENSIONS.map(dim => {
    const avg = reports.length > 0
      ? reports.reduce((sum, r) => sum + ((r.avg_scores as Record<string, number>)[dim.key] || 0), 0) / reports.length
      : 0;
    return { name: dim.label.split(' ')[0], score: Math.round(avg * 10) / 10 };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Week {week}, {year} — {company?.name}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Phone className="h-5 w-5 text-indigo-600" />}
          label="Calls This Week"
          value={completedCalls.length.toString()}
          sub={analyzingCalls.length > 0 ? `${analyzingCalls.length} processing` : undefined}
        />
        <StatCard
          icon={<Star className="h-5 w-5 text-amber-500" />}
          label="Team Avg Score"
          value={teamAvg > 0 ? teamAvg.toFixed(1) : '—'}
          sub="/10"
          valueColor={teamAvg > 0 ? getScoreColor(teamAvg) : undefined}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
          label="Top Performer"
          value={leaderboard[0]?.name || '—'}
          sub={leaderboard[0] ? `${leaderboard[0].score.toFixed(1)}/10` : undefined}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
          label="Needs Attention"
          value={
            leaderboard.filter(l => l.score < 5).length.toString()
          }
          sub="SDRs below 5.0"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dimension averages chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Scores by Dimension</h2>
          {dimensionChartData.some(d => d.score > 0) ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dimensionChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400">
              No data yet. Upload calls to see scores.
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">SDR Leaderboard</h2>
            <Link to="/leaderboard" className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {leaderboard.length > 0 ? (
            <div className="space-y-3">
              {leaderboard.map((entry, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                    i === 0 ? 'bg-amber-100 text-amber-700' :
                    i === 1 ? 'bg-gray-100 text-gray-600' :
                    i === 2 ? 'bg-orange-100 text-orange-700' :
                    'bg-gray-50 text-gray-500'
                  )}>
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{entry.name}</p>
                    <p className="text-xs text-gray-500">{entry.calls} calls</p>
                  </div>
                  <span className={cn('text-sm font-bold', getScoreColor(entry.score))}>
                    {entry.score.toFixed(1)}
                  </span>
                  {entry.delta !== 0 && (
                    <span className={cn(
                      'text-xs font-medium',
                      entry.delta > 0 ? 'text-emerald-600' : 'text-red-600'
                    )}>
                      {entry.delta > 0 ? '+' : ''}{entry.delta.toFixed(1)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              No reports generated yet
            </div>
          )}
        </div>
      </div>

      {/* Recent calls */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Calls</h2>
          <Link to="/calls" className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {calls.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">SDR</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Prospect</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Date</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Score</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {calls.slice(0, 10).map(call => (
                  <tr key={call.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-3">
                      {(call.sdr as unknown as Profile)?.full_name || '—'}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{call.prospect_name || '—'}</td>
                    <td className="py-2 px-3 text-gray-600">{call.call_date}</td>
                    <td className="py-2 px-3">
                      {call.analysis ? (
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          getScoreBadge((call.analysis as unknown as any[])?.[0]?.overall_score || 0)
                        )}>
                          {((call.analysis as unknown as any[])?.[0]?.overall_score || 0).toFixed(1)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge status={call.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Phone className="h-8 w-8 mb-2" />
            <p>No calls uploaded this week</p>
            <Link to="/upload" className="mt-2 text-sm text-indigo-600 hover:text-indigo-700">
              Upload your first calls
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn('text-2xl font-bold', valueColor || 'text-gray-900')}>
          {value}
        </span>
        {sub && <span className="text-sm text-gray-400">{sub}</span>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700',
    analyzing: 'bg-blue-100 text-blue-700',
    transcribing: 'bg-purple-100 text-purple-700',
    uploading: 'bg-gray-100 text-gray-600',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
      styles[status] || styles.uploading
    )}>
      {status}
    </span>
  );
}
