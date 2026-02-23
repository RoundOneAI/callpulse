import { supabase } from './supabase';
import type { AnalysisResult } from '../types';

async function callEdgeFunction(functionName: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });

  if (error) {
    throw new Error(error.message || `${functionName} failed`);
  }

  return data;
}

export async function analyzeCall(params: {
  transcript: string;
  callId: string;
  sdrId: string;
  companyId: string;
}): Promise<AnalysisResult> {
  return callEdgeFunction('analyze-call', params) as Promise<AnalysisResult>;
}

export async function transcribeAudio(params: {
  callId: string;
  filePath: string;
}): Promise<{ transcript: string; durationSeconds: number }> {
  return callEdgeFunction('transcribe-audio', params);
}

/**
 * Fire-and-forget: kicks off the process-call Edge Function
 * which handles transcription (if audio) + analysis in one go.
 * The client does NOT await the full result — it returns immediately
 * after the Edge Function is invoked.
 */
export function processCallAsync(params: {
  callId: string;
  sdrId: string;
  companyId: string;
  filePath?: string;
  transcript?: string;
}): void {
  // Fire and forget — we intentionally do not await
  supabase.functions.invoke('process-call', { body: params }).catch((err) => {
    console.error(`Background processing failed for call ${params.callId}:`, err);
  });
}
