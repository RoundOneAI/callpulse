import { supabase } from './supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Integration, HubSpotCall } from '../types';

export async function getHubSpotIntegration(): Promise<Integration | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('type', 'hubspot')
    .maybeSingle();

  if (error) {
    console.error('Error fetching HubSpot integration:', error);
    return null;
  }
  return data;
}

export async function saveHubSpotIntegration(params: {
  companyId: string;
  privateToken: string;
  isActive: boolean;
}): Promise<Integration> {
  const { data, error } = await supabase
    .from('integrations')
    .upsert(
      {
        company_id: params.companyId,
        type: 'hubspot',
        credentials: { private_token: params.privateToken },
        is_active: params.isActive,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,type' }
    )
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function listHubSpotCalls(params: {
  startDate: string;
  endDate: string;
}): Promise<HubSpotCall[]> {
  const { data, error } = await supabase.functions.invoke('hubspot', {
    body: {
      action: 'list-calls',
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });

  if (error) {
    let customMsg = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body && (body.message || body.error)) {
          customMsg = body.message || body.error;
        }
      } catch (e) {
        // Ignore
      }
    }
    throw new Error(customMsg || 'Failed to fetch calls from HubSpot');
  }

  return data?.calls || [];
}

export interface HubSpotCallImportParam {
  hubspotCallId: string;
  sdrId: string;
  prospectName?: string;
}

export async function importHubSpotCalls(calls: HubSpotCallImportParam[]): Promise<{
  results: Array<{ hubspotCallId: string; success: boolean; callId?: string; error?: string }>;
}> {
  const { data, error } = await supabase.functions.invoke('hubspot', {
    body: {
      action: 'import-calls',
      calls,
    },
  });

  if (error) {
    let customMsg = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body && (body.message || body.error)) {
          customMsg = body.message || body.error;
        }
      } catch (e) {
        // Ignore
      }
    }
    throw new Error(customMsg || 'Failed to import calls from HubSpot');
  }

  return data;
}

export interface HubSpotSyncRun {
  id: string;
  company_id: string;
  status: 'success' | 'failed';
  imported_count: number;
  error_message: string | null;
  run_at: string;
}

export async function getLatestSyncRun(companyId: string): Promise<HubSpotSyncRun | null> {
  const { data, error } = await supabase
    .from('hubspot_sync_runs')
    .select('*')
    .eq('company_id', companyId)
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching latest sync run:', error);
    return null;
  }
  return data as any;
}
