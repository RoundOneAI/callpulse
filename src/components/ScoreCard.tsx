import { cn } from '../utils/cn';
import { getScoreColor, getScoreBg, getDeltaIndicator, getDeltaColor } from '../utils/scores';

interface ScoreCardProps {
  label: string;
  score: number;
  delta?: number;
  justification?: string;
  quotes?: string[];
  coaching?: string;
  compact?: boolean;
}

export default function ScoreCard({
  label,
  score,
  delta,
  justification,
  quotes,
  coaching,
  compact = false,
}: ScoreCardProps) {
  if (compact) {
    return (
      <div className={cn('rounded-lg border p-3', getScoreBg(score))}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700">{label}</span>
          <div className="flex items-center gap-2">
            <span className={cn('text-lg font-bold', getScoreColor(score))}>
              {score.toFixed(1)}
            </span>
            {delta !== undefined && (
              <span className={cn('text-sm font-medium', getDeltaColor(delta))}>
                {getDeltaIndicator(delta)} {delta > 0 ? '+' : ''}{delta.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border p-4', getScoreBg(score))}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-900">{label}</h3>
        <div className="flex items-center gap-2">
          <span className={cn('text-2xl font-bold', getScoreColor(score))}>
            {score.toFixed(1)}
          </span>
          <span className="text-sm text-gray-500">/10</span>
        </div>
      </div>

      {justification && (
        <p className="text-sm text-gray-600 mb-3">{justification}</p>
      )}

      {quotes && quotes.length > 0 && (
        <div className="mb-3 space-y-1">
          {quotes.map((q, i) => (
            <blockquote
              key={i}
              className="text-sm text-gray-500 italic border-l-2 border-gray-300 pl-3"
            >
              "{q}"
            </blockquote>
          ))}
        </div>
      )}

      {coaching && (
        <div className="bg-white/60 rounded-lg p-3 border border-gray-200/50">
          <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">
            Coaching Tip
          </p>
          <p className="text-sm text-gray-700">{coaching}</p>
        </div>
      )}
    </div>
  );
}
