import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * process-call: A single Edge Function that handles the full pipeline
 * for one call: transcribe (if audio) → analyze → save results.
 *
 * Called fire-and-forget from the client — the client does NOT wait for a response.
 * The call's status in the DB serves as the progress indicator.
 */

const ANALYSIS_PROMPT = `You are an expert sales coach analyzing a cold call transcript. Your job is to evaluate the SDR's performance and provide actionable feedback.

Score this call on 6 dimensions (1-10 scale, be honest and critical — a 7+ should be genuinely good):

1. Opening & Hook — Did the SDR capture attention in the first 30 seconds? Was the intro compelling?
2. Discovery & Qualification — Did they ask smart questions to understand the prospect's needs and qualify them?
3. Value Proposition — Did they clearly and compellingly articulate the product's value to this specific prospect?
4. Objection Handling — How well did they address pushback, concerns, or resistance?
5. Closing Technique — Did they drive toward a clear next step or commitment?
6. Tone & Rapport — Were they professional, warm, confident, and engaging?

For each dimension provide:
- score: integer 1-10
- justification: 2-3 sentences explaining why this score
- quotes: array of 1-2 direct quotes from the transcript as evidence
- coaching_suggestion: one specific, actionable thing to do differently next time

Also provide:
- overall_score: average of all 6 scores, rounded to 1 decimal
- strengths: array of 2-3 things the SDR did well (specific, not generic)
- weaknesses: array of 2-3 areas that need improvement (specific, not generic)
- summary: 2-3 sentence overall assessment
- prospect_name: the full name of the prospect/lead being called, extracted from the transcript. Look for introductions like "Hi this is [name]", "speaking with [name]", "Hey [name]", or any context where the prospect identifies themselves. If you cannot confidently determine the prospect's name, set this to null.

IMPORTANT: Return ONLY valid JSON matching this exact structure:
{
  "overall_score": 6.5,
  "prospect_name": "John Smith",
  "dimensions": {
    "opening": { "score": 7, "justification": "...", "quotes": ["..."], "coaching_suggestion": "..." },
    "discovery": { "score": 6, "justification": "...", "quotes": ["..."], "coaching_suggestion": "..." },
    "value_prop": { "score": 5, "justification": "...", "quotes": ["..."], "coaching_suggestion": "..." },
    "objection": { "score": 7, "justification": "...", "quotes": ["..."], "coaching_suggestion": "..." },
    "closing": { "score": 6, "justification": "...", "quotes": ["..."], "coaching_suggestion": "..." },
    "tone": { "score": 8, "justification": "...", "quotes": ["..."], "coaching_suggestion": "..." }
  },
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "summary": "..."
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let callId: string | undefined;

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
      return new Response(JSON.stringify({ error: 'Only admins and managers can process calls' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    callId = body.callId;
    const { sdrId, companyId, filePath, transcript: providedTranscript } = body;

    if (!callId) {
      return new Response(JSON.stringify({ error: 'callId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the call belongs to the caller's company
    if (companyId !== callerProfile.company_id) {
      return new Response(JSON.stringify({ error: 'Call does not belong to your company' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let transcript = providedTranscript || '';

    // ─── STEP 1: Transcribe (if audio file) ───────────────────────
    if (filePath && !transcript) {
      await supabaseAdmin
        .from('calls')
        .update({ status: 'transcribing' })
        .eq('id', callId);

      const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY');
      if (!deepgramApiKey) {
        throw new Error('Deepgram API key not configured');
      }

      // Download audio from Supabase Storage
      const { data: audioData, error: downloadError } = await supabaseAdmin.storage
        .from('call-recordings')
        .download(filePath);

      if (downloadError || !audioData) {
        throw new Error(`Failed to download audio: ${downloadError?.message}`);
      }

      // Detect content type
      const ext = filePath.split('.').pop()?.toLowerCase();
      const contentTypeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        ogg: 'audio/ogg',
      };
      const contentType = contentTypeMap[ext || ''] || 'audio/mpeg';

      // Send to Deepgram
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
        throw new Error(`Deepgram error: ${errText}`);
      }

      const deepgramData = await deepgramResponse.json();

      // Build transcript
      const utterances = deepgramData.results?.utterances;
      if (utterances && utterances.length > 0) {
        transcript = utterances
          .map((u: any) => `Speaker ${u.speaker}: ${u.transcript}`)
          .join('\n');
      } else {
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
        throw new Error('Transcription returned empty result');
      }

      const durationSeconds = Math.round(deepgramData.metadata?.duration || 0);

      // Save transcript to call record
      await supabaseAdmin
        .from('calls')
        .update({
          transcript,
          duration_seconds: durationSeconds || null,
          status: 'analyzing',
        })
        .eq('id', callId);
    } else {
      // Text transcript — mark as analyzing
      await supabaseAdmin
        .from('calls')
        .update({ status: 'analyzing' })
        .eq('id', callId);
    }

    // ─── STEP 2: Analyze with Claude ──────────────────────────────
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${ANALYSIS_PROMPT}\n\nHere is the transcript to analyze:\n\n${transcript}`,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      throw new Error(`Claude API error: ${errText}`);
    }

    const claudeData = await claudeResponse.json();
    const content = claudeData.content[0].text;

    // Extract JSON from response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || [null, content];
    const jsonStr = jsonMatch[1] || content;
    const analysis = JSON.parse(jsonStr);

    // Save analysis
    const { data: savedAnalysis, error: analysisError } = await supabaseAdmin
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
      })
      .select('id')
      .single();

    if (analysisError) {
      throw new Error(`Failed to save analysis: ${analysisError.message}`);
    }

    // Create coaching items
    const coachingItems = Object.entries(analysis.dimensions).map(([dimension, dim]: [string, any]) => ({
      call_analysis_id: savedAnalysis.id,
      sdr_id: sdrId,
      company_id: companyId,
      dimension,
      action_item: dim.coaching_suggestion,
      status: 'open',
    }));

    await supabaseAdmin.from('coaching_items').insert(coachingItems);

    // ─── STEP 3: Mark completed + auto-fill prospect name ─────────
    // Check if prospect_name is missing, and if Claude extracted one
    const callUpdates: Record<string, unknown> = { status: 'completed' };

    if (analysis.prospect_name) {
      // Only fill in if the call doesn't already have a prospect name
      const { data: existingCall } = await supabaseAdmin
        .from('calls')
        .select('prospect_name')
        .eq('id', callId)
        .single();

      if (!existingCall?.prospect_name) {
        callUpdates.prospect_name = analysis.prospect_name;
      }
    }

    await supabaseAdmin
      .from('calls')
      .update(callUpdates)
      .eq('id', callId);

    return new Response(JSON.stringify({ success: true, callId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('process-call error:', err.message);

    // Mark the call as failed so the UI can show it
    if (callId) {
      await supabaseAdmin
        .from('calls')
        .update({ status: 'failed' })
        .eq('id', callId);
    }

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
