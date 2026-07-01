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

    // Verify caller
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is admin or manager
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, company_id')
      .eq('id', caller.id)
      .single();

    if (!callerProfile || !['admin', 'manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Only admins and managers can use integrations' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action } = body;

    // Fetch HubSpot integration for company
    const { data: integration, error: intError } = await supabaseAdmin
      .from('integrations')
      .select('*')
      .eq('company_id', callerProfile.company_id)
      .eq('type', 'hubspot')
      .maybeSingle();

    if (intError) {
      throw new Error(`Failed to check HubSpot integration: ${intError.message}`);
    }

    const privateToken = integration?.credentials?.private_token;

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

      const results = [];

      for (const callImport of callsToImport) {
        const { hubspotCallId, sdrId, prospectName } = callImport;

        try {
          // Fetch call detail from HubSpot to get recording URL and details
          const detailResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/calls/${hubspotCallId}?properties=hs_call_title,hs_call_recording_url,hs_timestamp,hs_call_body`, {
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

      return new Response(JSON.stringify({ results }), {
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
