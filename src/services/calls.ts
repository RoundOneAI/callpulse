import { supabase } from './supabase';
import type { Call, CallAnalysis, CoachingItem } from '../types';
import { getWeekNumber } from '../utils/dates';

const CALL_RECORDINGS_BUCKET = 'call-recordings';
const SAVE_TIMEOUT_MS = 30_000;
const STORAGE_CHECK_TIMEOUT_MS = 10_000;
const SAVE_RECOVERY_ATTEMPTS = 3;
const SAVE_RECOVERY_DELAY_MS = 1_000;
const MIN_UPLOAD_TIMEOUT_MS = 60_000;
const MAX_UPLOAD_TIMEOUT_MS = 10 * 60_000;
const MIN_UPLOAD_BYTES_PER_SECOND = 128 * 1024;

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function getUploadTimeoutMs(file: File): number {
  const estimatedMs = (file.size / MIN_UPLOAD_BYTES_PER_SECOND) * 1000;
  return Math.min(MAX_UPLOAD_TIMEOUT_MS, Math.max(MIN_UPLOAD_TIMEOUT_MS, estimatedMs));
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function buildRecordingPath(companyId: string, fileName: string): string {
  const safeName = fileName.replace(/[\\/]/g, '_');
  return `${companyId}/${Date.now()}_${safeName}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function storageObjectExists(filePath: string): Promise<boolean> {
  const slashIndex = filePath.lastIndexOf('/');
  const folder = slashIndex >= 0 ? filePath.slice(0, slashIndex) : '';
  const fileName = slashIndex >= 0 ? filePath.slice(slashIndex + 1) : filePath;

  const { data, error } = await withTimeout(
    supabase.storage
      .from(CALL_RECORDINGS_BUCKET)
      .list(folder, { limit: 1, search: fileName }),
    STORAGE_CHECK_TIMEOUT_MS,
    'Could not confirm whether the uploaded recording was saved.'
  );

  if (error) return false;
  return (data || []).some(file => file.name === fileName);
}

async function findCallByFilePath(filePath: string): Promise<Call | null> {
  const { data, error } = await withTimeout(
    supabase
      .from('calls')
      .select('*')
      .eq('file_path', filePath)
      .maybeSingle(),
    SAVE_TIMEOUT_MS,
    'Could not confirm whether the call record was saved.'
  );

  if (error) return null;
  return data;
}

async function waitForCallByFilePath(filePath: string): Promise<Call | null> {
  for (let attempt = 0; attempt < SAVE_RECOVERY_ATTEMPTS; attempt++) {
    const call = await findCallByFilePath(filePath);
    if (call) return call;
    await delay(SAVE_RECOVERY_DELAY_MS);
  }

  return null;
}

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

  const { data, error } = await withTimeout(
    supabase
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
      .single(),
    SAVE_TIMEOUT_MS,
    'The transcript was ready, but saving the call record took too long. Please try again.'
  );

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
  onStage?: (stage: 'uploading' | 'saving') => void;
}): Promise<Call & { filePath: string }> {
  const date = new Date(params.callDate);
  const weekNumber = getWeekNumber(date);
  const year = date.getFullYear();

  // Upload file to storage
  const filePath = buildRecordingPath(params.companyId, params.file.name);
  params.onStage?.('uploading');

  const uploadResult = await withTimeout(
    supabase.storage
      .from(CALL_RECORDINGS_BUCKET)
      .upload(filePath, params.file, {
        contentType: params.file.type || undefined,
      }),
    getUploadTimeoutMs(params.file),
    'The recording upload took too long to respond.'
  ).catch(async (err) => {
    if (err instanceof TimeoutError && await storageObjectExists(filePath)) {
      return {
        data: {
          id: '',
          path: filePath,
          fullPath: `${CALL_RECORDINGS_BUCKET}/${filePath}`,
        },
        error: null,
      };
    }
    throw err;
  });

  if (uploadResult.error) throw uploadResult.error;

  params.onStage?.('saving');

  const saveResult = await withTimeout(
    supabase
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
      .single(),
    SAVE_TIMEOUT_MS,
    'The recording uploaded, but saving the call record took too long. Please try again.'
  ).catch(async (err) => {
    if (err instanceof TimeoutError) {
      const existingCall = await waitForCallByFilePath(filePath);
      if (existingCall) return { data: existingCall, error: null };
    }

    throw err;
  });

  if (saveResult.error) throw saveResult.error;
  return { ...saveResult.data, filePath };
}

export async function getAudioUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CALL_RECORDINGS_BUCKET)
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
    .select(`
      *,
      call_analyses (
        call_id
      )
    `)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.sdrId) query = query.eq('sdr_id', params.sdrId);
  if (params.status) query = query.eq('status', params.status);

  const { data, error } = await query;
  if (error) throw error;
  return (data as any) || [];
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

  if (error) {
    try {
      const responseText = await error.context.text();
      const parsed = JSON.parse(responseText);
      if (parsed && parsed.error) {
        throw new Error(parsed.error);
      }
    } catch (_) {}
    throw error;
  }
  if (data?.error) throw new Error(data.error);
}
