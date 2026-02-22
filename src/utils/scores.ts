export function getScoreColor(score: number): string {
  if (score >= 8) return 'text-emerald-600';
  if (score >= 6) return 'text-amber-600';
  return 'text-red-600';
}

export function getScoreBg(score: number): string {
  if (score >= 8) return 'bg-emerald-50 border-emerald-200';
  if (score >= 6) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

export function getScoreBadge(score: number): string {
  if (score >= 8) return 'bg-emerald-100 text-emerald-800';
  if (score >= 6) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

export function getDeltaIndicator(delta: number): string {
  if (delta > 0.3) return '↑';
  if (delta < -0.3) return '↓';
  return '→';
}

export function getDeltaColor(delta: number): string {
  if (delta > 0.3) return 'text-emerald-600';
  if (delta < -0.3) return 'text-red-600';
  return 'text-gray-500';
}
