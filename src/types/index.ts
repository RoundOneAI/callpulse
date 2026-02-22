export type UserRole = 'admin' | 'manager' | 'sdr';
export type CallStatus = 'uploading' | 'transcribing' | 'analyzing' | 'completed' | 'failed';
export type CoachingStatus = 'open' | 'in_progress' | 'completed';

export interface Company {
  id: string;
  name: string;
  created_at: string;
}

export interface Profile {
  id: string;
  company_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Call {
  id: string;
  company_id: string;
  sdr_id: string;
  uploaded_by: string;
  file_url: string | null;
  transcript: string | null;
  call_date: string;
  week_number: number;
  year: number;
  duration_seconds: number | null;
  prospect_name: string | null;
  status: CallStatus;
  created_at: string;
  // Joined fields
  sdr?: Profile;
  analysis?: CallAnalysis;
}

export interface ScoreDimension {
  score: number;
  justification: string;
  quotes: string[];
  coaching_suggestion: string;
}

export interface CallAnalysis {
  id: string;
  call_id: string;
  overall_score: number;
  opening_score: number;
  opening_justification: string;
  opening_quotes: string[];
  discovery_score: number;
  discovery_justification: string;
  discovery_quotes: string[];
  value_prop_score: number;
  value_prop_justification: string;
  value_prop_quotes: string[];
  objection_score: number;
  objection_justification: string;
  objection_quotes: string[];
  closing_score: number;
  closing_justification: string;
  closing_quotes: string[];
  tone_score: number;
  tone_justification: string;
  tone_quotes: string[];
  strengths: string[];
  weaknesses: string[];
  summary: string;
  created_at: string;
}

export interface CoachingItem {
  id: string;
  call_analysis_id: string;
  sdr_id: string;
  company_id: string;
  dimension: string;
  action_item: string;
  status: CoachingStatus;
  created_at: string;
  completed_at: string | null;
}

export interface WeeklyReport {
  id: string;
  company_id: string;
  sdr_id: string;
  week_number: number;
  year: number;
  calls_analyzed: number;
  avg_scores: Record<string, number>;
  best_call_id: string | null;
  worst_call_id: string | null;
  summary: string | null;
  comparison_with_previous: Record<string, number>;
  coaching_impact: Record<string, unknown>;
  created_at: string;
}

export interface AnalysisResult {
  overall_score: number;
  dimensions: {
    opening: ScoreDimension;
    discovery: ScoreDimension;
    value_prop: ScoreDimension;
    objection: ScoreDimension;
    closing: ScoreDimension;
    tone: ScoreDimension;
  };
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

export const DIMENSIONS = [
  { key: 'opening', label: 'Opening & Hook', dbPrefix: 'opening' },
  { key: 'discovery', label: 'Discovery & Qualification', dbPrefix: 'discovery' },
  { key: 'value_prop', label: 'Value Proposition', dbPrefix: 'value_prop' },
  { key: 'objection', label: 'Objection Handling', dbPrefix: 'objection' },
  { key: 'closing', label: 'Closing Technique', dbPrefix: 'closing' },
  { key: 'tone', label: 'Tone & Rapport', dbPrefix: 'tone' },
] as const;

export type DimensionKey = typeof DIMENSIONS[number]['key'];
