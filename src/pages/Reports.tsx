import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getWeeklyReports, generateWeeklyReport } from '../services/reports';
import { supabase } from '../services/supabase';
import { getCurrentWeek, formatWeek } from '../utils/dates';
import { cn } from '../utils/cn';
import { getScoreColor, getDeltaColor, getDeltaIndicator } from '../utils/scores';
import { DIMENSIONS } from '../types';
import type { Profile, WeeklyReport } from '../types';

export default function Reports() {
  const { company } = useAuthStore();
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek().week);
  const [selectedYear, setSelectedYear] = useState(getCurrentWeek().year);

  useEffect(() => {
    if (!company) return;
    loadData();
  }, [company, selectedWeek, selectedYear]);

  async function loadData() {
    if (!company) return;
    setLoading(true);
    const [reportsData, { data: sdrsData }] = await Promise.all([
      getWeeklyReports({ companyId: company.id, weekNumber: selectedWeek, year: selectedYear }),
      supabase.from('profiles').select('*').eq('company_id', company.id).eq('role', 'sdr').eq('is_active', true),
    ]);
    setReports(reportsData);
    setSdrs(sdrsData || []);
    setLoading(false);
  }

  async function generateAll() {
    if (!company) return;
    setGenerating(true);
    try {
      for (const sdr of sdrs) {
        try {
          await generateWeeklyReport({
            companyId: company.id,
            sdrId: sdr.id,
            weekNumber: selectedWeek,
            year: selectedYear,
          });
        } catch (err) {
          console.warn(`No data for ${sdr.full_name}:`, err);
        }
      }
      await loadData();
    } catch (err) {
      console.error('Generation failed:', err);
    }
    setGenerating(false);
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Reports</h1>
          <p className="text-sm text-gray-500 mt-1">{formatWeek(selectedWeek, selectedYear)}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <select
              value={selectedWeek}
              onChange={e => setSelectedWeek(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {Array.from({ length: 52 }, (_, i) => i + 1).map(w => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {[2024, 2025, 2026].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button
            onClick={generateAll}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Generate Reports
          </button>
        </div>
      </div>

      {/* Report cards per SDR */}
      {reports.length > 0 ? (
        <div className="space-y-4">
          {reports.map(report => {
            const sdr = sdrs.find(s => s.id === report.sdr_id);
            const scores = report.avg_scores as Record<string, number>;
            const comparison = report.comparison_with_previous as Record<string, number>;

            return (
              <div key={report.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                      <span className="text-sm font-bold text-indigo-700">
                        {sdr?.full_name.split(' ').map(n => n[0]).join('') || '?'}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{sdr?.full_name}</p>
                      <p className="text-xs text-gray-500">{report.calls_analyzed} calls analyzed</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn('text-2xl font-bold', getScoreColor(scores.overall || 0))}>
                      {(scores.overall || 0).toFixed(1)}
                    </div>
                    {comparison?.overall !== undefined && (
                      <span className={cn('text-sm', getDeltaColor(comparison.overall))}>
                        {getDeltaIndicator(comparison.overall)} {comparison.overall > 0 ? '+' : ''}{comparison.overall.toFixed(1)} vs last week
                      </span>
                    )}
                  </div>
                </div>

                {report.summary && (
                  <p className="text-sm text-gray-600 mb-4">{report.summary}</p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {DIMENSIONS.map(dim => (
                    <div key={dim.key} className="text-center">
                      <p className={cn('text-lg font-bold', getScoreColor(scores[dim.key] || 0))}>
                        {(scores[dim.key] || 0).toFixed(1)}
                      </p>
                      <p className="text-xs text-gray-500">{dim.label.split('&')[0].trim()}</p>
                      {comparison?.[dim.key] !== undefined && (
                        <span className={cn('text-xs', getDeltaColor(comparison[dim.key]))}>
                          {getDeltaIndicator(comparison[dim.key])} {comparison[dim.key] > 0 ? '+' : ''}{comparison[dim.key].toFixed(1)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <BarChart3 className="h-8 w-8 mb-2" />
          <p>No reports for this week</p>
          <p className="text-sm mt-1">Upload and analyze calls, then generate reports</p>
        </div>
      )}
    </div>
  );
}
