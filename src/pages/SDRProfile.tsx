import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, CheckCircle2, Circle, Clock } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { supabase } from '../services/supabase';
import { getSDRTrend } from '../services/reports';
import { getCalls, getCoachingItems, updateCoachingStatus } from '../services/calls';
import { useAuthStore } from '../store/auth';
import { cn } from '../utils/cn';
import { getScoreColor, getDeltaColor, getDeltaIndicator } from '../utils/scores';
import ScoreCard from '../components/ScoreCard';
import { DIMENSIONS } from '../types';
import type { Profile, WeeklyReport, Call, CoachingItem } from '../types';

export default function SDRProfile() {
  const { id: paramId } = useParams<{ id: string }>();
  const { company, user } = useAuthStore();
  const navigate = useNavigate();
  const [sdr, setSdr] = useState<Profile | null>(null);
  const [trend, setTrend] = useState<WeeklyReport[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [coaching, setCoaching] = useState<CoachingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [hubspotEmail, setHubspotEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const id = paramId || user?.id;
  const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isSdr = user?.role === 'sdr';
  const isViewingSelf = id === user?.id;

  useEffect(() => {
    if (!id || !company) return;
    if (isSdr && !isViewingSelf) {
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      getSDRTrend(id, 8),
      getCalls(company.id, { sdrId: id }),
      getCoachingItems({ companyId: company.id, sdrId: id }),
    ]).then(([{ data: sdrData }, trendData, callsData, coachingData]) => {
      setSdr(sdrData);
      if (sdrData) {
        setHubspotEmail(sdrData.hubspot_owner_email || '');
      }
      setTrend(trendData);
      setCalls(callsData);
      setCoaching(coachingData);
      setLoading(false);
    });
  }, [id, company, isSdr, isViewingSelf]);

  async function saveHubspotEmail() {
    if (!id) return;
    setSavingEmail(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ hubspot_owner_email: hubspotEmail.trim() || null })
        .eq('id', id);
      if (error) throw error;
      setSdr(prev => prev ? { ...prev, hubspot_owner_email: hubspotEmail.trim() || null } : null);
      alert('HubSpot owner email updated successfully');
    } catch (err) {
      console.error('Error saving HubSpot owner email:', err);
      alert('Failed to save HubSpot owner email');
    } finally {
      setSavingEmail(false);
    }
  }

  async function deleteSdrProfile() {
    if (!id || !sdr) return;
    if (!window.confirm(`Are you absolutely sure you want to permanently delete SDR ${sdr.full_name}? This will delete all their call analyses, coaching items, and weekly reports. This action cannot be undone.`)) {
      return;
    }
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
      alert('SDR profile deleted successfully');
      navigate('/team');
    } catch (err: any) {
      console.error('Error deleting SDR:', err);
      alert('Failed to delete SDR: ' + (err.message || 'Unknown error'));
    }
  }

  async function toggleActiveStatus() {
    if (!id || !sdr) return;
    try {
      const nextActiveState = !sdr.is_active;
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: nextActiveState })
        .eq('id', id);
      if (error) throw error;
      setSdr(prev => prev ? { ...prev, is_active: nextActiveState } : null);
      alert(`SDR has been ${nextActiveState ? 'activated' : 'deactivated'}.`);
    } catch (err: any) {
      console.error('Error updating SDR status:', err);
      alert('Failed to update SDR status: ' + (err.message || 'Unknown error'));
    }
  }

  async function toggleCoaching(item: CoachingItem) {
    const newStatus = item.status === 'completed' ? 'open' : 'completed';
    await updateCoachingStatus(item.id, newStatus);
    setCoaching(prev =>
      prev.map(c => c.id === item.id ? { ...c, status: newStatus } : c)
    );
  }

  if (isSdr && !isViewingSelf) {
    return (
      <div className="text-center py-12 text-gray-500 font-medium">
        Access Denied. You do not have permission to view other SDR profiles.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!sdr) return <div className="text-center py-12 text-gray-500">SDR not found</div>;

  // Build trend chart data
  const trendChart = trend.map(r => ({
    week: `W${r.week_number}`,
    ...(r.avg_scores as Record<string, number>),
  }));

  // Build radar data from latest report
  const latest = trend[trend.length - 1];
  const latestScores = latest?.avg_scores as Record<string, number> | undefined;
  const radarData = DIMENSIONS.map(dim => ({
    dimension: dim.label.split(' ')[0],
    score: latestScores?.[dim.key] || 0,
  }));

  // Latest comparison
  const comparison = latest?.comparison_with_previous as Record<string, number> | undefined;

  return (
    <div className="space-y-6 max-w-6xl">
      {!isSdr && (
        <Link to="/team" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Back to team
        </Link>
      )}

      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-indigo-100 flex items-center justify-center">
          <span className="text-xl font-bold text-indigo-700">
            {sdr.full_name.split(' ').map(n => n[0]).join('')}
          </span>
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{sdr.full_name}</h1>
          <p className="text-sm text-gray-500">{sdr.email}</p>
          {isManagerOrAdmin ? (
            <div className="space-y-2 mt-1">
              <div className="flex items-center gap-2 bg-orange-50/50 border border-orange-100 rounded-lg px-2 py-1 w-fit">
                <span className="text-[10px] font-semibold text-orange-600 uppercase tracking-wider">
                  HubSpot Owner Email:
                </span>
                <input
                  type="email"
                  value={hubspotEmail}
                  onChange={(e) => setHubspotEmail(e.target.value)}
                  placeholder="Not configured (auto-maps by default email)"
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500 w-64 bg-white"
                />
                <button
                  onClick={saveHubspotEmail}
                  disabled={savingEmail}
                  className="px-2 py-0.5 bg-orange-600 text-white rounded text-[10px] font-semibold hover:bg-orange-700 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {savingEmail ? 'Saving...' : 'Save'}
                </button>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={toggleActiveStatus}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer shadow-sm",
                    sdr.is_active
                      ? "border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"
                      : "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                  )}
                >
                  {sdr.is_active ? 'Deactivate SDR' : 'Activate SDR'}
                </button>
                <button
                  onClick={deleteSdrProfile}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer shadow-sm"
                >
                  Delete SDR Profile
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1 mt-1">
              {sdr.hubspot_owner_email && (
                <p className="text-xs text-gray-400">HubSpot Email: {sdr.hubspot_owner_email}</p>
              )}
              {!sdr.is_active && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                  Inactive
                </span>
              )}
            </div>
          )}
        </div>
        {latestScores && (
          <div className="ml-auto text-right">
            <div className={cn('text-3xl font-bold', getScoreColor(latestScores.overall || 0))}>
              {(latestScores.overall || 0).toFixed(1)}
            </div>
            <p className="text-xs text-gray-500">Current Avg</p>
          </div>
        )}
      </div>

      {/* Score cards for current week */}
      {latestScores && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {DIMENSIONS.map(dim => (
            <ScoreCard
              key={dim.key}
              label={dim.label.split('&')[0].trim()}
              score={latestScores[dim.key] || 0}
              delta={comparison?.[dim.key]}
              compact
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Score Trend (8 weeks)</h2>
          {trendChart.length > 1 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="overall" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} name="Overall" />
                <Line type="monotone" dataKey="opening" stroke="#f59e0b" strokeWidth={1} dot={false} name="Opening" />
                <Line type="monotone" dataKey="closing" stroke="#ef4444" strokeWidth={1} dot={false} name="Closing" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
              Need at least 2 weeks of data
            </div>
          )}
        </div>

        {/* Radar chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Skills Radar</h2>
          {radarData.some(d => d.score > 0) ? (
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
              No scoring data yet
            </div>
          )}
        </div>
      </div>

      {/* Coaching backlog */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Coaching Items</h2>
        {coaching.length > 0 ? (
          <div className="space-y-2">
            {coaching.map(item => (
              <div key={item.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                <button onClick={() => toggleCoaching(item)} className="mt-0.5">
                  {item.status === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : item.status === 'in_progress' ? (
                    <Clock className="h-5 w-5 text-amber-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-300" />
                  )}
                </button>
                <div className="flex-1">
                  <p className={cn('text-sm', item.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-700')}>
                    {item.action_item}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 capitalize">{item.dimension.replace('_', ' ')}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No coaching items yet</p>
        )}
      </div>

      {/* Recent calls */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Calls</h2>
          <Link
            to={`/team/${sdr.id}/calls`}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            View All Calls
          </Link>
        </div>
        <div className="space-y-2">
          {calls.slice(0, 10).map(call => {
            const analysis = call.analysis;
            return (
              <Link
                key={call.id}
                to={`/calls/${call.id}`}
                state={{ callIds: calls.map(c => c.id), backUrl: `/team/${sdr.id}` }}
                className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded"
              >
                <span className="text-sm text-gray-500 w-24">{call.call_date}</span>
                <span className="text-sm text-gray-700 flex-1">{call.prospect_name || 'Unknown'}</span>
                {analysis && (
                  <span className={cn('text-sm font-bold', getScoreColor(analysis.overall_score))}>
                    {analysis.overall_score.toFixed(1)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
