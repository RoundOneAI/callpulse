import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Calendar, User, Clock, MessageSquare } from 'lucide-react';
import { getCall, getCoachingItems } from '../services/calls';
import { cn } from '../utils/cn';
import { getScoreColor, getScoreBg } from '../utils/scores';
import ScoreCard from '../components/ScoreCard';
import { DIMENSIONS } from '../types';
import type { Call, CallAnalysis, CoachingItem } from '../types';

export default function CallDetail() {
  const { id } = useParams<{ id: string }>();
  const [call, setCall] = useState<(Call & { analysis: CallAnalysis | null }) | null>(null);
  const [coaching, setCoaching] = useState<CoachingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getCall(id),
      getCoachingItems({ companyId: '' }).catch(() => []), // will filter client-side
    ]).then(([callData, items]) => {
      setCall(callData);
      setCoaching(items.filter(i => i.call_analysis_id === callData.analysis?.id));
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!call) {
    return <div className="text-center py-12 text-gray-500">Call not found</div>;
  }

  const analysis = call.analysis;

  return (
    <div className="space-y-6 max-w-6xl">
      <Link to="/calls" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to calls
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Call with {call.prospect_name || 'Unknown Prospect'}
          </h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <User className="h-4 w-4" />
              {(call.sdr as any)?.full_name}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {call.call_date}
            </span>
            {call.duration_seconds && (
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {Math.round(call.duration_seconds / 60)} min
              </span>
            )}
          </div>
        </div>
        {analysis && (
          <div className={cn('rounded-xl border px-6 py-3 text-center', getScoreBg(analysis.overall_score))}>
            <div className={cn('text-3xl font-bold', getScoreColor(analysis.overall_score))}>
              {analysis.overall_score.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500">Overall Score</div>
          </div>
        )}
      </div>

      {analysis && (
        <>
          {/* Summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Summary</h2>
            <p className="text-gray-600">{analysis.summary}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <h3 className="text-sm font-semibold text-emerald-700 mb-2">Strengths</h3>
                <ul className="space-y-1">
                  {analysis.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">+</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-red-700 mb-2">Areas for Improvement</h3>
                <ul className="space-y-1">
                  {analysis.weaknesses.map((w, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                      <span className="text-red-500 mt-0.5">-</span> {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Score cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DIMENSIONS.map(dim => {
              const scoreKey = `${dim.dbPrefix}_score` as keyof CallAnalysis;
              const justKey = `${dim.dbPrefix}_justification` as keyof CallAnalysis;
              const quotesKey = `${dim.dbPrefix}_quotes` as keyof CallAnalysis;
              const coachingItem = coaching.find(c => c.dimension === dim.key);
              return (
                <ScoreCard
                  key={dim.key}
                  label={dim.label}
                  score={Number(analysis[scoreKey])}
                  justification={String(analysis[justKey])}
                  quotes={analysis[quotesKey] as string[]}
                  coaching={coachingItem?.action_item}
                />
              );
            })}
          </div>
        </>
      )}

      {/* Transcript */}
      {call.transcript && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-gray-400" />
            Transcript
          </h2>
          <div className="prose prose-sm max-w-none text-gray-600 whitespace-pre-wrap font-mono text-xs leading-relaxed bg-gray-50 rounded-lg p-4 max-h-[500px] overflow-y-auto">
            {call.transcript}
          </div>
        </div>
      )}
    </div>
  );
}
