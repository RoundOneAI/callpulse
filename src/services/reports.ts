import { supabase } from './supabase';
import type { WeeklyReport, CallAnalysis, DimensionKey } from '../types';
import { DIMENSIONS } from '../types';

export async function generateWeeklyReport(params: {
  companyId: string;
  sdrId: string;
  weekNumber: number;
  year: number;
}): Promise<WeeklyReport> {
  // Get all completed calls for this SDR this week
  const { data: calls, error: callsError } = await supabase
    .from('calls')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('sdr_id', params.sdrId)
    .eq('week_number', params.weekNumber)
    .eq('year', params.year)
    .eq('status', 'completed');

  if (callsError) throw callsError;

  const callIds = (calls || []).map(c => c.id);
  let analyses: CallAnalysis[] = [];

  if (callIds.length > 0) {
    const { data: analysesData } = await supabase
      .from('call_analyses')
      .select('*')
      .in('call_id', callIds);
    analyses = (analysesData || []) as CallAnalysis[];
  }

  if (analyses.length === 0) {
    throw new Error('No analyzed calls found for this week');
  }

  // Calculate averages
  const avgScores: Record<string, number> = {};
  let bestCallId = '';
  let worstCallId = '';
  let bestScore = 0;
  let worstScore = 11;

  for (const dim of DIMENSIONS) {
    const key = `${dim.dbPrefix}_score` as keyof CallAnalysis;
    const scores = analyses.map(a => Number(a[key]));
    avgScores[dim.key] = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  }

  for (const analysis of analyses) {
    if (analysis.overall_score > bestScore) {
      bestScore = analysis.overall_score;
      bestCallId = analysis.call_id;
    }
    if (analysis.overall_score < worstScore) {
      worstScore = analysis.overall_score;
      worstCallId = analysis.call_id;
    }
  }

  avgScores.overall = Math.round(
    (Object.values(avgScores).reduce((a, b) => a + b, 0) / Object.keys(avgScores).length) * 10
  ) / 10;

  // Get previous week's report for comparison
  const prevWeek = params.weekNumber === 1
    ? { week: 52, year: params.year - 1 }
    : { week: params.weekNumber - 1, year: params.year };

  const { data: prevReport } = await supabase
    .from('weekly_reports')
    .select('avg_scores')
    .eq('sdr_id', params.sdrId)
    .eq('week_number', prevWeek.week)
    .eq('year', prevWeek.year)
    .single();

  const comparison: Record<string, number> = {};
  if (prevReport?.avg_scores) {
    const prevScores = prevReport.avg_scores as Record<string, number>;
    for (const key of Object.keys(avgScores)) {
      if (prevScores[key] !== undefined) {
        comparison[key] = Math.round((avgScores[key] - prevScores[key]) * 10) / 10;
      }
    }
  }

  // Calculate coaching impact
  const { data: prevCoaching } = await supabase
    .from('coaching_items')
    .select('dimension, status')
    .eq('sdr_id', params.sdrId)
    .eq('company_id', params.companyId);

  const coachingImpact: Record<string, unknown> = {};
  if (prevCoaching) {
    const coachedDimensions = [...new Set(prevCoaching.map(c => c.dimension))];
    for (const dim of coachedDimensions) {
      const delta = comparison[dim];
      if (delta !== undefined) {
        coachingImpact[dim] = {
          coached: true,
          delta,
          improved: delta > 0,
        };
      }
    }
  }

  // Generate summary
  const topDim = Object.entries(avgScores)
    .filter(([k]) => k !== 'overall')
    .sort(([, a], [, b]) => b - a)[0];
  const bottomDim = Object.entries(avgScores)
    .filter(([k]) => k !== 'overall')
    .sort(([, a], [, b]) => a - b)[0];

  const dimLabel = (key: string) =>
    DIMENSIONS.find(d => d.key === key)?.label || key;

  const summary = `Analyzed ${analyses.length} calls this week with an average score of ${avgScores.overall}/10. Strongest area: ${dimLabel(topDim[0])} (${topDim[1]}). Needs work: ${dimLabel(bottomDim[0])} (${bottomDim[1]}).${
    Object.keys(comparison).length > 0
      ? ` Compared to last week: ${comparison.overall > 0 ? '↑' : comparison.overall < 0 ? '↓' : '→'} ${Math.abs(comparison.overall || 0)} points overall.`
      : ''
  }`;

  // Upsert the report
  const { data: report, error: reportError } = await supabase
    .from('weekly_reports')
    .upsert(
      {
        company_id: params.companyId,
        sdr_id: params.sdrId,
        week_number: params.weekNumber,
        year: params.year,
        calls_analyzed: analyses.length,
        avg_scores: avgScores,
        best_call_id: bestCallId || null,
        worst_call_id: worstCallId || null,
        summary,
        comparison_with_previous: comparison,
        coaching_impact: coachingImpact,
      },
      { onConflict: 'sdr_id,week_number,year' }
    )
    .select()
    .single();

  if (reportError) throw reportError;
  return report;
}

export async function getWeeklyReports(params: {
  companyId: string;
  sdrId?: string;
  weekNumber?: number;
  year?: number;
}): Promise<WeeklyReport[]> {
  let query = supabase
    .from('weekly_reports')
    .select('*')
    .eq('company_id', params.companyId)
    .order('year', { ascending: false })
    .order('week_number', { ascending: false });

  if (params.sdrId) query = query.eq('sdr_id', params.sdrId);
  if (params.weekNumber) query = query.eq('week_number', params.weekNumber);
  if (params.year) query = query.eq('year', params.year);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getSDRTrend(
  sdrId: string,
  weeks: number = 8
): Promise<WeeklyReport[]> {
  const { data, error } = await supabase
    .from('weekly_reports')
    .select('*')
    .eq('sdr_id', sdrId)
    .order('year', { ascending: false })
    .order('week_number', { ascending: false })
    .limit(weeks);

  if (error) throw error;
  return (data || []).reverse();
}
