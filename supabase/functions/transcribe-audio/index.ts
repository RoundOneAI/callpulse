import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

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
      return new Response(JSON.stringify({ error: 'Only admins and managers can transcribe calls' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { callId, filePath } = await req.json();

    if (!callId || !filePath) {
      return new Response(JSON.stringify({ error: 'callId and filePath are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!deepgramApiKey) {
      return new Response(JSON.stringify({ error: 'Deepgram API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Download audio from Supabase Storage
    const { data: audioData, error: downloadError } = await supabaseAdmin.storage
      .from('call-recordings')
      .download(filePath);

    if (downloadError || !audioData) {
      return new Response(JSON.stringify({ error: `Failed to download audio: ${downloadError?.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Detect content type from file extension
    const ext = filePath.split('.').pop()?.toLowerCase();
    const contentTypeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
    };
    const contentType = contentTypeMap[ext || ''] || 'audio/mpeg';

    // Send to Deepgram for transcription
    const deepgramResponse = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&paragraphs=true&diarize=true&utterances=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${deepgramApiKey}`,
          'Content-Type': contentType,
        },
        body: audioData,
      }
    );

    if (!deepgramResponse.ok) {
      const errText = await deepgramResponse.text();
      return new Response(JSON.stringify({ error: `Deepgram error: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const deepgramData = await deepgramResponse.json();

    // Build transcript from utterances (with speaker labels) or fall back to paragraphs
    let transcript = '';

    const utterances = deepgramData.results?.utterances;
    if (utterances && utterances.length > 0) {
      transcript = utterances
        .map((u: any) => `Speaker ${u.speaker}: ${u.transcript}`)
        .join('\n');
    } else {
      // Fall back to paragraphs or plain transcript
      const paragraphs = deepgramData.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.paragraphs;
      if (paragraphs) {
        transcript = paragraphs
          .map((p: any) =>
            p.sentences.map((s: any) => `Speaker ${p.speaker}: ${s.text}`).join('\n')
          )
          .join('\n');
      } else {
        transcript = deepgramData.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      }
    }

    if (!transcript) {
      return new Response(JSON.stringify({ error: 'Transcription returned empty result' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get duration from Deepgram metadata
    const durationSeconds = Math.round(deepgramData.metadata?.duration || 0);

    // Update the call record with transcript and duration
    await supabaseAdmin
      .from('calls')
      .update({
        transcript,
        duration_seconds: durationSeconds || null,
        status: 'analyzing',
      })
      .eq('id', callId);

    return new Response(JSON.stringify({ transcript, durationSeconds }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
