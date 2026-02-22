import { useEffect, useState } from 'react';
import { Trophy, Medal, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getWeeklyReports } from '../services/reports';
import { supabase } from '../services/supabase';
import { getCurrentWeek, formatWeek } from '../utils/dates';
import { cn } from '../utils/cn';
import { getScoreColor } from '../utils/scores';
import { DIMENSIONS, type DimensionKey } from '../types';
import type { Profile, WeeklyReport } from '../types';

export default function Leaderboard() {
  const { company } = useAuthStore();
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek().week);
  const [selectedYear, setSelectedYear] = useState(getCurrentWeek().year);
  const [sortBy, setSortBy] = useState<string>('overall');

  useEffect(() => {
    if (!company) return;
    Promise.all([
      getWeeklyReports({ companyId: company.id, weekNumber: selectedWeek, year: selectedYear }),
      supabase.from('profiles').select('*').eq('company_id', company.id).eq('role', 'sdr'),
    ]).then(([reportsData, { data: sdrsData }]) => {
      setReports(reportsData);
      setSdrs(sdrsData || []);
      setLoading(false);
    });
  }, [company, selectedWeek, selectedYear]);

  const leaderboard = reports
    .map(r => {
      const sdr = sdrs.find(s => s.id === r.sdr_id);
      const scores = r.avg_scores as Record<string, number>;
      const comparison = r.comparison_with_previous as Record<string, number>;
      return {
        id: r.sdr_id,
        name: sdr?.full_name || 'Unknown',
        calls: r.calls_analyzed,
        scores,
        comparison,
        sortScore: scores[sortBy] || 0,
      };
    })
    .sort((a, b) => b.sortScore - a.sortScore);

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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>
          <p className="text-sm text-gray-500 mt-1">{formatWeek(selectedWeek, selectedYear)}</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="overall">Overall Score</option>
            {DIMENSIONS.map(d => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
          <select
            value={selectedWeek}
            onChange={e => setSelectedWeek(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {Array.from({ length: 52 }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>
      </div>

      {leaderboard.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-500 w-12">#</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">SDR</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Calls</th>
                {DIMENSIONS.map(d => (
                  <th
                    key={d.key}
                    className={cn(
                      'text-center py-3 px-3 font-medium cursor-pointer hover:text-gray-900 transition-colors',
                      sortBy === d.key ? 'text-indigo-600' : 'text-gray-500'
                    )}
                    onClick={() => setSortBy(d.key)}
                  >
                    {d.label.split(' ')[0]}
                  </th>
                ))}
                <th
                  className={cn(
                    'text-center py-3 px-4 font-medium cursor-pointer hover:text-gray-900',
                    sortBy === 'overall' ? 'text-indigo-600' : 'text-gray-500'
                  )}
                  onClick={() => setSortBy('overall')}
                >
                  Overall
                </th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((entry, i) => (
                <tr key={entry.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4">
                    {i === 0 ? (
                      <Trophy className="h-5 w-5 text-amber-500" />
                    ) : i === 1 ? (
                      <Medal className="h-5 w-5 text-gray-400" />
                    ) : i === 2 ? (
                      <Medal className="h-5 w-5 text-orange-400" />
                    ) : (
                      <span className="text-gray-400 font-medium">{i + 1}</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{entry.name}</span>
                      {entry.comparison?.overall !== undefined && (
                        entry.comparison.overall > 0.3 ? (
                          <TrendingUp className="h-3 w-3 text-emerald-500" />
                        ) : entry.comparison.overall < -0.3 ? (
                          <TrendingDown className="h-3 w-3 text-red-500" />
                        ) : (
                          <Minus className="h-3 w-3 text-gray-300" />
                        )
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center text-gray-600">{entry.calls}</td>
                  {DIMENSIONS.map(d => (
                    <td key={d.key} className="py-3 px-3 text-center">
                      <span className={cn('font-medium', getScoreColor(entry.scores[d.key] || 0))}>
                        {(entry.scores[d.key] || 0).toFixed(1)}
                      </span>
                    </td>
                  ))}
                  <td className="py-3 px-4 text-center">
                    <span className={cn('text-lg font-bold', getScoreColor(entry.scores.overall || 0))}>
                      {(entry.scores.overall || 0).toFixed(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Trophy className="h-8 w-8 mb-2" />
          <p>No leaderboard data for this week</p>
          <p className="text-sm mt-1">Generate weekly reports first</p>
        </div>
      )}
    </div>
  );
}
