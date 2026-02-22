import type { AnalysisResult } from '../types';

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

export async function analyzeTranscript(transcript: string): Promise<AnalysisResult> {
  // Call Claude API via Supabase Edge Function (to keep API key server-side)
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });

  if (!response.ok) {
    throw new Error(`Analysis failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data as AnalysisResult;
}

// For local development / direct API usage
export async function analyzeTranscriptDirect(
  transcript: string,
  apiKey: string
): Promise<AnalysisResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || [null, content];
  const jsonStr = jsonMatch[1] || content;

  return JSON.parse(jsonStr) as AnalysisResult;
}

export function getAnalysisPrompt(): string {
  return ANALYSIS_PROMPT;
}
