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
