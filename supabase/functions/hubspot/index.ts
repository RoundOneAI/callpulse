import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { action } = body;

    let callerProfile = null;
    let isServiceRole = false;
    let caller = null;

    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || token === 'callpulse-sync-cron-key-987654321') {
      isServiceRole = true;
    }

    if (!isServiceRole) {
      // Verify caller
      const { data: { user: u }, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !u) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      caller = u;

      // Verify caller is admin or manager
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role, company_id')
        .eq('id', caller.id)
        .single();

      if (!profile || !['admin', 'manager'].includes(profile.role)) {
        return new Response(JSON.stringify({ error: 'Only admins and managers can use integrations' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerProfile = profile;
    }

    // Only load single integration if this is not a cron-sync job
    let integration = null;
    let privateToken = null;
    if (action !== 'cron-sync') {
      if (!callerProfile) {
        return new Response(JSON.stringify({ error: 'Caller profile required for this action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: int, error: intError } = await supabaseAdmin
        .from('integrations')
        .select('*')
        .eq('company_id', callerProfile.company_id)
        .eq('type', 'hubspot')
        .maybeSingle();

      if (intError) {
        throw new Error(`Failed to check HubSpot integration: ${intError.message}`);
      }
      integration = int;
      privateToken = int?.credentials?.private_token;
    }

    if (action === 'list-calls') {
      if (!privateToken || !integration.is_active) {
        return new Response(JSON.stringify({ error: 'HUBSPOT_NOT_CONNECTED', message: 'HubSpot integration not configured or active' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { startDate, endDate } = body;
      if (!startDate || !endDate) {
        return new Response(JSON.stringify({ error: 'startDate and endDate are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();

      // Call HubSpot Search API
      const hsSearchUrl = 'https://api.hubapi.com/crm/v3/objects/calls/search';
      const hsResponse = await fetch(hsSearchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${privateToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'hs_timestamp',
                  operator: 'GTE',
                  value: String(startMs),
                },
                {
                  propertyName: 'hs_timestamp',
                  operator: 'LTE',
                  value: String(endMs),
                },
              ],
            },
          ],
          properties: ['hs_call_title', 'hs_call_body', 'hs_call_duration', 'hs_call_recording_url', 'hs_timestamp', 'hubspot_owner_id'],
          sorts: [
            {
              propertyName: 'hs_timestamp',
              direction: 'DESCENDING',
            },
          ],
          limit: 100,
        }),
      });

      if (!hsResponse.ok) {
        const errText = await hsResponse.text();
        throw new Error(`HubSpot Search API error: ${errText}`);
      }

      const hsData = await hsResponse.json();
      const hsCalls = hsData.results || [];

      // Fetch Owners
      const ownersResponse = await fetch('https://api.hubapi.com/crm/v3/owners?limit=100', {
        headers: {
          'Authorization': `Bearer ${privateToken}`,
        },
      });

      const ownersMap: Record<string, string> = {};
      if (ownersResponse.ok) {
        const ownersData = await ownersResponse.json();
        for (const owner of (ownersData.results || [])) {
          ownersMap[owner.id] = owner.email;
        }
      }

      // Fetch active profiles (SDRs) in CallPulse for auto-matching
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, hubspot_owner_email')
        .eq('company_id', callerProfile.company_id)
        .eq('is_active', true);

      // Check which calls are already imported
      const hubspotCallIds = hsCalls.map((c: any) => c.id);
      let existingCallIdsSet = new Set<string>();
      if (hubspotCallIds.length > 0) {
        const { data: existingCalls } = await supabaseAdmin
          .from('calls')
          .select('hubspot_call_id')
          .eq('company_id', callerProfile.company_id)
          .in('hubspot_call_id', hubspotCallIds);
        existingCallIdsSet = new Set(existingCalls?.map(c => c.hubspot_call_id).filter(Boolean) || []);
      }

      // Map calls
      const calls = hsCalls.map((c: any) => {
        const p = c.properties;
        const ownerId = p.hubspot_owner_id;
        const ownerEmail = ownerId ? ownersMap[ownerId] : null;
        const matchedSdr = ownerEmail
          ? profiles?.find(
              s =>
                s.email.toLowerCase() === ownerEmail.toLowerCase() ||
                (s.hubspot_owner_email && s.hubspot_owner_email.toLowerCase() === ownerEmail.toLowerCase())
            )
          : null;

        const title = p.hs_call_title || 'Untitled HubSpot Call';
        let prospectName = '';
        const match = title.match(/^Call with\s+(.+)$/i);
        if (match) {
          prospectName = match[1].trim();
        }

        return {
          hubspotCallId: c.id,
          title,
          body: p.hs_call_body || '',
          durationSeconds: p.hs_call_duration ? Math.round(Number(p.hs_call_duration) / 1000) : 0,
          recordingUrl: p.hs_call_recording_url || null,
          timestamp: p.hs_timestamp,
          ownerId,
          ownerEmail,
          suggestedSdrId: matchedSdr?.id || null,
          suggestedSdrName: matchedSdr?.full_name || null,
          prospectName,
          alreadyImported: existingCallIdsSet.has(c.id),
        };
      });

      return new Response(JSON.stringify({ calls }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'import-calls') {
      if (!privateToken || !integration.is_active) {
        return new Response(JSON.stringify({ error: 'HUBSPOT_NOT_CONNECTED', message: 'HubSpot integration not configured or active' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { calls: callsToImport } = body;
      if (!callsToImport || !Array.isArray(callsToImport)) {
        return new Response(JSON.stringify({ error: 'calls array is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch portal ID
      let portalId = '';
      try {
        const meResponse = await fetch('https://api.hubapi.com/integrations/v1/me', {
          headers: {
            'Authorization': `Bearer ${privateToken}`,
          },
        });
        if (meResponse.ok) {
          const meData = await meResponse.json();
          portalId = String(meData.portalId || '');
        }
      } catch (err) {
        console.error('Error fetching HubSpot portal ID:', err);
      }

      const results = [];

      for (const callImport of callsToImport) {
        const { hubspotCallId, sdrId, prospectName } = callImport;

        try {
          // Fetch call detail from HubSpot to get recording URL and details (including contact associations)
          const detailResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/calls/${hubspotCallId}?properties=hs_call_title,hs_call_recording_url,hs_timestamp,hs_call_body&associations=contacts`, {
            headers: {
              'Authorization': `Bearer ${privateToken}`,
            },
          });

          if (!detailResponse.ok) {
            throw new Error(`Failed to fetch call details from HubSpot for ${hubspotCallId}`);
          }

          const detailData = await detailResponse.json();
          const p = detailData.properties;
          const recordingUrl = p.hs_call_recording_url;
          const contactId = detailData.associations?.contacts?.results?.[0]?.id || null;

          if (!recordingUrl) {
            throw new Error(`Call ${hubspotCallId} has no recording URL in HubSpot`);
          }

          // Download recording from HubSpot
          const audioRes = await fetch(recordingUrl);
          if (!audioRes.ok) {
            throw new Error(`Failed to download audio recording from HubSpot: ${audioRes.statusText}`);
          }

          const arrayBuffer = await audioRes.arrayBuffer();
          const audioData = new Uint8Array(arrayBuffer);

          // Get file extension
          let ext = 'mp3';
          const contentType = audioRes.headers.get('Content-Type') || '';
          if (contentType.includes('wav')) {
            ext = 'wav';
          } else if (contentType.includes('mp4') || contentType.includes('m4a')) {
            ext = 'm4a';
          } else if (contentType.includes('ogg')) {
            ext = 'ogg';
          } else {
            const urlPath = recordingUrl.split('?')[0];
            const parsedExt = urlPath.split('.').pop()?.toLowerCase();
            if (parsedExt && ['mp3', 'wav', 'm4a', 'ogg'].includes(parsedExt)) {
              ext = parsedExt;
            }
          }

          // Upload to Supabase Storage
          const filePath = `${callerProfile.company_id}/hubspot_${hubspotCallId}_${Date.now()}.${ext}`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from('call-recordings')
            .upload(filePath, audioData, {
              contentType: contentType || 'audio/mpeg',
              upsert: true,
            });

          if (uploadError) {
            throw new Error(`Storage upload failed: ${uploadError.message}`);
          }

          // Calculate dates
          const callDateObj = p.hs_timestamp ? new Date(p.hs_timestamp) : new Date();
          const callDateString = callDateObj.toISOString().split('T')[0];
          const weekNumber = getWeekNumber(callDateObj);
          const year = callDateObj.getFullYear();

          // Create Calls record
          const { data: callRecord, error: callError } = await supabaseAdmin
            .from('calls')
            .insert({
              company_id: callerProfile.company_id,
              sdr_id: sdrId,
              uploaded_by: caller.id,
              file_path: filePath,
              file_url: filePath,
              call_date: callDateString,
              week_number: weekNumber,
              year: year,
              prospect_name: prospectName || null,
              status: 'transcribing',
              hubspot_call_id: hubspotCallId,
              hubspot_contact_id: contactId,
              hubspot_portal_id: portalId || null,
            })
            .select()
            .single();

          if (callError) {
            throw new Error(`Failed to save call record: ${callError.message}`);
          }

          // Trigger processing asynchronously in the background
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-call`, {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              callId: callRecord.id,
              sdrId: sdrId,
              companyId: callerProfile.company_id,
              filePath: filePath,
            }),
          }).catch(err => console.error(`Error triggering background processing for ${callRecord.id}:`, err));

          results.push({ hubspotCallId, success: true, callId: callRecord.id });
        } catch (callErr: any) {
          console.error(`Error importing call ${hubspotCallId}:`, callErr);
          results.push({ hubspotCallId, success: false, error: callErr.message });
        }
      }

      // Log sync run
      try {
        const successCount = results.filter(r => r.success).length;
        await supabaseAdmin
          .from('hubspot_sync_runs')
          .insert({
            company_id: callerProfile.company_id,
            status: 'success',
            imported_count: successCount,
          });
      } catch (logErr) {
        console.error('Error logging manual sync run:', logErr);
      }

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'cron-sync') {
      if (!isServiceRole) {
        return new Response(JSON.stringify({ error: 'Cron sync can only be triggered by system service role' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch all active HubSpot integrations
      const { data: integrations, error: intsError } = await supabaseAdmin
        .from('integrations')
        .select('*')
        .eq('type', 'hubspot')
        .eq('is_active', true);

      if (intsError) {
        throw new Error(`Failed to fetch active integrations: ${intsError.message}`);
      }

      const syncResults = [];

      for (const integration of (integrations || [])) {
        const companyId = integration.company_id;
        const privateToken = integration.credentials?.private_token;
        if (!privateToken) continue;

        try {
          // 1. Fetch portal ID
          let portalId = '';
          const meResponse = await fetch('https://api.hubapi.com/integrations/v1/me', {
            headers: { 'Authorization': `Bearer ${privateToken}` },
          });
          if (meResponse.ok) {
            const meData = await meResponse.json();
            portalId = String(meData.portalId || '');
          }

          // 2. Fetch active SDR profiles
          const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email, hubspot_owner_email')
            .eq('company_id', companyId)
            .eq('is_active', true);

          // 3. Search calls from the last 2 hours (ensuring safe overlap)
          const endMs = Date.now();
          const startMs = endMs - (2 * 60 * 60 * 1000);

          const hsSearchUrl = 'https://api.hubapi.com/crm/v3/objects/calls/search';
          const hsResponse = await fetch(hsSearchUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${privateToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filterGroups: [
                {
                  filters: [
                    { propertyName: 'hs_timestamp', operator: 'GTE', value: String(startMs) },
                    { propertyName: 'hs_timestamp', operator: 'LTE', value: String(endMs) },
                  ],
                },
              ],
              properties: ['hs_call_title', 'hs_call_body', 'hs_call_duration', 'hs_call_recording_url', 'hs_timestamp', 'hubspot_owner_id'],
              sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
              limit: 100,
            }),
          });

          if (!hsResponse.ok) {
            const errText = await hsResponse.text();
            throw new Error(`HubSpot Search API error: ${errText}`);
          }

          const hsData = await hsResponse.json();
          const hsCalls = hsData.results || [];
          if (hsCalls.length === 0) {
            syncResults.push({ companyId, importedCount: 0 });
            continue;
          }

          // Fetch Owners to map sdrId
          const ownersResponse = await fetch('https://api.hubapi.com/crm/v3/owners?limit=100', {
            headers: { 'Authorization': `Bearer ${privateToken}` },
          });
          const ownersMap: Record<string, string> = {};
          if (ownersResponse.ok) {
            const ownersData = await ownersResponse.json();
            for (const owner of (ownersData.results || [])) {
              ownersMap[owner.id] = owner.email;
            }
          }

          // Check which calls are already imported
          const hubspotCallIds = hsCalls.map((c: any) => c.id);
          const { data: existingCalls } = await supabaseAdmin
            .from('calls')
            .select('hubspot_call_id')
            .eq('company_id', companyId)
            .in('hubspot_call_id', hubspotCallIds);
          const existingCallIdsSet = new Set(existingCalls?.map(c => c.hubspot_call_id).filter(Boolean) || []);

          let importedCount = 0;

          for (const c of hsCalls) {
            if (existingCallIdsSet.has(c.id)) continue; // Already imported

            const p = c.properties;
            const recordingUrl = p.hs_call_recording_url;
            if (!recordingUrl) continue; // No recording to process

            // Identify owner & SDR
            const ownerId = p.hubspot_owner_id;
            const ownerEmail = ownerId ? ownersMap[ownerId] : null;
            const matchedSdr = ownerEmail
              ? profiles?.find(
                  s =>
                    s.email.toLowerCase() === ownerEmail.toLowerCase() ||
                    (s.hubspot_owner_email && s.hubspot_owner_email.toLowerCase() === ownerEmail.toLowerCase())
                )
              : null;

            if (!matchedSdr) continue; // Skip call if not matching an active SDR in company

            const title = p.hs_call_title || 'Untitled HubSpot Call';
            let prospectName = '';
            const match = title.match(/^Call with\s+(.+)$/i);
            if (match) prospectName = match[1].trim();

            try {
              // Fetch detailed call with associations
              const detailResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/calls/${c.id}?properties=hs_call_recording_url&associations=contacts`, {
                headers: { 'Authorization': `Bearer ${privateToken}` },
              });
              let contactId = null;
              if (detailResponse.ok) {
                const detailData = await detailResponse.json();
                contactId = detailData.associations?.contacts?.results?.[0]?.id || null;
              }

              // Download audio recording
              const audioRes = await fetch(recordingUrl);
              if (!audioRes.ok) continue;

              const arrayBuffer = await audioRes.arrayBuffer();
              const audioData = new Uint8Array(arrayBuffer);

              // Get extension
              let ext = 'mp3';
              const contentType = audioRes.headers.get('Content-Type') || '';
              if (contentType.includes('wav')) ext = 'wav';
              else if (contentType.includes('mp4') || contentType.includes('m4a')) ext = 'm4a';
              else if (contentType.includes('ogg')) ext = 'ogg';

              // Upload to Supabase Storage
              const filePath = `${companyId}/hubspot_${c.id}_${Date.now()}.${ext}`;
              await supabaseAdmin.storage
                .from('call-recordings')
                .upload(filePath, audioData, {
                  contentType: contentType || 'audio/mpeg',
                  upsert: true,
                });

              // Create record
              const callDateObj = p.hs_timestamp ? new Date(p.hs_timestamp) : new Date();
              const callDateString = callDateObj.toISOString().split('T')[0];
              const weekNumber = getWeekNumber(callDateObj);
              const year = callDateObj.getFullYear();

              const { data: callRecord, error: callError } = await supabaseAdmin
                .from('calls')
                .insert({
                  company_id: companyId,
                  sdr_id: matchedSdr.id,
                  uploaded_by: matchedSdr.id,
                  file_path: filePath,
                  file_url: filePath,
                  call_date: callDateString,
                  week_number: weekNumber,
                  year: year,
                  prospect_name: prospectName || null,
                  status: 'transcribing',
                  hubspot_call_id: c.id,
                  hubspot_contact_id: contactId,
                  hubspot_portal_id: portalId || null,
                })
                .select()
                .single();

              if (callError) throw callError;

              // Trigger processing asynchronously in background
              fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-call`, {
                method: 'POST',
                headers: {
                  'Authorization': authHeader,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  callId: callRecord.id,
                  sdrId: matchedSdr.id,
                  companyId: companyId,
                  filePath: filePath,
                }),
              }).catch(err => console.error(`Error triggering processing for cron:`, err));

              importedCount++;
            } catch (err) {
              console.error(`Failed to import call ${c.id} during cron:`, err);
            }
          }

          // Log cron sync run success
          try {
            await supabaseAdmin
              .from('hubspot_sync_runs')
              .insert({
                company_id: companyId,
                status: 'success',
                imported_count: importedCount,
              });
          } catch (logErr) {
            console.error('Error logging successful cron sync:', logErr);
          }

          syncResults.push({ companyId, importedCount });
        } catch (err: any) {
          console.error(`Error syncing company ${companyId} during cron:`, err);
          
          // Log cron sync run failure
          try {
            await supabaseAdmin
              .from('hubspot_sync_runs')
              .insert({
                company_id: companyId,
                status: 'failed',
                imported_count: 0,
                error_message: err.message || 'Unknown error',
              });
          } catch (logErr) {
            console.error('Error logging failed cron sync:', logErr);
          }

          syncResults.push({ companyId, error: err.message });
        }
      }

      return new Response(JSON.stringify({ results: syncResults }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('HubSpot Integration Function Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
