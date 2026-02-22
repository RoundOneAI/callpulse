import { supabase } from './supabase';
import type { Call, CallAnalysis, CoachingItem, AnalysisResult } from '../types';
import { getWeekNumber } from '../utils/dates';

export async function uploadCall(params: {
  sdrId: string;
  companyId: string;
  uploadedBy: string;
  transcript: string;
  callDate: string;
  prospectName?: string;
}): Promise<Call> {
  const date = new Date(params.callDate);
  const weekNumber = getWeekNumber(date);
  const year = date.getFullYear();

  const { data, error } = await supabase
    .from('calls')
    .insert({
      sdr_id: params.sdrId,
      company_id: params.companyId,
      uploaded_by: params.uploadedBy,
      transcript: params.transcript,
      call_date: params.callDate,
      week_number: weekNumber,
      year: year,
      prospect_name: params.prospectName || null,
      status: 'analyzing',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function uploadAudioCall(params: {
  sdrId: string;
  companyId: string;
  uploadedBy: string;
  file: File;
  callDate: string;
  prospectName?: string;
}): Promise<Call> {
  const date = new Date(params.callDate);
  const weekNumber = getWeekNumber(date);
  const year = date.getFullYear();

  // Upload file to storage
  const filePath = `${params.companyId}/${Date.now()}_${params.file.name}`;
  const { error: uploadError } = await supabase.storage
    .from('call-recordings')
    .upload(filePath, params.file);

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from('call-recordings')
    .getPublicUrl(filePath);

  const { data, error } = await supabase
    .from('calls')
    .insert({
      sdr_id: params.sdrId,
      company_id: params.companyId,
      uploaded_by: params.uploadedBy,
      file_url: publicUrl,
      call_date: params.callDate,
      week_number: weekNumber,
      year: year,
      prospect_name: params.prospectName || null,
      status: 'transcribing',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveAnalysis(
  callId: string,
  analysis: AnalysisResult,
  sdrId: string,
  companyId: string
): Promise<void> {
  const { error: analysisError } = await supabase
    .from('call_analyses')
    .insert({
      call_id: callId,
      overall_score: analysis.overall_score,
      opening_score: analysis.dimensions.opening.score,
      opening_justification: analysis.dimensions.opening.justification,
      opening_quotes: analysis.dimensions.opening.quotes,
      discovery_score: analysis.dimensions.discovery.score,
      discovery_justification: analysis.dimensions.discovery.justification,
      discovery_quotes: analysis.dimensions.discovery.quotes,
      value_prop_score: analysis.dimensions.value_prop.score,
      value_prop_justification: analysis.dimensions.value_prop.justification,
      value_prop_quotes: analysis.dimensions.value_prop.quotes,
      objection_score: analysis.dimensions.objection.score,
      objection_justification: analysis.dimensions.objection.justification,
      objection_quotes: analysis.dimensions.objection.quotes,
      closing_score: analysis.dimensions.closing.score,
      closing_justification: analysis.dimensions.closing.justification,
      closing_quotes: analysis.dimensions.closing.quotes,
      tone_score: analysis.dimensions.tone.score,
      tone_justification: analysis.dimensions.tone.justification,
      tone_quotes: analysis.dimensions.tone.quotes,
      strengths: analysis.strengths,
      weaknesses: analysis.weaknesses,
      summary: analysis.summary,
    });

  if (analysisError) throw analysisError;

  // Create coaching items from each dimension's suggestion
  const coachingItems = Object.entries(analysis.dimensions).map(([dimension, dim]) => ({
    call_analysis_id: '', // will be filled after we get the analysis id
    sdr_id: sdrId,
    company_id: companyId,
    dimension,
    action_item: dim.coaching_suggestion,
    status: 'open' as const,
  }));

  // Get the analysis ID
  const { data: savedAnalysis } = await supabase
    .from('call_analyses')
    .select('id')
    .eq('call_id', callId)
    .single();

  if (savedAnalysis) {
    const itemsWithId = coachingItems.map(item => ({
      ...item,
      call_analysis_id: savedAnalysis.id,
    }));

    await supabase.from('coaching_items').insert(itemsWithId);
  }

  // Update call status
  await supabase
    .from('calls')
    .update({ status: 'completed' })
    .eq('id', callId);
}

export async function getCalls(companyId: string, filters?: {
  sdrId?: string;
  weekNumber?: number;
  year?: number;
  status?: string;
}): Promise<Call[]> {
  let query = supabase
    .from('calls')
    .select(`
      *,
      sdr:profiles!calls_sdr_id_fkey(id, full_name, email),
      analysis:call_analyses(*)
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (filters?.sdrId) query = query.eq('sdr_id', filters.sdrId);
  if (filters?.weekNumber) query = query.eq('week_number', filters.weekNumber);
  if (filters?.year) query = query.eq('year', filters.year);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getCall(callId: string): Promise<Call & { analysis: CallAnalysis | null }> {
  const { data, error } = await supabase
    .from('calls')
    .select(`
      *,
      sdr:profiles!calls_sdr_id_fkey(id, full_name, email),
      analysis:call_analyses(*)
    `)
    .eq('id', callId)
    .single();

  if (error) throw error;
  return {
    ...data,
    analysis: data.analysis?.[0] || null,
  };
}

export async function getCoachingItems(params: {
  companyId: string;
  sdrId?: string;
  status?: string;
}): Promise<CoachingItem[]> {
  let query = supabase
    .from('coaching_items')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.sdrId) query = query.eq('sdr_id', params.sdrId);
  if (params.status) query = query.eq('status', params.status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function updateCoachingStatus(
  itemId: string,
  status: CoachingItem['status']
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'completed') updates.completed_at = new Date().toISOString();

  const { error } = await supabase
    .from('coaching_items')
    .update(updates)
    .eq('id', itemId);

  if (error) throw error;
}
