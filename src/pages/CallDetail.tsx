import { useEffect, useState } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, User, Clock, MessageSquare, Headphones, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getCall, getCoachingItems, getAudioUrl, getCalls } from '../services/calls';
import { cn } from '../utils/cn';
import { getScoreColor, getScoreBg } from '../utils/scores';
import ScoreCard from '../components/ScoreCard';
import AudioPlayer from '../components/AudioPlayer';
import { DIMENSIONS } from '../types';
import type { Call, CallAnalysis, CoachingItem } from '../types';

export default function CallDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, company } = useAuthStore();

  const [call, setCall] = useState<(Call & { analysis: CallAnalysis | null }) | null>(null);
  const [coaching, setCoaching] = useState<CoachingItem[]>([]);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [localCallIds, setLocalCallIds] = useState<string[]>([]);

  const stateCallIds = location.state?.callIds;
  const callIds = stateCallIds || localCallIds;
  const currentIndex = callIds.indexOf(id || '');
  const prevId = currentIndex > 0 ? callIds[currentIndex - 1] : null;
  const nextId = currentIndex >= 0 && currentIndex < callIds.length - 1 ? callIds[currentIndex + 1] : null;

  const backUrl = location.state?.backUrl || '/calls';
  const backLabel = backUrl.includes('/team') 
    ? (backUrl.endsWith('/calls') ? 'Back to SDR calls' : 'Back to SDR profile')
    : backUrl === '/' ? 'Back to dashboard' : 'Back to calls';

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setAudioSrc(null);
    setCall(null);
    setCoaching([]);

    getCall(id).then(async (callData) => {
      setCall(callData);
      if (callData.company_id && callData.analysis?.id) {
        const items = await getCoachingItems({ companyId: callData.company_id });
        setCoaching(items.filter(i => i.call_analysis_id === callData.analysis?.id));
      }
      // Fetch signed audio URL if file exists
      if (callData.file_path) {
        const url = await getAudioUrl(callData.file_path);
        if (url) setAudioSrc(url);
      }
      setLoading(false);

      // Fetch calls context if not available in router state
      if (!stateCallIds && callData.company_id && callData.sdr_id) {
        getCalls(callData.company_id, { sdrId: callData.sdr_id })
          .then((callsData) => {
            setLocalCallIds(callsData.map(c => c.id));
          })
          .catch((err) => {
            console.error('Error fetching local calls context:', err);
          });
      }
    }).catch((err) => {
      console.error('CallDetail error:', err);
      setLoading(false);
    });
  }, [id, stateCallIds]);

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

  const isSdr = user?.role === 'sdr';
  const allowSdrViewAll = company?.allow_sdr_view_all === true;

  if (isSdr && !allowSdrViewAll && call.sdr_id !== user?.id) {
    return (
      <div className="text-center py-12 text-gray-500 font-medium">
        Access Denied. You do not have permission to view other SDRs' calls.
      </div>
    );
  }

  const analysis = call.analysis;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <Link to={backUrl} state={location.state} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>

        {callIds.length > 0 && currentIndex !== -1 && (
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
            <button
              onClick={() => prevId && navigate(`/calls/${prevId}`, { state: location.state })}
              disabled={!prevId}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                prevId ? "text-gray-700 hover:bg-gray-50" : "text-gray-300 cursor-not-allowed"
              )}
              title="Previous Call"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <span className="text-[11px] font-medium text-gray-400 px-2 border-x border-gray-100">
              {currentIndex + 1} of {callIds.length}
            </span>
            <button
              onClick={() => nextId && navigate(`/calls/${nextId}`, { state: location.state })}
              disabled={!nextId}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                nextId ? "text-gray-700 hover:bg-gray-50" : "text-gray-300 cursor-not-allowed"
              )}
              title="Next Call"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            Call with {call.prospect_name || 'Unknown Prospect'}
            {call.hubspot_contact_id && call.hubspot_portal_id && (
              <a
                href={`https://app.hubspot.com/contacts/${call.hubspot_portal_id}/contact/${call.hubspot_contact_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-50 border border-orange-200 hover:bg-orange-100 text-orange-700 text-xs font-semibold rounded-full transition-colors ml-2 shadow-sm"
                title="View in HubSpot"
              >
                <ExternalLink className="h-3 w-3 text-orange-500" />
                HubSpot Contact
              </a>
            )}
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

      {/* Audio Player */}
      {audioSrc && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Headphones className="h-5 w-5 text-gray-400" />
            Call Recording
          </h2>
          <AudioPlayer src={audioSrc} />
        </div>
      )}

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
