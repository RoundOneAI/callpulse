import { supabase } from './supabase';
import type { Call, CallAnalysis, CoachingItem } from '../types';
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
}): Promise<Call & { filePath: string }> {
  const date = new Date(params.callDate);
  const weekNumber = getWeekNumber(date);
  const year = date.getFullYear();

  // Upload file to storage
  const filePath = `${params.companyId}/${Date.now()}_${params.file.name}`;
  const { error: uploadError } = await supabase.storage
    .from('call-recordings')
    .upload(filePath, params.file);

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('calls')
    .insert({
      sdr_id: params.sdrId,
      company_id: params.companyId,
      uploaded_by: params.uploadedBy,
      file_url: filePath,
      file_path: filePath,
      call_date: params.callDate,
      week_number: weekNumber,
      year: year,
      prospect_name: params.prospectName || null,
      status: 'transcribing',
    })
    .select()
    .single();

  if (error) throw error;
  return { ...data, filePath };
}

export async function getAudioUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('call-recordings')
    .createSignedUrl(filePath, 3600); // 1 hour expiry

  if (error) {
    console.error('Failed to get signed URL:', error);
    return null;
  }
  return data.signedUrl;
}

export async function markCallFailed(callId: string): Promise<void> {
  await supabase
    .from('calls')
    .update({ status: 'failed' })
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
      sdr:profiles!calls_sdr_id_fkey(id, full_name, email)
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (filters?.sdrId) query = query.eq('sdr_id', filters.sdrId);
  if (filters?.weekNumber) query = query.eq('week_number', filters.weekNumber);
  if (filters?.year) query = query.eq('year', filters.year);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;

  // Fetch analyses separately to avoid RLS issues with joined queries
  const callIds = (data || []).map(c => c.id);
  let analyses: CallAnalysis[] = [];
  if (callIds.length > 0) {
    const { data: analysesData } = await supabase
      .from('call_analyses')
      .select('*')
      .in('call_id', callIds);
    analyses = analysesData || [];
  }

  return (data || []).map(call => ({
    ...call,
    analysis: analyses.find(a => a.call_id === call.id) || null,
  }));
}

export async function getCall(callId: string): Promise<Call & { analysis: CallAnalysis | null }> {
  // Fetch call with SDR profile
  const { data: callData, error: callError } = await supabase
    .from('calls')
    .select(`
      *,
      sdr:profiles!calls_sdr_id_fkey(id, full_name, email)
    `)
    .eq('id', callId)
    .single();

  if (callError) throw callError;

  // Fetch analysis separately (avoids RLS issues with joined queries)
  const { data: analysisData } = await supabase
    .from('call_analyses')
    .select('*')
    .eq('call_id', callId)
    .maybeSingle();

  return {
    ...callData,
    analysis: analysisData || null,
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

/**
 * Delete one or more calls and their associated data via Edge Function.
 * Uses service role key server-side — no RLS delete policies needed.
 */
export async function deleteCalls(callIds: string[]): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-calls', {
    body: { callIds },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
