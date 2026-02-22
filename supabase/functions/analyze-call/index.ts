import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

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

IMPORTANT: Return ONLY valid JSON matching this exact structure:
{
  "overall_score": 6.5,
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
      return new Response(JSON.stringify({ error: 'Only admins and managers can analyze calls' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { transcript, callId, sdrId, companyId } = await req.json();

    if (!transcript || !callId) {
      return new Response(JSON.stringify({ error: 'Transcript and callId are required' }), {
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

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call Claude API
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
      return new Response(JSON.stringify({ error: `Claude API error: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const claudeData = await claudeResponse.json();
    const content = claudeData.content[0].text;

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || [null, content];
    const jsonStr = jsonMatch[1] || content;
    const analysis = JSON.parse(jsonStr);

    // Save analysis to database
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
      return new Response(JSON.stringify({ error: `Failed to save analysis: ${analysisError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create coaching items from each dimension's suggestion
    const coachingItems = Object.entries(analysis.dimensions).map(([dimension, dim]: [string, any]) => ({
      call_analysis_id: savedAnalysis.id,
      sdr_id: sdrId,
      company_id: companyId,
      dimension,
      action_item: dim.coaching_suggestion,
      status: 'open',
    }));

    await supabaseAdmin.from('coaching_items').insert(coachingItems);

    // Update call status to completed
    await supabaseAdmin
      .from('calls')
      .update({ status: 'completed' })
      .eq('id', callId);

    return new Response(JSON.stringify(analysis), {
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
