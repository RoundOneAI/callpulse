import { useEffect, useState } from 'react';
import { Activity, ArrowRight, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useAuthStore } from '../store/auth';
import { getWeeklyReports } from '../services/reports';
import { supabase } from '../services/supabase';
import { getCurrentWeek, formatWeek } from '../utils/dates';
import { cn } from '../utils/cn';
import { getScoreColor, getDeltaColor, getDeltaIndicator } from '../utils/scores';
import { DIMENSIONS } from '../types';
import type { Profile, WeeklyReport } from '../types';

export default function Comparison() {
  const { company } = useAuthStore();
  const [thisWeekReports, setThisWeekReports] = useState<WeeklyReport[]>([]);
  const [lastWeekReports, setLastWeekReports] = useState<WeeklyReport[]>([]);
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const { week, year } = getCurrentWeek();

  const prevWeek = week === 1 ? { week: 52, year: year - 1 } : { week: week - 1, year };

  useEffect(() => {
    if (!company) return;
    Promise.all([
      getWeeklyReports({ companyId: company.id, weekNumber: week, year }),
      getWeeklyReports({ companyId: company.id, weekNumber: prevWeek.week, year: prevWeek.year }),
      supabase.from('profiles').select('*').eq('company_id', company.id).eq('role', 'sdr'),
    ]).then(([thisData, lastData, { data: sdrsData }]) => {
      setThisWeekReports(thisData);
      setLastWeekReports(lastData);
      setSdrs(sdrsData || []);
      setLoading(false);
    });
  }, [company]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // Build comparison chart data per SDR
  const comparisonData = sdrs
    .filter(s => s.role === 'sdr')
    .map(sdr => {
      const thisReport = thisWeekReports.find(r => r.sdr_id === sdr.id);
      const lastReport = lastWeekReports.find(r => r.sdr_id === sdr.id);
      const thisScores = thisReport?.avg_scores as Record<string, number> | undefined;
      const lastScores = lastReport?.avg_scores as Record<string, number> | undefined;
      return {
        name: sdr.full_name.split(' ')[0],
        thisWeek: thisScores?.overall || 0,
        lastWeek: lastScores?.overall || 0,
      };
    })
    .filter(d => d.thisWeek > 0 || d.lastWeek > 0);

  // Stagnation alerts (no improvement for 3+ weeks)
  const stagnationAlerts = thisWeekReports
    .filter(r => {
      const comparison = r.comparison_with_previous as Record<string, number>;
      return comparison?.overall !== undefined && comparison.overall <= 0;
    })
    .map(r => {
      const sdr = sdrs.find(s => s.id === r.sdr_id);
      return { name: sdr?.full_name || 'Unknown', delta: (r.comparison_with_previous as Record<string, number>).overall };
    });

  // Coaching impact - dimensions that were coached and their changes
  const coachingImpactData = thisWeekReports
    .filter(r => Object.keys(r.coaching_impact || {}).length > 0)
    .map(r => {
      const sdr = sdrs.find(s => s.id === r.sdr_id);
      const impact = r.coaching_impact as Record<string, { coached: boolean; delta: number; improved: boolean }>;
      return {
        name: sdr?.full_name || 'Unknown',
        impacts: Object.entries(impact).map(([dim, data]) => ({
          dimension: DIMENSIONS.find(d => d.key === dim)?.label || dim,
          ...data,
        })),
      };
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Week-over-Week Comparison</h1>
        <p className="text-sm text-gray-500 mt-1">
          {formatWeek(prevWeek.week, prevWeek.year)} → {formatWeek(week, year)}
        </p>
      </div>

      {/* WoW Bar Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Overall Score Comparison</h2>
        {comparisonData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="lastWeek" fill="#94a3b8" name="Last Week" radius={[4, 4, 0, 0]} />
              <Bar dataKey="thisWeek" fill="#6366f1" name="This Week" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
            Need data from two consecutive weeks to compare
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Per-SDR dimension comparison */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Dimension Changes</h2>
          {thisWeekReports.length > 0 ? (
            <div className="space-y-4">
              {thisWeekReports.map(report => {
                const sdr = sdrs.find(s => s.id === report.sdr_id);
                const comparison = report.comparison_with_previous as Record<string, number>;
                if (!comparison || Object.keys(comparison).length === 0) return null;
                return (
                  <div key={report.id} className="border-b border-gray-100 pb-3 last:border-0">
                    <p className="text-sm font-semibold text-gray-900 mb-2">{sdr?.full_name}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {DIMENSIONS.map(dim => {
                        const delta = comparison[dim.key];
                        if (delta === undefined) return null;
                        return (
                          <div key={dim.key} className="flex items-center justify-between text-sm">
                            <span className="text-gray-500 text-xs">{dim.label.split(' ')[0]}</span>
                            <span className={cn('font-medium', getDeltaColor(delta))}>
                              {getDeltaIndicator(delta)} {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No comparison data available</p>
          )}
        </div>

        {/* Stagnation alerts */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Stagnation Alerts
            </h2>
            {stagnationAlerts.length > 0 ? (
              <div className="space-y-2">
                {stagnationAlerts.map((alert, i) => (
                  <div key={i} className="flex items-center justify-between bg-amber-50 rounded-lg p-3">
                    <span className="text-sm font-medium text-gray-900">{alert.name}</span>
                    <span className="text-sm text-red-600 font-medium">
                      {alert.delta.toFixed(1)} points
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">
                No stagnation detected this week
              </p>
            )}
          </div>

          {/* Coaching impact */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Coaching Impact</h2>
            {coachingImpactData.length > 0 ? (
              <div className="space-y-3">
                {coachingImpactData.map((entry, i) => (
                  <div key={i} className="border-b border-gray-100 pb-2 last:border-0">
                    <p className="text-sm font-semibold text-gray-900 mb-1">{entry.name}</p>
                    {entry.impacts.map((impact, j) => (
                      <div key={j} className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">{impact.dimension}</span>
                        <span className={cn('font-medium', impact.improved ? 'text-emerald-600' : 'text-red-600')}>
                          {impact.improved ? '✓ Improved' : '✗ No change'} ({impact.delta > 0 ? '+' : ''}{impact.delta.toFixed(1)})
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">
                No coaching impact data yet
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
